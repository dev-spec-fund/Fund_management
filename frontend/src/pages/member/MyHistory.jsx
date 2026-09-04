import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { EmptyState, ErrorState, compactBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";
import { approvedContributionSummary } from "../../utils/contributions";

export function MyHistory({ member }) {
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("all");
  useEffect(() => {
    if (!member?.id) return;
    setStatement(null); setError("");
    api.members.statement(member.id).then(setStatement).catch((e) => setError(e?.message || "Could not load your statement"));
  }, [member?.id]);
  useEffect(() => onDataChange(() => {
    if (!member?.id) return;
    api.members.statement(member.id).then(setStatement).catch(() => {});
  }), [member?.id]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!statement) return <HistorySkeleton/>;
  const rows=statement.contributions||[];
  const {approved,total}=approvedContributionSummary(rows);
  const normalizedStatus=(row)=>String(row?.status||"pending").toLowerCase();
  const filteredRows=rows.filter((row)=>transactionFilter==="all" || normalizedStatus(row)===transactionFilter);
  const transactionCounts=rows.reduce((acc,row)=>{const status=normalizedStatus(row);acc.all+=1;if(status in acc)acc[status]+=1;return acc;},{all:0,approved:0,pending:0,rejected:0});
  const statuses=statement.monthly_status||[];
  const outstanding=statuses.reduce((sum,x)=>sum+Number(x.due||0),0);
  const advance=Math.max(0,total-statuses.reduce((sum,x)=>sum+Number(x.paid||0),0));
  const recentStatuses=statuses.slice(-12).reverse();
  const monthLabel=(m)=>{if(!m)return"—";const [y,mo]=String(m).split("-");return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:"short",year:"numeric"});};
  const statusColor=(x)=>x==="paid"?"var(--success)":x==="partial"?"var(--warning)":x==="exempt"?"var(--muted)":"var(--danger)";
  return <>
    <div className="theme-brand-surface" style={{background:"var(--primary)",borderRadius:16,padding:"20px 22px",marginBottom:12,color:"var(--on-primary)"}}>
      <div className="sans" style={{fontSize:11,opacity:.62,letterSpacing:1.1}}>MY MEMBER ACCOUNT</div>
      <div style={{fontSize:28,fontWeight:600,marginTop:4}}>{statement.member?.member_code||member?.member_code||"—"}</div>
      <div className="sans" style={{fontSize:13,opacity:.72,marginTop:4}}>{statement.member?.name||member?.name} · MVR {fmt(statement.member?.monthly_amount||member?.monthly_amount)}/month</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>TOTAL CONTRIBUTED</div><b className="sans">MVR {fmt(total)}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>OUTSTANDING</div><b className="sans" style={{color:outstanding>0?"var(--danger)":"var(--success)"}}>MVR {fmt(outstanding)}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>APPROVED PAYMENTS</div><b className="sans">{approved.length}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>ADVANCE</div><b className="sans" style={{color:advance>0?"var(--success)":"inherit"}}>MVR {fmt(advance)}</b></div>
    </div>
    <div className="sans member-section-head"><b>MONTHLY STATUS</b><div style={{display:"flex",gap:6}}><button type="button" onClick={async()=>{const {exportStatementPdf}=await import("../../utils/exports");return exportStatementPdf(member)}} style={compactBtn}>PDF</button><button type="button" onClick={async()=>{const {exportStatementCsv}=await import("../../utils/exports");return exportStatementCsv(member)}} style={compactBtn}>CSV</button></div></div>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"4px 14px",marginBottom:16}}>
      {recentStatuses.map(x=><div key={x.month} className="sans member-history-status-row"><span>{monthLabel(x.month)}</span><span style={{textAlign:"right"}}><b className="member-status-badge" style={{color:statusColor(x.status),borderColor:statusColor(x.status)}}>{x.status}</b><div style={{fontSize:10,color:"var(--soft)"}}>Paid MVR {fmt(x.paid)}{Number(x.due)>0?` · Due MVR ${fmt(x.due)}`:""}</div></span></div>)}
    </div>
    <div className="sans member-section-title">CONTRIBUTION TRANSACTIONS</div>
    <div className="member-history-filters" role="group" aria-label="Filter contribution transactions">
      {[["all","All"],["approved","Approved"],["pending","Pending"],["rejected","Rejected"]].map(([value,label])=>
        <button key={value} type="button" onClick={()=>setTransactionFilter(value)}
          className={`sans member-history-filter${transactionFilter===value?" active":""}`} aria-pressed={transactionFilter===value}>
          <span>{label}</span><b>{transactionCounts[value]||0}</b>
        </button>)}
    </div>
    {filteredRows.map((h)=><div key={h.id} className="member-history-transaction">
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><div><div className="sans" style={{fontSize:14,fontWeight:600}}>{monthLabel(h.month)}</div><div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>{h.txn_id}{h.ref_number?` · Bank ref: ${h.ref_number}`:""}</div></div><div style={{textAlign:"right"}}><div className="sans" style={{fontSize:14,fontWeight:600}}>MVR {fmt(h.amount)}</div><span className="sans" style={{color:h.status==="approved"?"var(--success)":h.status==="reversed"?"var(--warning)":"var(--muted)",fontSize:10,fontWeight:600,textTransform:"capitalize"}}>{h.status||"pending"}</span></div></div>
    </div>)}
    {rows.length===0&&<EmptyState>No contributions yet — send a slip photo to the bot to get started.</EmptyState>}
    {rows.length>0&&filteredRows.length===0&&<EmptyState>No {transactionFilter} contributions.</EmptyState>}
  </>;
}

function HistorySkeleton(){return <div aria-label="Loading statement" aria-busy="true"><div className="skeleton-block" style={{height:105,borderRadius:16,marginBottom:12}}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>{[1,2,3,4].map(i=><div key={i} className="skeleton-block" style={{height:70,borderRadius:12}}/>)}</div><div className="skeleton-block" style={{height:220,borderRadius:12,marginBottom:14}}/><div className="skeleton-block" style={{height:80,borderRadius:12}}/></div>;}

