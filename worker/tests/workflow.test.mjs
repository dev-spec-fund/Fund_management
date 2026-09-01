import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("production auth requires explicit local dev flag", () => {
  const auth=read("src/auth.ts");
  assert.match(auth,/DEV_AUTH_ENABLED/);
  assert.doesNotMatch(auth,/if \(!initData && localDevHost\) return useLocalDevAuth/);
});

test("member activity has privacy-safe branch", () => {
  const reports=read("src/routes/reports.ts");
  assert.match(reports,/Member contribution/);
  assert.match(reports,/if \(!admin\)/);
});

test("backup contains contribution allocations and meetings", () => {
  const admin=read("src/routes/admin.ts");
  assert.match(admin,/contribution_allocations/);
  assert.match(admin,/meeting_rsvps/);
  assert.match(admin,/schema_migrations/);
});

test("allocation planner prefetches future state", () => {
  const allocations=read("src/allocations.ts");
  assert.match(allocations,/Promise\.all/);
  assert.match(allocations,/paidMap/);
});

test("schema version is current", () => {
  const ops=read("src/ops.ts");
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 16/);
});

test("demotion preserves member record and removes admin access only", () => {
  const settings=read("src/routes/settings.ts");
  assert.match(settings,/demote-member/);
  assert.match(settings,/UPDATE admins[\s\S]*active=0/);
  assert.match(settings,/At least one active Super Admin must remain/);
});

test("duplicate slips require reference amount and date match", () => {
  const ops=read("src/ops.ts");
  assert.match(ops,/normalizeRef/);
  assert.match(ops,/ABS\(amount-\?\)/);
  assert.match(ops,/bank_date/);
});

test("high-value expense approval prevents self approval", () => {
  const expenses=read("src/routes/expenses.ts");
  assert.match(expenses,/different admin|own expense|logged_by/i);
});

test("normalized duplicate member indexes are migration controlled", () => {
  const migration=read("migrations/0010_performance_and_normalized_members.sql");
  assert.match(migration,/idx_members_normalized_name/);
  assert.match(migration,/idx_members_normalized_phone/);
});

test("bulk Telegram sender has bounded concurrency", () => {
  const telegram=read("src/telegram.ts");
  assert.match(telegram,/sendInBatches/);
  assert.match(telegram,/Math\.min\(10, concurrency\)/);
});


test("Telegram registration captures the requesting user phone before approval", () => {
  const bot=read("src/bot.ts");
  const schema=read("migrations/0012_registration_phone_capture.sql");
  assert.match(bot,/request_contact:\s*true/);
  assert.match(bot,/message\.contact/);
  assert.match(bot,/contact\.user_id/);
  assert.match(schema,/ADD COLUMN phone TEXT/);
});


test("governance reporting migration is present", () => {
  const migration = read("migrations/0013_governance_reporting.sql");
  assert.match(migration,/CREATE TABLE IF NOT EXISTS monthly_snapshots/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS financial_reversals/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS meeting_minutes/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS meeting_action_items/);
});


test("financial integrity v14 removes legacy close bypass and adds expense dates", () => {
  const admin=read("src/routes/admin.ts");
  const expenses=read("src/routes/expenses.ts");
  const governance=read("src/routes/governance.ts");
  const migration=read("migrations/0014_expense_dates_and_financial_integrity.sql");
  assert.doesNotMatch(admin,/adminRoute\.post\('\/month-close\/:month'/);
  assert.match(expenses,/requireOpenMonth\(c\.env,originalMonth\)/);
  assert.match(expenses,/expense_date/);
  assert.match(governance,/source:'snapshot'/);
  assert.match(migration,/ADD COLUMN expense_date TEXT/);
});

test('member app v15 adds rate history and self-service endpoints', () => {
  const migration = read('migrations/0015_member_contribution_rates.sql');
  const index = read('src/index.ts');
  const members = read('src/routes/members.ts');
  const bot = read('src/bot.ts');
  assert.match(migration,/member_contribution_rates/);
  assert.match(index,/\/api\/me\/dashboard/);
  assert.match(index,/\/api\/me\/meetings/);
  assert.match(index,/\/api\/me\/actions/);
  assert.match(members,/contribution-rates/);
  assert.match(bot,/paidForMonth\(env, member\.id, month\)/);
});


test('organization branding settings are migration controlled', () => {
  const migration = read('migrations/0016_organization_branding_settings.sql');
  const settings = read('src/routes/settings.ts');
  const db = read('src/db.ts');
  assert.match(migration, /short_name/);
  assert.match(settings, /fund_name.*short_name|short_name.*fund_name/s);
  assert.match(db, /getBranding/);
});
