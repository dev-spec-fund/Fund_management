import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, CheckCircle2, RotateCcw, X, History, WalletCards, Paperclip, ChevronDown } from "lucide-react";
import { api, onDataChange } from "../api";
import { Modal, Field } from "../components/FormControls";
import { LoadingState, EmptyState, MessageBanner, PrimaryButton, smallBtn } from "../components/Shared";
import { fmt } from "../utils/format";
import { todayValue } from "../utils/date";
import Pagination, { pageSlice } from "../components/Pagination";

const FILTERS = [["all","All"],["active","Active"],["planned","Planned"],["completed","Completed"],["cancelled","Cancelled"]];
const isSuper = (admin) => ["owner","super_admin"].includes(admin?.role);
const tone = (status) => status === "active" ? "var(--success-strong)" : status === "planned" ? "var(--warning)" : status === "cancelled" ? "var(--danger)" : "var(--muted)";
const adjustmentStatuses = new Set(["voided","reversed","rejected","cancelled"]);

export default function Projects({ admin }) {
  const [filter,setFilter]=useState("all"), [query,setQuery]=useState(""), [rows,setRows]=useState(null);
  const [selected,setSelected]=useState(null), [showAdd,setShowAdd]=useState(false), [message,setMessage]=useState(""), [error,setError]=useState("");
  const [page,setPage]=useState(1);
  const load=async()=>{setError("");try{setRows(await api.projects.list({status:filter==="all"?"":filter,q:query.trim()}));}catch(e){setError(e.message);setRows([]);}};
  useEffect(()=>{setPage(1);const t=setTimeout(load,220);return()=>clearTimeout(t);},[filter,query]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/projects")||path?.startsWith("/api/expenses")||path?.startsWith("/api/donations"))load();}),[filter,query]);
  const totalSpent=useMemo(()=> (rows||[]).reduce((s,r)=>s+Number(r.spent||0),0),[rows]);
  const projectPage=pageSlice(rows||[],page);
  const saved=async(text)=>{setSelected(null);setShowAdd(false);setMessage(text);await load();};
  return <>
    <div className="page-sticky-controls">
      <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:9}}>
        <div><div style={{fontSize:13,fontWeight:700,color:"var(--primary-text)",letterSpacing:.4}}>PROJECTS</div><div style={{fontSize:10,color:"var(--soft)",marginTop:2}}>{rows?.length||0} projects · Spent MVR {fmt(totalSpent)}</div></div>
        <button type="button" onClick={()=>setShowAdd(true)} style={{...smallBtn("var(--primary-text)"),padding:"8px 11px"}}><Plus size={14}/> New project</button>
      </div>
      <div className="expense-filter-row sans">{FILTERS.map(([v,l])=><button type="button" key={v} onClick={()=>setFilter(v)} className={filter===v?"expense-filter-chip active":"expense-filter-chip"}>{l}</button>)}</div>
      <div className="expense-search sans" style={{marginBottom:14}}><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search project name, code or responsible member"/>{query&&<button type="button" onClick={()=>setQuery("")}><X size={14}/></button>}</div>
    </div>
    <MessageBanner>{message}</MessageBanner><MessageBanner tone="error">{error}</MessageBanner>
    {rows===null?<LoadingState>Loading projects…</LoadingState>:rows.length===0?<EmptyState>No projects found.</EmptyState>:projectPage.rows.map(p=><button type="button" key={p.id} onClick={()=>setSelected(p)} className="expense-row" style={{alignItems:"flex-start"}}>
      <div style={{minWidth:0,textAlign:"left",flex:1}}>
        <div className="sans" style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}><strong style={{fontSize:13}}>{p.name}</strong><span style={{fontSize:9,fontWeight:700,color:tone(p.status),textTransform:"uppercase"}}>{p.status}</span></div>
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:4}}>{p.project_code}{p.responsible_member_name?` · ${p.responsible_member_name}`:""}</div>
        {p.budget!=null?<><div className="sans" style={{fontSize:10,color:"var(--muted)",marginTop:5}}>Budget MVR {fmt(p.budget)} · {Math.max(0,Number(p.budget_used_pct||0)).toFixed(0)}% used</div><Progress value={Number(p.budget_used_pct||0)}/></>:<div className="sans" style={{fontSize:10,color:"var(--muted)",marginTop:5}}>Open-cost project</div>}
        <div className="sans" style={{fontSize:9,color:"var(--primary-text)",marginTop:6,fontWeight:600}}>{Number(p.expense_count||0)} expense{Number(p.expense_count||0)===1?"":"s"} · {Number(p.donation_count||0)} donation{Number(p.donation_count||0)===1?"":"s"} · Tap to view</div>
      </div>
      <div className="sans" style={{textAlign:"right",whiteSpace:"nowrap"}}><div style={{fontSize:9,color:"var(--soft)",textTransform:"uppercase"}}>Spent</div><strong style={{fontSize:13}}>MVR {fmt(p.spent)}</strong>{p.budget!=null&&<div style={{fontSize:9,color:Number(p.remaining_budget)<0?"var(--danger)":"var(--soft)",marginTop:3}}>{Number(p.remaining_budget)<0?`Over MVR ${fmt(Math.abs(p.remaining_budget))}`:`MVR ${fmt(p.remaining_budget)} left`}</div>}</div>
    </button>)}
    <Pagination page={projectPage.page} total={(rows||[]).length} onChange={setPage}/>
    {showAdd&&<ProjectForm admin={admin} onClose={()=>setShowAdd(false)} onSaved={()=>saved("Project created")}/>} 
    {selected&&<ProjectDetails project={selected} admin={admin} onClose={()=>setSelected(null)} onSaved={saved}/>} 
  </>;
}

function ProjectForm({admin,onClose,onSaved,project=null}){
  const [members,setMembers]=useState([]); const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [form,setForm]=useState({name:project?.name||"",description:project?.description||"",budget:project?.budget??"",start_date:project?.start_date||todayValue(),target_end_date:project?.target_end_date||"",responsible_member_id:project?.responsible_member_id||"",status:project?.status||"planned"});
  useEffect(()=>{api.members.list().then(setMembers).catch(()=>{});},[]);
  const locked=project&&["completed","cancelled"].includes(project.status)&&!isSuper(admin);
  const save=async()=>{if(locked)return;if(!form.name.trim())return setError("Project name is required.");setBusy(true);setError("");try{const payload={...form,name:form.name.trim(),description:form.description.trim()||null,budget:form.budget===""?null:Number(form.budget),responsible_member_id:form.responsible_member_id||null,target_end_date:form.target_end_date||null};if(project)await api.projects.update(project.id,payload);else await api.projects.create(payload);await onSaved(project?"Project updated":"Project created");}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal onClose={onClose} closeDisabled={busy} title={project?"Edit project":"New project"}><MessageBanner tone="error">{error}</MessageBanner>
    <Field label="Project name" value={form.name} onChange={v=>setForm({...form,name:v})}/><Field label="Description (optional)" value={form.description} onChange={v=>setForm({...form,description:v})}/>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Budget (optional)</div><input className="sans" type="number" min="0" step="0.01" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})} placeholder="Leave blank for open-cost project" style={inputStyle}/>
    <Field label="Start date" type="date" value={form.start_date} onChange={v=>setForm({...form,start_date:v})}/><Field label="Target end date (optional)" type="date" value={form.target_end_date} onChange={v=>setForm({...form,target_end_date:v})}/>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Responsible member (optional)</div><select className="sans" value={form.responsible_member_id} onChange={e=>setForm({...form,responsible_member_id:e.target.value})} style={inputStyle}><option value="">Not assigned</option>{members.filter(m=>Number(m.active)!==0).map(m=><option key={m.id} value={m.id}>{m.member_code} · {m.name}</option>)}</select>
    <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>Status</div><select className="sans" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} style={inputStyle}><option value="planned">Planned</option><option value="active">Active</option>{project&&<><option value="completed">Completed</option><option value="cancelled">Cancelled</option></>}</select>
    {locked&&<div className="sans" style={{fontSize:10,color:"var(--warning)",marginBottom:10}}>This project is read-only. Only Super Admin can edit or reopen it.</div>}
    <PrimaryButton onClick={busy||locked?undefined:save}>{locked?"Read only":busy?"Saving…":project?"Save changes":"Create project"}</PrimaryButton>
  </Modal>;
}

function ProjectDetails({project,admin,onClose,onSaved}){
  const [data,setData]=useState(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [showDonations,setShowDonations]=useState(true),[showExpenses,setShowExpenses]=useState(true),[showAdjustments,setShowAdjustments]=useState(false),[showHistory,setShowHistory]=useState(false);
  const load=()=>api.projects.get(project.id).then(setData).catch(e=>setError(e.message));
  useEffect(()=>{load();},[project.id]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/projects")||path?.startsWith("/api/expenses")||path?.startsWith("/api/donations"))load();}),[project.id]);
  if(editing)return <ProjectForm admin={admin} project={data||project} onClose={()=>setEditing(false)} onSaved={onSaved}/>;
  const p=data||project;
  const expenses=p.expenses||[];
  const currentExpenses=expenses.filter(e=>!adjustmentStatuses.has(String(e.status)));
  const adjustments=expenses.filter(e=>adjustmentStatuses.has(String(e.status)));
  const donations=p.donations||[];
  const donationTotal=donations.reduce((sum,d)=>sum+Number(d.amount||0),0);
  const expenseTotal=currentExpenses.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const canEdit=!["completed","cancelled"].includes(p.status)||isSuper(admin);
  const changeStatus=async(status)=>{let cancel_reason=null;if(status==="cancelled"){cancel_reason=prompt("Reason for cancelling this project:")||"";if(cancel_reason.trim().length<3)return;}setBusy(true);setError("");try{await api.projects.update(p.id,{status,cancel_reason});await onSaved(status==="active"?"Project reopened/activated":status==="completed"?"Project completed":"Project cancelled");}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal onClose={onClose} closeDisabled={busy} title={`${p.project_code} · ${p.name}`}><MessageBanner tone="error">{error}</MessageBanner>
    <div className="project-detail-summary">
      <div className="project-detail-topline sans">
        <span className="project-status-pill" style={{color:tone(p.status)}}>{String(p.status||"").toUpperCase()}</span>
        {p.responsible_member_name&&<span>{p.responsible_member_name}</span>}
      </div>

      {p.budget==null
        ? <div className="project-open-cost sans"><WalletCards size={14}/> Open-cost project — no budget limit set.</div>
        : <>
            <div className="project-finance-grid">
              <ProjectFinanceMetric label="Budget" value={`MVR ${fmt(p.budget)}`}/>
              <ProjectFinanceMetric label="Spent" value={`MVR ${fmt(p.spent)}`} tone="danger"/>
              <ProjectFinanceMetric label="Remaining" value={`MVR ${fmt(p.remaining_budget)}`} tone={Number(p.remaining_budget)<0?"danger":"success"}/>
            </div>
            <div className="project-budget-progress sans"><span>{Number(p.budget_used_pct||0).toFixed(1)}% used</span>{Number(p.remaining_budget)<0&&<strong>Over budget MVR {fmt(Math.abs(Number(p.remaining_budget)))}</strong>}</div>
            <Progress value={Number(p.budget_used_pct||0)} large/>
          </>}

      <div className="project-detail-meta">
        <Detail label="Start" value={p.start_date||"—"}/><Detail label="Target end" value={p.target_end_date||"—"}/>
      </div>
      {p.cancel_reason&&<Detail label="Cancellation reason" value={p.cancel_reason}/>}
      {p.description&&<div className="sans project-description">{p.description}</div>}
    </div>

    <ProjectSectionHeader
      label="Donations"
      count={donations.length}
      total={`MVR ${fmt(donationTotal)}`}
      open={showDonations}
      onClick={()=>setShowDonations(v=>!v)}
    />
    {showDonations&&(donations.length===0
      ? <div className="sans project-section-empty">No project donations yet.</div>
      : donations.map(d=><div key={d.id} className="project-transaction-row"><div className="sans project-transaction-main"><b>{d.donor_name}</b><div>{d.transaction_month} · {d.txn_id}{d.note?` · ${d.note}`:""}</div></div><b className="sans project-transaction-amount success">+ MVR {fmt(d.amount)}</b></div>))}

    <ProjectSectionHeader
      label="Expenses"
      count={currentExpenses.length}
      total={`MVR ${fmt(expenseTotal)}`}
      open={showExpenses}
      onClick={()=>setShowExpenses(v=>!v)}
    />
    {showExpenses&&<ExpenseSection rows={currentExpenses} empty="No project expenses yet."/>}

    {adjustments.length>0&&<>
      <ProjectSectionHeader label="Reversed / voided" count={adjustments.length} open={showAdjustments} onClick={()=>setShowAdjustments(v=>!v)}/>
      {showAdjustments&&<ExpenseSection rows={adjustments} empty="" adjustment/>}
    </>}

    {(p.audit_history||[]).length>0&&<>
      <ProjectSectionHeader icon={<History size={13}/>} label="Project history" count={p.audit_history.length} open={showHistory} onClick={()=>setShowHistory(v=>!v)}/>
      {showHistory&&p.audit_history.map(a=><div key={a.id} className="project-history-row"><div className="sans">{auditLabel(a.action)}</div><div className="sans">{String(a.created_at||"").replace("T"," ").slice(0,16)} · {a.admin_name}{a.before_status&&a.after_status&&a.before_status!==a.after_status?` · ${a.before_status} → ${a.after_status}`:""}</div></div>)}
    </>}

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}>{canEdit&&<button type="button" disabled={busy} onClick={()=>setEditing(true)} style={smallBtn("var(--primary-text)")}><Pencil size={13}/> Edit</button>}{["planned"].includes(p.status)&&<button type="button" disabled={busy} onClick={()=>changeStatus("active")} style={smallBtn("var(--success-strong)")}><CheckCircle2 size={13}/> Activate</button>}{p.status==="active"&&<button type="button" disabled={busy} onClick={()=>changeStatus("completed")} style={smallBtn("var(--success-strong)")}><CheckCircle2 size={13}/> Complete</button>}{!["cancelled"].includes(p.status)&&p.status!=="completed"&&<button type="button" disabled={busy} onClick={()=>changeStatus("cancelled")} style={smallBtn("var(--danger)")}><X size={13}/> Cancel</button>}{["completed","cancelled"].includes(p.status)&&isSuper(admin)&&<button type="button" disabled={busy} onClick={()=>changeStatus("active")} style={smallBtn("var(--primary-text)")}><RotateCcw size={13}/> Reopen</button>}</div>
    {!canEdit&&<div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:10,textAlign:"center"}}>Completed/cancelled projects are read-only. Super Admin can reopen them.</div>}
  </Modal>;
}

function ProjectSectionHeader({label,count,total,open,onClick,icon=null}){return <button type="button" className="project-section-header sans" onClick={onClick}><span className="project-section-label">{icon}{label} <small>{count}</small></span><span className="project-section-right">{total&&<strong>{total}</strong>}<ChevronDown size={15} className={open?"open":""}/></span></button>}
function ExpenseSection({rows,empty,adjustment=false}){return <>{rows.length===0?<div className="sans project-section-empty">{empty}</div>:rows.map(e=><div key={e.id} className="project-transaction-row"><div className="sans project-transaction-main"><b>{e.description}</b><div>{e.expense_date||e.transaction_month} · {e.category}{Number(e.document_count||0) > 0 && <> · <Paperclip size={9} style={{verticalAlign:"-1px"}}/> {e.document_count}</>}</div>{adjustment&&e.void_reason&&<div>Reason: {e.void_reason}</div>}{e.fund_override&&<div className="warning">Fund override recorded</div>}{e.budget_override_reason&&<div className="warning">Budget override recorded</div>}</div><b className={`sans project-transaction-amount${adjustment?" muted":" danger"}`}>MVR {fmt(e.amount)}</b></div>)}</>}
function ProjectFinanceMetric({label,value,tone=""}){return <div className={`sans project-finance-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>}
function Progress({value,large=false}){const pct=Math.max(0,Math.min(100,Number(value||0)));const over=Number(value||0)>100;return <div style={{height:large?7:4,borderRadius:99,background:"var(--divider)",overflow:"hidden",marginTop:large?7:5,marginBottom:large?10:0}}><div style={{height:"100%",width:`${pct}%`,background:over?"var(--danger)":pct>=90?"var(--warning)":"var(--success-strong)",borderRadius:99}}/></div>}
function auditLabel(action){return ({project_created:"Project created",project_updated:"Project details updated",project_completed:"Project completed",project_cancelled:"Project cancelled",project_reopened:"Project reopened"}[action]||String(action||"").replaceAll("_"," "))}
function Detail({label,value}){return <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid var(--divider)",fontSize:12}}><span style={{color:"var(--muted)"}}>{label}</span><strong style={{textAlign:"right"}}>{value}</strong></div>}
const inputStyle={width:"100%",border:"1px solid var(--border-strong)",borderRadius:10,padding:"10px 12px",fontSize:14,marginBottom:12,background:"var(--card)",color:"var(--text)",boxSizing:"border-box"};
