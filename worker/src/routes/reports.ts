import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireMemberOrAdmin } from "../auth";
import { currentMonth } from "../db";
import { validMonth } from "../validation";
import { allocatedPaidSql } from "../allocations";
import { sendDocument } from "../telegram";
import { safeLogError } from "../ops";

export const reportsRoute = new Hono<AppEnv>();

reportsRoute.post("/send-document", requireMemberOrAdmin, async (c) => {
  try {
    const user = c.get("telegramUser");
    if (!user?.id) return c.json({ error: "Telegram user is unavailable" }, 400);

    const form = await c.req.raw.formData();
    const file = form.get("file");
    const requestedName = String(form.get("filename") || "fund-document").trim();
    const caption = String(form.get("caption") || "").trim();
    if (!(file instanceof File)) return c.json({ error: "Document file is required" }, 400);
    if (file.size <= 0) return c.json({ error: "Document is empty" }, 400);
    if (file.size > 8 * 1024 * 1024) return c.json({ error: "Document is too large" }, 413);

    const safeName = requestedName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "fund-document";
    const lower = safeName.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".csv") && !lower.endsWith(".json"))
      return c.json({ error: "Only PDF, CSV and JSON documents are supported" }, 400);

    const blob = new Blob([await file.arrayBuffer()], { type: file.type || (lower.endsWith(".pdf") ? "application/pdf" : lower.endsWith(".json") ? "application/json" : "text/csv") });
    await sendDocument(c.env, String(user.id), safeName, blob, caption || "Fund Manager export");
    return c.json({ ok: true, filename: safeName });
  } catch (e) {
    await safeLogError(c.env, "reports.send_document", e);
    return c.json({ error: e instanceof Error ? e.message : "Could not send document" }, 500);
  }
});


async function allocatedTotalForMonth(env:any, month:string){
  const row=await env.DB.prepare(`
    SELECT COALESCE(SUM(amount),0) total FROM (
      SELECT ca.amount amount
      FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
      WHERE ca.month=? AND c.status='approved'
      UNION ALL
      SELECT c.amount amount
      FROM contributions c
      WHERE c.month=? AND c.status='approved'
        AND NOT EXISTS(SELECT 1 FROM contribution_allocations ca2 WHERE ca2.contribution_id=c.id)
    )
  `).bind(month,month).first<any>();
  return Number(row?.total||0);
}

async function advanceAllocatedForMonth(env:any, month:string){
  const row=await env.DB.prepare(`
    SELECT COALESCE(SUM(ca.amount),0) total
    FROM contribution_allocations ca
    JOIN contributions c ON c.id=ca.contribution_id
    WHERE ca.month=? AND c.status='approved' AND c.month<>ca.month
  `).bind(month).first<any>();
  return Number(row?.total||0);
}

/** Combined activity feed. Normal members receive privacy-safe labels only. */
reportsRoute.get("/activity", requireMemberOrAdmin, async (c) => {
  const admin = c.get("admin");
  if (!admin) {
    const rows = await c.env.DB.prepare(`
      SELECT * FROM (
        SELECT c.id, NULL as txn_id, 'Member contribution' as who, NULL as member_code,
               'contribution' as kind, c.amount, c.month, NULL as ref,
               COALESCE(c.approved_at,c.submitted_at) as at, NULL as by_name, NULL as category
        FROM contributions c
        WHERE c.status='approved'
        UNION ALL
        SELECT e.id, NULL, COALESCE(NULLIF(TRIM(e.description),''),'Expense'), NULL,
               'expense', e.amount, e.transaction_month, NULL,
               COALESCE(e.approved_at,e.created_at), NULL, cat.name
        FROM expenses e
        LEFT JOIN expense_categories cat ON cat.id=e.category_id
        WHERE COALESCE(e.status,'approved')='approved'
        UNION ALL
        SELECT d.id, NULL, 'Donation', NULL,
               'donation', d.amount, d.transaction_month, NULL,
               d.created_at, NULL, NULL
        FROM donations d
        WHERE COALESCE(d.status,'active')='active'
      ) ORDER BY at DESC LIMIT 100
    `).all<any>();
    return c.json(rows.results);
  }

  const rows = await c.env.DB.prepare(`
    SELECT * FROM (
      SELECT c.id, c.txn_id, m.name as who, m.member_code, 'contribution' as kind, c.amount, c.month, NULL as ref,
             COALESCE(c.approved_at,c.submitted_at) as at, a.name as by_name, NULL as category
      FROM contributions c JOIN members m ON m.id=c.member_id LEFT JOIN admins a ON a.id=c.approved_by
      WHERE c.status='approved'
      UNION ALL
      SELECT e.id, e.txn_id, e.description, NULL, 'expense', e.amount, e.transaction_month, NULL,
             COALESCE(e.approved_at,e.created_at), a.name, cat.name as category
      FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by LEFT JOIN expense_categories cat ON cat.id=e.category_id
      WHERE COALESCE(e.status,'approved')='approved'
      UNION ALL
      SELECT d.id, d.txn_id, d.donor_name, NULL, 'donation', d.amount, d.transaction_month, NULL,
             d.created_at, a.name, NULL as category
      FROM donations d LEFT JOIN admins a ON a.id=d.logged_by
      WHERE COALESCE(d.status,'active')='active'
    ) ORDER BY at DESC LIMIT 100
  `).all<any>();
  return c.json(rows.results);
});


/** Read-only fund summary available to every authenticated Mini App user. */
reportsRoute.get("/public-summary", requireMemberOrAdmin, async (c) => {
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);

  const [income,allocatedContributions,advanceAllocated,donationTotal,expenseTotal,byCategory,lifetime,recent] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM contributions WHERE status='approved' AND month = ?").bind(month).first<{total:number}>(),
    allocatedTotalForMonth(c.env,month),
    advanceAllocatedForMonth(c.env,month),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month = ?").bind(month).first<{total:number}>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month = ?").bind(month).first<{total:number}>(),
    c.env.DB.prepare(`
      SELECT cat.id as category_id,cat.name as category,COALESCE(SUM(e.amount),0) spent
      FROM expense_categories cat
      LEFT JOIN expenses e ON e.category_id=cat.id AND COALESCE(e.status,'approved')='approved' AND e.transaction_month=?
      GROUP BY cat.id
    `).bind(month).all(),
    c.env.DB.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved') +
        (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active') AS total_received,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved') AS total_spent
    `).first<any>(),
    c.env.DB.prepare(`
    SELECT kind,label,amount,event_at FROM (
      SELECT 'contribution' kind,'Member contribution' label,amount,
        COALESCE(approved_at,submitted_at) event_at
      FROM contributions
      WHERE status='approved'
      UNION ALL
      SELECT 'donation' kind,
        'Donation' label,
        amount,created_at event_at
      FROM donations
      WHERE COALESCE(status,'active')='active'
      UNION ALL
      SELECT 'expense' kind,
        COALESCE(NULLIF(TRIM(description),''),'Expense') label,
        amount,created_at event_at
      FROM expenses
      WHERE COALESCE(status,'approved')='approved'
    )
    WHERE event_at IS NOT NULL
    ORDER BY event_at DESC
    LIMIT 5
    `).all<any>()
  ]);

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    allocatedContributions,
    advanceAllocated,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: (income?.total ?? 0) + (donationTotal?.total ?? 0) - (expenseTotal?.total ?? 0),
    byCategory: byCategory.results,
    fundBalance: Number(lifetime?.total_received||0)-Number(lifetime?.total_spent||0),
    totalReceived: lifetime?.total_received ?? 0,
    totalSpent: lifetime?.total_spent ?? 0,
    recentActivity: recent.results,
  });
});


/** Member-safe read-only expense detail for the Fund transparency view. */
reportsRoute.get("/public-expenses", requireMemberOrAdmin, async (c) => {
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  const categoryId = Number(c.req.query("category_id"));
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  if (!Number.isInteger(categoryId) || categoryId <= 0) return c.json({error:"Valid category_id is required"},400);

  const category = await c.env.DB.prepare("SELECT id,name FROM expense_categories WHERE id=?")
    .bind(categoryId).first<any>();
  if (!category) return c.json({error:"Expense category not found"},404);

  const rows = await c.env.DB.prepare(`
    SELECT e.id,e.txn_id,e.description,e.amount,e.transaction_month,e.created_at,e.approved_at,
           c.id category_id,c.name category
    FROM expenses e
    JOIN expense_categories c ON c.id=e.category_id
    WHERE e.category_id=?
      AND COALESCE(e.status,'approved')='approved'
      AND e.transaction_month=?
    ORDER BY COALESCE(e.approved_at,e.created_at) DESC,e.id DESC
  `).bind(categoryId,month).all<any>();

  const total = rows.results.reduce((sum:number,row:any)=>sum+Number(row.amount||0),0);
  return c.json({month,category,total,expenses:rows.results});
});

/** Summary for a given month (YYYY-MM), or 'ytd' for year-to-date. */
reportsRoute.get("/summary", requireAdmin, async (c) => {
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);

  const [income,allocatedContributions,advanceAllocated,donationTotal,expenseTotal,byCategory,outstanding,totalBalance,recentActivity] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month=?").bind(month).first<{total:number}>(),
    allocatedTotalForMonth(c.env,month),
    advanceAllocatedForMonth(c.env,month),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month=?").bind(month).first<{total:number}>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month=?").bind(month).first<{total:number}>(),
    c.env.DB.prepare(`SELECT cat.name category,COALESCE(SUM(e.amount),0) spent FROM expense_categories cat LEFT JOIN expenses e ON e.category_id=cat.id AND COALESCE(e.status,'approved')='approved' AND e.transaction_month=? GROUP BY cat.id`).bind(month).all(),
    c.env.DB.prepare(`
      WITH paid AS (
        SELECT member_id,SUM(amount) paid FROM (
          SELECT ca.member_id,ca.amount FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.month=? AND c.status='approved'
          UNION ALL
          SELECT c.member_id,c.amount FROM contributions c WHERE c.month=? AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
        ) GROUP BY member_id
      )
      SELECT m.id,m.member_code,m.name,m.monthly_amount,COALESCE(p.paid,0) paid,
        CASE WHEN ex.member_id IS NOT NULL THEN 'exempt' WHEN COALESCE(p.paid,0)<=0 THEN 'unpaid' WHEN COALESCE(p.paid,0)<m.monthly_amount THEN 'partial' ELSE 'paid' END payment_status
      FROM members m LEFT JOIN paid p ON p.member_id=m.id LEFT JOIN exemptions ex ON ex.member_id=m.id AND ex.month=? WHERE m.active=1
    `).bind(month,month,month).all<any>(),
    c.env.DB.prepare(`SELECT (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved')+(SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active')-(SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved') balance`).first<{balance:number}>(),
    c.env.DB.prepare(`
      SELECT * FROM (
        SELECT c.id,c.txn_id,m.name who,m.member_code,'contribution' kind,c.amount,c.month,NULL ref,
               COALESCE(c.approved_at,c.submitted_at) at,a.name by_name,NULL category
        FROM contributions c JOIN members m ON m.id=c.member_id LEFT JOIN admins a ON a.id=c.approved_by
        WHERE c.status='approved'
        UNION ALL
        SELECT e.id,e.txn_id,e.description,NULL,'expense',e.amount,e.transaction_month,NULL,
               COALESCE(e.approved_at,e.created_at),a.name,cat.name
        FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by LEFT JOIN expense_categories cat ON cat.id=e.category_id
        WHERE COALESCE(e.status,'approved')='approved'
        UNION ALL
        SELECT d.id,d.txn_id,d.donor_name,NULL,'donation',d.amount,d.transaction_month,NULL,
               d.created_at,a.name,NULL
        FROM donations d LEFT JOIN admins a ON a.id=d.logged_by
        WHERE COALESCE(d.status,'active')='active'
      ) ORDER BY at DESC LIMIT 4
    `).all<any>()
  ]);

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    allocatedContributions,
    advanceAllocated,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: (income?.total ?? 0) + (donationTotal?.total ?? 0) - (expenseTotal?.total ?? 0),
    byCategory: byCategory.results,
    outstanding: {
      total: outstanding.results.filter((m:any)=>m.payment_status==='unpaid'||m.payment_status==='partial').reduce((s:number,m:any)=>s+Math.max(0,Number(m.monthly_amount)-Number(m.paid||0)),0),
      members: outstanding.results.filter((m:any)=>m.payment_status!=='paid'),
    },
    fundBalance: totalBalance?.balance ?? 0,
    recentActivity: recentActivity.results,
  });
});

/** 6-month trend for charts. */
reportsRoute.get("/trend", requireAdmin, async (c) => {
  const base=c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(base)) return c.json({error:"Month must use YYYY-MM"},400);
  const [by,bm]=base.split('-').map(Number);
  const months=Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(by,bm-1-(5-i),1));return d.toISOString().slice(0,7);});
  const first=months[0],last=months[months.length-1];
  const [contributions,donations,expenses]=await Promise.all([
    c.env.DB.prepare("SELECT month,COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month BETWEEN ? AND ? GROUP BY month").bind(first,last).all<any>(),
    c.env.DB.prepare("SELECT transaction_month month,COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month BETWEEN ? AND ? GROUP BY transaction_month").bind(first,last).all<any>(),
    c.env.DB.prepare("SELECT transaction_month month,COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month BETWEEN ? AND ? GROUP BY transaction_month").bind(first,last).all<any>()
  ]);
  const cm=new Map(contributions.results.map((r:any)=>[r.month,Number(r.total||0)]));
  const dm=new Map(donations.results.map((r:any)=>[r.month,Number(r.total||0)]));
  const em=new Map(expenses.results.map((r:any)=>[r.month,Number(r.total||0)]));
  return c.json(months.map(month=>({month,income:Number(cm.get(month)||0)+Number(dm.get(month)||0),expense:Number(em.get(month)||0)})));
});
