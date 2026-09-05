import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireSuperAdmin } from "../auth";
import { auditEntity, ensureOperationalSchema } from "../ops";
import { sendMessage } from "../telegram";
import { getBranding } from "../db";
import { esc, miniAppUrl, notifyAdmins } from "../botSupport";

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

async function processApplicationReminders(env:any){
  const now=localNow(env.FUND_TIMEZONE || "Indian/Maldives");
  const currentMs=Date.parse(`${now}Z`);
  const rows=await env.DB.prepare(`SELECT * FROM elections WHERE status='draft'
    AND applications_open_at IS NOT NULL AND applications_close_at IS NOT NULL
    AND application_reminder_sent_at IS NULL AND applications_open_at<=? AND applications_close_at>?`).bind(now,now).all<any>();
  for(const election of rows.results as any[]){
    const closeMs=Date.parse(`${election.applications_close_at}Z`);
    if(!Number.isFinite(currentMs)||!Number.isFinite(closeMs)||closeMs-currentMs>24*60*60*1000)continue;
    const members=await env.DB.prepare(`SELECT m.* FROM members m WHERE m.active=1 AND m.telegram_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM election_applications ea WHERE ea.election_id=? AND ea.member_id=m.id AND ea.status IN ('pending','approved'))`).bind(election.id).all<any>();
    const brand=await getBranding(env); let sent=0;
    for(const member of members.results as any[]){
      await sendMessage(env,member.telegram_id,`⏳ <b>${brand.fund_name} · ${election.title}</b>\n\nCandidate applications close within 24 hours. All registered active members can apply for an available EXCO position in the Mini App.`).catch(()=>null);
      sent++;
    }
    await env.DB.prepare("UPDATE elections SET application_reminder_sent_at=datetime('now') WHERE id=? AND application_reminder_sent_at IS NULL").bind(election.id).run();
    await auditEntity(env,null,"election_application_reminder_sent","election",election.id,null,{election_id:election.id,sent});
  }
}

async function electionSetupLocked(env:any,election:any){
  if(!election)return true;
  if(election.status!=="draft")return true;
  const snapshot=await env.DB.prepare("SELECT 1 ok FROM election_voters WHERE election_id=? LIMIT 1").bind(election.id).first<any>();
  return !!snapshot;
}

async function synchronizeElectionApplications(env:any,electionId:number,adminId:number|null=null){
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

async function evaluateElectionReadiness(env:any,election:any){
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
      await notifyEligible(env,election,`🗳 <b>${brand.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`).catch(()=>{});
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

async function calculateElectionResults(env:any,electionId:number){
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

async function assignCertifiedExcoRoles(env:any,election:any,results:any[],certifiedAt:string){
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

async function buildElectionSummary(env:any,electionId:number){
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

async function memberForUser(c:any){
  const user=c.get("telegramUser");
  return c.env.DB.prepare("SELECT id,member_code,name,telegram_id,joined_at,monthly_amount,active FROM members WHERE telegram_id=? AND active=1 LIMIT 1")
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
  const setupLocked=election.status!=="draft"||eligible>0;
  return {...election,setup_locked:setupLocked,positions:positions.results.map((p:any)=>({...p,candidates:candidates.results.filter((x:any)=>Number(x.position_id)===Number(p.id))})),
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
    ORDER BY CASE
      WHEN e.status='draft' AND e.applications_open_at IS NOT NULL AND e.applications_close_at IS NOT NULL THEN 0
      WHEN e.status='open' THEN 1
      WHEN e.status='closed' THEN 2
      WHEN e.status='draft' THEN 3
      ELSE 4 END,e.id DESC`)
    .bind(admin?.id||null).all<any>();
  const result=[];
  for(const e of rows.results as any[]){
    let my_vote=false,eligible=false;
    if(member){
      const v=await c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(e.id,member.id).first<any>();
      eligible=!!v; my_vote=!!v?.voted_at;
    }
    const eligibleCount=Number(e.eligible||0),votedCount=Number(e.voted||0);
    result.push({...e,eligible,my_vote,turnout:{eligible:eligibleCount,voted:votedCount,percent:eligibleCount>0?Math.round((votedCount/eligibleCount)*1000)/10:0}});
  }
  return c.json(result);
});

electionsRoute.get("/exco/current", async c=>{
  const rows=await c.env.DB.prepare(`SELECT x.*,m.name,m.member_code,e.title election_title
    FROM exco_role_assignments x JOIN members m ON m.id=x.member_id JOIN elections e ON e.id=x.election_id
    WHERE x.ended_at IS NULL ORDER BY x.position_id,x.id`).all<any>();
  return c.json({roles:rows.results});
});

electionsRoute.get("/archive", async c=>{
  await ensureOperationalSchema(c.env);
  const rows=await c.env.DB.prepare(`SELECT e.id,e.title,e.term,e.certified_at,e.closed_at,e.opens_at,e.closes_at,
    (SELECT COUNT(*) FROM election_positions p WHERE p.election_id=e.id) positions,
    (SELECT COUNT(*) FROM election_candidates ec WHERE ec.election_id=e.id AND ec.status='active') candidates,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id) eligible,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id AND v.voted_at IS NOT NULL) voted,
    (SELECT COUNT(*) FROM election_runoffs r WHERE r.election_id=e.id) runoffs,
    (SELECT COUNT(*) FROM exco_role_assignments x WHERE x.election_id=e.id) assigned_roles
    FROM elections e WHERE e.certified_at IS NOT NULL
    ORDER BY e.certified_at DESC,e.id DESC`).all<any>();
  const archive=(rows.results as any[]).map((e:any)=>{
    const eligible=Number(e.eligible||0),voted=Number(e.voted||0);
    return {...e,positions:Number(e.positions||0),candidates:Number(e.candidates||0),
      runoffs:Number(e.runoffs||0),assigned_roles:Number(e.assigned_roles||0),
      turnout:{eligible,voted,percent:eligible?Math.round((voted/eligible)*1000)/10:0},
      year:String(e.certified_at||e.closed_at||"").slice(0,4)||null};
  });
  return c.json({archive});
});

electionsRoute.get("/:id/summary", async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const summary=await buildElectionSummary(c.env,id);
  if(!summary)return c.json({error:"Election not found"},404);
  const admin=c.get("admin");
  if(!admin && !summary.election.certified_at)return c.json({error:"Official election summary is available after certification"},403);
  return c.json(summary);
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
  if(!admin && detail.status==="draft" && !(detail.applications_open_at && detail.applications_close_at))
    return c.json({error:"Election not available"},404);
  let results:any[]=[]; let unresolved_ties:any[]=[];
  if(detail.status==="closed" && (admin || detail.certified_at)){
    const calculated=await calculateElectionResults(c.env,id);
    results=calculated.results; unresolved_ties=calculated.unresolved;
  }
  const visibleApplications=admin?detail.applications:(member?detail.applications.filter((a:any)=>Number(a.member_id)===Number(member.id)).map((a:any)=>({
    id:a.id,election_id:a.election_id,position_id:a.position_id,status:a.status,statement:a.statement,submitted_at:a.submitted_at,review_reason:a.review_reason,withdrawn_at:a.withdrawn_at
  })):[]);
  const runoffs=await c.env.DB.prepare(`SELECT r.*,ep.title position_title FROM election_runoffs r
    JOIN election_positions ep ON ep.id=r.position_id WHERE r.election_id=? ORDER BY r.position_id,r.round_no`).bind(id).all<any>();
  const enrichedRunoffs:any[]=[]; let my_runoff_votes:any={};
  for(const runoff of runoffs.results as any[]){
    const [rc,turnout]=await Promise.all([
      c.env.DB.prepare(`SELECT ec.id,ec.display_name,ec.member_id,
        (SELECT COUNT(*) FROM election_runoff_ballots rb WHERE rb.runoff_id=? AND rb.candidate_id=ec.id) votes
        FROM election_runoff_candidates x JOIN election_candidates ec ON ec.id=x.candidate_id WHERE x.runoff_id=? ORDER BY ec.display_name`).bind(runoff.id,runoff.id).all<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) eligible,SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted FROM election_runoff_voters WHERE runoff_id=?`).bind(runoff.id).first<any>()
    ]);
    enrichedRunoffs.push({...runoff,candidates:rc.results,turnout:{eligible:Number(turnout?.eligible||0),voted:Number(turnout?.voted||0)}});
    if(member){
      const v=await c.env.DB.prepare("SELECT voted_at FROM election_runoff_voters WHERE runoff_id=? AND member_id=?").bind(runoff.id,member.id).first<any>();
      if(v)my_runoff_votes[String(runoff.id)]={eligible:true,voted:!!v.voted_at};
    }
  }
  return c.json({...detail,applications:visibleApplications,eligible,my_vote,results,unresolved_ties,runoffs:enrichedRunoffs,my_runoff_votes,results_visible:!!admin||!!detail.certified_at});
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
  if(!before)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,before))return c.json({error:"Election setup is locked after the voter snapshot is created"},409);
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

electionsRoute.post("/:id/extend-applications", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,before) || before.certified_at)return c.json({error:"Application deadline is locked after the voter snapshot is created"},409);
  const body=await c.req.json<any>().catch(()=>({}));
  const newClose=iso(body.applications_close_at);
  if(!newClose)return c.json({error:"New application deadline is required"},400);
  const now=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if(newClose<=now)return c.json({error:"New application deadline must be in the future"},400);
  if(before.applications_open_at && newClose<=String(before.applications_open_at))
    return c.json({error:"Application deadline must be after the application opening time"},400);
  if(before.applications_close_at && newClose<=String(before.applications_close_at))
    return c.json({error:"New deadline must extend the current application deadline"},400);
  if(before.opens_at && newClose>String(before.opens_at))
    return c.json({error:"Application deadline must remain on or before voting opens"},400);

  await c.env.DB.prepare(`UPDATE elections
    SET applications_close_at=?,application_reminder_sent_at=NULL
    WHERE id=? AND status='draft'`).bind(newClose,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"election_application_deadline_extended","election",id,before,after);

  const branding=await getBranding(c.env);
  const applicants=await c.env.DB.prepare(`SELECT DISTINCT m.telegram_id FROM election_applications ea
    JOIN members m ON m.id=ea.member_id
    WHERE ea.election_id=? AND m.telegram_id IS NOT NULL AND ea.status IN ('pending','approved')`).bind(id).all<any>();
  c.executionCtx.waitUntil(Promise.allSettled((applicants.results as any[]).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `⏰ <b>${branding.fund_name} · ${after.title}</b>\n\nThe candidate application deadline has been extended to <b>${newClose.replace("T"," ")}</b>.`
  ))));
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/positions", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"Election setup is locked after the voter snapshot is created"},409);
  const body=await c.req.json<any>(); const title=text(body.title); if(!title)return c.json({error:"Position title is required"},400);
  const seats=Math.max(1,Math.min(20,Number(body.seats)||1)); const maxSelections=Math.max(1,Math.min(seats,Number(body.max_selections)||seats));
  const minSelections=Math.max(0,Math.min(maxSelections,Number(body.min_selections ?? 1)));
  const r=await c.env.DB.prepare("INSERT INTO election_positions(election_id,title,seats,max_selections,min_selections,sort_order) VALUES(?,?,?,?,?,?)")
    .bind(id,title,seats,maxSelections,minSelections,Number(body.sort_order)||0).run();
  await auditEntity(c.env,admin.id,"election_position_added","election_position",Number(r.meta.last_row_id),null,{election_id:id,title,seats,max_selections:maxSelections,min_selections:minSelections});
  return c.json(await electionDetail(c.env,id),201);
});

electionsRoute.post("/:id/candidates", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"Election setup is locked after the voter snapshot is created"},409);
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

electionsRoute.post("/:id/repair-application-sync", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election)||election.certified_at)return c.json({error:"Election data is locked after the voter snapshot is created"},409);

  const before=await evaluateElectionReadiness(c.env,election);
  const repaired=await synchronizeElectionApplications(c.env,id,admin.id);
  const afterElection=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  const after=await evaluateElectionReadiness(c.env,afterElection);

  await auditEntity(c.env,admin.id,"election_application_sync_repaired","election",id,
    {readiness:{passed:before.passed,total:before.total}},
    {readiness:{passed:after.passed,total:after.total},repaired});

  return c.json({ok:true,repaired,readiness:after,detail:await electionDetail(c.env,id)});
});

electionsRoute.get("/:id/readiness", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(election.status!=="draft")return c.json({error:"Readiness check is only available before voting opens"},409);
  return c.json(await evaluateElectionReadiness(c.env,election));
});

electionsRoute.post("/:id/open", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="draft")return c.json({error:"Election is not draft"},409);
  await synchronizeElectionApplications(c.env,id,admin.id);
  const readiness=await evaluateElectionReadiness(c.env,election);
  if(!readiness.ready)return c.json({error:"Election is not ready to open voting",readiness},409);
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
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"An election cannot be cancelled after the voter snapshot is created"},409);
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
  const position=await c.env.DB.prepare("SELECT * FROM election_positions WHERE id=? AND election_id=?").bind(positionId,id).first<any>();
  if(!position)return c.json({error:"Choose a valid available position"},400);
  try{
    const statement=text(body.statement,600)||null;
    const r=await c.env.DB.prepare(`INSERT INTO election_applications(election_id,position_id,member_id,statement)
      VALUES(?,?,?,?)`).bind(id,positionId,member.id,statement).run();
    const applicationId=Number(r.meta.last_row_id);

    if(member.telegram_id){
      c.executionCtx.waitUntil(sendMessage(c.env,member.telegram_id,
        `📝 <b>${esc(election.title)}</b>\n\nYour application for <b>${esc(position.title)}</b> was submitted and is awaiting review.`
      ).catch(()=>null));
    }

    const appUrl=await miniAppUrl(c.env);
    const adminText=[
      `🗳 <b>New EXCO application</b>`,
      ``,
      `Member: <b>${esc(member.name)}</b> · <code>${esc(member.member_code||"—")}</code>`,
      `Position: <b>${esc(position.title)}</b>`,
      `Election: <b>${esc(election.title)}</b>`,
      `Status: <b>Pending Review</b>`,
      statement?`Statement: ${esc(statement)}`:"",
      ``,
      `Open the Fund App to review this application.`
    ].filter(Boolean).join("\n");

    c.executionCtx.waitUntil(
      notifyAdmins(c.env,adminText,{
        reply_markup:{inline_keyboard:[[{text:"Review Application",web_app:{url:appUrl}}]]}
      }).catch(()=>null)
    );
    await auditEntity(c.env,null,"election_application_admin_notified","election_application",applicationId,null,{
      election_id:id,position_id:positionId,member_id:member.id,status:"pending"
    });

    return c.json({ok:true,id:applicationId,status:"pending"},201);
  }catch{return c.json({error:"You have already applied for this position"},409)}
});

electionsRoute.post("/:id/applications/:applicationId/withdraw", async c=>{
  const id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId")); const member=await memberForUser(c);
  if(!member)return c.json({error:"Approved member account required"},403);
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"Applications are locked after voting opens"},409);
  if(applicationPhase(election,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"))!=="open")return c.json({error:"Application withdrawal period has ended"},409);
  const r=await c.env.DB.prepare(`UPDATE election_applications SET status='withdrawn',withdrawn_at=datetime('now')
    WHERE id=? AND election_id=? AND member_id=? AND status='pending'`).bind(applicationId,id,member.id).run();
  if(!r.meta.changes)return c.json({error:"Application cannot be withdrawn"},409);
  if(member.telegram_id) c.executionCtx.waitUntil(sendMessage(c.env,member.telegram_id,`↩️ <b>${election.title}</b>\n\nYour candidate application was withdrawn.`).catch(()=>null));
  return c.json({ok:true});
});

electionsRoute.post("/:id/applications/:applicationId/review", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId"));
  const electionState=await c.env.DB.prepare("SELECT status,certified_at FROM elections WHERE id=?").bind(id).first<any>();
  if(!electionState)return c.json({error:"Election not found"},404);
  const electionSnapshotState={id,status:electionState.status,certified_at:electionState.certified_at};
  if(await electionSetupLocked(c.env,electionSnapshotState)||electionState.certified_at)
    return c.json({error:"Application decisions are locked after the voter snapshot is created"},409);
  const body=await c.req.json<any>().catch(()=>({})); const decision=String(body.decision||"");
  if(!["approved","rejected"].includes(decision))return c.json({error:"Decision must be approved or rejected"},400);
  const application=await c.env.DB.prepare(`SELECT ea.*,m.name member_name FROM election_applications ea
    JOIN members m ON m.id=ea.member_id WHERE ea.id=? AND ea.election_id=?`).bind(applicationId,id).first<any>();
  if(!application)return c.json({error:"Application not found"},404); if(application.status!=="pending")return c.json({error:"Application is already decided"},409);
  const reason=text(body.reason,300)||null;
  if(decision==="approved"){
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE election_applications SET status='approved',reviewed_at=datetime('now'),reviewed_by=?,review_reason=?,withdrawn_at=NULL WHERE id=? AND status='pending'`).bind(admin.id,reason,applicationId),
      c.env.DB.prepare(`INSERT INTO election_candidates(election_id,position_id,member_id,display_name,status,withdrawn_at,withdrawn_by,withdrawal_reason)
        VALUES(?,?,?,?,'active',NULL,NULL,NULL)
        ON CONFLICT(election_id,position_id,member_id) DO UPDATE SET
          display_name=excluded.display_name,status='active',withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL`)
        .bind(id,application.position_id,application.member_id,application.member_name)
    ]);
  }else{
    await c.env.DB.prepare(`UPDATE election_applications SET status='rejected',reviewed_at=datetime('now'),reviewed_by=?,review_reason=? WHERE id=? AND status='pending'`)
      .bind(admin.id,reason,applicationId).run();
  }
  await auditEntity(c.env,admin.id,`election_application_${decision}`,"election_application",applicationId,{...application,election_id:id},{...application,election_id:id,status:decision,review_reason:reason});
  const applicant=await c.env.DB.prepare("SELECT telegram_id FROM members WHERE id=?").bind(application.member_id).first<any>();
  const election=await c.env.DB.prepare("SELECT title FROM elections WHERE id=?").bind(id).first<any>();
  if(applicant?.telegram_id){
    const note=decision==="approved"?`✅ <b>${election?.title||"Election"}</b>\n\nYour candidate application has been <b>approved</b>.`:
      `❌ <b>${election?.title||"Election"}</b>\n\nYour candidate application was <b>not approved</b>.${reason?`\nReason: ${reason}`:""}`;
    c.executionCtx.waitUntil(sendMessage(c.env,applicant.telegram_id,note).catch(()=>null));
  }
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/applications/:applicationId/reopen", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election)||election.certified_at)return c.json({error:"Applications are locked after the voter snapshot is created"},409);
  const application=await c.env.DB.prepare(`SELECT ea.*,m.name member_name,m.telegram_id,ep.title position_title FROM election_applications ea
    JOIN members m ON m.id=ea.member_id JOIN election_positions ep ON ep.id=ea.position_id
    WHERE ea.id=? AND ea.election_id=?`).bind(applicationId,id).first<any>();
  if(!application)return c.json({error:"Application not found"},404);
  if(!["rejected","withdrawn"].includes(application.status))return c.json({error:"Only rejected or withdrawn applications can be reopened"},409);
  const duplicate=await c.env.DB.prepare(`SELECT id FROM election_applications WHERE election_id=? AND position_id=? AND member_id=? AND id<>?
    AND status IN ('pending','approved') LIMIT 1`).bind(id,application.position_id,application.member_id,applicationId).first<any>();
  if(duplicate)return c.json({error:"An active application already exists for this member and position"},409);

  await c.env.DB.prepare(`UPDATE election_applications SET status='pending',reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL,withdrawn_at=NULL
    WHERE id=? AND election_id=?`).bind(applicationId,id).run();
  // If the old approved candidacy had been withdrawn, keep the candidate row inactive until Admin approves again.
  await auditEntity(c.env,admin.id,"election_application_reopened","election_application",applicationId,application,{...application,status:"pending",election_id:id});
  if(application.telegram_id)c.executionCtx.waitUntil(sendMessage(c.env,application.telegram_id,
    `🔄 <b>${election.title}</b>\n\nYour application for <b>${application.position_title||"an EXCO position"}</b> has been reopened and is pending review again.`
  ).catch(()=>null));
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/applications/:applicationId/reassign", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),applicationId=Number(c.req.param("applicationId"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election)||election.certified_at)return c.json({error:"Applications are locked after the voter snapshot is created"},409);
  const body=await c.req.json<any>().catch(()=>({})); const newPositionId=Number(body.position_id);
  const position=await c.env.DB.prepare("SELECT id,title FROM election_positions WHERE id=? AND election_id=?").bind(newPositionId,id).first<any>();
  if(!position)return c.json({error:"Choose a valid position"},400);
  const application=await c.env.DB.prepare(`SELECT ea.*,m.name member_name,m.telegram_id,ep.title old_position_title
    FROM election_applications ea JOIN members m ON m.id=ea.member_id JOIN election_positions ep ON ep.id=ea.position_id
    WHERE ea.id=? AND ea.election_id=?`).bind(applicationId,id).first<any>();
  if(!application)return c.json({error:"Application not found"},404);
  if(Number(application.position_id)===newPositionId)return c.json({error:"Application is already assigned to this position"},409);
  const duplicate=await c.env.DB.prepare(`SELECT id FROM election_applications WHERE election_id=? AND position_id=? AND member_id=? AND id<>?
    LIMIT 1`).bind(id,newPositionId,application.member_id,applicationId).first<any>();
  if(duplicate)return c.json({error:"This member already has an application for the selected position"},409);

  const statements:any[]=[
    c.env.DB.prepare("UPDATE election_applications SET position_id=? WHERE id=? AND election_id=?").bind(newPositionId,applicationId,id)
  ];
  if(application.status==="approved"){
    const candidate=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE election_id=? AND position_id=? AND member_id=?")
      .bind(id,application.position_id,application.member_id).first<any>();
    if(candidate){
      const target=await c.env.DB.prepare("SELECT id FROM election_candidates WHERE election_id=? AND position_id=? AND member_id=?")
        .bind(id,newPositionId,application.member_id).first<any>();
      if(target){
        statements.push(c.env.DB.prepare(`UPDATE election_candidates SET status='active',display_name=?,withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL WHERE id=?`)
          .bind(application.member_name,target.id));
        statements.push(c.env.DB.prepare("UPDATE election_candidates SET status='withdrawn',withdrawn_at=datetime('now'),withdrawn_by=?,withdrawal_reason='Reassigned to another position' WHERE id=?")
          .bind(admin.id,candidate.id));
      }else{
        statements.push(c.env.DB.prepare("UPDATE election_candidates SET position_id=? WHERE id=?").bind(newPositionId,candidate.id));
      }
    }
  }
  await c.env.DB.batch(statements);
  await auditEntity(c.env,admin.id,"election_application_reassigned","election_application",applicationId,application,{...application,position_id:newPositionId,position_title:position.title,election_id:id});
  if(application.telegram_id)c.executionCtx.waitUntil(sendMessage(c.env,application.telegram_id,
    `🔁 <b>${election.title}</b>\n\nYour candidate application has been moved from <b>${application.old_position_title}</b> to <b>${position.title}</b>.`
  ).catch(()=>null));
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/candidates/:candidateId/withdraw", requireSuperAdmin, async c=>{
  await processElectionLifecycle(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id")),candidateId=Number(c.req.param("candidateId"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"Candidate changes are locked after the voter snapshot is created"},409);
  const before=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE id=? AND election_id=?").bind(candidateId,id).first<any>();
  if(!before)return c.json({error:"Candidate not found"},404);
  const body=await c.req.json<any>().catch(()=>({})); const reason=text(body.reason,300)||"Withdrawn";
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE election_candidates SET status='withdrawn',withdrawn_at=datetime('now'),withdrawn_by=?,withdrawal_reason=?
      WHERE id=? AND election_id=?`).bind(admin.id,reason,candidateId,id),
    c.env.DB.prepare(`UPDATE election_applications
      SET status='withdrawn',withdrawn_at=datetime('now'),review_reason=?,reviewed_by=?
      WHERE election_id=? AND position_id=? AND member_id=? AND status='approved'`)
      .bind(`Withdrawn by admin: ${reason}`,admin.id,id,before.position_id,before.member_id)
  ]);
  const after=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE id=?").bind(candidateId).first<any>();
  await auditEntity(c.env,admin.id,"election_candidate_withdrawn","election_candidate",candidateId,before,{...after,election_id:id});
  const member=await c.env.DB.prepare("SELECT telegram_id,name FROM members WHERE id=?").bind(before.member_id).first<any>();
  if(member?.telegram_id){
    c.executionCtx.waitUntil(sendMessage(c.env,member.telegram_id,
      `↩️ <b>${election.title}</b>

Your approved candidacy has been <b>withdrawn by Admin</b>.${reason?`
Reason: ${reason}`:""}`
    ).catch(()=>null));
  }
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

electionsRoute.post("/:id/runoffs", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(election.status!=="closed"||election.certified_at)return c.json({error:"Runoff can only start for a closed, uncertified election"},409);
  const body=await c.req.json<any>().catch(()=>({})); const positionId=Number(body.position_id);
  const calculated=await calculateElectionResults(c.env,id);
  const tie=calculated.unresolved.find((x:any)=>Number(x.position_id)===positionId);
  if(!tie)return c.json({error:"This position does not currently require a runoff"},409);
  const existing=await c.env.DB.prepare("SELECT id FROM election_runoffs WHERE election_id=? AND position_id=? AND status='open' LIMIT 1").bind(id,positionId).first<any>();
  if(existing)return c.json({error:"A runoff is already open for this position"},409);
  const closesAt=iso(body.closes_at)||null;
  if(closesAt && closesAt<=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"))return c.json({error:"Runoff closing time must be in the future"},400);
  const r=await c.env.DB.prepare(`INSERT INTO election_runoffs(election_id,position_id,round_no,seats_to_fill,status,closes_at,created_by)
    VALUES(?,?,?,?, 'open',?,?)`).bind(id,positionId,Number(tie.round_no||1),Number(tie.seats_to_fill||1),closesAt,admin.id).run();
  const runoffId=Number(r.meta.last_row_id);
  const statements:any[]=[
    ...tie.candidate_ids.map((candidateId:number)=>c.env.DB.prepare("INSERT INTO election_runoff_candidates(runoff_id,candidate_id) VALUES(?,?)").bind(runoffId,candidateId)),
    c.env.DB.prepare("INSERT OR IGNORE INTO election_runoff_voters(runoff_id,member_id) SELECT ?,id FROM members WHERE active=1").bind(runoffId)
  ];
  await c.env.DB.batch(statements);
  await auditEntity(c.env,admin.id,"election_runoff_opened","election_runoff",runoffId,null,{election_id:id,position_id:positionId,round_no:tie.round_no,seats_to_fill:tie.seats_to_fill,candidate_ids:tie.candidate_ids});
  const brand=await getBranding(c.env);
  const position=await c.env.DB.prepare("SELECT title FROM election_positions WHERE id=?").bind(positionId).first<any>();
  const voters=await c.env.DB.prepare(`SELECT m.telegram_id FROM election_runoff_voters v JOIN members m ON m.id=v.member_id
    WHERE v.runoff_id=? AND m.telegram_id IS NOT NULL`).bind(runoffId).all<any>();
  c.executionCtx.waitUntil(Promise.allSettled((voters.results as any[]).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${brand.fund_name} · Runoff Vote</b>\n\nA runoff is now open for <b>${position?.title||"EXCO position"}</b> in ${election.title}. Open the Mini App to vote.`
  ))));
  return c.json({ok:true,runoff_id:runoffId,...await electionDetail(c.env,id)});
});

electionsRoute.post("/:id/runoffs/:runoffId/close", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),runoffId=Number(c.req.param("runoffId"));
  const before=await c.env.DB.prepare("SELECT * FROM election_runoffs WHERE id=? AND election_id=?").bind(runoffId,id).first<any>();
  if(!before)return c.json({error:"Runoff not found"},404);
  if(before.status!=="open")return c.json({error:"Runoff is not open"},409);
  await c.env.DB.prepare("UPDATE election_runoffs SET status='closed',closed_at=datetime('now') WHERE id=?").bind(runoffId).run();
  await auditEntity(c.env,admin.id,"election_runoff_closed","election_runoff",runoffId,before,{...before,status:"closed",election_id:id});
  const calculated=await calculateElectionResults(c.env,id);
  return c.json({...await electionDetail(c.env,id),results:calculated.results,unresolved_ties:calculated.unresolved});
});

electionsRoute.post("/:id/runoffs/:runoffId/vote", async c=>{
  await processElectionLifecycle(c.env);
  const id=Number(c.req.param("id")),runoffId=Number(c.req.param("runoffId")); const member=await memberForUser(c);
  if(!member)return c.json({error:"Approved member account required"},403);
  const runoff=await c.env.DB.prepare("SELECT * FROM election_runoffs WHERE id=? AND election_id=?").bind(runoffId,id).first<any>();
  if(!runoff)return c.json({error:"Runoff not found"},404); if(runoff.status!=="open")return c.json({error:"Runoff voting is not open"},409);
  const voter=await c.env.DB.prepare("SELECT voted_at,vote_claim FROM election_runoff_voters WHERE runoff_id=? AND member_id=?").bind(runoffId,member.id).first<any>();
  if(!voter)return c.json({error:"You are not eligible for this runoff"},403); if(voter.voted_at)return c.json({error:"Your runoff ballot has already been submitted"},409);
  const body=await c.req.json<any>().catch(()=>({})); const ids=Array.isArray(body.candidate_ids)?[...new Set(body.candidate_ids.map(Number).filter(Number.isInteger))]:[];
  const need=Number(runoff.seats_to_fill||1);
  if(ids.length!==need)return c.json({error:`Select exactly ${need} candidate${need===1?"":"s"} in this runoff`},400);
  for(const candidateId of ids){
    const valid=await c.env.DB.prepare("SELECT 1 ok FROM election_runoff_candidates WHERE runoff_id=? AND candidate_id=?").bind(runoffId,candidateId).first<any>();
    if(!valid)return c.json({error:"Invalid runoff candidate"},400);
  }
  const claim=crypto.randomUUID();
  const claimed=await c.env.DB.prepare("UPDATE election_runoff_voters SET vote_claim=? WHERE runoff_id=? AND member_id=? AND voted_at IS NULL AND vote_claim IS NULL").bind(claim,runoffId,member.id).run();
  if(!claimed.meta.changes)return c.json({error:"Your runoff ballot is already being processed"},409);
  const token=crypto.randomUUID();
  const statements:any[]=ids.map((candidateId:number)=>c.env.DB.prepare("INSERT INTO election_runoff_ballots(runoff_id,ballot_token,candidate_id) VALUES(?,?,?)").bind(runoffId,token,candidateId));
  statements.push(c.env.DB.prepare("UPDATE election_runoff_voters SET voted_at=datetime('now'),vote_claim=NULL WHERE runoff_id=? AND member_id=? AND vote_claim=?").bind(runoffId,member.id,claim));
  try{await c.env.DB.batch(statements)}catch(e){await c.env.DB.prepare("UPDATE election_runoff_voters SET vote_claim=NULL WHERE runoff_id=? AND member_id=? AND vote_claim=?").bind(runoffId,member.id,claim).run().catch(()=>{});throw e}
  return c.json({ok:true,submitted:true});
});

electionsRoute.post("/:id/certify", requireSuperAdmin, async c=>{
  await processElectionLifecycle(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404);
  if(before.status!=="closed")return c.json({error:"Close the election before certification"},409);
  if(before.certified_at)return c.json({error:"Results are already certified and locked"},409);
  const calculated=await calculateElectionResults(c.env,id);
  if(calculated.unresolved.length)return c.json({error:"Resolve all tied seats with runoff voting before certification",unresolved_ties:calculated.unresolved},409);

  await c.env.DB.prepare("UPDATE elections SET certified_at=datetime('now'),certified_by=? WHERE id=? AND certified_at IS NULL").bind(admin.id,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  const elected=await assignCertifiedExcoRoles(c.env,after,calculated.results,after.certified_at);
  await auditEntity(c.env,admin.id,"election_results_certified","election",id,before,{...after,assigned_roles:elected.map((x:any)=>({member_id:x.member_id,role_title:x.role_title}))});

  const brand=await getBranding(c.env);
  await notifyEligible(c.env,after,`🏆 <b>${brand.fund_name} · ${after.title}</b>\n\nElection results have been certified. The official EXCO list is now available in the Mini App.`).catch(()=>{});
  const electedMembers=await c.env.DB.prepare(`SELECT x.role_title,m.telegram_id,m.name FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id WHERE x.election_id=? AND x.ended_at IS NULL`).bind(id).all<any>();
  c.executionCtx.waitUntil(Promise.allSettled((electedMembers.results as any[]).filter((m:any)=>m.telegram_id).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🎉 <b>${brand.fund_name} · EXCO</b>\n\nCongratulations ${m.name}. You have been officially assigned as <b>${m.role_title}</b> after certification of ${after.title}.`
  ))));
  return c.json({...await electionDetail(c.env,id),results:calculated.results,unresolved_ties:[],assigned_roles:elected});
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
