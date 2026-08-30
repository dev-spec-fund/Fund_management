import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "../auth";
import { logAudit } from "../db";

export const donationsRoute = new Hono<{ Bindings: Env }>();

donationsRoute.get("/", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM donations ORDER BY created_at DESC").all();
  return c.json(rows.results);
});

donationsRoute.post("/", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ donor_name: string; amount: number; note?: string }>();
  const res = await c.env.DB.prepare(
    "INSERT INTO donations (donor_name, amount, note, logged_by) VALUES (?, ?, ?, ?)"
  ).bind(body.donor_name, body.amount, body.note || null, admin.id).run();
  await logAudit(c.env, admin.id, "log_donation", `${body.donor_name} — MVR ${body.amount}`);
  return c.json({ id: res.meta.last_row_id }, 201);
});
