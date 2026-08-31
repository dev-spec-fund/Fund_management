import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin, requireFinance, requireSuperAdmin } from "../auth";
import { auditEntity, duplicateSlip, ensureOperationalSchema, requireOpenMonth, safeLogError } from "../ops";
import { currentMonth, getSetting, generateMemberCode } from "../db";
import { findDuplicateMembers } from "../ops";
import { sendMessage } from "../telegram";

export const adminRoute = new Hono<{Bindings:Env}>();

adminRoute.get('/pending', requireAdmin, async c => {
  await ensureOperationalSchema(c.env);
  const registrations = await c.env.DB.prepare(`SELECT * FROM member_registration_requests WHERE status='pending' ORDER BY requested_at ASC`).all<any>();
  const enrichedRegs:any[]=[];
  for (const r of registrations.results) enrichedRegs.push({ ...r, possible_matches: (await findDuplicateMembers(c.env, r.name, null, r.telegram_id)).filter((m:any)=>!m.telegram_id) });
  const contributions = await c.env.DB.prepare(`SELECT c.*,m.name member_name,m.member_code FROM contributions c JOIN members m ON m.id=c.member_id WHERE c.status='pending' ORDER BY c.submitted_at ASC`).all();
  const expenses = await c.env.DB.prepare(`SELECT e.*,a.name logged_by_name FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by WHERE e.status='pending' ORDER BY e.created_at ASC`).all();
  return c.json({ registrations: enrichedRegs, contributions: contributions.results, slips: contributions.results, expenses: expenses.results });
});

adminRoute.post('/pending/registrations/:id/approve', requireFinance, async c => {
  const admin=c.get('admin'); const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any;
  const req=await c.env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(id).first<any>();
  if(!req)return c.json({error:'Registration request not found'},404); if(req.status!=='pending')return c.json({error:`Already ${req.status}`},409);
  let member:any=null;
  if(body.member_id){
    member=await c.env.DB.prepare("SELECT * FROM members WHERE id=? AND telegram_id IS NULL").bind(Number(body.member_id)).first<any>();
    if(!member)return c.json({error:'Selected member is already linked or unavailable'},409);
    await c.env.DB.prepare("UPDATE members SET telegram_id=? WHERE id=? AND telegram_id IS NULL").bind(req.telegram_id,member.id).run();
  } else {
    const dup=await findDuplicateMembers(c.env,req.name,null,req.telegram_id);
    const unlinked=dup.filter((x:any)=>!x.telegram_id);
    if(unlinked.length) return c.json({error:'Possible existing member found. Choose Link Existing Member instead.',duplicates:unlinked},409);
    const code=await generateMemberCode(c.env); const amount=Number(await getSetting(c.env,'default_monthly_amount'))||250;
    const r=await c.env.DB.prepare("INSERT INTO members(member_code,telegram_id,name,monthly_amount) VALUES(?,?,?,?)").bind(code,req.telegram_id,req.name,amount).run();
    member=await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(r.meta.last_row_id).first<any>();
  }
  const changed=await c.env.DB.prepare("UPDATE member_registration_requests SET status='approved',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!changed.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,body.member_id?'member_linked':'member_registration_approved','member',member.id,null,{member_code:member.member_code,telegram_id:req.telegram_id});
  await sendMessage(c.env, req.telegram_id, `✅ Your membership has been approved. Member ID: <b>${member.member_code}</b>. You can now submit contribution slips.`);
  return c.json({ok:true,member});
});
adminRoute.post('/pending/registrations/:id/reject', requireFinance, async c => {
  const admin=c.get('admin');const id=Number(c.req.param('id'));const b=await c.req.json().catch(()=>({})) as any;const req=await c.env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(id).first<any>();if(!req)return c.json({error:'Not found'},404);
  const r=await c.env.DB.prepare("UPDATE member_registration_requests SET status='rejected',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'member_registration_rejected','registration',id,req,{...req,status:'rejected',reason:b.reason||null});
  await sendMessage(c.env, req.telegram_id, `❌ Your membership registration request was rejected.${b.reason ? ` Reason: ${b.reason}` : ''}`);
  return c.json({ok:true});
});

adminRoute.patch('/pending/contributions/:id', requireFinance, async c => {
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin'); const id=Number(c.req.param('id')); const body=await c.req.json<{amount?:number;ref_number?:string|null;bank_date?:string|null;month?:string}>();
  const before=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Not found'},404); if(before.status!=='pending') return c.json({error:`Already ${before.status}`},409);
  const month=body.month??before.month; try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}
  const amount=Number(body.amount??before.amount); const ref=body.ref_number===undefined?before.ref_number:body.ref_number; const bankDate=body.bank_date===undefined?before.bank_date:body.bank_date;
  const dup=await duplicateSlip(c.env,ref,amount,bankDate,id); if(dup) return c.json({error:`Duplicate slip matches ${dup.txn_id}`,duplicate:dup},409);
  await c.env.DB.prepare(`UPDATE contributions SET amount=?,ref_number=?,bank_date=?,month=?,corrected_by=?,corrected_at=datetime('now') WHERE id=? AND status='pending'`)
    .bind(amount,ref||null,bankDate||null,month,admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,'contribution_ocr_corrected','contribution',id,before,after); return c.json(after);
});

adminRoute.post('/pending/contributions/:id/approve', requireFinance, async c => {
  const admin=c.get('admin'); const id=Number(c.req.param('id')); const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404); if(row.status!=='pending')return c.json({error:`Already ${row.status}`},409); try{await requireOpenMonth(c.env,row.month)}catch(e:any){return c.json({error:e.message},409)}
  const dup=await duplicateSlip(c.env,row.ref_number,Number(row.amount),row.bank_date,id); if(dup)return c.json({error:`Duplicate slip matches ${dup.txn_id}`,duplicate:dup},409);
  const r=await c.env.DB.prepare("UPDATE contributions SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run(); if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'contribution_approved','contribution',id,row,{...row,status:'approved'}); return c.json({ok:true});
});

adminRoute.post('/pending/contributions/:id/reject', requireFinance, async c => {
  const admin=c.get('admin'); const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any; const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404); if(row.status!=='pending')return c.json({error:`Already ${row.status}`},409);
  const r=await c.env.DB.prepare("UPDATE contributions SET status='rejected',approved_by=?,approved_at=datetime('now'),void_reason=? WHERE id=? AND status='pending'").bind(admin.id,body.reason||'Rejected by admin',id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'contribution_rejected','contribution',id,row,{...row,status:'rejected'});return c.json({ok:true});
});

adminRoute.delete('/contributions/:id', requireFinance, async c => {
  const admin=c.get('admin'); const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any; const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>(); if(!row)return c.json({error:'Not found'},404);
  try{await requireOpenMonth(c.env,row.month)}catch(e:any){return c.json({error:e.message},409)}
  await c.env.DB.prepare("UPDATE contributions SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=?").bind(admin.id,body.reason||'Voided by admin',id).run(); await auditEntity(c.env,admin.id,'contribution_voided','contribution',id,row,{...row,status:'voided'}); return c.json({ok:true});
});

adminRoute.get('/month-close', requireAdmin, async c => { await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT mc.*,a.name closed_by_name FROM month_closures mc LEFT JOIN admins a ON a.id=mc.closed_by ORDER BY month DESC").all()).results); });
adminRoute.post('/month-close/:month', requireSuperAdmin, async c => { const admin=c.get('admin'); const month=c.req.param('month'); if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return c.json({error:'Use YYYY-MM'},400); const b=await c.req.json().catch(()=>({})) as any; await ensureOperationalSchema(c.env); await c.env.DB.prepare("INSERT OR REPLACE INTO month_closures(month,closed_by,closed_at,note) VALUES(?,?,datetime('now'),?)").bind(month,admin.id,b.note||null).run(); await auditEntity(c.env,admin.id,'month_closed','month',month,null,{note:b.note||null}); return c.json({ok:true}); });
adminRoute.delete('/month-close/:month', requireSuperAdmin, async c => { const admin=c.get('admin'); const month=c.req.param('month'); await c.env.DB.prepare("DELETE FROM month_closures WHERE month=?").bind(month).run(); await auditEntity(c.env,admin.id,'month_reopened','month',month,null,null); return c.json({ok:true}); });

adminRoute.get('/health', requireAdmin, async c => {
  await ensureOperationalSchema(c.env); const out:any={checked_at:new Date().toISOString(),db:{ok:false},telegram:{ok:false},webhook:{ok:false},ai:{ok:!!c.env.AI},mini_app_url:await getSetting(c.env,'mini_app_url'),reminder_schedule:await getSetting(c.env,'reminder_schedule'),month:currentMonth(c.env.FUND_TIMEZONE||'Indian/Maldives')};
  try{const x=await c.env.DB.prepare('SELECT 1 ok').first<any>();out.db={ok:Number(x?.ok)===1}}catch(e){await safeLogError(c.env,'health.db',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getMe`);const j:any=await r.json();out.telegram={ok:!!j.ok,username:j.result?.username||null}}catch(e){await safeLogError(c.env,'health.telegram',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);const j:any=await r.json();out.webhook={ok:!!j.ok,url:j.result?.url||'',pending:j.result?.pending_update_count||0,last_error:j.result?.last_error_message||null}}catch(e){await safeLogError(c.env,'health.webhook',e)}
  return c.json(out);
});

adminRoute.get('/errors', requireSuperAdmin, async c => { await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT * FROM error_log ORDER BY created_at DESC LIMIT 200").all()).results); });

adminRoute.get('/backup', requireSuperAdmin, async c => {
  await ensureOperationalSchema(c.env); const tables=['members','admins','member_registration_requests','contributions','donations','expense_categories','expenses','exemptions','settings','id_sequences','audit_log','month_closures']; const data:any={exported_at:new Date().toISOString(),format:'kys-fund-json-v1',tables:{}};
  for(const t of tables){try{data.tables[t]=(await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results}catch(e){data.tables[t]={error:String(e)}}}
  const admin=c.get('admin'); await auditEntity(c.env,admin.id,'database_backup_exported','database','D1',null,{tables:tables.length}); c.header('Content-Disposition',`attachment; filename="kys-fund-backup-${new Date().toISOString().slice(0,10)}.json"`); return c.json(data);
});
