import React, { useEffect, useRef, useState } from "react";
import { Eye, FileText, Pencil, Plus, RotateCcw, Send, Tag, Trash2, Paperclip } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../../components/FormControls";
import { MessageBanner, PreviewLoadState, smallBtn } from "../../components/Shared";
import PdfPreview from "../../components/PdfPreview";
import { fmt } from "../../utils/format";
import { adminCan } from "../../utils/permissions";
import { DonationModal } from "./ReportModals";

const DOC_TYPES=["Payment Slip","Receipt","Donor Letter","Agreement","Other"];

export default function DonationDetails({ admin, row, onClose, onSaved }) {
  const [current,setCurrent]=useState(row);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [documents,setDocuments]=useState(null);
  const [docBusy,setDocBusy]=useState(false);
  const [docPreview,setDocPreview]=useState(null);
  const previewRequestRef=useRef(0);
  const [addDocumentType,setAddDocumentType]=useState("Payment Slip");
  const canFinance=adminCan(admin,"finance");

  const refresh=async()=>{try{setCurrent(await api.donations.get(row.id));}catch{} };
  const loadDocuments=async()=>{
    if(!canFinance)return setDocuments([]);
    try{setDocuments(await api.donations.documents(row.id));}catch(e){setError(e.message||"Could not load donation documents");setDocuments([]);}
  };
  useEffect(()=>{refresh();loadDocuments();},[row.id,canFinance]);
  useEffect(()=>()=>{if(docPreview?.url)URL.revokeObjectURL(docPreview.url);},[docPreview]);

  const addDocuments=async(files)=>{
    const selected=Array.from(files||[]).slice(0,10);if(!selected.length)return;
    setDocBusy(true);setError("");
    try{for(const file of selected)await api.donations.uploadDocument(row.id,file,addDocumentType);await loadDocuments();await refresh();}
    catch(e){setError(e.message||"Could not save donation document to Telegram");}
    finally{setDocBusy(false);}
  };
  const openDocument=async(document)=>{
    const requestId=++previewRequestRef.current;
    const name=document.display_name||document.original_filename||"Donation document";
    setDocPreview(previous=>{if(previous?.url)URL.revokeObjectURL(previous.url);return{status:"loading",url:"",name,mime:document.mime_type||"",document};});
    setError("");
    try{
      const blob=await api.donations.downloadDocument(row.id,document.id);
      const url=URL.createObjectURL(blob);
      if(requestId!==previewRequestRef.current){URL.revokeObjectURL(url);return;}
      setDocPreview({status:"ready",url,name,mime:blob.type||document.mime_type||"application/octet-stream",document});
    }catch(e){
      if(requestId!==previewRequestRef.current)return;
      setDocPreview({status:"error",url:"",name,mime:document.mime_type||"",document,error:e.message||"Could not open document"});
    }
  };
  const closePreview=()=>{
    previewRequestRef.current+=1;
    setDocPreview(previous=>{if(previous?.url)URL.revokeObjectURL(previous.url);return null;});
  };
  const sendDocument=async(document)=>{setDocBusy(true);setError("");try{await api.donations.sendDocumentToTelegram(row.id,document.id);}catch(e){setError(e.message||"Could not send document to Telegram");}finally{setDocBusy(false);}};
  const editDocument=async(document)=>{const label=prompt("Document label:",document.display_name||document.original_filename||"");if(label===null||!label.trim())return;const type=prompt(`Document type: ${DOC_TYPES.join(", ")}`,document.document_type||"Other");if(type===null)return;const normalized=DOC_TYPES.find(v=>v.toLowerCase()===type.trim().toLowerCase());if(!normalized)return setError(`Choose: ${DOC_TYPES.join(", ")}.`);setDocBusy(true);try{await api.donations.updateDocument(row.id,document.id,{display_name:label.trim(),document_type:normalized});await loadDocuments();}catch(e){setError(e.message||"Could not update document");}finally{setDocBusy(false);}};
  const removeDocument=async(document)=>{const reason=prompt("Reason for removing this donation document:");if(!reason||reason.trim().length<3)return;setDocBusy(true);try{await api.donations.removeDocument(row.id,document.id,reason.trim());await loadDocuments();await refresh();}catch(e){setError(e.message||"Could not remove document");}finally{setDocBusy(false);}};
  const reverse=async()=>{const reason=prompt("Reason for reversing this donation:");if(!reason||reason.trim().length<3)return;setBusy(true);setError("");try{const result=await api.governance.reverse("donation",row.id,reason.trim());await onSaved(`Donation reversed · ${result.reversal_id}`);onClose();}catch(e){setError(e.message||"Could not reverse donation");}finally{setBusy(false);}};

  if(editing)return <DonationModal row={current} onClose={()=>setEditing(false)} onSaved={async(message)=>{await refresh();await onSaved(message||"Donation updated");setEditing(false);}}/>;
  const d=current||row;
  return <>
    <Modal onClose={onClose} closeDisabled={busy||docBusy} title={d.txn_id||"Donation details"}>
      <MessageBanner tone="error">{error}</MessageBanner>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:14}}>
        <Detail label="Donor" value={d.donor_name}/><Detail label="Amount" value={`MVR ${fmt(d.amount)}`}/><Detail label="Donation date" value={d.donation_date||String(d.created_at||"").slice(0,10)||"—"}/><Detail label="Month" value={d.transaction_month||"—"}/><Detail label="Project" value={d.project_name?`${d.project_code||""} ${d.project_name}`.trim():"None / General fund"}/>{d.member_name&&<Detail label="Member" value={`${d.member_code||""} ${d.member_name}`.trim()}/>}<Detail label="Status" value={String(d.status||"").toUpperCase()}/><Detail label="Logged by" value={d.logged_by_name||`Admin #${d.logged_by}`}/>{d.edited_by_name&&<Detail label="Last edited by" value={d.edited_by_name}/>} {d.note&&<Detail label="Note" value={d.note}/>} {d.void_reason&&<Detail label="Reason" value={d.void_reason}/>} 
      </div>
      {canFinance&&<div className="sans" style={{border:"1px solid var(--border)",borderRadius:12,padding:12,marginBottom:14,background:"var(--card)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:8}}><div style={{fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6}}><Paperclip size={14}/> Supporting documents</div><div style={{display:"flex",gap:6,alignItems:"center"}}><select className="sans" value={addDocumentType} onChange={e=>setAddDocumentType(e.target.value)} disabled={docBusy} style={{border:"1px solid var(--border-strong)",borderRadius:8,padding:"6px 7px",background:"var(--card)",color:"var(--text)",fontSize:10}}>{DOC_TYPES.map(type=><option key={type}>{type}</option>)}</select><label style={{...smallBtn("var(--primary-text)"),cursor:docBusy?"wait":"pointer",padding:"6px 9px"}}><Plus size={12}/> Add<input disabled={docBusy} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{display:"none"}} onChange={e=>{addDocuments(e.target.files);e.target.value="";}}/></label></div></div>
        {documents===null?<div style={{fontSize:11,color:"var(--soft)"}}>Loading documents…</div>:documents.length===0?<div style={{fontSize:11,color:"var(--soft)"}}>No documents attached.</div>:documents.map(document=><div key={document.id} style={{display:"flex",alignItems:"center",gap:8,borderTop:"1px solid var(--divider)",padding:"8px 0"}}><FileText size={15}/><div style={{minWidth:0,flex:1}}><div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{document.display_name||document.original_filename}</div><div style={{fontSize:9,color:"var(--soft)",marginTop:2}}>{document.document_type||"Other"} · {document.uploaded_by_name||"Admin"}{document.file_size?` · ${(Number(document.file_size)/1024/1024).toFixed(Number(document.file_size)>1048576?1:2)} MB`:""}</div></div><button type="button" disabled={docBusy} onClick={()=>openDocument(document)} style={{...smallBtn("var(--primary-text)"),padding:6}}><Eye size={13}/></button><button type="button" disabled={docBusy} onClick={()=>sendDocument(document)} style={{...smallBtn("var(--primary-text)"),padding:6}}><Send size={13}/></button><button type="button" disabled={docBusy} onClick={()=>editDocument(document)} style={{...smallBtn("var(--primary-text)"),padding:6}}><Tag size={13}/></button><button type="button" disabled={docBusy} onClick={()=>removeDocument(document)} style={{...smallBtn("var(--danger)"),padding:6}}><Trash2 size={13}/></button></div>)}
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{d.status==='active'&&<button type="button" disabled={busy} onClick={()=>setEditing(true)} style={smallBtn("var(--primary-text)")}><Pencil size={13}/> Edit</button>}{d.status==='active'&&<button type="button" disabled={busy} onClick={reverse} style={smallBtn("var(--danger)")}><RotateCcw size={13}/> Reverse</button>}</div>
      {d.status!=='active'&&<div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:10,textAlign:"center"}}>Financial details are locked for reversed/voided donations. Supporting documents remain available for audit evidence.</div>}
    </Modal>
    {docPreview&&<Modal onClose={closePreview} title={docPreview.name}><div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:12,padding:8,textAlign:"center"}}>{docPreview.status==="loading"?<PreviewLoadState label={String(docPreview.mime).includes("pdf")?"Loading PDF…":"Loading document…"}/>:docPreview.status==="error"?<PreviewLoadState status="error" error={docPreview.error} onRetry={()=>openDocument(docPreview.document)}/>:String(docPreview.mime).startsWith("image/")?<img src={docPreview.url} alt={docPreview.name} style={{display:"block",width:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:8,background:"#fff"}}/>:String(docPreview.mime).includes("pdf")?<PdfPreview url={docPreview.url} name={docPreview.name} onSend={docPreview.document?()=>sendDocument(docPreview.document):undefined} sendBusy={docBusy}/>:<div className="sans" style={{padding:20,fontSize:11,color:"var(--muted)"}}>Preview is not available for this file type. Use Send to Telegram to open the original.</div>}</div></Modal>}
  </>;
}
function Detail({label,value}){return <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid var(--divider)",fontSize:12}}><span style={{color:"var(--muted)"}}>{label}</span><strong style={{textAlign:"right"}}>{value}</strong></div>}
