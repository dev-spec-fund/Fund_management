import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Env } from "./types";
import { telegramAuth } from "./auth";
import { claimTelegramUpdate, completeTelegramUpdate, failTelegramUpdate, handleUpdate } from "./bot";
import { runScheduled } from "./scheduled";
import { membersRoute } from "./routes/members";
import { expensesRoute } from "./routes/expenses";
import { donationsRoute } from "./routes/donations";
import { reportsRoute } from "./routes/reports";
import { settingsRoute } from "./routes/settings";
import { adminRoute } from "./routes/admin";
import { governanceRoute } from "./routes/governance";
import { projectsRoute } from "./routes/projects";
import { electionsRoute } from "./routes/elections";
import { consumeRateLimit, safeLogError } from "./ops";
import { currentMonth, getBranding, getSetting } from "./db";
import { paidForMonth } from "./allocations";
import { contributionRateForMonth, contributionDueFromRate, firstMonthContributionRule } from "./contributionRates";

const app = new Hono<AppEnv>();

app.use("/api/*", cors({
  origin: ["https://fund-management.pages.dev", "http://localhost:5173", "http://127.0.0.1:5173"],
  allowHeaders: ["Content-Type", "X-Telegram-Init-Data"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 86400,
}));

app.onError(async (err, c) => {
  await safeLogError(c.env, `http:${c.req.method}:${c.req.path}`, err);
  return c.json({ error: "Internal server error" }, 500);
});

// Telegram webhook — verified via secret token header set at registration time
app.post("/telegram/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) return c.text("Forbidden", 403);

  const update = await c.req.json<any>();
  const updateId = Number(update?.update_id);

  // Telegram may redeliver an update when delivery is retried. Claim the
  // update in D1 before starting side effects so the same update cannot send
  // duplicate messages, slips or callbacks from concurrent webhook delivery.
  if (Number.isSafeInteger(updateId) && updateId >= 0) {
    const claimed = await claimTelegramUpdate(c.env, updateId);
    if (!claimed) return c.text("ok");

    c.executionCtx.waitUntil(
      handleUpdate(c.env, update)
        .then(() => completeTelegramUpdate(c.env, updateId))
        .catch(async (e) => {
          await failTelegramUpdate(c.env, updateId, e).catch(() => {});
          await safeLogError(c.env, "telegram.update", e, { update_id: updateId });
        })
    );
    return c.text("ok");
  }

  // Defensive fallback for malformed/non-standard updates without update_id.
  c.executionCtx.waitUntil(
    handleUpdate(c.env, update).catch((e) =>
      safeLogError(c.env, "telegram.update", e, { update_id: update?.update_id })
    )
  );
  return c.text("ok");
});

// Mini App API — all routes require verified Telegram initData
app.use("/api/*", telegramAuth);
app.use("/api/*", async (c, next) => {
  // Reads are intentionally not backed by a D1 write. Mutations retain a
  // persistent rate limit, reducing dashboard latency while protecting writes.
  if (c.req.method !== "GET" && c.req.method !== "OPTIONS") {
    const user = c.get("telegramUser");
    if (!(await consumeRateLimit(c.env, "api_write", String(user?.id || "unknown"), 60, 60))) {
      return c.json({ error: "Too many requests" }, 429);
    }
  }
  await next();
});
app.route("/api/members", membersRoute);
app.route("/api/expenses", expensesRoute);
app.route("/api/donations", donationsRoute);
app.route("/api/reports", reportsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/admin", adminRoute);
app.route("/api/governance", governanceRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/elections", electionsRoute);

app.get("/api/branding", async (c) => c.json(await getBranding(c.env)));

// Authenticated Mini App diagnostics. The client sends only a short safe message
// and UI context; safeLogError sanitizes values again before persistence.
app.post("/api/client-error", async (c) => {
  const user=c.get("telegramUser");
  const body=await c.req.json().catch(()=>({})) as any;
  const source=String(body.source||"frontend").trim().slice(0,120) || "frontend";
  const message=String(body.message||"Client error").trim().slice(0,1000) || "Client error";
  const detail={
    route:String(body.route||"").slice(0,160),
    page:String(body.page||"").slice(0,80),
    mode:String(body.mode||"").slice(0,30),
    stack:String(body.stack||"").slice(0,3500),
    user_agent:String(c.req.header("User-Agent")||"").slice(0,300),
    telegram_user_id:String(user?.id||"").slice(0,40),
    occurred_at:String(body.occurred_at||"").slice(0,40),
  };
  await safeLogError(c.env,`client:${source}`,new Error(message),detail);
  return c.json({ok:true},202);
});

app.get("/api/me", async (c) => {
  const user = c.get("telegramUser");
  const member = await c.env.DB.prepare(
    "SELECT id, member_code, telegram_id, name, phone, monthly_amount, active, joined_at, created_at FROM members WHERE telegram_id = ? LIMIT 1"
  ).bind(String(user.id)).first<any>();
  if(member){ const month=currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives"); member.monthly_amount=await contributionRateForMonth(c.env,Number(member.id),month,Number(member.monthly_amount||0)); }
  const [branding, showProjectsSetting] = await Promise.all([getBranding(c.env), getSetting(c.env, "show_projects_to_members")]);
  const member_features = { projects: showProjectsSetting !== "0" };
  return c.json({ user, admin: c.get("admin"), member: member || null, branding, member_features });
});

app.post("/api/me/meetings/:id/rsvp", async (c) => {
  const user=c.get("telegramUser"); const meetingId=Number(c.req.param("id")); const body=await c.req.json().catch(()=>({})) as any; const response=String(body.response||"");
  if(!["yes","maybe","no"].includes(response)) return c.json({error:"Choose yes, maybe or no"},400);
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>(); if(!member)return c.json({error:"Member account not linked"},404);
  const meeting=await c.env.DB.prepare("SELECT id,status FROM meetings WHERE id=?").bind(meetingId).first<any>(); if(!meeting)return c.json({error:"Meeting not found"},404); if(meeting.status==='cancelled')return c.json({error:"Meeting is cancelled"},409);
  await c.env.DB.prepare(`INSERT INTO meeting_rsvps(meeting_id,member_id,response,responded_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(meeting_id,member_id) DO UPDATE SET response=excluded.response,responded_at=datetime('now')`).bind(meetingId,member.id,response).run();
  return c.json({ok:true,response});
});

app.post("/api/me/actions/:id/done", async (c) => {
  const user=c.get("telegramUser"); const id=Number(c.req.param("id"));
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>(); if(!member)return c.json({error:"Member account not linked"},404);
  const action=await c.env.DB.prepare("SELECT id,status FROM meeting_action_items WHERE id=? AND assigned_member_id=?").bind(id,member.id).first<any>(); if(!action)return c.json({error:"Action item not found"},404);
  await c.env.DB.prepare("UPDATE meeting_action_items SET status='done',completed_at=datetime('now'),completed_by=NULL WHERE id=? AND assigned_member_id=?").bind(id,member.id).run();
  return c.json({ok:true});
});

// The signed-in member's own contribution history. This is intentionally
// separate from the admin member-detail route so dual-role users can switch
// to My Account without losing admin permissions.
app.get("/api/me/dashboard", async (c) => {
  const user=c.get("telegramUser");
  const member=await c.env.DB.prepare("SELECT id,member_code,name,phone,monthly_amount,active,joined_at,created_at,telegram_id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>();
  if(!member) return c.json({error:"Member account not linked"},404);
  const month=currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  const [paid,baseRate,exemption,pending,nextMeeting,openActions]=await Promise.all([
    paidForMonth(c.env,member.id,month),
    contributionRateForMonth(c.env,member.id,month,Number(member.monthly_amount||0)),
    c.env.DB.prepare("SELECT reason FROM exemptions WHERE member_id=? AND month=?").bind(member.id,month).first<any>(),
    c.env.DB.prepare(`SELECT id,txn_id,amount,month,ref_number,status,submitted_at,bank_date FROM contributions WHERE member_id=? AND status='pending' ORDER BY submitted_at DESC LIMIT 5`).bind(member.id).all<any>(),
    c.env.DB.prepare(`SELECT m.id,m.title,m.meeting_date,m.meeting_time,m.venue,m.status,r.response rsvp FROM meetings m LEFT JOIN meeting_rsvps r ON r.meeting_id=m.id AND r.member_id=? WHERE m.status!='cancelled' AND m.meeting_date>=date('now','+5 hours') ORDER BY m.meeting_date,m.meeting_time LIMIT 1`).bind(member.id).first<any>(),
    c.env.DB.prepare(`SELECT ai.id,ai.description,ai.due_date,ai.status,m.id meeting_id,m.title meeting_title FROM meeting_action_items ai JOIN meetings m ON m.id=ai.meeting_id WHERE ai.assigned_member_id=? AND ai.status='open' ORDER BY CASE WHEN ai.due_date IS NULL THEN 1 ELSE 0 END,ai.due_date,ai.id LIMIT 5`).bind(member.id).all<any>()
  ]);
  const firstMonthRule=await firstMonthContributionRule(c.env);
  const requiredAmount=contributionDueFromRate(Number(baseRate),member.joined_at||member.created_at,month,firstMonthRule);
  const due=exemption?0:Math.max(0,requiredAmount-Number(paid));
  const status=exemption?'exempt':requiredAmount<=0.004?'not_applicable':Number(paid)<=0?'unpaid':Number(paid)+0.005<requiredAmount?'partial':'paid';
  return c.json({member,month,contribution:{status,paid:Number(paid),due,monthly_amount:Number(baseRate),required_amount:requiredAmount,exemption_reason:exemption?.reason||null},pending_payments:pending.results,next_meeting:nextMeeting||null,open_actions:openActions.results});
});


app.get("/api/me/projects", async (c) => {
  const user=c.get("telegramUser");
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>();
  if(!member) return c.json({error:"Member account not linked"},404);
  const showProjects=await getSetting(c.env,"show_projects_to_members");
  if(showProjects==="0") return c.json({enabled:false,projects:[]});
  const projects=await c.env.DB.prepare(`SELECT p.id,p.project_code,p.name,p.description,p.budget,p.start_date,p.target_end_date,p.status,
      m.name responsible_member_name,m.member_code responsible_member_code,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='approved'),0) spent,
      COALESCE((SELECT COUNT(*) FROM expenses e WHERE e.project_id=p.id AND e.status='approved'),0) expense_count,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donations_received,
      COALESCE((SELECT COUNT(*) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donation_count
    FROM projects p
    LEFT JOIN members m ON m.id=p.responsible_member_id
    WHERE p.status IN ('active','completed')
    ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.start_date DESC,p.id DESC`).all<any>();
  const result=[] as any[];
  for(const project of projects.results){
    const [expenses,donations]=await Promise.all([
      c.env.DB.prepare(`SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,COALESCE(cat.name,'Project expense / Uncategorised') category
        FROM expenses e LEFT JOIN expense_categories cat ON cat.id=e.category_id
        WHERE e.project_id=? AND e.status='approved'
        ORDER BY COALESCE(e.expense_date,e.created_at) DESC,e.id DESC LIMIT 100`).bind(project.id).all<any>(),
      c.env.DB.prepare(`SELECT d.id,d.txn_id,d.amount,COALESCE(d.donation_date,date(d.created_at)) donation_date
        FROM donations d
        WHERE d.project_id=? AND COALESCE(d.status,'active')='active'
        ORDER BY COALESCE(d.donation_date,d.created_at) DESC,d.id DESC LIMIT 100`).bind(project.id).all<any>()
    ]);
    const spent=Number(project.spent||0); const budget=project.budget==null?null:Number(project.budget);
    const donationsReceived=Number(project.donations_received||0);
    result.push({...project,spent,donations_received:donationsReceived,remaining_budget:budget==null?null:budget-spent,budget_used_pct:budget==null?null:(spent/Math.max(budget,0.01))*100,expenses:expenses.results,donations:donations.results});
  }
  return c.json({enabled:true,projects:result});
});

app.get("/api/me/meetings", async (c) => {
  const user=c.get("telegramUser");
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>();
  if(!member) return c.json({error:"Member account not linked"},404);
  const rows=await c.env.DB.prepare(`SELECT m.id,m.title,m.meeting_date,m.meeting_time,m.venue,m.agenda,m.status,m.cancel_reason,r.response rsvp,mm.minutes,mm.decisions FROM meetings m LEFT JOIN meeting_rsvps r ON r.meeting_id=m.id AND r.member_id=? LEFT JOIN meeting_minutes mm ON mm.meeting_id=m.id ORDER BY m.meeting_date DESC,m.meeting_time DESC LIMIT 100`).bind(member.id).all<any>();
  return c.json(rows.results);
});

app.get("/api/me/actions", async (c) => {
  const user=c.get("telegramUser");
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user.id)).first<any>();
  if(!member) return c.json({error:"Member account not linked"},404);
  const rows=await c.env.DB.prepare(`SELECT ai.id,ai.description,ai.due_date,ai.status,ai.created_at,ai.completed_at,m.id meeting_id,m.title meeting_title,m.meeting_date FROM meeting_action_items ai JOIN meetings m ON m.id=ai.meeting_id WHERE ai.assigned_member_id=? ORDER BY CASE ai.status WHEN 'open' THEN 0 ELSE 1 END,CASE WHEN ai.due_date IS NULL THEN 1 ELSE 0 END,ai.due_date DESC,ai.id DESC`).bind(member.id).all<any>();
  return c.json(rows.results);
});

app.get("/api/me/contributions", async (c) => {
  const user = c.get("telegramUser");
  const member = await c.env.DB.prepare(
    "SELECT id FROM members WHERE telegram_id = ? LIMIT 1"
  ).bind(String(user.id)).first<{ id: number }>();
  if (!member) return c.json({ error: "Member account not linked" }, 404);

  const rows = await c.env.DB.prepare(`
    SELECT id, txn_id, amount, month, ref_number, status, submitted_at, approved_at
    FROM contributions
    WHERE member_id = ?
    ORDER BY month DESC, submitted_at DESC
  `).bind(member.id).all();
  return c.json(rows.results);
});

app.get("/", async (c) => { const branding=await getBranding(c.env); return c.text(`${branding.short_name} Fund Worker — see /telegram/webhook and /api/*`); });

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env, _event.cron));
  },
};
