import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { currentMonth, generateTxnId, getSetting } from "../db";
import { auditEntity, ensureOperationalSchema, requireOpenMonth } from "../ops";
import { boundedText, money, validMonth } from "../validation";

export const expensesRoute = new Hono<AppEnv>();

expensesRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const rows = await c.env.DB.prepare(`SELECT e.id,e.txn_id,e.description,e.category_id,e.amount,e.logged_by,e.edited_by,e.transaction_month,
      e.status,e.approval_required,e.approved_by,e.approved_at,e.voided_by,e.voided_at,e.void_reason,e.created_at,e.updated_at,
      c.name category_name,la.name logged_by_name,aa.name approved_by_name
    FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id
    LEFT JOIN admins la ON la.id=e.logged_by LEFT JOIN admins aa ON aa.id=e.approved_by
    ORDER BY e.created_at DESC`).all();
  return c.json(rows.results);
});

async function validActiveCategory(c:any, categoryId:any) {
  if(categoryId===null || categoryId===undefined || categoryId==='') return {id:null};
  const id=Number(categoryId);
  if(!Number.isInteger(id) || id<=0) return null;
  return await c.env.DB.prepare("SELECT id,name FROM expense_categories WHERE id=? AND COALESCE(active,1)=1").bind(id).first<any>();
}

async function eligibleOtherFinanceAdmins(c:any, adminId:number) {
  const row = await c.env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE id != ? AND role IN ('owner','super_admin','treasurer') AND COALESCE(active,1)=1")
    .bind(adminId).first<{n:number}>();
  return Number(row?.n || 0);
}

expensesRoute.post("/", requireFinance, async (c) => {
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!;
  const body=await c.req.json<any>();
  const description=boundedText(body.description,500,true);
  const amount=money(body.amount);
  const month=body.month || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if(!description || amount===null) return c.json({error:"Description and valid positive amount are required"},400);
  if(!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  const category=await validActiveCategory(c,body.category_id);
  if(body.category_id && !category) return c.json({error:"Expense category is inactive or does not exist"},409);
  try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  const threshold=money(await getSetting(c.env,"expense_approval_threshold")) || 5000;
  const needsApproval=amount>=threshold && (await eligibleOtherFinanceAdmins(c,admin.id))>0;
  const txnId=await generateTxnId(c.env,"E");
  const res=await c.env.DB.prepare(`INSERT INTO expenses
    (txn_id,description,category_id,amount,logged_by,transaction_month,status,approval_required,approved_by,approved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(txnId,description,category?.id ?? null,amount,admin.id,month,needsApproval?"pending":"approved",needsApproval?1:0,needsApproval?null:admin.id,needsApproval?null:new Date().toISOString()).run();
  await auditEntity(c.env,admin.id,"expense_created","expense",Number(res.meta.last_row_id),null,{txn_id:txnId,description,amount,month,status:needsApproval?"pending":"approved"});
  return c.json({id:res.meta.last_row_id,txn_id:txnId,status:needsApproval?"pending":"approved",approval_required:needsApproval},201);
});

expensesRoute.post("/:id/approve", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:"Not found"},404);
  if(before.status!=="pending") return c.json({error:`Already ${before.status}`},409);
  if(Number(before.logged_by)===Number(admin.id)) return c.json({error:"A different finance admin must confirm this expense"},409);
  try{await requireOpenMonth(c.env,before.transaction_month||before.created_at.slice(0,7));}catch(e:any){return c.json({error:e.message},409);}
  const r=await c.env.DB.prepare("UPDATE expenses SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!r.meta.changes)return c.json({error:"Already reviewed"},409);
  const after=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"expense_approved","expense",id,before,after);
  return c.json({ok:true});
});

expensesRoute.post("/:id/reject", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Not found"},404);
  if(before.status!=="pending")return c.json({error:`Already ${before.status}`},409);
  const r=await c.env.DB.prepare("UPDATE expenses SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason='Rejected during approval' WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!r.meta.changes)return c.json({error:"Already reviewed"},409);
  const after=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"expense_rejected","expense",id,before,after);
  return c.json({ok:true});
});

expensesRoute.patch("/:id", requireFinance, async (c) => {
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const body=await c.req.json<any>();
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Not found"},404);
  if(before.status==='voided')return c.json({error:"Voided expenses cannot be edited"},409);
  const month=body.transaction_month??body.month??before.transaction_month??before.created_at.slice(0,7);
  if(!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  const description=boundedText(body.description??before.description,500,true);
  const amount=money(body.amount??before.amount);
  const requestedCategory=body.category_id===undefined?before.category_id:(body.category_id?Number(body.category_id):null);
  if(body.category_id!==undefined && Number(requestedCategory)!==Number(before.category_id)){
    const category=await validActiveCategory(c,requestedCategory);
    if(requestedCategory && !category) return c.json({error:"Expense category is inactive or does not exist"},409);
  }

  if(!description || amount===null) return c.json({error:"Description and valid positive amount are required"},400);
  const threshold=money(await getSetting(c.env,"expense_approval_threshold")) || 5000;
  const materialChanged = description!==before.description || Number(requestedCategory)!==Number(before.category_id) || Math.abs(amount-Number(before.amount))>0.004 || month!==(before.transaction_month??before.created_at.slice(0,7));
  let status=before.status, approvalRequired=Number(before.approval_required||0), approvedBy=before.approved_by, approvedAt=before.approved_at;
  if(materialChanged){
    const needsApproval=amount>=threshold && (await eligibleOtherFinanceAdmins(c,admin.id))>0;
    status=needsApproval?'pending':'approved'; approvalRequired=needsApproval?1:0; approvedBy=needsApproval?null:admin.id; approvedAt=needsApproval?null:new Date().toISOString();
  }
  await c.env.DB.prepare("UPDATE expenses SET description=?,category_id=?,amount=?,transaction_month=?,edited_by=?,updated_at=datetime('now'),status=?,approval_required=?,approved_by=?,approved_at=? WHERE id=?")
    .bind(description,requestedCategory,amount,month,admin.id,status,approvalRequired,approvedBy,approvedAt,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"expense_updated","expense",id,before,after); return c.json({ok:true,status:after.status,approval_required:after.approval_required});
});

expensesRoute.delete("/:id", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const body=await c.req.json().catch(()=>({})) as any;
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:"Not found"},404);
  const month=before.transaction_month||before.created_at.slice(0,7); try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  const reason=boundedText(body.reason,500) || "Voided by admin";
  await c.env.DB.prepare("UPDATE expenses SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=?")
    .bind(admin.id,reason,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"expense_voided","expense",id,before,after); return c.json({ok:true});
});

expensesRoute.get("/categories", requireAdmin, async(c)=>{ await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT *, COALESCE(active,1) active FROM expense_categories ORDER BY COALESCE(active,1) DESC, name").all()).results); });
expensesRoute.post("/categories", requireFinance, async(c)=>{const admin=c.get("admin")!;const b=await c.req.json<any>();const name=boundedText(b.name,100,true);if(!name)return c.json({error:'Valid category name required'},400);await c.env.DB.prepare("INSERT OR IGNORE INTO expense_categories(name) VALUES(?)").bind(name).run();await auditEntity(c.env,admin.id,"expense_category_created","expense_category",name,null,{name});return c.json({ok:true},201);});

expensesRoute.patch("/categories/:id", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const b=await c.req.json<any>();
  const before=await c.env.DB.prepare("SELECT * FROM expense_categories WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:"Category not found"},404);
  const name=b.name===undefined?before.name:boundedText(b.name,100,true); if(!name)return c.json({error:"Valid category name required"},400);
  const active=b.active===undefined?Number(before.active??1):(b.active?1:0);
  try{await c.env.DB.prepare("UPDATE expense_categories SET name=?,active=? WHERE id=?").bind(name,active,id).run();}catch{return c.json({error:"A category with this name already exists"},409);}
  const after=await c.env.DB.prepare("SELECT * FROM expense_categories WHERE id=?").bind(id).first<any>(); await auditEntity(c.env,admin.id,"expense_category_updated","expense_category",id,before,after); return c.json({ok:true});
});
expensesRoute.delete("/categories/:id", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const before=await c.env.DB.prepare("SELECT * FROM expense_categories WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:"Category not found"},404);
  const used=await c.env.DB.prepare("SELECT COUNT(*) n FROM expenses WHERE category_id=?").bind(id).first<any>();
  if(Number(used?.n||0)>0){ await c.env.DB.prepare("UPDATE expense_categories SET active=0 WHERE id=?").bind(id).run(); await auditEntity(c.env,admin.id,"expense_category_deactivated","expense_category",id,before,{...before,active:0}); return c.json({ok:true,deactivated:true}); }
  await c.env.DB.prepare("DELETE FROM expense_categories WHERE id=?").bind(id).run(); await auditEntity(c.env,admin.id,"expense_category_deleted","expense_category",id,before,null); return c.json({ok:true,deleted:true});
});
