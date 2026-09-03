import React, { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
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

  const load = () => api.admin.pending()
    .then((d) => { setData(d); setLastChecked(new Date()); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(() => load()), []);

  if (!data && error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!data) return <LoadingState>Loading approvals…</LoadingState>;

  const registrations = data.registrations || [];
  const contributions = data.contributions || [];
  const count = registrations.length + contributions.length;

  const act = async (fn) => {
    try {
      setError("");
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    }
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
        style={{...compactBtn,width:34,height:34,padding:0,borderRadius:10,fontSize:17}}>↻</button>
    </div>

    {error && <div className="sans" style={{background:"var(--danger-bg)",color:"var(--danger)",padding:10,borderRadius:10,fontSize:12,marginBottom:12}}>{error}</div>}

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
            <button type="button" key={key} onClick={()=>setFilter(key)} className="sans"
              style={{flex:"0 0 auto",border:`1px solid ${filter===key?"var(--primary)":"var(--border-2)"}`,background:filter===key?"var(--primary)":"var(--card)",color:filter===key?"var(--on-primary)":"var(--muted)",borderRadius:20,padding:"6px 11px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
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
              <button type="button" onClick={() => setEditing({...c})}
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

    {editing && <Modal title={`Review ${editing.txn_id}`} onClose={() => setEditing(null)}>
      <div className="sans" style={{fontSize:11,color:"var(--muted)",background:"var(--bg)",padding:9,borderRadius:8,marginBottom:10}}>
        Verify the bank slip details before approval. Correct any OCR mistakes first.
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
          setEditing(null);
        })}>Save correction</button>
        <button type="button" style={{...approveBtn,flex:1}} onClick={() => act(async()=>{
          await api.admin.correctContribution(editing.id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});
          await api.admin.approveContribution(editing.id);
          setEditing(null);
        })}>Approve</button>
      </div>
      <button type="button" style={{...rejectBtn,width:"100%",marginTop:8}} onClick={() => act(async()=>{
        await api.admin.rejectContribution(editing.id,"Rejected by admin");
        setEditing(null);
      })}>Reject contribution</button>
    </Modal>}
  </>;
}

