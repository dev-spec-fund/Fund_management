import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { currentDate, generateTxnId, getSetting } from "../db";
import { adminCan, auditEntity, availableFundBalance, ensureOperationalSchema, requireOpenMonth } from "../ops";
import { boundedText, money, validDate, validMonth } from "../validation";

export const expensesRoute = new Hono<AppEnv>();

expensesRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const month=String(c.req.query("month")||"").trim();
  const status=String(c.req.query("status")||"").trim();
  const q=String(c.req.query("q")||"").trim().slice(0,100);
  if(month && !validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  if(status && !["pending","approved","reversed","voided"].includes(status)) return c.json({error:"Invalid expense status"},400);
  const where:string[]=[]; const vals:any[]=[];
  if(month){where.push("e.transaction_month=?");vals.push(month);}
  if(status){where.push("e.status=?");vals.push(status);}
  if(q){where.push("(e.description LIKE ? OR e.txn_id LIKE ? OR c.name LIKE ? OR p.name LIKE ?)");const like=`%${q}%`;vals.push(like,like,like,like);}
  const rows = await c.env.DB.prepare(`SELECT e.id,e.txn_id,e.description,e.category_id,e.amount,e.receipt_file_id,e.logged_by,e.edited_by,e.expense_date,e.transaction_month,
      e.status,e.approval_required,e.approved_by,e.approved_at,e.voided_by,e.voided_at,e.void_reason,e.created_at,e.updated_at,
      e.project_id,e.fund_override,e.fund_override_reason,e.fund_override_by,e.fund_override_at,e.fund_balance_before,e.budget_override_reason,e.budget_override_by,
      c.name category_name,p.name project_name,p.project_code,la.name logged_by_name,aa.name approved_by_name
    FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id
    LEFT JOIN projects p ON p.id=e.project_id
    LEFT JOIN admins la ON la.id=e.logged_by LEFT JOIN admins aa ON aa.id=e.approved_by
    ${where.length?`WHERE ${where.join(" AND ")}`:""}
    ORDER BY COALESCE(e.expense_date,e.created_at) DESC,e.id DESC LIMIT 500`).bind(...vals).all();
  return c.json(rows.results);
});

async function validActiveCategory(c:any, categoryId:any) {
  if(categoryId===null || categoryId===undefined || categoryId==='') return {id:null};
  const id=Number(categoryId);
  if(!Number.isInteger(id) || id<=0) return null;
  return await c.env.DB.prepare("SELECT id,name FROM expense_categories WHERE id=? AND COALESCE(active,1)=1").bind(id).first<any>();
}

async function validProject(c:any, projectId:any) {
  if(projectId===null || projectId===undefined || projectId==='') return null;
  const id=Number(projectId); if(!Number.isInteger(id)||id<=0) return null;
  return await c.env.DB.prepare(`SELECT p.id,p.project_code,p.name,p.budget,p.status,
    COALESCE(SUM(CASE WHEN e.status='approved' THEN e.amount ELSE 0 END),0) spent
    FROM projects p LEFT JOIN expenses e ON e.project_id=p.id WHERE p.id=? GROUP BY p.id`).bind(id).first<any>();
}

function insufficientFundResponse(c:any, admin:any, available:number, amount:number) {
  const shortfall=Math.max(0,amount-available);
  return c.json({error:`Insufficient available fund. Available MVR ${available.toFixed(2)} · Expense MVR ${amount.toFixed(2)} · Shortfall MVR ${shortfall.toFixed(2)}`,
    code:'INSUFFICIENT_FUND',available_fund:available,expense_amount:amount,shortfall,override_allowed:adminCan(admin,'manage_admins')},409);
}

async function validateProjectBudget(c:any, admin:any, project:any, amount:number, body:any, replaceApprovedAmount=0) {
  if(!project) return null;
  if(!['active'].includes(String(project.status))) return c.json({error:`Project ${project.project_code} is ${project.status}. Only active projects can receive new expenses.`,code:'PROJECT_NOT_ACTIVE'},409);
  if(project.budget==null) return null;
  const effectiveSpent=Math.max(0,Number(project.spent||0)-Number(replaceApprovedAmount||0));
  const remaining=Number(project.budget)-effectiveSpent;
  if(amount<=remaining+0.005) return null;
  const reason=boundedText(body.budget_override_reason,500);
  if(!reason) return c.json({error:`Project budget would be exceeded. Remaining MVR ${Math.max(0,remaining).toFixed(2)} · Expense MVR ${amount.toFixed(2)}. Enter a reason to continue.`,code:'PROJECT_BUDGET_EXCEEDED',project_id:project.id,project_name:project.name,budget:Number(project.budget),spent:effectiveSpent,remaining_budget:remaining,over_by:amount-remaining,override_allowed:true},409);
  return null;
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
  const expenseDate=String(body.expense_date || currentDate(c.env.FUND_TIMEZONE || "Indian/Maldives")).trim();
  if(!description || amount===null) return c.json({error:"Description and valid positive amount are required"},400);
  if(!expenseDate || !validDate(expenseDate)) return c.json({error:"Expense date must use YYYY-MM-DD"},400);
  const month=expenseDate.slice(0,7);
  if(body.month && body.month!==month) return c.json({error:"Expense month must match expense date"},400);
  const category=await validActiveCategory(c,body.category_id);
  if(body.category_id && !category) return c.json({error:"Expense category is inactive or does not exist"},409);
  const project=await validProject(c,body.project_id);
  if(body.project_id && !project) return c.json({error:"Project does not exist"},409);
  try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}
  const budgetProblem=await validateProjectBudget(c,admin,project,amount,body); if(budgetProblem)return budgetProblem;
  const available=await availableFundBalance(c.env);
  const wantsFundOverride=Boolean(body.override_fund_limit);
  const overrideReason=boundedText(body.override_reason,500);
  if(amount>available+0.005){
    if(!wantsFundOverride || !overrideReason || !adminCan(admin,'manage_admins')) return insufficientFundResponse(c,admin,available,amount);
  }
  const threshold=money(await getSetting(c.env,"expense_approval_threshold")) || 5000;
  const needsApproval=amount>=threshold && (await eligibleOtherFinanceAdmins(c,admin.id))>0;
  const txnId=await generateTxnId(c.env,"E");
  const fundOverride=amount>available+0.005 && wantsFundOverride && !!overrideReason && adminCan(admin,'manage_admins');
  const budgetOverrideReason=project?.budget!=null && amount>(Number(project.budget)-Number(project.spent||0))+0.005 ? boundedText(body.budget_override_reason,500) : null;
  const res=await c.env.DB.prepare(`INSERT INTO expenses
    (txn_id,description,category_id,project_id,amount,logged_by,expense_date,transaction_month,status,approval_required,approved_by,approved_at,
     fund_override,fund_override_reason,fund_override_by,fund_override_at,fund_balance_before,budget_override_reason,budget_override_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(txnId,description,category?.id ?? null,project?.id ?? null,amount,admin.id,expenseDate,month,needsApproval?"pending":"approved",needsApproval?1:0,needsApproval?null:admin.id,needsApproval?null:new Date().toISOString(),
      fundOverride?1:0,fundOverride?overrideReason:null,fundOverride?admin.id:null,fundOverride?new Date().toISOString():null,available,budgetOverrideReason,budgetOverrideReason?admin.id:null).run();
  await auditEntity(c.env,admin.id,"expense_created","expense",Number(res.meta.last_row_id),null,{txn_id:txnId,description,amount,expense_date:expenseDate,month,project_id:project?.id||null,status:needsApproval?"pending":"approved",fund_override:fundOverride,budget_override:!!budgetOverrideReason});
  return c.json({id:res.meta.last_row_id,txn_id:txnId,status:needsApproval?"pending":"approved",approval_required:needsApproval,fund_override:fundOverride},201);
});

expensesRoute.post("/:id/approve", requireFinance, async(c)=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:"Not found"},404);
  if(before.status!=="pending") return c.json({error:`Already ${before.status}`},409);
  if(Number(before.logged_by)===Number(admin.id)) return c.json({error:"A different finance admin must confirm this expense"},409);
  try{await requireOpenMonth(c.env,before.transaction_month||before.created_at.slice(0,7));}catch(e:any){return c.json({error:e.message},409);}
  const body=await c.req.json().catch(()=>({})) as any;
  const project=await validProject(c,before.project_id);
  if(before.project_id && !project) return c.json({error:"Linked project no longer exists"},409);
  if(project && !before.budget_override_reason){
    const budgetProblem=await validateProjectBudget(c,admin,project,Number(before.amount),body);
    if(budgetProblem)return budgetProblem;
    if(project.budget!=null && Number(before.amount)>(Number(project.budget)-Number(project.spent||0))+0.005 && body.budget_override_reason){
      await c.env.DB.prepare("UPDATE expenses SET budget_override_reason=?,budget_override_by=? WHERE id=?").bind(boundedText(body.budget_override_reason,500),admin.id,id).run();
    }
  }
  const available=await availableFundBalance(c.env);
  if(Number(before.amount)>available+0.005 && !Number(before.fund_override||0)){
    const reason=boundedText(body.override_reason,500);
    if(!body.override_fund_limit || !reason || !adminCan(admin,'manage_admins')) return insufficientFundResponse(c,admin,available,Number(before.amount));
    await c.env.DB.prepare("UPDATE expenses SET fund_override=1,fund_override_reason=?,fund_override_by=?,fund_override_at=datetime('now'),fund_balance_before=? WHERE id=?").bind(reason,admin.id,available,id).run();
  }
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
  const originalMonth=before.transaction_month??String(before.expense_date||before.created_at).slice(0,7);
  if(!validMonth(originalMonth)) return c.json({error:"Existing expense month is invalid"},409);
  // A closed accounting period is immutable. An expense cannot be moved out of it.
  try{await requireOpenMonth(c.env,originalMonth);}catch(e:any){return c.json({error:e.message},409);}
  const expenseDate=body.expense_date===undefined ? (before.expense_date||null) : String(body.expense_date||'').trim();
  if(body.expense_date!==undefined && (!expenseDate || !validDate(expenseDate))) return c.json({error:"Expense date must use YYYY-MM-DD"},400);
  let month=body.transaction_month??body.month??(expenseDate?expenseDate.slice(0,7):originalMonth);
  if(expenseDate){
    const dateMonth=expenseDate.slice(0,7);
    if((body.transaction_month||body.month) && month!==dateMonth) return c.json({error:"Expense month must match expense date"},400);
    month=dateMonth;
  }
  if(!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  if(month!==originalMonth){try{await requireOpenMonth(c.env,month);}catch(e:any){return c.json({error:e.message},409);}}
  const description=boundedText(body.description??before.description,500,true);
  const amount=money(body.amount??before.amount);
  const requestedCategory=body.category_id===undefined?before.category_id:(body.category_id?Number(body.category_id):null);
  if(body.category_id!==undefined && Number(requestedCategory)!==Number(before.category_id)){
    const category=await validActiveCategory(c,requestedCategory);
    if(requestedCategory && !category) return c.json({error:"Expense category is inactive or does not exist"},409);
  }
  const requestedProject=body.project_id===undefined?before.project_id:(body.project_id?Number(body.project_id):null);
  const project=await validProject(c,requestedProject);
  if(requestedProject && !project) return c.json({error:"Project does not exist"},409);

  if(!description || amount===null) return c.json({error:"Description and valid positive amount are required"},400);
  const replaceApproved=before.status==='approved'?Number(before.amount||0):0;
  const budgetProblem=await validateProjectBudget(c,admin,project,amount,body,requestedProject===before.project_id?replaceApproved:0); if(budgetProblem)return budgetProblem;
  const available=(await availableFundBalance(c.env))+replaceApproved;
  const wantsFundOverride=Boolean(body.override_fund_limit); const overrideReason=boundedText(body.override_reason,500);
  const priorFundOverrideValid=Number(before.fund_override||0)===1 && Math.abs(amount-Number(before.amount||0))<0.005;
  if(amount>available+0.005 && !priorFundOverrideValid && (!wantsFundOverride || !overrideReason || !adminCan(admin,'manage_admins'))) return insufficientFundResponse(c,admin,available,amount);
  const threshold=money(await getSetting(c.env,"expense_approval_threshold")) || 5000;
  const materialChanged = description!==before.description || Number(requestedCategory)!==Number(before.category_id) || Number(requestedProject)!==Number(before.project_id) || Math.abs(amount-Number(before.amount))>0.004 || month!==originalMonth || String(expenseDate||'')!==String(before.expense_date||'');
  let status=before.status, approvalRequired=Number(before.approval_required||0), approvedBy=before.approved_by, approvedAt=before.approved_at;
  if(materialChanged){
    const needsApproval=amount>=threshold && (await eligibleOtherFinanceAdmins(c,admin.id))>0;
    status=needsApproval?'pending':'approved'; approvalRequired=needsApproval?1:0; approvedBy=needsApproval?null:admin.id; approvedAt=needsApproval?null:new Date().toISOString();
  }
  const newFundOverride=amount>available+0.005 && wantsFundOverride && !!overrideReason && adminCan(admin,'manage_admins');
  const keepPriorFundOverride=amount>available+0.005 && priorFundOverrideValid;
  const budgetOverrideReason=project?.budget!=null && amount>(Number(project.budget)-Math.max(0,Number(project.spent||0)-(requestedProject===before.project_id?replaceApproved:0)))+0.005 ? boundedText(body.budget_override_reason,500) : null;
  await c.env.DB.prepare("UPDATE expenses SET description=?,category_id=?,project_id=?,amount=?,expense_date=?,transaction_month=?,edited_by=?,updated_at=datetime('now'),status=?,approval_required=?,approved_by=?,approved_at=?,fund_override=?,fund_override_reason=?,fund_override_by=?,fund_override_at=?,fund_balance_before=?,budget_override_reason=?,budget_override_by=? WHERE id=?")
    .bind(description,requestedCategory,requestedProject,amount,expenseDate,month,admin.id,status,approvalRequired,approvedBy,approvedAt,
      newFundOverride?1:(keepPriorFundOverride?1:0),newFundOverride?overrideReason:(keepPriorFundOverride?before.fund_override_reason:null),newFundOverride?admin.id:(keepPriorFundOverride?before.fund_override_by:null),newFundOverride?new Date().toISOString():(keepPriorFundOverride?before.fund_override_at:null),newFundOverride?available:(keepPriorFundOverride?before.fund_balance_before:available),budgetOverrideReason||before.budget_override_reason,budgetOverrideReason?admin.id:before.budget_override_by,id).run();
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
