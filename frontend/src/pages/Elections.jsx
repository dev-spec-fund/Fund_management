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
  const [form,setForm]=useState({title:"",term:"",opens_at:"",closes_at:""});
  const [position,setPosition]=useState({title:"",seats:"1"});
  const [candidate,setCandidate]=useState({position_id:"",member_id:""});
  const {confirm,confirmationDialog}=useConfirmDialog();

  const load=()=>Promise.all([api.elections.list().then(setRows),api.members.list().then(setMembers)]).catch(e=>setMessage(e.message));
  const open=async(row)=>{setSelected(row);setMessage("");try{setDetail(await api.elections.get(row.id))}catch(e){setMessage(e.message)}};
  useEffect(()=>{load()},[]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/elections"))load()}),[]);

  const create=async()=>{if(!form.title.trim())return setMessage("Election title is required.");setBusy(true);try{const e=await api.elections.create(form);setShowCreate(false);setForm({title:"",term:"",opens_at:"",closes_at:""});await load();await open(e)}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addPosition=async()=>{if(!detail||!position.title.trim())return;setBusy(true);try{const d=await api.elections.addPosition(detail.id,{title:position.title,seats:Number(position.seats)||1,max_selections:Number(position.seats)||1});setDetail(d);setPosition({title:"",seats:"1"})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addCandidate=async()=>{if(!detail||!candidate.position_id||!candidate.member_id)return;setBusy(true);try{const d=await api.elections.addCandidate(detail.id,candidate);setDetail(d);setCandidate({position_id:"",member_id:""})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const changeStatus=async(action)=>{if(!detail)return;if(!await confirm({title:`${action[0].toUpperCase()+action.slice(1)} election?`,message:action==="open"?"Eligible voters will be snapshotted and Telegram-linked members will be notified.":`Are you sure you want to ${action} this election?`,confirmLabel:action[0].toUpperCase()+action.slice(1),tone:action==="cancel"?"danger":"primary"}))return;setBusy(true);try{const d=await api.elections[action](detail.id);setDetail(d);await load();setMessage(action==="open"?"Election opened. Eligible voters were snapshotted.":action==="close"?"Election closed. Results are now available.":"Election cancelled.")}catch(e){setMessage(e.message)}finally{setBusy(false)}};

  if(rows===null)return <LoadingState>Loading elections…</LoadingState>;
  return <>
    <div className="member-page-heading"><div className="sans">EXCO Elections</div><span className="sans">Secret-ballot executive committee elections</span></div>
    <MessageBanner>{message}</MessageBanner>
    <button type="button" style={{...approveBtn,width:"100%",marginBottom:12}} onClick={()=>setShowCreate(true)}>+ Create election</button>
    {!rows.length?<EmptyState>No elections yet.</EmptyState>:rows.map(e=><button key={e.id} type="button" onClick={()=>open(e)} className="expense-row" style={{alignItems:"center"}}>
      <div style={{minWidth:0,flex:1,textAlign:"left"}}><div className="sans" style={{fontSize:13,fontWeight:750}}>{e.title}</div><div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:3}}>{e.term||"No term"} · {String(e.status).toUpperCase()}</div></div>
      <div className="sans" style={{textAlign:"right"}}><b>{e.turnout?.voted||0}/{e.turnout?.eligible||0}</b><div style={{fontSize:9,color:"var(--soft)"}}>voted</div></div>
    </button>)}

    {showCreate&&<Modal title="Create EXCO election" onClose={()=>setShowCreate(false)}>
      <Field label="Election title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
      <Field label="Term (optional)" value={form.term} onChange={v=>setForm({...form,term:v})}/>
      <Field label="Voting opens (optional)" type="datetime-local" value={form.opens_at} onChange={v=>setForm({...form,opens_at:v})}/>
      <Field label="Voting closes (optional)" type="datetime-local" value={form.closes_at} onChange={v=>setForm({...form,closes_at:v})}/>
      <button type="button" disabled={busy} onClick={create} style={{...approveBtn,width:"100%"}}>{busy?"Creating…":"Create draft"}</button>
    </Modal>}

    {selected&&<Modal title={selected.title} onClose={()=>{setSelected(null);setDetail(null)}}>
      {!detail?<LoadingState>Loading election…</LoadingState>:<>
        <div className="election-admin-summary sans"><span>Status <b>{detail.status}</b></span><span>Turnout <b>{detail.turnout?.voted||0}/{detail.turnout?.eligible||0}</b></span></div>
        {detail.status==="draft"&&<>
          <div className="sans member-section-title">POSITIONS</div>
          {detail.positions.map(p=><div key={p.id} className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.seats} seat{Number(p.seats)===1?"":"s"} · {p.candidates.length} candidate{p.candidates.length===1?"":"s"}</span></div>)}
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px auto",gap:6,marginTop:8}}>
            <input className="sans" placeholder="Position e.g. President" value={position.title} onChange={e=>setPosition({...position,title:e.target.value})}/>
            <input className="sans" type="number" min="1" value={position.seats} onChange={e=>setPosition({...position,seats:e.target.value})}/>
            <button type="button" style={compactBtn} disabled={busy} onClick={addPosition}>Add</button>
          </div>
          {!!detail.positions.length&&<>
            <div className="sans member-section-title" style={{marginTop:14}}>CANDIDATES</div>
            <select className="sans election-select" value={candidate.position_id} onChange={e=>setCandidate({...candidate,position_id:e.target.value})}><option value="">Choose position</option>{detail.positions.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
            <select className="sans election-select" value={candidate.member_id} onChange={e=>setCandidate({...candidate,member_id:e.target.value})}><option value="">Choose member</option>{members.filter(m=>Number(m.active)!==0).map(m=><option key={m.id} value={m.id}>{m.member_code} · {m.name}</option>)}</select>
            <button type="button" style={{...approveBtn,width:"100%",marginTop:7}} disabled={busy} onClick={addCandidate}>Add candidate</button>
          </>}
          <button type="button" style={{...approveBtn,width:"100%",marginTop:14}} disabled={busy} onClick={()=>changeStatus("open")}>Open voting</button>
        </>}
        {detail.status==="open"&&<>
          <div className="sans election-secret-note">🔒 Secret ballot active. Admins can see turnout, but not individual votes.</div>
          {detail.positions.map(p=><div key={p.id} className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.candidates.filter(c=>c.status==="active").length} candidates · {p.seats} seat{Number(p.seats)===1?"":"s"}</span></div>)}
          <button type="button" style={{...approveBtn,width:"100%",marginTop:12}} disabled={busy} onClick={()=>changeStatus("close")}>Close voting & publish results</button>
          <button type="button" style={{...rejectBtn,width:"100%",marginTop:8}} disabled={busy} onClick={()=>changeStatus("cancel")}>Cancel election</button>
        </>}
        {detail.status==="closed"&&<ElectionResults detail={detail}/>}
        {detail.status==="cancelled"&&<div className="sans election-secret-note">This election was cancelled.</div>}
      </>}
    </Modal>}
    {confirmationDialog}
  </>;
}

function ElectionResults({detail}){
  return <div><div className="sans member-section-title">RESULTS</div>{detail.positions.map(p=>{
    const ranked=p.candidates.filter(c=>c.status==="active").map(c=>({...c,votes:Number(detail.results?.find(r=>Number(r.candidate_id)===Number(c.id))?.votes||0)})).sort((a,b)=>b.votes-a.votes);
    return <div key={p.id} className="election-result-block"><b className="sans">{p.title} · {p.seats} seat{Number(p.seats)===1?"":"s"}</b>{ranked.map((c,i)=><div key={c.id} className="sans election-result-row"><span>{c.display_name}{i<Number(p.seats)?" ✓":""}</span><strong>{c.votes}</strong></div>)}</div>
  })}</div>
}
