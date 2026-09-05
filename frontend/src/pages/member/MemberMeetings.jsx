import React, { useEffect, useState } from "react";
import { CalendarDays, Check, Clock3, MapPin } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, ErrorState, primaryBtn, secondaryBtn } from "../../components/Shared";

export function MemberMeetings() {
  const [rows, setRows] = useState(()=>api.peekCached("/api/me/meetings"));
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = ({ silent = false } = {}) => {
    if (!silent) { setRows((current)=>current || api.peekCached("/api/me/meetings")); setError(""); }
    return api.myMeetings().then(setRows).catch((e) => { if (!silent) setError(e?.message || "Could not load meetings"); });
  };

  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(() => load({ silent: true })), []);

  const rsvp = async (id, response) => {
    setBusyId(id); setError("");
    try { await api.rsvpMeeting(id, response); await load({ silent: true }); }
    catch (e) { setError(e?.message || "Could not save RSVP"); }
    finally { setBusyId(null); }
  };

  if (error && rows === null) return <ErrorState onRetry={() => load()}>{error}</ErrorState>;
  if (rows === null) return <MeetingsSkeleton/>;

  const now = new Date();
  const upcoming = rows.filter((m) => {
    if (m.status === "cancelled") return false;
    const d = new Date(`${m.meeting_date || "1970-01-01"}T${m.meeting_time || "00:00"}`);
    return !Number.isNaN(d.getTime()) && d >= now;
  });
  const past = rows.filter((m) => !upcoming.includes(m));

  return <>
    <div className="member-page-heading">
      <div className="sans">Meetings</div>
      <span className="sans">Invitations, RSVP, minutes and decisions</span>
    </div>

    {error && <div className="sans member-inline-error">{error}</div>}

    {upcoming.map((m) => <MeetingCard key={m.id} m={m} busy={busyId===m.id} onRsvp={rsvp} upcoming />)}
    {!upcoming.length && <EmptyState>No upcoming meetings.</EmptyState>}

    {!!past.length && <div className="sans member-section-title" style={{marginTop:18}}>PAST / CANCELLED</div>}
    {past.map((m) => <MeetingCard key={m.id} m={m} busy={busyId===m.id} onRsvp={rsvp} />)}
  </>;
}

function MeetingCard({m,busy,onRsvp,upcoming=false}) {
  const cancelled=m.status==="cancelled";
  return <article className={`member-meeting-card${upcoming?" upcoming":""}${cancelled?" cancelled":""}`}>
    <div className="member-meeting-top">
      <div style={{minWidth:0}}>
        <div className="member-meeting-title">{m.title}</div>
        <div className="sans member-meeting-datetime"><CalendarDays size={13}/><span>{m.meeting_date}</span><Clock3 size={13}/><span>{m.meeting_time}</span></div>
        {m.venue && <div className="sans member-meeting-venue"><MapPin size={13}/><span>{m.venue}</span></div>}
      </div>
      <span className={`sans member-meeting-status ${cancelled?"cancelled":upcoming?"upcoming":"past"}`}>{cancelled?"Cancelled":upcoming?"Upcoming":"Past"}</span>
    </div>

    {m.agenda && <div className="sans member-meeting-agenda"><b>Agenda</b><span>{m.agenda}</span></div>}
    {m.cancel_reason && <div className="sans member-meeting-cancel">Cancelled: {m.cancel_reason}</div>}

    {!cancelled && upcoming && <div className="member-rsvp-wrap">
      <div className="sans member-rsvp-label">YOUR RSVP</div>
      <div className="member-rsvp-grid">
        {[["yes","Going"],["maybe","Maybe"],["no","Decline"]].map(([value,label]) =>
          <button key={value} type="button" disabled={busy} onClick={()=>onRsvp(m.id,value)} className={m.rsvp===value?"member-rsvp active":"member-rsvp"}>
            {m.rsvp===value && <Check size={13}/>} {label}
          </button>)}
      </div>
    </div>}

    {(m.minutes || m.decisions) && <div className="member-meeting-notes">
      {m.minutes && <div className="sans"><b>Minutes</b><span>{m.minutes}</span></div>}
      {m.decisions && <div className="sans"><b>Decisions</b><span>{m.decisions}</span></div>}
    </div>}
  </article>;
}

function MeetingsSkeleton(){
  return <div aria-label="Loading meetings" aria-busy="true"><div className="skeleton-block" style={{width:"38%",height:20,marginBottom:7}}/><div className="skeleton-block" style={{width:"65%",height:11,marginBottom:16}}/>{[1,2,3].map(i=><div key={i} className="skeleton-block" style={{height:150,borderRadius:12,marginBottom:9}}/>)}</div>;
}
