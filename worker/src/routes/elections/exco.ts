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
  buildElectionSummary, memberForUser, electionDeleteEligibility, electionDetail,
  ensureElectionAdminRoleSchema, activateElectionAdminRolesForHandover
} from "../../elections/core";

export function registerElectionExcoRoutes(electionsRoute: Hono<AppEnv>) {
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

electionsRoute.get("/exco/handover/current", requireElectionsManage, async c=>{
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
  await ensureElectionAdminRoleSchema(c.env);
  const incomingRoles=await c.env.DB.prepare(`SELECT x.role_title,m.name,m.member_code,m.id member_id,
      l.role_kind,l.builtin_role,l.custom_role_id,l.role_name_snapshot,
      CASE WHEN ea.status='active' THEN 'active' WHEN l.position_id IS NOT NULL THEN 'pending' ELSE 'not_linked' END admin_access_status
    FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id
    LEFT JOIN election_position_admin_roles l ON l.position_id=x.position_id
    LEFT JOIN election_admin_assignments ea ON ea.election_id=x.election_id AND ea.position_id=x.position_id AND ea.member_id=x.member_id AND ea.status='active'
    WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(term.election_id).all<any>();
  const outgoingRoles=outgoing?await c.env.DB.prepare(`SELECT x.role_title,m.name,m.member_code FROM exco_role_assignments x
    JOIN members m ON m.id=x.member_id WHERE x.election_id=? ORDER BY x.position_id,x.id`).bind(outgoing.election_id).all<any>():{results:[]};
  const complete=(items.results as any[]).filter((x:any)=>Number(x.completed)===1).length;
  return c.json({
    current_term:term,outgoing_term:outgoing,handover,
    items:items.results,
    progress:{completed:complete,total:items.results.length,percent:items.results.length?Math.round((complete/items.results.length)*100):0},
    incoming_roles:incomingRoles.results,outgoing_roles:outgoingRoles.results,
    permissions_note:handover?.status==="completed"
      ? "Election-linked Admin Roles are active. Super Admin access is never assigned by elections."
      : "Election-linked Admin Roles activate only when the EXCO handover is completed. Super Admin is excluded."
  });
});

electionsRoute.patch("/exco/handover/:handoverId/items/:itemId", requireElectionsManage, async c=>{
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
  const update=await c.env.DB.prepare(`UPDATE exco_handover_items SET completed=?,note=?,
    completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,datetime('now')) ELSE NULL END,
    completed_by=CASE WHEN ?=1 THEN ? ELSE NULL END
    WHERE id=? AND handover_id=?
      AND EXISTS(SELECT 1 FROM exco_handover_records h WHERE h.id=? AND h.status<>'completed')`)
    .bind(completed,note,completed,completed,admin.id,itemId,handoverId,handoverId).run();
  if(Number(update.meta?.changes||0)===0)
    return c.json({error:"Handover changed while you were editing it. Refresh and try again",code:"HANDOVER_CHANGED"},409);
  const counts=await c.env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END) done
    FROM exco_handover_items WHERE handover_id=?`).bind(handoverId).first<any>();
  const status=Number(counts?.done||0)>0?"in_progress":"pending";
  await c.env.DB.prepare("UPDATE exco_handover_records SET status=?,updated_at=datetime('now') WHERE id=? AND status<>'completed'").bind(status,handoverId).run();
  const after=await c.env.DB.prepare("SELECT * FROM exco_handover_items WHERE id=?").bind(itemId).first<any>();
  await auditEntity(c.env,admin.id,"exco_handover_item_updated","exco_handover_item",itemId,before,{...after,handover_id:handoverId});
  return c.json({ok:true,item:after,progress:{completed:Number(counts?.done||0),total:Number(counts?.total||0)}});
});

electionsRoute.post("/exco/handover/:handoverId/complete", requireElectionsManage, async c=>{
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
  const finalized=await c.env.DB.prepare(`UPDATE exco_handover_records SET status='completed',notes=?,completed_at=datetime('now'),
    completed_by=?,updated_at=datetime('now')
    WHERE id=? AND status<>'completed'
      AND EXISTS(SELECT 1 FROM exco_handover_items i WHERE i.handover_id=exco_handover_records.id)
      AND NOT EXISTS(SELECT 1 FROM exco_handover_items i WHERE i.handover_id=exco_handover_records.id AND i.completed<>1)`)
    .bind(notes,admin.id,handoverId).run();
  if(Number(finalized.meta?.changes||0)===0){
    const current=await c.env.DB.prepare("SELECT status FROM exco_handover_records WHERE id=?").bind(handoverId).first<any>();
    if(current?.status==="completed")return c.json({error:"Handover is already completed"},409);
    return c.json({error:"Handover checklist changed while finalizing. Refresh and verify every item",code:"HANDOVER_CHANGED"},409);
  }
  let adminAccess:any={activated:0,ended:0,retained_super_admins:0,linked_positions:0};
  try{
    adminAccess=await activateElectionAdminRolesForHandover(c.env,handoverId,admin.id);
  }catch(e:any){
    // Reopen the handover if Admin Role activation could not be completed safely.
    await c.env.DB.prepare("UPDATE exco_handover_records SET status='in_progress',completed_at=NULL,completed_by=NULL WHERE id=?").bind(handoverId).run();
    return c.json({error:e?.message||"Admin Role activation failed. Handover was not finalized.",code:"HANDOVER_ADMIN_ACCESS_FAILED"},409);
  }
  const after=await c.env.DB.prepare("SELECT * FROM exco_handover_records WHERE id=?").bind(handoverId).first<any>();
  await auditEntity(c.env,admin.id,"exco_handover_completed","exco_handover",handoverId,handover,{...after,admin_access:adminAccess});
  return c.json({ok:true,handover:after,admin_access:adminAccess});
});

electionsRoute.get("/exco/workboard", requireElectionsManage, async c=>{
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

electionsRoute.post("/exco/responsibilities", requireElectionsManage, async c=>{
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

electionsRoute.patch("/exco/responsibilities/:id", requireElectionsManage, async c=>{
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

electionsRoute.get("/exco/responsibilities/:id/history", requireElectionsManage, async c=>{
  const id=Number(c.req.param("id"));
  const rows=await c.env.DB.prepare(`SELECT h.*,a.name admin_name FROM exco_responsibility_history h
    LEFT JOIN admins a ON a.id=h.admin_id WHERE h.responsibility_id=? ORDER BY h.id DESC`).bind(id).all<any>();
  return c.json({history:rows.results});
});


}
