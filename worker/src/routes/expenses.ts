import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { generateTxnId, getSetting } from "../db";
import { auditEntity, ensureOperationalSchema, requireOpenMonth } from "../ops";

export const expensesRoute = new Hono<{ Bindings: Env }>();

expensesRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare(`SELECT e.*,c.name category_name,la.name logged_by_name,aa.name approved_by_name
    FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id
    LEFT JOIN admins la ON la.id=e.logged_by LEFT JOIN admins aa ON aa.id=e.approved_by
    ORDER BY e.created_at DESC`).all();
  return c.json(rows.results);
});

expensesRoute.post("/", requireFinance, async (c) => {
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin");
  const body=await c.req.json<{description:string;category_id?:number;amount:number;month?:string}>();
  if(!body.description?.trim()||!Number.isFinite(Number(body.amount))||Number(body.amount)<=0) return c.json({error:"Description and valid amount are required"},400);
  const month=body.month||new Date().toISOString().slice(0,7);
  try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  const adminCount=await c.env.DB.prepare("SELECT COUNT(*) n FROM admins").first<{n:number}>();
  const threshold=Number(await getSetting(c.env,"expense_approval_threshold"))||5000;
  const needsApproval=Number(body.amount)>=threshold && Number(adminCount?.n||0)>1;
  const txnId=await generateTxnId(c.env,"E");
  const res=await c.env.DB.prepare(`INSERT INTO expenses
    (txn_id,description,category_id,amount,logged_by,transaction_month,status,approval_required,approved_by,approved_at)
    VALUES(?,?,?,?,?,?,?, ?, ?, ?)`)
    .bind(txnId,body.description.trim(),body.category_id||null,Number(body.amount),admin.id,month,needsApproval?"pending":"approved",needsApproval?1:0,needsApproval?null:admin.id,needsApproval?null:new Date().toISOString()).run();
  await auditEntity(c.env,admin.id,"expense_created","expense",Number(res.meta.last_row_id),null,{txn_id:txnId,...body,month,status:needsApproval?"pending":"approved"});
  return c.json({id:res.meta.last_row_id,txn_id:txnId,status:needsApproval?"pending":"approved",approval_required:needsApproval},201);
});

expensesRoute.post("/:id/approve", requireFinance, async(c)=>{
  const admin=c.get("admin"); const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:"Not found"},404);
  if(before.status!=="pending") return c.json({error:`Already ${before.status}`},409);
  if(Number(before.logged_by)===Number(admin.id)) return c.json({error:"A different admin must confirm this expense"},409);
  try{await requireOpenMonth(c.env,before.transaction_month||before.created_at.slice(0,7));}catch(e:any){return c.json({error:e.message},409);}
  const r=await c.env.DB.prepare("UPDATE expenses SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!r.meta.changes)return c.json({error:"Already reviewed"},409);
  await auditEntity(c.env,admin.id,"expense_approved","expense",id,before,{...before,status:"approved",approved_by:admin.id});
  return c.json({ok:true});
});

expensesRoute.post("/:id/reject", requireFinance, async(c)=>{
  const admin=c.get("admin"); const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Not found"},404);
  if(before.status!=="pending")return c.json({error:`Already ${before.status}`},409);
  const r=await c.env.DB.prepare("UPDATE expenses SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason='Rejected during approval' WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!r.meta.changes)return c.json({error:"Already reviewed"},409);
  await auditEntity(c.env,admin.id,"expense_rejected","expense",id,before,{...before,status:"voided"});
  return c.json({ok:true});
});

expensesRoute.patch("/:id", requireFinance, async (c) => {
  const admin=c.get("admin"); const id=Number(c.req.param("id")); const body=await c.req.json<any>();
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Not found"},404); if(before.status==='voided')return c.json({error:"Voided expenses cannot be edited"},409);
  const month=body.month??before.transaction_month??before.created_at.slice(0,7); try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  await c.env.DB.prepare("UPDATE expenses SET description=?,category_id=?,amount=?,transaction_month=?,edited_by=?,updated_at=datetime('now') WHERE id=?")
    .bind(body.description??before.description,body.category_id??before.category_id,body.amount??before.amount,month,admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"expense_updated","expense",id,before,after); return c.json({ok:true});
});

expensesRoute.delete("/:id", requireFinance, async(c)=>{
  const admin=c.get("admin"); const id=Number(c.req.param("id")); const body=await c.req.json().catch(()=>({})) as any;
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:"Not found"},404);
  const month=before.transaction_month||before.created_at.slice(0,7); try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  await c.env.DB.prepare("UPDATE expenses SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=?")
    .bind(admin.id,body.reason||"Voided by admin",id).run();
  await auditEntity(c.env,admin.id,"expense_voided","expense",id,before,{...before,status:"voided",void_reason:body.reason||"Voided by admin"}); return c.json({ok:true});
});

expensesRoute.get("/categories", requireAdmin, async(c)=>c.json((await c.env.DB.prepare("SELECT * FROM expense_categories ORDER BY name").all()).results));
expensesRoute.post("/categories", requireFinance, async(c)=>{const admin=c.get("admin");const b=await c.req.json<{name:string}>();await c.env.DB.prepare("INSERT OR IGNORE INTO expense_categories(name) VALUES(?)").bind(b.name.trim()).run();await auditEntity(c.env,admin.id,"expense_category_created","expense_category",b.name,null,b);return c.json({ok:true},201);});
