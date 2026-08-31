import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "../auth";

export const reportsRoute = new Hono<{ Bindings: Env }>();

/** Combined activity feed: contributions (approved) + expenses + donations, newest first. */
reportsRoute.get("/activity", async (c) => {
  const contributions = await c.env.DB.prepare(`
    SELECT c.id, c.txn_id, m.name as who, m.member_code, 'contribution' as kind, c.amount, c.month, c.ref_number as ref,
           c.approved_at as at, a.name as by_name
    FROM contributions c
    JOIN members m ON m.id = c.member_id
    LEFT JOIN admins a ON a.id = c.approved_by
    WHERE c.status = 'approved'
  `).all<any>();

  const expenses = await c.env.DB.prepare(`
    SELECT e.id, e.txn_id, e.description as who, NULL as member_code, 'expense' as kind, e.amount, NULL as month, NULL as ref,
           e.created_at as at, a.name as by_name
    FROM expenses e
    LEFT JOIN admins a ON a.id = e.logged_by
    WHERE COALESCE(e.status,'approved')='approved'
  `).all<any>();

  const donations = await c.env.DB.prepare(`
    SELECT d.id, d.txn_id, d.donor_name as who, NULL as member_code, 'donation' as kind, d.amount, NULL as month, NULL as ref,
           d.created_at as at, a.name as by_name
    FROM donations d
    LEFT JOIN admins a ON a.id = d.logged_by
    WHERE COALESCE(d.status,'active')='active'
  `).all<any>();

  const combined = [...contributions.results, ...expenses.results, ...donations.results]
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  return c.json(combined);
});


/** Read-only fund summary available to every authenticated Mini App user. */
reportsRoute.get("/public-summary", async (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);

  const income = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM contributions WHERE status='approved' AND month = ?"
  ).bind(month).first<{ total: number }>();

  const donationTotal = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE COALESCE(status,'active')='active' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = ?"
  ).bind(month).first<{ total: number }>();

  const expenseTotal = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE COALESCE(status,'approved')='approved' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = ?"
  ).bind(month).first<{ total: number }>();

  const byCategory = await c.env.DB.prepare(`
    SELECT cat.name as category, COALESCE(SUM(e.amount),0) as spent
    FROM expense_categories cat
    LEFT JOIN expenses e ON e.category_id = cat.id AND COALESCE(e.status,'approved')='approved' AND COALESCE(e.transaction_month,strftime('%Y-%m', e.created_at)) = ?
    GROUP BY cat.id
  `).bind(month).all();

  const totalBalance = await c.env.DB.prepare(`
    SELECT
      (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved') +
      (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active') -
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved') as balance
  `).first<{ balance: number }>();

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: (income?.total ?? 0) + (donationTotal?.total ?? 0) - (expenseTotal?.total ?? 0),
    byCategory: byCategory.results,
    fundBalance: totalBalance?.balance ?? 0,
  });
});

/** Summary for a given month (YYYY-MM), or 'ytd' for year-to-date. */
reportsRoute.get("/summary", requireAdmin, async (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);

  const income = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM contributions WHERE status='approved' AND month = ?"
  ).bind(month).first<{ total: number }>();

  const donationTotal = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE COALESCE(status,'active')='active' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = ?"
  ).bind(month).first<{ total: number }>();

  const expenseTotal = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE COALESCE(status,'approved')='approved' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = ?"
  ).bind(month).first<{ total: number }>();

  const byCategory = await c.env.DB.prepare(`
    SELECT cat.name as category, COALESCE(SUM(e.amount),0) as spent
    FROM expense_categories cat
    LEFT JOIN expenses e ON e.category_id = cat.id AND COALESCE(e.status,'approved')='approved' AND COALESCE(e.transaction_month,strftime('%Y-%m', e.created_at)) = ?
    GROUP BY cat.id
  `).bind(month).all();

  const outstanding = await c.env.DB.prepare(`
    SELECT m.id,m.member_code,m.name,m.monthly_amount,
      COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.member_id=m.id AND c.month=? AND c.status='approved'),0) paid,
      CASE
        WHEN EXISTS(SELECT 1 FROM exemptions ex WHERE ex.member_id=m.id AND ex.month=?) THEN 'exempt'
        WHEN COALESCE((SELECT SUM(c2.amount) FROM contributions c2 WHERE c2.member_id=m.id AND c2.month=? AND c2.status='approved'),0) <= 0 THEN 'unpaid'
        WHEN COALESCE((SELECT SUM(c3.amount) FROM contributions c3 WHERE c3.member_id=m.id AND c3.month=? AND c3.status='approved'),0) < m.monthly_amount THEN 'partial'
        ELSE 'paid'
      END payment_status
    FROM members m WHERE m.active=1
  `).bind(month,month,month,month).all<any>();

  const totalBalance = await c.env.DB.prepare(`
    SELECT
      (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved') +
      (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active') -
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved') as balance
  `).first<{ balance: number }>();

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: (income?.total ?? 0) + (donationTotal?.total ?? 0) - (expenseTotal?.total ?? 0),
    byCategory: byCategory.results,
    outstanding: {
      total: outstanding.results.filter((m:any)=>m.payment_status==='unpaid'||m.payment_status==='partial').reduce((s:number,m:any)=>s+Math.max(0,Number(m.monthly_amount)-Number(m.paid||0)),0),
      members: outstanding.results.filter((m:any)=>m.payment_status!=='paid'),
    },
    fundBalance: totalBalance?.balance ?? 0,
  });
});

/** 6-month trend for charts. */
reportsRoute.get("/trend", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(`
    WITH months AS (
      SELECT strftime('%Y-%m', date('now', '-' || n || ' months')) as month
      FROM (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5)
    )
    SELECT
      months.month,
      COALESCE((SELECT SUM(amount) FROM contributions WHERE status='approved' AND month = months.month), 0) +
      COALESCE((SELECT SUM(amount) FROM donations WHERE COALESCE(status,'active')='active' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = months.month), 0) as income,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE COALESCE(status,'approved')='approved' AND COALESCE(transaction_month,strftime('%Y-%m', created_at)) = months.month), 0) as expense
    FROM months ORDER BY months.month
  `).all();
  return c.json(rows.results);
});
