import React,{useEffect,useState} from "react";
import { api,onDataChange } from "../api";
import { Modal,Field,useConfirmDialog } from "../components/FormControls";
import { LoadingState,EmptyState,MessageBanner,approveBtn,compactBtn,rejectBtn } from "../components/Shared";

export default function Elections(){
  const [rows,setRows]=useState(()=>api.peekCached("/api/elections"));
  const [members,setMembers]=useState(()=>api.peekCached("/api/members")||[]);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [form,setForm]=useState({title:"",term:"",applications_open_at:"",applications_close_at:"",opens_at:"",closes_at:""});
  const [applicationFilter,setApplicationFilter]=useState("all");
  const [position,setPosition]=useState({title:"",seats:"1",min_selections:"1"});
  const [candidate,setCandidate]=useState({position_id:"",member_id:""});
  const {confirm,confirmationDialog}=useConfirmDialog();

  const load=()=>Promise.all([api.elections.list().then(setRows),api.members.list().then(setMembers)]).catch(e=>setMessage(e.message));
  const open=async(row)=>{setSelected(row);setMessage("");try{setDetail(await api.elections.get(row.id))}catch(e){setMessage(e.message)}};
  useEffect(()=>{load()},[]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/elections"))load()}),[]);

  const create=async()=>{if(!form.title.trim())return setMessage("Election title is required.");setBusy(true);try{const e=await api.elections.create(form);setShowCreate(false);setForm({title:"",term:"",applications_open_at:"",applications_close_at:"",opens_at:"",closes_at:""});await load();await open(e)}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addPosition=async()=>{if(!detail||!position.title.trim())return;setBusy(true);try{const seats=Number(position.seats)||1;const d=await api.elections.addPosition(detail.id,{title:position.title,seats,max_selections:seats,min_selections:Math.max(0,Math.min(seats,Number(position.min_selections)||0))});setDetail(d);setPosition({title:"",seats:"1",min_selections:"1"})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addCandidate=async()=>{if(!detail||!candidate.position_id||!candidate.member_id)return;setBusy(true);try{const d=await api.elections.addCandidate(detail.id,candidate);setDetail(d);setCandidate({position_id:"",member_id:""})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const reviewApplication=async(a,decision)=>{
    const reason=decision==="rejected"?(window.prompt(`Reason for rejecting ${a.member_name}:`)??null):"";
    if(reason===null)return;
    setBusy(true);try{setDetail(await api.elections.reviewApplication(detail.id,a.id,decision,reason));setMessage(`Application ${decision}.`)}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const withdrawCandidate=async(c)=>{
    const reason=window.prompt(`Reason for withdrawing ${c.display_name}:`);
    if(reason===null)return;
    setBusy(true);try{setDetail(await api.elections.withdrawCandidate(detail.id,c.id,reason.trim()||"Withdrawn"));setMessage(`${c.display_name} withdrawn from the election.`)}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const remindNonVoters=async()=>{
    setBusy(true);try{const r=await api.elections.remindNonVoters(detail.id);setMessage(`Voting reminder sent: ${r.sent||0}${r.failed?` · ${r.failed} failed`:""}`)}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const certify=async()=>{
    if(!await confirm({title:"Certify election results?",message:"Certification makes the results final and publishes them to members. Ballots remain secret.",confirmLabel:"Certify results",tone:"primary"}))return;
    setBusy(true);try{setDetail(await api.elections.certify(detail.id));await load();setMessage("Election results certified and published.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };

  const changeStatus=async(action)=>{if(!detail)return;if(!await confirm({title:`${action[0].toUpperCase()+action.slice(1)} election?`,message:action==="open"?"Eligible voters will be snapshotted and Telegram-linked members will be notified.":`Are you sure you want to ${action} this election?`,confirmLabel:action[0].toUpperCase()+action.slice(1),tone:action==="cancel"?"danger":"primary"}))return;setBusy(true);try{const d=await api.elections[action](detail.id);setDetail(d);await load();setMessage(action==="open"?"Election opened. Eligible voters were snapshotted.":action==="close"?"Election closed. Results are now available.":"Election cancelled.")}catch(e){setMessage(e.message)}finally{setBusy(false)}};

  if(rows===null)return <LoadingState>Loading elections…</LoadingState>;
  return <>
    <div className="member-page-heading"><div className="sans">EXCO Elections</div><span className="sans">Secret-ballot executive committee elections</span></div>
    <MessageBanner>{message}</MessageBanner>
    <button type="button" style={{...approveBtn,width:"100%",marginBottom:12}} onClick={()=>setShowCreate(true)}>+ Create election</button>
    {!rows.length?<EmptyState>No elections yet.</EmptyState>:rows.map(e=><button key={e.id} type="button" onClick={()=>open(e)} className="expense-row" style={{alignItems:"center"}}>
      <div style={{minWidth:0,flex:1,textAlign:"left"}}><div className="sans" style={{fontSize:13,fontWeight:750}}>{e.title}</div><div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:3}}>{e.term||"No term"} · {String(e.status).toUpperCase()}</div></div>
      <div className="sans" style={{textAlign:"right"}}><b>{e.turnout?.voted||0}/{e.turnout?.eligible||0}</b><div style={{fontSize:9,color:"var(--soft)"}}>{Number(e.turnout?.percent||0).toFixed(1)}% turnout</div></div>
    </button>)}

    {showCreate&&<Modal title="Create EXCO election" onClose={()=>setShowCreate(false)}>
      <Field label="Election title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
      <Field label="Term (optional)" value={form.term} onChange={v=>setForm({...form,term:v})}/>
      <Field label="Candidate applications open" type="datetime-local" value={form.applications_open_at} onChange={v=>setForm({...form,applications_open_at:v})}/>
      <Field label="Candidate applications close" type="datetime-local" value={form.applications_close_at} onChange={v=>setForm({...form,applications_close_at:v})}/>
      <Field label="Voting opens" type="datetime-local" value={form.opens_at} onChange={v=>setForm({...form,opens_at:v})}/>
      <Field label="Voting closes (optional)" type="datetime-local" value={form.closes_at} onChange={v=>setForm({...form,closes_at:v})}/>
      <div className="sans election-secret-note">All registered active members can apply for any available EXCO position during the application period.</div>
      <button type="button" disabled={busy} onClick={create} style={{...approveBtn,width:"100%"}}>{busy?"Creating…":"Create draft"}</button>
    </Modal>}

    {selected&&<Modal title={selected.title} onClose={()=>{setSelected(null);setDetail(null)}}>
      {!detail?<LoadingState>Loading election…</LoadingState>:<>
        <div className="election-admin-summary sans"><span>Status <b>{detail.status==="draft"&&detail.application_phase==="open"?"Applications Open":detail.status}</b></span><span>Turnout <b>{detail.turnout?.voted||0}/{detail.turnout?.eligible||0}</b></span></div>
        {detail.status==="draft"&&detail.applications_open_at&&<div className="sans election-secret-note">Candidate applications: <b>{detail.application_phase}</b> · {String(detail.applications_open_at).replace("T"," ")} → {String(detail.applications_close_at||"").replace("T"," ")}</div>}
        {detail.status==="draft"&&<>
          <div className="sans member-section-title">APPLICATIONS</div>
          <div className="election-application-counts sans">{["pending","approved","rejected","withdrawn"].map(s=><button type="button" key={s} className={applicationFilter===s?"active":""} onClick={()=>setApplicationFilter(applicationFilter===s?"all":s)}><b>{detail.applications?.filter(a=>a.status===s).length||0}</b><span>{s}</span></button>)}</div>
          {!detail.applications?.length?<div className="sans election-field-help" style={{marginBottom:10}}>No candidate applications yet.</div>:detail.applications.filter(a=>applicationFilter==="all"||a.status===applicationFilter).map(a=><div key={a.id} className="election-application-admin">
            <div className="sans"><b>{a.member_name}</b><span>{a.position_title} · {a.status}</span>{a.statement&&<small>{a.statement}</small>}</div>
            {a.status==="pending"&&<div><button type="button" disabled={busy} onClick={()=>reviewApplication(a,"approved")}>Approve</button><button type="button" className="reject" disabled={busy} onClick={()=>reviewApplication(a,"rejected")}>Reject</button></div>}
          </div>)}
          <div className="sans member-section-title">POSITIONS</div>
          {detail.positions.map(p=><div key={p.id} className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.seats} seat{Number(p.seats)===1?"":"s"} · select {p.min_selections}–{p.max_selections} · {p.candidates.length} candidates</span></div>)}
          <div className="election-position-create">
            <input className="sans" placeholder="Position e.g. President" value={position.title} onChange={e=>setPosition({...position,title:e.target.value})}/>
            <input className="sans" title="Seats / maximum selections" type="number" min="1" value={position.seats} onChange={e=>setPosition({...position,seats:e.target.value})}/>
            <input className="sans" title="Minimum selections" type="number" min="0" value={position.min_selections} onChange={e=>setPosition({...position,min_selections:e.target.value})}/>
            <button type="button" style={compactBtn} disabled={busy} onClick={addPosition}>Add</button>
          </div>
          <div className="sans election-field-help">Fields: position · seats/max selections · minimum selections.</div>
          {!!detail.positions.length&&<>
            <div className="sans member-section-title" style={{marginTop:14}}>CANDIDATES</div>
            {detail.positions.flatMap(p=>p.candidates).map(c=><div key={c.id} className="election-candidate-admin-row"><span className="sans"><b>{c.display_name}</b><small>{c.status}</small></span>{c.status==="active"&&<button type="button" disabled={busy} onClick={()=>withdrawCandidate(c)}>Withdraw</button>}</div>)}
            <select className="sans election-select" value={candidate.position_id} onChange={e=>setCandidate({...candidate,position_id:e.target.value})}><option value="">Choose position</option>{detail.positions.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
            <select className="sans election-select" value={candidate.member_id} onChange={e=>setCandidate({...candidate,member_id:e.target.value})}><option value="">Choose member</option>{members.filter(m=>Number(m.active)!==0).map(m=><option key={m.id} value={m.id}>{m.member_code} · {m.name}</option>)}</select>
            <button type="button" style={{...approveBtn,width:"100%",marginTop:7}} disabled={busy} onClick={addCandidate}>Add candidate</button>
          </>}
          <button type="button" style={{...approveBtn,width:"100%",marginTop:14}} disabled={busy} onClick={()=>changeStatus("open")}>Open voting</button>
        </>}
        {detail.status==="open"&&<>
          <div className="sans election-secret-note">🔒 Secret ballot active. Admins can see turnout, but not individual votes.</div>
          {detail.positions.map(p=><div key={p.id}><div className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.candidates.filter(c=>c.status==="active").length} active · {p.seats} seat{Number(p.seats)===1?"":"s"}</span></div>{p.candidates.map(c=><div key={c.id} className="election-candidate-admin-row"><span className="sans"><b>{c.display_name}</b><small>{c.status}</small></span>{c.status==="active"&&<button type="button" disabled={busy} onClick={()=>withdrawCandidate(c)}>Withdraw</button>}</div>)}</div>)}
          <button type="button" style={{...compactBtn,width:"100%",marginTop:10}} disabled={busy} onClick={remindNonVoters}>Remind members who have not voted</button>
          <button type="button" style={{...approveBtn,width:"100%",marginTop:8}} disabled={busy} onClick={()=>changeStatus("close")}>Close voting & calculate results</button>
          <button type="button" style={{...rejectBtn,width:"100%",marginTop:8}} disabled={busy} onClick={()=>changeStatus("cancel")}>Cancel election</button>
        </>}
        {detail.status==="closed"&&<>
          {!detail.certified_at&&<div className="sans election-certification pending">Results calculated · Uncertified</div>}
          {detail.certified_at&&<div className="sans election-certification">✓ Certified by {detail.certified_by_name||"Super Admin"}</div>}
          <ElectionResults detail={detail}/>
          {!detail.certified_at&&<button type="button" disabled={busy} onClick={certify} style={{...approveBtn,width:"100%",marginTop:10}}>Certify & publish results</button>}
          {!!detail.audit_history?.length&&<><div className="sans member-section-title" style={{marginTop:16}}>ELECTION AUDIT</div>{detail.audit_history.map(a=><div key={a.id} className="sans election-audit-row"><b>{String(a.action||"").replaceAll("_"," ")}</b><span>{a.admin_name||"system"} · {String(a.created_at||"").replace("T"," ").slice(0,16)}</span></div>)}</>}
        </>}
        {detail.status==="cancelled"&&<div className="sans election-secret-note">This election was cancelled.</div>}
      </>}
    </Modal>}
    {confirmationDialog}
  </>;
}

function ElectionResults({detail}){
  return <div><div className="sans member-section-title">RESULTS</div>{detail.positions.map(p=>{
    const ranked=p.candidates.map(c=>{const result=detail.results?.find(r=>Number(r.candidate_id)===Number(c.id));return {...c,votes:Number(result?.votes||0),outcome:result?.outcome||"not_elected"}}).sort((a,b)=>b.votes-a.votes);
    const hasTie=ranked.some(c=>c.outcome==="tie");
    return <div key={p.id} className="election-result-block"><b className="sans">{p.title} · {p.seats} seat{Number(p.seats)===1?"":"s"}</b>{hasTie&&<div className="sans election-tie-note">⚠ Tie at the seat boundary — no automatic winner assigned for tied candidates.</div>}{ranked.map(c=><div key={c.id} className="sans election-result-row"><span>{c.display_name}{c.outcome==="elected"?" ✓ ELECTED":c.outcome==="tie"?" · TIE":c.outcome==="withdrawn"?" · WITHDRAWN":""}</span><strong>{c.votes}</strong></div>)}</div>
  })}</div>
}
