import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireMemberOrAdmin } from "../auth";
import { currentMonth } from "../db";
import { validMonth } from "../validation";

export const reportsRoute = new Hono<AppEnv>();

/** Combined activity feed: one indexed query instead of three full-table reads + JS sorting. */
reportsRoute.get("/activity", requireMemberOrAdmin, async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT * FROM (
      SELECT c.id, c.txn_id, m.name as who, m.member_code, 'contribution' as kind, c.amount, c.month, NULL as ref,
             c.approved_at as at, a.name as by_name, NULL as category
      FROM contributions c JOIN members m ON m.id=c.member_id LEFT JOIN admins a ON a.id=c.approved_by
      WHERE c.status='approved'
      UNION ALL
      SELECT e.id, e.txn_id, e.description, NULL, 'expense', e.amount, NULL, NULL, e.created_at, a.name, cat.name as category
      FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by LEFT JOIN expense_categories cat ON cat.id=e.category_id WHERE COALESCE(e.status,'approved')='approved'
      UNION ALL
      SELECT d.id, d.txn_id, d.donor_name, NULL, 'donation', d.amount, NULL, NULL, d.created_at, a.name, NULL as category
      FROM donations d LEFT JOIN admins a ON a.id=d.logged_by WHERE COALESCE(d.status,'active')='active'
    ) ORDER BY at DESC LIMIT 100
  `).all<any>();
  return c.json(rows.results);
});


/** Read-only fund summary available to every authenticated Mini App user. */
reportsRoute.get("/public-summary", requireMemberOrAdmin, async (c) => {
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);

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
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);

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
  const base=currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  const [by,bm]=base.split('-').map(Number);
  const months=Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(by,bm-1-(5-i),1));return d.toISOString().slice(0,7);});
  const rows = await Promise.all(months.map(async (month) => {
    const [contributionTotal, donationTotal, expenseTotal] = await Promise.all([
      c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month=?").bind(month).first<{total:number}>(),
      c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND COALESCE(transaction_month,strftime('%Y-%m',created_at))=?").bind(month).first<{total:number}>(),
      c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND COALESCE(transaction_month,strftime('%Y-%m',created_at))=?").bind(month).first<{total:number}>(),
    ]);
    return {month,income:Number(contributionTotal?.total||0)+Number(donationTotal?.total||0),expense:Number(expenseTotal?.total||0)};
  }));
  return c.json(rows);
});
