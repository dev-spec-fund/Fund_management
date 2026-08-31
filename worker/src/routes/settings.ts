import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireSuperAdmin } from "../auth";
import { logAudit, setSetting } from "../db";
import { auditEntity, ensureOperationalSchema, sanitizeAuditDetail } from "../ops";
import { boundedText, telegramId } from "../validation";

export const settingsRoute = new Hono<AppEnv>();

const FINANCE_SETTINGS = new Set(["reminder_day","notify_new_slip","notify_member_deactivated","notify_budget_exceeded","notify_monthly_report"]);
const SUPER_SETTINGS = new Set(["fund_name","default_monthly_amount","expense_approval_threshold","mini_app_url","reminder_schedule"]);

settingsRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare("SELECT * FROM settings").all<{key:string;value:string}>();
  const obj:Record<string,string>={}; for(const r of rows.results)obj[r.key]=r.value; return c.json(obj);
});

settingsRoute.patch("/", requireFinance, async (c) => {
  const admin=c.get("admin")!; const body=await c.req.json<Record<string,unknown>>();
  const isSuper=admin.role==='owner'||admin.role==='super_admin';
  for(const [key,raw] of Object.entries(body)) {
    if(!FINANCE_SETTINGS.has(key) && !(isSuper && SUPER_SETTINGS.has(key))) return c.json({error:`Setting '${key}' cannot be changed by this role`},403);
    const value=String(raw ?? '').trim();
    if(key==='expense_approval_threshold' && (!Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>100000000)) return c.json({error:'Invalid expense approval threshold'},400);
    if(key==='default_monthly_amount' && (!Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>1000000)) return c.json({error:'Invalid default monthly amount'},400);
    if(key==='reminder_day' && value!=='off' && (!/^\d{1,2}$/.test(value) || Number(value)<1 || Number(value)>28)) return c.json({error:"Reminder day must be 1-28 or 'off'"},400);
    if(key.startsWith('notify_') && !['0','1'].includes(value)) return c.json({error:`${key} must be 0 or 1`},400);
    if(value.length>500) return c.json({error:`${key} is too long`},400);
    await setSetting(c.env,key,value);
  }
  await logAudit(c.env,admin.id,"settings_updated",JSON.stringify({keys:Object.keys(body)})); return c.json({ok:true});
});

settingsRoute.get("/admins", requireAdmin, async(c)=>c.json((await c.env.DB.prepare("SELECT id,telegram_id,name,role,COALESCE(active,1) active,created_at,deactivated_at FROM admins ORDER BY name").all()).results));
settingsRoute.post("/admins", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const b=await c.req.json<any>();
  const role=b.role||"treasurer"; if(!["super_admin","treasurer","viewer"].includes(role))return c.json({error:"Invalid role"},400);
  const tg=telegramId(b.telegram_id); const name=boundedText(b.name,120,true); if(!tg||!name)return c.json({error:'Valid Telegram ID and name are required'},400);
  const r=await c.env.DB.prepare("INSERT INTO admins(telegram_id,name,role,active) VALUES(?,?,?,1)").bind(tg,name,role).run();
  await auditEntity(c.env,admin.id,"admin_created","admin",Number(r.meta.last_row_id),null,{telegram_id:tg,name,role}); return c.json({ok:true,id:r.meta.last_row_id},201);
});

async function activeSuperCount(c:any, excludeId?:number){
  const q=excludeId?c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE id!=? AND COALESCE(active,1)=1 AND role IN ('owner','super_admin')").bind(excludeId):c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE COALESCE(active,1)=1 AND role IN ('owner','super_admin')");
  const row=await q.first<{n:number}>(); return Number(row?.n||0);
}

settingsRoute.patch("/admins/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;const id=Number(c.req.param("id"));const b=await c.req.json<any>();const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);
  const role=b.role??(before.role==="owner"?"super_admin":before.role);if(!["super_admin","treasurer","viewer"].includes(role))return c.json({error:"Invalid role"},400);
  if(['owner','super_admin'].includes(before.role) && !['owner','super_admin'].includes(role) && await activeSuperCount(c,id)===0) return c.json({error:'At least one active Super Admin must remain'},409);
  const name=b.name===undefined?before.name:boundedText(b.name,120,true); if(!name)return c.json({error:'Valid admin name required'},400);
  await c.env.DB.prepare("UPDATE admins SET name=?,role=? WHERE id=?").bind(name,role,id).run();const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();await auditEntity(c.env,admin.id,"admin_updated","admin",id,before,after);return c.json({ok:true});
});

settingsRoute.delete("/admins/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;const id=Number(c.req.param("id"));if(id===admin.id)return c.json({error:"You cannot remove your own admin access"},409);
  const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);
  if(['owner','super_admin'].includes(before.role) && await activeSuperCount(c,id)===0) return c.json({error:'At least one active Super Admin must remain'},409);
  await c.env.DB.prepare("UPDATE admins SET active=0,deactivated_at=datetime('now'),deactivated_by=? WHERE id=?").bind(admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();await auditEntity(c.env,admin.id,"admin_deactivated","admin",id,before,after);return c.json({ok:true});
});
settingsRoute.get("/audit-log", requireAdmin, async(c)=>{
  const rows=await c.env.DB.prepare(`SELECT al.id,al.admin_id,al.action,al.detail,al.created_at,a.name admin_name,a.role admin_role FROM audit_log al LEFT JOIN admins a ON a.id=al.admin_id ORDER BY al.created_at DESC LIMIT 500`).all<any>();
  return c.json(rows.results.map((row:any)=>({...row,detail:sanitizeAuditDetail(row.detail)})));
});
