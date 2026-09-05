import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireSuperAdmin } from "../auth";
import { auditEntity, ensureOperationalSchema } from "../ops";
import { sendMessage } from "../telegram";
import { getBranding } from "../db";
import { esc, miniAppUrl, notifyAdmins } from "../botSupport";

import {
  iso, text, localNow, applicationPhase, notifyEligible, recordElectionNotification,
  electionSetupLocked, synchronizeElectionApplications, evaluateElectionReadiness, processElectionLifecycle,
  calculateElectionResults, ensureExcoTerms, createExcoTermHandover, assignCertifiedExcoRoles,
  buildElectionSummary, memberForUser, electionDeleteEligibility, electionDetail
} from "../elections/core";

export const electionsRoute = new Hono<AppEnv>();

electionsRoute.get("/", async c=>{
  await ensureOperationalSchema(c.env);
  await processElectionLifecycle(c.env);
  const member=await memberForUser(c);
  const admin=c.get("admin");
  const rows=await c.env.DB.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id) eligible,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id AND v.voted_at IS NOT NULL) voted,
    (SELECT COUNT(*) FROM election_runoffs r WHERE r.election_id=e.id AND r.status='open') open_runoffs
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
    let my_vote=false,eligible=false,my_application_status:string|null=null;
    if(member){
      const [v,app]=await Promise.all([
        c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(e.id,member.id).first<any>(),
        c.env.DB.prepare(`SELECT status FROM election_applications WHERE election_id=? AND member_id=?
          ORDER BY submitted_at DESC,id DESC LIMIT 1`).bind(e.id,member.id).first<any>()
      ]);
      eligible=!!v; my_vote=!!v?.voted_at; my_application_status=app?.status||null;
    }
    const eligibleCount=Number(e.eligible||0),votedCount=Number(e.voted||0);
    result.push({...e,eligible,my_vote,my_application_status,
      application_phase:applicationPhase(e,localNow(c.env.FUND_TIMEZONE || "Indian/Maldives")),
      turnout:{eligible:eligibleCount,voted:votedCount,percent:eligibleCount>0?Math.round((votedCount/eligibleCount)*1000)/10:0}});
  }
  return c.json(result);
});

electionsRoute.get("/exco/current", async c=>{
  const rows=await c.env.DB.prepare(`SELECT x.*,m.name,m.member_code,e.title election_title
    FROM exco_role_assignments x JOIN members m ON m.id=x.member_id JOIN elections e ON e.id=x.election_id
    WHERE x.ended_at IS NULL ORDER BY x.position_id,x.id`).all<any>();
  return c.json({roles:rows.results});
});

electionsRoute.get("/exco/terms", async c=>{
  await ensureOperationalSchema(c.env);
  await ensureExcoTerms(c.env);
  const rows=await c.env.DB.prepare(`SELECT t.*,e.title election_title,e.certified_at,
    h.id handover_id,h.status handover_status,h.completed_at handover_completed_at
    FROM exco_terms t JOIN elections e ON e.id=t.election_id
    LEFT JOIN exco_handover_records h ON h.incoming_term_id=t.id
    ORDER BY CASE t.status WHEN 'current' THEN 0 ELSE 1 END,t.started_at DESC,t.id DESC`).all<any>();
  const terms:any[]=[];
  for(const term of rows.results as any[]){
    const roles=await c.env.DB.prepare(`SELECT x.role_title,m.name,m.member_code,m.id member_id
      FROM exco_role_assignments x JOIN members m ON m.id=x.member_id
      WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(term.election_id).all<any>();
    terms.push({...term,roles:roles.results});
  }
  return c.json({terms,current:terms.find((x:any)=>x.status==="current")||null,previous:terms.find((x:any)=>x.status!=="current")||null});
});

electionsRoute.get("/exco/handover/current", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  await ensureExcoTerms(c.env);
  const term=await c.env.DB.prepare(`SELECT t.*,e.title election_title,e.certified_at FROM exco_terms t
    JOIN elections e ON e.id=t.election_id WHERE t.status='current' ORDER BY t.id DESC LIMIT 1`).first<any>();
  if(!term)return c.json({handover:null,current_term:null,outgoing_term:null,items:[],incoming_roles:[],outgoing_roles:[]});
  const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(term.election_id).first<any>();
  await createExcoTermHandover(c.env,election,election.certified_at);
  const handover=await c.env.DB.prepare("SELECT * FROM exco_handover_records WHERE incoming_term_id=?").bind(term.id).first<any>();
  const outgoing=handover?.outgoing_term_id?await c.env.DB.prepare(`SELECT t.*,e.title election_title FROM exco_terms t
    JOIN elections e ON e.id=t.election_id WHERE t.id=?`).bind(handover.outgoing_term_id).first<any>():null;
  const items=handover?await c.env.DB.prepare(`SELECT i.*,a.name completed_by_name FROM exco_handover_items i
    LEFT JOIN admins a ON a.id=i.completed_by WHERE i.handover_id=? ORDER BY i.sort_order,i.id`).bind(handover.id).all<any>():{results:[]};
  const incomingRoles=await c.env.DB.prepare(`SELECT x.role_title,m.name,m.member_code FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(term.election_id).all<any>();
  const outgoingRoles=outgoing?await c.env.DB.prepare(`SELECT x.role_title,m.name,m.member_code FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(outgoing.election_id).all<any>():{results:[]};
  const complete=(items.results as any[]).filter((x:any)=>Number(x.completed)===1).length;
  return c.json({
    current_term:term,outgoing_term:outgoing,handover,
    items:items.results,
    progress:{completed:complete,total:items.results.length,percent:items.results.length?Math.round((complete/items.results.length)*100):0},
    incoming_roles:incomingRoles.results,outgoing_roles:outgoingRoles.results,
    permissions_note:"EXCO organizational roles do not grant Admin, Treasurer, Viewer or Super Admin system permissions."
  });
});

electionsRoute.patch("/exco/handover/:handoverId/items/:itemId", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!,handoverId=Number(c.req.param("handoverId")),itemId=Number(c.req.param("itemId"));
  const handover=await c.env.DB.prepare("SELECT * FROM exco_handover_records WHERE id=?").bind(handoverId).first<any>();
  if(!handover)return c.json({error:"Handover record not found"},404);
  if(handover.status==="completed")return c.json({error:"Completed handover is read-only"},409);
  const before=await c.env.DB.prepare("SELECT * FROM exco_handover_items WHERE id=? AND handover_id=?").bind(itemId,handoverId).first<any>();
  if(!before)return c.json({error:"Handover checklist item not found"},404);
  const body=await c.req.json<any>().catch(()=>({}));
  const completed=body.completed===undefined?Number(before.completed):body.completed?1:0;
  const note=body.note===undefined?before.note:text(body.note,500)||null;
  await c.env.DB.prepare(`UPDATE exco_handover_items SET completed=?,note=?,
    completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,datetime('now')) ELSE NULL END,
    completed_by=CASE WHEN ?=1 THEN ? ELSE NULL END WHERE id=? AND handover_id=?`)
    .bind(completed,note,completed,completed,admin.id,itemId,handoverId).run();
  const counts=await c.env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) done
    FROM exco_handover_items WHERE handover_id=?`).bind(handoverId).first<any>();
  const status=Number(counts?.done||0)>0?"in_progress":"pending";
  await c.env.DB.prepare("UPDATE exco_handover_records SET status=?,updated_at=datetime('now') WHERE id=? AND status<>'completed'").bind(status,handoverId).run();
  const after=await c.env.DB.prepare("SELECT * FROM exco_handover_items WHERE id=?").bind(itemId).first<any>();
  await auditEntity(c.env,admin.id,"exco_handover_item_updated","exco_handover_item",itemId,before,{...after,handover_id:handoverId});
  return c.json({ok:true,item:after,progress:{completed:Number(counts?.done||0),total:Number(counts?.total||0)}});
});

electionsRoute.post("/exco/handover/:handoverId/complete", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!,handoverId=Number(c.req.param("handoverId"));
  const handover=await c.env.DB.prepare("SELECT * FROM exco_handover_records WHERE id=?").bind(handoverId).first<any>();
  if(!handover)return c.json({error:"Handover record not found"},404);
  if(handover.status==="completed")return c.json({error:"Handover is already completed"},409);
  const counts=await c.env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) done
    FROM exco_handover_items WHERE handover_id=?`).bind(handoverId).first<any>();
  if(Number(counts?.total||0)===0||Number(counts?.done||0)!==Number(counts?.total||0))
    return c.json({error:"Complete every handover checklist item before finalizing handover"},409);
  const body=await c.req.json<any>().catch(()=>({})); const notes=text(body.notes,1000)||null;
  await c.env.DB.prepare(`UPDATE exco_handover_records SET status='completed',notes=?,completed_at=datetime('now'),
    completed_by=?,updated_at=datetime('now') WHERE id=?`).bind(notes,admin.id,handoverId).run();
  const after=await c.env.DB.prepare("SELECT * FROM exco_handover_records WHERE id=?").bind(handoverId).first<any>();
  await auditEntity(c.env,admin.id,"exco_handover_completed","exco_handover",handoverId,handover,after);
  return c.json({ok:true,handover:after});
});

electionsRoute.get("/exco/workboard", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  await ensureExcoTerms(c.env);
  const term=await c.env.DB.prepare(`SELECT t.*,e.title election_title FROM exco_terms t
    JOIN elections e ON e.id=t.election_id WHERE t.status='current' ORDER BY t.id DESC LIMIT 1`).first<any>();
  if(!term)return c.json({term:null,items:[],summary:{total:0,todo:0,in_progress:0,completed:0,overdue:0,upcoming:0}});
  const now=localNow(c.env.FUND_TIMEZONE || "Indian/Maldives").slice(0,10);
  const rows=await c.env.DB.prepare(`SELECT r.*,m.name owner_name,m.member_code
    FROM exco_responsibilities r LEFT JOIN members m ON m.id=r.owner_member_id
    WHERE r.term_id=? ORDER BY CASE r.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
      CASE WHEN r.due_date IS NULL THEN 1 ELSE 0 END,r.due_date,r.id DESC`).bind(term.id).all<any>();
  const items=(rows.results as any[]).map((r:any)=>({
    ...r,
    overdue:r.status!=="completed"&&!!r.due_date&&r.due_date<now,
    upcoming:r.status!=="completed"&&!!r.due_date&&r.due_date>=now&&r.due_date<=String(new Date(Date.now()+7*86400000).toISOString()).slice(0,10)
  }));
  return c.json({term,items,summary:{
    total:items.length,
    todo:items.filter((x:any)=>x.status==="todo").length,
    in_progress:items.filter((x:any)=>x.status==="in_progress").length,
    completed:items.filter((x:any)=>x.status==="completed").length,
    overdue:items.filter((x:any)=>x.overdue).length,
    upcoming:items.filter((x:any)=>x.upcoming).length
  }});
});

electionsRoute.post("/exco/responsibilities", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  await ensureExcoTerms(c.env);
  const admin=c.get("admin")!,body=await c.req.json<any>().catch(()=>({}));
  const term=await c.env.DB.prepare("SELECT * FROM exco_terms WHERE status='current' ORDER BY id DESC LIMIT 1").first<any>();
  if(!term)return c.json({error:"No current EXCO term"},409);
  const title=text(body.title,160); if(!title)return c.json({error:"Responsibility title is required"},400);
  const ownerMemberId=body.owner_member_id?Number(body.owner_member_id):null;
  let owner:any=null;
  if(ownerMemberId){
    owner=await c.env.DB.prepare(`SELECT m.id,m.name,x.role_title FROM members m
      JOIN exco_role_assignments x ON x.member_id=m.id
      WHERE m.id=? AND x.election_id=? LIMIT 1`).bind(ownerMemberId,term.election_id).first<any>();
    if(!owner)return c.json({error:"Owner must be a member of the current EXCO"},400);
  }
  const dueDate=body.due_date?String(body.due_date).slice(0,10):null;
  const status=["todo","in_progress","completed"].includes(String(body.status))?String(body.status):"todo";
  const r=await c.env.DB.prepare(`INSERT INTO exco_responsibilities(term_id,owner_member_id,owner_role_title,title,description,due_date,status,completed_at,created_by)
    VALUES(?,?,?,?,?,?,?,CASE WHEN ?='completed' THEN datetime('now') ELSE NULL END,?)`)
    .bind(term.id,ownerMemberId,owner?.role_title||text(body.owner_role_title,120)||null,title,text(body.description,1000)||null,dueDate,status,status,admin.id).run();
  const id=Number(r.meta.last_row_id);
  await c.env.DB.prepare(`INSERT INTO exco_responsibility_history(responsibility_id,action,to_status,note,admin_id)
    VALUES(?, 'created',?,?,?)`).bind(id,status,text(body.note,500)||null,admin.id).run();
  await auditEntity(c.env,admin.id,"exco_responsibility_created","exco_responsibility",id,null,{term_id:term.id,title,owner_member_id:ownerMemberId,status,due_date:dueDate});
  return c.json({ok:true,id},201);
});

electionsRoute.patch("/exco/responsibilities/:id", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!,id=Number(c.req.param("id")),body=await c.req.json<any>().catch(()=>({}));
  const before=await c.env.DB.prepare("SELECT * FROM exco_responsibilities WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Responsibility not found"},404);
  const term=await c.env.DB.prepare("SELECT * FROM exco_terms WHERE id=?").bind(before.term_id).first<any>();
  if(!term||term.status!=="current")return c.json({error:"Completed EXCO term responsibilities are read-only"},409);
  const title=body.title===undefined?before.title:text(body.title,160);
  const description=body.description===undefined?before.description:text(body.description,1000)||null;
  const dueDate=body.due_date===undefined?before.due_date:(body.due_date?String(body.due_date).slice(0,10):null);
  const status=body.status===undefined?before.status:String(body.status);
  if(!["todo","in_progress","completed"].includes(status))return c.json({error:"Invalid responsibility status"},400);
  let ownerMemberId=body.owner_member_id===undefined?before.owner_member_id:(body.owner_member_id?Number(body.owner_member_id):null);
  let ownerRole=before.owner_role_title;
  if(ownerMemberId){
    const owner=await c.env.DB.prepare(`SELECT m.id,x.role_title FROM members m JOIN exco_role_assignments x ON x.member_id=m.id
      WHERE m.id=? AND x.election_id=? LIMIT 1`).bind(ownerMemberId,term.election_id).first<any>();
    if(!owner)return c.json({error:"Owner must be a member of the current EXCO"},400);
    ownerRole=owner.role_title;
  }else ownerRole=null;
  await c.env.DB.prepare(`UPDATE exco_responsibilities SET title=?,description=?,due_date=?,status=?,owner_member_id=?,owner_role_title=?,
    completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,datetime('now')) ELSE NULL END,
    updated_by=?,updated_at=datetime('now') WHERE id=?`)
    .bind(title,description,dueDate,status,ownerMemberId,ownerRole,status,admin.id,id).run();
  if(status!==before.status || body.note){
    await c.env.DB.prepare(`INSERT INTO exco_responsibility_history(responsibility_id,action,from_status,to_status,note,admin_id)
      VALUES(?, 'updated',?,?,?,?)`).bind(id,before.status,status,text(body.note,500)||null,admin.id).run();
  }
  const after=await c.env.DB.prepare("SELECT * FROM exco_responsibilities WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"exco_responsibility_updated","exco_responsibility",id,before,after);
  return c.json({ok:true,item:after});
});

electionsRoute.get("/exco/responsibilities/:id/history", requireSuperAdmin, async c=>{
  const id=Number(c.req.param("id"));
  const rows=await c.env.DB.prepare(`SELECT h.*,a.name admin_name FROM exco_responsibility_history h
    LEFT JOIN admins a ON a.id=h.admin_id WHERE h.responsibility_id=? ORDER BY h.id DESC`).bind(id).all<any>();
  return c.json({history:rows.results});
});

electionsRoute.get("/dashboard", requireSuperAdmin, async c=>{
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

electionsRoute.get("/:id/notifications", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare("SELECT id FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);
  const rows=await c.env.DB.prepare(`SELECT n.*,a.name created_by_name FROM election_notification_log n
    LEFT JOIN admins a ON a.id=n.created_by WHERE n.election_id=?
    ORDER BY n.id DESC LIMIT 50`).bind(id).all<any>();
  const items=(rows.results as any[]).map((n:any)=>({
    ...n,
    detail:(()=>{try{return n.detail?JSON.parse(n.detail):null}catch{return null}})()
  }));
  const totals=items.reduce((acc:any,n:any)=>({sent:acc.sent+Number(n.sent||0),failed:acc.failed+Number(n.failed||0)}),{sent:0,failed:0});
  return c.json({items,totals});
});

electionsRoute.get("/:id/timeline", requireSuperAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const election=await c.env.DB.prepare(`SELECT e.*,creator.name created_by_name,certifier.name certified_by_name
    FROM elections e LEFT JOIN admins creator ON creator.id=e.created_by
    LEFT JOIN admins certifier ON certifier.id=e.certified_by WHERE e.id=?`).bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404);

  const audits=await c.env.DB.prepare(`SELECT a.id,a.action,a.detail,a.created_at,ad.name admin_name
    FROM audit_log a LEFT JOIN admins ad ON ad.id=a.admin_id
    WHERE a.action LIKE 'election_%' OR a.action LIKE 'exco_%'
    ORDER BY a.id ASC LIMIT 1000`).all<any>();
  const relevant=(audits.results as any[]).filter((a:any)=>{
    const d=String(a.detail||"");
    return d.includes(`"entity_id":${id}`)||d.includes(`"election_id":${id}`)||d.includes(`\\"entity_id\\":${id}`)||d.includes(`\\"election_id\\":${id}`);
  });
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
  if(election.closed_at)events.push({type:"milestone",key:"closed",label:"Voting period ended",at:election.closed_at,actor:"System"});
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
  const deliveryResults=await Promise.allSettled(members.results.map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${branding.fund_name} · ${election.title}</b>\n\nVoting is now open. Open the Mini App to cast your secret ballot.`)));
  const delivery={sent:deliveryResults.filter((r:any)=>r.status==="fulfilled").length,failed:deliveryResults.filter((r:any)=>r.status==="rejected").length};
  await recordElectionNotification(c.env,id,"voting_opened","eligible_voters",delivery,{automatic:false},admin.id);
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/close", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="open")return c.json({error:"Election is not open"},409);
  await c.env.DB.prepare("UPDATE elections SET status='closed',closed_at=datetime('now') WHERE id=?").bind(id).run();
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

  // Preserve a minimal audit record before deleting the draft. Member-facing
  // election data is removed by D1 foreign-key cascades, while this audit entry
  // records who removed the unused draft and when.
  await auditEntity(c.env,admin.id,"election_deleted_unused_draft","election",id,election,{
    deleted:true,title:election.title,term:election.term||null
  });

  const result=await c.env.DB.prepare("DELETE FROM elections WHERE id=? AND status='draft'").bind(id).run();
  if(!result.meta.changes)return c.json({error:"Election could not be deleted"},409);
  return c.json({ok:true,id,title:election.title});
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
      c.executionCtx.waitUntil((async()=>{
        const r=await Promise.allSettled([sendMessage(c.env,member.telegram_id,
          `📝 <b>${esc(election.title)}</b>\n\nYour application for <b>${esc(position.title)}</b> was submitted and is awaiting review.`
        )]);
        await recordElectionNotification(c.env,id,`application_submitted_member:${applicationId}`,"applicant",
          {sent:r.filter((x:any)=>x.status==="fulfilled").length,failed:r.filter((x:any)=>x.status==="rejected").length},
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
    c.executionCtx.waitUntil((async()=>{
      const sent=await Promise.allSettled([sendMessage(c.env,applicant.telegram_id,note)]);
      await recordElectionNotification(c.env,id,`application_${decision}:${applicationId}`,"applicant",
        {sent:sent.filter((x:any)=>x.status==="fulfilled").length,failed:sent.filter((x:any)=>x.status==="rejected").length},
        {application_id:applicationId,decision},admin.id);
    })());
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
  const admin=c.get("admin")!;
  await recordElectionNotification(c.env,id,`manual_voting_reminder:${Date.now()}`,"non_voters",result,{manual:true},admin.id);
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
  const runoffDeliveries=await Promise.allSettled((voters.results as any[]).map((m:any)=>sendMessage(c.env,m.telegram_id,
    `🗳 <b>${brand.fund_name} · Runoff Vote</b>\n\nA runoff is now open for <b>${position?.title||"EXCO position"}</b> in ${election.title}. Open the Mini App to vote.`
  )));
  const runoffDelivery={sent:runoffDeliveries.filter((r:any)=>r.status==="fulfilled").length,failed:runoffDeliveries.filter((r:any)=>r.status==="rejected").length};
  await recordElectionNotification(c.env,id,`runoff_opened:${runoffId}`,"runoff_voters",runoffDelivery,{runoff_id:runoffId,position_id:positionId,round_no:tie.round_no},admin.id);
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
  statements.push(c.env.DB.prepare("UPDATE election_voters SET voted_at=datetime('now'),vote_claim=NULL WHERE election_id=? AND member_id=? AND voted_at IS NULL AND vote_claim=?").bind(id,member.id,claim));
  try{await c.env.DB.batch(statements);}catch(e){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run().catch(()=>{});throw e;}
  return c.json({ok:true,submitted:true});
});
