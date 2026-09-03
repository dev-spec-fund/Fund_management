import type { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireFinance } from "../../auth";
import { auditEntity, contributionDuplicateKey, duplicateSlip, ensureOperationalSchema, normalizeName, normalizePhone, requireOpenMonth, safeLogError, findDuplicateMembers } from "../../ops";
import { currentMonth, getSetting, getBranding, generateMemberCode } from "../../db";
import { ensureInitialContributionRate } from "../../contributionRates";
import { sendMessage } from "../../telegram";
import { approveWithAllocations, allocationReceipt, buildAllocationPlan, allocatedPaidSql } from "../../allocations";
import { money, validDate, validMonth, boundedText } from "../../validation";

export function registerPendingAdminRoutes(route: Hono<AppEnv>) {
route.get('/pending', requireFinance, async c => {
  await ensureOperationalSchema(c.env);
  const registrations = await c.env.DB.prepare(`SELECT * FROM member_registration_requests WHERE status='pending' ORDER BY requested_at ASC`).all<any>();
  const enrichedRegs=await Promise.all(registrations.results.map(async (r:any) => ({
    ...r,
    possible_matches:(await findDuplicateMembers(c.env,r.name,r.phone,r.telegram_id)).filter((m:any)=>!m.telegram_id)
  })));
  const contributions = await c.env.DB.prepare(`SELECT c.*,m.name member_name,m.member_code FROM contributions c JOIN members m ON m.id=c.member_id WHERE c.status='pending' ORDER BY c.submitted_at ASC`).all<any>();
  const contributionRows=await Promise.all(contributions.results.map(async (row:any)=>{
    try { return {...row,allocation_preview:await buildAllocationPlan(c.env,row)}; }
    catch { return {...row,allocation_preview:[]}; }
  }));
  return c.json({ registrations: enrichedRegs, contributions: contributionRows, slips: contributionRows });
});

route.post('/pending/registrations/:id/approve', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any;
  const req=await c.env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(id).first<any>();
  if(!req)return c.json({error:'Registration request not found'},404); if(req.status!=='pending')return c.json({error:`Already ${req.status}`},409);
  let member:any=null;
  if(body.member_id){
    member=await c.env.DB.prepare("SELECT * FROM members WHERE id=? AND telegram_id IS NULL").bind(Number(body.member_id)).first<any>();
    if(!member)return c.json({error:'Selected member is already linked or unavailable'},409);
    await c.env.DB.prepare("UPDATE members SET telegram_id=?, phone=COALESCE(NULLIF(?,''),phone), normalized_phone=CASE WHEN NULLIF(?,'') IS NOT NULL THEN ? ELSE normalized_phone END WHERE id=? AND telegram_id IS NULL")
      .bind(req.telegram_id,req.phone||null,req.phone||null,normalizePhone(req.phone)||null,member.id).run();
    member=await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(member.id).first<any>();
  } else {
    const dup=await findDuplicateMembers(c.env,req.name,req.phone,req.telegram_id);
    const unlinked=dup.filter((x:any)=>!x.telegram_id);
    if(unlinked.length) return c.json({error:'Possible existing member found. Choose Link Existing Member instead.',duplicates:unlinked},409);
    const code=await generateMemberCode(c.env); const amount=Number(await getSetting(c.env,'default_monthly_amount'))||250;
    const r=await c.env.DB.prepare("INSERT INTO members(member_code,telegram_id,name,phone,monthly_amount,normalized_name,normalized_phone) VALUES(?,?,?,?,?,?,?)")
      .bind(code,req.telegram_id,req.name,req.phone||null,amount,normalizeName(req.name),normalizePhone(req.phone)||null).run();
    await ensureInitialContributionRate(c.env,Number(r.meta.last_row_id),amount,currentMonth(c.env.FUND_TIMEZONE || 'Indian/Maldives'));
    member=await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(r.meta.last_row_id).first<any>();
  }
  const changed=await c.env.DB.prepare("UPDATE member_registration_requests SET status='approved',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();
  if(!changed.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,body.member_id?'member_linked':'member_registration_approved','member',member.id,null,{member_code:member.member_code,telegram_id:req.telegram_id,phone:req.phone||null});
  const branding=await getBranding(c.env);
  await sendMessage(c.env, req.telegram_id, `✅ Your membership with <b>${branding.fund_name}</b> has been approved. Member ID: <b>${member.member_code}</b>. You can now submit contribution slips.`);
  return c.json({ok:true,member});
});
route.post('/pending/registrations/:id/reject', requireFinance, async c => {
  const admin=c.get('admin')!;const id=Number(c.req.param('id'));const b=await c.req.json().catch(()=>({})) as any;const req=await c.env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(id).first<any>();if(!req)return c.json({error:'Not found'},404);
  const r=await c.env.DB.prepare("UPDATE member_registration_requests SET status='rejected',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'member_registration_rejected','registration',id,req,{...req,status:'rejected',reason:b.reason||null});
  await sendMessage(c.env, req.telegram_id, `❌ Your membership registration request was rejected.${b.reason ? ` Reason: ${b.reason}` : ''}`);
  return c.json({ok:true});
});

route.patch('/pending/contributions/:id', requireFinance, async c => {
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json<{amount?:number;ref_number?:string|null;bank_date?:string|null;month?:string}>();
  const before=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Not found'},404); if(before.status!=='pending') return c.json({error:`Already ${before.status}`},409);
  const month=body.month??before.month; if(!validMonth(month)) return c.json({error:'Month must use YYYY-MM'},400); try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}
  const amount=money(body.amount??before.amount); const ref=body.ref_number===undefined?before.ref_number:boundedText(body.ref_number,120); const bankDate=body.bank_date===undefined?before.bank_date:body.bank_date;
  if(amount===null || !validDate(bankDate)) return c.json({error:'Invalid amount or bank date'},400);
  const dup=await duplicateSlip(c.env,ref,amount,bankDate,id); if(dup) return c.json({error:`Duplicate slip matches ${dup.txn_id}`,duplicate:dup},409);
  await c.env.DB.prepare(`UPDATE contributions SET amount=?,ref_number=?,bank_date=?,month=?,duplicate_key=?,corrected_by=?,corrected_at=datetime('now') WHERE id=? AND status='pending'`)
    .bind(amount,ref||null,bankDate||null,month,contributionDuplicateKey(ref,amount,bankDate),admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,'contribution_ocr_corrected','contribution',id,before,after); return c.json(after);
});

route.post('/pending/contributions/:id/approve', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404); if(row.status!=='pending')return c.json({error:`Already ${row.status}`},409); try{await requireOpenMonth(c.env,row.month)}catch(e:any){return c.json({error:e.message},409)}
  const dup=await duplicateSlip(c.env,row.ref_number,Number(row.amount),row.bank_date,id); if(dup)return c.json({error:`Duplicate slip matches ${dup.txn_id}`,duplicate:dup},409);
  let approved;
  try { approved=await approveWithAllocations(c.env,id,admin.id); }
  catch(e:any){ return c.json({error:e.message},409); }
  await auditEntity(c.env,admin.id,'contribution_approved','contribution',id,row,{...row,status:'approved',allocations:approved.allocations});
  const member=await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(row.member_id).first<any>();
  if(member?.telegram_id) { const brand=await getBranding(c.env); await sendMessage(c.env,member.telegram_id,
    `✅ <b>${brand.fund_name} · Contribution approved</b>\n\nReceived: <b>MVR ${Number(row.amount).toFixed(2)}</b>\n\nApplied to:\n${allocationReceipt(approved.allocations)}`
  ); }
  return c.json({ok:true,allocations:approved.allocations});
});

route.post('/pending/contributions/:id/reject', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any; const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404); if(row.status!=='pending')return c.json({error:`Already ${row.status}`},409);
  const r=await c.env.DB.prepare("UPDATE contributions SET status='rejected',approved_by=?,approved_at=datetime('now'),void_reason=? WHERE id=? AND status='pending'").bind(admin.id,body.reason||'Rejected by admin',id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'contribution_rejected','contribution',id,row,{...row,status:'rejected'});return c.json({ok:true});
});

route.delete('/contributions/:id', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any;
  const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404);
  if(!['pending','approved'].includes(String(row.status))) return c.json({error:`Contribution is already ${row.status}`},409);
  try{await requireOpenMonth(c.env,row.month)}catch(e:any){return c.json({error:e.message},409)}

  const result=await c.env.DB.batch([
    c.env.DB.prepare("UPDATE contributions SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=? AND status IN ('pending','approved')").bind(admin.id,body.reason||'Voided by admin',id),
    c.env.DB.prepare("DELETE FROM contribution_allocations WHERE contribution_id=? AND EXISTS (SELECT 1 FROM contributions c WHERE c.id=? AND c.status='voided')").bind(id,id)
  ]);
  if(!Number((result[0] as any)?.meta?.changes||0)) {
    const current=await c.env.DB.prepare("SELECT status FROM contributions WHERE id=?").bind(id).first<any>();
    return c.json({error:`Contribution is already ${current?.status||'reviewed'}`},409);
  }

  await auditEntity(c.env,admin.id,'contribution_voided','contribution',id,row,{...row,status:'voided'});
  return c.json({ok:true});
});



route.post('/payment-reminders', requireFinance, async c => {
  const admin=c.get('admin')!;
  const body=await c.req.json().catch(()=>({})) as any;
  const month=String(body.month || currentMonth(c.env.FUND_TIMEZONE || 'Indian/Maldives'));
  if(!validMonth(month)) return c.json({error:'Month must use YYYY-MM'},400);
  const memberId=body.member_id===undefined||body.member_id===null ? null : Number(body.member_id);
  if(memberId!==null && (!Number.isInteger(memberId) || memberId<=0)) return c.json({error:'Invalid member'},400);

  const rows=await c.env.DB.prepare(`
    SELECT m.id,m.member_code,m.name,m.telegram_id,
      COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) monthly_amount,
      ${allocatedPaidSql} paid,
      CASE WHEN EXISTS(SELECT 1 FROM exemptions e WHERE e.member_id=m.id AND e.month=?) THEN 1 ELSE 0 END exempt
    FROM members m
    WHERE m.active=1 ${memberId!==null?'AND m.id=?':''}
    ORDER BY m.name
  `).bind(...(memberId!==null?[month,month,month,month,month,memberId]:[month,month,month,month,month])).all<any>();

  const dueMembers=rows.results
    .map((m:any)=>({...m,paid:Number(m.paid||0),due:Math.max(0,Number(m.monthly_amount||0)-Number(m.paid||0))}))
    .filter((m:any)=>!Number(m.exempt) && m.due>0.005);

  const reminderBrand=await getBranding(c.env);
  let sent=0, unlinked=0, failed=0;
  const results=await Promise.all(dueMembers.map(async (m:any)=>{
    if(!m.telegram_id){unlinked++;return;}
    const status=m.paid>0?'partially paid':'unpaid';
    try{
      await sendMessage(c.env,m.telegram_id,
        `🔔 <b>${reminderBrand.fund_name} · Payment reminder</b>\n\n${month} is ${status}.\nPaid: <b>MVR ${m.paid.toFixed(2)}</b>\nRemaining: <b>MVR ${m.due.toFixed(2)}</b>\n\nPlease send your bank slip photo to the bot after payment.`
      );
      sent++;
    }catch(e){failed++;await safeLogError(c.env,'manual.payment_reminder',e,{member_id:m.id,month});}
  }));
  void results;

  await auditEntity(c.env,admin.id,'payment_reminders_sent','month',month,null,{
    member_id:memberId,
    due_members:dueMembers.length,
    sent,unlinked,failed
  });
  if(memberId!==null && dueMembers.length===0) return c.json({ok:true,sent:0,unlinked:0,failed:0,reason:'Member has no outstanding payment for this month'});
  return c.json({ok:true,month,due:dueMembers.length,sent,unlinked,failed});
});
}
