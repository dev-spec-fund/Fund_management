import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { LoadingState, approveBtn } from "../../components/Shared";

export function MyActions() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const load = ({ silent = false } = {}) => {
    if (!silent) { setRows(null); setError(""); }
    return api.myActions().then(setRows).catch((e)=>{ if(!silent) setError(e?.message || "Could not load action items"); });
  };
  useEffect(()=>{ load(); },[]);
  useEffect(()=>onDataChange(()=>load({silent:true})),[]);
  const done = async (id) => {
    setBusyId(id); setError("");
    try { await api.completeMyAction(id); await load({silent:true}); }
    catch(e){ setError(e?.message || "Could not complete action item"); }
    finally { setBusyId(null); }
  };
  if(error && rows===null) return <div className="sans" style={{color:"var(--danger)",background:"var(--danger-bg)",border:"1px solid var(--danger-border)",padding:12,borderRadius:10}}>{error}</div>;
  if(rows===null) return <LoadingState>Loading action items…</LoadingState>;
  const open=rows.filter(x=>x.status==="open"), completed=rows.filter(x=>x.status!=="open");
  const render=(a)=><div key={a.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:8}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
      <div style={{minWidth:0}}>
        <div className="sans" style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{a.description}</div>
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:4}}>{a.meeting_title}{a.due_date?` · Due ${a.due_date}`:""}</div>
      </div>
      <span className="sans" style={{fontSize:10,color:a.status==="open"?"var(--warning)":"var(--success)",whiteSpace:"nowrap"}}>{a.status}</span>
    </div>
    {a.status==="open" && <button type="button" disabled={busyId===a.id} onClick={()=>done(a.id)} className="sans" style={{...approveBtn,width:"100%",marginTop:10}}>{busyId===a.id?"Saving…":"Mark done"}</button>}
  </div>;
  return <>
    <div className="sans" style={{fontSize:15,fontWeight:700,color:"var(--primary-text)",marginBottom:3}}>My Actions</div>
    <div className="sans" style={{fontSize:11,color:"var(--soft)",marginBottom:13}}>Tasks assigned to you from meetings</div>
    {error && <div className="sans" style={{fontSize:11,color:"var(--danger)",marginBottom:10}}>{error}</div>}
    {open.map(render)}
    {!open.length && <div className="sans" style={{background:"var(--success-bg)",border:"1px solid var(--success-border)",borderRadius:11,padding:13,color:"var(--success-strong)",fontSize:12,marginBottom:14}}>✓ No open action items.</div>}
    {!!completed.length && <><div className="sans" style={{fontSize:11,fontWeight:700,color:"var(--muted)",letterSpacing:.7,margin:"18px 0 8px"}}>COMPLETED</div>{completed.map(render)}</>}
  </>;
}

