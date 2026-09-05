import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance } from "../auth";
import { currentDate, generateTxnId } from "../db";
import { auditEntity, ensureOperationalSchema, requireOpenMonth } from "../ops";
import { boundedText, money, validDate, validMonth } from "../validation";
import { downloadTelegramFile, sendDocument, sendStoredDocument } from "../telegram";

export const donationsRoute=new Hono<AppEnv>();

const DONATION_DOCUMENT_MAX_BYTES=20*1024*1024;
const ALLOWED_DONATION_DOCUMENT_TYPES=new Set([
  "application/pdf","image/jpeg","image/png","image/webp",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain"
]);
const DONATION_DOC_TYPES=new Set(["Payment Slip","Receipt","Donor Letter","Agreement","Other"]);

function safeDonationFilename(name:string){
  const clean=String(name||"document").replace(/[\\/:*?"<>|\u0000-\u001f]+/g,"-").trim().slice(0,180);
  return clean||"document";
}

async function donationProject(c:any,projectId:any){
  if(projectId===null||projectId===undefined||projectId==='')return null;
  const id=Number(projectId); if(!Number.isInteger(id)||id<=0)return null;
  return c.env.DB.prepare("SELECT id,project_code,name,status FROM projects WHERE id=?").bind(id).first<any>();
}

async function donationMember(c:any,memberId:any){
  if(memberId===null||memberId===undefined||memberId==='')return null;
  const id=Number(memberId); if(!Number.isInteger(id)||id<=0)return null;
  return c.env.DB.prepare("SELECT id,member_code,name FROM members WHERE id=?").bind(id).first<any>();
}

donationsRoute.get("/",requireAdmin,async c=>{
  await ensureOperationalSchema(c.env);
  const month=String(c.req.query("month")||"").trim();
  const status=String(c.req.query("status")||"").trim();
  const q=String(c.req.query("q")||"").trim().slice(0,100);
  const documents=String(c.req.query("documents")||"").trim();
  if(month&&!validMonth(month))return c.json({error:"Month must use YYYY-MM"},400);
  if(status&&!['active','reversed','voided'].includes(status))return c.json({error:"Invalid donation status"},400);
  if(documents&&!['with','without'].includes(documents))return c.json({error:"Invalid documents filter"},400);
  const where:string[]=[]; const vals:any[]=[];
  if(month){where.push("d.transaction_month=?");vals.push(month);}
  if(status){where.push("d.status=?");vals.push(status);}
  if(q){where.push("(d.donor_name LIKE ? OR d.txn_id LIKE ? OR d.note LIKE ? OR p.name LIKE ?)");const like=`%${q}%`;vals.push(like,like,like,like);}
  if(documents==='with')where.push("EXISTS (SELECT 1 FROM donation_documents dd WHERE dd.donation_id=d.id AND dd.removed_at IS NULL)");
  if(documents==='without')where.push("NOT EXISTS (SELECT 1 FROM donation_documents dd WHERE dd.donation_id=d.id AND dd.removed_at IS NULL)");
  const rows=await c.env.DB.prepare(`SELECT d.*,p.project_code,p.name project_name,m.member_code,m.name member_name,
      la.name logged_by_name,ea.name edited_by_name,
      (SELECT COUNT(*) FROM donation_documents dd WHERE dd.donation_id=d.id AND dd.removed_at IS NULL) document_count
    FROM donations d
    LEFT JOIN projects p ON p.id=d.project_id
    LEFT JOIN members m ON m.id=d.member_id
    LEFT JOIN admins la ON la.id=d.logged_by
    LEFT JOIN admins ea ON ea.id=d.edited_by
    ${where.length?`WHERE ${where.join(" AND ")}`:""}
    ORDER BY COALESCE(d.donation_date,d.created_at) DESC,d.id DESC LIMIT 500`).bind(...vals).all<any>();
  return c.json(rows.results);
});

donationsRoute.get("/:id",requireAdmin,async c=>{
  await ensureOperationalSchema(c.env);
  const id=Number(c.req.param("id"));
  const row=await c.env.DB.prepare(`SELECT d.*,p.project_code,p.name project_name,m.member_code,m.name member_name,
      la.name logged_by_name,ea.name edited_by_name,
      (SELECT COUNT(*) FROM donation_documents dd WHERE dd.donation_id=d.id AND dd.removed_at IS NULL) document_count
    FROM donations d LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN members m ON m.id=d.member_id
    LEFT JOIN admins la ON la.id=d.logged_by LEFT JOIN admins ea ON ea.id=d.edited_by WHERE d.id=?`).bind(id).first<any>();
  if(!row)return c.json({error:"Donation not found"},404);
  return c.json(row);
});

donationsRoute.post("/",requireFinance,async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!; const b=await c.req.json<any>();
  const donor=boundedText(b.donor_name,120,true); const amount=money(b.amount); const note=boundedText(b.note,1000);
  const donationDate=String(b.donation_date||currentDate(c.env.FUND_TIMEZONE||"Indian/Maldives")).trim();
  if(!donor||amount===null)return c.json({error:'Valid donor name and positive amount are required'},400);
  if(!validDate(donationDate))return c.json({error:'Donation date must use YYYY-MM-DD'},400);
  const month=donationDate.slice(0,7);
  if(b.month&&b.month!==month)return c.json({error:'Donation month must match donation date'},400);
  const requestedMemberId=b.member_id===null||b.member_id===undefined||b.member_id===''?0:Number(b.member_id);
  const requestedProjectId=b.project_id===null||b.project_id===undefined||b.project_id===''?0:Number(b.project_id);
  const idempotencyKey=boundedText(b.idempotency_key,120);
  const idempotencyMatches=(existing:any)=>
    String(existing?.donor_name||'')===donor &&
    Number(existing?.amount||0)===Number(amount) &&
    String(existing?.donation_date||'')===donationDate &&
    Number(existing?.member_id||0)===requestedMemberId &&
    Number(existing?.project_id||0)===requestedProjectId &&
    String(existing?.note||'')===String(note||'');
  // Exact idempotent retries return the original transaction before re-checking
  // mutable current-state rules such as month closure or project lifecycle.
  if(idempotencyKey){
    const existing=await c.env.DB.prepare("SELECT id,txn_id,status,donor_name,member_id,project_id,amount,note,donation_date FROM donations WHERE idempotency_key=?").bind(idempotencyKey).first<any>();
    if(existing){
      if(!idempotencyMatches(existing))return c.json({error:'This request key was already used for a different donation. Refresh and submit again.',code:'IDEMPOTENCY_KEY_REUSED'},409);
      return c.json({id:existing.id,txn_id:existing.txn_id,status:existing.status,project_id:existing.project_id,idempotent:true},200);
    }
  }
  try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}
  const member=await donationMember(c,b.member_id); if(b.member_id!=null&&b.member_id!==''&&!member)return c.json({error:'Member not found'},404);
  const project=await donationProject(c,b.project_id); if(b.project_id!=null&&b.project_id!==''&&!project)return c.json({error:'Project not found'},404);
  if(project&&!['planned','active'].includes(String(project.status)))return c.json({error:'Donations can only be linked to planned or active projects'},409);
  const txn=await generateTxnId(c.env,"D");
  let r:any;
  try{
    r=await c.env.DB.prepare("INSERT INTO donations(txn_id,donor_name,member_id,project_id,amount,note,logged_by,transaction_month,status,donation_date,idempotency_key) VALUES(?,?,?,?,?,?,?,?, 'active',?,?)")
      .bind(txn,donor,member?.id??null,project?.id??null,amount,note||null,admin.id,month,donationDate,idempotencyKey||null).run();
  }catch(error){
    if(idempotencyKey){
      const existing=await c.env.DB.prepare("SELECT id,txn_id,status,donor_name,member_id,project_id,amount,note,donation_date FROM donations WHERE idempotency_key=?").bind(idempotencyKey).first<any>();
      if(existing){
        if(!idempotencyMatches(existing))return c.json({error:'This request key was already used for a different donation. Refresh and submit again.',code:'IDEMPOTENCY_KEY_REUSED'},409);
        return c.json({id:existing.id,txn_id:existing.txn_id,status:existing.status,project_id:existing.project_id,idempotent:true},200);
      }
    }
    throw error;
  }
  await auditEntity(c.env,admin.id,"donation_created","donation",Number(r.meta.last_row_id),null,{txn_id:txn,donor_name:donor,member_id:member?.id??null,project_id:project?.id??null,amount,note,donation_date:donationDate,month});
  return c.json({id:r.meta.last_row_id,txn_id:txn,project_id:project?.id??null,status:'active'},201);
});

donationsRoute.patch("/:id",requireFinance,async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const b=await c.req.json<any>();
  const before=await c.env.DB.prepare("SELECT * FROM donations WHERE id=?").bind(id).first<any>();
  if(!before)return c.json({error:"Donation not found"},404);
  if(before.status!=='active')return c.json({error:`${String(before.status).replace(/^./,x=>x.toUpperCase())} donations cannot be edited`},409);
  const currentProject=await donationProject(c,before.project_id);
  if(currentProject&&!['planned','active'].includes(String(currentProject.status)))return c.json({error:`Project ${currentProject.project_code} is ${currentProject.status}. Reopen the project before editing this linked donation.`,code:'PROJECT_LOCKED'},409);
  const originalDate=String(before.donation_date||before.created_at||'').slice(0,10);
  const originalMonth=String(before.transaction_month||originalDate.slice(0,7));
  try{await requireOpenMonth(c.env,originalMonth)}catch(e:any){return c.json({error:e.message},409)}
  const donationDate=b.donation_date===undefined?originalDate:String(b.donation_date||'').trim();
  if(!validDate(donationDate))return c.json({error:'Donation date must use YYYY-MM-DD'},400);
  const month=donationDate.slice(0,7);
  if(month!==originalMonth){try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}}
  const donor=boundedText(b.donor_name??before.donor_name,120,true); const amount=money(b.amount??before.amount); const note=boundedText(b.note===undefined?before.note:b.note,1000);
  if(!donor||amount===null)return c.json({error:'Valid donor name and positive amount are required'},400);
  const requestedMember=b.member_id===undefined?before.member_id:b.member_id;
  const member=await donationMember(c,requestedMember); if(requestedMember!=null&&requestedMember!==''&&!member)return c.json({error:'Member not found'},404);
  const requestedProject=b.project_id===undefined?before.project_id:b.project_id;
  const project=await donationProject(c,requestedProject); if(requestedProject!=null&&requestedProject!==''&&!project)return c.json({error:'Project not found'},404);
  if(project&&!['planned','active'].includes(String(project.status))&&Number(project.id)!==Number(before.project_id))return c.json({error:'Donations can only be moved to planned or active projects'},409);
  const changed=await c.env.DB.prepare(`UPDATE donations SET donor_name=?,member_id=?,project_id=?,amount=?,note=?,donation_date=?,transaction_month=?,edited_by=?,updated_at=datetime('now') WHERE id=? AND status='active'`)
    .bind(donor,member?.id??null,project?.id??null,amount,note||null,donationDate,month,admin.id,id).run();
  if(!changed.meta.changes)return c.json({error:'Donation changed before this edit could be saved. Refresh and try again.'},409);
  const after=await c.env.DB.prepare("SELECT * FROM donations WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,"donation_updated","donation",id,before,after);
  return c.json({ok:true,id,txn_id:after.txn_id,status:after.status});
});

// Donation supporting documents are evidence only. They can be attached/viewed even
// after month close because they do not alter the financial transaction itself.
donationsRoute.get("/:id/documents",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const id=Number(c.req.param("id"));
  const exists=await c.env.DB.prepare("SELECT id FROM donations WHERE id=?").bind(id).first();if(!exists)return c.json({error:'Donation not found'},404);
  const rows=await c.env.DB.prepare(`SELECT dd.id,dd.donation_id,dd.original_filename,COALESCE(NULLIF(dd.display_name,''),dd.original_filename) display_name,
      dd.mime_type,dd.file_size,dd.document_type,dd.created_at,a.name uploaded_by_name
    FROM donation_documents dd LEFT JOIN admins a ON a.id=dd.uploaded_by
    WHERE dd.donation_id=? AND dd.removed_at IS NULL ORDER BY dd.created_at DESC,dd.id DESC`).bind(id).all<any>();
  return c.json(rows.results);
});

donationsRoute.post("/:id/documents",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const admin=c.get("admin")!; const id=Number(c.req.param("id"));
  const donation=await c.env.DB.prepare("SELECT id,txn_id,donor_name,amount FROM donations WHERE id=?").bind(id).first<any>();if(!donation)return c.json({error:'Donation not found'},404);
  const form=await c.req.formData(); const value=form.get('file');
  if(!(value instanceof File))return c.json({error:'Choose a document to upload'},400);
  if(value.size<=0)return c.json({error:'The selected document is empty'},400);
  if(value.size>DONATION_DOCUMENT_MAX_BYTES)return c.json({error:'Document is too large. Maximum size is 20 MB'},413);
  const mime=String(value.type||'application/octet-stream').toLowerCase(); if(value.type&&!ALLOWED_DONATION_DOCUMENT_TYPES.has(mime))return c.json({error:'Unsupported document type. Use PDF, image, Word, Excel or text files'},415);
  const filename=safeDonationFilename(value.name); const requestedType=boundedText(form.get('document_type'),60)||'Other';
  const documentType=DONATION_DOC_TYPES.has(requestedType)?requestedType:'Other';
  const caption=`Donation document · ${donation.txn_id||`#${id}`}\n${String(donation.donor_name||'').slice(0,120)} · MVR ${Number(donation.amount||0).toFixed(2)}`;
  const sent:any=await sendDocument(c.env,admin.telegram_id,filename,value,caption); const tgDoc=sent?.result?.document; const fileId=String(tgDoc?.file_id||'');
  if(!fileId)return c.json({error:'Telegram did not return a document reference'},502);
  const result=await c.env.DB.prepare(`INSERT INTO donation_documents
    (donation_id,telegram_file_id,telegram_file_unique_id,telegram_message_id,telegram_chat_id,original_filename,display_name,mime_type,file_size,document_type,uploaded_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,fileId,tgDoc?.file_unique_id||null,Number(sent?.result?.message_id||0)||null,String(sent?.result?.chat?.id??admin.telegram_id),filename,filename,mime,Number(tgDoc?.file_size||value.size||0),documentType,admin.id).run();
  const docId=Number(result.meta.last_row_id);
  await auditEntity(c.env,admin.id,'donation_document_added','donation_document',docId,null,{donation_id:id,txn_id:donation.txn_id,filename,mime_type:mime,file_size:value.size,document_type:documentType});
  return c.json({id:docId,donation_id:id,original_filename:filename,display_name:filename,mime_type:mime,file_size:Number(tgDoc?.file_size||value.size||0),document_type:documentType,created_at:new Date().toISOString()},201);
});

donationsRoute.get("/:id/documents/:docId/file",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const id=Number(c.req.param('id')),docId=Number(c.req.param('docId'));
  const doc=await c.env.DB.prepare("SELECT * FROM donation_documents WHERE id=? AND donation_id=? AND removed_at IS NULL").bind(docId,id).first<any>();if(!doc)return c.json({error:'Document not found'},404);
  const file=await downloadTelegramFile(c.env,String(doc.telegram_file_id));if(!file)return c.json({error:'Could not retrieve document from Telegram'},502);
  const detected=String(file.mime||'').trim(); const stored=String(doc.mime_type||'').trim(); const responseMime=detected&&detected!=='application/octet-stream'?detected:(stored||'application/octet-stream');
  return new Response(file.bytes,{headers:{'Content-Type':responseMime,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(safeDonationFilename(doc.original_filename||'document'))}`,'Cache-Control':'private, no-store'}});
});

donationsRoute.post("/:id/documents/:docId/send-to-telegram",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const admin=c.get('admin')!; const id=Number(c.req.param('id')),docId=Number(c.req.param('docId'));
  const doc=await c.env.DB.prepare(`SELECT dd.*,d.txn_id,d.donor_name FROM donation_documents dd JOIN donations d ON d.id=dd.donation_id WHERE dd.id=? AND dd.donation_id=? AND dd.removed_at IS NULL`).bind(docId,id).first<any>();if(!doc)return c.json({error:'Document not found'},404);
  await sendStoredDocument(c.env,admin.telegram_id,String(doc.telegram_file_id),`Donation document · ${doc.txn_id||`#${id}`} · ${String(doc.donor_name||'').slice(0,120)}`);
  return c.json({ok:true});
});

donationsRoute.patch("/:id/documents/:docId",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const admin=c.get('admin')!; const id=Number(c.req.param('id')),docId=Number(c.req.param('docId'));
  const before=await c.env.DB.prepare("SELECT * FROM donation_documents WHERE id=? AND donation_id=? AND removed_at IS NULL").bind(docId,id).first<any>();if(!before)return c.json({error:'Document not found'},404);
  const body=await c.req.json<any>(); const displayName=body.display_name===undefined?(before.display_name||before.original_filename):boundedText(body.display_name,180,true); const requested=body.document_type===undefined?(before.document_type||'Other'):boundedText(body.document_type,60,true);
  if(!displayName)return c.json({error:'Document label is required'},400); if(!DONATION_DOC_TYPES.has(String(requested)))return c.json({error:'Invalid document type'},400);
  await c.env.DB.prepare("UPDATE donation_documents SET display_name=?,document_type=? WHERE id=? AND donation_id=? AND removed_at IS NULL").bind(displayName,requested,docId,id).run();
  await auditEntity(c.env,admin.id,'donation_document_updated','donation_document',docId,{donation_id:id,display_name:before.display_name||before.original_filename,document_type:before.document_type||null},{donation_id:id,display_name:displayName,document_type:requested});
  return c.json({ok:true,id:docId,display_name:displayName,document_type:requested});
});

donationsRoute.delete("/:id/documents/:docId",requireFinance,async c=>{
  await ensureOperationalSchema(c.env); const admin=c.get('admin')!; const id=Number(c.req.param('id')),docId=Number(c.req.param('docId'));
  const before=await c.env.DB.prepare("SELECT * FROM donation_documents WHERE id=? AND donation_id=? AND removed_at IS NULL").bind(docId,id).first<any>();if(!before)return c.json({error:'Document not found'},404);
  const body=await c.req.json<any>().catch(()=>({}));const reason=boundedText(body.reason,500,true);if(!reason||reason.length<3)return c.json({error:'Removal reason is required'},400);
  const changed=await c.env.DB.prepare("UPDATE donation_documents SET removed_at=datetime('now'),removed_by=?,removal_reason=? WHERE id=? AND donation_id=? AND removed_at IS NULL").bind(admin.id,reason,docId,id).run();if(!changed.meta.changes)return c.json({error:'Document already removed'},409);
  await auditEntity(c.env,admin.id,'donation_document_removed','donation_document',docId,{donation_id:id,filename:before.original_filename,display_name:before.display_name||before.original_filename,document_type:before.document_type},{donation_id:id,removed:true,reason});
  return c.json({ok:true});
});

donationsRoute.delete("/:id",requireFinance,async c=>{
  const admin=c.get("admin")!;const id=Number(c.req.param("id"));const b=await c.req.json().catch(()=>({})) as any;
  const before=await c.env.DB.prepare("SELECT * FROM donations WHERE id=?").bind(id).first<any>();if(!before)return c.json({error:"Not found"},404);
  if(before.status!=='active')return c.json({error:`Donation is already ${before.status}`},409);
  const month=before.transaction_month||before.created_at.slice(0,7);try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}
  const reason=boundedText(b.reason,500)||'Voided by admin';const changed=await c.env.DB.prepare("UPDATE donations SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason=? WHERE id=? AND status='active'").bind(admin.id,reason,id).run();if(!changed.meta.changes)return c.json({error:'Donation already changed'},409);
  const after=await c.env.DB.prepare('SELECT * FROM donations WHERE id=?').bind(id).first<any>();await auditEntity(c.env,admin.id,"donation_voided","donation",id,before,after);return c.json({ok:true});
});
