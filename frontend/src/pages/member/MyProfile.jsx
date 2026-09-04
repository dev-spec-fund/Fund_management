import React, { useEffect, useState } from "react";
import { CalendarDays, Download, FileText, Phone, UserRound } from "lucide-react";
import { api, onDataChange } from "../../api";
import { ErrorState, smallBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";
import { approvedContributionSummary } from "../../utils/contributions";

export function MyProfile({ member, setTab }) {
  const [dashboard, setDashboard] = useState(null);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");

  const load=({silent=false}={})=>{
    if(!silent){setDashboard(null);setStatement(null);setError("");}
    return Promise.all([
      api.myDashboard(),
      member?.id ? api.members.statement(member.id) : Promise.resolve(null),
    ]).then(([nextDashboard,nextStatement])=>{
      setDashboard(nextDashboard);
      setStatement(nextStatement);
    }).catch(e=>{if(!silent)setError(e?.message||"Could not load membership details");});
  };

  useEffect(()=>{load();},[member?.id]);
  useEffect(()=>onDataChange(()=>load({silent:true})),[member?.id]);

  if(error && !dashboard) return <ErrorState onRetry={()=>load()}>{error}</ErrorState>;
  if(!dashboard) return <MembershipSkeleton/>;

  const m=dashboard.member || statement?.member || member || {};
  const c=dashboard.contribution || {};
  const contributions=statement?.contributions || [];
  const {approved,total:totalContributed}=approvedContributionSummary(contributions);
  const statuses=statement?.monthly_status || [];
  const outstanding=statuses.reduce((sum,row)=>sum+Number(row.due||0),0);
  const pendingCount=dashboard.pending_payments?.length || 0;
  const status=String(c.status||"unpaid").toLowerCase();
  const statusLabel=status==="paid"?"Paid":status==="partial"?"Partial":status==="exempt"?"Exempt":"Unpaid";
  const statusColor=status==="paid"?"var(--success)":status==="partial"?"var(--warning)":status==="exempt"?"var(--muted)":"var(--danger)";
  const joined=formatJoinedDate(m.joined_at||m.created_at);

  const exportPdf=async()=>{
    const {exportStatementPdf}=await import("../../utils/exports");
    return exportStatementPdf(m);
  };
  const exportCsv=async()=>{
    const {exportStatementCsv}=await import("../../utils/exports");
    return exportStatementCsv(m);
  };

  return <>
    <section className="member-profile-hero">
      <div className="member-profile-avatar"><UserRound size={22}/></div>
      <div style={{minWidth:0,flex:1}}>
        <div className="sans member-profile-kicker">MY MEMBERSHIP</div>
        <div className="member-profile-name">{m.name || "Member"}</div>
        <div className="sans member-profile-code">{m.member_code || "—"}</div>
      </div>
      <div className="sans member-profile-status" style={{color:statusColor}}>
        {status==="paid"?"✓ ":""}{statusLabel}
      </div>
    </section>

    <section className="member-profile-summary-grid">
      <SummaryCard label="MONTHLY CONTRIBUTION" value={`MVR ${fmt(c.monthly_amount||m.monthly_amount||0)}`}/>
      <SummaryCard label="PAID THIS MONTH" value={`MVR ${fmt(c.paid||0)}`} tone={Number(c.paid||0)>0?"success":""}/>
      <SummaryCard label="TOTAL CONTRIBUTED" value={`MVR ${fmt(totalContributed)}`} tone="success"/>
      <SummaryCard label="OUTSTANDING" value={`MVR ${fmt(outstanding)}`} tone={outstanding>0?"danger":"success"}/>
    </section>

    {pendingCount>0 && <div className="sans member-profile-pending">
      {pendingCount} payment submission{pendingCount===1?" is":"s are"} awaiting approval.
    </div>}

    <section className="member-profile-card">
      <div className="sans member-profile-section-title">MEMBERSHIP DETAILS</div>
      <ProfileRow icon={<Phone size={14}/>} label="Phone" value={m.phone||"Not added"}/>
      <ProfileRow icon={<CalendarDays size={14}/>} label="Joined" value={joined}/>
      <ProfileRow label="Current month" value={dashboard.month||"—"}/>
      <ProfileRow label="Remaining this month" value={`MVR ${fmt(c.due||0)}`}/>
      <ProfileRow label="Approved payments" value={String(approved.length)} last/>
    </section>

    <section className="member-profile-card">
      <div className="sans member-profile-section-head">
        <div>
          <div className="member-profile-section-title" style={{marginBottom:2}}>MY STATEMENT</div>
          <div className="member-profile-section-subtitle">Contribution history, monthly status and balances</div>
        </div>
        <FileText size={18} style={{color:"var(--primary)"}}/>
      </div>
      <button type="button" onClick={()=>setTab?.("history")} className="member-profile-statement-button">
        <span>View my statement</span><strong>›</strong>
      </button>
      <div className="member-profile-export-row">
        <button type="button" onClick={exportPdf} style={{...smallBtn,flex:1}}><Download size={13}/> PDF</button>
        <button type="button" onClick={exportCsv} style={{...smallBtn,flex:1}}><Download size={13}/> CSV</button>
      </div>
    </section>

    {dashboard.next_meeting && <section className="member-profile-card">
      <div className="sans member-profile-section-title">NEXT MEETING</div>
      <div style={{fontSize:16,fontWeight:600}}>{dashboard.next_meeting.title}</div>
      <div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:5,lineHeight:1.5}}>
        {dashboard.next_meeting.meeting_date} · {dashboard.next_meeting.meeting_time}
        {dashboard.next_meeting.venue?` · ${dashboard.next_meeting.venue}`:""}
      </div>
    </section>}
  </>;
}

function SummaryCard({label,value,tone=""}){
  const color=tone==="success"?"var(--success)":tone==="danger"?"var(--danger)":"var(--text)";
  return <div className="member-profile-summary-card">
    <div className="sans member-profile-summary-label">{label}</div>
    <div className="sans member-profile-summary-value" style={{color}}>{value}</div>
  </div>;
}

function ProfileRow({icon,label,value,last=false}){
  return <div className="sans member-profile-row" style={{borderBottom:last?0:undefined}}>
    <span className="member-profile-row-label">{icon}<span>{label}</span></span>
    <strong>{value}</strong>
  </div>;
}

function MembershipSkeleton(){
  return <div aria-label="Loading membership" aria-busy="true">
    <div className="skeleton-block" style={{height:100,borderRadius:16,marginBottom:10}}/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
      {[1,2,3,4].map(i=><div key={i} className="skeleton-block" style={{height:76,borderRadius:12}}/> )}
    </div>
    <div className="skeleton-block" style={{height:190,borderRadius:12,marginBottom:10}}/>
    <div className="skeleton-block" style={{height:145,borderRadius:12}}/>
  </div>;
}

function formatJoinedDate(value){
  if(!value)return "—";
  const raw=String(value).trim();
  try{
    let date;
    const dateOnly=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(dateOnly){
      date=new Date(Date.UTC(Number(dateOnly[1]),Number(dateOnly[2])-1,Number(dateOnly[3])));
    }else{
      date=new Date(raw.includes("T")?raw:raw.replace(" ","T")+"Z");
    }
    if(Number.isNaN(date.getTime()))return raw.slice(0,10);
    return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(date);
  }catch{return raw.slice(0,10);}
}
