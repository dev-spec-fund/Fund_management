import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { LoadingState } from "../../components/Shared";
import { fmt } from "../../utils/format";

export function MyProfile({ member }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const load=({silent=false}={})=>{ if(!silent){setDashboard(null);setError("");} return api.myDashboard().then(setDashboard).catch(e=>{if(!silent)setError(e?.message||"Could not load profile");}); };
  useEffect(()=>{load();},[]);
  useEffect(()=>onDataChange(()=>load({silent:true})),[]);
  if(error && !dashboard) return <div className="sans" style={{color:"var(--danger)",background:"var(--danger-bg)",border:"1px solid var(--danger-border)",padding:12,borderRadius:10}}>{error}</div>;
  if(!dashboard) return <LoadingState>Loading profile…</LoadingState>;
  const m=dashboard.member || member || {};
  const c=dashboard.contribution || {};
  return <>
    <div className="theme-brand-surface" style={{background:"var(--primary)",color:"var(--on-primary)",borderRadius:16,padding:"20px 22px",marginBottom:12}}>
      <div className="sans" style={{fontSize:10,letterSpacing:1.1,opacity:.65}}>MEMBER PROFILE</div>
      <div style={{fontSize:25,fontWeight:600,marginTop:4}}>{m.name || "Member"}</div>
      <div className="sans" style={{fontSize:11,opacity:.72,marginTop:3}}>{m.member_code || "—"}</div>
    </div>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:10}}>
      {[['Phone',m.phone||'Not added'],['Joined',m.joined_at||m.created_at||'—'],['Current month',dashboard.month||'—'],['Monthly contribution',`MVR ${fmt(c.monthly_amount||m.monthly_amount||0)}`],['Paid this month',`MVR ${fmt(c.paid||0)}`],['Remaining',`MVR ${fmt(c.due||0)}`]].map(([label,value])=><div key={label} className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"9px 0",borderBottom:"1px solid var(--divider-2)",fontSize:11}}><span style={{color:"var(--muted)"}}>{label}</span><strong style={{color:"var(--text)",textAlign:"right"}}>{value}</strong></div>)}
      <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,paddingTop:10,fontSize:11}}><span style={{color:"var(--muted)"}}>Status</span><strong style={{color:c.status==="paid"?"var(--success)":c.status==="partial"?"var(--warning)":c.status==="exempt"?"var(--muted)":"var(--danger)",textTransform:"capitalize"}}>{c.status||'—'}</strong></div>
    </div>
    {!!dashboard.pending_payments?.length && <div className="sans" style={{background:"var(--warning-bg)",border:"1px solid var(--warning-border)",color:"var(--warning)",padding:12,borderRadius:10,fontSize:11,marginBottom:10}}>{dashboard.pending_payments.length} payment submission{dashboard.pending_payments.length===1?' is':'s are'} awaiting approval.</div>}
    {dashboard.next_meeting && <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:10}}><div className="sans" style={{fontSize:10,color:"var(--soft)",marginBottom:5}}>NEXT MEETING</div><div style={{fontSize:16,fontWeight:600}}>{dashboard.next_meeting.title}</div><div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{dashboard.next_meeting.meeting_date} · {dashboard.next_meeting.meeting_time}{dashboard.next_meeting.venue?` · ${dashboard.next_meeting.venue}`:''}</div></div>}
  </>;
}
