import { auditEntity } from "../ops";
import { sendMessage } from "../telegram";
import { getBranding } from "../db";

export const iso = (v:any) => String(v||"").trim().slice(0,19);
export const text = (v:any,n=120) => String(v||"").trim().slice(0,n);

export function localNow(timeZone="Indian/Maldives"){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  }).formatToParts(new Date());
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||"00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export function applicationPhase(election:any, now:string){
  if(!election?.applications_open_at || !election?.applications_close_at) return "disabled";
  if(now < election.applications_open_at) return "upcoming";
  if(now <= election.applications_close_at) return "open";
  return "closed";
}


export async function notifyEligible(env:any,election:any,message:string, onlyNonVoters=false){
  const rows=await env.DB.prepare(`SELECT m.telegram_id FROM election_voters v
    JOIN members m ON m.id=v.member_id
    WHERE v.election_id=? AND m.telegram_id IS NOT NULL
    ${onlyNonVoters?"AND v.voted_at IS NULL":""}`).bind(election.id).all<any>();
  const results=await Promise.allSettled(rows.results.map((m:any)=>sendMessage(env,m.telegram_id,message)));
  const sent=results.filter((r:any)=>r.status==="fulfilled"&&r.value?.ok===true).length;
  return {sent,failed:results.length-sent};
}

export async function recordElectionNotification(env:any,electionId:number,eventKey:string,audience:string,result:any,detail:any=null,createdBy:number|null=null){
  const sent=Number(result?.sent||0),failed=Number(result?.failed||0);
  await env.DB.prepare(`INSERT INTO election_notification_log(election_id,event_key,audience,sent,failed,detail,created_by)
    VALUES(?,?,?,?,?,?,?)`).bind(electionId,eventKey,audience,sent,failed,detail==null?null:JSON.stringify(detail),createdBy).run();
  return {sent,failed};
}

async function notificationAlreadySent(env:any,electionId:number,eventKey:string){
  const row=await env.DB.prepare("SELECT id FROM election_notification_log WHERE election_id=? AND event_key=? LIMIT 1")
    .bind(electionId,eventKey).first<any>();
  return !!row;
}

export async function claimElectionNotification(env:any,electionId:number,eventKey:string,audience:string,detail:any=null,createdBy:number|null=null){
  const claimed=await env.DB.prepare(`INSERT INTO election_notification_log(election_id,event_key,audience,sent,failed,detail,created_by)
    SELECT ?,?,?,0,0,?,?
    WHERE NOT EXISTS(SELECT 1 FROM election_notification_log WHERE election_id=? AND event_key=? LIMIT 1)`)
    .bind(electionId,eventKey,audience,detail==null?null:JSON.stringify(detail),createdBy,electionId,eventKey).run();
  if(!claimed.meta.changes)return null;
  return Number(claimed.meta.last_row_id);
}

export async function finishClaimedElectionNotification(env:any,notificationId:number,result:any){
  const sent=Number(result?.sent||0),failed=Number(result?.failed||0);
  await env.DB.prepare("UPDATE election_notification_log SET sent=?,failed=? WHERE id=?")
    .bind(sent,failed,notificationId).run();
  return {sent,failed};
}

async function notifyRunoffNonVoters(env:any,runoff:any,message:string){
  const rows=await env.DB.prepare(`SELECT m.telegram_id FROM election_runoff_voters v
    JOIN members m ON m.id=v.member_id
    WHERE v.runoff_id=? AND v.voted_at IS NULL AND m.telegram_id IS NOT NULL`).bind(runoff.id).all<any>();
  const results=await Promise.allSettled((rows.results as any[]).map((m:any)=>sendMessage(env,m.telegram_id,message)));
  const sent=results.filter((r:any)=>r.status==="fulfilled"&&r.value?.ok===true).length;
  return {sent,failed:results.length-sent};
}

async function processElectionClosingReminders(env:any){
  const now=localNow(env.FUND_TIMEZONE || "Indian/Maldives");
  const nowMs=Date.parse(`${now}Z`);
  const brand=await getBranding(env);

  const elections=await env.DB.prepare(`SELECT * FROM elections WHERE status='open'
    AND closes_at IS NOT NULL AND closes_at<>'' AND closes_at>?`).bind(now).all<any>();
  for(const election of elections.results as any[]){
    const closeMs=Date.parse(`${election.closes_at}Z`);
    if(!Number.isFinite(closeMs)||!Number.isFinite(nowMs)||closeMs-nowMs>24*60*60*1000)continue;
    const eventKey="voting_closing_24h";
    const notificationId=await claimElectionNotification(env,election.id,eventKey,"non_voters",{closes_at:election.closes_at});
    if(!notificationId)continue;
    const result=await notifyEligible(env,election,
      `⏳ <b>${brand.fund_name} · ${election.title}</b>\n\nVoting closes within 24 hours and you have not voted yet. Open the Mini App to submit your secret ballot.`,true);
    await finishClaimedElectionNotification(env,notificationId,result);
  }

  const runoffs=await env.DB.prepare(`SELECT r.*,e.title election_title,ep.title position_title
    FROM election_runoffs r JOIN elections e ON e.id=r.election_id JOIN election_positions ep ON ep.id=r.position_id
    WHERE r.status='open' AND r.closes_at IS NOT NULL AND r.closes_at<>'' AND r.closes_at>?`).bind(now).all<any>();
  for(const runoff of runoffs.results as any[]){
    const closeMs=Date.parse(`${runoff.closes_at}Z`);
    if(!Number.isFinite(closeMs)||!Number.isFinite(nowMs)||closeMs-nowMs>24*60*60*1000)continue;
    const eventKey=`runoff_closing_24h:${runoff.id}`;
    const notificationId=await claimElectionNotification(env,runoff.election_id,eventKey,"runoff_non_voters",{runoff_id:runoff.id,closes_at:runoff.closes_at});
    if(!notificationId)continue;
    const result=await notifyRunoffNonVoters(env,runoff,
      `⏳ <b>${brand.fund_name} · Runoff Vote</b>\n\nThe runoff for <b>${runoff.position_title}</b> in ${runoff.election_title} closes within 24 hours. Open the Mini App to vote.`);
    await finishClaimedElectionNotification(env,notificationId,result);
  }
}

async function processApplicationReminders(env:any){
  const now=localNow(env.FUND_TIMEZONE || "Indian/Maldives");
  const currentMs=Date.parse(`${now}Z`);
  const rows=await env.DB.prepare(`SELECT * FROM elections WHERE status='draft'
    AND applications_open_at IS NOT NULL AND applications_close_at IS NOT NULL
    AND application_reminder_sent_at IS NULL AND applications_open_at<=? AND applications_close_at>?`).bind(now,now).all<any>();
  for(const election of rows.results as any[]){
    const closeMs=Date.parse(`${election.applications_close_at}Z`);
    if(!Number.isFinite(currentMs)||!Number.isFinite(closeMs)||closeMs-currentMs>24*60*60*1000)continue;
    const eventKey="applications_closing_24h";
    const notificationId=await claimElectionNotification(env,election.id,eventKey,"eligible_non_applicants",{closes_at:election.applications_close_at});
    if(!notificationId)continue;
    const members=await env.DB.prepare(`SELECT m.* FROM members m WHERE m.active=1 AND m.telegram_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM election_applications ea WHERE ea.election_id=? AND ea.member_id=m.id AND ea.status IN ('pending','approved'))`).bind(election.id).all<any>();
    const brand=await getBranding(env);
    const deliveries=await Promise.allSettled((members.results as any[]).map((member:any)=>sendMessage(env,member.telegram_id,
      `⏳ <b>${brand.fund_name} · ${election.title}</b>\n\nCandidate applications close within 24 hours. All registered active members can apply for an available EXCO position in the Mini App.`
    )));
    const result={sent:deliveries.filter((r:any)=>r.status==="fulfilled").length,failed:deliveries.filter((r:any)=>r.status==="rejected").length};
    await finishClaimedElectionNotification(env,notificationId,result);
    await env.DB.prepare("UPDATE elections SET application_reminder_sent_at=datetime('now') WHERE id=? AND application_reminder_sent_at IS NULL").bind(election.id).run();
    await auditEntity(env,null,"election_application_reminder_sent","election",election.id,null,{election_id:election.id,sent:result.sent,failed:result.failed});
  }
}

export async function electionSetupLocked(env:any,election:any){
  if(!election)return true;
  if(election.status!=="draft")return true;
  const snapshot=await env.DB.prepare("SELECT 1 ok FROM election_voters WHERE election_id=? LIMIT 1").bind(election.id).first<any>();
  return !!snapshot;
}

export async function synchronizeElectionApplications(env:any,electionId:number,adminId:number|null=null){
  const applications=await env.DB.prepare(`SELECT ea.*,m.name member_name FROM election_applications ea
    JOIN members m ON m.id=ea.member_id WHERE ea.election_id=? ORDER BY ea.id`).bind(electionId).all<any>();
  let activated=0,withdrawn=0,created=0;

  for(const app of applications.results as any[]){
    const candidate=await env.DB.prepare(`SELECT * FROM election_candidates
      WHERE election_id=? AND position_id=? AND member_id=? LIMIT 1`)
      .bind(electionId,app.position_id,app.member_id).first<any>();

    if(app.status==="approved"){
      if(candidate){
        if(candidate.status!=="active"){
          await env.DB.prepare(`UPDATE election_candidates
            SET display_name=?,status='active',withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL
            WHERE id=?`).bind(app.member_name,candidate.id).run();
          activated++;
        }else if(candidate.display_name!==app.member_name){
          await env.DB.prepare("UPDATE election_candidates SET display_name=? WHERE id=?").bind(app.member_name,candidate.id).run();
        }
      }else{
        await env.DB.prepare(`INSERT INTO election_candidates(election_id,position_id,member_id,display_name,status)
          VALUES(?,?,?,?,'active')`).bind(electionId,app.position_id,app.member_id,app.member_name).run();
        created++;
      }
    }

    if(app.status==="withdrawn" && candidate?.status==="active"){
      await env.DB.prepare(`UPDATE election_candidates
        SET status='withdrawn',withdrawn_at=COALESCE(withdrawn_at,datetime('now')),withdrawn_by=?,
            withdrawal_reason=COALESCE(withdrawal_reason,'Application withdrawn')
        WHERE id=?`).bind(adminId,candidate.id).run();
      withdrawn++;
    }
  }

  return {activated,created,withdrawn,total_changes:activated+created+withdrawn};
}

export async function evaluateElectionReadiness(env:any,election:any){
  const now=localNow(env.FUND_TIMEZONE || "Indian/Maldives");
  const checks:any[]=[];

  const positions=await env.DB.prepare("SELECT * FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(election.id).all<any>();
  const applications=await env.DB.prepare("SELECT * FROM election_applications WHERE election_id=?").bind(election.id).all<any>();
  const candidates=await env.DB.prepare("SELECT * FROM election_candidates WHERE election_id=?").bind(election.id).all<any>();
  const activeMembers=await env.DB.prepare("SELECT COUNT(*) n FROM members WHERE active=1").first<any>();

  const phase=applicationPhase(election,now);
  const applicationWindowOk=phase==="closed"||phase==="disabled";
  checks.push({
    key:"applications_closed",
    label:"Candidate application period is closed",
    ok:applicationWindowOk,
    detail:phase==="open"?"Applications are still open.":phase==="upcoming"?"Applications have not opened yet.":"Application period is closed."
  });

  const pending=(applications.results as any[]).filter((a:any)=>a.status==="pending");
  checks.push({
    key:"applications_reviewed",
    label:"No applications are waiting for review",
    ok:pending.length===0,
    detail:pending.length?`${pending.length} application${pending.length===1?" is":"s are"} still pending.`:"All submitted applications have been decided."
  });

  const positionIssues:any[]=[];
  for(const p of positions.results as any[]){
    const active=(candidates.results as any[]).filter((c:any)=>Number(c.position_id)===Number(p.id)&&c.status==="active");
    if(active.length<Number(p.seats||1))positionIssues.push(`${p.title}: ${active.length}/${Number(p.seats||1)} active candidates`);
  }
  checks.push({
    key:"positions_staffed",
    label:"Every position has enough active candidates for its seats",
    ok:(positions.results as any[]).length>0&&positionIssues.length===0,
    detail:!(positions.results as any[]).length?"No election positions have been created.":positionIssues.length?positionIssues.join(" · "):"Every position has enough active candidates."
  });

  const duplicateRows=await env.DB.prepare(`SELECT election_id,position_id,member_id,COUNT(*) n
    FROM election_candidates WHERE election_id=? AND status='active'
    GROUP BY election_id,position_id,member_id HAVING COUNT(*)>1`).bind(election.id).all<any>();
  checks.push({
    key:"no_duplicate_candidates",
    label:"No duplicate active candidate records",
    ok:duplicateRows.results.length===0,
    detail:duplicateRows.results.length?`${duplicateRows.results.length} duplicate active candidate record${duplicateRows.results.length===1?"":"s"} found.`:"No duplicate active candidate records found."
  });

  const approvedMissing=await env.DB.prepare(`SELECT ea.id,m.name,ep.title position_title FROM election_applications ea
    JOIN members m ON m.id=ea.member_id JOIN election_positions ep ON ep.id=ea.position_id
    LEFT JOIN election_candidates ec ON ec.election_id=ea.election_id AND ec.position_id=ea.position_id AND ec.member_id=ea.member_id AND ec.status='active'
    WHERE ea.election_id=? AND ea.status='approved' AND ec.id IS NULL`).bind(election.id).all<any>();
  checks.push({
    key:"approved_candidates_linked",
    label:"Every approved application has an active candidate record",
    repairable:true,
    ok:approvedMissing.results.length===0,
    detail:approvedMissing.results.length?(approvedMissing.results as any[]).map((x:any)=>`${x.name} · ${x.position_title}`).join(" · "):"All approved applications are linked to active candidates."
  });

  const withdrawnStillActive=await env.DB.prepare(`SELECT ea.id,m.name,ep.title position_title FROM election_applications ea
    JOIN members m ON m.id=ea.member_id JOIN election_positions ep ON ep.id=ea.position_id
    JOIN election_candidates ec ON ec.election_id=ea.election_id AND ec.position_id=ea.position_id AND ec.member_id=ea.member_id AND ec.status='active'
    WHERE ea.election_id=? AND ea.status='withdrawn'`).bind(election.id).all<any>();
  checks.push({
    key:"withdrawals_synced",
    label:"Withdrawn applications have no active candidate record",
    repairable:true,
    ok:withdrawnStillActive.results.length===0,
    detail:withdrawnStillActive.results.length?(withdrawnStillActive.results as any[]).map((x:any)=>`${x.name} · ${x.position_title}`).join(" · "):"Withdrawn applications and candidate records are synchronized."
  });

  const opensAt=iso(election.opens_at)||null,closesAt=iso(election.closes_at)||null;
  const voteTimesOk=!opensAt||!closesAt||closesAt>opensAt;
  checks.push({
    key:"voting_times_valid",
    label:"Voting opening and closing times are valid",
    ok:voteTimesOk,
    detail:voteTimesOk?(opensAt&&closesAt?`${opensAt.replace("T"," ")} → ${closesAt.replace("T"," ")}`:"Voting can be opened/closed manually."):"Voting closing time must be after opening time."
  });

  const memberCount=Number(activeMembers?.n||0);
  checks.push({
    key:"voters_available",
    label:"Active registered members are available for voter snapshot",
    ok:memberCount>0,
    detail:memberCount>0?`${memberCount} active member${memberCount===1?"":"s"} will be included when voting opens.`:"No active registered members are available."
  });

  return {
    ready:checks.every((x:any)=>x.ok),
    passed:checks.filter((x:any)=>x.ok).length,
    total:checks.length,
    checks,
    active_member_count:memberCount,
    application_phase:phase
  };
}

export async function processElectionLifecycle(env:any){
  await processApplicationReminders(env);
  await processElectionClosingReminders(env);
  const now=localNow(env.FUND_TIMEZONE || "Indian/Maldives");
  const drafts=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='draft' AND opens_at IS NOT NULL AND opens_at<>'' AND opens_at<=?`).bind(now).all<any>();
  for(const election of drafts.results as any[]){
    await synchronizeElectionApplications(env,election.id,null);
    const readiness=await evaluateElectionReadiness(env,election);
    if(!readiness.ready)continue;
    const result=await env.DB.prepare("UPDATE elections SET status='open',opened_at=datetime('now') WHERE id=? AND status='draft'").bind(election.id).run();
    if(result.meta.changes){
      await auditEntity(env,null,"election_auto_opened","election",election.id,election,{...election,status:"open"});
      await env.DB.prepare("INSERT OR IGNORE INTO election_voters(election_id,member_id) SELECT ?,id FROM members WHERE active=1").bind(election.id).run();
      const brand=await getBranding(env);
      const delivery=await notifyEligible(env,election,`🗳 <b>${brand.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`).catch(()=>({sent:0,failed:0}));
      await recordElectionNotification(env,election.id,"voting_opened","eligible_voters",delivery,{automatic:true});
    }
  }
  const open=await env.DB.prepare(`SELECT * FROM elections
    WHERE status='open' AND closes_at IS NOT NULL AND closes_at<>'' AND closes_at<=?`).bind(now).all<any>();
  for(const election of open.results as any[]){
    const result=await env.DB.prepare("UPDATE elections SET status='closed',closed_at=datetime('now') WHERE id=? AND status='open'").bind(election.id).run();
    if(result.meta.changes) await auditEntity(env,null,"election_auto_closed","election",election.id,election,{...election,status:"closed"});
  }
  const runoffs=await env.DB.prepare(`SELECT * FROM election_runoffs
    WHERE status='open' AND closes_at IS NOT NULL AND closes_at<>'' AND closes_at<=?`).bind(now).all<any>();
  for(const runoff of runoffs.results as any[]){
    const r=await env.DB.prepare("UPDATE election_runoffs SET status='closed',closed_at=datetime('now') WHERE id=? AND status='open'").bind(runoff.id).run();
    if(r.meta.changes)await auditEntity(env,null,"election_runoff_auto_closed","election_runoff",runoff.id,runoff,{...runoff,status:"closed",election_id:runoff.election_id});
  }
}


async function latestClosedRunoff(env:any,electionId:number,positionId:number){
  return env.DB.prepare(`SELECT * FROM election_runoffs
    WHERE election_id=? AND position_id=? AND status='closed'
    ORDER BY round_no DESC,id DESC LIMIT 1`).bind(electionId,positionId).first<any>();
}

export async function calculateElectionResults(env:any,electionId:number){
  const positions=await env.DB.prepare("SELECT * FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(electionId).all<any>();
  const candidates=await env.DB.prepare("SELECT * FROM election_candidates WHERE election_id=? ORDER BY position_id,id").bind(electionId).all<any>();
  const base=await env.DB.prepare(`SELECT position_id,candidate_id,COUNT(*) votes FROM election_ballots
    WHERE election_id=? GROUP BY position_id,candidate_id`).bind(electionId).all<any>();
  const baseMap=new Map(base.results.map((r:any)=>[Number(r.candidate_id),Number(r.votes||0)]));
  const results:any[]=[]; const unresolved:any[]=[];

  for(const position of positions.results as any[]){
    const active=(candidates.results as any[]).filter((c:any)=>Number(c.position_id)===Number(position.id)&&c.status==="active")
      .map((c:any)=>({...c,votes:baseMap.get(Number(c.id))||0}))
      .sort((a:any,b:any)=>b.votes-a.votes||String(a.display_name).localeCompare(String(b.display_name)));
    const seats=Number(position.seats||1);
    if(!active.length)continue;
    const cutoff=active.length>=seats?Number(active[seats-1]?.votes||0):null;
    const above=cutoff===null?active.length:active.filter((c:any)=>c.votes>cutoff).length;
    const tied=cutoff===null?[]:active.filter((c:any)=>c.votes===cutoff);
    const seatsAtBoundary=Math.max(0,seats-above);
    const tieAtCutoff=cutoff!==null&&tied.length>seatsAtBoundary;

    let runoff:any=null; let runoffResolvedIds:number[]=[];
    if(tieAtCutoff){
      runoff=await latestClosedRunoff(env,electionId,Number(position.id));
      if(runoff){
        const rv=await env.DB.prepare(`SELECT candidate_id,COUNT(*) votes FROM election_runoff_ballots WHERE runoff_id=?
          GROUP BY candidate_id`).bind(runoff.id).all<any>();
        const rmap=new Map(rv.results.map((r:any)=>[Number(r.candidate_id),Number(r.votes||0)]));
        const rc=await env.DB.prepare(`SELECT ec.* FROM election_runoff_candidates rc
          JOIN election_candidates ec ON ec.id=rc.candidate_id WHERE rc.runoff_id=?`).bind(runoff.id).all<any>();
        const ranked=(rc.results as any[]).map((c:any)=>({...c,runoff_votes:rmap.get(Number(c.id))||0}))
          .sort((a:any,b:any)=>b.runoff_votes-a.runoff_votes||String(a.display_name).localeCompare(String(b.display_name)));
        const need=Number(runoff.seats_to_fill||seatsAtBoundary||1);
        const runoffCut=ranked.length>=need?Number(ranked[need-1]?.runoff_votes||0):null;
        const boundary=runoffCut===null?[]:ranked.filter((c:any)=>c.runoff_votes===runoffCut);
        const aboveRunoff=runoffCut===null?ranked:ranked.filter((c:any)=>c.runoff_votes>runoffCut);
        if(runoffCut!==null && boundary.length>(need-aboveRunoff.length)){
          unresolved.push({position_id:position.id,position_title:position.title,candidate_ids:boundary.map((c:any)=>c.id),seats_to_fill:need-aboveRunoff.length,reason:"runoff_tie",round_no:Number(runoff.round_no||1)+1});
        }else{
          runoffResolvedIds=ranked.slice(0,need).map((c:any)=>Number(c.id));
        }
      }else{
        unresolved.push({position_id:position.id,position_title:position.title,candidate_ids:tied.map((c:any)=>c.id),seats_to_fill:seatsAtBoundary,reason:"base_tie",round_no:1});
      }
    }

    for(const candidate of (candidates.results as any[]).filter((c:any)=>Number(c.position_id)===Number(position.id))){
      if(candidate.status==="withdrawn"){
        results.push({position_id:position.id,candidate_id:candidate.id,votes:baseMap.get(Number(candidate.id))||0,outcome:"withdrawn"});continue;
      }
      const votes=baseMap.get(Number(candidate.id))||0;
      let outcome="not_elected";
      if(!tieAtCutoff){
        const rank=active.findIndex((c:any)=>Number(c.id)===Number(candidate.id));
        if(rank>=0&&rank<seats)outcome="elected";
      }else{
        if(cutoff!==null&&votes>cutoff)outcome="elected";
        else if(runoffResolvedIds.includes(Number(candidate.id)))outcome="elected";
        else if(tied.some((c:any)=>Number(c.id)===Number(candidate.id)) && !runoffResolvedIds.length)outcome="tie";
      }
      results.push({position_id:position.id,candidate_id:candidate.id,votes,outcome});
    }
  }
  return {results,unresolved};
}

const HANDOVER_CHECKLIST=[
  {key:"finance_records",label:"Finance records reviewed",sort:10},
  {key:"cash_bank_balance",label:"Cash and bank balances acknowledged",sort:20},
  {key:"pending_contributions",label:"Pending contributions reviewed",sort:30},
  {key:"expenses_donations",label:"Outstanding expenses and donations checked",sort:40},
  {key:"documents_handed_over",label:"Governance and finance documents handed over",sort:50},
  {key:"admin_access_reviewed",label:"System Admin access reviewed separately from EXCO roles",sort:60},
];

export async function ensureExcoTerms(env:any){
  // Backfill certified elections for older deployments without changing Admin permissions.
  const elections=await env.DB.prepare(`SELECT id,term,certified_at FROM elections
    WHERE certified_at IS NOT NULL ORDER BY certified_at,id`).all<any>();
  let previousTermId:number|null=null;
  for(const e of elections.results as any[]){
    let term=await env.DB.prepare("SELECT * FROM exco_terms WHERE election_id=?").bind(e.id).first<any>();
    if(!term){
      const r=await env.DB.prepare(`INSERT INTO exco_terms(election_id,term_label,status,started_at,ended_at)
        VALUES(?,?, 'completed',date(?),date(?))`).bind(e.id,e.term||null,e.certified_at,e.certified_at).run();
      term={id:Number(r.meta.last_row_id),election_id:e.id,term_label:e.term||null,status:"completed",started_at:String(e.certified_at).slice(0,10),ended_at:String(e.certified_at).slice(0,10)};
    }
    previousTermId=Number(term.id);
  }
  const currentElection=await env.DB.prepare(`SELECT id FROM elections WHERE certified_at IS NOT NULL ORDER BY certified_at DESC,id DESC LIMIT 1`).first<any>();
  if(currentElection){
    const current=await env.DB.prepare("SELECT * FROM exco_terms WHERE election_id=?").bind(currentElection.id).first<any>();
    if(current){
      await env.DB.prepare("UPDATE exco_terms SET status='completed',ended_at=COALESCE(ended_at,date('now')) WHERE status='current' AND id<>?").bind(current.id).run();
      await env.DB.prepare("UPDATE exco_terms SET status='current',ended_at=NULL WHERE id=?").bind(current.id).run();
    }
  }
}

export async function createExcoTermHandover(env:any,election:any,certifiedAt:string){
  await ensureExcoTerms(env);
  const existing=await env.DB.prepare("SELECT * FROM exco_terms WHERE election_id=?").bind(election.id).first<any>();
  if(existing){
    await env.DB.prepare("UPDATE exco_terms SET status='current',term_label=?,started_at=date(?),ended_at=NULL WHERE id=?")
      .bind(election.term||null,certifiedAt,existing.id).run();
    let handover=await env.DB.prepare("SELECT id FROM exco_handover_records WHERE incoming_term_id=?").bind(existing.id).first<any>();
    if(!handover){
      const outgoing=await env.DB.prepare("SELECT * FROM exco_terms WHERE id<>? ORDER BY started_at DESC,id DESC LIMIT 1").bind(existing.id).first<any>();
      const h=await env.DB.prepare(`INSERT INTO exco_handover_records(incoming_term_id,outgoing_term_id,status)
        VALUES(?,?, 'pending')`).bind(existing.id,outgoing?.id||null).run();
      const handoverId=Number(h.meta.last_row_id);
      await env.DB.batch(HANDOVER_CHECKLIST.map(item=>env.DB.prepare(
        "INSERT INTO exco_handover_items(handover_id,item_key,label,sort_order) VALUES(?,?,?,?)"
      ).bind(handoverId,item.key,item.label,item.sort)));
      handover={id:handoverId};
    }
    return {...existing,handover_id:handover.id};
  }

  const outgoing=await env.DB.prepare("SELECT * FROM exco_terms WHERE status='current' ORDER BY started_at DESC,id DESC LIMIT 1").first<any>();
  if(outgoing){
    await env.DB.prepare("UPDATE exco_terms SET status='completed',ended_at=date(?) WHERE id=?").bind(certifiedAt,outgoing.id).run();
  }
  const termResult=await env.DB.prepare(`INSERT INTO exco_terms(election_id,term_label,status,started_at)
    VALUES(?,?, 'current',date(?))`).bind(election.id,election.term||null,certifiedAt).run();
  const incomingTermId=Number(termResult.meta.last_row_id);
  const handoverResult=await env.DB.prepare(`INSERT INTO exco_handover_records(incoming_term_id,outgoing_term_id,status)
    VALUES(?,?, 'pending')`).bind(incomingTermId,outgoing?.id||null).run();
  const handoverId=Number(handoverResult.meta.last_row_id);
  await env.DB.batch(HANDOVER_CHECKLIST.map(item=>env.DB.prepare(
    "INSERT INTO exco_handover_items(handover_id,item_key,label,sort_order) VALUES(?,?,?,?)"
  ).bind(handoverId,item.key,item.label,item.sort)));
  return {id:incomingTermId,handover_id:handoverId};
}

export async function assignCertifiedExcoRoles(env:any,election:any,results:any[],certifiedAt:string){
  const elected=results.filter((r:any)=>r.outcome==="elected");
  const candidateRows=await env.DB.prepare(`SELECT ec.id candidate_id,ec.member_id,ep.id position_id,ep.title role_title
    FROM election_candidates ec JOIN election_positions ep ON ep.id=ec.position_id WHERE ec.election_id=?`).bind(election.id).all<any>();
  const electedRows=(candidateRows.results as any[]).filter((row:any)=>elected.some((r:any)=>Number(r.candidate_id)===Number(row.candidate_id)));
  // Archive every currently active EXCO assignment before installing the certified committee.
  await env.DB.prepare("UPDATE exco_role_assignments SET ended_at=date(?) WHERE ended_at IS NULL").bind(certifiedAt).run();
  for(const row of electedRows){
    await env.DB.prepare(`INSERT OR IGNORE INTO exco_role_assignments(member_id,election_id,position_id,role_title,term,started_at)
      VALUES(?,?,?,?,?,date(?))`).bind(row.member_id,election.id,row.position_id,row.role_title,election.term||null,certifiedAt).run();
  }
  return electedRows;
}

export async function buildElectionSummary(env:any,electionId:number){
  const election=await env.DB.prepare(`SELECT e.*,a.name certified_by_name
    FROM elections e LEFT JOIN admins a ON a.id=e.certified_by WHERE e.id=?`).bind(electionId).first<any>();
  if(!election)return null;

  const [positions,applications,candidates,voters,runoffs,roles]=await Promise.all([
    env.DB.prepare("SELECT * FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(electionId).all<any>(),
    env.DB.prepare(`SELECT status,COUNT(*) n FROM election_applications WHERE election_id=? GROUP BY status`).bind(electionId).all<any>(),
    env.DB.prepare(`SELECT ec.*,ep.title position_title FROM election_candidates ec
      JOIN election_positions ep ON ep.id=ec.position_id WHERE ec.election_id=? ORDER BY ep.sort_order,ec.display_name`).bind(electionId).all<any>(),
    env.DB.prepare(`SELECT COUNT(*) eligible,SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted FROM election_voters WHERE election_id=?`).bind(electionId).first<any>(),
    env.DB.prepare(`SELECT r.*,ep.title position_title FROM election_runoffs r
      JOIN election_positions ep ON ep.id=r.position_id WHERE r.election_id=? ORDER BY r.position_id,r.round_no`).bind(electionId).all<any>(),
    env.DB.prepare(`SELECT x.role_title,x.term,x.started_at,m.id member_id,m.name,m.member_code
      FROM exco_role_assignments x JOIN members m ON m.id=x.member_id
      WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(electionId).all<any>()
  ]);

  const calculated=election.status==="closed"?await calculateElectionResults(env,electionId):{results:[],unresolved:[]};
  const appCounts:any={pending:0,approved:0,rejected:0,withdrawn:0,total:0};
  for(const row of applications.results as any[]){
    appCounts[String(row.status)]=Number(row.n||0);
    appCounts.total+=Number(row.n||0);
  }
  const eligible=Number(voters?.eligible||0),voted=Number(voters?.voted||0);

  const positionSummaries:any[]=[];
  for(const position of positions.results as any[]){
    const rows=(candidates.results as any[]).filter((c:any)=>Number(c.position_id)===Number(position.id));
    positionSummaries.push({
      id:position.id,
      title:position.title,
      seats:Number(position.seats||1),
      candidates:rows.map((c:any)=>{
        const result=calculated.results.find((r:any)=>Number(r.candidate_id)===Number(c.id));
        return {id:c.id,member_id:c.member_id,name:c.display_name,status:c.status,votes:Number(result?.votes||0),outcome:result?.outcome||null};
      })
    });
  }

  const runoffSummaries:any[]=[];
  for(const runoff of runoffs.results as any[]){
    const [rc,turnout]=await Promise.all([
      env.DB.prepare(`SELECT ec.id,ec.display_name,
        (SELECT COUNT(*) FROM election_runoff_ballots rb WHERE rb.runoff_id=? AND rb.candidate_id=ec.id) votes
        FROM election_runoff_candidates x JOIN election_candidates ec ON ec.id=x.candidate_id
        WHERE x.runoff_id=? ORDER BY ec.display_name`).bind(runoff.id,runoff.id).all<any>(),
      env.DB.prepare(`SELECT COUNT(*) eligible,SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted
        FROM election_runoff_voters WHERE runoff_id=?`).bind(runoff.id).first<any>()
    ]);
    runoffSummaries.push({
      id:runoff.id,position_id:runoff.position_id,position_title:runoff.position_title,
      round_no:Number(runoff.round_no||1),seats_to_fill:Number(runoff.seats_to_fill||1),
      status:runoff.status,opens_at:runoff.opens_at||runoff.opened_at,closes_at:runoff.closes_at||runoff.closed_at,
      turnout:{eligible:Number(turnout?.eligible||0),voted:Number(turnout?.voted||0)},
      candidates:(rc.results as any[]).map((c:any)=>({id:c.id,name:c.display_name,votes:Number(c.votes||0)}))
    });
  }

  return {
    election:{
      id:election.id,title:election.title,term:election.term,status:election.status,
      applications_open_at:election.applications_open_at,applications_close_at:election.applications_close_at,
      voting_open_at:election.opened_at||election.opens_at,voting_close_at:election.closed_at||election.closes_at,
      certified_at:election.certified_at,certified_by_name:election.certified_by_name||null
    },
    applications:appCounts,
    candidates:{
      total:(candidates.results as any[]).length,
      active:(candidates.results as any[]).filter((c:any)=>c.status==="active").length,
      withdrawn:(candidates.results as any[]).filter((c:any)=>c.status==="withdrawn").length
    },
    turnout:{eligible,voted,percent:eligible?Math.round((voted/eligible)*1000)/10:0},
    positions:positionSummaries,
    runoffs:runoffSummaries,
    unresolved_ties:calculated.unresolved,
    assigned_exco_roles:roles.results
  };
}

export async function memberForUser(c:any){
  const user=c.get("telegramUser");
  return c.env.DB.prepare("SELECT id,member_code,name,telegram_id,joined_at,monthly_amount,active FROM members WHERE telegram_id=? AND active=1 LIMIT 1")
    .bind(String(user?.id||"")).first<any>();
}
export async function electionDeleteEligibility(env:any,election:any){
  if(!election)return {allowed:false,reasons:["Election not found"]};
  const [applications,voters,ballots,runoffs,assignments,terms,notifications]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n FROM election_applications WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM election_voters WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM election_ballots WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM election_runoffs WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM exco_role_assignments WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM exco_terms WHERE election_id=?").bind(election.id).first<any>(),
    env.DB.prepare("SELECT COUNT(*) n FROM election_notification_log WHERE election_id=?").bind(election.id).first<any>()
  ]);
  const counts={
    applications:Number(applications?.n||0),
    voters:Number(voters?.n||0),
    ballots:Number(ballots?.n||0),
    runoffs:Number(runoffs?.n||0),
    exco_assignments:Number(assignments?.n||0),
    exco_terms:Number(terms?.n||0),
    notifications:Number(notifications?.n||0)
  };
  const reasons:string[]=[];
  if(election.status!=="draft")reasons.push("Only draft elections can be permanently deleted");
  if(election.certified_at)reasons.push("Certified elections cannot be deleted");
  if(counts.applications)reasons.push("Member applications exist");
  if(counts.voters)reasons.push("A voter snapshot exists");
  if(counts.ballots)reasons.push("Ballots exist");
  if(counts.runoffs)reasons.push("Runoff records exist");
  if(counts.exco_assignments)reasons.push("EXCO assignments exist");
  if(counts.exco_terms)reasons.push("An EXCO term is linked");
  if(counts.notifications)reasons.push("Member/Admin election notifications were recorded");
  return {allowed:reasons.length===0,reasons,counts};
}

export async function electionDetail(env:any,id:number){
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
  const setupLocked=election.status!=="draft"||eligible>0;
  const deletion=await electionDeleteEligibility(env,election);
  return {...election,setup_locked:setupLocked,deletion,positions:positions.results.map((p:any)=>({...p,candidates:candidates.results.filter((x:any)=>Number(x.position_id)===Number(p.id))})),
    turnout:{eligible,voted,percent:eligible>0?Math.round((voted/eligible)*1000)/10:0},
    audit_history:audit.results,certified_by_name:certifier?.name||null,applications:applications.results,
    application_phase:applicationPhase(election,localNow(env.FUND_TIMEZONE || "Indian/Maldives"))};
}

