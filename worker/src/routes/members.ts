import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "../auth";
import { logAudit } from "../db";
import { generateMemberCode } from "../db";

export const membersRoute = new Hono<{ Bindings: Env }>();

membersRoute.get("/", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM members ORDER BY name").all();
  return c.json(rows.results);
});

membersRoute.get("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const member = await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
  if (!member) return c.json({ error: "Not found" }, 404);
  const contributions = await c.env.DB.prepare(
    "SELECT * FROM contributions WHERE member_id = ? ORDER BY month DESC"
  ).bind(id).all();
  return c.json({ ...member, contributions: contributions.results });
});

membersRoute.post("/", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ name: string; phone?: string; monthly_amount?: number }>();
  const memberCode = await generateMemberCode(c.env);
  const res = await c.env.DB.prepare(
    "INSERT INTO members (member_code, name, phone, monthly_amount) VALUES (?, ?, ?, ?)"
  ).bind(memberCode, body.name, body.phone || null, body.monthly_amount || 250).run();
  await logAudit(c.env, admin.id, "add_member", `${memberCode} — ${body.name}`);
  return c.json({ id: res.meta.last_row_id, member_code: memberCode }, 201);
});

membersRoute.patch("/:id", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; phone?: string; monthly_amount?: number; active?: number }>();
  const before = await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<any>();
  if (!before) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE members SET name = ?, phone = ?, monthly_amount = ?, active = ? WHERE id = ?"
  ).bind(
    body.name ?? before.name,
    body.phone ?? before.phone,
    body.monthly_amount ?? before.monthly_amount,
    body.active ?? before.active,
    id
  ).run();

  if (body.active !== undefined && body.active !== before.active) {
    await logAudit(c.env, admin.id, body.active ? "reactivate_member" : "deactivate_member", before.name);
  } else {
    await logAudit(c.env, admin.id, "edit_member", `${before.name} updated`);
  }
  return c.json({ ok: true });
});

// Per-month exemption
membersRoute.post("/:id/exempt", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const body = await c.req.json<{ month: string; reason?: string }>();
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO exemptions (member_id, month, reason, granted_by) VALUES (?, ?, ?, ?)"
  ).bind(id, body.month, body.reason || null, admin.id).run();
  await logAudit(c.env, admin.id, "grant_exemption", `Member #${id} — ${body.month}`);
  return c.json({ ok: true });
});
