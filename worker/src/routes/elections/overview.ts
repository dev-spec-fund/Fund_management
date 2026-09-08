import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireElectionsManage } from "../../auth";
import { auditEntity, ensureOperationalSchema } from "../../ops";
import { sendMessage } from "../../telegram";
import { getBranding } from "../../db";
import { esc, miniAppUrl, notifyAdmins } from "../../botSupport";

import {
  iso, text, localNow, applicationPhase, notifyEligible, recordElectionNotification, claimElectionNotification, finishClaimedElectionNotification,
  electionSetupLocked, synchronizeElectionApplications, evaluateElectionReadiness, processElectionLifecycle,
  calculateElectionResults, ensureExcoTerms, createExcoTermHandover, assignCertifiedExcoRoles,
  buildElectionSummary, memberForUser, electionDeleteEligibility, electionDetail
} from "../../elections/core";

export function registerElectionOverviewRoutes(electionsRoute: Hono<AppEnv>) {
electionsRoute.get("/", async c=>{
  await ensureOperationalSchema(c.env);
  // Election lifecycle is already processed by the hourly scheduled job. Keeping
  // it out of this read route prevents Telegram page navigation from waiting on
  // reminder checks, readiness work, notifications, and lifecycle writes.
  const member=await memberForUser(c);
  const admin=c.get("admin");
  const memberId=member?.id||null;
  const rows=await c.env.DB.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id) eligible_count,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id AND v.voted_at IS NOT NULL) voted_count,
    (SELECT COUNT(*) FROM election_runoffs r WHERE r.election_id=e.id AND r.status='open') open_runoffs,
    CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
      SELECT 1 FROM election_voters mv WHERE mv.election_id=e.id AND mv.member_id=?
    ) END my_eligible,
    CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
      SELECT 1 FROM election_voters mv WHERE mv.election_id=e.id AND mv.member_id=? AND mv.voted_at IS NOT NULL
    ) END my_voted,
    CASE WHEN ? IS NULL THEN NULL ELSE (
      SELECT ma.status FROM election_applications ma
      WHERE ma.election_id=e.id AND ma.member_id=?
      ORDER BY ma.submitted_at DESC,ma.id DESC LIMIT 1
    ) END my_application_status
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
    .bind(memberId,memberId,memberId,memberId,memberId,memberId,admin?.id||null).all<any>();
  const now=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives");
  const result=(rows.results as any[]).map((e:any)=>{
    const eligibleCount=Number(e.eligible_count||0),votedCount=Number(e.voted_count||0);
    const {eligible_count,voted_count,my_eligible,my_voted,...base}=e;
    return {...base,
      eligible:!!my_eligible,
      my_vote:!!my_voted,
      my_application_status:e.my_application_status||null,
      application_phase:applicationPhase(e,now),
      turnout:{eligible:eligibleCount,voted:votedCount,percent:eligibleCount>0?Math.round((votedCount/eligibleCount)*1000)/10:0}
    };
  });
  return c.json(result);
});


electionsRoute.get("/dashboard", requireElectionsManage, async c=>{
  await ensureOperationalSchema(c.env);
  await processElectionLifecycle(c.env);
  const now=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives");
  const rows=await c.env.DB.prepare(`SELECT e.*
    FROM elections e
    WHERE e.status IN ('draft','open')
       OR (e.status='closed' AND e.certified_at IS NULL)
    ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,e.id DESC`).all<any>();

  const items:any[]=[];
  for(const election of rows.results as any[]){
    const [apps,candidates,voters,runoffs,notifications]=await Promise.all([
      c.env.DB.prepare(`SELECT
        COUNT(*) total,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected,
        SUM(CASE WHEN status='withdrawn' THEN 1 ELSE 0 END) withdrawn
        FROM election_applications WHERE election_id=?`).bind(election.id).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
        SUM(CASE WHEN status='withdrawn' THEN 1 ELSE 0 END) withdrawn
        FROM election_candidates WHERE election_id=?`).bind(election.id).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) eligible,
        SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted
        FROM election_voters WHERE election_id=?`).bind(election.id).first<any>(),
      c.env.DB.prepare(`SELECT r.*,ep.title position_title,
        (SELECT COUNT(*) FROM election_runoff_voters rv WHERE rv.runoff_id=r.id) eligible,
        (SELECT COUNT(*) FROM election_runoff_voters rv WHERE rv.runoff_id=r.id AND rv.voted_at IS NOT NULL) voted
        FROM election_runoffs r JOIN election_positions ep ON ep.id=r.position_id
        WHERE r.election_id=? AND r.status='open' ORDER BY r.round_no,r.id`).bind(election.id).all<any>(),
      c.env.DB.prepare(`SELECT
        COALESCE(SUM(sent),0) sent,
        COALESCE(SUM(failed),0) failed,
        SUM(CASE WHEN failed>0 THEN 1 ELSE 0 END) failed_events
        FROM election_notification_log WHERE election_id=?`).bind(election.id).first<any>()
    ]);

    let readiness:any=null;
    if(election.status==="draft") readiness=await evaluateElectionReadiness(c.env,election);

    const eligible=Number(voters?.eligible||0),voted=Number(voters?.voted||0);
    const nonVoters=Math.max(0,eligible-voted);
    const appPhase=applicationPhase(election,now);
    const activeRunoffs=(runoffs.results as any[]).map((r:any)=>({
      id:r.id,position_id:r.position_id,position_title:r.position_title,round_no:Number(r.round_no||1),
      closes_at:r.closes_at,eligible:Number(r.eligible||0),voted:Number(r.voted||0)
    }));

    let stage="Election setup";
    if(election.status==="draft"&&appPhase==="open")stage="Applications Open";
    else if(election.status==="draft"&&appPhase==="upcoming")stage="Applications Open Soon";
    else if(election.status==="draft"&&appPhase==="closed")stage=readiness?.ready?"Ready to Open Voting":"Pre-Vote Review";
    else if(election.status==="open")stage="Voting Open";
    else if(election.status==="closed"&&activeRunoffs.length)stage="Runoff Open";
    else if(election.status==="closed")stage="Awaiting Certification";

    const warnings:any[]=[];
    if(Number(apps?.pending||0)>0)warnings.push({key:"pending_applications",level:"warning",text:`${Number(apps.pending)} pending application${Number(apps.pending)===1?" needs":"s need"} review`});
    if(election.status==="draft"&&readiness&&!readiness.ready)warnings.push({key:"readiness",level:"warning",text:`Pre-vote readiness ${readiness.passed}/${readiness.total} checks passed`});
    if(election.status==="open"&&election.closes_at){
      const closeMs=Date.parse(`${election.closes_at}Z`),nowMs=Date.parse(`${now}Z`);
      if(Number.isFinite(closeMs)&&Number.isFinite(nowMs)&&closeMs>nowMs&&closeMs-nowMs<=24*60*60*1000)
        warnings.push({key:"voting_closes_soon",level:"warning",text:`Voting closes within 24 hours · ${nonVoters} member${nonVoters===1?"":"s"} have not voted`});
    }
    if(activeRunoffs.length)warnings.push({key:"runoff_open",level:"action",text:`${activeRunoffs.length} runoff${activeRunoffs.length===1?" is":"s are"} open`});
    if(Number(notifications?.failed||0)>0)warnings.push({key:"notification_failures",level:"danger",text:`${Number(notifications.failed)} notification delivery failure${Number(notifications.failed)===1?"":"s"}`});
    if(election.status==="closed"&&!activeRunoffs.length&&!election.certified_at)warnings.push({key:"certification",level:"action",text:"Results require certification"});

    items.push({
      id:election.id,title:election.title,term:election.term,status:election.status,stage,
      applications:{total:Number(apps?.total||0),pending:Number(apps?.pending||0),approved:Number(apps?.approved||0),rejected:Number(apps?.rejected||0),withdrawn:Number(apps?.withdrawn||0),phase:appPhase,closes_at:election.applications_close_at},
      candidates:{total:Number(candidates?.total||0),active:Number(candidates?.active||0),withdrawn:Number(candidates?.withdrawn||0)},
      readiness,
      turnout:{eligible,voted,remaining:nonVoters,percent:eligible?Math.round((voted/eligible)*1000)/10:0},
      voting:{opens_at:election.opens_at,closes_at:election.closes_at},
      runoffs:activeRunoffs,
      notifications:{sent:Number(notifications?.sent||0),failed:Number(notifications?.failed||0),failed_events:Number(notifications?.failed_events||0)},
      warnings
    });
  }

  const warnings=items.flatMap((item:any)=>item.warnings.map((w:any)=>({...w,election_id:item.id,election_title:item.title})));
  return c.json({
    items,
    warnings,
    totals:{
      active_elections:items.length,
      pending_applications:items.reduce((n:number,x:any)=>n+x.applications.pending,0),
      open_voting:items.filter((x:any)=>x.status==="open").length,
      open_runoffs:items.reduce((n:number,x:any)=>n+x.runoffs.length,0),
      notification_failures:items.reduce((n:number,x:any)=>n+x.notifications.failed,0)
    }
  });
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

electionsRoute.get("/:id/notifications", requireElectionsManage, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT id FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  const [rows,totalsRow]=await Promise.all([
    c.env.DB.prepare(`SELECT n.*,a.name created_by_name FROM election_notification_log n
      LEFT JOIN admins a ON a.id=n.created_by WHERE n.election_id=?
      ORDER BY n.id DESC LIMIT 50`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) total,COALESCE(SUM(sent),0) sent,COALESCE(SUM(failed),0) failed
      FROM election_notification_log WHERE election_id=?`).bind(id).first<any>()
  ]);
  const items=(rows.results as any[]).map((n:any)=>({
    ...n,
    detail:(()=>{try{return n.detail?JSON.parse(n.detail):null}catch{return null}})()
  }));
  const totals={total:Number(totalsRow?.total||0),sent:Number(totalsRow?.sent||0),failed:Number(totalsRow?.failed||0)};
  return c.json({items,totals});
});

electionsRoute.get("/:id/timeline", requireElectionsManage, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare(`SELECT e.*,creator.name created_by_name,certifier.name certified_by_name
    FROM elections e LEFT JOIN admins creator ON creator.id=e.created_by
    LEFT JOIN admins certifier ON certifier.id=e.certified_by WHERE e.id=?`).bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);

  // Match this election by exact JSON ids. Substring matching (for example ID 2
  // matching ID 20) can contaminate a governance timeline, and a global LIMIT
  // can silently omit later events on long-lived installations.
  const audits=await c.env.DB.prepare(`SELECT a.id,a.action,a.detail,a.created_at,ad.name admin_name
    FROM audit_log a LEFT JOIN admins ad ON ad.id=a.admin_id
    WHERE (a.action LIKE 'election_%' OR a.action LIKE 'exco_%')
      AND json_valid(a.detail)=1
      AND (
        (json_extract(a.detail,'$.entity')='election' AND CAST(json_extract(a.detail,'$.entity_id') AS INTEGER)=?)
        OR CAST(json_extract(a.detail,'$.before.election_id') AS INTEGER)=?
        OR CAST(json_extract(a.detail,'$.after.election_id') AS INTEGER)=?
      )
    ORDER BY a.id ASC`).bind(id,id,id).all<any>();
  const relevant=audits.results as any[];
  const notifications=await c.env.DB.prepare(`SELECT id,event_key,audience,sent,failed,created_at FROM election_notification_log
    WHERE election_id=? ORDER BY id`).bind(id).all<any>();

  const label=(action:string)=>{
    const map:any={
      election_created:"Election created",election_application_deadline_extended:"Application deadline extended",
      election_position_added:"Position added",election_candidate_added:"Candidate added",
      election_application_admin_notified:"New application submitted",election_application_reopened:"Application reopened",
      election_application_reassigned:"Application moved",election_candidate_withdrawn:"Candidate withdrawn",
      election_opened:"Voting opened",election_auto_opened:"Voting opened automatically",
      election_closed:"Voting closed",election_auto_closed:"Voting closed automatically",
      election_runoff_opened:"Runoff opened",election_runoff_closed:"Runoff closed",
      election_runoff_auto_closed:"Runoff closed automatically",election_results_certified:"Results certified",
      exco_term_started:"New EXCO term started",exco_handover_completed:"EXCO handover completed"
    };
    return map[action]||action.replaceAll("_"," ");
  };
  const events:any[]=[
    {type:"milestone",key:"created",label:"Election created",at:election.created_at,actor:election.created_by_name||"System"},
    ...relevant.map((a:any)=>({type:"audit",key:`audit:${a.id}`,label:label(a.action),action:a.action,at:a.created_at,actor:a.admin_name||"System"})),
    ...(notifications.results as any[]).map((n:any)=>({type:"notification",key:`notification:${n.id}`,label:`Notification · ${String(n.event_key).replaceAll("_"," ")}`,at:n.created_at,actor:"System",meta:{audience:n.audience,sent:Number(n.sent||0),failed:Number(n.failed||0)}}))
  ].filter((x:any)=>x.at);
  if(election.opened_at)events.push({type:"milestone",key:"opened",label:"Voting period began",at:election.opened_at,actor:"System"});
  if(election.closed_at)events.push(election.status==="cancelled"
    ? {type:"milestone",key:"cancelled",label:"Election cancelled",at:election.closed_at,actor:"System"}
    : {type:"milestone",key:"closed",label:"Voting period ended",at:election.closed_at,actor:"System"});
  if(election.certified_at)events.push({type:"milestone",key:"certified",label:"Official certification",at:election.certified_at,actor:election.certified_by_name||"Super Admin"});
  events.sort((a:any,b:any)=>String(a.at).localeCompare(String(b.at))||String(a.key).localeCompare(String(b.key)));

  const governance={
    election_id:id,title:election.title,term:election.term,
    created_by:election.created_by_name||"System",created_at:election.created_at,
    voting_opened_at:election.opened_at||null,voting_closed_at:election.closed_at||null,
    certified_by:election.certified_by_name||null,certified_at:election.certified_at||null,
    ballot_privacy:"Ballot selections remain anonymous and are not included in the governance timeline."
  };
  return c.json({events,governance});
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


}
