import React,{useEffect,useState} from "react";
import { api,onDataChange } from "../../api";
import { Modal,useConfirmDialog } from "../../components/FormControls";
import { LoadingState,EmptyState,MessageBanner,approveBtn } from "../../components/Shared";

export function MemberElections(){
  const [rows,setRows]=useState(()=>api.peekCached("/api/elections"));
  const [detail,setDetail]=useState(null);
  const [selected,setSelected]=useState(null);
  const [choices,setChoices]=useState({});
  const [applyPosition,setApplyPosition]=useState("");
  const [applyStatement,setApplyStatement]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [currentExco,setCurrentExco]=useState(()=>api.peekCached("/api/elections/exco/current")?.roles||[]);
  const [runoffChoices,setRunoffChoices]=useState({});
  const {confirm,confirmationDialog}=useConfirmDialog();
  const load=()=>Promise.all([
    api.elections.list().then(setRows),
    api.elections.currentExco().then(r=>setCurrentExco(r.roles||[]))
  ]).catch(e=>setMessage(e.message));
  useEffect(()=>{load()},[]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/elections"))load()}),[]);
  const open=async(e)=>{setSelected(e);setChoices({});setMessage("");try{setDetail(await api.refreshCached(`/api/elections/${e.id}`))}catch(err){setMessage(err.message)}};
  const toggle=(position,candidateId)=>{
    const key=String(position.id),current=choices[key]||[];
    if(current.includes(candidateId))return setChoices({...choices,[key]:current.filter(x=>x!==candidateId)});
    if(current.length>=Number(position.max_selections))return;
    setChoices({...choices,[key]:[...current,candidateId]});
  };
  const apply=async()=>{
    if(!detail||!applyPosition)return setMessage("Choose a position to apply for.");
    setBusy(true);try{await api.elections.apply(detail.id,{position_id:Number(applyPosition),statement:applyStatement});setMessage("Candidate application submitted for review.");setDetail(await api.elections.get(detail.id));setApplyPosition("");setApplyStatement("");await load()}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const withdrawApplication=async(a)=>{
    if(!await confirm({title:"Withdraw application?",message:"You can apply again only if the application period is still open.",confirmLabel:"Withdraw",tone:"danger"}))return;
    setBusy(true);try{await api.elections.withdrawApplication(detail.id,a.id);setDetail(await api.elections.get(detail.id));setMessage("Application withdrawn.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const toggleRunoff=(runoff,candidateId)=>{
    const key=String(runoff.id),current=runoffChoices[key]||[],need=Number(runoff.seats_to_fill||1);
    if(current.includes(candidateId))return setRunoffChoices({...runoffChoices,[key]:current.filter(x=>x!==candidateId)});
    if(current.length>=need)return;
    setRunoffChoices({...runoffChoices,[key]:[...current,candidateId]});
  };
  const submitRunoff=async(runoff)=>{
    const selected=runoffChoices[String(runoff.id)]||[],need=Number(runoff.seats_to_fill||1);
    if(selected.length!==need)return setMessage(`Select exactly ${need} candidate${need===1?"":"s"} for this runoff.`);
    if(!await confirm({title:"Submit runoff ballot?",message:"Your runoff vote is secret and cannot be changed after submission.",confirmLabel:"Submit runoff vote",tone:"primary"}))return;
    setBusy(true);try{await api.elections.voteRunoff(detail.id,runoff.id,selected);setMessage("Runoff vote submitted successfully.");setDetail(await api.elections.get(detail.id));await load()}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };

  const submit=async()=>{
    if(!detail||detail.my_vote)return;
    if(!await confirm({title:"Submit secret ballot?",message:"Your vote cannot be changed after submission. Your selections are stored separately from your member identity.",confirmLabel:"Submit vote",tone:"primary"}))return;
    setBusy(true);try{await api.elections.vote(detail.id,choices);setMessage("Vote submitted successfully.");setDetail(await api.elections.get(detail.id));await load()}catch(e){setMessage(e.message);if(e?.status===409){try{setDetail(await api.elections.get(detail.id));await load()}catch{}}}finally{setBusy(false)}
  };
  if(rows===null)return <LoadingState>Loading elections…</LoadingState>;
  return <>
    <div className="member-page-heading"><div className="sans">Elections</div><span className="sans">EXCO nominations, voting and results</span></div>
    <MessageBanner>{message}</MessageBanner>
    {!!currentExco.length&&<section className="official-exco-card">
      <div className="sans member-section-title">CURRENT OFFICIAL EXCO</div>
      {currentExco.map(x=><div key={x.id} className="sans official-exco-row"><span><b>{x.role_title}</b><small>{x.term||""}</small></span><strong>{x.name}</strong></div>)}
    </section>}
    {!rows.length?<EmptyState>No elections available.</EmptyState>:rows.map(e=><button key={e.id} type="button" onClick={()=>open(e)} className="member-election-card">
      <div><b className="sans">{e.title}</b><span className="sans">{e.term||""}</span></div>
      <div className="sans"><strong>{e.status==="draft"?"View applications ›":e.status==="open"?(e.my_vote?"Vote submitted ✓":"Vote now ›"):e.status==="closed"?"View results ›":String(e.status)}</strong><span>{e.turnout?.voted||0}/{e.turnout?.eligible||0} voted · {Number(e.turnout?.percent||0).toFixed(1)}%</span></div>
    </button>)}
    {selected&&<Modal title={selected.title} onClose={()=>{setSelected(null);setDetail(null)}}>
      {!detail?<LoadingState>Loading ballot…</LoadingState>:<>
        <div className="sans election-secret-note">🔒 Secret ballot. The system records that you voted, but ballot selections are stored without your member ID.</div>        {detail.status==="draft"&&<>
          <div className={`sans election-application-status ${detail.application_phase}`}>{detail.application_phase==="open"?"Candidate applications are open":detail.application_phase==="upcoming"?"Candidate applications have not opened yet":"Candidate applications are closed"}</div>
          {!!detail.applications?.length&&<div className="election-my-applications">{detail.applications.map(a=><div key={a.id} className="sans election-my-application"><div><b>{detail.positions.find(p=>Number(p.id)===Number(a.position_id))?.title||"Position"}</b><span>{a.status}</span>{a.review_reason&&<small>{a.review_reason}</small>}{a.status==="withdrawn"&&!a.review_reason&&<small>Candidacy withdrawn.</small>}</div>{a.status==="pending"&&detail.application_phase==="open"&&<button type="button" onClick={()=>withdrawApplication(a)}>Withdraw</button>}</div>)}</div>}
          {detail.application_phase==="open"&&<>
            <div className="sans member-section-title">APPLY FOR AN AVAILABLE POSITION</div>
            <div className="sans election-deadline">Applications close: <b>{String(detail.applications_close_at||"").replace("T"," ").slice(0,16)}</b></div>
            <div className="sans election-application-open-note">All registered active members can apply for any available position.</div>

            <select className="sans election-select" value={applyPosition} onChange={e=>setApplyPosition(e.target.value)}><option value="">Choose position</option>{detail.positions.map(p=><option key={p.id} value={p.id}>{p.title} · {p.seats} seat{Number(p.seats)===1?"":"s"}</option>)}</select>
            <textarea className="sans election-application-statement" maxLength={600} placeholder="Short candidate statement / reason for applying (optional)" value={applyStatement} onChange={e=>setApplyStatement(e.target.value)}/>
            <button type="button" disabled={busy||!applyPosition} onClick={apply} style={{...approveBtn,width:"100%",marginBottom:12}}>{busy?"Submitting…":"Submit candidate application"}</button>
          </>}
        </>}

        {detail.status==="open"&&!detail.eligible&&<div className="sans member-inline-error">You are not eligible to vote in this election.</div>}
        {detail.status==="open"&&detail.eligible&&detail.my_vote&&<div className="sans election-voted">✓ Your vote has been submitted.</div>}
        {detail.status==="open"&&detail.eligible&&!detail.my_vote&&<>
          {detail.positions.map(p=><div key={p.id} className="election-ballot-position">
            <div className="sans"><b>{p.title}</b><span>{Number(p.min_selections||0)>0?`Select ${p.min_selections}${Number(p.max_selections)>Number(p.min_selections)?`–${p.max_selections}`:""}`:`Select up to ${p.max_selections}`}</span></div>
            {p.candidates.filter(c=>c.status==="active").map(c=>{
              const selected=(choices[String(p.id)]||[]).includes(c.id);
              return <button key={c.id} type="button" onClick={()=>toggle(p,c.id)} className={`sans election-candidate${selected?" selected":""}`}><span>{c.display_name}</span><b>{selected?"✓":""}</b></button>
            })}
          </div>)}
          <button type="button" disabled={busy} onClick={submit} style={{...approveBtn,width:"100%",marginTop:12}}>{busy?"Submitting…":"Review & submit vote"}</button>
        </>}
        {detail.status==="closed"&&!detail.certified_at&&<>
          <div className="sans election-voted">{detail.unresolved_ties?.length?"Main voting has closed. A runoff is required before certification.":"Voting has closed. Results are awaiting certification."}</div>
          {detail.runoffs?.filter(r=>r.status==="open").map(runoff=>{
            const mine=detail.my_runoff_votes?.[String(runoff.id)];
            const selected=runoffChoices[String(runoff.id)]||[];
            return <div key={runoff.id} className="election-runoff-ballot">
              <div className="sans election-runoff-title"><b>{runoff.position_title} · Runoff Round {runoff.round_no}</b><span>Select exactly {runoff.seats_to_fill}</span></div>
              {mine?.voted?<div className="sans election-voted">✓ Your runoff vote has been submitted.</div>:mine?.eligible?<>
                {runoff.candidates.map(c=><button key={c.id} type="button" onClick={()=>toggleRunoff(runoff,c.id)} className={`sans election-candidate${selected.includes(c.id)?" selected":""}`}><span>{c.display_name}</span><b>{selected.includes(c.id)?"✓":""}</b></button>)}
                <button type="button" disabled={busy||selected.length!==Number(runoff.seats_to_fill)} onClick={()=>submitRunoff(runoff)} style={{...approveBtn,width:"100%",marginTop:8}}>Submit runoff vote</button>
              </>:<div className="sans election-secret-note">You are not eligible for this runoff.</div>}
            </div>
          })}
        </>}
        {detail.status==="closed"&&detail.certified_at&&<><div className="sans election-certification">✓ Official results certified · EXCO roles assigned</div><MemberResults detail={detail}/></>}
        {detail.status==="cancelled"&&<div className="sans election-voted">This election was cancelled.</div>}
      </>}
    </Modal>}
    {confirmationDialog}
  </>;
}
function MemberResults({detail}){
  return <div>{detail.positions.map(p=>{
    const ranked=p.candidates.map(c=>{const result=detail.results?.find(r=>Number(r.candidate_id)===Number(c.id));return {...c,votes:Number(result?.votes||0),outcome:result?.outcome||"not_elected"}}).sort((a,b)=>b.votes-a.votes);
    const hasTie=ranked.some(c=>c.outcome==="tie");
    return <div key={p.id} className="election-result-block"><b className="sans">{p.title}</b>{hasTie&&<div className="sans election-tie-note">Tie at the seat boundary · final winner requires governance resolution.</div>}{ranked.map(c=><div key={c.id} className="sans election-result-row"><span>{c.display_name}{c.outcome==="elected"?" · ELECTED":c.outcome==="tie"?" · TIE":c.outcome==="withdrawn"?" · WITHDRAWN":""}</span><strong>{c.votes}</strong></div>)}</div>
  })}</div>
}
