import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, ErrorState, compactBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";
import { approvedContributionSummary } from "../../utils/contributions";

export function MyHistory({ member }) {
  const [statement, setStatement] = useState(()=>member?.id ? api.peekCached(`/api/members/${member.id}/statement`) : null);
  const [error, setError] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    if (!member?.id) return;
    const cached=api.peekCached(`/api/members/${member.id}/statement`);
    setStatement(cached || null); setError("");
    api.members.statement(member.id).then(setStatement).catch((e) => setError(e?.message || "Could not load your statement"));
  }, [member?.id]);

  useEffect(() => onDataChange(() => {
    if (!member?.id) return;
    api.members.statement(member.id).then(setStatement).catch(() => {});
  }), [member?.id]);

  const statuses=statement?.monthly_status||[];
  const statusMonths=useMemo(()=>statuses.map(x=>String(x.month||"")).filter(Boolean),[statuses]);

  useEffect(()=>{
    if(statusMonths.length===0){ setSelectedMonth(""); return; }
    if(selectedMonth && statusMonths.includes(selectedMonth)) return;
    const now=new Date();
    const current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const nearestCurrent=[...statusMonths].filter(month=>month<=current).sort().at(-1);
    setSelectedMonth(statusMonths.includes(current)?current:(nearestCurrent||statusMonths.at(-1)||""));
  },[statusMonths,selectedMonth]);

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!statement) return <HistorySkeleton/>;

  const rows=statement.contributions||[];
  const allocations=statement.allocations||[];
  const allocationsFor=(contributionId)=>allocations
    .filter(a=>Number(a.contribution_id)===Number(contributionId))
    .sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  const {approved,total}=approvedContributionSummary(rows);
  const normalizedStatus=(row)=>String(row?.status||"pending").toLowerCase();
  const reconciliation=statement.reconciliation||null;
  const outstanding=Number(reconciliation?.current_due_total ?? statuses.filter(x=>!x.advance).reduce((sum,x)=>sum+Number(x.due||0),0));
  const advance=Number(reconciliation?.advance_allocated_total ?? statuses.filter(x=>x.advance).reduce((sum,x)=>sum+Number(x.paid||0),0));
  const reconciliationErrors=(reconciliation?.issues||[]).filter(x=>x.severity==="error");
  const recentStatuses=statuses.slice(-12).reverse();
  const monthLabel=(m, long=false)=>{if(!m)return"—";const [y,mo]=String(m).split("-");return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:long?"long":"short",year:"numeric"});};
  const statusColor=(x)=>x==="paid"?"var(--success)":x==="partial"?"var(--warning)":x==="exempt"||x==="not_applicable"?"var(--muted)":"var(--danger)";
  const statusLabel=(x)=>{
    if(!x)return"N/A";
    if(x.status==="not_applicable")return"N/A";
    if(x.advance)return `Advance ${x.status}`;
    return x.status||"unpaid";
  };

  const selectedStatus=statuses.find(x=>String(x.month)===selectedMonth)||null;
  const selectedIndex=statusMonths.indexOf(selectedMonth);
  const expected=selectedStatus && !["exempt","not_applicable"].includes(selectedStatus.status)?Number(selectedStatus.monthly_amount||0):0;
  const selectedPaid=Number(selectedStatus?.paid||0);
  const selectedDue=Number(selectedStatus?.due||0);
  const progress=expected>0?Math.min(100,Math.round((selectedPaid/expected)*100)):0;

  const selectedRows=rows.filter((row)=>{
    const applied=allocationsFor(row.id);
    if(normalizedStatus(row)==="approved" && applied.length>0) return applied.some(a=>String(a.month)===selectedMonth);
    return String(row.month||"")===selectedMonth;
  });
  const filteredRows=selectedRows.filter((row)=>transactionFilter==="all" || normalizedStatus(row)===transactionFilter);
  const transactionCounts=selectedRows.reduce((acc,row)=>{const status=normalizedStatus(row);acc.all+=1;if(status in acc)acc[status]+=1;return acc;},{all:0,approved:0,pending:0,rejected:0});

  const selectAdjacent=(delta)=>{
    const next=statusMonths[selectedIndex+delta];
    if(next){ setSelectedMonth(next); setTransactionFilter("all"); }
  };

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
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>ADVANCE ALLOCATED</div><b className="sans" style={{color:advance>0?"var(--success)":"inherit"}}>MVR {fmt(advance)}</b></div>
    </div>

    {reconciliationErrors.length>0&&<div className="sans member-history-reconciliation-alert">
      <b>Contribution allocation needs review</b>
      <span>Your approved contribution total does not fully match the monthly allocation records. The fund administrator should review this account.</span>
    </div>}

    <div className="sans member-section-head"><b>MONTHLY VIEW</b><div style={{display:"flex",gap:6}}><button type="button" onClick={async()=>{const {exportStatementPdf}=await import("../../utils/exports");return exportStatementPdf(member)}} style={compactBtn}>PDF</button><button type="button" onClick={async()=>{const {exportStatementCsv}=await import("../../utils/exports");return exportStatementCsv(member)}} style={compactBtn}>CSV</button></div></div>

    {selectedStatus&&<div className="member-history-month-card sans">
      <div className="member-history-month-nav">
        <button type="button" onClick={()=>selectAdjacent(-1)} disabled={selectedIndex<=0} aria-label="Previous month"><ChevronLeft size={20}/></button>
        <strong>{monthLabel(selectedMonth,true)}</strong>
        <button type="button" onClick={()=>selectAdjacent(1)} disabled={selectedIndex<0||selectedIndex>=statusMonths.length-1} aria-label="Next month"><ChevronRight size={20}/></button>
      </div>
      <div className="member-history-month-summary">
        <div>
          <span>{selectedStatus.advance?"Allocated":"Paid"}</span>
          <strong>MVR {fmt(selectedPaid)} <small>/ {fmt(expected)}</small></strong>
        </div>
        <b className="member-status-badge" style={{color:statusColor(selectedStatus.status),borderColor:statusColor(selectedStatus.status)}}>{statusLabel(selectedStatus)}</b>
      </div>
      {expected>0&&<div className="member-history-month-progress" aria-label={`${progress}% paid`}><span style={{width:`${progress}%`}}/></div>}
      <div className="member-history-month-meta">
        {selectedStatus.status==="exempt"?<span>Contribution exempt{selectedStatus.reason?` · ${selectedStatus.reason}`:""}</span>:
         selectedStatus.status==="not_applicable"?<span>Contribution not applicable for this month</span>:
         selectedDue>0?<span>{selectedStatus.advance?"Remaining":"Due"} MVR {fmt(selectedDue)}</span>:
         <span>{selectedStatus.advance?"Advance allocation complete":"Monthly contribution complete"}</span>}
      </div>
    </div>}

    <div className="sans member-section-head"><b>RECENT MONTHS</b><span>Latest 12 months</span></div>
    <div className="member-history-recent-card">
      {recentStatuses.map(x=><button type="button" key={x.month} onClick={()=>{setSelectedMonth(String(x.month));setTransactionFilter("all");}} className={`sans member-history-status-row${x.advance?" advance":""}${String(x.month)===selectedMonth?" selected":""}`}>
        <span>{monthLabel(x.month)}{x.advance&&<small className="member-history-advance-label">Advance</small>}</span>
        <span style={{textAlign:"right"}}><b className="member-status-badge" style={{color:statusColor(x.status),borderColor:statusColor(x.status)}}>{statusLabel(x)}</b><span className="member-history-status-meta">{x.advance?"Allocated":"Paid"} MVR {fmt(x.paid)}{Number(x.due)>0?` · ${x.advance?"Remaining":"Due"} MVR ${fmt(x.due)}`:""}</span></span>
      </button>)}
    </div>

    <div className="sans member-section-title">TRANSACTIONS · {monthLabel(selectedMonth).toUpperCase()}</div>
    <div className="member-history-filters" role="group" aria-label="Filter contribution transactions">
      {[["all","All"],["approved","Approved"],["pending","Pending"],["rejected","Rejected"]].map(([value,label])=>
        <button key={value} type="button" onClick={()=>setTransactionFilter(value)}
          className={`sans member-history-filter${transactionFilter===value?" active":""}`} aria-pressed={transactionFilter===value}>
          <span>{label}</span><b>{transactionCounts[value]||0}</b>
        </button>)}
    </div>

    {filteredRows.map((h)=>{const applied=allocationsFor(h.id);const selectedAllocation=applied.filter(a=>String(a.month)===selectedMonth);return <div key={h.id} className="member-history-transaction">
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><div><div className="sans" style={{fontSize:14,fontWeight:600}}>{monthLabel(h.month)}</div><div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>{h.txn_id}{h.ref_number?` · Bank ref: ${h.ref_number}`:""}</div></div><div style={{textAlign:"right"}}><div className="sans" style={{fontSize:14,fontWeight:600}}>MVR {fmt(h.amount)}</div><span className="sans" style={{color:h.status==="approved"?"var(--success)":h.status==="reversed"?"var(--warning)":"var(--muted)",fontSize:10,fontWeight:600,textTransform:"capitalize"}}>{h.status||"pending"}</span></div></div>
      {h.status==="approved"&&applied.length>0&&<div className="member-history-allocation-breakdown sans">
        <div className="member-history-allocation-title">PAYMENT ALLOCATION</div>
        {(selectedAllocation.length?selectedAllocation:applied).map((a)=><div key={`${h.id}-${a.month}`} className="member-history-allocation-row"><span>{monthLabel(a.month)}{String(a.month)>String(h.month)?<small>Advance allocation</small>:null}</span><b>MVR {fmt(a.amount)}</b></div>)}
      </div>}
    </div>})}
    {selectedRows.length===0&&<EmptyState>No contribution transactions for {monthLabel(selectedMonth,true)}.</EmptyState>}
    {selectedRows.length>0&&filteredRows.length===0&&<EmptyState>No {transactionFilter} contributions for {monthLabel(selectedMonth,true)}.</EmptyState>}
  </>;
}

function HistorySkeleton(){return <div aria-label="Loading statement" aria-busy="true"><div className="skeleton-block" style={{height:105,borderRadius:16,marginBottom:12}}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>{[1,2,3,4].map(i=><div key={i} className="skeleton-block" style={{height:70,borderRadius:12}}/>)}</div><div className="skeleton-block" style={{height:190,borderRadius:12,marginBottom:14}}/><div className="skeleton-block" style={{height:180,borderRadius:12}}/></div>;}
