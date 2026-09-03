import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { LoadingState } from "../../components/Shared";

export function MemberMeetings() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const load = ({ silent = false } = {}) => {
    if (!silent) { setRows(null); setError(""); }
    return api.myMeetings().then(setRows).catch((e) => { if (!silent) setError(e?.message || "Could not load meetings"); });
  };
  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(() => load({ silent: true })), []);
  const rsvp = async (id, response) => {
    setBusyId(id); setError("");
    try { await api.rsvpMeeting(id, response); await load({ silent: true }); }
    catch (e) { setError(e?.message || "Could not save RSVP"); }
    finally { setBusyId(null); }
  };
  if (error && rows === null) return <div className="sans" style={{color:"var(--danger)",background:"var(--danger-bg)",border:"1px solid var(--danger-border)",padding:12,borderRadius:10}}>{error}</div>;
  if (rows === null) return <LoadingState>Loading meetings…</LoadingState>;
  return <>
    <div className="sans" style={{fontSize:15,fontWeight:700,color:"var(--primary-text)",marginBottom:3}}>Meetings</div>
    <div className="sans" style={{fontSize:11,color:"var(--soft)",marginBottom:13}}>Invitations, RSVP, minutes and decisions</div>
    {error && <div className="sans" style={{fontSize:11,color:"var(--danger)",marginBottom:10}}>{error}</div>}
    {rows.map((m) => <div key={m.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:9}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:17,fontWeight:600}}>{m.title}</div>
          <div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>{m.meeting_date} · {m.meeting_time}{m.venue ? ` · ${m.venue}` : ""}</div>
        </div>
        <span className="sans" style={{fontSize:10,padding:"5px 8px",borderRadius:14,background:m.status==="cancelled"?"var(--danger-bg)":"var(--success-bg)",color:m.status==="cancelled"?"var(--danger)":"var(--success-strong)"}}>{m.status || "upcoming"}</span>
      </div>
      {m.agenda && <div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:10,lineHeight:1.45}}>Agenda: {m.agenda}</div>}
      {m.cancel_reason && <div className="sans" style={{fontSize:11,color:"var(--danger)",marginTop:8}}>Cancelled: {m.cancel_reason}</div>}
      {m.status !== "cancelled" && <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:12}}>
        {[['yes','Going'],['maybe','Maybe'],['no','Decline']].map(([value,label]) => <button key={value} type="button" disabled={busyId===m.id} onClick={()=>rsvp(m.id,value)} style={{background:m.rsvp===value?"var(--primary)":"var(--button-soft)",color:m.rsvp===value?"var(--on-primary)":"var(--muted)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 6px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{label}</button>)}
      </div>}
      {(m.minutes || m.decisions) && <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid var(--divider-2)"}}>
        {m.minutes && <div className="sans" style={{fontSize:11,lineHeight:1.5,color:"var(--muted)",marginBottom:m.decisions?8:0}}><b style={{color:"var(--text)"}}>Minutes:</b> {m.minutes}</div>}
        {m.decisions && <div className="sans" style={{fontSize:11,lineHeight:1.5,color:"var(--muted)"}}><b style={{color:"var(--text)"}}>Decisions:</b> {m.decisions}</div>}
      </div>}
    </div>)}
    {!rows.length && <div className="sans" style={{fontSize:12,color:"var(--soft)"}}>No meetings yet.</div>}
  </>;
}

