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
  const system=read("src/routes/admin/system.ts");
  assert.match(system,/contribution_allocations/);
  assert.match(system,/expense_documents/);
  assert.match(system,/meeting_rsvps/);
  assert.match(system,/schema_migrations/);
});

test("allocation planner prefetches future state", () => {
  const allocations=read("src/allocations.ts");
  assert.match(allocations,/Promise\.all/);
  assert.match(allocations,/paidMap/);
});

test("schema version is current", () => {
  const ops=read("src/ops.ts");
  assert.match(ops,/REQUIRED_SCHEMA_VERSION = 31/);
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
  const bot=[read("src/bot.ts"),read("src/bot/message.ts"),read("src/bot/slips.ts"),read("src/bot/callbacks.ts"),read("src/botSupport.ts")].join("\n");
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
  assert.doesNotMatch(admin,/adminRoute\.(get|post|delete)\('\/month-close/);
  assert.match(governance,/governanceRoute\.get\('\/month-close'/);
  assert.match(governance,/governanceRoute\.delete\('\/month-close\/:month'/);
  assert.match(expenses,/requireOpenMonth\(c\.env,originalMonth\)/);
  assert.match(expenses,/expense_date/);
  assert.match(governance,/source:'snapshot'/);
  assert.match(migration,/ADD COLUMN expense_date TEXT/);
});

test('member app v15 adds rate history and self-service endpoints', () => {
  const migration = read('migrations/0015_member_contribution_rates.sql');
  const index = read('src/index.ts');
  const members = read('src/routes/members.ts');
  const bot = [read('src/bot.ts'),read('src/bot/message.ts'),read('src/bot/slips.ts'),read('src/bot/callbacks.ts')].join('\n');
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


test("community projects and fund-protection migration exists", () => {
  const migration = read('migrations/0017_community_projects_and_fund_protection.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS projects/);
  assert.match(migration,/ADD COLUMN project_id/);
  assert.match(migration,/ADD COLUMN fund_override/);
  assert.match(migration,/VALUES\(17,'community_projects_and_fund_protection'\)/);
});

test("project lifecycle keeps read-only controls and distinct audit actions", () => {
  const projects = read('src/routes/projects.ts');
  assert.match(projects,/project_completed/);
  assert.match(projects,/project_cancelled/);
  assert.match(projects,/project_reopened/);
  assert.match(projects,/Only Super Admin can edit or reopen a completed\/cancelled project/);
  assert.match(projects,/audit_history/);
});

test('member community-project view exposes approved spending only and is admin-toggleable', () => {
  const index = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/routes/settings.ts', import.meta.url), 'utf8');
  assert.match(index, /\/api\/me\/projects/);
  assert.match(index, /show_projects_to_members/);
  assert.match(index, /e\.status='approved'/);
  assert.match(index, /p\.status IN \('active','completed'\)/);
  assert.doesNotMatch(index, /fund_override_reason/);
  assert.match(settings, /show_projects_to_members/);
});


test("expense documents use Telegram file references", () => {
  const migration = read("migrations/0018_expense_documents_telegram.sql");
  const expenses = read("src/routes/expenses.ts");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS expense_documents/);
  assert.match(migration, /telegram_file_id TEXT NOT NULL/);
  assert.match(expenses, /sendDocument\(c\.env,admin\.telegram_id/);
  assert.match(expenses, /downloadTelegramFile/);
  assert.match(expenses, /sendStoredDocument/);
});

test("approved contributions retain and expose the original Telegram payment slip", () => {
  const allocations = read("src/allocations.ts");
  const members = read("src/routes/members.ts");
  assert.match(allocations, /UPDATE contributions SET status='approved'.*ocr_raw=NULL/s);
  assert.doesNotMatch(allocations, /slip_file_id\s*=\s*NULL/);
  assert.match(members, /has_slip/);
  assert.match(members, /\/contributions\/:contributionId\/slip\/file/);
  assert.match(members, /downloadTelegramFile/);
  assert.match(members, /\/contributions\/:contributionId\/slip\/send-to-telegram/);
  assert.match(members, /sendPhoto/);
});


test("OCR reference parser stays on the labelled line and rejects unsafe references", () => {
  const telegram = read("src/telegram.ts");
  assert.match(telegram, /SAME line as a reference label/);
  assert.match(telegram, /referenceLooksSuspicious/);
  assert.match(telegram, /13,/);
  assert.match(telegram, /If uncertain, return null/);
});


test("contribution slip preview stays inside the Mini App instead of opening a blob tab", () => {
  const members = read("../frontend/src/pages/Members.jsx") + read("../frontend/src/pages/members/MemberPopup.jsx");
  assert.match(members, /slipPreview/);
  assert.match(members, /<img/);
  assert.doesNotMatch(members, /a\.target="_blank".*payment-slip/);
});


test("Telegram slip downloads normalize image MIME from file signatures", () => {
  const telegram = read("src/telegram.ts");
  assert.match(telegram, /detectedFileMime/);
  assert.match(telegram, /0xff.*0xd8.*0xff/);
  assert.match(telegram, /image\/jpeg/);
  assert.match(telegram, /application\/octet-stream/);
});


test("expense documents preview inside the Mini App and prefer detected MIME", () => {
  const expensesUi = read("../frontend/src/pages/Expenses.jsx") + read("../frontend/src/pages/expenses/ExpenseDetails.jsx");
  const expensesRoute = read("src/routes/expenses.ts");
  assert.match(expensesUi, /docPreview/);
  assert.match(expensesUi, /<img/);
  assert.match(expensesUi, /openPdfDocument/);
  assert.match(expensesUi, /navigator\.share/);
  assert.doesNotMatch(expensesUi, /<iframe/);
  assert.doesNotMatch(expensesUi, /a\.target="_blank".*original_filename/);
  assert.match(expensesRoute, /responseMime/);
  assert.match(expensesRoute, /detectedMime/);
});


test("expense PDF preview uses PDF.js canvas viewer with page and zoom controls", () => {
  const expensesUi = read("../frontend/src/pages/Expenses.jsx") + read("../frontend/src/pages/expenses/ExpenseDetails.jsx");
  const pdfPreview = read("../frontend/src/components/PdfPreview.jsx");
  const packageJson = read("../frontend/package.json");
  assert.match(expensesUi, /<PdfPreview/);
  assert.match(pdfPreview, /pdfjs-dist/);
  assert.match(pdfPreview, /getDocument/);
  assert.match(pdfPreview, /<canvas/);
  assert.match(pdfPreview, /Page \$\{page\} of \$\{pages\}/);
  assert.match(pdfPreview, /setZoom/);
  assert.match(packageJson, /pdfjs-dist/);
  assert.doesNotMatch(expensesUi, /<iframe/);
});


test("custom admin roles are migration-controlled and permission-backed", () => {
  const migration = read("migrations/0021_custom_admin_roles.sql");
  const ops = read("src/ops.ts");
  const settings = read("src/routes/settings.ts");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_roles/);
  assert.match(migration, /admin_role_permissions/);
  assert.match(migration, /custom_role_id/);
  assert.match(ops, /admin\.custom_role_id/);
  assert.match(settings, /settingsRoute\.post\("\/roles"/);
  assert.match(settings, /settingsRoute\.patch\("\/roles\/:id"/);
});
