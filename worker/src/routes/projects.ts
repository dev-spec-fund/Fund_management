import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { adminCan, auditEntity, ensureOperationalSchema } from "../ops";
import { boundedText, money, validDate } from "../validation";

export const projectsRoute = new Hono<AppEnv>();

async function nextProjectCode(c:any) {
  await c.env.DB.prepare(`INSERT OR IGNORE INTO id_sequences(kind,value)
    SELECT 'P',COALESCE(MAX(CAST(SUBSTR(project_code,2) AS INTEGER)),0) FROM projects WHERE project_code GLOB 'P[0-9]*'`).run();
  const row=await c.env.DB.prepare("UPDATE id_sequences SET value=value+1 WHERE kind='P' RETURNING value").first<{value:number}>();
  return `P${String(row?.value || 1).padStart(4,'0')}`;
}

function normalizeBudget(value:any){
  if(value===null || value===undefined || value==='') return null;
  return money(value);
}

async function projectRow(c:any,id:number){
  return c.env.DB.prepare(`SELECT p.*,m.member_code responsible_member_code,m.name responsible_member_name,
      COALESCE(SUM(CASE WHEN e.status='approved' THEN e.amount ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN e.status='pending' THEN e.amount ELSE 0 END),0) pending_spend,
      COUNT(DISTINCT CASE WHEN e.status='approved' THEN e.id END) expense_count,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donation_received,
      COALESCE((SELECT COUNT(*) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donation_count
    FROM projects p
    LEFT JOIN members m ON m.id=p.responsible_member_id
    LEFT JOIN expenses e ON e.project_id=p.id
    WHERE p.id=? GROUP BY p.id`).bind(id).first<any>();
}

function withProjectMetrics(project:any){
  return {
    ...project,
    remaining_budget: project.budget==null ? null : Number(project.budget)-Number(project.spent||0),
    budget_used_pct: project.budget==null ? null : (Number(project.spent||0)/Number(project.budget||1))*100,
  };
}

projectsRoute.get('/', requireAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const status=String(c.req.query('status')||'').trim();
  const q=String(c.req.query('q')||'').trim().slice(0,100);
  const where:string[]=[]; const vals:any[]=[];
  if(status && ['planned','active','completed','cancelled'].includes(status)){where.push('p.status=?');vals.push(status);}
  if(q){where.push('(p.name LIKE ? OR p.project_code LIKE ? OR p.description LIKE ? OR m.name LIKE ?)');const like=`%${q}%`;vals.push(like,like,like,like);}
  const rows=await c.env.DB.prepare(`SELECT p.*,m.member_code responsible_member_code,m.name responsible_member_name,
      COALESCE(SUM(CASE WHEN e.status='approved' THEN e.amount ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN e.status='pending' THEN e.amount ELSE 0 END),0) pending_spend,
      COUNT(DISTINCT CASE WHEN e.status='approved' THEN e.id END) expense_count,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donation_received,
      COALESCE((SELECT COUNT(*) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) donation_count
    FROM projects p
    LEFT JOIN members m ON m.id=p.responsible_member_id
    LEFT JOIN expenses e ON e.project_id=p.id
    ${where.length?`WHERE ${where.join(' AND ')}`:''}
    GROUP BY p.id ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,p.start_date DESC,p.id DESC`).bind(...vals).all<any>();
  return c.json(rows.results.map(withProjectMetrics));
});

projectsRoute.get('/:id', requireAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param('id')); const project=await projectRow(c,id);
  if(!project)return c.json({error:'Project not found'},404);
  const [expenses,donations,audit] = await Promise.all([
    c.env.DB.prepare(`SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.status,e.void_reason,e.created_at,e.approved_at,e.voided_at,
      COALESCE(cat.name,'Uncategorised') category,COALESCE(a.name,'-') logged_by_name,
      e.fund_override,e.fund_override_reason,e.budget_override_reason,
      (SELECT COUNT(*) FROM expense_documents d WHERE d.expense_id=e.id AND d.removed_at IS NULL) document_count
    FROM expenses e LEFT JOIN expense_categories cat ON cat.id=e.category_id LEFT JOIN admins a ON a.id=e.logged_by
    WHERE e.project_id=? ORDER BY COALESCE(e.expense_date,e.created_at) DESC,e.id DESC`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT d.id,d.txn_id,d.donor_name,d.amount,d.note,d.transaction_month,d.created_at
      FROM donations d WHERE d.project_id=? AND COALESCE(d.status,'active')='active'
      ORDER BY d.transaction_month DESC,d.created_at DESC,d.id DESC`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT al.id,al.action,al.created_at,al.detail,COALESCE(a.name,'System') admin_name
      FROM audit_log al LEFT JOIN admins a ON a.id=al.admin_id
      WHERE al.action LIKE 'project_%' AND json_valid(al.detail)=1
        AND json_extract(al.detail,'$.entity')='project'
        AND CAST(json_extract(al.detail,'$.entity_id') AS TEXT)=?
      ORDER BY al.created_at DESC,al.id DESC LIMIT 30`).bind(String(id)).all<any>(),
  ]);
  const auditHistory=audit.results.map((row:any)=>{
    let detail:any=null; try{detail=JSON.parse(String(row.detail||''));}catch{}
    const before=detail?.before||null, after=detail?.after||null;
    return {id:row.id,action:row.action,created_at:row.created_at,admin_name:row.admin_name,before_status:before?.status||null,after_status:after?.status||null};
  });
  return c.json({...withProjectMetrics(project),expenses:expenses.results,donations:donations.results,audit_history:auditHistory});
});

projectsRoute.post('/', requireFinance, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const b=await c.req.json<any>();
  const name=boundedText(b.name,160,true); const description=boundedText(b.description,1500)||null; const budget=normalizeBudget(b.budget);
  const startDate=String(b.start_date||'').trim()||null; const targetEnd=String(b.target_end_date||'').trim()||null;
  const status=['planned','active'].includes(String(b.status))?String(b.status):'planned';
  const responsible=b.responsible_member_id?Number(b.responsible_member_id):null;
  if(!name)return c.json({error:'Project name is required'},400);
  if(b.budget!==null && b.budget!==undefined && b.budget!=='' && budget===null)return c.json({error:'Budget must be a positive amount or left blank'},400);
  if(startDate && !validDate(startDate))return c.json({error:'Start date must use YYYY-MM-DD'},400);
  if(targetEnd && !validDate(targetEnd))return c.json({error:'Target end date must use YYYY-MM-DD'},400);
  if(startDate&&targetEnd&&targetEnd<startDate)return c.json({error:'Target end date cannot be before the start date'},400);
  if(responsible){const member=await c.env.DB.prepare('SELECT id FROM members WHERE id=? AND active=1').bind(responsible).first();if(!member)return c.json({error:'Responsible member not found or inactive'},409);}
  const code=await nextProjectCode(c);
  const res=await c.env.DB.prepare(`INSERT INTO projects(project_code,name,description,budget,start_date,target_end_date,status,responsible_member_id,created_by)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(code,name,description,budget,startDate,targetEnd,status,responsible,admin.id).run();
  const id=Number(res.meta.last_row_id); const after=await projectRow(c,id);
  await auditEntity(c.env,admin.id,'project_created','project',id,null,after);
  return c.json(withProjectMetrics(after),201);
});

projectsRoute.patch('/:id', requireFinance, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const b=await c.req.json<any>();
  const before=await projectRow(c,id); if(!before)return c.json({error:'Project not found'},404);
  const requestedStatus=b.status===undefined?String(before.status):String(b.status);
  const reopening=['completed','cancelled'].includes(String(before.status)) && ['planned','active'].includes(requestedStatus);
  if((['completed','cancelled'].includes(String(before.status)) || reopening) && !adminCan(admin,'manage_admins')) return c.json({error:'Only Super Admin can edit or reopen a completed/cancelled project'},403);
  const name=b.name===undefined?before.name:boundedText(b.name,160,true); if(!name)return c.json({error:'Project name is required'},400);
  const description=b.description===undefined?before.description:(boundedText(b.description,1500)||null);
  const budget=b.budget===undefined?before.budget:normalizeBudget(b.budget); if(b.budget!==undefined&&b.budget!==null&&b.budget!==''&&budget===null)return c.json({error:'Budget must be a positive amount or left blank'},400);
  const startDate=b.start_date===undefined?before.start_date:(String(b.start_date||'').trim()||null);
  const targetEnd=b.target_end_date===undefined?before.target_end_date:(String(b.target_end_date||'').trim()||null);
  if(startDate&&!validDate(startDate))return c.json({error:'Start date must use YYYY-MM-DD'},400); if(targetEnd&&!validDate(targetEnd))return c.json({error:'Target end date must use YYYY-MM-DD'},400); if(startDate&&targetEnd&&targetEnd<startDate)return c.json({error:'Target end date cannot be before the start date'},400);
  const status=requestedStatus; if(!['planned','active','completed','cancelled'].includes(status))return c.json({error:'Invalid project status'},400);
  const responsible=b.responsible_member_id===undefined?before.responsible_member_id:(b.responsible_member_id?Number(b.responsible_member_id):null);
  if(responsible){const member=await c.env.DB.prepare('SELECT id FROM members WHERE id=? AND active=1').bind(responsible).first();if(!member)return c.json({error:'Responsible member not found or inactive'},409);}
  const completing=status==='completed'&&before.status!=='completed'; const cancelling=status==='cancelled'&&before.status!=='cancelled';
  await c.env.DB.prepare(`UPDATE projects SET name=?,description=?,budget=?,start_date=?,target_end_date=?,status=?,responsible_member_id=?,updated_at=datetime('now'),
    completed_at=CASE WHEN ? THEN datetime('now') WHEN ?!='completed' THEN NULL ELSE completed_at END,
    completed_by=CASE WHEN ? THEN ? WHEN ?!='completed' THEN NULL ELSE completed_by END,
    cancelled_at=CASE WHEN ? THEN datetime('now') WHEN ?!='cancelled' THEN NULL ELSE cancelled_at END,
    cancelled_by=CASE WHEN ? THEN ? WHEN ?!='cancelled' THEN NULL ELSE cancelled_by END,
    cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE NULL END WHERE id=?`)
    .bind(name,description,budget,startDate,targetEnd,status,responsible,completing?1:0,status,completing?1:0,admin.id,status,cancelling?1:0,status,cancelling?1:0,admin.id,status,status,boundedText(b.cancel_reason,500)||null,id).run();
  const after=await projectRow(c,id);
  const action = completing ? 'project_completed' : cancelling ? 'project_cancelled' : reopening ? 'project_reopened' : 'project_updated';
  await auditEntity(c.env,admin.id,action,'project',id,before,after);
  return c.json(withProjectMetrics(after));
});
