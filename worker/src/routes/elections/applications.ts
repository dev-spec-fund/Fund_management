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

export function registerElectionApplicationRoutes(electionsRoute: Hono<AppEnv>) {
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
    const existing=await c.env.DB.prepare(`SELECT id,status,reviewed_by,review_reason FROM election_applications
      WHERE election_id=? AND position_id=? AND member_id=? LIMIT 1`).bind(id,positionId,member.id).first<any>();
    let applicationId:number;
    let resubmitted=false;
    if(existing){
      const selfWithdrawn=existing.status==="withdrawn" && !existing.reviewed_by && !existing.review_reason;
      if(!selfWithdrawn)return c.json({error:"You have already applied for this position"},409);
      const reopened=await c.env.DB.prepare(`UPDATE election_applications
        SET status='pending',statement=?,submitted_at=datetime('now'),withdrawn_at=NULL,reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL
        WHERE id=? AND election_id=? AND member_id=? AND status='withdrawn' AND reviewed_by IS NULL AND review_reason IS NULL`)
        .bind(statement,existing.id,id,member.id).run();
      if(!reopened.meta.changes)return c.json({error:"Application changed. Refresh and try again.",code:"APPLICATION_RESUBMIT_CHANGED"},409);
      applicationId=Number(existing.id);
      resubmitted=true;
    }else{
      const r=await c.env.DB.prepare(`INSERT INTO election_applications(election_id,position_id,member_id,statement)
        VALUES(?,?,?,?)`).bind(id,positionId,member.id,statement).run();
      applicationId=Number(r.meta.last_row_id);
    }

    if(member.telegram_id){
      c.executionCtx.waitUntil((async()=>{
        const r=await Promise.allSettled([sendMessage(c.env,member.telegram_id,
          `📝 <b>${esc(election.title)}</b>\n\nYour application for <b>${esc(position.title)}</b> was submitted and is awaiting review.`
        )]);
        await recordElectionNotification(c.env,id,`application_submitted_member:${applicationId}`,"applicant",
          {sent:r.filter((x:any)=>x.status==="fulfilled" && x.value?.ok===true).length,failed:r.filter((x:any)=>!(x.status==="fulfilled" && x.value?.ok===true)).length},
          {application_id:applicationId,position_id:positionId});
      })());
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

    c.executionCtx.waitUntil((async()=>{
      const delivery=await notifyAdmins(c.env,adminText,{
        reply_markup:{inline_keyboard:[[{text:"Review Application",web_app:{url:appUrl}}]]}
      }).catch(()=>({sent:0,failed:0,recipients:0}));
      await recordElectionNotification(c.env,id,`new_application_admin:${applicationId}`,"admins",delivery,
        {application_id:applicationId,member_id:member.id,position_id:positionId});
    })());
    await auditEntity(c.env,null,"election_application_admin_notified","election_application",applicationId,null,{
      election_id:id,position_id:positionId,member_id:member.id,status:"pending"
    });

    return c.json({ok:true,id:applicationId,status:"pending",resubmitted},resubmitted?200:201);
  }catch(err:any){
    const message=String(err?.message||err||"");
    if(/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message))
      return c.json({error:"You have already applied for this position"},409);
    throw err;
  }
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

electionsRoute.post("/:id/applications/:applicationId/review", requireElectionsManage, async c=>{
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
  const reviewedAt=new Date().toISOString();
  if(decision==="approved"){
    const claimed=await c.env.DB.prepare(`UPDATE election_applications SET status='approved',reviewed_at=?,reviewed_by=?,review_reason=?,withdrawn_at=NULL WHERE id=? AND election_id=? AND status='pending'`)
      .bind(reviewedAt,admin.id,reason,applicationId,id).run();
    if(!claimed.meta.changes)return c.json({error:"Application review changed. Refresh and try again.",code:"APPLICATION_REVIEW_CHANGED"},409);
    try{
      await c.env.DB.prepare(`INSERT INTO election_candidates(election_id,position_id,member_id,display_name,status,withdrawn_at,withdrawn_by,withdrawal_reason)
        VALUES(?,?,?,?,'active',NULL,NULL,NULL)
        ON CONFLICT(election_id,position_id,member_id) DO UPDATE SET
          display_name=excluded.display_name,status='active',withdrawn_at=NULL,withdrawn_by=NULL,withdrawal_reason=NULL`)
        .bind(id,application.position_id,application.member_id,application.member_name).run();
    }catch(err){
      // Restore only this request's claim if candidate synchronization unexpectedly fails.
      await c.env.DB.prepare(`UPDATE election_applications SET status='pending',reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL
        WHERE id=? AND election_id=? AND status='approved' AND reviewed_by=? AND reviewed_at=?`)
        .bind(applicationId,id,admin.id,reviewedAt).run().catch(()=>null);
      throw err;
    }
  }else{
    const claimed=await c.env.DB.prepare(`UPDATE election_applications SET status='rejected',reviewed_at=?,reviewed_by=?,review_reason=? WHERE id=? AND election_id=? AND status='pending'`)
      .bind(reviewedAt,admin.id,reason,applicationId,id).run();
    if(!claimed.meta.changes)return c.json({error:"Application review changed. Refresh and try again.",code:"APPLICATION_REVIEW_CHANGED"},409);
  }
  await auditEntity(c.env,admin.id,`election_application_${decision}`,"election_application",applicationId,{...application,election_id:id},{...application,election_id:id,status:decision,review_reason:reason});
  const applicant=await c.env.DB.prepare("SELECT telegram_id FROM members WHERE id=?").bind(application.member_id).first<any>();
  const election=await c.env.DB.prepare("SELECT title FROM elections WHERE id=?").bind(id).first<any>();
  if(applicant?.telegram_id){
    const note=decision==="approved"?`✅ <b>${election?.title||"Election"}</b>\n\nYour candidate application has been <b>approved</b>.`:
      `❌ <b>${election?.title||"Election"}</b>\n\nYour candidate application was <b>not approved</b>.${reason?`\nReason: ${reason}`:""}`;
    c.executionCtx.waitUntil((async()=>{
      const sent=await Promise.allSettled([sendMessage(c.env,applicant.telegram_id,note)]);
      await recordElectionNotification(c.env,id,`application_${decision}:${applicationId}`,"applicant",
        {sent:sent.filter((x:any)=>x.status==="fulfilled" && x.value?.ok===true).length,failed:sent.filter((x:any)=>!(x.status==="fulfilled" && x.value?.ok===true)).length},
        {application_id:applicationId,decision},admin.id);
    })());
  }
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/applications/:applicationId/reopen", requireElectionsManage, async c=>{
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

  const reopenClaim=await c.env.DB.prepare(`UPDATE election_applications SET status='pending',reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL,withdrawn_at=NULL
    WHERE id=? AND election_id=? AND status=?`).bind(applicationId,id,application.status).run();
  if(!reopenClaim.meta.changes)return c.json({error:"Application reopen changed. Refresh and try again.",code:"APPLICATION_REOPEN_CHANGED"},409);
  // If the old approved candidacy had been withdrawn, keep the candidate row inactive until Admin approves again.
  await auditEntity(c.env,admin.id,"election_application_reopened","election_application",applicationId,application,{...application,status:"pending",election_id:id});
  if(application.telegram_id)c.executionCtx.waitUntil(sendMessage(c.env,application.telegram_id,
    `🔄 <b>${election.title}</b>\n\nYour application for <b>${application.position_title||"an EXCO position"}</b> has been reopened and is pending review again.`
  ).catch(()=>null));
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/applications/:applicationId/reassign", requireElectionsManage, async c=>{
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

  const reassigned=await c.env.DB.prepare(`UPDATE election_applications SET position_id=?
    WHERE id=? AND election_id=? AND position_id=?`)
    .bind(newPositionId,applicationId,id,application.position_id).run();
  if(!reassigned.meta.changes)return c.json({error:"Application assignment changed. Refresh and try again.",code:"APPLICATION_REASSIGN_CHANGED"},409);

  const statements:any[]=[];
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

electionsRoute.post("/:id/candidates/:candidateId/withdraw", requireElectionsManage, async c=>{
  await processElectionLifecycle(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id")),candidateId=Number(c.req.param("candidateId"));
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  if(await electionSetupLocked(c.env,election))return c.json({error:"Candidate changes are locked after the voter snapshot is created"},409);
  const before=await c.env.DB.prepare("SELECT * FROM election_candidates WHERE id=? AND election_id=?").bind(candidateId,id).first<any>();
  if(!before)return c.json({error:"Candidate not found"},404);
  if(before.status!=="active")return c.json({error:"Candidate is already withdrawn",code:"CANDIDATE_WITHDRAWAL_CHANGED"},409);
  const body=await c.req.json<any>().catch(()=>({})); const reason=text(body.reason,300)||"Withdrawn";
  const claimed=await c.env.DB.prepare(`UPDATE election_candidates SET status='withdrawn',withdrawn_at=datetime('now'),withdrawn_by=?,withdrawal_reason=?
    WHERE id=? AND election_id=? AND status='active'`).bind(admin.id,reason,candidateId,id).run();
  if(!claimed.meta.changes)return c.json({error:"Candidate withdrawal changed. Refresh and try again.",code:"CANDIDATE_WITHDRAWAL_CHANGED"},409);
  await c.env.DB.prepare(`UPDATE election_applications
    SET status='withdrawn',withdrawn_at=datetime('now'),review_reason=?,reviewed_by=?
    WHERE election_id=? AND position_id=? AND member_id=? AND status='approved'`)
    .bind(`Withdrawn by admin: ${reason}`,admin.id,id,before.position_id,before.member_id).run();
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


}
