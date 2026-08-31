import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, MessageBanner, PageHeader, compactBtn, approveBtn, rejectBtn } from "../components/Shared";
import { formatLocalDateTime } from "../utils/date";

export default function Meetings(){
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

  const load=()=>api.admin.meetings().then(setRows).catch(e=>setMessage(e.message));
  useEffect(()=>{load()},[]);

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
    if(m.status==="cancelled") return {label:"Cancelled",color:"#A6432F",bg:"#FDEDE8"};
    const now=new Date();
    const when=new Date(`${m.meeting_date}T${m.meeting_time||"00:00"}:00`);
    if(!Number.isNaN(when.getTime()) && when.getTime()<now.getTime()) return {label:"Completed",color:"#51606A",bg:"#EEF0F1"};
    if(!m.sent_at && m.status!=="sent") return {label:"Draft",color:"#6B7268",bg:"#F3F0E7"};
    return {label:"Upcoming",color:"#315C35",bg:"#EAF1EE"};
  };

  const openDetails=async(m)=>{
    setSelected(m);setDetails(null);setEditing(false);setMessage("");
    try{setDetails(await api.admin.meeting(m.id))}
    catch(e){setMessage(e.message||"Could not load meeting details")}
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

  const group=(key,label,list,color)=>{
    const open=openGroups[key];
    return <div style={{borderTop:"1px solid #F0EDE3",paddingTop:8,marginTop:8}}>
      <button onClick={()=>setOpenGroups({...openGroups,[key]:!open})} className="sans"
        style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"2px 0 6px",cursor:"pointer"}}>
        <span style={{fontSize:10,fontWeight:700,color,letterSpacing:.3}}>{label} · {list?.length||0}</span>
        <span style={{fontSize:10,color:"#9A9384"}}>{open?"▲":"▼"}</span>
      </button>
      {open&&((list||[]).length===0
        ? <div className="sans" style={{fontSize:10,color:"#A7A195",paddingBottom:4}}>None</div>
        : (list||[]).map(x=><div key={x.id} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,padding:"6px 0",borderBottom:"1px solid #F5F1E8"}}>
            <span><b>{x.name}</b>{x.member_code?` · ${x.member_code}`:""}</span>
            <span style={{color:"#9A9384",textAlign:"right"}}>
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
      ?<div className="sans" style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:18,color:"#8A9086",fontSize:12}}>No meetings created yet.</div>
      :rows.map(m=>{
        const answered=Number(m.going||0)+Number(m.maybe||0)+Number(m.declined||0);
        const status=meetingLifecycle(m);
        return <div key={m.id} style={{background:"#fff",border:`1px solid ${status.label==="Cancelled"?"#EFD5CF":"#E9E4D8"}`,borderRadius:12,padding:14,marginBottom:10,opacity:status.label==="Cancelled"?.78:1}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:700,fontSize:15}}>{m.title}</div>
              <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:4}}>{fmtMeetingDateTime(m.meeting_date,m.meeting_time)}{m.venue?` · ${m.venue}`:""}</div>
            </div>
            <span className="sans" style={{fontSize:10,padding:"5px 8px",height:"fit-content",borderRadius:99,background:status.bg,color:status.color}}>{status.label}</span>
          </div>
          <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:12,textAlign:"center"}}>
            <div><b>{m.going||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Going</div></div>
            <div><b>{m.maybe||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Maybe</div></div>
            <div><b>{m.declined||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Declined</div></div>
            <div><b>{answered}</b><div style={{fontSize:9,color:"#8A9086"}}>Responded</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:status.label==="Cancelled"?"1fr":"1fr 1fr",gap:7,marginTop:12}}>
            <button onClick={()=>openDetails(m)} style={{...compactBtn,width:"100%",padding:"9px 10px"}}>View details</button>
            {status.label!=="Cancelled"&&<button disabled={busy} onClick={()=>send(m)} style={{...approveBtn,width:"100%",padding:"9px 10px",opacity:busy?.6:1}}>{m.sent_at?"Resend":"Send invite"}</button>}
          </div>
        </div>
      })}

    {showCreate&&<Modal title="New meeting" onClose={()=>!busy&&setShowCreate(false)}>
      <Field label="Meeting title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
      <Field label="Date" type="date" value={form.meeting_date} onChange={v=>setForm({...form,meeting_date:v})}/>
      <Field label="Time" type="time" value={form.meeting_time} onChange={v=>setForm({...form,meeting_time:v})}/>
      <Field label="Venue / location" value={form.venue} onChange={v=>setForm({...form,venue:v})}/>
      <label className="sans" style={{display:"block",fontSize:11,color:"#6B7268",marginBottom:10}}>
        <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
        <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
          style={{width:"100%",padding:"10px 11px",border:"1px solid #DED8CA",borderRadius:9,background:"#fff",fontSize:13,resize:"vertical"}}/>
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
        <label className="sans" style={{display:"block",fontSize:11,color:"#6B7268",marginBottom:10}}>
          <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
          <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
            style={{width:"100%",padding:"10px 11px",border:"1px solid #DED8CA",borderRadius:9,background:"#fff",fontSize:13,resize:"vertical"}}/>
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
            <div style={{background:"#F7F5EF",borderRadius:11,padding:12}}>
              <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <span style={{color:"#8A9086"}}>Status</span>
                <span style={{fontWeight:700,color:status.color,background:status.bg,padding:"3px 7px",borderRadius:99}}>{status.label}</span>
              </div>
              <div className="sans" style={{fontSize:16,fontWeight:700,color:"#1F3D2B",marginTop:12}}>{fmtMeetingDateTime(details.meeting_date,details.meeting_time)}</div>
              <div className="sans" style={{fontSize:12,color:"#6B7268",marginTop:4}}>{details.venue||"Venue not specified"}</div>
              {details.rsvp_deadline&&<div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:6}}>RSVP by {details.rsvp_deadline}</div>}
            </div>

            <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:10,textAlign:"center",background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:"10px 6px"}}>
              <div><b style={{color:"#3A6B3E"}}>{yes.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Going</div></div>
              <div><b style={{color:"#7A5A18"}}>{maybe.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Maybe</div></div>
              <div><b style={{color:"#A6432F"}}>{no.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Declined</div></div>
              <div><b>{pending.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Awaiting</div></div>
            </div>

            {(details.sent_at||details.last_notification_at)&&<div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:9,lineHeight:1.55}}>
              {details.sent_at&&<div>Invitation sent: {formatLocalDateTime(details.sent_at)}</div>}
              {details.last_notification_at&&<div>Last notification: {formatLocalDateTime(details.last_notification_at)}</div>}
            </div>}

            {details.agenda&&<>
              <div className="sans" style={{fontSize:10,fontWeight:700,color:"#6B7268",marginTop:14,marginBottom:5}}>AGENDA / MESSAGE</div>
              <div className="sans" style={{fontSize:12,lineHeight:1.5,background:"#fff",border:"1px solid #E9E4D8",borderRadius:10,padding:11}}>{details.agenda}</div>
            </>}

            {details.status==="cancelled"&&<div className="sans" style={{fontSize:11,lineHeight:1.45,background:"#FDEDE8",color:"#A6432F",padding:10,borderRadius:9,marginTop:12}}>
              <b>Cancelled</b>{details.cancelled_at?` · ${formatLocalDateTime(details.cancelled_at)}`:""}<br/>{details.cancel_reason||"Cancelled by admin"}
            </div>}

            <div className="sans" style={{fontSize:10,fontWeight:700,color:"#6B7268",marginTop:16}}>RSVP DETAILS · {total} ACTIVE MEMBERS</div>
            {group("yes","GOING",yes,"#3A6B3E")}
            {group("maybe","MAYBE",maybe,"#7A5A18")}
            {group("no","DECLINED",no,"#A6432F")}
            {group("pending","AWAITING RESPONSE",pending,"#6B7268")}

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
