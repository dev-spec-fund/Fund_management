import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireSuperAdmin } from "../../auth";
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

export function registerElectionManagementRoutes(electionsRoute: Hono<AppEnv>) {
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
  const applicationConfigChanged=(applicationsOpenAt||null)!==(before.applications_open_at||null)||(applicationsCloseAt||null)!==(before.applications_close_at||null);
  if(applicationConfigChanged){
    const phase=applicationPhase(before,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"));
    const existingApplication=await c.env.DB.prepare("SELECT 1 ok FROM election_applications WHERE election_id=? LIMIT 1").bind(id).first<any>();
    if(phase==="open"||phase==="closed"||existingApplication)
      return c.json({error:"Candidate application settings are locked after applications begin. Use Extend application deadline when applicable.",code:"ELECTION_APPLICATION_CONFIG_LOCKED"},409);
  }
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
  const phase=applicationPhase(election,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"));
  if(phase==="open"||phase==="closed")return c.json({error:"Election positions are locked once candidate applications have opened",code:"ELECTION_POSITIONS_LOCKED"},409);
  const existingApplication=await c.env.DB.prepare("SELECT 1 ok FROM election_applications WHERE election_id=? LIMIT 1").bind(id).first<any>();
  if(existingApplication)return c.json({error:"Election positions are locked after candidate applications have been submitted",code:"ELECTION_POSITIONS_LOCKED"},409);
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
  const existingApplication=await c.env.DB.prepare("SELECT 1 ok FROM election_applications WHERE election_id=? LIMIT 1").bind(id).first<any>();
  if((election.applications_open_at&&election.applications_close_at)||existingApplication)return c.json({error:"Use the candidate application review workflow for this election",code:"CANDIDATE_APPLICATION_WORKFLOW_REQUIRED"},409);
  const body=await c.req.json<any>(); const positionId=Number(body.position_id),memberId=Number(body.member_id);
  const position=await c.env.DB.prepare("SELECT id FROM election_positions WHERE id=? AND election_id=?").bind(positionId,id).first<any>();
  const member=await c.env.DB.prepare("SELECT id,name FROM members WHERE id=? AND active=1").bind(memberId).first<any>();
  if(!position||!member)return c.json({error:"Choose a valid position and active member"},400);
  try{
    const r=await c.env.DB.prepare("INSERT INTO election_candidates(election_id,position_id,member_id,display_name) VALUES(?,?,?,?)")
      .bind(id,positionId,memberId,member.name).run();
    await auditEntity(c.env,admin.id,"election_candidate_added","election_candidate",Number(r.meta.last_row_id),null,{election_id:id,position_id:positionId,member_id:memberId});
  }catch(err:any){
    const message=String(err?.message||err||"");
    if(/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message))
      return c.json({error:"Candidate is already added for this position"},409);
    throw err;
  }
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
  const openClaim=await c.env.DB.prepare("UPDATE elections SET status='open',opened_at=datetime('now') WHERE id=? AND status='draft'")
    .bind(id).run();
  if(!openClaim.meta.changes){
    return c.json({error:"Election was already opened or changed while you were opening it",code:"ELECTION_OPEN_CHANGED"},409);
  }
  await c.env.DB.prepare("INSERT OR IGNORE INTO election_voters(election_id,member_id) SELECT ?,id FROM members WHERE active=1").bind(id).run();
  await auditEntity(c.env,admin.id,"election_opened","election",id,election,{...election,status:"open"});
  const branding=await getBranding(c.env);
  const members=await c.env.DB.prepare(`SELECT m.telegram_id FROM election_voters v JOIN members m ON m.id=v.member_id
    WHERE v.election_id=? AND m.telegram_id IS NOT NULL`).bind(id).all<any>();
  const deliveryResults=await Promise.allSettled(members.results.map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${branding.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`)));
  const delivery={sent:deliveryResults.filter((r:any)=>r.status==="fulfilled").length,failed:deliveryResults.filter((r:any)=>r.status==="rejected").length};
  await recordElectionNotification(c.env,id,"voting_opened","eligible_voters",delivery,{automatic:false},admin.id);
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/close", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Election is not open"},409);
  const closeClaim=await c.env.DB.prepare("UPDATE elections SET status='closed',closed_at=datetime('now') WHERE id=? AND status='open'")
    .bind(id).run();
  if(!closeClaim.meta.changes){
    return c.json({error:"Election was already closed or changed while you were closing it",code:"ELECTION_CLOSE_CHANGED"},409);
  }
  await auditEntity(c.env,admin.id,"election_closed","election",id,election,{...election,status:"closed"});
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.delete("/:id", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!,id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);

  const eligibility=await electionDeleteEligibility(c.env,election);
  if(!eligibility.allowed){
    return c.json({
      error:"This election cannot be permanently deleted",
      reasons:eligibility.reasons,
      counts:eligibility.counts
    },409);
  }

  // Claim the delete only if the election is still an unused draft at the
  // exact moment of deletion. This closes the race between the eligibility
  // check above and a concurrent application/voter/runoff/governance write.
  const result=await c.env.DB.prepare(`DELETE FROM elections
    WHERE id=? AND status='draft'
      AND NOT EXISTS (SELECT 1 FROM election_applications WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM election_voters WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM election_ballots WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM election_runoffs WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM exco_role_assignments WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM exco_terms WHERE election_id=?)
      AND NOT EXISTS (SELECT 1 FROM election_notification_log WHERE election_id=?)`)
    .bind(id,id,id,id,id,id,id,id).run();
  if(!result.meta.changes){
    return c.json({
      error:"Election changed or gained activity while you were deleting it. Refresh and review it again.",
      code:"ELECTION_DELETE_CHANGED"
    },409);
  }

  // Record deletion only after the guarded delete actually succeeds. The
  // in-memory election snapshot is enough to preserve who deleted what.
  await auditEntity(c.env,admin.id,"election_deleted_unused_draft","election",id,election,{
    deleted:true,title:election.title,term:election.term||null
  });
  return c.json({ok:true,id,title:election.title});
});

electionsRoute.post("/:id/cancel", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"An election cannot be cancelled after the voter snapshot is created"},409);
  if(election.status!=="draft")return c.json({error:"Only a draft election can be cancelled",code:"ELECTION_CANCEL_CHANGED"},409);
  const cancelClaim=await c.env.DB.prepare("UPDATE elections SET status='cancelled',closed_at=datetime('now') WHERE id=? AND status='draft'").bind(id).run();
  if(!cancelClaim.meta.changes)return c.json({error:"Election was already cancelled or changed while you were cancelling it",code:"ELECTION_CANCEL_CHANGED"},409);
  await auditEntity(c.env,admin.id,"election_cancelled","election",id,election,{...election,status:"cancelled"});
  return c.json(await electionDetail(c.env,id));
});


}
