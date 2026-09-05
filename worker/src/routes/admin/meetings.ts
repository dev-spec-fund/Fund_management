import type { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireAdmin, requireFinance } from "../../auth";
import { auditEntity, safeLogError } from "../../ops";
import { getBranding } from "../../db";
import { sendInBatches } from "../../telegram";

async function groupName(env:any){ return (await getBranding(env)).fund_name; }

async function sendMeetingBatch(env:any, items:any[], source:string){
  const messages=items.filter(x=>x.telegram_id).map(x=>({chatId:x.telegram_id,text:x.text,extra:x.extra||{},context:{meeting_id:x.meeting_id,member_id:x.id}}));
  const unlinked=items.length-messages.length;
  const result=await sendInBatches(env,messages,6);
  for(const f of result.failures) await safeLogError(env,source,f.error,f.message.context);
  return {sent:result.sent,failed:result.failed,unlinked};
}

export function registerMeetingAdminRoutes(route: Hono<AppEnv>) {
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
      cancel_reason TEXT,
      audience TEXT NOT NULL DEFAULT 'all_members',
      completed_at TEXT,
      completed_by INTEGER REFERENCES admins(id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_rsvps (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id),
      member_id INTEGER NOT NULL REFERENCES members(id),
      response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')),
      responded_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(meeting_id, member_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date,meeting_time)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting ON meeting_rsvps(meeting_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_invitees (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id),
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(meeting_id,member_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_attendance (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id),
      attendance TEXT NOT NULL CHECK(attendance IN ('present','absent','excused','late')),
      note TEXT,
      recorded_by INTEGER NOT NULL REFERENCES admins(id),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(meeting_id,member_id)
    )`)
  ]);
  const cols=await env.DB.prepare("PRAGMA table_info(meetings)").all<any>();
  const names=new Set((cols.results as any[]).map((x:any)=>String(x.name)));
  if(!names.has("audience"))await env.DB.prepare("ALTER TABLE meetings ADD COLUMN audience TEXT NOT NULL DEFAULT 'all_members'").run();
  if(!names.has("completed_at"))await env.DB.prepare("ALTER TABLE meetings ADD COLUMN completed_at TEXT").run();
  if(!names.has("completed_by"))await env.DB.prepare("ALTER TABLE meetings ADD COLUMN completed_by INTEGER REFERENCES admins(id)").run();
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

async function meetingAudienceMembers(env:any,meeting:any){
  if(String(meeting?.audience||"all_members")==="exco_only"){
    return env.DB.prepare(`SELECT DISTINCT m.id,m.name,m.member_code,m.telegram_id
      FROM members m JOIN exco_role_assignments x ON x.member_id=m.id
      WHERE m.active=1 AND x.ended_at IS NULL
      ORDER BY m.name`).all<any>();
  }
  return env.DB.prepare("SELECT id,name,member_code,telegram_id FROM members WHERE active=1 ORDER BY name").all<any>();
}

async function ensureMeetingInvitees(env:any,meeting:any){
  const existing=await env.DB.prepare("SELECT COUNT(*) n FROM meeting_invitees WHERE meeting_id=?").bind(meeting.id).first<any>();
  if(Number(existing?.n||0)===0){
    const eligible=await meetingAudienceMembers(env,meeting);
    if(eligible.results.length){
      await env.DB.batch((eligible.results as any[]).map((member:any)=>env.DB.prepare(
        "INSERT OR IGNORE INTO meeting_invitees(meeting_id,member_id) VALUES(?,?)"
      ).bind(meeting.id,member.id)));
    }
  }
  return env.DB.prepare(`SELECT m.id,m.name,m.member_code,m.telegram_id
    FROM meeting_invitees i JOIN members m ON m.id=i.member_id
    WHERE i.meeting_id=? ORDER BY m.name`).bind(meeting.id).all<any>();
}

async function meetingDetailMembers(env:any,meeting:any){
  const snap=await env.DB.prepare("SELECT COUNT(*) n FROM meeting_invitees WHERE meeting_id=?").bind(meeting.id).first<any>();
  if(Number(snap?.n||0)>0){
    return env.DB.prepare(`SELECT m.id,m.member_code,m.name,m.telegram_id,r.response,r.responded_at,
        a.attendance,a.note attendance_note,a.recorded_at attendance_recorded_at
      FROM meeting_invitees i JOIN members m ON m.id=i.member_id
      LEFT JOIN meeting_rsvps r ON r.member_id=m.id AND r.meeting_id=?
      LEFT JOIN meeting_attendance a ON a.member_id=m.id AND a.meeting_id=?
      WHERE i.meeting_id=? ORDER BY m.name`).bind(meeting.id,meeting.id,meeting.id).all<any>();
  }
  const eligible=await meetingAudienceMembers(env,meeting);
  const rows:any[]=[];
  for(const m of eligible.results as any[]){
    const [r,a]=await Promise.all([
      env.DB.prepare("SELECT response,responded_at FROM meeting_rsvps WHERE meeting_id=? AND member_id=?").bind(meeting.id,m.id).first<any>(),
      env.DB.prepare("SELECT attendance,note attendance_note,recorded_at attendance_recorded_at FROM meeting_attendance WHERE meeting_id=? AND member_id=?").bind(meeting.id,m.id).first<any>()
    ]);
    rows.push({...m,...r,...a});
  }
  return {results:rows};
}


route.get('/meetings', requireAdmin, async c => {
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

route.post('/meetings', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const b=await c.req.json().catch(()=>({})) as any;
  const title=String(b.title||'').trim().slice(0,120);
  const meetingDate=String(b.meeting_date||'');
  const meetingTime=String(b.meeting_time||'');
  const venue=String(b.venue||'').trim().slice(0,180)||null;
  const agenda=String(b.agenda||'').trim().slice(0,1200)||null;
  const deadline=String(b.rsvp_deadline||'').trim().slice(0,40)||null;
  const audience=String(b.audience||'all_members')==='exco_only'?'exco_only':'all_members';
  if(!title) return c.json({error:'Meeting title is required'},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return c.json({error:'Meeting date is required'},400);
  if(!/^\d{2}:\d{2}$/.test(meetingTime)) return c.json({error:'Meeting time is required'},400);
  await ensureMeetingsSchema(c.env);
  const r=await c.env.DB.prepare(`INSERT INTO meetings(title,meeting_date,meeting_time,venue,agenda,rsvp_deadline,audience,created_by) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(title,meetingDate,meetingTime,venue,agenda,deadline,audience,adminUser.id).run();
  const meeting=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(r.meta.last_row_id).first<any>();
  await auditEntity(c.env,adminUser.id,'meeting_created','meeting',meeting.id,null,meeting);
  return c.json(meeting,201);
});


route.get('/meetings/:id', requireAdmin, async c => {
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

  const members=await meetingDetailMembers(c.env,meeting);

  const responses={yes:[],maybe:[],no:[],pending:[] as any[]};
  for(const member of members.results){
    if(member.response==='yes') responses.yes.push(member);
    else if(member.response==='maybe') responses.maybe.push(member);
    else if(member.response==='no') responses.no.push(member);
    else responses.pending.push(member);
  }
  const attendance={present:[],late:[],absent:[],excused:[],unrecorded:[] as any[]};
  for(const member of members.results as any[]){
    if(member.attendance==="present")attendance.present.push(member);
    else if(member.attendance==="late")attendance.late.push(member);
    else if(member.attendance==="absent")attendance.absent.push(member);
    else if(member.attendance==="excused")attendance.excused.push(member);
    else attendance.unrecorded.push(member);
  }
  return c.json({...meeting,responses,attendance,total_members:members.results.length});
});

route.patch('/meetings/:id', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const before=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Meeting not found'},404);
  if(before.status==='cancelled') return c.json({error:'Cancelled meetings cannot be edited'},409);
  if(before.status==='completed') return c.json({error:'Completed meetings are read-only'},409);

  const b=await c.req.json().catch(()=>({})) as any;
  const title=String(b.title??before.title).trim().slice(0,120);
  const meetingDate=String(b.meeting_date??before.meeting_date);
  const meetingTime=String(b.meeting_time??before.meeting_time);
  const venue=String(b.venue??before.venue??'').trim().slice(0,180)||null;
  const agenda=String(b.agenda??before.agenda??'').trim().slice(0,1200)||null;
  const deadline=String(b.rsvp_deadline??before.rsvp_deadline??'').trim().slice(0,40)||null;
  const audience=b.audience===undefined?String(before.audience||'all_members'):(String(b.audience)==='exco_only'?'exco_only':'all_members');
  if(before.sent_at && audience!==String(before.audience||'all_members')) return c.json({error:'Meeting audience is locked after invitations are sent'},409);

  if(!title) return c.json({error:'Meeting title is required'},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return c.json({error:'Meeting date is required'},400);
  if(!/^\d{2}:\d{2}$/.test(meetingTime)) return c.json({error:'Meeting time is required'},400);

  const normalizedBefore={
    title:String(before.title||''),
    meeting_date:String(before.meeting_date||''),
    meeting_time:String(before.meeting_time||''),
    venue:before.venue||null,
    agenda:before.agenda||null,
    rsvp_deadline:before.rsvp_deadline||null,
    audience:String(before.audience||'all_members')
  };
  const next={title,meeting_date:meetingDate,meeting_time:meetingTime,venue,agenda,rsvp_deadline:deadline,audience};
  const changedFields=Object.keys(next).filter((key:any)=>String((next as any)[key]??'')!==String((normalizedBefore as any)[key]??''));
  const rescheduled=changedFields.includes('meeting_date') || changedFields.includes('meeting_time');

  if(changedFields.length===0){
    return c.json({...before,changed:false,rescheduled:false,changed_fields:[],previous_date:before.meeting_date,previous_time:before.meeting_time});
  }

  await c.env.DB.prepare(`
    UPDATE meetings
    SET title=?,meeting_date=?,meeting_time=?,venue=?,agenda=?,rsvp_deadline=?,audience=?,updated_at=datetime('now')
    WHERE id=?
  `).bind(title,meetingDate,meetingTime,venue,agenda,deadline,audience,id).run();

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

route.post('/meetings/:id/notify-update', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const body=await c.req.json().catch(()=>({})) as any;
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Meeting is cancelled'},409);
  if(m.status==='completed') return c.json({error:'Completed meetings are read-only'},409);
  if(!m.sent_at) return c.json({error:'Send meeting invitations before notifying members of updates'},409);

  const rescheduled=Boolean(body.rescheduled);
  const previousDate=String(body.previous_date||'');
  const previousTime=String(body.previous_time||'');
  const changedFields=Array.isArray(body.changed_fields)?body.changed_fields.map(String):[];
  if(!rescheduled && changedFields.length===0){
    return c.json({ok:true,sent:0,unlinked:0,failed:0,skipped:true,reason:'No meeting changes to notify'});
  }

  const members=await ensureMeetingInvitees(c.env,m);
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

route.post('/meetings/:id/remind-pending', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Meeting is cancelled'},409);
  if(m.status==='completed') return c.json({error:'Completed meetings are read-only'},409);
  if(!m.sent_at) return c.json({error:'Send meeting invitations before sending RSVP reminders'},409);

  await ensureMeetingInvitees(c.env,m);
  const members=await c.env.DB.prepare(`
    SELECT mem.id,mem.telegram_id
    FROM meeting_invitees i JOIN members mem ON mem.id=i.member_id
    LEFT JOIN meeting_rsvps r ON r.member_id=mem.id AND r.meeting_id=?
    WHERE i.meeting_id=? AND r.member_id IS NULL
    ORDER BY mem.name
  `).bind(id,id).all<any>();

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

route.post('/meetings/:id/cancel', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  const body=await c.req.json().catch(()=>({})) as any;
  const reason=String(body.reason||'').trim().slice(0,500)||'Cancelled by admin';
  const before=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!before) return c.json({error:'Meeting not found'},404);
  if(before.status==='cancelled') return c.json({error:'Meeting already cancelled'},409);
  if(before.status==='completed') return c.json({error:'Completed meetings cannot be cancelled'},409);

  await c.env.DB.prepare(`
    UPDATE meetings
    SET status='cancelled',cancelled_at=datetime('now'),cancelled_by=?,cancel_reason=?,updated_at=datetime('now')
    WHERE id=?
  `).bind(adminUser.id,reason,id).run();

  let sent=0,unlinked=0,failed=0;
  if(before.sent_at){
    const members=await ensureMeetingInvitees(c.env,before);
    const brandName=await groupName(c.env);
    const delivery=await sendMeetingBatch(c.env,members.results.map((member:any)=>({...member,meeting_id:id,
      text:`🚫 <b>${meetingEsc(brandName)} · Meeting cancelled</b>\n\n<b>${meetingEsc(before.title)}</b>\n${meetingEsc(before.meeting_date)} · ${meetingEsc(before.meeting_time)}\n\nReason: ${meetingEsc(reason)}`
    })),'meeting.cancel_notice');
    ({sent,unlinked,failed}=delivery);
  }

  const after=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,adminUser.id,'meeting_cancelled','meeting',id,before,{...after,notified:{sent,unlinked,failed}});
  return c.json({ok:true,meeting:after,sent,unlinked,failed});
});

route.post('/meetings/:id/send', requireFinance, async c => {
  const adminUser=c.get('admin')!;
  const id=Number(c.req.param('id'));
  await ensureMeetingsSchema(c.env);
  const m=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!m) return c.json({error:'Meeting not found'},404);
  if(m.status==='cancelled') return c.json({error:'Cancelled meetings cannot send invitations'},409);
  if(m.status==='completed') return c.json({error:'Completed meetings are read-only'},409);
  const members=await ensureMeetingInvitees(c.env,m);
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


route.put('/meetings/:id/attendance', requireFinance, async c=>{
  const adminUser=c.get('admin')!,id=Number(c.req.param('id'));
  const meeting=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!meeting)return c.json({error:'Meeting not found'},404);
  if(meeting.status==='cancelled')return c.json({error:'Cancelled meeting attendance cannot be changed'},409);
  if(meeting.status==='completed')return c.json({error:'Completed meeting attendance is read-only'},409);
  if(!meeting.sent_at)return c.json({error:'Send meeting invitations before recording attendance'},409);
  const invitees=await ensureMeetingInvitees(c.env,meeting);
  const allowed=new Set((invitees.results as any[]).map((x:any)=>Number(x.id)));
  const body=await c.req.json().catch(()=>({})) as any;
  const entries=Array.isArray(body.entries)?body.entries:[];
  for(const entry of entries){
    const memberId=Number(entry.member_id),attendance=String(entry.attendance||'');
    if(!allowed.has(memberId))return c.json({error:'Attendance can only be recorded for invited members'},400);
    if(!['present','late','absent','excused'].includes(attendance))return c.json({error:'Invalid attendance status'},400);
    await c.env.DB.prepare(`INSERT INTO meeting_attendance(meeting_id,member_id,attendance,note,recorded_by,recorded_at)
      VALUES(?,?,?,?,?,datetime('now'))
      ON CONFLICT(meeting_id,member_id) DO UPDATE SET attendance=excluded.attendance,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=datetime('now')`)
      .bind(id,memberId,attendance,String(entry.note||'').trim().slice(0,300)||null,adminUser.id).run();
  }
  await auditEntity(c.env,adminUser.id,'meeting_attendance_recorded','meeting',id,null,{entries:entries.length});
  const recorded=await c.env.DB.prepare("SELECT COUNT(*) n FROM meeting_attendance WHERE meeting_id=?").bind(id).first<any>();
  return c.json({ok:true,recorded:Number(recorded?.n||0),total:invitees.results.length});
});

route.post('/meetings/:id/complete', requireFinance, async c=>{
  const adminUser=c.get('admin')!,id=Number(c.req.param('id'));
  const before=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:'Meeting not found'},404);
  if(before.status==='cancelled')return c.json({error:'Cancelled meeting cannot be completed'},409);
  if(before.status==='completed')return c.json({error:'Meeting is already completed'},409);
  if(!before.sent_at)return c.json({error:'Send meeting invitations before completing the meeting'},409);
  const invitees=await ensureMeetingInvitees(c.env,before);
  const recorded=await c.env.DB.prepare("SELECT COUNT(*) n FROM meeting_attendance WHERE meeting_id=?").bind(id).first<any>();
  if(Number(recorded?.n||0)!==invitees.results.length)
    return c.json({error:`Record attendance for all ${invitees.results.length} invited member${invitees.results.length===1?'':'s'} before completing the meeting`},409);
  await c.env.DB.prepare(`UPDATE meetings SET status='completed',completed_at=datetime('now'),completed_by=?,updated_at=datetime('now') WHERE id=?`)
    .bind(adminUser.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,adminUser.id,'meeting_completed','meeting',id,before,after);
  return c.json({ok:true,meeting:after});
});
}
