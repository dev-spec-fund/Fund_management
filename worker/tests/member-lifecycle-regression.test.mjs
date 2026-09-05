import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("member patch validates contribution-rate month before mutating member fields", () => {
  const membersSource = fs.readFileSync(path.join(root,"src/routes/members.ts"),"utf8");
  const patchStart = membersSource.indexOf('membersRoute.patch("/:id"');
  const patchEnd = membersSource.indexOf('membersRoute.get("/:id/contribution-rates"', patchStart);
  const patchSource = membersSource.slice(patchStart, patchEnd);
  const openMonthCheck = patchSource.indexOf("await requireOpenMonth(c.env,effective!)");
  const memberUpdate = patchSource.indexOf("UPDATE members SET name=?,phone=?,active=?,telegram_id=?");
  assert.ok(openMonthCheck >= 0, "member patch must validate the effective month before a rate change");
  assert.ok(memberUpdate >= 0, "member patch update statement should remain present");
  assert.ok(openMonthCheck < memberUpdate, "closed-month validation must run before member fields are mutated");
  assert.match(patchSource, /if \(monthlyChanged\) await setContributionRate/);
});


test("member deactivation cannot leave an active admin account behind", () => {
  const membersSource = fs.readFileSync(path.join(root,"src/routes/members.ts"),"utf8");
  const patchStart = membersSource.indexOf('membersRoute.patch("/:id"');
  const patchEnd = membersSource.indexOf('membersRoute.get("/:id/contribution-rates"', patchStart);
  const patchSource = membersSource.slice(patchStart, patchEnd);
  assert.match(patchSource, /SELECT id,role FROM admins WHERE telegram_id=\? AND COALESCE\(active,1\)=1 LIMIT 1/);
  assert.match(patchSource, /MEMBER_HAS_ACTIVE_ADMIN/);
  assert.match(patchSource, /Deactivate\/remove their admin account in Settings before deactivating the member/);
});

test("member deactivation cannot leave a current EXCO assignment active", () => {
  const membersSource = fs.readFileSync(path.join(root,"src/routes/members.ts"),"utf8");
  const patchStart = membersSource.indexOf('membersRoute.patch("/:id"');
  const patchEnd = membersSource.indexOf('membersRoute.get("/:id/contribution-rates"', patchStart);
  const patchSource = membersSource.slice(patchStart, patchEnd);
  assert.match(patchSource, /SELECT id,role_title,term FROM exco_role_assignments WHERE member_id=\? AND ended_at IS NULL/);
  assert.match(patchSource, /MEMBER_HAS_ACTIVE_EXCO_ROLE/);
  assert.match(patchSource, /End or replace that EXCO assignment before deactivating the member/);
});
