import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireElectionsCertify, requireElectionsManage } from "../../auth";
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

export function registerElectionVotingRoutes(electionsRoute: Hono<AppEnv>) {
electionsRoute.post("/:id/remind-nonvoters", requireElectionsManage, async c=>{
  await processElectionLifecycle(c.env);
  const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Election is not open"},409);
  const admin=c.get("admin")!;
  // One manual reminder batch per election per minute. This prevents a double tap
  // or two admins acting together from sending the same Telegram reminder twice.
  const reminderBucket=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives").slice(0,16).replace(/[-:T]/g,"");
  const eventKey=`manual_voting_reminder:${reminderBucket}`;
  const notificationId=await claimElectionNotification(c.env,id,eventKey,"non_voters",{manual:true},admin.id);
  if(!notificationId)return c.json({error:"A voting reminder was already sent moments ago. Please wait before sending another.",code:"VOTING_REMINDER_ALREADY_SENT"},409);
  const brand=await getBranding(c.env);
  const result=await notifyEligible(c.env,election,`🗳 <b>${brand.fund_name} · Voting reminder</b>\n\nYou are eligible to vote in <b>${election.title}</b> and have not yet submitted your ballot. Open the Mini App to vote.`,true);
  await finishClaimedElectionNotification(c.env,notificationId,result);
  return c.json({ok:true,...result});
});

electionsRoute.post("/:id/runoffs", requireElectionsManage, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(election.status!=="closed"||election.certified_at)return c.json({error:"Runoff can only start for a closed, uncertified election"},409);
  const body=await c.req.json<any>().catch(()=>({})); const positionId=Number(body.position_id);
  const calculated=await calculateElectionResults(c.env,id);
  const tie=calculated.unresolved.find((x:any)=>Number(x.position_id)===positionId);
  if(!tie)return c.json({error:"This position does not currently require a runoff"},409);
  const closesAt=iso(body.closes_at)||null;
  if(closesAt && closesAt<=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives"))return c.json({error:"Runoff closing time must be in the future"},400);
  const r=await c.env.DB.prepare(`INSERT INTO election_runoffs(election_id,position_id,round_no,seats_to_fill,status,closes_at,created_by)
    SELECT ?,?,?,?,'open',?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM election_runoffs WHERE election_id=? AND position_id=? AND status='open'
    )`).bind(id,positionId,Number(tie.round_no||1),Number(tie.seats_to_fill||1),closesAt,admin.id,id,positionId).run();
  if(!r.meta.changes)return c.json({error:"A runoff is already open for this position",code:"RUNOFF_OPEN_CHANGED"},409);
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
  const runoffDeliveries=await Promise.allSettled((voters.results as any[]).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${brand.fund_name} · Runoff Vote</b>\n\nA runoff is now open for <b>${position?.title||"EXCO position"}</b> in ${election.title}. Open the Mini App to vote.`
  )));
  const runoffDelivery={sent:runoffDeliveries.filter((r:any)=>r.status==="fulfilled").length,failed:runoffDeliveries.filter((r:any)=>r.status==="rejected").length};
  await recordElectionNotification(c.env,id,`runoff_opened:${runoffId}`,"runoff_voters",runoffDelivery,{runoff_id:runoffId,position_id:positionId,round_no:tie.round_no},admin.id);
  return c.json({ok:true,runoff_id:runoffId,...await electionDetail(c.env,id)});
});

electionsRoute.post("/:id/runoffs/:runoffId/close", requireElectionsManage, async c=>{
  const admin=c.get("admin")!,id=Number(c.req.param("id")),runoffId=Number(c.req.param("runoffId"));
  const before=await c.env.DB.prepare("SELECT * FROM election_runoffs WHERE id=? AND election_id=?").bind(runoffId,id).first<any>();
  if(!before)return c.json({error:"Runoff not found"},404);
  if(before.status!=="open")return c.json({error:"Runoff is not open"},409);
  const closeClaim=await c.env.DB.prepare("UPDATE election_runoffs SET status='closed',closed_at=datetime('now') WHERE id=? AND election_id=? AND status='open'")
    .bind(runoffId,id).run();
  if(!closeClaim.meta.changes){
    return c.json({error:"Runoff was already closed or changed while you were closing it",code:"RUNOFF_CLOSE_CHANGED"},409);
  }
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
  statements.push(c.env.DB.prepare(`UPDATE election_runoff_voters SET voted_at=datetime('now'),vote_claim=NULL
    WHERE runoff_id=? AND member_id=? AND vote_claim=?
      AND EXISTS (SELECT 1 FROM election_runoffs r WHERE r.id=? AND r.election_id=? AND r.status='open')`)
    .bind(runoffId,member.id,claim,runoffId,id));
  try{
    const results=await c.env.DB.batch(statements);
    const finalized=results[results.length-1];
    if(!Number(finalized?.meta?.changes||0)){
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM election_runoff_ballots WHERE runoff_id=? AND ballot_token=?").bind(runoffId,token),
        c.env.DB.prepare("UPDATE election_runoff_voters SET vote_claim=NULL WHERE runoff_id=? AND member_id=? AND vote_claim=?").bind(runoffId,member.id,claim)
      ]).catch(()=>{});
      return c.json({error:"Runoff voting closed while your ballot was being submitted. Please refresh.",code:"RUNOFF_VOTE_CLOSED_DURING_SUBMIT"},409);
    }
  }catch(e){await c.env.DB.prepare("UPDATE election_runoff_voters SET vote_claim=NULL WHERE runoff_id=? AND member_id=? AND vote_claim=?").bind(runoffId,member.id,claim).run().catch(()=>{});throw e}
  return c.json({ok:true,submitted:true});
});

electionsRoute.post("/:id/certify", requireElectionsCertify, async c=>{
  await processElectionLifecycle(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404);
  if(before.status!=="closed")return c.json({error:"Close the election before certification"},409);
  if(before.certified_at)return c.json({error:"Results are already certified and locked"},409);
  const calculated=await calculateElectionResults(c.env,id);
  if(calculated.unresolved.length)return c.json({error:"Resolve all tied seats with runoff voting before certification",unresolved_ties:calculated.unresolved},409);

  const certificationClaim=await c.env.DB.prepare("UPDATE elections SET certified_at=datetime('now'),certified_by=? WHERE id=? AND status='closed' AND certified_at IS NULL")
    .bind(admin.id,id).run();
  if(!certificationClaim.meta.changes){
    return c.json({error:"Election was already certified or changed while you were certifying it",code:"ELECTION_CERTIFICATION_CHANGED"},409);
  }
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  const elected=await assignCertifiedExcoRoles(c.env,after,calculated.results,after.certified_at);
  const excoTerm=await createExcoTermHandover(c.env,after,after.certified_at);
  await auditEntity(c.env,admin.id,"election_results_certified","election",id,before,{...after,assigned_roles:elected.map((x:any)=>({member_id:x.member_id,role_title:x.role_title})),exco_term_id:excoTerm?.id||null});
  await auditEntity(c.env,admin.id,"exco_term_started","exco_term",Number(excoTerm?.id||0),null,{election_id:id,term:after.term||null,handover_id:excoTerm?.handover_id||null});

  const brand=await getBranding(c.env);
  const certificationDelivery=await notifyEligible(c.env,after,`🏆 <b>${brand.fund_name} · ${after.title}</b>\n\nElection results have been certified. The official EXCO list is now available in the Mini App.`).catch(()=>({sent:0,failed:0}));
  await recordElectionNotification(c.env,id,"results_certified","eligible_voters",certificationDelivery,{certified_at:after.certified_at},admin.id);
  const electedMembers=await c.env.DB.prepare(`SELECT x.role_title,m.telegram_id,m.name FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id WHERE x.election_id=? AND x.ended_at IS NULL`).bind(id).all<any>();
  const roleDeliveries=await Promise.allSettled((electedMembers.results as any[]).filter((m:any)=>m.telegram_id).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🎉 <b>${brand.fund_name} · EXCO</b>\n\nCongratulations ${m.name}. You have been officially assigned as <b>${m.role_title}</b> after certification of ${after.title}.`
  )));
  const roleDelivery={sent:roleDeliveries.filter((r:any)=>r.status==="fulfilled").length,failed:roleDeliveries.filter((r:any)=>r.status==="rejected").length};
  await recordElectionNotification(c.env,id,"elected_roles_assigned","elected_members",roleDelivery,{roles:elected.length},admin.id);
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
  statements.push(c.env.DB.prepare(`UPDATE election_voters SET voted_at=datetime('now'),vote_claim=NULL
    WHERE election_id=? AND member_id=? AND voted_at IS NULL AND vote_claim=?
      AND EXISTS (SELECT 1 FROM elections e WHERE e.id=? AND e.status='open')`)
    .bind(id,member.id,claim,id));
  try{
    const results=await c.env.DB.batch(statements);
    const finalized=results[results.length-1];
    if(!Number(finalized?.meta?.changes||0)){
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM election_ballots WHERE election_id=? AND ballot_token=?").bind(id,token),
        c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim)
      ]).catch(()=>{});
      return c.json({error:"Voting closed while your ballot was being submitted. Please refresh.",code:"ELECTION_VOTE_CLOSED_DURING_SUBMIT"},409);
    }
  }catch(e){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run().catch(()=>{});throw e;}
  return c.json({ok:true,submitted:true});
});

}
