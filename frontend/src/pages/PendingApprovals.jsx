import React, { useEffect, useRef, useState } from "react";
import { api, onDataChange } from "../api";
import { Modal, Field } from "../components/FormControls";
import { LoadingState, ErrorState, SectionTitle, cardStyle, compactBtn, approveBtn, rejectBtn } from "../components/Shared";
import { formatLocalDateTime } from "../utils/date";
import { fmt } from "../utils/format";

export default function PendingApprovals() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastChecked, setLastChecked] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [reviewSlip, setReviewSlip] = useState(null);
  const [largeSlip, setLargeSlip] = useState(false);
  const slipRequestRef = useRef(0);
  const slipCacheRef = useRef(new Map());

  const load = () => api.admin.pending()
    .then((d) => { setData(d); setLastChecked(new Date()); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(() => load()), []);
  useEffect(() => () => {
    for (const entry of slipCacheRef.current.values()) if(entry?.url) URL.revokeObjectURL(entry.url);
    slipCacheRef.current.clear();
  }, []);

  const loadReviewSlip = async (contribution, force=false) => {
    if(!contribution?.id || !contribution?.member_id || !contribution?.slip_file_id){
      setReviewSlip({status:"missing", contribution});
      return;
    }
    const cached=slipCacheRef.current.get(Number(contribution.id));
    if(cached && !force){
      setReviewSlip({status:"ready",...cached,contribution});
      return;
    }
    const requestId=++slipRequestRef.current;
    setReviewSlip({status:"loading",contribution});
    try{
      const blob=await api.members.contributionSlip(contribution.member_id,contribution.id);
      const url=URL.createObjectURL(blob);
      if(requestId!==slipRequestRef.current){ URL.revokeObjectURL(url); return; }
      if(cached?.url) URL.revokeObjectURL(cached.url);
      const entry={url,mime:blob.type||"image/jpeg",txnId:contribution.txn_id||"Contribution"};
      slipCacheRef.current.set(Number(contribution.id),entry);
      setReviewSlip({status:"ready",...entry,contribution});
    }catch(e){
      if(requestId!==slipRequestRef.current)return;
      setReviewSlip({status:"error",error:e.message||"Could not load payment slip",contribution});
    }
  };

  const openReview = (contribution) => {
    setEditing({...contribution});
    setLargeSlip(false);
    loadReviewSlip(contribution);
  };

  const closeReview = () => {
    slipRequestRef.current+=1;
    setLargeSlip(false);
    setReviewSlip(null);
    setEditing(null);
  };

  if (!data && error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!data) return <LoadingState>Loading approvals…</LoadingState>;

  const registrations = data.registrations || [];
  const contributions = data.contributions || [];
  const count = registrations.length + contributions.length;

  const act = async (fn, key="action") => {
    if(busy)return null;
    try {
      setError(""); setMessage(""); setBusy(key);
      const result=await fn();
      await load();
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy("");
    }
  };

  const finishContribution = async (decision) => {
    const id=editing.id;
    const result=await act(async()=>{
      if(decision==="approved"){
        await api.admin.correctContribution(id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});
        return api.admin.approveContribution(id);
      }
      return api.admin.rejectContribution(id,"Rejected by admin");
    },`contribution-${id}`);
    if(!result)return;
    setData(prev=>prev?{...prev,contributions:(prev.contributions||[]).filter(x=>Number(x.id)!==Number(id)),slips:(prev.slips||[]).filter(x=>Number(x.id)!==Number(id))}:prev);
    closeReview();
    const sync=result.review_messages;
    if(sync?.failed>0)setMessage(`${decision==="approved"?"Contribution approved":"Contribution rejected"} · ${sync.failed} Telegram message${sync.failed===1?"":"s"} could not be updated`);
    else setMessage(`${decision==="approved"?"Contribution approved":"Contribution rejected"} · Telegram review messages updated`);
  };

  const filters = [
    ["all", "All", count],
    ["contributions", "Slips", contributions.length],
    ["registrations", "Members", registrations.length],
  ];

  const showContributions = filter === "all" || filter === "contributions";
  const showRegistrations = filter === "all" || filter === "registrations";
  const checkedLabel = lastChecked
    ? lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return <>
    <div className="sans" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
      <div>
        <div style={{fontWeight:700,fontSize:15}}>Pending approvals</div>
        {count > 0
          ? <div style={{fontSize:11,color:"var(--soft)",marginTop:2}}>{count} item{count===1?"":"s"} waiting</div>
          : <div style={{fontSize:11,color:"var(--success)",marginTop:2}}>All caught up</div>}
      </div>
      <button type="button" onClick={load} aria-label="Refresh approvals"
        style={{...compactBtn,width:36,minWidth:36,height:36,minHeight:36,padding:0,fontSize:17}}>↻</button>
    </div>

    {error && <div className="sans" style={{background:"var(--danger-bg)",color:"var(--danger)",padding:10,borderRadius:10,fontSize:12,marginBottom:12}}>{error}</div>}
    {message && <div className="sans" style={{background:"var(--success-bg)",color:"var(--success)",padding:10,borderRadius:10,fontSize:12,marginBottom:12,fontWeight:600}}>{message}</div>}

    {count === 0 ? (
      <div style={{background:"var(--card)",border:"1px solid var(--success-bg-3)",borderRadius:16,padding:"34px 20px",textAlign:"center",marginTop:18}}>
        <div style={{width:48,height:48,borderRadius:24,background:"var(--success-bg)",color:"var(--success)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,margin:"0 auto 12px"}}>✓</div>
        <div className="sans" style={{fontSize:16,fontWeight:700,color:"var(--primary-text)"}}>All caught up</div>
        <div className="sans" style={{fontSize:12,color:"var(--soft)",lineHeight:1.55,marginTop:6}}>
          No approvals are waiting.<br/>New submissions will appear here.
        </div>
        {checkedLabel && <div className="sans" style={{fontSize:10,color:"var(--soft-4)",marginTop:16}}>Last checked {checkedLabel}</div>}
      </div>
    ) : (
      <>
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:3,marginBottom:16}}>
          {filters.map(([key,label,n]) => (
            <button type="button" key={key} onClick={()=>setFilter(key)} className={filter===key ? "expense-filter-chip active sans" : "expense-filter-chip sans"}>
              {label} {n}
            </button>
          ))}
        </div>

        {showContributions && contributions.length > 0 && <>
          <SectionTitle>CONTRIBUTION SLIPS</SectionTitle>
          {contributions.map((c) => {
            const needsReview = !c.ref_number || !c.bank_date || !Number(c.amount);
            return <div key={c.id} style={{...cardStyle,padding:13}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
                <div style={{minWidth:0}}>
                  <div className="sans" style={{fontWeight:700,fontSize:14}}>{c.member_name}</div>
                  <div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:2}}>{c.member_code || ""}{c.month ? ` · ${c.month}` : ""}</div>
                </div>
                <div className="sans" style={{fontWeight:700,fontSize:14,whiteSpace:"nowrap"}}>MVR {fmt(c.amount)}</div>
              </div>
              <div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:8}}>
                Ref: <b style={{color:c.ref_number?"var(--primary-text)":"var(--danger)"}}>{c.ref_number || "Not detected"}</b>
              </div>
              {c.created_at && <div className="sans" style={{fontSize:10,color:"var(--soft-4)",marginTop:4}}>Submitted {formatLocalDateTime(c.created_at)}</div>}
              <div className="sans" style={{fontSize:10,color:needsReview?"var(--warning-3)":"var(--success)",marginTop:7,fontWeight:600}}>
                {needsReview ? "⚠ OCR needs review" : "✓ OCR details detected"}
              </div>
              {Array.isArray(c.allocation_preview) && c.allocation_preview.length>0 && (
                <div className="sans" style={{background:"var(--bg)",borderRadius:9,padding:9,marginTop:8,fontSize:10,color:"var(--neutral-text-2)"}}>
                  <b style={{color:"var(--primary-text)"}}>Will be applied to</b>
                  {c.allocation_preview.map((a,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                    <span>{a.month}</span><span>MVR {fmt(a.amount)} · {a.status_after==="paid"?"Paid":"Partial"}</span>
                  </div>)}
                </div>
              )}
              <button type="button" onClick={() => openReview(c)}
                style={{...approveBtn,width:"100%",marginTop:10,padding:"9px 10px"}}>
                Review →
              </button>
            </div>;
          })}
        </>}

        {showRegistrations && registrations.length > 0 && <>
          <SectionTitle>NEW MEMBERS</SectionTitle>
          {registrations.map((r) => <div key={r.id} style={{...cardStyle,padding:13}}>
            <div className="sans" style={{fontWeight:700,fontSize:14}}>{r.name}</div>
            <div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>
              {r.username ? `@${r.username}` : "Telegram user"} · {r.telegram_id}
            </div>
            {r.phone && <div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:4}}>Phone: <b style={{color:"var(--text)"}}>{r.phone}</b></div>}
            {(r.requested_at || r.created_at) && <div className="sans" style={{fontSize:10,color:"var(--soft-4)",marginTop:4}}>Submitted {formatLocalDateTime(r.requested_at || r.created_at)}</div>}
            {(r.possible_matches || []).map((m) => <div key={m.id} className="sans"
              style={{fontSize:11,background:"var(--warning-bg)",padding:8,borderRadius:8,marginTop:8}}>
              Possible existing member: <b>{m.member_code}</b> — {m.name}{m.phone ? ` · ${m.phone}` : ""}
              <button type="button" onClick={() => act(() => api.admin.approveRegistration(r.id, m.id))} style={{...compactBtn,marginLeft:7}}>Link & update phone</button>
            </div>)}
            <div style={{display:"flex",gap:7,marginTop:10}}>
              <button type="button" onClick={() => act(() => api.admin.approveRegistration(r.id))} style={{...approveBtn,flex:1}}>Create & approve</button>
              <button type="button" onClick={() => act(() => api.admin.rejectRegistration(r.id, "Rejected by admin"))} style={rejectBtn}>Reject</button>
            </div>
          </div>)}
        </>}

      </>
    )}

    {editing && <Modal title={`Review ${editing.txn_id}`} onClose={closeReview}>
      <div className="sans" style={{fontSize:11,color:"var(--muted)",background:"var(--bg)",padding:9,borderRadius:8,marginBottom:10}}>
        Verify the bank slip details before approval. Correct any OCR mistakes first.
      </div>
      <div className="review-slip-card">
        <div className="sans review-slip-head">
          <span>PAYMENT SLIP</span>
          {reviewSlip?.status==="ready" && <button type="button" onClick={()=>setLargeSlip(true)}>View larger</button>}
        </div>
        {reviewSlip?.status==="loading" ? (
          <div className="review-slip-loading" aria-busy="true">
            <span className="review-slip-spinner" aria-hidden="true"/>
            <div className="sans"><b>Loading slip…</b><span>Fetching securely from Telegram</span></div>
          </div>
        ) : reviewSlip?.status==="error" ? (
          <div className="review-slip-error">
            <div className="sans">{reviewSlip.error}</div>
            <button type="button" onClick={()=>loadReviewSlip(editing,true)} style={compactBtn}>Retry</button>
          </div>
        ) : reviewSlip?.status==="missing" ? (
          <div className="sans review-slip-missing">No payment slip is attached to this contribution.</div>
        ) : reviewSlip?.status==="ready" && String(reviewSlip.mime||"").startsWith("image/") ? (
          <button type="button" className="review-slip-image-button" onClick={()=>setLargeSlip(true)} aria-label="Open larger payment slip preview">
            <img src={reviewSlip.url} alt={`Payment slip ${reviewSlip.txnId || editing.txn_id || ""}`} />
            <span className="sans">Tap image to enlarge</span>
          </button>
        ) : reviewSlip?.status==="ready" ? (
          <div className="sans review-slip-missing">This attachment cannot be previewed as an image.</div>
        ) : null}
      </div>
      <Field label="Amount" type="number" prefix="MVR" value={editing.amount} onChange={(v)=>setEditing({...editing,amount:v})}/>
      <Field label="Bank reference" value={editing.ref_number || ""} onChange={(v)=>setEditing({...editing,ref_number:v})}/>
      <Field label="Bank date (YYYY-MM-DD)" value={editing.bank_date || ""} onChange={(v)=>setEditing({...editing,bank_date:v})}/>
      <Field label="Contribution month (YYYY-MM)" value={editing.month || ""} onChange={(v)=>setEditing({...editing,month:v})}/>
      {Array.isArray(editing.allocation_preview) && editing.allocation_preview.length>0 && <div className="sans" style={{background:"var(--success-bg)",borderRadius:9,padding:10,marginBottom:10,fontSize:11}}>
        <b>Automatic allocation preview</b>
        {editing.allocation_preview.map((a,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:5}}><span>{a.month}</span><span>MVR {fmt(a.amount)} · {a.status_after==="paid"?"Paid":"Partial"}</span></div>)}
      </div>}
      <div style={{display:"flex",gap:8}}>
        <button type="button" style={{...compactBtn,flex:1}} onClick={() => act(async()=>{
          await api.admin.correctContribution(editing.id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});
          closeReview();
        })}>Save correction</button>
        <button type="button" disabled={!!busy} style={{...approveBtn,flex:1,opacity:busy?.7:1}} onClick={() => finishContribution("approved")}>{busy===`contribution-${editing.id}`?"Approving…":"Approve"}</button>
      </div>
      <button type="button" disabled={!!busy} style={{...rejectBtn,width:"100%",marginTop:8,opacity:busy?.7:1}} onClick={() => finishContribution("rejected")}>{busy===`contribution-${editing.id}`?"Working…":"Reject contribution"}</button>
    </Modal>}
    {largeSlip && reviewSlip?.status==="ready" && (
      <Modal title={`Payment slip · ${reviewSlip.txnId || editing?.txn_id || ""}`} onClose={()=>setLargeSlip(false)}>
        <div className="review-slip-large">
          {String(reviewSlip.mime||"").startsWith("image/") ? (
            <img src={reviewSlip.url} alt={`Payment slip ${reviewSlip.txnId || ""}`} />
          ) : (
            <div className="sans review-slip-missing">This attachment cannot be previewed as an image.</div>
          )}
        </div>
      </Modal>
    )}
  </>;
}

