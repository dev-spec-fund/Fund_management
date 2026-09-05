import React,{useEffect,useState} from "react";
import { api,onDataChange } from "../api";
import { Modal,Field,useConfirmDialog } from "../components/FormControls";
import { LoadingState,EmptyState,MessageBanner,approveBtn,compactBtn,rejectBtn } from "../components/Shared";

export default function Elections(){
  const [rows,setRows]=useState(()=>api.peekCached("/api/elections"));
  const [members,setMembers]=useState(()=>api.peekCached("/api/members")||[]);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [readiness,setReadiness]=useState(null);
  const [summary,setSummary]=useState(null);
  const [notificationStatus,setNotificationStatus]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [currentExco,setCurrentExco]=useState(()=>api.peekCached("/api/elections/exco/current")?.roles||[]);
  const [archive,setArchive]=useState(()=>api.peekCached("/api/elections/archive")?.archive||[]);
  const [dashboard,setDashboard]=useState(()=>api.peekCached("/api/elections/dashboard"));
  const [form,setForm]=useState({title:"",term:"",applications_open_at:"",applications_close_at:"",opens_at:"",closes_at:""});
  const [applicationFilter,setApplicationFilter]=useState("all");
  const [position,setPosition]=useState({title:"",seats:"1",min_selections:"1"});
  const [candidate,setCandidate]=useState({position_id:"",member_id:""});
  const {confirm,confirmationDialog}=useConfirmDialog();

  const load=()=>Promise.all([
    api.elections.list().then(setRows),
    api.members.list().then(setMembers),
    api.elections.currentExco().then(r=>setCurrentExco(r.roles||[])),
    api.elections.archive().then(r=>setArchive(r.archive||[])),
    api.elections.dashboard().then(setDashboard)
  ]).catch(e=>setMessage(e.message));
  const open=async(row)=>{setSelected(row);setReadiness(null);setMessage("");try{setDetail(await api.elections.get(row.id))}catch(e){setMessage(e.message)}};
  useEffect(()=>{load()},[]);
  useEffect(()=>onDataChange(({path})=>{if(path?.startsWith("/api/elections"))load()}),[]);
  useEffect(()=>{
    if(!detail?.id||detail.status!=="draft"){setReadiness(null);return;}
    let active=true;
    api.elections.readiness(detail.id).then(r=>{if(active)setReadiness(r)}).catch(e=>{if(active){setReadiness(null);setMessage(e.message)}});
    return ()=>{active=false};
  },[detail]);
  useEffect(()=>{
    if(!detail?.id||!detail.certified_at){setSummary(null);return;}
    let active=true;
    api.elections.summary(detail.id).then(r=>{if(active)setSummary(r)}).catch(e=>{if(active){setSummary(null);setMessage(e.message)}});
    return ()=>{active=false};
  },[detail?.id,detail?.certified_at]);
  const refreshNotificationStatus=async(id=detail?.id)=>{
    if(!id)return;
    try{setNotificationStatus(await api.refreshCached(`/api/elections/${id}/notifications`))}catch(e){setNotificationStatus(null)}
  };
  useEffect(()=>{
    if(!detail?.id){setNotificationStatus(null);return;}
    refreshNotificationStatus(detail.id);
  },[detail?.id,detail?.status,detail?.certified_at]);

  const repairApplicationSync=async()=>{
    if(!detail)return;
    if(!await confirm({title:"Fix election data automatically?",message:"This will synchronize approved/withdrawn applications with their candidate records before voting opens.",confirmLabel:"Fix automatically",tone:"primary"}))return;
    setBusy(true);try{
      const r=await api.elections.repairApplicationSync(detail.id);
      setDetail(r.detail||await api.elections.get(detail.id));
      setReadiness(r.readiness||await api.elections.readiness(detail.id));
      const x=r.repaired||{};
      setMessage(`Election data synchronized · ${Number(x.total_changes||0)} change${Number(x.total_changes||0)===1?"":"s"} applied.`);
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const exportPdf=async()=>{
    if(!summary)return setMessage("Certified election summary is still loading.");
    setBusy(true);try{const {exportElectionPdf}=await import("../utils/exports");await exportElectionPdf(summary);setMessage("Election PDF sent to your Telegram chat.")}catch(e){setMessage(e.message||"Could not export election PDF")}finally{setBusy(false)}
  };
  const exportCsv=async()=>{
    if(!summary)return setMessage("Certified election summary is still loading.");
    setBusy(true);try{const {exportElectionCsv}=await import("../utils/exports");await exportElectionCsv(summary);setMessage("Election CSV sent to your Telegram chat.")}catch(e){setMessage(e.message||"Could not export election CSV")}finally{setBusy(false)}
  };
  const create=async()=>{if(!form.title.trim())return setMessage("Election title is required.");setBusy(true);try{const e=await api.elections.create(form);setShowCreate(false);setForm({title:"",term:"",applications_open_at:"",applications_close_at:"",opens_at:"",closes_at:""});await load();await open(e)}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addPosition=async()=>{if(!detail||!position.title.trim())return;setBusy(true);try{const seats=Number(position.seats)||1;const d=await api.elections.addPosition(detail.id,{title:position.title,seats,max_selections:seats,min_selections:Math.max(0,Math.min(seats,Number(position.min_selections)||0))});setDetail(d);setPosition({title:"",seats:"1",min_selections:"1"})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const addCandidate=async()=>{if(!detail||!candidate.position_id||!candidate.member_id)return;setBusy(true);try{const d=await api.elections.addCandidate(detail.id,candidate);setDetail(d);setCandidate({position_id:"",member_id:""})}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const reviewApplication=async(a,decision)=>{
    const reason=decision==="rejected"?(window.prompt(`Reason for rejecting ${a.member_name}:`)??null):"";
    if(reason===null)return;
    setBusy(true);try{setDetail(await api.elections.reviewApplication(detail.id,a.id,decision,reason));setMessage(`Application ${decision}.`)}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const reopenApplication=async(a)=>{
    if(!await confirm({title:"Reopen application?",message:`Return ${a.member_name}'s ${a.position_title} application to Pending Review?`,confirmLabel:"Reopen",tone:"primary"}))return;
    setBusy(true);try{await api.elections.reopenApplication(detail.id,a.id);setDetail(await api.elections.get(detail.id));setMessage("Application reopened and returned to Pending Review.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const reassignApplication=async(a)=>{
    const options=detail.positions.filter(p=>Number(p.id)!==Number(a.position_id));
    if(!options.length)return setMessage("No other positions are available.");
    const menu=options.map(p=>`${p.id}: ${p.title}`).join("\n");
    const value=window.prompt(`Move ${a.member_name}'s application to which position?\n\n${menu}`,"");
    if(value===null)return;
    const positionId=Number(String(value).split(":")[0].trim());
    if(!options.some(p=>Number(p.id)===positionId))return setMessage("Choose a valid position ID.");
    setBusy(true);try{await api.elections.reassignApplication(detail.id,a.id,positionId);setDetail(await api.elections.get(detail.id));setMessage("Application position updated.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const extendApplications=async()=>{
    if(!detail)return;
    const current=String(detail.applications_close_at||"").slice(0,16);
    const next=window.prompt("New application deadline (YYYY-MM-DDTHH:MM):",current);
    if(next===null)return;
    if(!next.trim())return setMessage("Enter the new application deadline.");
    setBusy(true);try{
      await api.elections.extendApplications(detail.id,next.trim());
      setDetail(await api.elections.get(detail.id));
      await load();
      setMessage(`Application deadline extended to ${next.trim().replace("T"," ")}.`);
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const withdrawCandidate=async(c)=>{
    const reason=window.prompt(`Reason for withdrawing ${c.display_name}:`);
    if(reason===null)return;
    setBusy(true);try{
      await api.elections.withdrawCandidate(detail.id,c.id,reason.trim()||"Withdrawn");
      setDetail(await api.elections.get(detail.id));
      await load();
      setMessage(`${c.display_name} withdrawn from the election. Member application status updated too.`);
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const remindNonVoters=async()=>{
    setBusy(true);try{const r=await api.elections.remindNonVoters(detail.id);setMessage(`Voting reminder sent: ${r.sent||0}${r.failed?` · ${r.failed} failed`:""}`);await refreshNotificationStatus()}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const startRunoff=async(tie)=>{
    const closesAt=window.prompt("Runoff closing date/time (YYYY-MM-DDTHH:MM), or leave blank to close manually:","") ?? null;
    if(closesAt===null)return;
    setBusy(true);try{
      await api.elections.startRunoff(detail.id,{position_id:tie.position_id,closes_at:closesAt||null});
      setDetail(await api.elections.get(detail.id));await refreshNotificationStatus();setMessage(`Runoff opened for ${tie.position_title}.`);
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  };
  const closeRunoff=async(runoff)=>{
    if(!await confirm({title:"Close runoff?",message:`Close runoff voting for ${runoff.position_title}?`,confirmLabel:"Close runoff",tone:"primary"}))return;
    setBusy(true);try{await api.elections.closeRunoff(detail.id,runoff.id);setDetail(await api.elections.get(detail.id));setMessage("Runoff closed and tie status recalculated.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };

  const certify=async()=>{
    if(!await confirm({title:"Certify election results?",message:"Certification makes the results final and publishes them to members. Ballots remain secret.",confirmLabel:"Certify results",tone:"primary"}))return;
    setBusy(true);try{await api.elections.certify(detail.id);setDetail(await api.elections.get(detail.id));await load();await refreshNotificationStatus();setMessage("Election certified · EXCO roles assigned and published.")}catch(e){setMessage(e.message)}finally{setBusy(false)}
  };

  const changeStatus=async(action)=>{if(!detail)return;if(!await confirm({title:`${action[0].toUpperCase()+action.slice(1)} election?`,message:action==="open"?"Eligible voters will be snapshotted, Telegram-linked members will be notified, and all election setup will become read-only.":`Are you sure you want to ${action} this election?`,confirmLabel:action[0].toUpperCase()+action.slice(1),tone:action==="cancel"?"danger":"primary"}))return;setBusy(true);try{const d=await api.elections[action](detail.id);setDetail(d);await load();await refreshNotificationStatus(detail.id);setMessage(action==="open"?"Election opened. Eligible voters were snapshotted.":action==="close"?"Election closed. Results are now available.":"Election cancelled.")}catch(e){setMessage(e.message)}finally{setBusy(false)}};

  if(rows===null)return <LoadingState>Loading elections…</LoadingState>;
  return <>
    <div className="member-page-heading"><div className="sans">EXCO Elections</div><span className="sans">Secret-ballot executive committee elections</span></div>
    <MessageBanner>{message}</MessageBanner>
    <button type="button" style={{...approveBtn,width:"100%",marginBottom:12}} onClick={()=>setShowCreate(true)}>+ Create election</button>
    {dashboard&&<section className="election-dashboard">
      <div className="sans election-dashboard-head">
        <span><b>ELECTION DASHBOARD</b><small>{dashboard.totals?.active_elections||0} active election{Number(dashboard.totals?.active_elections||0)===1?"":"s"}</small></span>
        <strong>{dashboard.totals?.pending_applications||0}<small>pending</small></strong>
      </div>
      {!!dashboard.warnings?.length&&<div className="election-dashboard-alerts">
        {dashboard.warnings.slice(0,5).map((w,i)=><button type="button" key={`${w.election_id}-${w.key}-${i}`} onClick={()=>{const row=rows?.find(x=>Number(x.id)===Number(w.election_id));if(row)open(row)}} className={`sans election-dashboard-alert ${w.level||"warning"}`}>
          <span>{w.text}</span><small>{w.election_title} ›</small>
        </button>)}
      </div>}
      {!dashboard.items?.length?<div className="sans election-dashboard-empty">No active election requires attention.</div>:dashboard.items.map(item=><button type="button" key={item.id} onClick={()=>{const row=rows?.find(x=>Number(x.id)===Number(item.id))||item;open(row)}} className="election-dashboard-card">
        <div className="sans election-dashboard-card-top">
          <span><b>{item.title}</b><small>{item.term||"No term"}</small></span>
          <strong>{item.stage}</strong>
        </div>
        <div className="election-dashboard-metrics sans">
          <div><span>Applications</span><b>{item.applications.pending} pending</b><small>{item.applications.approved} approved</small></div>
          <div><span>Candidates</span><b>{item.candidates.active} active</b><small>{item.candidates.total} total</small></div>
          <div><span>Turnout</span><b>{item.turnout.voted}/{item.turnout.eligible}</b><small>{item.turnout.remaining} remaining</small></div>
          <div><span>Notifications</span><b>{item.notifications.sent} sent</b><small className={item.notifications.failed?"fail":""}>{item.notifications.failed} failed</small></div>
        </div>
        {item.status==="draft"&&item.readiness&&<div className={`sans election-dashboard-readiness ${item.readiness.ready?"ready":"blocked"}`}><span>{item.readiness.ready?"✓ Ready to Open Voting":"Pre-vote readiness"}</span><b>{item.readiness.passed}/{item.readiness.total}</b></div>}
        {!!item.runoffs?.length&&<div className="sans election-dashboard-runoff">{item.runoffs.map(r=><span key={r.id}>Runoff · {r.position_title} · {r.voted}/{r.eligible} voted</span>)}</div>}
      </button>)}
    </section>}
    {!!currentExco.length&&<section className="official-exco-card">
      <div className="sans member-section-title">CURRENT OFFICIAL EXCO</div>
      {currentExco.map(x=><div key={x.id} className="sans official-exco-row"><span><b>{x.role_title}</b><small>{x.term||x.election_title||""}</small></span><strong>{x.name}</strong></div>)}
    </section>}
    {!!archive.length&&<section className="election-archive-card">
      <div className="sans member-section-title">ELECTION ARCHIVE</div>
      {archive.map(e=><button key={e.id} type="button" className="sans election-archive-row" onClick={()=>open(e)}>
        <span><b>{e.title}</b><small>{e.term||e.year||"Certified election"} · Certified {formatElectionDate(e.certified_at)}</small></span>
        <strong>{e.turnout?.voted||0}/{e.turnout?.eligible||0}<small>{Number(e.turnout?.percent||0).toFixed(1)}%</small></strong>
      </button>)}
    </section>}
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

    {selected&&<Modal title={selected.title} onClose={()=>{setSelected(null);setDetail(null);setReadiness(null);setSummary(null);setNotificationStatus(null)}}>
      {!detail?<LoadingState>Loading election…</LoadingState>:<>
        <div className="election-admin-summary sans"><span>Status <b>{detail.status==="draft"&&detail.application_phase==="open"?"Applications Open":detail.status}</b></span><span>Turnout <b>{detail.turnout?.voted||0}/{detail.turnout?.eligible||0}</b></span></div>
        {notificationStatus&&<section className="election-notification-status">
          <div className="sans election-notification-heading"><b>NOTIFICATION STATUS</b><span>{notificationStatus.totals?.sent||0} sent · {notificationStatus.totals?.failed||0} failed</span></div>
          {!notificationStatus.items?.length?<div className="sans election-field-help">No election notifications recorded yet.</div>:notificationStatus.items.slice(0,6).map(n=><div key={n.id} className="sans election-notification-row">
            <span><b>{notificationEventLabel(n.event_key)}</b><small>{n.audience} · {formatElectionDate(n.created_at)}</small></span>
            <strong className={Number(n.failed||0)>0?"has-fail":""}>{n.sent} sent{Number(n.failed||0)>0?` · ${n.failed} failed`:""}</strong>
          </div>)}
        </section>}
        {detail.status==="draft"&&detail.applications_open_at&&<>
          <div className="sans election-secret-note">Candidate applications: <b>{detail.application_phase}</b> · {String(detail.applications_open_at).replace("T"," ")} → {String(detail.applications_close_at||"").replace("T"," ")}</div>
          <button type="button" disabled={busy} onClick={extendApplications} className="sans election-extend-deadline">Extend application deadline</button>
        </>}
        {detail.status==="draft"&&<>
          <div className="sans member-section-title">APPLICATIONS</div>
          <div className="election-application-counts sans">{["pending","approved","rejected","withdrawn"].map(s=><button type="button" key={s} className={applicationFilter===s?"active":""} onClick={()=>setApplicationFilter(applicationFilter===s?"all":s)}><b>{detail.applications?.filter(a=>a.status===s).length||0}</b><span>{s}</span></button>)}</div>
          {!detail.applications?.length?<div className="sans election-field-help" style={{marginBottom:10}}>No candidate applications yet.</div>:detail.applications.filter(a=>applicationFilter==="all"||a.status===applicationFilter).map(a=><div key={a.id} className="election-application-admin v53">
            <div className="sans election-application-main"><b>{a.member_name}</b><span>{a.position_title} · {applicationStatusLabel(a)}</span>{a.statement&&<small>{a.statement}</small>}<small className="election-application-meta">Submitted {formatElectionDate(a.submitted_at)}{a.reviewed_at?` · Reviewed ${formatElectionDate(a.reviewed_at)}`:""}{a.withdrawn_at?` · Withdrawn ${formatElectionDate(a.withdrawn_at)}`:""}</small>{a.review_reason&&<small className="election-application-reason">{a.review_reason}</small>}</div>
            <div className="election-application-actions">
              {a.status==="pending"&&<><button type="button" disabled={busy} onClick={()=>reviewApplication(a,"approved")}>Approve</button><button type="button" className="reject" disabled={busy} onClick={()=>reviewApplication(a,"rejected")}>Reject</button></>}
              {["pending","approved"].includes(a.status)&&<button type="button" className="neutral" disabled={busy} onClick={()=>reassignApplication(a)}>Move</button>}
              {["rejected","withdrawn"].includes(a.status)&&<><button type="button" className="neutral" disabled={busy} onClick={()=>reassignApplication(a)}>Move</button><button type="button" disabled={busy} onClick={()=>reopenApplication(a)}>Reopen</button></>}
            </div>
          </div>)}
          <div className="sans member-section-title">POSITION READINESS</div>
          {detail.positions.map(p=>{
            const apps=detail.applications?.filter(a=>Number(a.position_id)===Number(p.id))||[];
            const pending=apps.filter(a=>a.status==="pending").length;
            const approved=apps.filter(a=>a.status==="approved").length;
            const withdrawn=apps.filter(a=>a.status==="withdrawn").length;
            const activeCandidates=p.candidates.filter(c=>c.status==="active").length;
            const ready=activeCandidates>=Number(p.seats||1)&&pending===0;
            return <div key={p.id} className={`election-position-readiness ${ready?"ready":"attention"}`}>
              <div className="sans"><b>{p.title}</b><span>{p.seats} seat{Number(p.seats)===1?"":"s"} · {activeCandidates} active candidate{activeCandidates===1?"":"s"}</span></div>
              <div className="sans election-position-counts"><span>{approved} approved</span><span>{pending} pending</span><span>{withdrawn} withdrawn</span><strong>{ready?"✓ Ready":"Needs review"}</strong></div>
            </div>
          })}
          <div className="sans member-section-title">POSITIONS</div>
          {detail.positions.map(p=><div key={p.id} className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.seats} seat{Number(p.seats)===1?"":"s"} · select {p.min_selections}–{p.max_selections} · {p.candidates.filter(c=>c.status==="active").length} active candidates</span></div>)}
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
          <div className="sans member-section-title" style={{marginTop:16}}>PRE-VOTE CHECKLIST</div>
          {!readiness?<div className="sans election-readiness-loading">Checking election readiness…</div>:<>
            <div className={`sans election-readiness-summary ${readiness.ready?"ready":"blocked"}`}>
              <b>{readiness.ready?"✓ Ready to Open Voting":"Voting Not Ready"}</b>
              <span>{readiness.passed}/{readiness.total} checks passed</span>
            </div>
            <div className="election-readiness-list">
              {readiness.checks.map(check=><div key={check.key} className={`sans election-readiness-check ${check.ok?"pass":"fail"}`}>
                <div><strong>{check.ok?"✓":"!"}</strong><span><b>{check.label}</b><small>{check.detail}</small></span></div>
                {!check.ok&&check.repairable&&<button type="button" disabled={busy} onClick={repairApplicationSync} className="sans election-auto-repair-btn">Fix automatically</button>}
              </div>)}
            </div>
          </>}
          {readiness?.ready&&<div className="sans election-lock-warning">Opening voting creates the voter snapshot and permanently locks election setup.</div>}
          <button type="button" style={{...approveBtn,width:"100%",marginTop:10,opacity:readiness?.ready?1:.5}} disabled={busy||!readiness?.ready} onClick={()=>changeStatus("open")}>
            {readiness?.ready?"Open Voting & Lock Setup":readiness?`Open Voting · ${readiness.passed}/${readiness.total} checks`:"Checking…"}
          </button>
        </>}
        {detail.status==="open"&&<>
          <div className="sans election-voting-lock-banner">
            <b>🔒 Voting setup locked</b>
            <span>The voter snapshot has been created. Positions, candidates, applications and election dates can no longer be changed.</span>
          </div>
          <div className="sans election-secret-note">Secret ballot active. Admins can see turnout, but not individual votes.</div>
          {detail.positions.map(p=><div key={p.id}><div className="election-admin-position"><b className="sans">{p.title}</b><span className="sans">{p.candidates.filter(c=>c.status==="active").length} active · {p.seats} seat{Number(p.seats)===1?"":"s"}</span></div>{p.candidates.map(c=><div key={c.id} className="election-candidate-admin-row locked"><span className="sans"><b>{c.display_name}</b><small>{c.status}</small></span><span className="sans election-locked-label">LOCKED</span></div>)}</div>)}
          <button type="button" style={{...compactBtn,width:"100%",marginTop:10}} disabled={busy} onClick={remindNonVoters}>Remind members who have not voted</button>
          <button type="button" style={{...approveBtn,width:"100%",marginTop:8}} disabled={busy} onClick={()=>changeStatus("close")}>Close voting & calculate results</button>
        </>}
        {detail.status==="closed"&&<>
          {!detail.certified_at&&<div className="sans election-certification pending">{detail.unresolved_ties?.length?`Runoff required · ${detail.unresolved_ties.length} unresolved position${detail.unresolved_ties.length===1?"":"s"}`:"Results calculated · Ready for certification"}</div>}
          {detail.certified_at&&<div className="sans election-certification">✓ Certified by {detail.certified_by_name||"Super Admin"} · Results locked</div>}
          {detail.certified_at&&summary&&<>
            <ElectionSummary summary={summary} adminView/>
            <div className="election-export-actions sans">
              <button type="button" disabled={busy} onClick={exportPdf}>PDF Record</button>
              <button type="button" disabled={busy} onClick={exportCsv}>CSV Record</button>
            </div>
          </>}
          <ElectionResults detail={detail}/>
          {!detail.certified_at&&detail.unresolved_ties?.map(tie=>{
            const activeRunoff=detail.runoffs?.find(r=>Number(r.position_id)===Number(tie.position_id)&&r.status==="open");
            return <div key={`${tie.position_id}-${tie.round_no}`} className="election-runoff-admin">
              <div className="sans"><b>{tie.position_title} · Runoff required</b><span>{tie.candidate_ids.length} tied candidates · {tie.seats_to_fill} seat{Number(tie.seats_to_fill)===1?"":"s"} to fill</span></div>
              {activeRunoff?<><div className="sans election-runoff-turnout">{activeRunoff.turnout?.voted||0}/{activeRunoff.turnout?.eligible||0} voted · Round {activeRunoff.round_no}</div><button type="button" disabled={busy} onClick={()=>closeRunoff(activeRunoff)}>Close runoff</button></>:<button type="button" disabled={busy} onClick={()=>startRunoff(tie)}>Start runoff round {tie.round_no}</button>}
            </div>
          })}
          {!detail.certified_at&&<button type="button" disabled={busy||!!detail.unresolved_ties?.length} onClick={certify} style={{...approveBtn,width:"100%",marginTop:10,opacity:detail.unresolved_ties?.length?.55:1}}>{detail.unresolved_ties?.length?"Resolve runoffs before certification":"Certify results & assign EXCO roles"}</button>}
          {!!detail.audit_history?.length&&<><div className="sans member-section-title" style={{marginTop:16}}>ELECTION AUDIT</div>{detail.audit_history.map(a=><div key={a.id} className="sans election-audit-row"><b>{String(a.action||"").replaceAll("_"," ")}</b><span>{a.admin_name||"system"} · {String(a.created_at||"").replace("T"," ").slice(0,16)}</span></div>)}</>}
        </>}
        {detail.status==="cancelled"&&<div className="sans election-secret-note">This election was cancelled.</div>}
      </>}
    </Modal>}
    {confirmationDialog}
  </>;
}

function notificationEventLabel(key){
  const k=String(key||"");
  if(k==="voting_opened")return "Voting opened";
  if(k==="voting_closing_24h")return "Voting closing reminder";
  if(k.startsWith("manual_voting_reminder"))return "Manual voting reminder";
  if(k.startsWith("runoff_opened"))return "Runoff opened";
  if(k.startsWith("runoff_closing_24h"))return "Runoff closing reminder";
  if(k==="results_certified")return "Results certified";
  if(k==="elected_roles_assigned")return "Elected-role notice";
  if(k.startsWith("new_application_admin"))return "New application → Admin";
  if(k.startsWith("application_submitted_member"))return "Application confirmation";
  if(k.startsWith("application_approved"))return "Application approved";
  if(k.startsWith("application_rejected"))return "Application rejected";
  return k.replaceAll("_"," ");
}

function applicationStatusLabel(a){
  if(a.status==="pending")return "Pending Review";
  if(a.status==="approved")return "Approved Candidate";
  if(a.status==="rejected")return "Rejected";
  if(a.status==="withdrawn")return String(a.review_reason||"").toLowerCase().startsWith("withdrawn by admin")?"Withdrawn by Admin":"Withdrawn";
  return String(a.status||"");
}
function formatElectionDate(value){
  if(!value)return "—";
  return String(value).replace("T"," ").slice(0,16);
}

function ElectionSummary({summary,adminView=false}){
  const e=summary.election||{};
  const fmt=(v)=>v?String(v).replace("T"," ").slice(0,16):"—";
  return <section className="election-summary-card">
    <div className="sans election-summary-title"><b>OFFICIAL ELECTION SUMMARY</b><span>{e.term||"Certified election record"}</span></div>
    <div className="election-summary-grid sans">
      <div><span>Applications</span><b>{fmt(e.applications_open_at)} → {fmt(e.applications_close_at)}</b></div>
      <div><span>Voting</span><b>{fmt(e.voting_open_at)} → {fmt(e.voting_close_at)}</b></div>
      <div><span>Applicants</span><b>{summary.applications?.total||0}</b><small>{summary.applications?.approved||0} approved · {summary.applications?.rejected||0} rejected · {summary.applications?.withdrawn||0} withdrawn</small></div>
      <div><span>Candidates</span><b>{summary.candidates?.active||0} active</b><small>{summary.candidates?.withdrawn||0} withdrawn</small></div>
      <div><span>Turnout</span><b>{summary.turnout?.voted||0}/{summary.turnout?.eligible||0}</b><small>{Number(summary.turnout?.percent||0).toFixed(1)}%</small></div>
      <div><span>Certified</span><b>{fmt(e.certified_at)}</b><small>{e.certified_by_name||"Super Admin"}</small></div>
    </div>
    {!!summary.runoffs?.length&&<div className="election-summary-section">
      <div className="sans member-section-title">RUNOFF HISTORY</div>
      {summary.runoffs.map(r=><div key={r.id} className="sans election-summary-runoff">
        <span><b>{r.position_title} · Round {r.round_no}</b><small>{r.turnout?.voted||0}/{r.turnout?.eligible||0} voted · {r.status}</small></span>
        <strong>{r.candidates?.map(c=>`${c.name} ${c.votes}`).join(" · ")}</strong>
      </div>)}
    </div>}
    {!!summary.assigned_exco_roles?.length&&<div className="election-summary-section">
      <div className="sans member-section-title">ASSIGNED EXCO</div>
      {summary.assigned_exco_roles.map((x,i)=><div key={`${x.member_id}-${i}`} className="sans election-summary-role"><span>{x.role_title}</span><b>{x.name}</b></div>)}
    </div>}
    {adminView&&<div className="sans election-summary-record-note">Read-only governance record · ballot identities are not included.</div>}
  </section>
}

function ElectionResults({detail}){
  return <div><div className="sans member-section-title">RESULTS</div>{detail.positions.map(p=>{
    const ranked=p.candidates.map(c=>{const result=detail.results?.find(r=>Number(r.candidate_id)===Number(c.id));return {...c,votes:Number(result?.votes||0),outcome:result?.outcome||"not_elected"}}).sort((a,b)=>b.votes-a.votes);
    const hasTie=ranked.some(c=>c.outcome==="tie");
    return <div key={p.id} className="election-result-block"><b className="sans">{p.title} · {p.seats} seat{Number(p.seats)===1?"":"s"}</b>{hasTie&&<div className="sans election-tie-note">⚠ Tie at the seat boundary — no automatic winner assigned for tied candidates.</div>}{ranked.map(c=><div key={c.id} className="sans election-result-row"><span>{c.display_name}{c.outcome==="elected"?" ✓ ELECTED":c.outcome==="tie"?" · TIE":c.outcome==="withdrawn"?" · WITHDRAWN":""}</span><strong>{c.votes}</strong></div>)}</div>
  })}</div>
}
