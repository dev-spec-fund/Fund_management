import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireSuperAdmin } from "../auth";
import { auditEntity, ensureOperationalSchema } from "../ops";
import { sendMessage } from "../telegram";
import { getBranding } from "../db";

export const electionsRoute = new Hono<AppEnv>();

const iso = (v:any) => String(v||"").trim().slice(0,19);
const text = (v:any,n=120) => String(v||"").trim().slice(0,n);

function localNow(timeZone="Indian/Maldives"){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  }).formatToParts(new Date());
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||"00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

function applicationPhase(election:any, now:string){
  if(!election?.applications_open_at || !election?.applications_close_at) return "disabled";
  if(now < election.applications_open_at) return "upcoming";
  if(now <= election.applications_close_at) return "open";
  return "closed";
}

async function notifyEligible(env:any,election:any,message:string, onlyNonVoters=false){
  const rows=await env.DB.prepare(`SELECT m.telegram_id FROM election_voters v
    JOIN members m ON m.id=v.member_id
    WHERE v.election_id=? AND m.telegram_id IS NOT NULL
    ${onlyNonVoters?"AND v.voted_at IS NULL":""}`).bind(election.id).all<any>();
  const results=await Promise.allSettled(rows.results.map((m:any)=>sendMessage(env,m.telegram_id,message)));
  return {sent:results.filter(r=>r.status==="fulfilled").length,failed:results.filter(r=>r.status==="rejected").length};
}

async function notifyApplicationMembers(env:any,election:any,message:string, onlyNotApplied=false){
  const query=env.DB.prepare(`SELECT m.id,m.telegram_id FROM members m
    WHERE m.active=1 AND m.telegram_id IS NOT NULL AND trim(m.telegram_id)<>''
    ${onlyNotApplied?`AND NOT EXISTS (
      SELECT 1 FROM election_applications ea WHERE ea.election_id=? AND ea.member_id=m.id
    )`:""}`);
  const rows=onlyNotApplied?await query.bind(election.id).all<any>():await query.all<any>();
  const results=await Promise.allSettled(rows.results.map((m:any)=>sendMessage(env,m.telegram_id,message)));
  return {sent:results.filter(r=>r.status==="fulfilled").length,failed:results.filter(r=>r.status==="rejected").length};
}

async function applicationPositionNames(env:any,electionId:number){
  const rows=await env.DB.prepare("SELECT title,seats FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(electionId).all<any>();
  return rows.results.map((p:any)=>`${p.title}${Number(p.seats)>1?` (${p.seats} seats)`:""}`);
}

function minutesUntilLocal(value:string, timeZone="Indian/Maldives"){
  const now=localNow(timeZone);
  const from=new Date(`${now}+05:00`).getTime();
  const to=new Date(`${String(value).slice(0,19)}+05:00`).getTime();
  return Math.floor((to-from)/60000);
}

export async function processElectionLifecycle(env:any){
  const timeZone=env.FUND_TIMEZONE || "Indian/Maldives";
  const now=localNow(timeZone);

  // Candidate application notifications are claimed in D1 before Telegram sends,
  // so scheduled runs and normal API reads cannot send duplicates.
  const applicationOpenRows=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='draft'
      AND applications_open_at IS NOT NULL AND applications_open_at<>''
      AND applications_close_at IS NOT NULL AND applications_close_at<>''
      AND applications_open_at<=? AND applications_close_at>=?
      AND applications_notified_at IS NULL`).bind(now,now).all<any>();
  for(const election of applicationOpenRows.results as any[]){
    const positions=await applicationPositionNames(env,election.id);
    if(!positions.length)continue;
    const claim=await env.DB.prepare(`UPDATE elections SET applications_notified_at=datetime('now')
      WHERE id=? AND applications_notified_at IS NULL`).bind(election.id).run();
    if(!claim.meta.changes)continue;
    const brand=await getBranding(env);
    const deadline=String(election.applications_close_at||"").replace("T"," ");
    const positionsText=positions.length?`\n\nAvailable positions:\n${positions.map(x=>`• ${x}`).join("\n")}`:"";
    const result=await notifyApplicationMembers(env,election,
      `📣 <b>${brand.fund_name} · EXCO Candidate Applications Open</b>\n\n<b>${election.title}</b>${positionsText}\n\nApplications close: <b>${deadline}</b>\n\nOpen the Mini App → Elections to apply.`);
    await auditEntity(env,null,"election_applications_open_notified","election",election.id,election,{...election,notification_result:result});
  }

  const reminderRows=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='draft'
      AND applications_close_at IS NOT NULL AND applications_close_at<>''
      AND applications_open_at IS NOT NULL AND applications_open_at<=?
      AND applications_close_at>?
      AND applications_notified_at IS NOT NULL
      AND applications_reminder_at IS NULL`).bind(now,now).all<any>();
  for(const election of reminderRows.results as any[]){
    const minutes=minutesUntilLocal(election.applications_close_at,timeZone);
    if(minutes<0 || minutes>1440)continue;
    const claim=await env.DB.prepare(`UPDATE elections SET applications_reminder_at=datetime('now')
      WHERE id=? AND applications_reminder_at IS NULL`).bind(election.id).run();
    if(!claim.meta.changes)continue;
    const brand=await getBranding(env);
    const deadline=String(election.applications_close_at||"").replace("T"," ");
    const result=await notifyApplicationMembers(env,election,
      `⏰ <b>${brand.fund_name} · Candidate Application Reminder</b>\n\nApplications for <b>${election.title}</b> close within 24 hours.\nDeadline: <b>${deadline}</b>\n\nOpen the Mini App → Elections if you want to apply.`,true);
    await auditEntity(env,null,"election_applications_closing_reminder","election",election.id,election,{...election,notification_result:result});
  }

  const drafts=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='draft' AND opens_at IS NOT NULL AND opens_at<>'' AND opens_at<=?`).bind(now).all<any>();
  for(const election of drafts.results as any[]){
    const pc=await env.DB.prepare("SELECT COUNT(*) n FROM election_positions WHERE election_id=?").bind(election.id).first<any>();
    const cc=await env.DB.prepare("SELECT COUNT(*) n FROM election_candidates WHERE election_id=? AND status='active'").bind(election.id).first<any>();
    const pending=await env.DB.prepare("SELECT COUNT(*) n FROM election_applications WHERE election_id=? AND status='pending'").bind(election.id).first<any>();
    if(!Number(pc?.n)||!Number(cc?.n)||Number(pending?.n)>0)continue;
    const result=await env.DB.prepare("UPDATE elections SET status='open',opened_at=datetime('now') WHERE id=? AND status='draft'").bind(election.id).run();
    if(result.meta.changes){
      await auditEntity(env,null,"election_auto_opened","election",election.id,election,{...election,status:"open"});
      await env.DB.prepare("INSERT OR IGNORE INTO election_voters(election_id,member_id) SELECT ?,id FROM members WHERE active=1").bind(election.id).run();
      const brand=await getBranding(env);
      await notifyEligible(env,election,`🗳 <b>${brand.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`).catch(()=>{});
    }
  }
  const open=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='open' AND closes_at IS NOT NULL AND closes_at<>'' AND closes_at<=?`).bind(now).all<any>();
  for(const election of open.results as any[]){
    const result=await env.DB.prepare("UPDATE elections SET status='closed',closed_at=datetime('now') WHERE id=? AND status='open'").bind(election.id).run();
    if(result.meta.changes) await auditEntity(env,null,"election_auto_closed","election",election.id,election,{...election,status:"closed"});
  }
}

async function memberForUser(c:any){
  const user=c.get("telegramUser");
  return c.env.DB.prepare("SELECT id,member_code,name,telegram_id FROM members WHERE telegram_id=? AND active=1 LIMIT 1")
    .bind(String(user?.id||"")).first<any>();
}
async function electionDetail(env:any,id:number){
  const election=await env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return null;
  const [positions,candidates,voters,audit,certifier,applications]=await Promise.all([
    env.DB.prepare("SELECT * FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(id).all<any>(),
    env.DB.prepare(`SELECT ec.*,m.member_code FROM election_candidates ec LEFT JOIN members m ON m.id=ec.member_id
      WHERE ec.election_id=? ORDER BY ec.position_id,ec.display_name`).bind(id).all<any>(),
    env.DB.prepare("SELECT COUNT(*) eligible,SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted FROM election_voters WHERE election_id=?").bind(id).first<any>(),
    env.DB.prepare(`SELECT a.id,a.action,a.created_at,ad.name admin_name FROM audit_log a
      LEFT JOIN admins ad ON ad.id=a.admin_id
      WHERE a.action LIKE 'election_%' AND
        (a.detail LIKE ? OR a.detail LIKE ?)
      ORDER BY a.id DESC LIMIT 30`).bind(`%\"entity\":\"election\",\"entity_id\":${id}%`,`%\"election_id\":${id}%`).all<any>(),
    election.certified_by?env.DB.prepare("SELECT name FROM admins WHERE id=?").bind(election.certified_by).first<any>():Promise.resolve(null),
    env.DB.prepare(`SELECT ea.*,m.name member_name,m.member_code,ep.title position_title
      FROM election_applications ea JOIN members m ON m.id=ea.member_id JOIN election_positions ep ON ep.id=ea.position_id
      WHERE ea.election_id=? ORDER BY ea.submitted_at DESC`).bind(id).all<any>()
  ]);
  const eligible=Number(voters?.eligible||0),voted=Number(voters?.voted||0);
  return {...election,positions:positions.results.map((p:any)=>({...p,candidates:candidates.results.filter((x:any)=>Number(x.position_id)===Number(p.id))})),
    turnout:{eligible,voted,percent:eligible>0?Math.round((voted/eligible)*1000)/10:0},
    audit_history:audit.results,certified_by_name:certifier?.name||null,applications:applications.results,
    application_phase:applicationPhase(election,localNow(env.FUND_TIMEZONE || "Indian/Maldives"))};
}

electionsRoute.get("/", async c=>{
  await ensureOperationalSchema(c.env);
  await processElectionLifecycle(c.env);
  const member=await memberForUser(c);
  const admin=c.get("admin");
  const rows=await c.env.DB.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id) eligible,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id AND v.voted_at IS NOT NULL) voted
    FROM elections e
    WHERE ? IS NOT NULL
       OR e.status<>'draft'
       OR (e.status='draft' AND e.applications_open_at IS NOT NULL AND e.applications_close_at IS NOT NULL)
    ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,e.id DESC`)
    .bind(admin?.id||null).all<any>();
  const result=[];
  for(const e of rows.results as any[]){
    let my_vote=false,eligible=false,my_application=null;
    if(member){
      const [v,a]=await Promise.all([
        c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(e.id,member.id).first<any>(),
        c.env.DB.prepare("SELECT id,position_id,status,submitted_at FROM election_applications WHERE election_id=? AND member_id=? ORDER BY id DESC LIMIT 1").bind(e.id,member.id).first<any>()
      ]);
      eligible=!!v; my_vote=!!v?.voted_at; my_application=a||null;
    }
    const eligibleCount=Number(e.eligible||0),votedCount=Number(e.voted||0);
    result.push({...e,eligible,my_vote,my_application,
      application_phase:applicationPhase(e,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives")),
      turnout:{eligible:eligibleCount,voted:votedCount,percent:eligibleCount>0?Math.round((votedCount/eligibleCount)*1000)/10:0}});
  }
  return c.json(result);
});

electionsRoute.get("/:id", async c=>{
  await ensureOperationalSchema(c.env);
  await processElectionLifecycle(c.env);
  const id=Number(c.req.param("id")); const detail=await electionDetail(c.env,id);
  if(!detail)return c.json({error:"Election not found"},404);
  const member=await memberForUser(c); const admin=c.get("admin");
  let eligible=false,my_vote=false;
  if(member){
    const v=await c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(id,member.id).first<any>();
    eligible=!!v;my_vote=!!v?.voted_at;
  }
  if(!admin && detail.status==="draft" && detail.application_phase==="disabled")return c.json({error:"Election not available"},404);
  let results:any[]= [];
  if(detail.status==="closed" && (admin || detail.certified_at)){
    const rows=await c.env.DB.prepare(`SELECT b.position_id,b.candidate_id,COUNT(*) votes
      FROM election_ballots b WHERE b.election_id=? GROUP BY b.position_id,b.candidate_id`).bind(id).all<any>();
    const voteMap=new Map(rows.results.map((r:any)=>[Number(r.candidate_id),Number(r.votes||0)]));
    for(const position of detail.positions){
      const active=position.candidates.filter((c:any)=>c.status==="active").map((c:any)=>({...c,votes:voteMap.get(Number(c.id))||0}))
        .sort((a:any,b:any)=>b.votes-a.votes || String(a.display_name).localeCompare(String(b.display_name)));
      const seats=Number(position.seats||1);
      const cutoff=active.length>=seats?Number(active[seats-1]?.votes||0):null;
      const above=cutoff===null?active.length:active.filter((c:any)=>c.votes>cutoff).length;
      const tied=cutoff===null?[]:active.filter((c:any)=>c.votes===cutoff);
      const tieAtCutoff=cutoff!==null && tied.length>(seats-above);
      for(const candidate of position.candidates){
        if(candidate.status==="withdrawn"){results.push({position_id:position.id,candidate_id:candidate.id,votes:voteMap.get(Number(candidate.id))||0,outcome:"withdrawn"});continue;}
        const votes=voteMap.get(Number(candidate.id))||0;
        let outcome="not_elected";
        if(cutoff===null || votes>cutoff) outcome="elected";
        else if(votes===cutoff) outcome=tieAtCutoff?"tie":"elected";
        results.push({position_id:position.id,candidate_id:candidate.id,votes,outcome});
      }
    }
  }
  const visibleApplications=admin?detail.applications:(member?detail.applications.filter((a:any)=>Number(a.member_id)===Number(member.id)).map((a:any)=>({
    id:a.id,election_id:a.election_id,position_id:a.position_id,status:a.status,statement:a.statement,submitted_at:a.submitted_at,review_reason:a.review_reason,withdrawn_at:a.withdrawn_at
  })):[]);
  return c.json({...detail,applications:visibleApplications,eligible,my_vote,results,results_visible:!!admin||!!detail.certified_at});
});

electionsRoute.post("/", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const body=await c.req.json<any>();
  const title=text(body.title); if(!title)return c.json({error:"Election title is required"},400);
  const opensAt=iso(body.opens_at)||null,closesAt=iso(body.closes_at)||null;
  const applicationsOpenAt=iso(body.applications_open_at)||null,applicationsCloseAt=iso(body.applications_close_at)||null;
  if(opensAt&&closesAt&&closesAt<=opensAt)return c.json({error:"Voting close time must be after the opening time"},400);
  if(applicationsOpenAt&&applicationsCloseAt&&applicationsCloseAt<=applicationsOpenAt)return c.json({error:"Application close time must be after application opening time"},400);
  if(applicationsCloseAt&&opensAt&&applicationsCloseAt>opensAt)return c.json({error:"Candidate applications must close before voting opens"},400);
  const r=await c.env.DB.prepare(`INSERT INTO elections(title,term,opens_at,closes_at,applications_open_at,applications_close_at,status,created_by)
    VALUES(?,?,?,?,?,?, 'draft',?)`).bind(title,text(body.term,80)||null,opensAt,closesAt,applicationsOpenAt,applicationsCloseAt,admin.id).run();
  const id=Number(r.meta.last_row_id);
  await auditEntity(c.env,admin.id,"election_created","election",id,null,{title,term:body.term||null});
  return c.json(await electionDetail(c.env,id),201);
});

electionsRoute.patch("/:id", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404); if(before.status!=="draft")return c.json({error:"Only draft elections can be edited"},409);
  const body=await c.req.json<any>(); const title=text(body.title||before.title);
  const opensAt=iso(body.opens_at??before.opens_at)||null,closesAt=iso(body.closes_at??before.closes_at)||null;
  const applicationsOpenAt=iso(body.applications_open_at??before.applications_open_at)||null,applicationsCloseAt=iso(body.applications_close_at??before.applications_close_at)||null;
  if(opensAt&&closesAt&&closesAt<=opensAt)return c.json({error:"Voting close time must be after the opening time"},400);
  if(applicationsOpenAt&&applicationsCloseAt&&applicationsCloseAt<=applicationsOpenAt)return c.json({error:"Application close time must be after application opening time"},400);
  if(applicationsCloseAt&&opensAt&&applicationsCloseAt>opensAt)return c.json({error:"Candidate applications must close before voting opens"},400);
  await c.env.DB.prepare("UPDATE elections SET title=?,term=?,opens_at=?,closes_at=?,applications_open_at=?,applications_close_at=? WHERE id=?")
    .bind(title,text(body.term??before.term,80)||null,opensAt,closesAt,applicationsOpenAt,applicationsCloseAt,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"election_updated","election",id,before,after);
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/positions", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="draft")return c.json({error:"Election is locked"},409);
  const body=await c.req.json<any>(); const title=text(body.title); if(!title)return c.json({error:"Position title is required"},400);
  const seats=Math.max(1,Math.min(20,Number(body.seats)||1)); const maxSelections=Math.max(1,Math.min(seats,Number(body.max_selections)||seats));
  const minSelections=Math.max(0,Math.min(maxSelections,Number(body.min_selections ?? 1)));
  const r=await c.env.DB.prepare("INSERT INTO election_positions(election_id,title,seats,max_selections,min_selections,sort_order) VALUES(?,?,?,?,?,?)")
    .bind(id,title,seats,maxSelections,minSelections,Number(body.sort_order)||0).run();
  await auditEntity(c.env,admin.id,"election_position_added","election_position",Number(r.meta.last_row_id),null,{election_id:id,title,seats,max_selections:maxSelections,min_selections:minSelections});
  return c.json(await electionDetail(c.env,id),201);
});

electionsRoute.post("/:id/candidates", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT status FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="draft")return c.json({error:"Election is locked"},409);
  const body=await c.req.json<any>(); const positionId=Number(body.position_id),memberId=Number(body.member_id);
  const position=await c.env.DB.prepare("SELECT id FROM election_positions WHERE id=? AND election_id=?").bind(positionId,id).first<any>();
  const member=await c.env.DB.prepare("SELECT id,name FROM members WHERE id=? AND active=1").bind(memberId).first<any>();
  if(!position||!member)return c.json({error:"Choose a valid position and active member"},400);
  try{
    const r=await c.env.DB.prepare("INSERT INTO election_candidates(election_id,position_id,member_id,display_name) VALUES(?,?,?,?)")
      .bind(id,positionId,memberId,member.name).run();
    await auditEntity(c.env,admin.id,"election_candidate_added","election_candidate",Number(r.meta.last_row_id),null,{election_id:id,position_id:positionId,member_id:memberId});
  }catch{return c.json({error:"Candidate is already added for this position"},409)}
  return c.json(await electionDetail(c.env,id),201);
});

electionsRoute.post("/:id/open", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="draft")return c.json({error:"Election is not draft"},409);
  const pc=await c.env.DB.prepare("SELECT COUNT(*) n FROM election_positions WHERE election_id=?").bind(id).first<any>();
  const cc=await c.env.DB.prepare("SELECT COUNT(*) n FROM election_candidates WHERE election_id=? AND status='active'").bind(id).first<any>();
  const pending=await c.env.DB.prepare("SELECT COUNT(*) n FROM election_applications WHERE election_id=? AND status='pending'").bind(id).first<any>();
  const phase=applicationPhase(election,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"));
  if(phase==="open")return c.json({error:"Candidate applications are still open"},409);
  if(Number(pending?.n)>0)return c.json({error:"Review all pending candidate applications before opening voting"},409);
  if(!Number(pc?.n)||!Number(cc?.n))return c.json({error:"Add or approve at least one candidate before opening"},400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO election_voters(election_id,member_id) SELECT ?,id FROM members WHERE active=1").bind(id),
    c.env.DB.prepare("UPDATE elections SET status='open',opened_at=datetime('now') WHERE id=? AND status='draft'").bind(id)
  ]);
  await auditEntity(c.env,admin.id,"election_opened","election",id,election,{...election,status:"open"});
  const branding=await getBranding(c.env);
  const members=await c.env.DB.prepare(`SELECT m.telegram_id FROM election_voters v JOIN members m ON m.id=v.member_id
    WHERE v.election_id=? AND m.telegram_id IS NOT NULL`).bind(id).all<any>();
  c.executionCtx.waitUntil(Promise.allSettled(members.results.map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${branding.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`))));
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/close", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Election is not open"},409);
  await c.env.DB.prepare("UPDATE elections SET status='closed',closed_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,admin.id,"election_closed","election",id,election,{...election,status:"closed"});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/cancel", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status==="closed")return c.json({error:"Closed election cannot be cancelled"},409);
  await c.env.DB.prepare("UPDATE elections SET status='cancelled',closed_at=datetime('now') WHERE id=?").bind(id).run();
  await auditEntity(c.env,admin.id,"election_cancelled","election",id,election,{...election,status:"cancelled"});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/applications", async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id")); const member=await memberForUser(c);
  if(!member)return c.json({error:"Approved member account required"},403);
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(election.status!=="draft" || applicationPhase(election,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"))!=="open")
    return c.json({error:"Candidate applications are not open"},409);
  const body=await c.req.json<any>().catch(()=>({})); const positionId=Number(body.position_id);
  const position=await c.env.DB.prepare("SELECT id,title FROM election_positions WHERE id=? AND election_id=?").bind(positionId,id).first<any>();
  if(!position)return c.json({error:"Choose a valid available position"},400);
  try{
    const r=await c.env.DB.prepare(`INSERT INTO election_applications(election_id,position_id,member_id,statement)
      VALUES(?,?,?,?)`).bind(id,positionId,member.id,text(body.statement,600)||null).run();
    return c.json({ok:true,id:Number(r.meta.last_row_id),status:"pending"},201);
  }catch{return c.json({error:"You have already applied for this position"},409)}
});

electionsRoute.post("/:id/applications/:applicationId/withdraw", async c=>{
  const id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId")); const member=await memberForUser(c);
  if(!member)return c.json({error:"Approved member account required"},403);
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(applicationPhase(election,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"))!=="open")return c.json({error:"Application withdrawal period has ended"},409);
  const r=await c.env.DB.prepare(`UPDATE election_applications SET status='withdrawn',withdrawn_at=datetime('now')
    WHERE id=? AND election_id=? AND member_id=? AND status='pending'`).bind(applicationId,id,member.id).run();
  if(!r.meta.changes)return c.json({error:"Application cannot be withdrawn"},409);
  return c.json({ok:true});
});

electionsRoute.post("/:id/applications/:applicationId/review", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId"));
  const body=await c.req.json<any>().catch(()=>({})); const decision=String(body.decision||"");
  if(!["approved","rejected"].includes(decision))return c.json({error:"Decision must be approved or rejected"},400);
  const application=await c.env.DB.prepare(`SELECT ea.*,m.name member_name FROM election_applications ea
    JOIN members m ON m.id=ea.member_id WHERE ea.id=? AND ea.election_id=?`).bind(applicationId,id).first<any>();
  if(!application)return c.json({error:"Application not found"},404); if(application.status!=="pending")return c.json({error:"Application is already decided"},409);
  const reason=text(body.reason,300)||null;
  if(decision==="approved"){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE election_applications SET status='approved',reviewed_at=datetime('now'),reviewed_by=?,review_reason=? WHERE id=? AND status='pending'`).bind(admin.id,reason,applicationId),
      c.env.DB.prepare(`INSERT OR IGNORE INTO election_candidates(election_id,position_id,member_id,display_name) VALUES(?,?,?,?)`).bind(id,application.position_id,application.member_id,application.member_name)
    ]);
  }else{
    await c.env.DB.prepare(`UPDATE election_applications SET status='rejected',reviewed_at=datetime('now'),reviewed_by=?,review_reason=? WHERE id=? AND status='pending'`)
      .bind(admin.id,reason,applicationId).run();
  }
  await auditEntity(c.env,admin.id,`election_application_${decision}`,"election_application",applicationId,{...application,election_id:id},{...application,election_id:id,status:decision,review_reason:reason});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/candidates/:candidateId/withdraw", requireSuperAdmin, async c=>{
  await processElectionLifecycle(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id")),candidateId=Number(c.req.param("candidateId"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(!["draft","open"].includes(election.status))return c.json({error:"Candidates can only withdraw before voting closes"},409);
  const before=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE id=? AND election_id=?").bind(candidateId,id).first<any>();
  if(!before)return c.json({error:"Candidate not found"},404);
  const body=await c.req.json<any>().catch(()=>({})); const reason=text(body.reason,300)||"Withdrawn";
  await c.env.DB.prepare(`UPDATE election_candidates SET status='withdrawn',withdrawn_at=datetime('now'),withdrawn_by=?,withdrawal_reason=?
    WHERE id=? AND election_id=?`).bind(admin.id,reason,candidateId,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE id=?").bind(candidateId).first<any>();
  await auditEntity(c.env,admin.id,"election_candidate_withdrawn","election_candidate",candidateId,before,{...after,election_id:id});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/remind-nonvoters", requireSuperAdmin, async c=>{
  await processElectionLifecycle(c.env);
  const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Election is not open"},409);
  const brand=await getBranding(c.env);
  const result=await notifyEligible(c.env,election,`🗳 <b>${brand.fund_name} · Voting reminder</b>\n\nYou are eligible to vote in <b>${election.title}</b> and have not yet submitted your ballot. Open the Mini App to vote.`,true);
  return c.json({ok:true,...result});
});

electionsRoute.post("/:id/certify", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404); if(before.status!=="closed")return c.json({error:"Close the election before certification"},409);
  if(before.certified_at)return c.json({error:"Results are already certified"},409);
  await c.env.DB.prepare("UPDATE elections SET certified_at=datetime('now'),certified_by=? WHERE id=?").bind(admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"election_results_certified","election",id,before,after);
  const brand=await getBranding(c.env);
  await notifyEligible(c.env,after,`🏆 <b>${brand.fund_name} · ${after.title}</b>\n\nElection results have been certified and are now available in the Mini App.`).catch(()=>{});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/vote", async c=>{
  await processElectionLifecycle(c.env);
  const id=Number(c.req.param("id")); const member=await memberForUser(c); if(!member)return c.json({error:"Approved member account required"},403);
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Voting is not open"},409);
  const voter=await c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(id,member.id).first<any>();
  if(!voter)return c.json({error:"You are not eligible to vote in this election"},403); if(voter.voted_at)return c.json({error:"Your ballot has already been submitted"},409);
  const body=await c.req.json<any>().catch(()=>({})); const selections=body.selections&&typeof body.selections==="object"?body.selections:{};
  const claim=crypto.randomUUID();
  const claimed=await c.env.DB.prepare("UPDATE election_voters SET vote_claim=? WHERE election_id=? AND member_id=? AND voted_at IS NULL AND vote_claim IS NULL")
    .bind(claim,id,member.id).run();
  if(!claimed.meta.changes)return c.json({error:"Your ballot is already submitted or currently being processed"},409);
  const positions=await c.env.DB.prepare("SELECT id,title,min_selections,max_selections FROM election_positions WHERE election_id=? ORDER BY id").bind(id).all<any>();
  const statements:any[]=[]; const token=crypto.randomUUID();
  for(const p of positions.results as any[]){
    const ids=Array.isArray(selections[String(p.id)])?selections[String(p.id)].map(Number).filter(Number.isInteger):[];
    const unique=[...new Set(ids)];
    if(unique.length<Number(p.min_selections||0)){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run();return c.json({error:`Select at least ${p.min_selections} candidate${Number(p.min_selections)===1?"":"s"} for ${p.title}`},400);}
    if(unique.length>Number(p.max_selections)){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run();return c.json({error:`Select no more than ${p.max_selections} candidate${Number(p.max_selections)===1?"":"s"} for ${p.title}`},400);}
    for(const candidateId of unique){
      const candidate=await c.env.DB.prepare("SELECT id FROM election_candidates WHERE id=? AND election_id=? AND position_id=? AND status='active'")
        .bind(candidateId,id,p.id).first<any>();
      if(!candidate){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run();return c.json({error:"Invalid candidate selection"},400);}
      statements.push(c.env.DB.prepare("INSERT INTO election_ballots(election_id,ballot_token,position_id,candidate_id) VALUES(?,?,?,?)").bind(id,token,p.id,candidateId));
    }
  }
  // The voter row records only participation. Ballot rows contain no member_id.
  statements.push(c.env.DB.prepare("UPDATE election_voters SET voted_at=datetime('now'),vote_claim=NULL WHERE election_id=? AND member_id=? AND voted_at IS NULL AND vote_claim=?").bind(id,member.id,claim));
  try{await c.env.DB.batch(statements);}catch(e){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run().catch(()=>{});throw e;}
  return c.json({ok:true,submitted:true});
});
