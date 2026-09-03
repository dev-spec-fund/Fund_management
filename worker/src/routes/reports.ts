import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireMemberOrAdmin } from "../auth";
import { currentMonth, getBranding } from "../db";
import { validMonth } from "../validation";
import { allocatedPaidSql } from "../allocations";
import { sendDocument } from "../telegram";
import { safeLogError } from "../ops";

export const reportsRoute = new Hono<AppEnv>();


const num = (value: unknown) => Number(value || 0);

/**
 * Return the balance chain for one reporting month.
 * Closed months use their immutable snapshot. Open months inherit the latest
 * earlier snapshot closing balance, then add any intervening open-month cash
 * movements. If no snapshot exists yet, fall back to cumulative transactions.
 */
async function balanceChainForMonth(env: any, month: string, monthNet: number) {
  const snapshot = await env.DB.prepare(`
    SELECT month,opening_balance,closing_balance,contribution_cash,donation_cash,expenses,closed_at
    FROM monthly_snapshots WHERE month=? LIMIT 1
  `).bind(month).first<any>();

  if (snapshot) {
    return {
      openingBalance: num(snapshot.opening_balance),
      closingBalance: num(snapshot.closing_balance),
      balanceSource: "snapshot",
      snapshot,
    };
  }

  const priorSnapshot = await env.DB.prepare(`
    SELECT month,closing_balance
    FROM monthly_snapshots
    WHERE month < ?
    ORDER BY month DESC
    LIMIT 1
  `).bind(month).first<any>();

  let openingBalance = 0;
  if (priorSnapshot?.month) {
    const bridge = await env.DB.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved' AND month > ? AND month < ?) +
        (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month > ? AND transaction_month < ?) -
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month > ? AND transaction_month < ?) AS balance
    `).bind(priorSnapshot.month, month, priorSnapshot.month, month, priorSnapshot.month, month).first<any>();
    openingBalance = num(priorSnapshot.closing_balance) + num(bridge?.balance);
  } else {
    const before = await env.DB.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved' AND month < ?) +
        (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month < ?) -
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month < ?) AS balance
    `).bind(month, month, month).first<any>();
    openingBalance = num(before?.balance);
  }

  return {
    openingBalance,
    closingBalance: openingBalance + num(monthNet),
    balanceSource: priorSnapshot?.month ? "prior_snapshot" : "transactions",
    snapshot: null,
  };
}

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
    const branding=await getBranding(c.env);
    await sendDocument(c.env, String(user.id), safeName, blob, caption || `${branding.fund_name} export`);
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
  const from = String(c.req.query("from") || "").trim();
  const to = String(c.req.query("to") || "").trim();
  const validDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (from && !validDate(from)) return c.json({error:"from must use YYYY-MM-DD"},400);
  if (to && !validDate(to)) return c.json({error:"to must use YYYY-MM-DD"},400);
  if (from && to && from > to) return c.json({error:"from date cannot be after to date"},400);

  const rangeClauses:string[]=[];
  const bindings:string[]=[];
  // Financial timestamps are stored in UTC. Activity filters are shown in Maldives local time (UTC+5).
  if (from) { rangeClauses.push("date(datetime(at, '+5 hours')) >= ?"); bindings.push(from); }
  if (to) { rangeClauses.push("date(datetime(at, '+5 hours')) <= ?"); bindings.push(to); }
  const rangeSql = rangeClauses.length ? `WHERE ${rangeClauses.join(" AND ")}` : "";
  const limit = rangeClauses.length ? 1000 : 100;

  const privacySafeSql = `
    SELECT * FROM (
      SELECT c.id, NULL as txn_id, 'Member contribution' as who, NULL as member_code,
             'contribution' as kind, c.amount, c.month, NULL as expense_date, NULL as ref,
             COALESCE(c.approved_at,c.submitted_at) as at, NULL as by_name, NULL as category
      FROM contributions c
      WHERE c.status='approved'
      UNION ALL
      SELECT e.id, NULL, COALESCE(NULLIF(TRIM(e.description),''),'Expense'), NULL,
             'expense', e.amount, e.transaction_month, e.expense_date, NULL,
             COALESCE(e.approved_at,e.created_at), NULL, cat.name
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      WHERE COALESCE(e.status,'approved')='approved'
      UNION ALL
      SELECT d.id, NULL, 'Donation', NULL,
             'donation', d.amount, d.transaction_month, NULL, NULL,
             d.created_at, NULL, NULL
      FROM donations d
      WHERE COALESCE(d.status,'active')='active'
    ) ${rangeSql} ORDER BY at DESC LIMIT ${limit}`;

  const adminSql = `
    SELECT * FROM (
      SELECT c.id, c.txn_id, m.name as who, m.member_code, 'contribution' as kind, c.amount, c.month, NULL as expense_date, NULL as ref,
             COALESCE(c.approved_at,c.submitted_at) as at, a.name as by_name, NULL as category
      FROM contributions c JOIN members m ON m.id=c.member_id LEFT JOIN admins a ON a.id=c.approved_by
      WHERE c.status='approved'
      UNION ALL
      SELECT e.id, e.txn_id, e.description, NULL, 'expense', e.amount, e.transaction_month, e.expense_date, NULL,
             COALESCE(e.approved_at,e.created_at), a.name, cat.name as category
      FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by LEFT JOIN expense_categories cat ON cat.id=e.category_id
      WHERE COALESCE(e.status,'approved')='approved'
      UNION ALL
      SELECT d.id, d.txn_id, d.donor_name, NULL, 'donation', d.amount, d.transaction_month, NULL, NULL,
             d.created_at, a.name, NULL as category
      FROM donations d LEFT JOIN admins a ON a.id=d.logged_by
      WHERE COALESCE(d.status,'active')='active'
    ) ${rangeSql} ORDER BY at DESC LIMIT ${limit}`;

  let sql = adminSql;
  if (!admin) sql = privacySafeSql;
  const statement = c.env.DB.prepare(sql);
  const rows = bindings.length ? await statement.bind(...bindings).all<any>() : await statement.all<any>();
  return c.json(rows.results);
});

/** Read-only fund summary available to every authenticated Mini App user. */
reportsRoute.get("/public-summary", requireMemberOrAdmin, async (c) => {
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);

  const [income,allocatedContributions,advanceAllocated,donationTotal,expenseTotal,byCategory,byProject,lifetime,recent,collection] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM contributions WHERE status='approved' AND month = ?").bind(month).first<{total:number}>(),
    allocatedTotalForMonth(c.env,month),
    advanceAllocatedForMonth(c.env,month),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month = ?").bind(month).first<{total:number}>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month = ?").bind(month).first<{total:number}>(),
    c.env.DB.prepare(`
      SELECT e.category_id,COALESCE(cat.name,'Uncategorised') as category,COALESCE(SUM(e.amount),0) spent
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      WHERE COALESCE(e.status,'approved')='approved' AND e.transaction_month=?
      GROUP BY e.category_id,COALESCE(cat.name,'Uncategorised')
      ORDER BY spent DESC,category ASC
    `).bind(month).all(),
    c.env.DB.prepare(`
      SELECT p.id project_id,p.project_code,p.name project_name,p.budget,
        COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='approved' AND e.transaction_month=?),0) spent,
        COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active' AND d.transaction_month=?),0) donations_received
      FROM projects p
      WHERE EXISTS(SELECT 1 FROM expenses e WHERE e.project_id=p.id AND e.status='approved' AND e.transaction_month=?)
         OR EXISTS(SELECT 1 FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active' AND d.transaction_month=?)
      ORDER BY (spent+donations_received) DESC,p.name
    `).bind(month,month,month,month).all<any>(),
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
    `).all<any>(),
    c.env.DB.prepare(`
      WITH paid AS (
        SELECT member_id,SUM(amount) paid FROM (
          SELECT ca.member_id,ca.amount FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.month=? AND c.status='approved'
          UNION ALL
          SELECT c.member_id,c.amount FROM contributions c WHERE c.month=? AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
        ) GROUP BY member_id
      ), eligible AS (
        SELECT m.id,COALESCE(p.paid,0) paid,
          COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) due_amount,
          CASE WHEN ex.member_id IS NOT NULL THEN 1 ELSE 0 END exempt
        FROM members m LEFT JOIN paid p ON p.member_id=m.id LEFT JOIN exemptions ex ON ex.member_id=m.id AND ex.month=? WHERE m.active=1
      )
      SELECT COALESCE(SUM(CASE WHEN exempt=0 THEN due_amount ELSE 0 END),0) expected,
             COALESCE(SUM(CASE WHEN exempt=0 THEN MIN(paid,due_amount) ELSE 0 END),0) collected,
             SUM(CASE WHEN exempt=0 AND paid+0.005<due_amount THEN 1 ELSE 0 END) outstanding_members
      FROM eligible
    `).bind(month,month,month,month,month).first<any>()
  ]);

  const monthNet = num(income?.total) + num(donationTotal?.total) - num(expenseTotal?.total);
  const balances = await balanceChainForMonth(c.env, month, monthNet);

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    allocatedContributions,
    advanceAllocated,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: monthNet,
    byCategory: byCategory.results,
    byProject: byProject.results,
    openingBalance: balances.openingBalance,
    closingBalance: balances.closingBalance,
    fundBalance: balances.closingBalance, // backward-compatible alias
    balanceSource: balances.balanceSource,
    totalReceived: lifetime?.total_received ?? 0,
    totalSpent: lifetime?.total_spent ?? 0,
    recentActivity: recent.results,
    collection: { expected:Number(collection?.expected||0), collected:Number(collection?.collected||0), outstanding_members:Number(collection?.outstanding_members||0) },
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
    SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.created_at,e.approved_at,
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

  const [income,allocatedContributions,advanceAllocated,donationTotal,expenseTotal,byCategory,byProject,expenseDetails,expenseAdjustments,projectDonationDetails,outstanding,recentActivity] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month=?").bind(month).first<{total:number}>(),
    allocatedTotalForMonth(c.env,month),
    advanceAllocatedForMonth(c.env,month),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month=?").bind(month).first<{total:number}>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month=?").bind(month).first<{total:number}>(),
    c.env.DB.prepare(`
      SELECT COALESCE(cat.name,'Uncategorised') category,COALESCE(SUM(e.amount),0) spent
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      WHERE COALESCE(e.status,'approved')='approved' AND e.transaction_month=?
      GROUP BY e.category_id,COALESCE(cat.name,'Uncategorised')
      ORDER BY spent DESC,category ASC
    `).bind(month).all(),
    c.env.DB.prepare(`
      SELECT p.id project_id,p.project_code,p.name project_name,p.budget,
        COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='approved' AND e.transaction_month=?),0) spent,
        COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active' AND d.transaction_month=?),0) donations_received
      FROM projects p
      WHERE EXISTS(SELECT 1 FROM expenses e WHERE e.project_id=p.id AND e.status='approved' AND e.transaction_month=?)
         OR EXISTS(SELECT 1 FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active' AND d.transaction_month=?)
      ORDER BY (spent+donations_received) DESC,p.name
    `).bind(month,month,month,month).all<any>(),
    c.env.DB.prepare(`
      SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.status,e.created_at,e.approved_at,
             COALESCE(cat.name,'Uncategorised') category,e.project_id,p.project_code,p.name project_name,COALESCE(a.name,'-') logged_by_name
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN admins a ON a.id=e.logged_by
      WHERE COALESCE(e.status,'approved')='approved' AND e.transaction_month=?
      ORDER BY COALESCE(e.expense_date,date(e.created_at)) ASC,e.id ASC
    `).bind(month).all<any>(),
    c.env.DB.prepare(`
      SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.status,e.created_at,e.voided_at,e.void_reason,
             COALESCE(cat.name,'Uncategorised') category,e.project_id,p.project_code,p.name project_name
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      LEFT JOIN projects p ON p.id=e.project_id
      WHERE e.status IN ('reversed','voided') AND e.transaction_month=?
      ORDER BY COALESCE(e.voided_at,e.expense_date,e.created_at) ASC,e.id ASC
    `).bind(month).all<any>(),
    c.env.DB.prepare(`
      SELECT d.id,d.txn_id,d.donor_name,d.amount,d.note,d.transaction_month,d.created_at,d.project_id,p.project_code,p.name project_name
      FROM donations d JOIN projects p ON p.id=d.project_id
      WHERE COALESCE(d.status,'active')='active' AND d.transaction_month=?
      ORDER BY d.created_at ASC,d.id ASC
    `).bind(month).all<any>(),
    c.env.DB.prepare(`
      WITH paid AS (
        SELECT member_id,SUM(amount) paid FROM (
          SELECT ca.member_id,ca.amount FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.month=? AND c.status='approved'
          UNION ALL
          SELECT c.member_id,c.amount FROM contributions c WHERE c.month=? AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
        ) GROUP BY member_id
      )
      SELECT m.id,m.member_code,m.name,
        COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) monthly_amount,
        COALESCE(p.paid,0) paid,
        CASE WHEN ex.member_id IS NOT NULL THEN 'exempt' WHEN COALESCE(p.paid,0)<=0 THEN 'unpaid' WHEN COALESCE(p.paid,0)<COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) THEN 'partial' ELSE 'paid' END payment_status
      FROM members m LEFT JOIN paid p ON p.member_id=m.id LEFT JOIN exemptions ex ON ex.member_id=m.id AND ex.month=? WHERE m.active=1
    `).bind(month,month,month,month,month,month,month).all<any>(),
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

  const monthNet = num(income?.total) + num(donationTotal?.total) - num(expenseTotal?.total);
  const balances = await balanceChainForMonth(c.env, month, monthNet);

  return c.json({
    month,
    memberIncome: income?.total ?? 0,
    allocatedContributions,
    advanceAllocated,
    donationIncome: donationTotal?.total ?? 0,
    expenses: expenseTotal?.total ?? 0,
    net: monthNet,
    byCategory: byCategory.results,
    byProject: byProject.results,
    projectDonations: projectDonationDetails.results,
    expenseDetails: expenseDetails.results,
    expenseAdjustments: expenseAdjustments.results,
    outstanding: {
      total: outstanding.results.filter((m:any)=>m.payment_status==='unpaid'||m.payment_status==='partial').reduce((s:number,m:any)=>s+Math.max(0,Number(m.monthly_amount)-Number(m.paid||0)),0),
      members: outstanding.results.filter((m:any)=>m.payment_status==='unpaid'||m.payment_status==='partial'),
    },
    member_statuses: outstanding.results,
    collection: {
      expected: outstanding.results.reduce((sum:number,m:any)=>sum+(m.payment_status==='exempt'?0:Number(m.monthly_amount||0)),0),
      collected: outstanding.results.reduce((sum:number,m:any)=>sum+(m.payment_status==='exempt'?0:Math.min(Number(m.paid||0),Number(m.monthly_amount||0))),0)
    },
    openingBalance: balances.openingBalance,
    closingBalance: balances.closingBalance,
    fundBalance: balances.closingBalance, // backward-compatible alias
    balanceSource: balances.balanceSource,
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
