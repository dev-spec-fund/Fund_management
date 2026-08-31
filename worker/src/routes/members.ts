import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { logAudit, generateMemberCode } from "../db";
import { auditEntity, ensureOperationalSchema, findDuplicateMembers, requireOpenMonth } from "../ops";

export const membersRoute = new Hono<{ Bindings: Env }>();

membersRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare("SELECT * FROM members ORDER BY name").all();
  return c.json(rows.results);
});

membersRoute.get("/:id", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const id = c.req.param("id");
  const member = await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
  if (!member) return c.json({ error: "Not found" }, 404);
  const contributions = await c.env.DB.prepare(
    "SELECT * FROM contributions WHERE member_id = ? ORDER BY month DESC, submitted_at DESC"
  ).bind(id).all();
  return c.json({ ...member, contributions: contributions.results });
});

membersRoute.get("/:id/monthly-status", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);
  const member = await c.env.DB.prepare("SELECT id,monthly_amount FROM members WHERE id=?").bind(id).first<any>();
  if (!member) return c.json({error:"Not found"},404);
  const ex = await c.env.DB.prepare("SELECT reason FROM exemptions WHERE member_id=? AND month=?").bind(id,month).first<any>();
  const paid = await c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE member_id=? AND month=? AND status='approved'").bind(id,month).first<any>();
  const total = Number(paid?.total || 0);
  const status = ex ? "exempt" : total <= 0 ? "unpaid" : total + 0.005 < Number(member.monthly_amount) ? "partial" : "paid";
  return c.json({month,status,paid:total,due:Math.max(0,Number(member.monthly_amount)-total),monthly_amount:Number(member.monthly_amount),exemption_reason:ex?.reason||null});
});

membersRoute.get("/:id/statement", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const id = Number(c.req.param("id"));
  const member = await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(id).first<any>();
  if (!member) return c.json({error:"Not found"},404);
  const contributions = await c.env.DB.prepare(`SELECT txn_id,amount,month,ref_number,status,submitted_at,approved_at FROM contributions WHERE member_id=? ORDER BY month,submitted_at`).bind(id).all<any>();
  const exemptions = await c.env.DB.prepare("SELECT month,reason,created_at FROM exemptions WHERE member_id=? ORDER BY month").bind(id).all<any>();
  const donations = await c.env.DB.prepare(`SELECT txn_id,donor_name,amount,note,transaction_month,status,created_at FROM donations
    WHERE COALESCE(status,'active')='active' AND lower(trim(donor_name))=lower(trim(?)) ORDER BY created_at`).bind(member.name).all<any>();
  const approved = contributions.results.filter((x:any)=>x.status==='approved');
  const balanceItems=[...approved.map((r:any)=>({at:r.approved_at||r.submitted_at,txn_id:r.txn_id,amount:Number(r.amount||0),kind:'contribution'})),...donations.results.map((r:any)=>({at:r.created_at,txn_id:r.txn_id,amount:Number(r.amount||0),kind:'donation'}))].sort((a:any,b:any)=>String(a.at).localeCompare(String(b.at)));
  const balanceHistory:any[]=[];
  let running=0;
  for (const r of balanceItems) { running += Number(r.amount||0); balanceHistory.push({...r,balance:running}); }
  const firstMonth = member.joined_at?.slice(0,7) || new Date().toISOString().slice(0,7);
  const nowMonth = new Date().toISOString().slice(0,7);
  const months:string[]=[]; let [y,m]=firstMonth.split('-').map(Number); const [ey,em]=nowMonth.split('-').map(Number);
  while (y<ey || (y===ey && m<=em)) { months.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} }
  const exSet = new Map(exemptions.results.map((x:any)=>[x.month,x]));
  const statuses = months.map(month=>{
    const paid=approved.filter((x:any)=>x.month===month).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
    const ex=exSet.get(month) as any;
    const status=ex?'exempt':paid<=0?'unpaid':paid+0.005<Number(member.monthly_amount)?'partial':'paid';
    return {month,status,paid,due:ex?0:Math.max(0,Number(member.monthly_amount)-paid),reason:ex?.reason||null};
  });
  return c.json({member,contributions:contributions.results,donations:donations.results,monthly_status:statuses,balance_history:balanceHistory});
});

membersRoute.post("/", requireFinance, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json<{ name: string; phone?: string; monthly_amount?: number; telegram_id?:string }>();
  const duplicates = await findDuplicateMembers(c.env, body.name, body.phone, body.telegram_id);
  if (duplicates.length) return c.json({error:"Possible duplicate member",duplicates},409);
  const memberCode = await generateMemberCode(c.env);
  const res = await c.env.DB.prepare(
    "INSERT INTO members (member_code, telegram_id, name, phone, monthly_amount) VALUES (?, ?, ?, ?, ?)"
  ).bind(memberCode, body.telegram_id || null, body.name.trim(), body.phone || null, body.monthly_amount || 250).run();
  await auditEntity(c.env, admin.id, "member_created", "member", Number(res.meta.last_row_id), null, {member_code:memberCode,...body});
  return c.json({ id: res.meta.last_row_id, member_code: memberCode }, 201);
});

membersRoute.patch("/:id", requireFinance, async (c) => {
  const admin = c.get("admin"); const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string; phone?: string; monthly_amount?: number; active?: number; telegram_id?:string|null }>();
  const before = await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<any>();
  if (!before) return c.json({ error: "Not found" }, 404);
  const duplicates = await findDuplicateMembers(c.env, body.name ?? before.name, body.phone ?? before.phone, body.telegram_id ?? before.telegram_id, id);
  if (duplicates.length) return c.json({error:"Possible duplicate member",duplicates},409);
  await c.env.DB.prepare("UPDATE members SET name=?,phone=?,monthly_amount=?,active=?,telegram_id=? WHERE id=?")
    .bind(body.name??before.name,body.phone??before.phone,body.monthly_amount??before.monthly_amount,body.active??before.active,body.telegram_id===undefined?before.telegram_id:body.telegram_id,id).run();
  const after = await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,body.active!==undefined&&body.active!==before.active?(body.active?"member_reactivated":"member_deactivated"):"member_updated","member",id,before,after);
  return c.json({ok:true});
});

membersRoute.post("/:id/exempt", requireFinance, async (c) => {
  const admin = c.get("admin"); const id = c.req.param("id");
  const body = await c.req.json<{ month: string; reason?: string }>();
  try { await requireOpenMonth(c.env,body.month); } catch(e:any){ return c.json({error:e.message},409); }
  await c.env.DB.prepare("INSERT OR REPLACE INTO exemptions (member_id,month,reason,granted_by) VALUES (?,?,?,?)")
    .bind(id,body.month,body.reason||null,admin.id).run();
  await logAudit(c.env,admin.id,"member_exempted",`Member #${id} — ${body.month} — ${body.reason||''}`);
  return c.json({ok:true});
});
