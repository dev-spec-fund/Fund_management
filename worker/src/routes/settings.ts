import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireSuperAdmin } from "../auth";
import { logAudit, setSetting } from "../db";
import { adminCan, auditEntity, ensureOperationalSchema, sanitizeAuditDetailForRole } from "../ops";
import { boundedText, telegramId } from "../validation";

export const settingsRoute = new Hono<AppEnv>();

const FINANCE_SETTINGS = new Set(["reminder_day","notify_new_slip","notify_member_deactivated","notify_budget_exceeded","notify_monthly_report"]);
const SUPER_SETTINGS = new Set(["fund_name","short_name","default_monthly_amount","expense_approval_threshold","mini_app_url","reminder_schedule","show_projects_to_members"]);
const ROLE_PERMISSIONS = ["read","finance","manage_admins","close_month","backup"] as const;
const BUILTIN_ROLES = new Set(["super_admin","treasurer","viewer"]);

function normalizeRolePermissions(value:any): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x:any)=>String(x||"").trim()).filter((x:string)=>ROLE_PERMISSIONS.includes(x as any)))];
}

async function validCustomRole(env:any, id:any) {
  const roleId=Number(id);
  if(!Number.isInteger(roleId)||roleId<=0) return null;
  return await env.DB.prepare("SELECT id,name,description,active FROM admin_roles WHERE id=? AND COALESCE(active,1)=1").bind(roleId).first<any>();
}

settingsRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare("SELECT * FROM settings").all<{key:string;value:string}>();
  const obj:Record<string,string>={}; for(const r of rows.results)obj[r.key]=r.value; return c.json(obj);
});

settingsRoute.patch("/", requireFinance, async (c) => {
  const admin=c.get("admin")!; const body=await c.req.json<Record<string,unknown>>();
  const isSuper=adminCan(admin,'manage_admins');
  for(const [key,raw] of Object.entries(body)) {
    if(!FINANCE_SETTINGS.has(key) && !(isSuper && SUPER_SETTINGS.has(key))) return c.json({error:`Setting '${key}' cannot be changed by this role`},403);
    const value=String(raw ?? '').trim();
    if(key==='fund_name' && (value.length<2 || value.length>120)) return c.json({error:'Group Name must be 2-120 characters'},400);
    if(key==='short_name' && (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/.test(value))) return c.json({error:'Short Name must be 1-20 letters, numbers, spaces, dots, hyphens or underscores'},400);
    if(key==='expense_approval_threshold' && (!Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>100000000)) return c.json({error:'Invalid expense approval threshold'},400);
    if(key==='default_monthly_amount' && (!Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>1000000)) return c.json({error:'Invalid default monthly amount'},400);
    if(key==='mini_app_url') { try { const u=new URL(value); if(u.protocol!=='https:') return c.json({error:'Mini App URL must use HTTPS'},400); } catch { return c.json({error:'Invalid Mini App URL'},400); } }
    if(key==='reminder_day' && value!=='off' && (!/^\d{1,2}$/.test(value) || Number(value)<1 || Number(value)>28)) return c.json({error:"Reminder day must be 1-28 or 'off'"},400);
    if((key.startsWith('notify_') || key==='show_projects_to_members') && !['0','1'].includes(value)) return c.json({error:`${key} must be 0 or 1`},400);
    if(value.length>500) return c.json({error:`${key} is too long`},400);
    await setSetting(c.env,key,value);
  }
  await logAudit(c.env,admin.id,"settings_updated",JSON.stringify({keys:Object.keys(body)})); return c.json({ok:true});
});

settingsRoute.get("/admins", requireAdmin, async(c)=>{
  const caller=c.get("admin")!;
  const viewer=!adminCan(caller,"finance");
  const rows=await c.env.DB.prepare(`
    SELECT a.id,${viewer ? "NULL" : "a.telegram_id"} telegram_id,a.name,a.role,a.custom_role_id,
           r.name custom_role_name,COALESCE(a.active,1) active,a.created_at,a.deactivated_at,
           m.id member_id,m.member_code,m.name member_name,COALESCE(m.active,1) member_active
    FROM admins a
    LEFT JOIN admin_roles r ON r.id=a.custom_role_id
    LEFT JOIN members m ON m.telegram_id=a.telegram_id
    ORDER BY a.name
  `).all<any>();
  return c.json(rows.results);
});

settingsRoute.get("/roles", requireAdmin, async(c)=>{
  const roles=await c.env.DB.prepare(`
    SELECT r.id,r.name,r.description,COALESCE(r.active,1) active,r.created_at,r.updated_at,
           GROUP_CONCAT(p.permission) permissions_csv,
           (SELECT COUNT(*) FROM admins a WHERE a.custom_role_id=r.id AND COALESCE(a.active,1)=1) assigned_admins
    FROM admin_roles r
    LEFT JOIN admin_role_permissions p ON p.role_id=r.id
    WHERE COALESCE(r.active,1)=1
    GROUP BY r.id
    ORDER BY r.name
  `).all<any>();
  return c.json(roles.results.map((r:any)=>({
    ...r,
    permissions:String(r.permissions_csv||"").split(",").filter(Boolean),
    permissions_csv:undefined,
  })));
});

settingsRoute.post("/roles", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;
  const b=await c.req.json<any>();
  const name=boundedText(b.name,60,true);
  const description=boundedText(b.description,240);
  const permissions=normalizeRolePermissions(b.permissions);
  if(!name)return c.json({error:"Role name is required"},400);
  if(!permissions.includes("read")) permissions.unshift("read");
  try{
    const r=await c.env.DB.prepare("INSERT INTO admin_roles(name,description,created_by) VALUES(?,?,?)").bind(name,description||null,admin.id).run();
    const id=Number(r.meta.last_row_id);
    if(permissions.length) await c.env.DB.batch(permissions.map(permission=>c.env.DB.prepare("INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)").bind(id,permission)));
    await auditEntity(c.env,admin.id,"admin_role_created","admin_role",id,null,{name,description,permissions});
    return c.json({ok:true,id},201);
  }catch(e:any){
    if(String(e?.message||"").toLowerCase().includes("unique"))return c.json({error:"A role with this name already exists"},409);
    throw e;
  }
});

settingsRoute.patch("/roles/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM admin_roles WHERE id=? AND COALESCE(active,1)=1").bind(id).first<any>();
  if(!before)return c.json({error:"Role not found"},404);
  const b=await c.req.json<any>();
  const name=b.name===undefined?before.name:boundedText(b.name,60,true);
  const description=b.description===undefined?before.description:boundedText(b.description,240);
  const permissions=b.permissions===undefined
    ? (await c.env.DB.prepare("SELECT permission FROM admin_role_permissions WHERE role_id=?").bind(id).all<any>()).results.map((x:any)=>x.permission)
    : normalizeRolePermissions(b.permissions);
  if(!name)return c.json({error:"Role name is required"},400);
  if(!permissions.includes("read")) permissions.unshift("read");
  await c.env.DB.prepare("UPDATE admin_roles SET name=?,description=?,updated_at=datetime('now') WHERE id=?").bind(name,description||null,id).run();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM admin_role_permissions WHERE role_id=?").bind(id),
    ...permissions.map(permission=>c.env.DB.prepare("INSERT INTO admin_role_permissions(role_id,permission) VALUES(?,?)").bind(id,permission)),
  ]);
  await auditEntity(c.env,admin.id,"admin_role_updated","admin_role",id,before,{name,description,permissions});
  return c.json({ok:true});
});

settingsRoute.delete("/roles/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const role=await c.env.DB.prepare("SELECT * FROM admin_roles WHERE id=? AND COALESCE(active,1)=1").bind(id).first<any>();
  if(!role)return c.json({error:"Role not found"},404);
  const used=await c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE custom_role_id=? AND COALESCE(active,1)=1").bind(id).first<{n:number}>();
  if(Number(used?.n||0)>0)return c.json({error:"This role is assigned to active admins. Reassign them first."},409);
  await c.env.DB.prepare("UPDATE admin_roles SET active=0,updated_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,admin.id,"admin_role_deactivated","admin_role",id,role,{...role,active:0});
  return c.json({ok:true});
});

settingsRoute.post("/admins", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const b=await c.req.json<any>();
  const role=String(b.role||"treasurer"); if(!BUILTIN_ROLES.has(role))return c.json({error:"Invalid built-in role"},400);
  const customRole=b.custom_role_id?await validCustomRole(c.env,b.custom_role_id):null;
  if(b.custom_role_id && !customRole)return c.json({error:"Custom role not found"},400);
  const tg=telegramId(b.telegram_id); const name=boundedText(b.name,120,true); if(!tg||!name)return c.json({error:'Valid Telegram ID and name are required'},400);
  const existing=await c.env.DB.prepare("SELECT id,active FROM admins WHERE telegram_id=?").bind(tg).first<any>();
  if(existing) return c.json({error:"An admin record already exists for this Telegram account"},409);
  const r=await c.env.DB.prepare("INSERT INTO admins(telegram_id,name,role,custom_role_id,active) VALUES(?,?,?,?,1)").bind(tg,name,role,customRole?.id||null).run();
  await auditEntity(c.env,admin.id,"admin_created","admin",Number(r.meta.last_row_id),null,{telegram_id:tg,name,role}); return c.json({ok:true,id:r.meta.last_row_id},201);
});


settingsRoute.post("/admins/promote-member", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const b=await c.req.json<any>(); const memberId=Number(b.member_id); const role=String(b.role||"treasurer");
  if(!BUILTIN_ROLES.has(role))return c.json({error:"Invalid built-in role"},400);
  const customRole=b.custom_role_id?await validCustomRole(c.env,b.custom_role_id):null;
  if(b.custom_role_id && !customRole)return c.json({error:"Custom role not found"},400);
  const member=await c.env.DB.prepare("SELECT id,name,telegram_id FROM members WHERE id=? AND COALESCE(active,1)=1").bind(memberId).first<any>();
  if(!member)return c.json({error:"Active member not found"},404); if(!member.telegram_id)return c.json({error:"This member must link Telegram before being promoted"},409);
  const existing=await c.env.DB.prepare("SELECT * FROM admins WHERE telegram_id=?").bind(member.telegram_id).first<any>();
  if(existing){ await c.env.DB.prepare("UPDATE admins SET name=?,role=?,custom_role_id=?,active=1,deactivated_at=NULL,deactivated_by=NULL WHERE id=?").bind(member.name,role,customRole?.id||null,existing.id).run(); await auditEntity(c.env,admin.id,"member_promoted_to_admin","member",memberId,existing,{...existing,name:member.name,role,active:1}); return c.json({ok:true,id:existing.id}); }
  const r=await c.env.DB.prepare("INSERT INTO admins(telegram_id,name,role,custom_role_id,active) VALUES(?,?,?,?,1)").bind(member.telegram_id,member.name,role,customRole?.id||null).run(); await auditEntity(c.env,admin.id,"member_promoted_to_admin","member",memberId,null,{admin_id:r.meta.last_row_id,role}); return c.json({ok:true,id:r.meta.last_row_id},201);
});

async function activeSuperCount(c:any, excludeId?:number){
  const q=excludeId?c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE id!=? AND COALESCE(active,1)=1 AND role IN ('owner','super_admin')").bind(excludeId):c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE COALESCE(active,1)=1 AND role IN ('owner','super_admin')");
  const row=await q.first<{n:number}>(); return Number(row?.n||0);
}

settingsRoute.patch("/admins/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const b=await c.req.json<any>();
  const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Not found"},404);

  const role=String(b.role??(before.role==="owner"?"super_admin":before.role));
  if(!BUILTIN_ROLES.has(role))return c.json({error:"Invalid built-in role"},400);
  const customRoleId=b.custom_role_id===undefined ? (before.custom_role_id||null) : (b.custom_role_id||null);
  const customRole=customRoleId?await validCustomRole(c.env,customRoleId):null;
  if(customRoleId && !customRole)return c.json({error:"Custom role not found"},400);

  if(['owner','super_admin'].includes(before.role) && !['owner','super_admin'].includes(role) && await activeSuperCount(c,id)===0)
    return c.json({error:'At least one active Super Admin must remain'},409);

  const name=b.name===undefined?before.name:boundedText(b.name,120,true);
  if(!name)return c.json({error:'Valid admin name required'},400);
  await c.env.DB.prepare("UPDATE admins SET name=?,role=?,custom_role_id=? WHERE id=?").bind(name,role,customRole?.id||null,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"admin_updated","admin",id,before,after);
  return c.json({ok:true});
});


settingsRoute.post("/admins/:id/demote-member", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;
  const id=Number(c.req.param("id"));
  if(id===admin.id) return c.json({error:"You cannot demote your own admin access"},409);

  const before=await c.env.DB.prepare(`
    SELECT a.*,m.id member_id,m.member_code,m.name member_name
    FROM admins a
    LEFT JOIN members m ON m.telegram_id=a.telegram_id
    WHERE a.id=?
  `).bind(id).first<any>();
  if(!before) return c.json({error:"Admin not found"},404);
  if(!before.member_id) return c.json({error:"This admin is not linked to an existing member account"},409);
  if(Number(before.active||0)===0) return c.json({error:"Admin access is already inactive"},409);

  if(['owner','super_admin'].includes(before.role) && await activeSuperCount(c,id)===0)
    return c.json({error:'At least one active Super Admin must remain'},409);

  await c.env.DB.prepare(`
    UPDATE admins
    SET active=0,deactivated_at=datetime('now'),deactivated_by=?
    WHERE id=?
  `).bind(admin.id,id).run();

  const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"member_demoted_to_member","member",Number(before.member_id),
    {admin_id:id,role:before.role,active:before.active},
    {admin_id:id,role:before.role,active:0,member_code:before.member_code}
  );
  return c.json({ok:true,member_id:before.member_id,member_code:before.member_code});
});

settingsRoute.delete("/admins/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;const id=Number(c.req.param("id"));if(id===admin.id)return c.json({error:"You cannot remove your own admin access"},409);
  const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);
  if(['owner','super_admin'].includes(before.role) && await activeSuperCount(c,id)===0) return c.json({error:'At least one active Super Admin must remain'},409);
  await c.env.DB.prepare("UPDATE admins SET active=0,deactivated_at=datetime('now'),deactivated_by=? WHERE id=?").bind(admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();await auditEntity(c.env,admin.id,"admin_deactivated","admin",id,before,after);return c.json({ok:true});
});
settingsRoute.get("/audit-log", requireFinance, async(c)=>{
  const rows=await c.env.DB.prepare(`SELECT al.id,al.admin_id,al.action,al.detail,al.created_at,a.name admin_name,a.role admin_role FROM audit_log al LEFT JOIN admins a ON a.id=al.admin_id ORDER BY al.created_at DESC LIMIT 500`).all<any>();
  return c.json(rows.results.map((row:any)=>({...row,detail:sanitizeAuditDetailForRole(row.detail, c.get("admin")?.role)})));
});
