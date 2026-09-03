import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, ErrorState } from "../../components/Shared";

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

  if(error && rows===null) return <ErrorState onRetry={()=>load()}>{error}</ErrorState>;
  if(rows===null) return <ActionsSkeleton/>;

  const open=rows.filter(x=>x.status==="open");
  const completed=rows.filter(x=>x.status!=="open");

  return <>
    <div className="member-page-heading">
      <div className="sans">My Actions</div>
      <span className="sans">Tasks assigned to you from meetings</span>
    </div>
    {error && <div className="sans member-inline-error">{error}</div>}

    {open.map((a)=><ActionCard key={a.id} a={a} busy={busyId===a.id} onDone={done}/>)}
    {!open.length && <div className="sans member-actions-all-done"><CheckCircle2 size={16}/> No open action items.</div>}

    {!!completed.length && <>
      <div className="sans member-section-title" style={{marginTop:18}}>COMPLETED</div>
      {completed.map((a)=><ActionCard key={a.id} a={a}/>)}
    </>}
  </>;
}

function ActionCard({a,busy=false,onDone}) {
  const open=a.status==="open";
  const dueTone=open && a.due_date ? dueState(a.due_date) : "normal";
  return <article className={`member-action-card ${open?"open":"done"}`}>
    <div className="member-action-top">
      <div style={{minWidth:0}}>
        <div className="sans member-action-title">{a.description}</div>
        <div className="sans member-action-meeting">{a.meeting_title || "Meeting action"}</div>
      </div>
      <span className={`sans member-action-status ${open?"open":"done"}`}>{open?"Open":"Done"}</span>
    </div>

    {a.due_date && <div className={`sans member-action-due ${dueTone}`}><Clock3 size={13}/> Due {formatDue(a.due_date)}</div>}

    {open && <button type="button" disabled={busy} onClick={()=>onDone?.(a.id)} className="member-action-complete">
      <CheckCircle2 size={15}/>{busy?"Saving…":"Mark as done"}
    </button>}
  </article>;
}

function dueState(value){
  const due=new Date(`${value}T23:59:59`);
  if(Number.isNaN(due.getTime()))return "normal";
  const days=Math.ceil((due-Date.now())/86400000);
  return days<0?"overdue":days<=2?"soon":"normal";
}
function formatDue(value){
  try{const d=new Date(`${value}T00:00:00`);return d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});}catch{return value;}
}
function ActionsSkeleton(){
  return <div aria-label="Loading actions" aria-busy="true"><div className="skeleton-block" style={{width:"35%",height:20,marginBottom:7}}/><div className="skeleton-block" style={{width:"60%",height:11,marginBottom:16}}/>{[1,2,3].map(i=><div key={i} className="skeleton-block" style={{height:105,borderRadius:12,marginBottom:8}}/>)}</div>;
}
