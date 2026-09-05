import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');

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
  const memberData = fs.readFileSync(path.resolve(root,'../frontend/src/pages/members/useMembersData.js'),'utf8');
  const reportData = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/useReportsData.js'),'utf8');
  const monthUtil = fs.readFileSync(path.resolve(root,'../frontend/src/utils/adminReportMonth.js'),'utf8');
  const projects = fs.readFileSync(path.resolve(root,'../frontend/src/pages/Projects.jsx'),'utf8');
  const reportSections = fs.readFileSync(path.resolve(root,'../frontend/src/pages/reports/ReportSections.jsx'),'utf8');
  const settingsSections = fs.readFileSync(path.resolve(root,'../frontend/src/pages/settings/SettingsSections.jsx'),'utf8');

  assert.match(memberData,/getAdminReportMonth/);
  assert.match(memberData,/saveAdminReportMonth/);
  assert.match(reportData,/getAdminReportMonth/);
  assert.match(reportData,/saveAdminReportMonth/);
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
