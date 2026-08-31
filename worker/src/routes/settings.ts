import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireSuperAdmin } from "../auth";
import { logAudit, setSetting } from "../db";
import { auditEntity, ensureOperationalSchema } from "../ops";

export const settingsRoute = new Hono<AppEnv>();

settingsRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare("SELECT * FROM settings").all<{key:string;value:string}>();
  const obj:Record<string,string>={}; for(const r of rows.results)obj[r.key]=r.value; return c.json(obj);
});

settingsRoute.patch("/", requireFinance, async (c) => {
  const admin=c.get("admin")!; const body=await c.req.json<Record<string,string>>();
  for(const [key,value] of Object.entries(body)) await setSetting(c.env,key,String(value));
  await logAudit(c.env,admin.id,"settings_updated",Object.keys(body).join(", ")); return c.json({ok:true});
});

settingsRoute.get("/admins", requireAdmin, async(c)=>c.json((await c.env.DB.prepare("SELECT id,telegram_id,name,role,created_at FROM admins ORDER BY name").all()).results));
settingsRoute.post("/admins", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!; const b=await c.req.json<{telegram_id:string;name:string;role?:"super_admin"|"treasurer"|"viewer"}>();
  const role=b.role||"treasurer"; if(!["super_admin","treasurer","viewer"].includes(role))return c.json({error:"Invalid role"},400);
  const r=await c.env.DB.prepare("INSERT INTO admins(telegram_id,name,role) VALUES(?,?,?)").bind(String(b.telegram_id),b.name.trim(),role).run();
  await auditEntity(c.env,admin.id,"admin_created","admin",Number(r.meta.last_row_id),null,{telegram_id:b.telegram_id,name:b.name,role}); return c.json({ok:true,id:r.meta.last_row_id},201);
});
settingsRoute.patch("/admins/:id", requireSuperAdmin, async(c)=>{
  const admin=c.get("admin")!;const id=Number(c.req.param("id"));const b=await c.req.json<{name?:string;role?:"super_admin"|"treasurer"|"viewer"}>();const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);
  const role=b.role??(before.role==="owner"?"super_admin":before.role);if(!["super_admin","treasurer","viewer"].includes(role))return c.json({error:"Invalid role"},400);
  await c.env.DB.prepare("UPDATE admins SET name=?,role=? WHERE id=?").bind(b.name??before.name,role,id).run();const after=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();await auditEntity(c.env,admin.id,"admin_updated","admin",id,before,after);return c.json({ok:true});
});
settingsRoute.delete("/admins/:id", requireSuperAdmin, async(c)=>{const admin=c.get("admin")!;const id=Number(c.req.param("id"));if(id===admin.id)return c.json({error:"You cannot remove your own admin access"},409);const before=await c.env.DB.prepare("SELECT * FROM admins WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);await c.env.DB.prepare("DELETE FROM admins WHERE id=?").bind(id).run();await auditEntity(c.env,admin.id,"admin_removed","admin",id,before,null);return c.json({ok:true})});
settingsRoute.get("/audit-log", requireAdmin, async(c)=>{const rows=await c.env.DB.prepare(`SELECT al.*,a.name admin_name,a.role admin_role FROM audit_log al LEFT JOIN admins a ON a.id=al.admin_id ORDER BY al.created_at DESC LIMIT 500`).all();return c.json(rows.results)});
