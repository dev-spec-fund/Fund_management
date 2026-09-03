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
