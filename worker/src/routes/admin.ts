import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireSuperAdmin } from "../auth";
import { auditEntity, contributionDuplicateKey, duplicateSlip, ensureOperationalSchema, normalizeName, normalizePhone, requireOpenMonth, safeLogError } from "../ops";
import { currentMonth, getSetting, getBranding, generateMemberCode } from "../db";
import { ensureInitialContributionRate } from "../contributionRates";
import { findDuplicateMembers } from "../ops";
import { sendMessage, sendInBatches } from "../telegram";
import { approveWithAllocations, allocationReceipt, buildAllocationPlan, allocatedPaidSql } from "../allocations";
import { money, validDate, validMonth, boundedText } from "../validation";

export const adminRoute = new Hono<AppEnv>();


async function groupName(env:any){ return (await getBranding(env)).fund_name; }

async function sendMeetingBatch(env:any, items:any[], source:string){
  const messages=items.filter(x=>x.telegram_id).map(x=>({chatId:x.telegram_id,text:x.text,extra:x.extra||{},context:{meeting_id:x.meeting_id,member_id:x.id}}));
  const unlinked=items.length-messages.length;
  const result=await sendInBatches(env,messages,6);
  for(const f of result.failures) await safeLogError(env,source,f.error,f.message.context);
  return {sent:result.sent,failed:result.failed,unlinked};
}


adminRoute.get('/pending', requireFinance, async c => {
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
  const expenses = await c.env.DB.prepare(`SELECT e.*,a.name logged_by_name FROM expenses e LEFT JOIN admins a ON a.id=e.logged_by WHERE e.status='pending' ORDER BY e.created_at ASC`).all();
  return c.json({ registrations: enrichedRegs, contributions: contributionRows, slips: contributionRows, expenses: expenses.results });
});

adminRoute.post('/pending/registrations/:id/approve', requireFinance, async c => {
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
adminRoute.post('/pending/registrations/:id/reject', requireFinance, async c => {
  const admin=c.get('admin')!;const id=Number(c.req.param('id'));const b=await c.req.json().catch(()=>({})) as any;const req=await c.env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(id).first<any>();if(!req)return c.json({error:'Not found'},404);
  const r=await c.env.DB.prepare("UPDATE member_registration_requests SET status='rejected',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'member_registration_rejected','registration',id,req,{...req,status:'rejected',reason:b.reason||null});
  await sendMessage(c.env, req.telegram_id, `❌ Your membership registration request was rejected.${b.reason ? ` Reason: ${b.reason}` : ''}`);
  return c.json({ok:true});
});

adminRoute.patch('/pending/contributions/:id', requireFinance, async c => {
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

adminRoute.post('/pending/contributions/:id/approve', requireFinance, async c => {
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

adminRoute.post('/pending/contributions/:id/reject', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any; const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404); if(row.status!=='pending')return c.json({error:`Already ${row.status}`},409);
  const r=await c.env.DB.prepare("UPDATE contributions SET status='rejected',approved_by=?,approved_at=datetime('now'),void_reason=? WHERE id=? AND status='pending'").bind(admin.id,body.reason||'Rejected by admin',id).run();if(!r.meta.changes)return c.json({error:'Already reviewed'},409);
  await auditEntity(c.env,admin.id,'contribution_rejected','contribution',id,row,{...row,status:'rejected'});return c.json({ok:true});
});

adminRoute.delete('/contributions/:id', requireFinance, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const body=await c.req.json().catch(()=>({})) as any; const row=await c.env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(id).first<any>(); if(!row)return c.json({error:'Not found'},404);
  try{await requireOpenMonth(c.env,row.month)}catch(e:any){return c.json({error:e.message},409)}
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE contributions SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=?").bind(admin.id,body.reason||'Voided by admin',id),
    c.env.DB.prepare("DELETE FROM contribution_allocations WHERE contribution_id=?").bind(id)
  ]); await auditEntity(c.env,admin.id,'contribution_voided','contribution',id,row,{...row,status:'voided'}); return c.json({ok:true});
});

adminRoute.get('/month-close', requireAdmin, async c => { await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT mc.*,a.name closed_by_name FROM month_closures mc LEFT JOIN admins a ON a.id=mc.closed_by ORDER BY month DESC").all()).results); });
adminRoute.delete('/month-close/:month', requireSuperAdmin, async c => { const admin=c.get('admin')!; const month=c.req.param('month') || ""; await c.env.DB.batch([c.env.DB.prepare("DELETE FROM month_closures WHERE month=?").bind(month),c.env.DB.prepare("DELETE FROM monthly_snapshots WHERE month=?").bind(month)]); await auditEntity(c.env,admin.id,'month_reopened','month',month,null,{snapshot_removed:true}); return c.json({ok:true}); });


adminRoute.post('/payment-reminders', requireFinance, async c => {
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


async function ensureMeetingsSchema(env:any){
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      meeting_time TEXT NOT NULL,
      venue TEXT,
      agenda TEXT,
      rsvp_deadline TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER REFERENCES admins(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      sent_at TEXT,
      last_notification_at TEXT,
      cancelled_at TEXT,
      cancelled_by INTEGER REFERENCES admins(id),
      cancel_reason TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_rsvps (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id),
      member_id INTEGER NOT NULL REFERENCES members(id),
      response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')),
      responded_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(meeting_id, member_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date,meeting_time)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting ON meeting_rsvps(meeting_id)`)
  ]);
}
function meetingEsc(v:any){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function meetingDisplayDateTime(dateValue:any,timeValue:any){
  const date=String(dateValue||'');
  const time=String(timeValue||'');
  const dm=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm=time.match(/^(\d{2}):(\d{2})$/);
  if(!dm) return `${date}${time?` · ${time}`:''}`;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day=Number(dm[3]), month=months[Number(dm[2])-1]||dm[2], year=dm[1];
  if(!tm) return `${day} ${month} ${year}`;
  const h=Number(tm[1]), min=tm[2], suffix=h>=12?'PM':'AM', hour=h%12||12;
  return `${day} ${month} ${year} · ${hour}:${min} ${suffix}`;
}

adminRoute.get('/meetings', requireAdmin, async c => {
  await ensureMeetingsSchema(c.env);
  const rows=await c.env.DB.prepare(`
    SELECT m.*,a.name created_by_name,
      (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id=m.id AND r.response='yes') going,
      (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id=m.id AND r.response='maybe') maybe,
      (SELECT COUNT(*) FROM meeting_rsvps r WHERE r.meeting_id=m.id AND r.response='no') declined
    FROM meetings m LEFT JOIN admins a ON a.id=m.created_by
    ORDER BY m.meeting_date DESC,m.meeting_time DESC,m.id DESC LIMIT 100
  `).all<any>();
  return c.json(rows.results);
});

adminRoute.post('/meetings', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const b=await c.req.json().catch(()=>({})) as any;
  const title=String(b.title||'').trim().slice(0,120);
  const meetingDate=String(b.meeting_date||'');
  const meetingTime=String(b.meeting_time||'');
  const venue=String(b.venue||'').trim().slice(0,180)||null;
  const agenda=String(b.agenda||'').trim().slice(0,1200)||null;
  const deadline=String(b.rsvp_deadline||'').trim().slice(0,40)||null;
  if(!title) return c.json({error:'Meeting title is required'},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return c.json({error:'Meeting date is required'},400);
  if(!/^\d{2}:\d{2}$/.test(meetingTime)) return c.json({error:'Meeting time is required'},400);
  await ensureMeetingsSchema(c.env);
  const r=await c.env.DB.prepare(`INSERT INTO meetings(title,meeting_date,meeting_time,venue,agenda,rsvp_deadline,created_by) VALUES(?,?,?,?,?,?,?)`)
    .bind(title,meetingDate,meetingTime,venue,agenda,deadline,adminUser.id).run();
  const meeting=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(r.meta.last_row_id).first<any>();
  await auditEntity(c.env,adminUser.id,'meeting_created','meeting',meeting.id,null,meeting);
  return c.json(meeting,201);
});


adminRoute.get('/meetings/:id', requireAdmin, async c => {
  const id=Number(c.req.param('id'));
  await ensureMeetingsSchema(c.env);
  const meeting=await c.env.DB.prepare(`
    SELECT m.*,a.name created_by_name,ca.name cancelled_by_name
    FROM meetings m
    LEFT JOIN admins a ON a.id=m.created_by
    LEFT JOIN admins ca ON ca.id=m.cancelled_by
    WHERE m.id=?
  `).bind(id).first<any>();
  if(!meeting) return c.json({error:'Meeting not found'},404);

  const members=await c.env.DB.prepare(`
    SELECT m.id,m.member_code,m.name,m.telegram_id,
      r.response,r.responded_at
    FROM members m
    LEFT JOIN meeting_rsvps r ON r.member_id=m.id AND r.meeting_id=?
    WHERE m.active=1
    ORDER BY
      CASE r.response WHEN 'yes' THEN 1 WHEN 'maybe' THEN 2 WHEN 'no' THEN 3 ELSE 4 END,
      m.name
  `).bind(id).all<any>();

  const responses={yes:[],maybe:[],no:[],pending:[] as any[]};
  for(const member of members.results){
    if(member.response==='yes') responses.yes.push(member);
    else if(member.response==='maybe') responses.maybe.push(member);
    else if(member.response==='no') responses.no.push(member);
    else responses.pending.push(member);
  }
  return c.json({...meeting,responses,total_members:members.results.length});
});

adminRoute.patch('/meetings/:id', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const before=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Meeting not found'},404);
  if(before.status==='cancelled') return c.json({error:'Cancelled meetings cannot be edited'},409);

  const b=await c.req.json().catch(()=>({})) as any;
  const title=String(b.title??before.title).trim().slice(0,120);
  const meetingDate=String(b.meeting_date??before.meeting_date);
  const meetingTime=String(b.meeting_time??before.meeting_time);
  const venue=String(b.venue??before.venue??'').trim().slice(0,180)||null;
  const agenda=String(b.agenda??before.agenda??'').trim().slice(0,1200)||null;
  const deadline=String(b.rsvp_deadline??before.rsvp_deadline??'').trim().slice(0,40)||null;

  if(!title) return c.json({error:'Meeting title is required'},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return c.json({error:'Meeting date is required'},400);
  if(!/^\d{2}:\d{2}$/.test(meetingTime)) return c.json({error:'Meeting time is required'},400);

  const normalizedBefore={
    title:String(before.title||''),
    meeting_date:String(before.meeting_date||''),
    meeting_time:String(before.meeting_time||''),
    venue:before.venue||null,
    agenda:before.agenda||null,
    rsvp_deadline:before.rsvp_deadline||null
  };
  const next={title,meeting_date:meetingDate,meeting_time:meetingTime,venue,agenda,rsvp_deadline:deadline};
  const changedFields=Object.keys(next).filter((key:any)=>String((next as any)[key]??'')!==String((normalizedBefore as any)[key]??''));
  const rescheduled=changedFields.includes('meeting_date') || changedFields.includes('meeting_time');

  if(changedFields.length===0){
    return c.json({...before,changed:false,rescheduled:false,changed_fields:[],previous_date:before.meeting_date,previous_time:before.meeting_time});
  }

  await c.env.DB.prepare(`
    UPDATE meetings
    SET title=?,meeting_date=?,meeting_time=?,venue=?,agenda=?,rsvp_deadline=?,updated_at=datetime('now')
    WHERE id=?
  `).bind(title,meetingDate,meetingTime,venue,agenda,deadline,id).run();

  const after=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,adminUser.id,rescheduled?'meeting_rescheduled':'meeting_updated','meeting',id,before,{...after,changed_fields:changedFields});
  return c.json({
    ...after,
    changed:true,
    rescheduled,
    changed_fields:changedFields,
    previous_date:before.meeting_date,
    previous_time:before.meeting_time
  });
});

adminRoute.post('/meetings/:id/notify-update', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const body=await c.req.json().catch(()=>({})) as any;
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Meeting is cancelled'},409);

  const rescheduled=Boolean(body.rescheduled);
  const previousDate=String(body.previous_date||'');
  const previousTime=String(body.previous_time||'');
  const changedFields=Array.isArray(body.changed_fields)?body.changed_fields.map(String):[];
  if(!rescheduled && changedFields.length===0){
    return c.json({ok:true,sent:0,unlinked:0,failed:0,skipped:true,reason:'No meeting changes to notify'});
  }

  const members=await c.env.DB.prepare("SELECT id,telegram_id FROM members WHERE active=1").all<any>();
  const deadline=m.rsvp_deadline?`\nRSVP by: <b>${meetingEsc(m.rsvp_deadline)}</b>`:'';
  const venue=m.venue?`\nVenue: <b>${meetingEsc(m.venue)}</b>`:'';
  const agenda=m.agenda?`\n\n${meetingEsc(m.agenda)}`:'';
  const brandName=await groupName(c.env);
  const heading=rescheduled?'📅 <b>Meeting rescheduled</b>':'🔄 <b>Meeting updated</b>';
  const schedule=rescheduled && previousDate
    ? `\nPrevious: ${meetingEsc(meetingDisplayDateTime(previousDate,previousTime))}\nNew: <b>${meetingEsc(meetingDisplayDateTime(m.meeting_date,m.meeting_time))}</b>`
    : `\n${meetingEsc(meetingDisplayDateTime(m.meeting_date,m.meeting_time))}`;
  const delivery=await sendMeetingBatch(c.env,members.results.map((member:any)=>({...member,meeting_id:id,
    text:`${heading} · <b>${meetingEsc(brandName)}</b>\n\n<b>${meetingEsc(m.title)}</b>${schedule}${venue}${deadline}${agenda}\n\nYour previous RSVP is still recorded. You can change it below.`,
    extra:{reply_markup:{inline_keyboard:[[
        {text:'✅ Yes',callback_data:`meeting_rsvp:${id}:yes`},
        {text:'❔ Maybe',callback_data:`meeting_rsvp:${id}:maybe`},
        {text:'❌ No',callback_data:`meeting_rsvp:${id}:no`}
      ]]}}
  })),'meeting.update_notice');
  const {sent,unlinked,failed}=delivery;
  await c.env.DB.prepare("UPDATE meetings SET last_notification_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,adminUser.id,rescheduled?'meeting_reschedule_notified':'meeting_update_notified','meeting',id,m,{sent,unlinked,failed,changed_fields:changedFields});
  return c.json({ok:true,sent,unlinked,failed,rescheduled});
});

adminRoute.post('/meetings/:id/remind-pending', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Meeting is cancelled'},409);

  const members=await c.env.DB.prepare(`
    SELECT mem.id,mem.telegram_id
    FROM members mem
    LEFT JOIN meeting_rsvps r ON r.member_id=mem.id AND r.meeting_id=?
    WHERE mem.active=1 AND r.member_id IS NULL
    ORDER BY mem.name
  `).bind(id).all<any>();

  const deadline=m.rsvp_deadline?`\nRSVP by: <b>${meetingEsc(m.rsvp_deadline)}</b>`:'';
  const venue=m.venue?`\nVenue: <b>${meetingEsc(m.venue)}</b>`:'';
  const brandName=await groupName(c.env);
  const delivery=await sendMeetingBatch(c.env,members.results.map((member:any)=>({...member,meeting_id:id,
    text:`🔔 <b>${meetingEsc(brandName)} · Meeting RSVP reminder</b>\n\n<b>${meetingEsc(m.title)}</b>\n${meetingEsc(m.meeting_date)} · ${meetingEsc(m.meeting_time)}${venue}${deadline}\n\nPlease let us know if you can attend.`,
    extra:{reply_markup:{inline_keyboard:[[
        {text:'✅ Yes',callback_data:`meeting_rsvp:${id}:yes`},
        {text:'❔ Maybe',callback_data:`meeting_rsvp:${id}:maybe`},
        {text:'❌ No',callback_data:`meeting_rsvp:${id}:no`}
      ]]}}
  })),'meeting.pending_reminder');
  const {sent,unlinked,failed}=delivery;
  await c.env.DB.prepare("UPDATE meetings SET last_notification_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,adminUser.id,'meeting_pending_reminder_sent','meeting',id,m,{sent,unlinked,failed,pending:members.results.length});
  return c.json({ok:true,sent,unlinked,failed,pending:members.results.length});
});

adminRoute.post('/meetings/:id/cancel', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const body=await c.req.json().catch(()=>({})) as any;
  const reason=String(body.reason||'').trim().slice(0,500)||'Cancelled by admin';
  const before=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Meeting not found'},404);
  if(before.status==='cancelled') return c.json({error:'Meeting already cancelled'},409);

  await c.env.DB.prepare(`
    UPDATE meetings
    SET status='cancelled',cancelled_at=datetime('now'),cancelled_by=?,cancel_reason=?,updated_at=datetime('now')
    WHERE id=?
  `).bind(adminUser.id,reason,id).run();

  const members=await c.env.DB.prepare("SELECT id,telegram_id FROM members WHERE active=1").all<any>();
  const brandName=await groupName(c.env);
  const delivery=await sendMeetingBatch(c.env,members.results.map((member:any)=>({...member,meeting_id:id,
    text:`🚫 <b>${meetingEsc(brandName)} · Meeting cancelled</b>\n\n<b>${meetingEsc(before.title)}</b>\n${meetingEsc(before.meeting_date)} · ${meetingEsc(before.meeting_time)}\n\nReason: ${meetingEsc(reason)}`
  })),'meeting.cancel_notice');
  const {sent,unlinked,failed}=delivery;

  const after=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,adminUser.id,'meeting_cancelled','meeting',id,before,{...after,notified:{sent,unlinked,failed}});
  return c.json({ok:true,meeting:after,sent,unlinked,failed});
});

adminRoute.post('/meetings/:id/send', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  await ensureMeetingsSchema(c.env);
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Cancelled meetings cannot send invitations'},409);
  const members=await c.env.DB.prepare("SELECT id,name,telegram_id FROM members WHERE active=1 ORDER BY name").all<any>();
  const deadline=m.rsvp_deadline?`\nRSVP by: <b>${meetingEsc(m.rsvp_deadline)}</b>`:'';
  const venue=m.venue?`\nVenue: <b>${meetingEsc(m.venue)}</b>`:'';
  const agenda=m.agenda?`\n\n${meetingEsc(m.agenda)}`:'';
  const brandName=await groupName(c.env);
  const delivery=await sendMeetingBatch(c.env,members.results.map((member:any)=>({...member,meeting_id:id,
    text:`📅 <b>${meetingEsc(brandName)} · Meeting invitation</b>\n\n<b>${meetingEsc(m.title)}</b>\n${meetingEsc(m.meeting_date)} · ${meetingEsc(m.meeting_time)}${venue}${deadline}${agenda}\n\nWill you attend?`,
    extra:{reply_markup:{inline_keyboard:[[
        {text:'✅ Yes',callback_data:`meeting_rsvp:${id}:yes`},
        {text:'❔ Maybe',callback_data:`meeting_rsvp:${id}:maybe`},
        {text:'❌ No',callback_data:`meeting_rsvp:${id}:no`}
      ]]}}
  })),'meeting.invite');
  const {sent,unlinked,failed}=delivery;
  await c.env.DB.prepare("UPDATE meetings SET status='sent',sent_at=COALESCE(sent_at,datetime('now')),last_notification_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,adminUser.id,'meeting_invitations_sent','meeting',id,m,{sent,unlinked,failed});
  return c.json({ok:true,sent,unlinked,failed,total:members.results.length});
});

adminRoute.get('/health', requireAdmin, async c => {
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const full=admin.role==='owner'||admin.role==='super_admin';
  const out:any={checked_at:new Date().toISOString(),db:{ok:false},telegram:{ok:false},webhook:{ok:false},ai:{ok:!!c.env.AI}};
  if(full){out.mini_app_url=await getSetting(c.env,'mini_app_url');out.reminder_schedule=await getSetting(c.env,'reminder_schedule');out.month=currentMonth(c.env.FUND_TIMEZONE||'Indian/Maldives');}
  try{const x=await c.env.DB.prepare('SELECT 1 ok').first<any>();out.db={ok:Number(x?.ok)===1}}catch(e){await safeLogError(c.env,'health.db',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getMe`);const j:any=await r.json();out.telegram=full?{ok:!!j.ok,username:j.result?.username||null}:{ok:!!j.ok}}catch(e){await safeLogError(c.env,'health.telegram',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);const j:any=await r.json();out.webhook=full?{ok:!!j.ok,url:j.result?.url||'',pending:j.result?.pending_update_count||0,last_error:j.result?.last_error_message||null}:{ok:!!j.ok}}catch(e){await safeLogError(c.env,'health.webhook',e)}
  return c.json(out);
});

adminRoute.get('/errors', requireSuperAdmin, async c => { await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT * FROM error_log ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200").all()).results); });
adminRoute.post('/errors/:id/resolve', requireSuperAdmin, async c => { const admin=c.get('admin')!; const id=Number(c.req.param('id')); const before=await c.env.DB.prepare("SELECT * FROM error_log WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:'Not found'},404); await c.env.DB.prepare("UPDATE error_log SET status='resolved',resolved_at=datetime('now'),resolved_by=? WHERE id=?").bind(admin.id,id).run(); await auditEntity(c.env,admin.id,'error_resolved','error_log',id,before,{...before,status:'resolved'}); return c.json({ok:true}); });
adminRoute.post('/errors/resolve-all', requireSuperAdmin, async c => { const admin=c.get('admin')!; const row=await c.env.DB.prepare("SELECT COUNT(*) n FROM error_log WHERE status='open'").first<any>(); await c.env.DB.prepare("UPDATE error_log SET status='resolved',resolved_at=datetime('now'),resolved_by=? WHERE status='open'").bind(admin.id).run(); await auditEntity(c.env,admin.id,'errors_resolved','error_log','open',null,{resolved:Number(row?.n||0)}); return c.json({ok:true,resolved:Number(row?.n||0)}); });

adminRoute.get('/backup', requireSuperAdmin, async c => {
  await ensureOperationalSchema(c.env);
  const tables=['members','admins','member_registration_requests','contributions','contribution_allocations','donations','expense_categories','projects','expenses','exemptions','settings','id_sequences','audit_log','month_closures','meetings','meeting_rsvps','meeting_minutes','meeting_action_items','monthly_snapshots','financial_reversals','error_log','rate_limits','schema_migrations'];
  const version=await c.env.DB.prepare("SELECT MAX(version) version FROM schema_migrations").first<any>();
  const branding=await getBranding(c.env); const slug=branding.short_name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'fund';
  const data:any={exported_at:new Date().toISOString(),format:`${slug}-fund-json-v2`,organization:branding,schema_version:Number(version?.version||0),tables:{}};
  for(const t of tables){data.tables[t]=(await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results;}
  const admin=c.get('admin')!; await auditEntity(c.env,admin.id,'database_backup_exported','database','D1',null,{tables:tables.length,schema_version:data.schema_version});
  c.header('Content-Disposition',`attachment; filename="${slug}-fund-backup-${new Date().toISOString().slice(0,10)}.json"`); return c.json(data);
});
