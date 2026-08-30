import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "../auth";
import { logAudit } from "../db";
import { generateTxnId } from "../db";

export const expensesRoute = new Hono<{ Bindings: Env }>();

expensesRoute.get("/", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT e.*, c.name as category_name FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    ORDER BY e.created_at DESC
  `).all();
  return c.json(rows.results);
});

expensesRoute.post("/", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ description: string; category_id?: number; amount: number }>();
  const txnId = await generateTxnId(c.env, "E");
  const res = await c.env.DB.prepare(
    "INSERT INTO expenses (txn_id, description, category_id, amount, logged_by) VALUES (?, ?, ?, ?, ?)"
  ).bind(txnId, body.description, body.category_id || null, body.amount, admin.id).run();
  await logAudit(c.env, admin.id, "log_expense", `${txnId} — ${body.description} — MVR ${body.amount}`);
  return c.json({ id: res.meta.last_row_id, txn_id: txnId }, 201);
});

expensesRoute.patch("/:id", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const body = await c.req.json<{ description?: string; category_id?: number; amount?: number }>();
  const before = await c.env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<any>();
  if (!before) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE expenses SET description = ?, category_id = ?, amount = ?, edited_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    body.description ?? before.description,
    body.category_id ?? before.category_id,
    body.amount ?? before.amount,
    admin.id,
    id
  ).run();

  await logAudit(c.env, admin.id, "edit_expense",
    `${before.description}: MVR ${before.amount} → MVR ${body.amount ?? before.amount}`);
  return c.json({ ok: true });
});

expensesRoute.delete("/:id", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<any>();
  if (!before) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
  await logAudit(c.env, admin.id, "delete_expense", `${before.description} — MVR ${before.amount}`);
  return c.json({ ok: true });
});

// Expense categories
expensesRoute.get("/categories", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM expense_categories ORDER BY name").all();
  return c.json(rows.results);
});

expensesRoute.post("/categories", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ name: string }>();
  await c.env.DB.prepare("INSERT OR IGNORE INTO expense_categories (name) VALUES (?)").bind(body.name).run();
  await logAudit(c.env, admin.id, "add_category", body.name);
  return c.json({ ok: true }, 201);
});
