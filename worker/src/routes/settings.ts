import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin, requireOwner } from "../auth";
import { logAudit, setSetting } from "../db";

export const settingsRoute = new Hono<{ Bindings: Env }>();

settingsRoute.get("/", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM settings").all<{ key: string; value: string }>();
  const obj: Record<string, string> = {};
  for (const r of rows.results) obj[r.key] = r.value;
  return c.json(obj);
});

settingsRoute.patch("/", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<Record<string, string>>();
  for (const [key, value] of Object.entries(body)) {
    await setSetting(c.env, key, value);
  }
  await logAudit(c.env, admin.id, "update_settings", Object.keys(body).join(", "));
  return c.json({ ok: true });
});

// Admins (owner only to add/remove)
settingsRoute.get("/admins", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, telegram_id, name, role FROM admins").all();
  return c.json(rows.results);
});

settingsRoute.post("/admins", requireOwner, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ telegram_id: string; name: string; role?: "owner" | "treasurer" }>();
  await c.env.DB.prepare(
    "INSERT INTO admins (telegram_id, name, role) VALUES (?, ?, ?)"
  ).bind(body.telegram_id, body.name, body.role || "treasurer").run();
  await logAudit(c.env, admin.id, "add_admin", `${body.name} (${body.role || "treasurer"})`);
  return c.json({ ok: true }, 201);
});

settingsRoute.delete("/admins/:id", requireOwner, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first<any>();
  if (!target) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();
  await logAudit(c.env, admin.id, "remove_admin", target.name);
  return c.json({ ok: true });
});

// Audit log — owner only
settingsRoute.get("/audit-log", requireOwner, async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT al.*, a.name as admin_name FROM audit_log al
    LEFT JOIN admins a ON a.id = al.admin_id
    ORDER BY al.created_at DESC LIMIT 200
  `).all();
  return c.json(rows.results);
});
