import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, MessageBanner, PageHeader, compactBtn, approveBtn, rejectBtn } from "../components/Shared";
import { formatLocalDateTime } from "../utils/date";
import Pagination, { pageSlice } from "../components/Pagination";

export default function Meetings({admin}){
  const emptyForm={title:"",meeting_date:"",meeting_time:"",venue:"",agenda:"",rsvp_deadline:""};
  const [rows,setRows]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [selected,setSelected]=useState(null);
  const [details,setDetails]=useState(null);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [form,setForm]=useState(emptyForm);
  const [openGroups,setOpenGroups]=useState({yes:true,maybe:false,no:false,pending:true});
  const [minutesData,setMinutesData]=useState(null);
  const [minutesDraft,setMinutesDraft]=useState({minutes:"",decisions:""});
  const [actionDraft,setActionDraft]=useState({description:"",assigned_member_id:"",due_date:""});
  const [memberOptions,setMemberOptions]=useState([]);
  const [page,setPage]=useState(1);
  const role=admin?.role==="owner"?"super_admin":admin?.role;
  const canFinance=role==="super_admin"||role==="treasurer";

  const load=()=>api.admin.meetings().then(setRows).catch(e=>setMessage(e.message));
  useEffect(()=>{load();api.members.list().then(setMemberOptions).catch(()=>{})},[]);
  useEffect(()=>onDataChange(({path})=>{
    if(path?.startsWith("/api/admin/meetings") || path?.startsWith("/api/governance/meetings") || path?.startsWith("/api/governance/meeting-actions") || path?.startsWith("/api/me/meetings")) load();
  }),[]);

  const meetingPage=pageSlice(rows||[],page);

  const fmtMeetingDateTime=(date,time)=>{
    if(!date)return "";
    try{
      const d=new Date(`${date}T${time||"00:00"}:00`);
      const datePart=new Intl.DateTimeFormat("en",{day:"numeric",month:"short",year:"numeric"}).format(d);
      const timePart=time?new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(d):"";
      return timePart?`${datePart} · ${timePart}`:datePart;
    }catch{return `${date}${time?` · ${time}`:""}`}
  };

  const meetingLifecycle=(m)=>{
    if(m.status==="cancelled") return {label:"Cancelled",color:"var(--danger)",bg:"var(--danger-bg)"};
    const now=new Date();
    const when=new Date(`${m.meeting_date}T${m.meeting_time||"00:00"}:00`);
    if(!Number.isNaN(when.getTime()) && when.getTime()<now.getTime()) return {label:"Completed",color:"var(--neutral-text)",bg:"var(--surface-neutral)"};
    if(!m.sent_at && m.status!=="sent") return {label:"Draft",color:"var(--muted)",bg:"var(--surface-warm)"};
    return {label:"Upcoming",color:"var(--success-strong)",bg:"var(--success-bg)"};
  };

  const openDetails=async(m)=>{
    setSelected(m);setDetails(null);setMinutesData(null);setEditing(false);setMessage("");
    try{
      const [detail,minutes]=await Promise.all([api.admin.meeting(m.id),api.governance.meetingMinutes(m.id)]);
      setDetails(detail);setMinutesData(minutes);setMinutesDraft({minutes:minutes?.minutes?.minutes||"",decisions:minutes?.minutes?.decisions||""});
    }catch(e){setMessage(e.message||"Could not load meeting details")}
  };

  const create=async()=>{
    setBusy(true);setMessage("");
    try{
      const meeting=await api.admin.createMeeting(form);
      setShowCreate(false);setForm(emptyForm);await load();
      if(window.confirm("Meeting created. Send Telegram invitations to all active linked members now?")){
        const r=await api.admin.sendMeetingInvites(meeting.id);
        setMessage(`Invitations sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
        await load();
      }
    }catch(e){setMessage(e.message||"Could not create meeting")}finally{setBusy(false)}
  };

  const send=async(m)=>{
    if(!window.confirm(`Send "${m.title}" invitation to all active Telegram-linked members?`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.sendMeetingInvites(m.id);
      setMessage(`Invitations sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
      await load();if(selected?.id===m.id)await openDetails(m);
    }catch(e){setMessage(e.message||"Could not send invitations")}finally{setBusy(false)}
  };

  const beginEdit=()=>{
    if(!details)return;
    setForm({
      title:details.title||"",meeting_date:details.meeting_date||"",meeting_time:details.meeting_time||"",
      venue:details.venue||"",agenda:details.agenda||"",rsvp_deadline:details.rsvp_deadline||""
    });
    setEditing(true);
  };

  const saveEdit=async()=>{
    if(!details)return;
    setBusy(true);setMessage("");
    try{
      const result=await api.admin.updateMeeting(details.id,form);
      setEditing(false);await load();await openDetails(result);
      if(!result.changed){
        setMessage("No changes to save.");
        return;
      }
      const label=result.rescheduled?"Meeting rescheduled.":"Meeting updated.";
      if(details.status==="sent"&&window.confirm(result.rescheduled
        ?"Meeting rescheduled. Notify members of the new date/time now?"
        :"Meeting updated. Notify members of the changes now?")){
        const r=await api.admin.notifyMeetingUpdate(details.id,{
          rescheduled:result.rescheduled,
          previous_date:result.previous_date,
          previous_time:result.previous_time,
          changed_fields:result.changed_fields
        });
        setMessage(`${result.rescheduled?"Reschedule":"Update"} sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
      }else setMessage(label);
    }catch(e){setMessage(e.message||"Could not update meeting")}finally{setBusy(false)}
  };

  const cancelMeeting=async()=>{
    if(!details)return;
    const reason=window.prompt("Reason for cancelling this meeting:");
    if(reason===null)return;
    if(!reason.trim())return setMessage("Cancellation reason is required.");
    if(!window.confirm(`Cancel "${details.title}"? Telegram-linked members will be notified.`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.cancelMeeting(details.id,reason.trim());
      setMessage(`Meeting cancelled · ${r.sent||0} notification${Number(r.sent||0)===1?"":"s"} sent.`);
      await load();await openDetails(r.meeting);
    }catch(e){setMessage(e.message||"Could not cancel meeting")}finally{setBusy(false)}
  };

  const remindPending=async()=>{
    if(!details)return;
    const pending=details.responses?.pending||[];
    const linked=pending.filter(x=>x.telegram_id).length;
    if(!linked)return setMessage("No awaiting members are linked to Telegram.");
    if(!window.confirm(`Send an RSVP reminder to ${linked} awaiting ${linked===1?"member":"members"}?`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.remindMeetingPending(details.id);
      setMessage(`RSVP reminder sent to ${r.sent} member${Number(r.sent)===1?"":"s"}${r.unlinked?` · ${r.unlinked} awaiting member(s) not linked`:""}.`);
      setDetails(await api.admin.meeting(details.id));
      await load();
    }catch(e){setMessage(e.message||"Could not send RSVP reminder")}finally{setBusy(false)}
  };

  const saveMinutes=async()=>{
    if(!details||!canFinance)return;
    setBusy(true);setMessage("");
    try{
      const result=await api.governance.saveMeetingMinutes(details.id,minutesDraft);
      if(!result?.ok||!result?.minutes) throw new Error("Minutes were not confirmed as saved");
      setMinutesData(prev=>({...prev,minutes:result.minutes,actions:prev?.actions||[]}));
      setMinutesDraft({minutes:result.minutes.minutes||"",decisions:result.minutes.decisions||""});
      setMessage(`Meeting minutes saved${result.minutes.updated_at?` · ${formatLocalDateTime(result.minutes.updated_at)}`:""}`);
    }catch(e){setMessage(e.message||"Could not save meeting minutes")}finally{setBusy(false)}
  };
  const addAction=async()=>{
    if(!details||!canFinance||!actionDraft.description.trim())return;
    setBusy(true);setMessage("");
    try{
      const result=await api.governance.addMeetingAction(details.id,{description:actionDraft.description.trim(),assigned_member_id:actionDraft.assigned_member_id?Number(actionDraft.assigned_member_id):null,due_date:actionDraft.due_date||null});
      if(!result?.ok||!result?.action) throw new Error("Action item was not confirmed as saved");
      setMinutesData(prev=>({...prev,actions:[...(prev?.actions||[]),result.action]}));
      setActionDraft({description:"",assigned_member_id:"",due_date:""});
      setMessage("Action item saved");
    }catch(e){setMessage(e.message||"Could not save action item")}finally{setBusy(false)}
  };
  const setActionStatus=async(action,status)=>{
    if(!canFinance)return;try{await api.governance.updateMeetingAction(action.id,{status});setMinutesData(await api.governance.meetingMinutes(details.id))}catch(e){setMessage(e.message)}
  };

  const group=(key,label,list,color)=>{
    const open=openGroups[key];
    return <div style={{borderTop:"1px solid var(--divider)",paddingTop:8,marginTop:8}}>
      <button onClick={()=>setOpenGroups({...openGroups,[key]:!open})} className="sans"
        style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"2px 0 6px",cursor:"pointer"}}>
        <span style={{fontSize:10,fontWeight:700,color,letterSpacing:.3}}>{label} · {list?.length||0}</span>
        <span style={{fontSize:10,color:"var(--soft-2)"}}>{open?"▲":"▼"}</span>
      </button>
      {open&&((list||[]).length===0
        ? <div className="sans" style={{fontSize:10,color:"var(--soft-3)",paddingBottom:4}}>None</div>
        : (list||[]).map(x=><div key={x.id} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,padding:"6px 0",borderBottom:"1px solid var(--divider-3)"}}>
            <span><b>{x.name}</b>{x.member_code?` · ${x.member_code}`:""}</span>
            <span style={{color:"var(--soft-2)",textAlign:"right"}}>
              {x.responded_at?formatLocalDateTime(x.responded_at):x.telegram_id?"Telegram linked":"Not linked"}
            </span>
          </div>))}
    </div>
  };

  return <>
    <PageHeader
      title="Meetings"
      subtitle="Invitations, RSVP and meeting schedule"
      action={<button onClick={()=>{setForm(emptyForm);setShowCreate(true)}} style={{...approveBtn,padding:"9px 12px"}}>+ New meeting</button>}
    />

    <MessageBanner>{message}</MessageBanner>

    {rows===null?<Center>Loading…</Center>:rows.length===0
      ?<div className="sans" style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:18,color:"var(--soft)",fontSize:12}}>No meetings created yet.</div>
      :meetingPage.rows.map(m=>{
        const answered=Number(m.going||0)+Number(m.maybe||0)+Number(m.declined||0);
        const status=meetingLifecycle(m);
        return <div key={m.id} style={{background:"var(--card)",border:`1px solid ${status.label==="Cancelled"?"var(--danger-border-2)":"var(--border)"}`,borderRadius:12,padding:14,marginBottom:10,opacity:status.label==="Cancelled"?.78:1}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:700,fontSize:15}}>{m.title}</div>
              <div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:4}}>{fmtMeetingDateTime(m.meeting_date,m.meeting_time)}{m.venue?` · ${m.venue}`:""}</div>
            </div>
            <span className="sans" style={{fontSize:10,padding:"5px 8px",height:"fit-content",borderRadius:99,background:status.bg,color:status.color}}>{status.label}</span>
          </div>
          {status.label==="Cancelled"&&<div className="sans" style={{fontSize:9,color:"var(--soft)",textTransform:"uppercase",letterSpacing:.5,marginTop:10}}>Final RSVP</div>}
          <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:status.label==="Cancelled"?5:12,textAlign:"center"}}>
            <div><b>{m.going||0}</b><div style={{fontSize:9,color:"var(--soft)"}}>Going</div></div>
            <div><b>{m.maybe||0}</b><div style={{fontSize:9,color:"var(--soft)"}}>Maybe</div></div>
            <div><b>{m.declined||0}</b><div style={{fontSize:9,color:"var(--soft)"}}>Declined</div></div>
            <div><b>{answered}</b><div style={{fontSize:9,color:"var(--soft)"}}>Responded</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:status.label==="Cancelled"?"1fr":"1fr 1fr",gap:7,marginTop:12}}>
            <button onClick={()=>openDetails(m)} style={{...compactBtn,width:"100%",padding:"9px 10px"}}>View details</button>
            {status.label!=="Cancelled"&&<button disabled={busy} onClick={()=>send(m)} style={{...approveBtn,width:"100%",padding:"9px 10px",opacity:busy?.6:1}}>{m.sent_at?"Resend":"Send invite"}</button>}
          </div>
        </div>
      })}
    <Pagination page={meetingPage.page} total={(rows||[]).length} onChange={setPage}/>

    {showCreate&&<Modal title="New meeting" onClose={()=>!busy&&setShowCreate(false)}>
      <Field label="Meeting title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
      <Field label="Date" type="date" value={form.meeting_date} onChange={v=>setForm({...form,meeting_date:v})}/>
      <Field label="Time" type="time" value={form.meeting_time} onChange={v=>setForm({...form,meeting_time:v})}/>
      <Field label="Venue / location" value={form.venue} onChange={v=>setForm({...form,venue:v})}/>
      <label className="sans" style={{display:"block",fontSize:11,color:"var(--muted)",marginBottom:10}}>
        <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
        <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
          style={{width:"100%",padding:"10px 11px",border:"1px solid var(--border-strong-2)",borderRadius:9,background:"var(--card)",fontSize:13,resize:"vertical"}}/>
      </label>
      <Field label="RSVP deadline (optional)" value={form.rsvp_deadline} onChange={v=>setForm({...form,rsvp_deadline:v})}/>
      <button disabled={busy} onClick={create} style={{...approveBtn,width:"100%",padding:"10px 12px",opacity:busy?.6:1}}>{busy?"Creating…":"Create meeting"}</button>
    </Modal>}

    {selected&&<Modal title={details?.title||selected.title} onClose={()=>!busy&&setSelected(null)}>
      {!details?<Center>Loading details…</Center>:editing?<>
        <Field label="Meeting title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
        <Field label="Date" type="date" value={form.meeting_date} onChange={v=>setForm({...form,meeting_date:v})}/>
        <Field label="Time" type="time" value={form.meeting_time} onChange={v=>setForm({...form,meeting_time:v})}/>
        <Field label="Venue / location" value={form.venue} onChange={v=>setForm({...form,venue:v})}/>
        <label className="sans" style={{display:"block",fontSize:11,color:"var(--muted)",marginBottom:10}}>
          <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
          <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
            style={{width:"100%",padding:"10px 11px",border:"1px solid var(--border-strong-2)",borderRadius:9,background:"var(--card)",fontSize:13,resize:"vertical"}}/>
        </label>
        <Field label="RSVP deadline (optional)" value={form.rsvp_deadline} onChange={v=>setForm({...form,rsvp_deadline:v})}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button disabled={busy} onClick={()=>setEditing(false)} style={{...compactBtn,padding:10}}>Cancel edit</button>
          <button disabled={busy} onClick={saveEdit} style={{...approveBtn,padding:10}}>{busy?"Saving…":"Save changes"}</button>
        </div>
      </>:<>
        {(()=>{
          const status=meetingLifecycle(details);
          const yes=details.responses?.yes||[],maybe=details.responses?.maybe||[],no=details.responses?.no||[],pending=details.responses?.pending||[];
          const total=details.total_members||0;
          return <>
            <div style={{background:"var(--bg)",borderRadius:11,padding:12}}>
              <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <span style={{color:"var(--soft)"}}>Status</span>
                <span style={{fontWeight:700,color:status.color,background:status.bg,padding:"3px 7px",borderRadius:99}}>{status.label}</span>
              </div>
              <div className="sans" style={{fontSize:16,fontWeight:700,color:"var(--primary)",marginTop:12}}>{fmtMeetingDateTime(details.meeting_date,details.meeting_time)}</div>
              <div className="sans" style={{fontSize:12,color:"var(--muted)",marginTop:4}}>{details.venue||"Venue not specified"}</div>
              {details.rsvp_deadline&&<div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:6}}>RSVP by {details.rsvp_deadline}</div>}
            </div>

            <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:10,textAlign:"center",background:"var(--card)",border:"1px solid var(--border)",borderRadius:11,padding:"10px 6px"}}>
              <div><b style={{color:"var(--success)"}}>{yes.length}</b><div style={{fontSize:9,color:"var(--soft)"}}>Going</div></div>
              <div><b style={{color:"var(--warning)"}}>{maybe.length}</b><div style={{fontSize:9,color:"var(--soft)"}}>Maybe</div></div>
              <div><b style={{color:"var(--danger)"}}>{no.length}</b><div style={{fontSize:9,color:"var(--soft)"}}>Declined</div></div>
              <div><b>{pending.length}</b><div style={{fontSize:9,color:"var(--soft)"}}>Awaiting</div></div>
            </div>

            {(details.sent_at||details.last_notification_at)&&<div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:9,lineHeight:1.55}}>
              {details.sent_at&&<div>Invitation sent: {formatLocalDateTime(details.sent_at)}</div>}
              {details.last_notification_at&&<div>Last notification: {formatLocalDateTime(details.last_notification_at)}</div>}
            </div>}

            {details.agenda&&<>
              <div className="sans" style={{fontSize:10,fontWeight:700,color:"var(--muted)",marginTop:14,marginBottom:5}}>AGENDA / MESSAGE</div>
              <div className="sans" style={{fontSize:12,lineHeight:1.5,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:11}}>{details.agenda}</div>
            </>}

            <div className="sans" style={{fontSize:10,fontWeight:700,color:"var(--muted)",marginTop:16,marginBottom:6}}>MINUTES & ACTION ITEMS</div>
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:11}}>
              {canFinance?<>
                <label className="sans" style={{display:"block",fontSize:10,color:"var(--soft)",marginBottom:8}}>Minutes<textarea rows={5} value={minutesDraft.minutes} onChange={e=>setMinutesDraft({...minutesDraft,minutes:e.target.value})} style={{width:"100%",marginTop:5,padding:9,border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--bg)",resize:"vertical"}}/></label>
                <label className="sans" style={{display:"block",fontSize:10,color:"var(--soft)",marginBottom:8}}>Decisions<textarea rows={3} value={minutesDraft.decisions} onChange={e=>setMinutesDraft({...minutesDraft,decisions:e.target.value})} style={{width:"100%",marginTop:5,padding:9,border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--bg)",resize:"vertical"}}/></label>
                <button type="button" disabled={busy} onClick={saveMinutes} style={{...approveBtn,width:"100%",padding:9}}>Save minutes</button>
              </>:<div className="sans" style={{fontSize:11,lineHeight:1.5,color:"var(--muted)",whiteSpace:"pre-wrap"}}>{minutesData?.minutes?.minutes||"No minutes recorded."}{minutesData?.minutes?.decisions?`\n\nDecisions\n${minutesData.minutes.decisions}`:""}</div>}
              <div className="sans" style={{fontSize:12,fontWeight:700,letterSpacing:.7,color:"var(--muted)",margin:"14px 0 7px"}}>ACTION ITEMS</div>
              {(minutesData?.actions||[]).map(a=><div key={a.id} className="sans" style={{borderTop:"1px solid var(--divider)",padding:"9px 0",fontSize:12,lineHeight:1.4}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}><span style={{fontWeight:600,textDecoration:a.status==="done"?"line-through":"none"}}>{a.description}</span><span className="sans" style={{fontSize:10,fontWeight:700,textTransform:"capitalize",color:a.status==="done"?"var(--success)":"var(--warning)"}}>{a.status}</span></div><div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:3,lineHeight:1.35}}>{a.member_name?`Assigned: ${a.member_name}`:"Unassigned"}{a.due_date?` · Due ${a.due_date}`:""}</div>{canFinance&&a.status==="open"&&<button type="button" className="sans" onClick={()=>setActionStatus(a,"done")} style={{...compactBtn,padding:"5px 8px",marginTop:6,fontSize:10,fontWeight:600}}>Mark done</button>}</div>)}
              {canFinance&&<div style={{borderTop:"1px solid var(--divider)",marginTop:8,paddingTop:9}}><input className="sans" placeholder="New action item" value={actionDraft.description} onChange={e=>setActionDraft({...actionDraft,description:e.target.value})} style={{width:"100%",padding:9,border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--bg)",marginBottom:6,fontSize:12}}/><div style={{display:"grid",gridTemplateColumns:"1fr 110px",gap:6}}><select className="sans" value={actionDraft.assigned_member_id} onChange={e=>setActionDraft({...actionDraft,assigned_member_id:e.target.value})} style={{minWidth:0,padding:8,border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--bg)",fontSize:12}}><option value="">Unassigned</option>{memberOptions.filter(m=>m.active!==0).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><input className="sans" type="date" value={actionDraft.due_date} onChange={e=>setActionDraft({...actionDraft,due_date:e.target.value})} style={{minWidth:0,padding:8,border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--bg)",fontSize:12}}/></div><button type="button" className="sans" disabled={busy||!actionDraft.description.trim()} onClick={addAction} style={{...approveBtn,width:"100%",padding:8,marginTop:6,fontSize:12}}>Add action item</button></div>}
            </div>

            {details.status==="cancelled"&&<div className="sans" style={{fontSize:11,lineHeight:1.45,background:"var(--danger-bg)",color:"var(--danger)",padding:10,borderRadius:9,marginTop:12}}>
              <b>Cancelled</b>{details.cancelled_at?` · ${formatLocalDateTime(details.cancelled_at)}`:""}<br/>{details.cancel_reason||"Cancelled by admin"}
            </div>}

            <div className="sans" style={{fontSize:10,fontWeight:700,color:"var(--muted)",marginTop:16}}>RSVP DETAILS · {total} ACTIVE MEMBERS</div>
            {group("yes","GOING",yes,"var(--success)")}
            {group("maybe","MAYBE",maybe,"var(--warning)")}
            {group("no","DECLINED",no,"var(--danger)")}
            {group("pending","AWAITING RESPONSE",pending,"var(--muted)")}

            {details.status!=="cancelled"&&<>
              {pending.length>0&&<button disabled={busy} onClick={remindPending} style={{...approveBtn,width:"100%",padding:10,marginTop:14}}>
                Remind awaiting members
              </button>}
              <button disabled={busy} onClick={beginEdit} style={{...compactBtn,width:"100%",padding:10,marginTop:8}}>Edit / reschedule</button>
              {details.sent_at&&<button disabled={busy} onClick={async()=>{
                setBusy(true);setMessage("");
                try{
                  setMessage("Edit the meeting first. Member notifications are offered automatically after a real change.");
                }catch(e){setMessage(e.message)}finally{setBusy(false)}
              }} style={{...compactBtn,width:"100%",padding:10,marginTop:8}}>Changes notify after saving</button>}
              <button disabled={busy} onClick={cancelMeeting} style={{...rejectBtn,width:"100%",padding:10,marginTop:8}}>Cancel meeting</button>
            </>}
          </>;
        })()}
      </>}
    </Modal>}
  </>
}

/* ---------- Settings (admin) ---------- */
