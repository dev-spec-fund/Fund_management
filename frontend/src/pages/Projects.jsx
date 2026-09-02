import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, CheckCircle2, RotateCcw, X } from "lucide-react";
import { api, onDataChange } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, MessageBanner, PrimaryButton, smallBtn } from "../components/Shared";
import { fmt } from "../utils/format";
import { todayValue } from "../utils/date";

const FILTERS = [["all","All"],["active","Active"],["planned","Planned"],["completed","Completed"],["cancelled","Cancelled"]];
const isSuper = (admin) => ["owner","super_admin"].includes(admin?.role);
const tone = (status) => status === "active" ? "var(--success-strong)" : status === "planned" ? "var(--warning)" : status === "cancelled" ? "var(--danger)" : "var(--muted)";

export default function Projects({ admin }) {
  const [filter,setFilter]=useState("all"), [query,setQuery]=useState(""), [rows,setRows]=useState(null);
  const [selected,setSelected]=useState(null), [showAdd,setShowAdd]=useState(false), [message,setMessage]=useState(""), [error,setError]=useState("");
  const load=async()=>{setError("");try{setRows(await api.projects.list({status:filter==="all"?"":filter,q:query.trim()}));}catch(e){setError(e.message);setRows([]);}};
  useEffect(()=>{const t=setTimeout(load,220);return()=>clearTimeout(t);},[filter,query]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/projects")||path?.startsWith("/api/expenses"))load();}),[filter,query]);
  const totalSpent=useMemo(()=> (rows||[]).reduce((s,r)=>s+Number(r.spent||0),0),[rows]);
  const saved=async(text)=>{setSelected(null);setShowAdd(false);setMessage(text);await load();};
  return <>
    <div className="page-sticky-controls">
      <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:9}}>
        <div><div style={{fontSize:13,fontWeight:700,color:"var(--primary-text)",letterSpacing:.4}}>PROJECTS</div><div style={{fontSize:10,color:"var(--soft)",marginTop:2}}>{rows?.length||0} projects · Spent MVR {fmt(totalSpent)}</div></div>
        <button type="button" onClick={()=>setShowAdd(true)} style={{...smallBtn("var(--primary-text)"),padding:"8px 11px"}}><Plus size={14}/> New project</button>
      </div>
      <div className="expense-filter-row sans">{FILTERS.map(([v,l])=><button type="button" key={v} onClick={()=>setFilter(v)} className={filter===v?"expense-filter-chip active":"expense-filter-chip"}>{l}</button>)}</div>
      <div className="expense-search sans"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search project name or code"/>{query&&<button type="button" onClick={()=>setQuery("")}><X size={14}/></button>}</div>
    </div>
    <MessageBanner>{message}</MessageBanner><MessageBanner tone="error">{error}</MessageBanner>
    {rows===null?<Center>Loading projects…</Center>:rows.length===0?<Center>No projects found.</Center>:rows.map(p=><button type="button" key={p.id} onClick={()=>setSelected(p)} className="expense-row" style={{alignItems:"flex-start"}}>
      <div style={{minWidth:0,textAlign:"left",flex:1}}>
        <div className="sans" style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}><strong style={{fontSize:13}}>{p.name}</strong><span style={{fontSize:9,fontWeight:700,color:tone(p.status),textTransform:"uppercase"}}>{p.status}</span></div>
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:4}}>{p.project_code}{p.responsible_member_name?` · ${p.responsible_member_name}`:""}</div>
        {p.budget!=null&&<div className="sans" style={{fontSize:10,color:"var(--muted)",marginTop:5}}>Budget MVR {fmt(p.budget)} · {Math.max(0,Number(p.budget_used_pct||0)).toFixed(0)}% used</div>}
      </div>
      <div className="sans" style={{textAlign:"right",whiteSpace:"nowrap"}}><div style={{fontSize:9,color:"var(--soft)",textTransform:"uppercase"}}>Spent</div><strong style={{fontSize:13}}>MVR {fmt(p.spent)}</strong>{p.budget!=null&&<div style={{fontSize:9,color:Number(p.remaining_budget)<0?"var(--danger)":"var(--soft)",marginTop:3}}>{Number(p.remaining_budget)<0?`Over MVR ${fmt(Math.abs(p.remaining_budget))}`:`MVR ${fmt(p.remaining_budget)} left`}</div>}</div>
    </button>)}
    {showAdd&&<ProjectForm admin={admin} onClose={()=>setShowAdd(false)} onSaved={()=>saved("Project created")}/>} 
    {selected&&<ProjectDetails project={selected} admin={admin} onClose={()=>setSelected(null)} onSaved={saved}/>} 
  </>;
}

function ProjectForm({admin,onClose,onSaved,project=null}){
  const [members,setMembers]=useState([]); const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [form,setForm]=useState({name:project?.name||"",description:project?.description||"",budget:project?.budget??"",start_date:project?.start_date||todayValue(),target_end_date:project?.target_end_date||"",responsible_member_id:project?.responsible_member_id||"",status:project?.status||"planned"});
  useEffect(()=>{api.members.list().then(setMembers).catch(()=>{});},[]);
  const save=async()=>{if(!form.name.trim())return setError("Project name is required.");setBusy(true);setError("");try{const payload={...form,name:form.name.trim(),description:form.description.trim()||null,budget:form.budget===""?null:Number(form.budget),responsible_member_id:form.responsible_member_id||null,target_end_date:form.target_end_date||null};if(project)await api.projects.update(project.id,payload);else await api.projects.create(payload);await onSaved(project?"Project updated":"Project created");}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal onClose={onClose} title={project?"Edit project":"New project"}><MessageBanner tone="error">{error}</MessageBanner>
    <Field label="Project name" value={form.name} onChange={v=>setForm({...form,name:v})}/><Field label="Description (optional)" value={form.description} onChange={v=>setForm({...form,description:v})}/>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Budget (optional)</div><input className="sans" type="number" min="0" step="0.01" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})} placeholder="Leave blank for open-cost project" style={inputStyle}/>
    <Field label="Start date" type="date" value={form.start_date} onChange={v=>setForm({...form,start_date:v})}/><Field label="Target end date (optional)" type="date" value={form.target_end_date} onChange={v=>setForm({...form,target_end_date:v})}/>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Responsible member (optional)</div><select className="sans" value={form.responsible_member_id} onChange={e=>setForm({...form,responsible_member_id:e.target.value})} style={inputStyle}><option value="">Not assigned</option>{members.filter(m=>Number(m.active)!==0).map(m=><option key={m.id} value={m.id}>{m.member_code} · {m.name}</option>)}</select>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Status</div><select className="sans" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} style={inputStyle}><option value="planned">Planned</option><option value="active">Active</option>{project&&<><option value="completed">Completed</option><option value="cancelled">Cancelled</option></>}</select>
    {project&&["completed","cancelled"].includes(project.status)&&!isSuper(admin)&&<div className="sans" style={{fontSize:10,color:"var(--warning)",marginBottom:10}}>Completed/cancelled projects can only be reopened or edited by Super Admin.</div>}
    <PrimaryButton onClick={busy?undefined:save}>{busy?"Saving…":project?"Save changes":"Create project"}</PrimaryButton>
  </Modal>;
}

function ProjectDetails({project,admin,onClose,onSaved}){
  const [data,setData]=useState(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{api.projects.get(project.id).then(setData).catch(e=>setError(e.message));},[project.id]);
  if(editing)return <ProjectForm admin={admin} project={data||project} onClose={onClose} onSaved={onSaved}/>;
  const p=data||project; const changeStatus=async(status)=>{let cancel_reason=null;if(status==="cancelled"){cancel_reason=prompt("Reason for cancelling this project:")||"";if(cancel_reason.trim().length<3)return;}setBusy(true);setError("");try{await api.projects.update(p.id,{status,cancel_reason});await onSaved(status==="active"?"Project reopened/activated":status==="completed"?"Project completed":"Project cancelled");}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal onClose={onClose} title={`${p.project_code} · ${p.name}`}><MessageBanner tone="error">{error}</MessageBanner>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:12}}>
      <Detail label="Status" value={String(p.status||"").toUpperCase()}/><Detail label="Spent" value={`MVR ${fmt(p.spent)}`}/><Detail label="Budget" value={p.budget==null?"Not set":`MVR ${fmt(p.budget)}`}/>{p.budget!=null&&<><Detail label="Remaining" value={`MVR ${fmt(p.remaining_budget)}`}/><Detail label="Budget used" value={`${Number(p.budget_used_pct||0).toFixed(1)}%`}/></>}<Detail label="Responsible" value={p.responsible_member_name||"Not assigned"}/><Detail label="Start" value={p.start_date||"—"}/><Detail label="Target end" value={p.target_end_date||"—"}/>{p.description&&<div className="sans" style={{fontSize:11,color:"var(--muted)",lineHeight:1.5,marginTop:10}}>{p.description}</div>}
    </div>
    <div className="sans" style={{fontSize:11,fontWeight:700,color:"var(--muted)",margin:"12px 0 7px"}}>PROJECT EXPENSES</div>
    {(p.expenses||[]).length===0?<div className="sans" style={{fontSize:11,color:"var(--soft)",marginBottom:12}}>No expenses linked yet.</div>:(p.expenses||[]).map(e=><div key={e.id} style={{display:"flex",justifyContent:"space-between",gap:10,borderTop:"1px solid var(--divider)",padding:"8px 0"}}><div className="sans" style={{fontSize:11,minWidth:0}}><b>{e.description}</b><div style={{fontSize:9,color:"var(--soft)",marginTop:2}}>{e.expense_date||e.transaction_month} · {e.category} · {String(e.status).toUpperCase()}</div></div><b className="sans" style={{fontSize:11,whiteSpace:"nowrap",color:e.status==="approved"?"var(--danger)":"var(--muted)"}}>MVR {fmt(e.amount)}</b></div>)}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}><button type="button" disabled={busy} onClick={()=>setEditing(true)} style={smallBtn("var(--primary-text)")}><Pencil size={13}/> Edit</button>{["planned"].includes(p.status)&&<button type="button" disabled={busy} onClick={()=>changeStatus("active")} style={smallBtn("var(--success-strong)")}><CheckCircle2 size={13}/> Activate</button>}{p.status==="active"&&<button type="button" disabled={busy} onClick={()=>changeStatus("completed")} style={smallBtn("var(--success-strong)")}><CheckCircle2 size={13}/> Complete</button>}{!["cancelled"].includes(p.status)&&p.status!=="completed"&&<button type="button" disabled={busy} onClick={()=>changeStatus("cancelled")} style={smallBtn("var(--danger)")}><X size={13}/> Cancel</button>}{["completed","cancelled"].includes(p.status)&&isSuper(admin)&&<button type="button" disabled={busy} onClick={()=>changeStatus("active")} style={smallBtn("var(--primary-text)")}><RotateCcw size={13}/> Reopen</button>}</div>
  </Modal>;
}
function Detail({label,value}){return <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid var(--divider)",fontSize:12}}><span style={{color:"var(--muted)"}}>{label}</span><strong style={{textAlign:"right"}}>{value}</strong></div>}
const inputStyle={width:"100%",border:"1px solid var(--border-strong)",borderRadius:10,padding:"10px 12px",fontSize:14,marginBottom:12,background:"var(--card)",color:"var(--text)",boxSizing:"border-box"};
