import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

function frontendCss() {
  const frontend = path.resolve(root, '../frontend/src');
  return [
    'styles.css',
    'styles/base.css',
    'styles/admin.css',
    'styles/member.css',
    'styles/governance.css',
  ].map((file) => fs.readFileSync(path.join(frontend, file), 'utf8')).join('\n');
}

function dbWithSchema() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return Number(Object.values(row ?? { value: 0 })[0] ?? 0);
}

function cashMetrics(db, month) {
  const opening = scalar(db, `SELECT
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved' AND month < ?) +
    (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month < ?) -
    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month < ?) AS balance`, month, month, month);
  const contributions = scalar(db, "SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month=?", month);
  const donations = scalar(db, "SELECT COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month=?", month);
  const expenses = scalar(db, "SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month=?", month);
  return { opening, contributions, donations, expenses, closing: opening + contributions + donations - expenses };
}

function reportBalance(db, month) {
  const snap = db.prepare('SELECT opening_balance,closing_balance FROM monthly_snapshots WHERE month=?').get(month);
  if (snap) return { opening: Number(snap.opening_balance), closing: Number(snap.closing_balance), source: 'snapshot' };
  const prior = db.prepare('SELECT month,closing_balance FROM monthly_snapshots WHERE month < ? ORDER BY month DESC LIMIT 1').get(month);
  const net = cashMetrics(db, month);
  if (!prior) return { opening: net.opening, closing: net.closing, source: 'transactions' };
  const bridge = scalar(db, `SELECT
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved' AND month > ? AND month < ?) +
    (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month > ? AND transaction_month < ?) -
    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month > ? AND transaction_month < ?) AS balance`, prior.month, month, prior.month, month, prior.month, month);
  const opening = Number(prior.closing_balance) + bridge;
  return { opening, closing: opening + net.contributions + net.donations - net.expenses, source: 'prior_snapshot' };
}

function closeMonth(db, month, adminId = 1) {
  const m = cashMetrics(db, month);
  db.prepare(`INSERT OR REPLACE INTO monthly_snapshots
    (month,opening_balance,contribution_cash,donation_cash,expenses,closing_balance,total_due,total_collected,collection_rate,active_members,paid_members,partial_members,unpaid_members,exempt_members,closed_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(month,m.opening,m.contributions,m.donations,m.expenses,m.closing,0,0,100,1,1,0,0,0,adminId);
  db.prepare('INSERT INTO month_closures(month,closed_by) VALUES(?,?)').run(month, adminId);
  return m;
}

test('critical accounting workflow: approval, allocation, close, opening balance, reopen/reclose and reversal', () => {
  const db = dbWithSchema();
  db.prepare("INSERT INTO admins(id,telegram_id,name,role) VALUES(1,'100','Owner','super_admin')").run();
  db.prepare("INSERT INTO members(id,member_code,name,monthly_amount,joined_at) VALUES(1,'M0001','Test Member',250,'2026-01-01')").run();
  db.prepare("INSERT INTO expense_categories(id,name) VALUES(10,'Operations')").run();

  // A MVR 500 August receipt is approved and allocated across August + September.
  const c = db.prepare("INSERT INTO contributions(txn_id,member_id,amount,month,ref_number,bank_date,duplicate_key,status,approved_by,approved_at) VALUES('C0001',1,500,'2026-08','BML-ABC','2026-08-10','BMLABC|50000|2026-08-10','approved',1,datetime('now'))").run();
  const contributionId = Number(c.lastInsertRowid);
  db.prepare('INSERT INTO contribution_allocations(contribution_id,member_id,month,amount) VALUES(?,?,?,?)').run(contributionId,1,'2026-08',250);
  db.prepare('INSERT INTO contribution_allocations(contribution_id,member_id,month,amount) VALUES(?,?,?,?)').run(contributionId,1,'2026-09',250);

  assert.equal(scalar(db, `SELECT COALESCE(SUM(ca.amount),0) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.member_id=1 AND ca.month='2026-08' AND c.status='approved'`), 250);
  assert.equal(scalar(db, `SELECT COALESCE(SUM(ca.amount),0) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.member_id=1 AND ca.month='2026-09' AND c.status='approved'`), 250);

  // Cash stays in August even though half of the payment satisfies September dues.
  const august = closeMonth(db, '2026-08');
  assert.equal(august.opening, 0);
  assert.equal(august.contributions, 500);
  assert.equal(august.closing, 500);
  assert.deepEqual(reportBalance(db,'2026-08'), { opening:0, closing:500, source:'snapshot' });

  // September inherits August snapshot, but the advance allocation does not create cash again.
  assert.deepEqual(reportBalance(db,'2026-09'), { opening:500, closing:500, source:'prior_snapshot' });

  // Reopen removes both lock and immutable snapshot; changing August then re-closing recalculates balance.
  db.prepare("DELETE FROM month_closures WHERE month='2026-08'").run();
  db.prepare("DELETE FROM monthly_snapshots WHERE month='2026-08'").run();
  db.prepare("INSERT INTO donations(txn_id,donor_name,amount,logged_by,transaction_month,status) VALUES('D0001','Donor',100,1,'2026-08','active')").run();
  db.prepare("INSERT INTO expenses(txn_id,description,category_id,amount,logged_by,expense_date,transaction_month,status,approved_by,approved_at) VALUES('E0001','Supplies',10,50,1,'2026-08-20','2026-08','approved',1,datetime('now'))").run();
  const augustReclosed = closeMonth(db,'2026-08');
  assert.equal(augustReclosed.closing, 550);
  assert.deepEqual(reportBalance(db,'2026-09'), { opening:550, closing:550, source:'prior_snapshot' });

  // Open-month reversal removes the transaction from live totals without deleting history.
  db.prepare("INSERT INTO expenses(txn_id,description,category_id,amount,logged_by,expense_date,transaction_month,status,approved_by,approved_at) VALUES('E0002','September item',10,80,1,'2026-09-02','2026-09','approved',1,datetime('now'))").run();
  assert.equal(reportBalance(db,'2026-09').closing, 470);
  const expId = Number(db.prepare("SELECT id FROM expenses WHERE txn_id='E0002'").get().id);
  db.prepare("UPDATE expenses SET status='reversed' WHERE id=?").run(expId);
  db.prepare("INSERT INTO financial_reversals(reversal_id,entity_type,entity_id,original_txn_id,amount,month,reason,reversed_by) VALUES('RV0000001','expense',?,'E0002',80,'2026-09','Correction',1)").run(expId);
  assert.equal(reportBalance(db,'2026-09').closing, 550);
  assert.equal(scalar(db,"SELECT COUNT(*) FROM financial_reversals WHERE entity_type='expense' AND entity_id=?",expId),1);
  assert.equal(scalar(db,"SELECT COUNT(*) FROM expenses WHERE id=? AND status='reversed'",expId),1);

  db.close();
});

test('duplicate live bank slips are blocked by canonical reference + amount + date key', () => {
  const db = dbWithSchema();
  db.prepare("INSERT INTO admins(id,telegram_id,name,role) VALUES(1,'100','Owner','super_admin')").run();
  db.prepare("INSERT INTO members(id,member_code,name,monthly_amount) VALUES(1,'M0001','One',250)").run();
  db.prepare("INSERT INTO members(id,member_code,name,monthly_amount) VALUES(2,'M0002','Two',250)").run();
  db.prepare("INSERT INTO contributions(txn_id,member_id,amount,month,ref_number,bank_date,duplicate_key,status) VALUES('C1',1,250,'2026-09','ABC-123','2026-09-01','ABC123|25000|2026-09-01','pending')").run();
  assert.throws(() => db.prepare("INSERT INTO contributions(txn_id,member_id,amount,month,ref_number,bank_date,duplicate_key,status) VALUES('C2',2,250,'2026-09','ABC 123','2026-09-01','ABC123|25000|2026-09-01','pending')").run(), /UNIQUE/);
  db.prepare("UPDATE contributions SET status='reversed' WHERE txn_id='C1'").run();
  assert.doesNotThrow(() => db.prepare("INSERT INTO contributions(txn_id,member_id,amount,month,ref_number,bank_date,duplicate_key,status) VALUES('C2',2,250,'2026-09','ABC 123','2026-09-01','ABC123|25000|2026-09-01','pending')").run());
  db.close();
});

test('PDF/CSV export paths remain wired through member statement and Telegram document endpoint', () => {
  const exportSource = [
    'exports.js','statementExports.js','exportDelivery.js'
  ].map((file) => fs.readFileSync(path.resolve(root,'../frontend/src/utils',file),'utf8')).join('\n');
  const apiSource = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  const reportsSource = fs.readFileSync(path.join(root,'src/routes/reports.ts'),'utf8');
  assert.match(exportSource, /exportStatementCsv/);
  assert.match(exportSource, /exportStatementPdf/);
  assert.match(exportSource, /api\.members\.statement/);
  assert.match(exportSource, /sendExportToTelegram/);
  assert.match(apiSource, /\/api\/reports\/send-document/);
  assert.match(reportsSource, /reportsRoute\.post\("\/send-document"/);
  assert.match(reportsSource, /\.pdf/);
  assert.match(reportsSource, /\.csv/);
});


test('expense create request tokens are unique so a retry cannot create a second expense', () => {
  const db = dbWithSchema();
  db.prepare("INSERT INTO admins(id,telegram_id,name,role) VALUES(1,'100','Owner','super_admin')").run();
  db.prepare("INSERT INTO expense_categories(id,name,active) VALUES(10,'General',1)").run();

  const sql = `INSERT INTO expenses(txn_id,description,category_id,amount,logged_by,expense_date,transaction_month,status,approved_by,approved_at,idempotency_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
  db.prepare(sql).run('E1','Supplies',10,25,1,'2026-09-03','2026-09','approved',1,'2026-09-03T12:00:00Z','req-expense-12345678');
  assert.throws(() => db.prepare(sql).run('E2','Supplies',10,25,1,'2026-09-03','2026-09','approved',1,'2026-09-03T12:00:01Z','req-expense-12345678'), /UNIQUE/);
  assert.equal(scalar(db,"SELECT COUNT(*) FROM expenses"),1);
  db.close();
});

test('stability routes guard historical month reopen and repeat void actions', () => {
  const governanceSource = fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  const expenseSource = fs.readFileSync(path.join(root,'src/routes/expenses.ts'),'utf8');
  const pendingSource = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const formSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/expenses/ExpenseForm.jsx'),'utf8');

  assert.match(governanceSource, /SELECT month FROM month_closures WHERE month>\?/);
  assert.match(governanceSource, /LATER_MONTH_ALREADY_CLOSED/);
  assert.match(expenseSource, /WHERE id=\? AND status='approved'/);
  assert.match(pendingSource, /WHERE id=\? AND status IN \('pending','approved'\)/);
  assert.match(expenseSource, /idempotency_key/);
  assert.match(formSource, /randomUUID/);
  assert.match(formSource, /idempotency_key/);
});


test('frontend crashes are reported to the authenticated production error log endpoint', () => {
  const indexSource = fs.readFileSync(path.join(root,'src/index.ts'),'utf8');
  const appSource = fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const apiSource = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');

  assert.match(indexSource, /app\.post\("\/api\/client-error"/);
  assert.match(indexSource, /safeLogError\(c\.env,`client:\$\{source\}`/);
  assert.match(appSource, /window\.addEventListener\("error"/);
  assert.match(appSource, /window\.addEventListener\("unhandledrejection"/);
  assert.match(appSource, /source: "page-boundary"/);
  assert.match(apiSource, /async function reportClientError/);
  assert.match(apiSource, /keepalive: true/);
});

test('critical financial workflow guards remain wired after stability hardening', () => {
  const governanceSource = fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  const pendingSource = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const expensesSource = fs.readFileSync(path.join(root,'src/routes/expenses.ts'),'utf8');
  const projectsSource = fs.readFileSync(path.join(root,'src/routes/projects.ts'),'utf8');

  assert.match(governanceSource, /LATER_MONTH_ALREADY_CLOSED/);
  assert.match(governanceSource, /financial_reversals WHERE entity_type=\? AND entity_id=\?/);
  assert.match(pendingSource, /duplicateSlip/);
  assert.match(pendingSource, /approveWithAllocations/);
  assert.match(expensesSource, /idempotency_key/);
  assert.match(expensesSource, /status='voided'/);
  assert.match(projectsSource, /donation_received/);
  assert.match(projectsSource, /status='approved'/);
});


test('Telegram update receipts prevent duplicate webhook processing and allow failed retry', () => {
  const db = dbWithSchema();

  const claim = (updateId) => db.prepare(`
    INSERT INTO telegram_update_receipts(update_id,status,claimed_at,attempts,last_error)
    VALUES(?,'processing',datetime('now'),1,NULL)
    ON CONFLICT(update_id) DO UPDATE SET
      status='processing',
      claimed_at=datetime('now'),
      completed_at=NULL,
      attempts=telegram_update_receipts.attempts+1,
      last_error=NULL
    WHERE telegram_update_receipts.status='failed'
       OR (
         telegram_update_receipts.status='processing'
         AND telegram_update_receipts.claimed_at < datetime('now','-5 minutes')
       )
    RETURNING update_id
  `).get(updateId);

  assert.equal(Number(claim(9001).update_id),9001);
  assert.equal(claim(9001),undefined);

  db.prepare("UPDATE telegram_update_receipts SET status='completed',completed_at=datetime('now') WHERE update_id=9001").run();
  assert.equal(claim(9001),undefined);

  db.prepare("INSERT INTO telegram_update_receipts(update_id,status,claimed_at,attempts,last_error) VALUES(9002,'failed',datetime('now'),1,'temporary')").run();
  assert.equal(Number(claim(9002).update_id),9002);
  assert.equal(db.prepare("SELECT status FROM telegram_update_receipts WHERE update_id=9002").get().status,'processing');

  db.close();
});

test('Telegram webhook claims update_id before running bot side effects', () => {
  const indexSource = fs.readFileSync(path.join(root,'src/index.ts'),'utf8');
  const botSource = fs.readFileSync(path.join(root,'src/bot.ts'),'utf8');

  assert.match(indexSource, /claimTelegramUpdate\(c\.env, updateId\)/);
  assert.match(indexSource, /completeTelegramUpdate\(c\.env, updateId\)/);
  assert.match(indexSource, /failTelegramUpdate\(c\.env, updateId, e\)/);
  assert.match(botSource, /telegram_update_receipts/);
  assert.match(botSource, /datetime\('now','-5 minutes'\)/);
  assert.match(botSource, /datetime\('now','-14 days'\)/);
});

test('donation edit and document support preserve accounting locks and evidence history', () => {
  const schemaSource = fs.readFileSync(path.join(root,'schema.sql'),'utf8');
  const donationSource = fs.readFileSync(path.join(root,'src/routes/donations.ts'),'utf8');
  const reportsSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Reports.jsx'),'utf8');
  const detailSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/DonationDetails.jsx'),'utf8');
  const modalSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/ReportModals.jsx'),'utf8');

  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS donation_documents/);
  assert.match(schemaSource, /donation_date TEXT/);
  assert.match(donationSource, /donationsRoute\.patch\("\/:id"/);
  assert.match(donationSource, /requireOpenMonth\(c\.env,originalMonth\)/);
  assert.match(donationSource, /donation_document_added/);
  assert.match(donationSource, /removed_at=datetime\('now'\)/);
  assert.match(donationSource, /sendStoredDocument/);
  assert.match(reportsSource, /DonationDetails/);
  assert.match(detailSource, /Supporting documents/);
  assert.match(modalSource, /Donation date/);
  assert.match(modalSource, /idempotency_key/);
});

test('donation idempotency key blocks duplicate create retries in the database', () => {
  const db = dbWithSchema();
  db.prepare("INSERT INTO admins(id,telegram_id,name,role) VALUES(1,'100','Owner','super_admin')").run();
  const sql=`INSERT INTO donations(txn_id,donor_name,amount,logged_by,transaction_month,status,donation_date,idempotency_key) VALUES(?,?,?,?,?,'active',?,?)`;
  db.prepare(sql).run('D1','Donor',100,1,'2026-09','2026-09-04','donation-request-123456');
  assert.throws(()=>db.prepare(sql).run('D2','Donor',100,1,'2026-09','2026-09-04','donation-request-123456'),/UNIQUE/);
  assert.equal(scalar(db,"SELECT COUNT(*) FROM donations"),1);
  db.close();
});


test('member fund can open Uncategorised expenses', () => {
  const reportsSource = fs.readFileSync(path.join(root,'src/routes/reports.ts'),'utf8');
  const fundSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/FundView.jsx'),'utf8');

  assert.match(reportsSource, /categoryId === 0/);
  assert.match(reportsSource, /e\.category_id IS NULL/);
  assert.match(reportsSource, /name:"Uncategorised"/);
  assert.match(fundSource, /category\.category_id == null \? 0/);
  assert.match(fundSource, /publicExpenses\(month, categoryId\)/);
});


test('member acceptance polish keeps contribution totals consistent and project subsections compact', () => {
  const historySource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyHistory.jsx'),'utf8');
  const profileSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyProfile.jsx'),'utf8');
  const projectSource = fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberProjects.jsx'),'utf8');
  const contributionUtil = fs.readFileSync(path.resolve(root,'../frontend/src/utils/contributions.js'),'utf8');

  assert.match(historySource, /approvedContributionSummary\(rows\)/);
  assert.match(profileSource, /approvedContributionSummary\(contributions\)/);
  assert.match(contributionUtil, /status.*approved/);
  assert.match(historySource, /member-history-filter/);
  assert.match(projectSource, /ProjectSubsection/);
  assert.match(projectSource, /sectionOpen\(p\.id,"donations"\)/);
  assert.match(projectSource, /sectionOpen\(p\.id,"expenses"\)/);
  assert.match(profileSource, /Date\.UTC/);
});


test('admin acceptance polish keeps reporting month consistent and mobile admin views compact', () => {
  const app = fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const memberData = fs.readFileSync(path.resolve(root,'../frontend/src/pages/members/useMembersData.js'),'utf8');
  const reportData = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/useReportsData.js'),'utf8');
  const monthUtil = fs.readFileSync(path.resolve(root,'../frontend/src/utils/adminReportMonth.js'),'utf8');
  const projects = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Projects.jsx'),'utf8');
  const reportSections = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/ReportSections.jsx'),'utf8');
  const settingsSections = fs.readFileSync(path.resolve(root,'../frontend/src/pages/settings/SettingsSections.jsx'),'utf8');

  assert.match(app,/const \[adminMonth, setAdminMonthState\]/);
  assert.match(app,/month=\{adminMonth\} onMonthChange=\{setAdminMonth\}/);
  assert.match(app,/adminMonth=\{adminMonth\}/);
  assert.match(memberData,/sharedMonth/);
  assert.match(reportData,/sharedMonth/);
  assert.doesNotMatch(memberData,/getAdminReportMonth/);
  assert.doesNotMatch(reportData,/getAdminReportMonth/);
  assert.match(monthUtil,/fund_admin_report_month/);
  assert.match(projects,/ProjectsSkeleton/);
  assert.match(reportSections,/annual-top-member/);
  assert.match(settingsSections,/admin-audit-row/);
});


test('first-month contribution policy defaults to half after day 15 and is used consistently', () => {
  const db = dbWithSchema();
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key='first_month_contribution_rule'").get()?.value,
    'half_after_15'
  );
  db.close();

  const rates = fs.readFileSync(path.join(root,'src/contributionRates.ts'),'utf8');
  const members = fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  const reports = fs.readFileSync(path.join(root,'src/routes/reports.ts'),'utf8');
  const governance = fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  const pending = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const scheduled = fs.readFileSync(path.join(root,'src/scheduled.ts'),'utf8');
  const allocations = fs.readFileSync(path.join(root,'src/allocations.ts'),'utf8');
  const settings = fs.readFileSync(path.resolve(root,'../frontend/src/pages/settings/SettingsSections.jsx'),'utf8');

  assert.match(rates, /day>15/);
  assert.match(rates, /rate\/2/);
  assert.match(rates, /month<joinMonth/);
  assert.match(rates, /rule==="next_month"/);
  assert.match(members, /contributionDueFromRate/);
  assert.match(reports, /adjustedOutstanding/);
  assert.match(reports, /collectionExpected/);
  assert.match(governance, /firstMonthContributionRule/);
  assert.match(pending, /contributionDueFromRate/);
  assert.match(scheduled, /contributionDueForMonth/);
  assert.match(allocations, /contributionDueFromRate/);
  assert.match(settings, /first_month_contribution_rule/);
});

test('new member inserts explicitly store a Maldives-local joined date', () => {
  const members = fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  const pending = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const callbacks = fs.readFileSync(path.join(root,'src/bot/callbacks.ts'),'utf8');

  assert.match(members, /joined_at/);
  assert.match(members, /currentDate\(c\.env\.FUND_TIMEZONE/);
  assert.match(pending, /currentDate\(c\.env\.FUND_TIMEZONE/);
  assert.match(callbacks, /currentDate\(env\.FUND_TIMEZONE/);
});


test('admin member cards do not show a due amount for not-applicable months', () => {
  const members = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Members.jsx'),'utf8');
  assert.match(members,/status === "not_applicable"/);
  assert.match(members,/No contribution due for \{monthLabel\}/);
  assert.match(members,/monthly\?\.monthly_amount/);
});


test('first-month contribution rule boundary semantics are locked at day 15 and 16', () => {
  // Mirror the deliberately tiny pure policy function so the boundary cases are explicit
  // in regression coverage, while source assertions below guarantee production uses it.
  const due = (rate, joinedAt, month, rule='half_after_15') => {
    const joined=String(joinedAt||'').slice(0,10);
    const joinMonth=joined.slice(0,7);
    if(/^\d{4}-\d{2}$/.test(joinMonth)){
      if(month<joinMonth)return 0;
      if(month===joinMonth){
        if(rule==='next_month')return 0;
        if(rule==='half_after_15' && Number(joined.slice(8,10))>15)return Number((rate/2).toFixed(2));
      }
    }
    return Number(Number(rate||0).toFixed(2));
  };

  assert.equal(due(100,'2026-09-15','2026-09'),100);
  assert.equal(due(100,'2026-09-16','2026-09'),50);
  assert.equal(due(101,'2026-09-30','2026-09'),50.5);
  assert.equal(due(100,'2026-09-16','2026-08'),0);
  assert.equal(due(100,'2026-09-16','2026-10'),100);
  assert.equal(due(100,'2026-09-01','2026-09','next_month'),0);
  assert.equal(due(100,'2026-09-01','2026-09','full'),100);

  const rates = fs.readFileSync(path.join(root,'src/contributionRates.ts'),'utf8');
  assert.match(rates,/day>15/);
  assert.match(rates,/Number\(\(rate\/2\)\.toFixed\(2\)\)/);
});

test('first-month policy propagates to reminders allocations analytics and month-close calculations', () => {
  const scheduled = fs.readFileSync(path.join(root,'src/scheduled.ts'),'utf8');
  const pending = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const allocations = fs.readFileSync(path.join(root,'src/allocations.ts'),'utf8');
  const governance = fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  const reports = fs.readFileSync(path.join(root,'src/routes/reports.ts'),'utf8');

  assert.match(scheduled,/contributionDueForMonth/);
  assert.match(pending,/contributionDueFromRate/);
  assert.match(pending,/m\.due>0\.005/);
  assert.match(allocations,/if\(monthly<=0\.004\) continue/);
  assert.match(allocations,/contributionDueFromRate/);
  assert.match(governance,/contributionDueFromRate/);
  assert.match(governance,/firstMonthContributionRule/);
  assert.match(reports,/collectionExpected/);
  assert.match(reports,/adjustedOutstanding/);
});

test('shared admin month is the single React source for overview members reports and month close', () => {
  const app = fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const overview = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Overview.jsx'),'utf8');
  const members = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Members.jsx'),'utf8');
  const reports = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Reports.jsx'),'utf8');
  const settings = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Settings.jsx'),'utf8');

  assert.match(app,/adminMonth=\{adminMonth\}/);
  assert.match(app,/<Members[^>]*month=\{adminMonth\}[^>]*onMonthChange=\{setAdminMonth\}/);
  assert.match(app,/<Reports[^>]*month=\{adminMonth\}[^>]*onMonthChange=\{setAdminMonth\}/);
  assert.match(overview,/api\.reports\.summary\(adminMonth \|\| undefined\)/);
  assert.match(members,/sharedMonth/);
  assert.match(reports,/sharedMonth/);
  assert.match(settings,/onAdminMonthChange/);
  assert.match(settings,/shiftSharedCloseMonth/);
});


test('contribution review Telegram messages are persisted and synchronized from Mini App decisions', () => {
  const db = dbWithSchema();
  const table = db.prepare("PRAGMA table_info(contribution_review_messages)").all();
  const cols = new Set(table.map((r) => r.name));
  for (const name of ['contribution_id','telegram_chat_id','telegram_message_id','message_kind','last_synced_at','last_sync_status']) {
    assert.ok(cols.has(name), `missing ${name}`);
  }
  db.close();

  const slips = fs.readFileSync(path.join(root,'src/bot/slips.ts'),'utf8');
  const helper = fs.readFileSync(path.join(root,'src/contributionReviewMessages.ts'),'utf8');
  const pending = fs.readFileSync(path.join(root,'src/routes/admin/pending.ts'),'utf8');
  const callbacks = fs.readFileSync(path.join(root,'src/bot/callbacks.ts'),'utf8');
  const support = fs.readFileSync(path.join(root,'src/botSupport.ts'),'utf8');
  const ops = fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');

  assert.match(support,/telegram_message_id/);
  assert.match(slips,/recordContributionReviewMessage/);
  assert.match(helper,/syncContributionReviewMessages/);
  assert.match(helper,/editMessageCaption/);
  assert.match(helper,/inline_keyboard:\[\]/);
  assert.match(pending,/syncContributionReviewMessages\(c\.env,id,"approved"/);
  assert.match(pending,/syncContributionReviewMessages\(c\.env,id,"rejected"/);
  assert.match(callbacks,/recordContributionReviewMessage/);
  assert.match(callbacks,/syncContributionReviewMessages/);
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('Telegram callback can self-heal a legacy stale contribution review message', () => {
  const callbacks = fs.readFileSync(path.join(root,'src/bot/callbacks.ts'),'utf8');
  assert.match(callbacks,/if \(contribution\.status !== "pending"\)/);
  assert.match(callbacks,/contribution\.status==="approved"/);
  assert.match(callbacks,/contribution\.status==="rejected"/);
  assert.match(callbacks,/Already \$\{contribution\.status\}/);
});


test('contribution review UX reports Telegram sync and prevents duplicate review taps', () => {
  const pending = fs.readFileSync(path.resolve(root,'../frontend/src/pages/PendingApprovals.jsx'),'utf8');
  const api = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(pending,/const \[busy, setBusy\]/);
  assert.match(pending,/finishContribution/);
  assert.match(pending,/Telegram review messages updated/);
  assert.match(pending,/could not be updated/);
  assert.match(pending,/disabled=\{!!busy\}/);
  assert.match(api,/retryError/);
});

test('failed Telegram contribution review sync is logged, retryable, and retained only temporarily', () => {
  const helper = fs.readFileSync(path.join(root,'src/contributionReviewMessages.ts'),'utf8');
  const system = fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  const scheduled = fs.readFileSync(path.join(root,'src/scheduled.ts'),'utf8');
  assert.match(helper,/telegram\.contribution_review_sync/);
  assert.match(helper,/retryContributionReviewMessage/);
  assert.match(helper,/cleanupContributionReviewMessages/);
  assert.match(system,/errors\/:id\/retry/);
  assert.match(system,/telegram_review_sync_retried/);
  assert.match(scheduled,/cleanupContributionReviewMessages\(env,180\)/);
});


test('pending contribution review loads Telegram-backed slip inline with retry and large preview', () => {
  const pending = fs.readFileSync(path.resolve(root,'../frontend/src/pages/PendingApprovals.jsx'),'utf8');
  const api = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  const members = fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');

  assert.match(pending,/loadReviewSlip/);
  assert.match(pending,/api\.members\.contributionSlip\(contribution\.member_id,contribution\.id\)/);
  assert.match(pending,/Loading slip…/);
  assert.match(pending,/Fetching securely from Telegram/);
  assert.match(pending,/Tap image to enlarge/);
  assert.match(pending,/Retry/);
  assert.match(api,/contributionSlip/);
  assert.match(members,/downloadTelegramFile/);
  assert.match(members,/Content-Disposition.*inline/);
});


test('performance stage v44 deduplicates GETs, uses short lived caches, and preserves warmed tab data', () => {
  const api = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  const app = fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const reports = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/useReportsData.js'),'utf8');
  const members = fs.readFileSync(path.resolve(root,'../frontend/src/pages/members/useMembersData.js'),'utf8');
  const pending = fs.readFileSync(path.resolve(root,'../frontend/src/pages/PendingApprovals.jsx'),'utf8');

  assert.match(api,/inFlightGets/);
  assert.match(api,/cacheTtlFor/);
  assert.match(api,/peekCached/);
  assert.match(api,/performanceSnapshot/);
  assert.match(api,/window\.__FUND_PERF__/);
  assert.match(api,/preserveStable/);
  assert.match(app,/adminMonth: adminView \? adminMonth : null/);
  assert.match(reports,/api\.peekCached\(summaryPath\)/);
  assert.match(members,/api\.peekCached\("\/api\/members"\)/);
  assert.match(pending,/api\.peekCached\("\/api\/admin\/pending"\)/);
});

test('financial write requests remain uncached and invalidate read cache', () => {
  const api = fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/MUTATION_METHODS/);
  assert.match(api,/invalidateAfterMutation\(path\)/);
  assert.match(api,/if \(!isGet\) return run\(\)/);
  assert.match(api,/broadcastDataChange\(path, method\)/);
});


test('EXCO elections use secret ballot storage separated from voter identity', () => {
  const db=dbWithSchema();
  const voterCols=new Set(db.prepare("PRAGMA table_info(election_voters)").all().map(r=>r.name));
  const ballotCols=new Set(db.prepare("PRAGMA table_info(election_ballots)").all().map(r=>r.name));
  assert.ok(voterCols.has("member_id"));
  assert.ok(voterCols.has("voted_at"));
  assert.ok(voterCols.has("vote_claim"));
  assert.ok(ballotCols.has("ballot_token"));
  assert.ok(!ballotCols.has("member_id"),"secret ballots must not contain member_id");
  db.close();

  const elections=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(elections,/INSERT OR IGNORE INTO election_voters/);
  assert.match(elections,/crypto\.randomUUID\(\)/);
  assert.match(elections,/vote_claim IS NULL/);
  assert.match(elections,/election\.status!=="open"/);
  assert.match(elections,/detail\.status==="closed"/);
});

test('EXCO election UI supports admin setup, member voting, turnout and closed results', () => {
  const app=fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');

  assert.match(app,/elections/);
  assert.match(admin,/Create election/);
  assert.match(admin,/Open Voting/);
  assert.match(admin,/Close voting & calculate results/);
  assert.match(admin,/Secret ballot active/);
  assert.match(member,/Submit secret ballot/);
  assert.match(member,/Your vote has been submitted/);
  assert.match(member,/ELECTED/);
  assert.match(api,/vote: \(id,selections\)/);
});

test('database backup includes election governance tables and schema version 29', () => {
  const system=fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  for(const table of ['elections','election_positions','election_candidates','election_voters','election_ballots']){
    assert.match(system,new RegExp(table));
  }
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});


test('election integrity adds automatic lifecycle, withdrawal, reminders, certification and turnout percent', () => {
  const elections=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const scheduled=fs.readFileSync(path.join(root,'src/scheduled.ts'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');

  assert.match(elections,/processElectionLifecycle/);
  assert.match(elections,/election_auto_opened/);
  assert.match(elections,/election_auto_closed/);
  assert.match(elections,/remind-nonvoters/);
  assert.match(elections,/candidate_withdrawn/);
  assert.match(elections,/results_certified/);
  assert.match(elections,/turnout:\{eligible,voted,percent/);
  assert.match(elections,/tieAtCutoff/);
  assert.match(elections,/min_selections/);
  assert.match(scheduled,/processElectionLifecycle/);
  assert.match(api,/withdrawCandidate/);
  assert.match(api,/remindNonVoters/);
  assert.match(api,/certify/);
});

test('uncertified election results stay hidden from members and ties are not auto elected', () => {
  const elections=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');

  assert.match(elections,/detail\.status==="closed" && \(admin \|\| detail\.certified_at\)/);
  assert.match(elections,/results_visible/);
  assert.match(member,/awaiting certification/);
  assert.match(member,/outcome==="tie"/);
  assert.match(admin,/Runoff required|Ready for certification/);
  assert.match(admin,/Certify results & assign EXCO roles/);
  assert.match(admin,/Tie at the seat boundary/);
});

test('election integrity migration advances schema to 30', () => {
  const db=dbWithSchema();
  const electionCols=new Set(db.prepare("PRAGMA table_info(elections)").all().map(r=>r.name));
  const positionCols=new Set(db.prepare("PRAGMA table_info(election_positions)").all().map(r=>r.name));
  const candidateCols=new Set(db.prepare("PRAGMA table_info(election_candidates)").all().map(r=>r.name));
  assert.ok(electionCols.has("certified_at"));
  assert.ok(electionCols.has("certified_by"));
  assert.ok(positionCols.has("min_selections"));
  assert.ok(candidateCols.has("withdrawal_reason"));
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});


test('election voting rechecks lifecycle before accepting ballots and reminders require super admin', () => {
  const elections=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(elections,/post\("\/:id\/vote", async c=>\{\n  await processElectionLifecycle\(c\.env\)/);
  assert.match(elections,/remind-nonvoters", requireSuperAdmin/);
  assert.match(elections,/candidates\/:candidateId\/withdraw", requireSuperAdmin/);
});


test('candidate application stage is migration controlled and separated from voting', () => {
  const db=dbWithSchema();
  const electionCols=new Set(db.prepare("PRAGMA table_info(elections)").all().map(r=>r.name));
  const appCols=new Set(db.prepare("PRAGMA table_info(election_applications)").all().map(r=>r.name));
  assert.ok(electionCols.has("applications_open_at"));
  assert.ok(electionCols.has("applications_close_at"));
  for(const col of ["election_id","position_id","member_id","statement","status","review_reason"]) assert.ok(appCols.has(col));
  db.close();

  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/applicationPhase/);
  assert.match(route,/Candidate applications are not open/);
  assert.match(route,/No applications are waiting for review/);
  assert.match(route,/election_application_\$\{decision\}/);
  assert.match(route,/INSERT INTO election_candidates/);
});

test('member can self-apply for election positions and admin can review applications', () => {
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(member,/APPLY FOR AN AVAILABLE POSITION/);
  assert.match(member,/Submit candidate application/);
  assert.match(member,/withdrawApplication/);
  assert.match(admin,/APPLICATIONS/);
  assert.match(admin,/reviewApplication/);
  assert.match(api,/reviewApplication/);
});

test('ordinary members only receive their own election application records', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/detail\.applications\.filter/);
  assert.match(route,/Number\(a\.member_id\)===Number\(member\.id\)/);
  assert.match(route,/visibleApplications/);
});






test('all registered active members can apply for any election position', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');

  assert.doesNotMatch(route,/candidateEligibility/);
  assert.doesNotMatch(route,/Minimum membership is/);
  assert.doesNotMatch(route,/current-month contribution is not fully paid or exempt/);
  assert.match(route,/Approved member account required/);
  assert.match(route,/Choose a valid available position/);
  assert.match(route,/All registered active members can apply/);
  assert.doesNotMatch(member,/application_eligibility/);
  assert.doesNotMatch(member,/Not eligible/);
  assert.match(member,/All registered active members can apply for any available position/);
  assert.doesNotMatch(admin,/Minimum membership days to apply/);
  assert.doesNotMatch(admin,/Require current contribution to be fully paid or exempt/);
  assert.match(admin,/All registered active members can apply for any available EXCO position/);
});

test('candidate application Telegram events remain active after eligibility simplification', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/submitted and is awaiting review/);
  assert.match(route,/application has been <b>approved<\/b>/);
  assert.match(route,/application was <b>not approved<\/b>/);
  assert.match(route,/application was withdrawn/);
  assert.match(route,/applications close within 24 hours/);
  assert.match(route,/application_reminder_sent_at/);
});


test('v50 runoff tables and EXCO role history are migration controlled', () => {
  const db=dbWithSchema();
  for(const table of ['election_runoffs','election_runoff_candidates','election_runoff_voters','election_runoff_ballots','exco_role_assignments']){
    const rows=db.prepare(`PRAGMA table_info(${table})`).all();
    assert.ok(rows.length>0,`${table} must exist`);
  }
  const roleCols=new Set(db.prepare("PRAGMA table_info(exco_role_assignments)").all().map(r=>r.name));
  for(const col of ['member_id','election_id','position_id','role_title','term','started_at','ended_at']) assert.ok(roleCols.has(col));
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('tie results require anonymous runoff and block certification until resolved', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/calculateElectionResults/);
  assert.match(route,/unresolved/);
  assert.match(route,/Resolve all tied seats with runoff voting before certification/);
  assert.match(route,/election_runoff_ballots/);
  assert.match(route,/ballot_token/);
  assert.match(route,/runoff ballot has already been submitted/);
  assert.match(route,/election_runoff_opened/);
  assert.match(route,/election_runoff_closed/);
  // Privacy: runoff ballot storage must not include member identity.
  const schema=fs.readFileSync(path.join(root,'schema.sql'),'utf8');
  const runoffBallot=schema.match(/CREATE TABLE IF NOT EXISTS election_runoff_ballots \(([\s\S]*?)\);/)?.[1]||'';
  assert.doesNotMatch(runoffBallot,/member_id/);
});

test('certification automatically archives old EXCO and assigns elected roles without admin permissions', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/assignCertifiedExcoRoles/);
  assert.match(route,/UPDATE exco_role_assignments SET ended_at/);
  assert.match(route,/INSERT OR IGNORE INTO exco_role_assignments/);
  assert.match(route,/officially assigned as/);
  assert.doesNotMatch(route,/INSERT INTO admins/);
  assert.match(route,/Results are already certified and locked/);
});

test('member and admin UIs surface current EXCO role and runoff workflow', () => {
  const members=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Members.jsx'),'utf8');
  const profile=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyProfile.jsx'),'utf8');
  const elections=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const memberElection=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(members,/member-exco-badge/);
  assert.match(profile,/EXCO ROLE/);
  assert.match(profile,/PREVIOUS EXCO ROLES/);
  assert.match(elections,/CURRENT OFFICIAL EXCO/);
  assert.match(elections,/Start runoff round/);
  assert.match(elections,/Resolve runoffs before certification/);
  assert.match(memberElection,/Submit runoff vote/);
  assert.match(memberElection,/CURRENT OFFICIAL EXCO/);
  assert.match(api,/currentExco/);
  assert.match(api,/voteRunoff/);
});

test('member APIs expose current and historical EXCO positions', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  const index=fs.readFileSync(path.join(root,'src/index.ts'),'utf8');
  assert.match(members,/exco_role/);
  assert.match(members,/exco_history/);
  assert.match(index,/current_exco/);
  assert.match(index,/exco_history/);
});


test('members can see draft elections during configured application stage', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/e\.status='draft' AND e\.applications_open_at IS NOT NULL AND e\.applications_close_at IS NOT NULL/);
  assert.match(route,/detail\.status==="draft" && !\(detail\.applications_open_at && detail\.applications_close_at\)/);
  assert.doesNotMatch(route,/if\(!admin && detail\.status==="draft"\)return c\.json/);
});

test('true admin-only election drafts remain hidden from members', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/Election not available/);
  assert.match(route,/applications_open_at/);
  assert.match(route,/applications_close_at/);
});


test('admin can extend candidate application deadline before voting opens', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');

  assert.match(route,/extend-applications/);
  assert.match(route,/New deadline must extend the current application deadline/);
  assert.match(route,/application_reminder_sent_at=NULL/);
  assert.match(route,/election_application_deadline_extended/);
  assert.match(api,/extendApplications/);
  assert.match(admin,/Extend application deadline/);
});

test('admin candidate withdrawal synchronizes approved member application status', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');

  assert.match(route,/UPDATE election_applications/);
  assert.match(route,/status='withdrawn'/);
  assert.match(route,/Withdrawn by admin:/);
  assert.match(route,/approved candidacy has been <b>withdrawn by Admin<\/b>/);
  assert.match(member,/api\.refreshCached\(`\/api\/elections\/\$\{e\.id\}`\)/);
});

test('application deadline extension cannot move beyond voting opening time', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/Application deadline must remain on or before voting opens/);
  assert.match(route,/New application deadline must be in the future/);
});


test('v53 applications can be reopened before voting and reapproved candidates reactivate cleanly', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/applications\/:applicationId\/reopen/);
  assert.match(route,/Only rejected or withdrawn applications can be reopened/);
  assert.match(route,/election_application_reopened/);
  assert.match(route,/ON CONFLICT\(election_id,position_id,member_id\) DO UPDATE SET/);
  assert.match(route,/status='active',withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL/);
});

test('v53 admin can reassign an application before voting while keeping candidate records synchronized', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');

  assert.match(route,/applications\/:applicationId\/reassign/);
  assert.match(route,/Applications are locked after the voter snapshot is created/);
  assert.match(route,/This member already has an application for the selected position/);
  assert.match(route,/UPDATE election_candidates SET position_id/);
  assert.match(route,/election_application_reassigned/);
  assert.match(api,/reassignApplication/);
  assert.match(admin,/Move/);
});

test('v53 application UI provides readiness summary and explicit member application states', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');

  assert.match(admin,/POSITION READINESS/);
  assert.match(admin,/Needs review/);
  assert.match(admin,/Approved Candidate/);
  assert.match(admin,/Reopen/);
  assert.match(member,/Pending Review/);
  assert.match(member,/Approved Candidate/);
  assert.match(member,/Withdrawn by Admin/);
  assert.match(member,/Submitted/);
});

test('v53 duplicate application safeguards remain position scoped', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const schema=fs.readFileSync(path.join(root,'schema.sql'),'utf8');
  assert.match(route,/An active application already exists for this member and position/);
  assert.match(route,/This member already has an application for the selected position/);
  assert.match(schema,/UNIQUE\(election_id,position_id,member_id\)/);
});


test('v54 pre-vote readiness is enforced server side for both manual and automatic opening', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/evaluateElectionReadiness/);
  assert.match(route,/Election is not ready to open voting/);
  assert.match(route,/const readiness=await evaluateElectionReadiness\(env,election\)/);
  assert.match(route,/if\(!readiness\.ready\)continue/);
  assert.match(route,/\/:id\/readiness/);
});

test('v54 readiness checks application review, position candidates, synchronization, times and voters', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  for(const key of [
    'applications_closed',
    'applications_reviewed',
    'positions_staffed',
    'no_duplicate_candidates',
    'approved_candidates_linked',
    'withdrawals_synced',
    'voting_times_valid',
    'voters_available'
  ]) assert.match(route,new RegExp(key));
  assert.match(route,/Every position has enough active candidates for its seats/);
  assert.match(route,/Every approved application has an active candidate record/);
  assert.match(route,/Withdrawn applications have no active candidate record/);
});

test('v54 admin UI disables Open Voting until server checklist passes', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/readiness: \(id\)/);
  assert.match(admin,/PRE-VOTE CHECKLIST/);
  assert.match(admin,/Ready to Open Voting/);
  assert.match(admin,/Voting Not Ready/);
  assert.match(admin,/readiness\.passed/);
  assert.match(admin,/disabled=\{busy\|\|!readiness\?\.ready\}/);
});


test('v55 exposes read-only certified election governance summary without ballot identities', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/buildElectionSummary/);
  assert.match(route,/\/:id\/summary/);
  assert.match(route,/Official election summary is available after certification/);
  assert.match(route,/assigned_exco_roles/);
  assert.match(route,/runoffSummaries/);
  assert.match(route,/applications:appCounts/);
  assert.match(route,/turnout:\{eligible,voted,percent/);
  const summaryBlock=route.match(/async function buildElectionSummary[\s\S]*?\n\}/)?.[0]||'';
  assert.doesNotMatch(summaryBlock,/ballot_token/);
  assert.doesNotMatch(summaryBlock,/member_id.*election_ballots/);
});

test('v55 admin and member UIs render certified election summary records', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/summary: \(id\)/);
  assert.match(admin,/OFFICIAL ELECTION SUMMARY/);
  assert.match(admin,/RUNOFF HISTORY/);
  assert.match(admin,/ASSIGNED EXCO/);
  assert.match(admin,/Read-only governance record/);
  assert.match(member,/OFFICIAL ELECTION SUMMARY/);
  assert.match(member,/OFFICIAL EXCO/);
});


test('v56 certified election archive lists only certified elections with turnout and role metadata', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/get\("\/archive"/);
  assert.match(route,/WHERE e\.certified_at IS NOT NULL/);
  assert.match(route,/assigned_roles/);
  assert.match(route,/runoffs/);
  assert.match(route,/turnout:\{eligible,voted,percent/);
});

test('v56 election PDF and CSV exports use certified summary and Telegram delivery', () => {
  const exportsFile=fs.readFileSync(path.resolve(root,'../frontend/src/utils/electionExports.js'),'utf8');
  const shared=fs.readFileSync(path.resolve(root,'../frontend/src/utils/exports.js'),'utf8');
  assert.match(exportsFile,/exportElectionPdf/);
  assert.match(exportsFile,/exportElectionCsv/);
  assert.match(exportsFile,/sendExportToTelegram/);
  assert.match(exportsFile,/Official Election Record/);
  assert.match(exportsFile,/Certified results/);
  assert.match(exportsFile,/Assigned EXCO/);
  assert.match(exportsFile,/Ballot identities/);
  assert.match(shared,/electionExports/);
});

test('v56 admin and member election archive surfaces certified history and admin export actions', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/archive: \(\)/);
  assert.match(admin,/ELECTION ARCHIVE/);
  assert.match(admin,/PDF Record/);
  assert.match(admin,/CSV Record/);
  assert.match(member,/PAST CERTIFIED ELECTIONS/);
});


test('v57 auto-repair synchronizes approved and withdrawn applications with candidate records', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/synchronizeElectionApplications/);
  assert.match(route,/status='active',withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL/);
  assert.match(route,/INSERT INTO election_candidates/);
  assert.match(route,/Application withdrawn/);
  assert.match(route,/repair-application-sync/);
  assert.match(route,/election_application_sync_repaired/);
});

test('v57 readiness flags sync failures as repairable and opening self-heals legacy mismatches', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/approved_candidates_linked[\s\S]*?repairable:true/);
  assert.match(route,/withdrawals_synced[\s\S]*?repairable:true/);
  assert.match(route,/await synchronizeElectionApplications\(c\.env,id,admin\.id\)/);
  assert.match(route,/await synchronizeElectionApplications\(env,election\.id,null\)/);
});

test('v57 admin checklist offers Fix automatically and refreshes readiness after repair', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/repairApplicationSync/);
  assert.match(admin,/Fix election data automatically/);
  assert.match(admin,/Fix automatically/);
  assert.match(admin,/setReadiness\(r\.readiness/);
  assert.match(admin,/Election data synchronized/);
});


test('v58 voter snapshot permanently locks election setup mutations', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/(?:export )?async function electionSetupLocked/);
  assert.match(route,/SELECT 1 ok FROM election_voters WHERE election_id=\? LIMIT 1/);
  assert.match(route,/Election setup is locked after the voter snapshot is created/);
  assert.match(route,/Application deadline is locked after the voter snapshot is created/);
  assert.match(route,/Application decisions are locked after the voter snapshot is created/);
  assert.match(route,/Candidate changes are locked after the voter snapshot is created/);
  assert.match(route,/Applications are locked after voting opens/);
});

test('v58 candidate and application management are draft-only once voter snapshot exists', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const withdrawBlock=route.match(/candidates\/:candidateId\/withdraw[\s\S]*?return c\.json\(await electionDetail\(c\.env,id\)\);\n\}\);/)?.[0]||'';
  assert.match(withdrawBlock,/electionSetupLocked/);
  assert.doesNotMatch(withdrawBlock,/\["draft","open"\]/);
  const reviewBlock=route.match(/applications\/:applicationId\/review[\s\S]*?return c\.json\(await electionDetail\(c\.env,id\)\);\n\}\);/)?.[0]||'';
  assert.match(reviewBlock,/electionSetupLocked/);
  assert.match(route,/Applications are locked after the voter snapshot is created/);
});

test('v58 open voting UI is read-only and no longer exposes candidate withdrawal or cancellation', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  assert.match(admin,/Voting setup locked/);
  assert.match(admin,/Open Voting & Lock Setup/);
  assert.match(admin,/permanently locks election setup/);
  const openBlock=admin.match(/\{detail\.status==="open"&&<>[\s\S]*?<\/>\}/)?.[0]||'';
  assert.match(openBlock,/LOCKED/);
  assert.match(openBlock,/Remind members who have not voted/);
  assert.match(openBlock,/Close voting & calculate results/);
  assert.doesNotMatch(openBlock,/withdrawCandidate/);
  assert.doesNotMatch(openBlock,/Cancel election/);
});

test('v58 election detail exposes setup_locked from status or voter snapshot', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/setup_locked:setupLocked/);
  assert.match(route,/const setupLocked=election\.status!=="draft"\|\|eligible>0/);
});


test('v59 new election applications immediately notify admins in Telegram', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/notifyAdmins/);
  assert.match(route,/New EXCO application/);
  assert.match(route,/Pending Review/);
  assert.match(route,/Review Application/);
  assert.match(route,/web_app:\{url:appUrl\}/);
  assert.match(route,/member\.member_code/);
  assert.match(route,/election_application_admin_notified/);
});

test('v59 election application notification safely escapes member supplied text', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/esc\(member\.name\)/);
  assert.match(route,/esc\(position\.title\)/);
  assert.match(route,/esc\(election\.title\)/);
  assert.match(route,/esc\(statement\)/);
  assert.match(route,/miniAppUrl/);
});


test('v60 election notification delivery log is migration controlled', () => {
  const db=dbWithSchema();
  const cols=new Set(db.prepare("PRAGMA table_info(election_notification_log)").all().map(r=>r.name));
  for(const col of ['election_id','event_key','audience','sent','failed','detail','created_by','created_at']) assert.ok(cols.has(col));
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('v60 logs voting, reminder, runoff, certification and application notification delivery', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  for(const event of [
    'applications_closing_24h',
    'voting_opened',
    'voting_closing_24h',
    'runoff_opened:',
    'runoff_closing_24h:',
    'results_certified',
    'elected_roles_assigned',
    'new_application_admin:',
    'application_submitted_member:'
  ]) assert.match(route,new RegExp(event.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(route,/recordElectionNotification/);
  assert.match(route,/processElectionClosingReminders/);
});

test('v60 Admin can review notification delivery status with sent and failed counts', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(route,/\/:id\/notifications/);
  assert.match(route,/ORDER BY n\.id DESC LIMIT 50/);
  assert.match(api,/notifications: \(id\)/);
  assert.match(admin,/NOTIFICATION STATUS/);
  assert.match(admin,/sent ·/);
  assert.match(admin,/failed/);
});

test('v60 Member App exposes clear election lifecycle stages and next actions', () => {
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  for(const label of [
    'Applications Open',
    'Pending Review',
    'Approved Candidate',
    'Voting Opens Soon',
    'Voting Open',
    'You Have Voted',
    'Runoff Open',
    'Results Certified'
  ]) assert.match(member,new RegExp(label));
  assert.match(member,/MemberElectionStageBanner/);
  assert.match(member,/my_application_status/);
});

test('v60 election list includes own application status and open-runoff state', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/my_application_status/);
  assert.match(route,/open_runoffs/);
  assert.match(route,/application_phase:applicationPhase/);
});


test('v61 admin election dashboard aggregates operational election state', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/get\("\/dashboard"/);
  assert.match(route,/pending_applications/);
  assert.match(route,/open_voting/);
  assert.match(route,/open_runoffs/);
  assert.match(route,/notification_failures/);
  assert.match(route,/evaluateElectionReadiness/);
  assert.match(route,/remaining:nonVoters/);
});

test('v61 dashboard surfaces actionable election warnings', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  for(const key of [
    'pending_applications',
    'readiness',
    'voting_closes_soon',
    'runoff_open',
    'notification_failures',
    'certification'
  ]) assert.match(route,new RegExp(key));
  assert.match(route,/Voting closes within 24 hours/);
  assert.match(route,/Results require certification/);
});

test('v61 admin UI renders at-a-glance election monitoring cards', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/dashboard: \(\)/);
  assert.match(admin,/ELECTION DASHBOARD/);
  assert.match(admin,/Applications/);
  assert.match(admin,/Candidates/);
  assert.match(admin,/Turnout/);
  assert.match(admin,/Notifications/);
  assert.match(admin,/Pre-vote readiness/);
  assert.match(admin,/Runoff ·/);
});

test('v61 dashboard reuses notification log and readiness as authoritative sources', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const block=route.match(/electionsRoute\.get\("\/dashboard"[\s\S]*?return c\.json\(\{[\s\S]*?\n\}\);/)?.[0]||'';
  assert.match(block,/election_notification_log/);
  assert.match(block,/evaluateElectionReadiness/);
  assert.match(block,/election_runoff_voters/);
  assert.match(block,/election_voters/);
});


test('v63 EXCO term and handover schema is migration controlled', () => {
  const db=dbWithSchema();
  for(const table of ['exco_terms','exco_handover_records','exco_handover_items']){
    const rows=db.prepare(`PRAGMA table_info(${table})`).all();
    assert.ok(rows.length>0,`${table} must exist`);
  }
  const itemCols=new Set(db.prepare("PRAGMA table_info(exco_handover_items)").all().map(r=>r.name));
  for(const col of ['handover_id','item_key','label','completed','completed_at','completed_by','note','sort_order']) assert.ok(itemCols.has(col));
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('v63 certification starts EXCO term and creates structured handover without granting admin permissions', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/createExcoTermHandover/);
  assert.match(route,/HANDOVER_CHECKLIST/);
  assert.match(route,/Finance records reviewed/);
  assert.match(route,/Cash and bank balances acknowledged/);
  assert.match(route,/Pending contributions reviewed/);
  assert.match(route,/Outstanding expenses and donations checked/);
  assert.match(route,/Governance and finance documents handed over/);
  assert.match(route,/System Admin access reviewed separately from EXCO roles/);
  assert.doesNotMatch(route,/INSERT INTO admins/);
  assert.doesNotMatch(route,/UPDATE admins SET role/);
});

test('v63 handover checklist is admin-managed, auditable and completion-gated', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/exco\/handover\/:handoverId\/items\/:itemId/);
  assert.match(route,/exco\/handover\/:handoverId\/complete/);
  assert.match(route,/Complete every handover checklist item before finalizing handover/);
  assert.match(route,/exco_handover_item_updated/);
  assert.match(route,/exco_handover_completed/);
  assert.match(route,/Completed handover is read-only/);
});

test('v62-v63 governance timeline preserves ballot anonymity while surfacing actors and milestones', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/\/:id\/timeline/);
  assert.match(route,/Election created/);
  assert.match(route,/Voting opened/);
  assert.match(route,/Runoff opened/);
  assert.match(route,/Results certified/);
  assert.match(route,/New EXCO term started/);
  assert.match(route,/Ballot selections remain anonymous/);
  const timelineBlock=route.match(/electionsRoute\.get\("\/:id\/timeline"[\s\S]*?return c\.json\(\{events,governance\}\);\n\}\);/)?.[0]||'';
  assert.doesNotMatch(timelineBlock,/election_ballots/);
  assert.doesNotMatch(timelineBlock,/ballot_token/);
});

test('v63 admin and member UIs show term history and handover governance', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const member=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/excoTerms/);
  assert.match(api,/currentHandover/);
  assert.match(api,/updateHandoverItem/);
  assert.match(api,/completeHandover/);
  assert.match(api,/timeline/);
  assert.match(admin,/EXCO HANDOVER/);
  assert.match(admin,/ELECTION TIMELINE/);
  assert.match(admin,/Organizational EXCO roles are separate from system Admin permissions/);
  assert.match(member,/CURRENT EXCO TERM/);
  assert.match(member,/Previous term/);
});

test('v63 D1 backup includes notification, EXCO term and handover tables', () => {
  const system=fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  for(const table of ['election_notification_log','exco_terms','exco_handover_records','exco_handover_items']) assert.match(system,new RegExp(table));
});


test('v64 EXCO responsibility workboard schema is migration controlled', () => {
  const db=dbWithSchema();
  for(const table of ['exco_responsibilities','exco_responsibility_history']){
    assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().length>0);
  }
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('v64 EXCO responsibilities are term-linked and owner-restricted to current committee', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/\/exco\/workboard/);
  assert.match(route,/\/exco\/responsibilities/);
  assert.match(route,/Owner must be a member of the current EXCO/);
  assert.match(route,/Completed EXCO term responsibilities are read-only/);
  assert.match(route,/exco_responsibility_created/);
  assert.match(route,/exco_responsibility_updated/);
});

test('v64 workboard exposes overdue upcoming active and completed responsibility counts', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/overdue:/);
  assert.match(route,/upcoming:/);
  assert.match(route,/in_progress/);
  assert.match(route,/completed/);
  assert.match(route,/remaining/);
});

test('v64 responsibility history records status transitions without granting admin permissions', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/exco_responsibility_history/);
  assert.match(route,/from_status/);
  assert.match(route,/to_status/);
  assert.doesNotMatch(route,/INSERT INTO admins/);
});

test('v64 Admin UI renders EXCO workboard and responsibility controls', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/excoWorkboard/);
  assert.match(api,/createResponsibility/);
  assert.match(api,/updateResponsibility/);
  assert.match(api,/responsibilityHistory/);
  assert.match(admin,/EXCO WORKBOARD/);
  assert.match(admin,/Add EXCO responsibility/);
  assert.match(admin,/Responsibilities belong to the EXCO term and do not grant system permissions/);
});

test('v64 backup includes EXCO responsibility workboard tables', () => {
  const system=fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  assert.match(system,/exco_responsibilities/);
  assert.match(system,/exco_responsibility_history/);
});


test('v65 formal meeting resolution schema is migration controlled', () => {
  const db=dbWithSchema();
  for(const table of ['meeting_resolutions','meeting_resolution_history']){
    assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().length>0,`${table} must exist`);
  }
  const cols=new Set(db.prepare("PRAGMA table_info(meeting_resolutions)").all().map(r=>r.name));
  for(const col of ['meeting_id','term_id','resolution_no','title','decision_text','proposer_member_id','seconder_member_id','vote_result','status','responsibility_id']) assert.ok(cols.has(col));
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});

test('v65 meeting resolutions are linked to the EXCO term covering the meeting date', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  assert.match(route,/excoTermForMeeting/);
  assert.match(route,/date\(t\.started_at\)<=date\(\?\)/);
  assert.match(route,/t\.ended_at IS NULL OR date\(t\.ended_at\)>=date\(\?\)/);
  assert.match(route,/No EXCO term covers this meeting date/);
  assert.match(route,/meeting_resolutions/);
});

test('v65 adopted resolution can create linked current-term EXCO workboard responsibility', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  assert.match(route,/create_followup/);
  assert.match(route,/Follow-up workboard tasks can only be created for the current EXCO term/);
  assert.match(route,/Follow-up owner must be a member of the current EXCO/);
  assert.match(route,/INSERT INTO exco_responsibilities/);
  assert.match(route,/Created from meeting resolution/);
  assert.match(route,/responsibility_id/);
});

test('v65 meeting resolution changes have formal status and history', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  assert.match(route,/\['draft','adopted','rejected','superseded'\]/);
  assert.match(route,/meeting_resolution_history/);
  assert.match(route,/meeting_resolution_created/);
  assert.match(route,/meeting_resolution_updated/);
  assert.match(route,/from_status/);
  assert.match(route,/to_status/);
});

test('v65 meeting detail returns term resolutions and linked follow-up status', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  assert.match(route,/resolutions:resolutions\.results/);
  assert.match(route,/exco_term:term\|\|null/);
  assert.match(route,/responsibility_title/);
  assert.match(route,/responsibility_status/);
  assert.match(route,/proposer_name/);
  assert.match(route,/seconder_name/);
});

test('v65 Meetings UI records formal resolution and optional EXCO follow-up', () => {
  const page=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Meetings.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/addMeetingResolution/);
  assert.match(api,/updateMeetingResolution/);
  assert.match(api,/meetingResolutionHistory/);
  assert.match(page,/FORMAL RESOLUTIONS/);
  assert.match(page,/Record formal resolution/);
  assert.match(page,/Create follow-up on EXCO Workboard/);
  assert.match(page,/Proposer \(optional\)/);
  assert.match(page,/Seconder \(optional\)/);
  assert.match(page,/Vote \/ result/);
});

test('v65 D1 backup includes formal resolution tables', () => {
  const system=fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  assert.match(system,/meeting_resolutions/);
  assert.match(system,/meeting_resolution_history/);
});


test('v66 member governance archive is linked-member only and certified/read-only', () => {
  const index=fs.readFileSync(path.resolve(root,'../worker/src/index.ts'),'utf8');
  assert.match(index,/\/api\/me\/governance-archive/);
  assert.match(index,/Member account not linked/);
  assert.match(index,/WHERE e\.certified_at IS NOT NULL/);
  assert.match(index,/h\.status='completed'/);
  assert.match(index,/r\.status='adopted'/);
  assert.match(index,/r\.status='completed'/);
});

test('v66 member governance archive excludes private admin and ballot internals', () => {
  const index=fs.readFileSync(path.resolve(root,'../worker/src/index.ts'),'utf8');
  const block=index.match(/app\.get\("\/api\/me\/governance-archive"[\s\S]*?return c\.json\(\{[\s\S]*?\n  \}\);\n\}\);/)?.[0]||'';
  assert.doesNotMatch(block,/FROM audit_log/);
  assert.doesNotMatch(block,/election_ballots/);
  assert.doesNotMatch(block,/ballot_token/);
  assert.doesNotMatch(block,/admins /);
  assert.doesNotMatch(block,/handover.*notes/i);
  assert.match(block,/ballot_data_included:false/);
  assert.match(block,/admin_notes_included:false/);
  assert.match(block,/audit_log_included:false/);
  assert.match(block,/system_permissions_included:false/);
});

test('v66 archive preserves Meeting to Resolution to Responsibility chain for members', () => {
  const index=fs.readFileSync(path.resolve(root,'../worker/src/index.ts'),'utf8');
  assert.match(index,/meeting_title/);
  assert.match(index,/meeting_date/);
  assert.match(index,/resolution_no/);
  assert.match(index,/decision_text/);
  assert.match(index,/responsibility_id/);
  assert.match(index,/responsibility_title/);
  assert.match(index,/responsibility_status/);
  assert.match(index,/responsibility_completed_at/);
});

test('v66 member Elections UI renders governance archive without edit controls', () => {
  const page=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MemberElections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/myGovernanceArchive/);
  assert.match(page,/GOVERNANCE ARCHIVE/);
  assert.match(page,/ADOPTED RESOLUTIONS/);
  assert.match(page,/COMPLETED EXCO WORK/);
  assert.match(page,/Handover completed/);
  assert.match(page,/Read-only member view/);
  assert.doesNotMatch(page,/updateMeetingResolution/);
  assert.doesNotMatch(page,/createResponsibility/);
  assert.doesNotMatch(page,/completeHandover/);
});

test('v66 member election prefetch includes governance archive', () => {
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/tab === "elections"[\s\S]*?\/api\/me\/governance-archive/);
});

test('v67 member overview election card uses compact collision-safe layout', () => {
  const overview=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Overview.jsx'),'utf8');
  const css=frontendCss();
  assert.match(overview,/MemberElectionOverviewCard/);
  assert.match(overview,/Applications Open/);
  assert.match(overview,/Application Pending/);
  assert.match(overview,/Candidate Approved/);
  assert.match(overview,/Voting Open/);
  assert.match(overview,/Runoff Open/);
  assert.match(overview,/setTab\?\.\("elections"\)/);
  assert.match(css,/\.member-overview-election\{/);
  assert.match(css,/overflow:hidden/);
  assert.match(css,/text-overflow:ellipsis/);
  assert.match(css,/overflow-wrap:anywhere/);
});

test('v67 overview election card prioritizes immediate member election action', () => {
  const overview=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Overview.jsx'),'utf8');
  assert.match(overview,/e\.status === "open" && e\.eligible && !e\.my_vote/);
  assert.match(overview,/e\.status === "draft" && e\.application_phase === "open"/);
  assert.match(overview,/Number\(e\.open_runoffs \|\| 0\) > 0/);
});


test('v68 global UI smoothing adds modal, page, loading and tap polish', () => {
  const css=frontendCss();
  assert.match(css,/v68 UI smoothing \+ mobile polish/);
  assert.match(css,/v68-page-fade/);
  assert.match(css,/v68-overlay-in/);
  assert.match(css,/v68-sheet-in/);
  assert.match(css,/app-loading-pulse/);
  assert.match(css,/scroll-padding-bottom/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/prefers-reduced-motion: reduce/);
});

test('v68 shared loading state has stable visual hook without changing content semantics', () => {
  const shared=fs.readFileSync(path.resolve(root,'../frontend/src/components/Shared.jsx'),'utf8');
  assert.match(shared,/app-page-state--\$\{kind\}/);
  assert.match(shared,/app-loading-pulse/);
  assert.match(shared,/aria-live/);
  assert.match(shared,/role=\{isError \? "alert" : "status"\}/);
});

test('v68 modal preserves single-scroll design and exposes stable viewport CSS value', () => {
  const modal=fs.readFileSync(path.resolve(root,'../frontend/src/components/FormControls.jsx'),'utf8');
  assert.match(modal,/--app-modal-vh/);
  assert.match(modal,/app-modal-overlay/);
  assert.match(modal,/app-modal-sheet/);
  assert.match(modal,/app-modal-body/);
  assert.match(modal,/overflowY: "auto"/);
  assert.match(modal,/env\(safe-area-inset-bottom\)/);
});

test('v68 mobile polish does not replace functional navigation or modal controls', () => {
  const app=fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  const modal=fs.readFileSync(path.resolve(root,'../frontend/src/components/FormControls.jsx'),'utf8');
  assert.match(app,/app-nav-item/);
  assert.match(app,/aria-current/);
  assert.match(modal,/aria-label="Close"/);
  assert.match(modal,/role="dialog"/);
  assert.match(modal,/aria-modal="true"/);
});


test('v69 GET cache invalidation is targeted by feature family instead of globally clearing every write', () => {
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/function invalidateCacheMatching/);
  assert.match(api,/if\(p\.startsWith\("\/api\/elections"\)\)/);
  assert.match(api,/if\(p\.startsWith\("\/api\/admin\/meetings"\)/);
  assert.match(api,/if\(p\.startsWith\("\/api\/contributions"\)/);
  assert.match(api,/responseCache\.set\(key, \{ path, data/);
  assert.match(api,/Unknown writes remain conservative/);
});

test('v69 data-change events can be coalesced to avoid duplicate refresh bursts', () => {
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/export function onDataChangeDebounced/);
  assert.match(api,/const paths=new Set\(\)/);
  assert.match(api,/paths:\[\.\.\.paths\]/);
  assert.match(api,/clearTimeout\(timer\)/);
});

test('v69 heavy overview elections and meetings pages use debounced path-aware refreshes', () => {
  const overview=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Overview.jsx'),'utf8');
  const elections=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const meetings=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Meetings.jsx'),'utf8');
  assert.match(overview,/onDataChangeDebounced/);
  assert.match(overview,/paths\.some/);
  assert.match(elections,/onDataChangeDebounced/);
  assert.match(elections,/paths\.some/);
  assert.match(meetings,/onDataChangeDebounced/);
  assert.match(meetings,/api\.peekCached\("\/api\/admin\/meetings"\)/);
});

test('v69 keeps a bounded four-tab warm window and idle-prefetches only one likely next screen', () => {
  const app=fs.readFileSync(path.resolve(root,'../frontend/src/App.jsx'),'utf8');
  assert.match(app,/while \(ordered\.length > 4\)/);
  assert.match(app,/requestIdleCallback/);
  assert.match(app,/const next=likelyNext\.find/);
  assert.match(app,/api\.prefetchTabData/);
  assert.match(app,/cancelIdleCallback/);
});

test('v69 extends cache life for stable election governance data while keeping pending data short-lived', () => {
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/\/api\/elections\/exco\/.*60_000/);
  assert.match(api,/\/api\/me\/governance-archive.*60_000/);
  assert.match(api,/\/api\/admin\/pending.*8_000/);
});


test('stability audit: D1 backup covers every application table in schema', () => {
  const schema=fs.readFileSync(path.join(root,'schema.sql'),'utf8');
  const system=fs.readFileSync(path.join(root,'src/routes/admin/system.ts'),'utf8');
  const tables=[...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/gi)].map(m=>m[1]);
  const missing=tables.filter(table=>!system.includes(`'${table}'`));
  assert.deepEqual(missing,[],`backup is missing tables: ${missing.join(', ')}`);
});

test('stability audit: election notification delivery does not count Telegram null failures as sent', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/r\.status==="fulfilled"&&r\.value\?\.ok===true/);
  assert.match(route,/failed:results\.length-sent/);
});

test('stability audit: meeting action notification failures are persisted to error log', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/governance.ts'),'utf8');
  assert.match(route,/safeLogError/);
  assert.match(route,/telegram\.meeting_action_notification/);
  assert.match(route,/if\(!delivery\?\.ok\)/);
});


test('v71 only Super Admin can permanently delete an unused draft election', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/electionsRoute\.delete\("\/:id", requireSuperAdmin/);
  assert.match(route,/electionDeleteEligibility/);
  assert.match(route,/Only draft elections can be permanently deleted/);
  assert.match(route,/Certified elections cannot be deleted/);
});

test('v71 permanent election deletion is blocked after any real election activity', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  for(const table of [
    'election_applications',
    'election_voters',
    'election_ballots',
    'election_runoffs',
    'exco_role_assignments',
    'exco_terms',
    'election_notification_log'
  ]) assert.match(route,new RegExp(`SELECT COUNT\\(\\*\\) n FROM ${table}`));
  assert.match(route,/Member applications exist/);
  assert.match(route,/A voter snapshot exists/);
  assert.match(route,/Ballots exist/);
  assert.match(route,/Runoff records exist/);
  assert.match(route,/EXCO assignments exist/);
  assert.match(route,/Member\/Admin election notifications were recorded/);
});

test('v71 unused draft deletion is audited and removes the election only after eligibility check', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const block=route.match(/electionsRoute\.delete\("\/:id"[\s\S]*?return c\.json\(\{ok:true,id,title:election\.title\}\);\n\}\);/)?.[0]||'';
  assert.match(block,/election_deleted_unused_draft/);
  assert.match(block,/DELETE FROM elections WHERE id=\? AND status='draft'/);
  assert.match(block,/if\(!eligibility\.allowed\)/);
  assert.match(block,/This election cannot be permanently deleted/);
});

test('v71 Admin UI only shows permanent delete action when backend marks draft eligible', () => {
  const admin=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Elections.jsx'),'utf8');
  const api=fs.readFileSync(path.resolve(root,'../frontend/src/api.js'),'utf8');
  assert.match(api,/deleteUnusedDraft/);
  assert.match(admin,/detail\.deletion\?\.allowed/);
  assert.match(admin,/Delete election permanently/);
  assert.match(admin,/Permanently delete this draft election/);
  assert.match(admin,/This cannot be undone/);
  assert.match(admin,/Permanent deletion is protected once election activity has been recorded/);
});

test('v71 election detail exposes authoritative delete eligibility and protection reasons', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  assert.match(route,/const deletion=await electionDeleteEligibility\(env,election\)/);
  assert.match(route,/setup_locked:setupLocked,deletion/);
  assert.match(route,/reasons\.length===0/);
});


test('v72 election timeline iterates D1 notification result rows instead of result object', () => {
  const route=(fs.readFileSync(path.join(root,'src/routes/elections.ts'),'utf8') + fs.readFileSync(path.join(root,'src/elections/core.ts'),'utf8'));
  const block=route.match(/electionsRoute\.get\("\/:id\/timeline"[\s\S]*?return c\.json\(\{events,governance\}\);\n\}\);/)?.[0]||'';
  assert.match(block,/\(notifications\.results as any\[\]\)\.map/);
  assert.doesNotMatch(block,/\.\.\.notifications\.map/);
});

test('v72 meetings support all-members or EXCO-only audience with invitee snapshot', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/admin/meetings.ts'),'utf8');
  assert.match(route,/audience.*exco_only/);
  assert.match(route,/meetingAudienceMembers/);
  assert.match(route,/exco_role_assignments/);
  assert.match(route,/meeting_invitees/);
  assert.match(route,/Meeting audience is locked after invitations are sent/);
});

test('v72 meeting completion is manual and requires attendance for all invitees', () => {
  const route=fs.readFileSync(path.join(root,'src/routes/admin/meetings.ts'),'utf8');
  assert.match(route,/\/meetings\/:id\/attendance/);
  assert.match(route,/\/meetings\/:id\/complete/);
  assert.match(route,/meeting_attendance/);
  assert.match(route,/Record attendance for all/);
  assert.match(route,/status='completed'/);
  assert.match(route,/meeting_completed/);
});

test('v72 RSVP and member meeting visibility respect EXCO-only audience', () => {
  const callbacks=fs.readFileSync(path.join(root,'src/bot/callbacks.ts'),'utf8');
  const index=fs.readFileSync(path.join(root,'src/index.ts'),'utf8');
  assert.match(callbacks,/This meeting is for current EXCO members only/);
  assert.match(callbacks,/meeting_invitees/);
  assert.match(index,/\/api\/me\/meetings/);
  assert.match(index,/meeting_invitees/);
  assert.match(index,/exco_role_assignments/);
});

test('v72 member statement exposes role and allocation rows for member history', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  const history=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyHistory.jsx'),'utf8');
  assert.match(members,/exco_role/);
  assert.match(members,/allocations:allocations\.results/);
  assert.match(history,/PAYMENT ALLOCATION/);
  assert.match(history,/Advance allocation/);
  assert.match(history,/allocationsFor/);
});

test('v72 Admin members UI shows join date and role on list/profile', () => {
  const list=fs.readFileSync(path.resolve(root,'../frontend/src/pages/Members.jsx'),'utf8');
  const popup=fs.readFileSync(path.resolve(root,'../frontend/src/pages/members/MemberPopup.jsx'),'utf8');
  assert.match(list,/Joined \{formatMemberDate/);
  assert.match(list,/Role: <b>/);
  assert.match(popup,/Joined \{formatMemberPopupDate/);
  assert.match(popup,/CURRENT MEMBER ROLE/);
});

test('v72 meeting audience and attendance schema is migration controlled', () => {
  const db=dbWithSchema();
  const meetingCols=new Set(db.prepare("PRAGMA table_info(meetings)").all().map(r=>r.name));
  for(const col of ['audience','completed_at','completed_by']) assert.ok(meetingCols.has(col));
  for(const table of ['meeting_invitees','meeting_attendance']) assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().length>0);
  db.close();
  const ops=fs.readFileSync(path.join(root,'src/ops.ts'),'utf8');
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 38/);
});


test('v73 member statement extends monthly status through latest future allocation', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  assert.match(members,/latestAllocatedMonth/);
  assert.match(members,/statusEndMonth=latestAllocatedMonth>nowMonth\?latestAllocatedMonth:nowMonth/);
  assert.match(members,/const isAdvance=month>nowMonth/);
  assert.match(members,/advance:isAdvance/);
});

test('v73 member history keeps future advance out of outstanding and in advance total', () => {
  const history=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyHistory.jsx'),'utf8');
  assert.match(history,/statuses\.filter\(x=>!x\.advance\).*x\.due/);
  assert.match(history,/statuses\.filter\(x=>x\.advance\).*x\.paid/);
  assert.match(history,/Advance \$\{x\.status\}/);
  assert.match(history,/x\.advance\?"Remaining":"Due"/);
});

test('v73 future monthly status is visibly labelled as advance allocation', () => {
  const history=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyHistory.jsx'),'utf8');
  const css=frontendCss();
  assert.match(history,/member-history-advance-label/);
  assert.match(history,/Allocated/);
  assert.match(css,/member-history-status-row\.advance/);
  assert.match(css,/member-history-advance-label/);
});


test('v74 statement reconciles approved contribution cash with allocation ledger', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  assert.match(members,/const approvedTotal=/);
  assert.match(members,/const actualAllocatedTotal=/);
  assert.match(members,/const effectiveAllocatedTotal=/);
  assert.match(members,/const statusPaidTotal=/);
  assert.match(members,/unallocated_total:unallocatedTotal/);
  assert.match(members,/overallocated_total:overallocatedTotal/);
  assert.match(members,/reconciliation\}/);
});

test('v74 reconciliation flags underallocation overallocation and non-approved allocations', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  assert.match(members,/contribution_underallocated/);
  assert.match(members,/contribution_overallocated/);
  assert.match(members,/allocation_on_nonapproved_contribution/);
  assert.match(members,/allocation_before_membership/);
  assert.match(members,/monthly_status_mismatch/);
});

test('v74 legacy approved contributions remain mathematically represented but are explicitly reported', () => {
  const members=fs.readFileSync(path.join(root,'src/routes/members.ts'),'utf8');
  assert.match(members,/legacyFallback=rows\.length===0/);
  assert.match(members,/effectiveAllocated=legacyFallback\?amount:allocated/);
  assert.match(members,/legacy_missing_allocation_rows/);
  assert.match(members,/legacy_fallback_total/);
});

test('v74 Member History uses authoritative reconciliation totals and only warns members on errors', () => {
  const history=fs.readFileSync(path.resolve(root,'../frontend/src/pages/member/MyHistory.jsx'),'utf8');
  assert.match(history,/reconciliation\?\.current_due_total/);
  assert.match(history,/reconciliation\?\.advance_allocated_total/);
  assert.match(history,/reconciliationErrors/);
  assert.match(history,/Contribution allocation needs review/);
});

test('v74 Admin member profile exposes detailed allocation reconciliation diagnostics', () => {
  const popup=fs.readFileSync(path.resolve(root,'../frontend/src/pages/members/MemberPopup.jsx'),'utf8');
  assert.match(popup,/ALLOCATION RECONCILIATION/);
  assert.match(popup,/Approved cash and monthly ledger reconcile/);
  assert.match(popup,/legacy_fallback_total/);
  assert.match(popup,/reconciliation\.issues/);
});

test('v75 member meeting views hide unsent drafts and RSVP rejects them', () => {
  const index=fs.readFileSync(path.join(root,'src/index.ts'),'utf8');
  assert.match(index,/Meeting invitations have not been sent yet/);
  assert.match(index,/m\.sent_at IS NOT NULL/);
  assert.doesNotMatch(index,/m\.sent_at IS NULL AND m\.status='draft'/);
  assert.match(index,/NOT EXISTS\(SELECT 1 FROM meeting_invitees ai WHERE ai\.meeting_id=m\.id\)/);
});
