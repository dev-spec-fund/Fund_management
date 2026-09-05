import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireSuperAdmin } from "../auth";
import { auditEntity, ensureOperationalSchema } from "../ops";
import { sendMessage } from "../telegram";
import { getBranding } from "../db";

export const electionsRoute = new Hono<AppEnv>();

const iso = (v:any) => String(v||"").trim().slice(0,19);
const text = (v:any,n=120) => String(v||"").trim().slice(0,n);

async function memberForUser(c:any){
  const user=c.get("telegramUser");
  return c.env.DB.prepare("SELECT id,member_code,name,telegram_id FROM members WHERE telegram_id=? AND active=1 LIMIT 1")
    .bind(String(user?.id||"")).first<any>();
}
async function electionDetail(env:any,id:number){
  const election=await env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return null;
  const [positions,candidates,voters]=await Promise.all([
    env.DB.prepare("SELECT * FROM election_positions WHERE election_id=? ORDER BY sort_order,id").bind(id).all<any>(),
    env.DB.prepare(`SELECT ec.*,m.member_code FROM election_candidates ec LEFT JOIN members m ON m.id=ec.member_id
      WHERE ec.election_id=? ORDER BY ec.position_id,ec.display_name`).bind(id).all<any>(),
    env.DB.prepare("SELECT COUNT(*) eligible,SUM(CASE WHEN voted_at IS NOT NULL THEN 1 ELSE 0 END) voted FROM election_voters WHERE election_id=?").bind(id).first<any>()
  ]);
  return {...election,positions:positions.results.map((p:any)=>({...p,candidates:candidates.results.filter((x:any)=>Number(x.position_id)===Number(p.id))})),turnout:{eligible:Number(voters?.eligible||0),voted:Number(voters?.voted||0)}};
}

electionsRoute.get("/", async c=>{
  await ensureOperationalSchema(c.env);
  const member=await memberForUser(c);
  const admin=c.get("admin");
  const rows=await c.env.DB.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id) eligible,
    (SELECT COUNT(*) FROM election_voters v WHERE v.election_id=e.id AND v.voted_at IS NOT NULL) voted
    FROM elections e
    WHERE ? IS NOT NULL OR e.status<>'draft'
    ORDER BY CASE e.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,e.id DESC`)
    .bind(admin?.id||null).all<any>();
  const result=[];
  for(const e of rows.results as any[]){
    let my_vote=false,eligible=false;
    if(member){
      const v=await c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(e.id,member.id).first<any>();
      eligible=!!v; my_vote=!!v?.voted_at;
    }
    result.push({...e,eligible,my_vote,turnout:{eligible:Number(e.eligible||0),voted:Number(e.voted||0)}});
  }
  return c.json(result);
});

electionsRoute.get("/:id", async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id")); const detail=await electionDetail(c.env,id);
  if(!detail)return c.json({error:"Election not found"},404);
  const member=await memberForUser(c); const admin=c.get("admin");
  let eligible=false,my_vote=false;
  if(member){
    const v=await c.env.DB.prepare("SELECT voted_at FROM election_voters WHERE election_id=? AND member_id=?").bind(id,member.id).first<any>();
    eligible=!!v;my_vote=!!v?.voted_at;
  }
  if(!admin && detail.status==="draft")return c.json({error:"Election not available"},404);
  let results:any[]= [];
  if(detail.status==="closed"){
    const rows=await c.env.DB.prepare(`SELECT b.position_id,b.candidate_id,COUNT(*) votes
      FROM election_ballots b WHERE b.election_id=? GROUP BY b.position_id,b.candidate_id`).bind(id).all<any>();
    results=rows.results;
  }
  return c.json({...detail,eligible,my_vote,results});
});

electionsRoute.post("/", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const body=await c.req.json<any>();
  const title=text(body.title); if(!title)return c.json({error:"Election title is required"},400);
  const r=await c.env.DB.prepare(`INSERT INTO elections(title,term,opens_at,closes_at,status,created_by)
    VALUES(?,?,?,?, 'draft',?)`).bind(title,text(body.term,80)||null,iso(body.opens_at)||null,iso(body.closes_at)||null,admin.id).run();
  const id=Number(r.meta.last_row_id);
  await auditEntity(c.env,admin.id,"election_created","election",id,null,{title,term:body.term||null});
  return c.json(await electionDetail(c.env,id),201);
});

electionsRoute.patch("/:id", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const before=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Election not found"},404); if(before.status!=="draft")return c.json({error:"Only draft elections can be edited"},409);
  const body=await c.req.json<any>(); const title=text(body.title||before.title);
  await c.env.DB.prepare("UPDATE elections SET title=?,term=?,opens_at=?,closes_at=? WHERE id=?")
    .bind(title,text(body.term??before.term,80)||null,iso(body.opens_at??before.opens_at)||null,iso(body.closes_at??before.closes_at)||null,id).run();
  const after=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"election_updated","election",id,before,after);
  return c.json(await electionDetail(c.env,id));
});

electionsRoute.post("/:id/positions", requireSuperAdmin, async c=>{
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const election=await c.env.DB.prepare("SELECT * FROM elections WHERE id=?").bind(id).first<any>();
  if(!election)return c.json({error:"Election not found"},404); if(election.status!=="draft")return c.json({error:"Election is locked"},409);
  const body=await c.req.json<any>(); const title=text(body.title); if(!title)return c.json({error:"Position title is required"},400);
  const seats=Math.max(1,Math.min(20,Number(body.seats)||1)); const maxSelections=Math.max(1,Math.min(seats,Number(body.max_selections)||seats));
  const r=await c.env.DB.prepare("INSERT INTO election_positions(election_id,title,seats,max_selections,sort_order) VALUES(?,?,?,?,?)")
    .bind(id,title,seats,maxSelections,Number(body.sort_order)||0).run();
  await auditEntity(c.env,admin.id,"election_position_added","election_position",Number(r.meta.last_row_id),null,{election_id:id,title,seats,max_selections:maxSelections});
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
  if(!Number(pc?.n)||!Number(cc?.n))return c.json({error:"Add at least one position and candidate before opening"},400);
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

electionsRoute.post("/:id/vote", async c=>{
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
  const positions=await c.env.DB.prepare("SELECT id,max_selections FROM election_positions WHERE election_id=? ORDER BY id").bind(id).all<any>();
  const statements:any[]=[]; const token=crypto.randomUUID();
  for(const p of positions.results as any[]){
    const ids=Array.isArray(selections[String(p.id)])?selections[String(p.id)].map(Number).filter(Number.isInteger):[];
    const unique=[...new Set(ids)];
    if(unique.length>Number(p.max_selections)){await c.env.DB.prepare("UPDATE election_voters SET vote_claim=NULL WHERE election_id=? AND member_id=? AND vote_claim=?").bind(id,member.id,claim).run();return c.json({error:`Too many selections for position ${p.id}`},400);}
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
