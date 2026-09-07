import React, { useEffect, useState } from "react";
import { CalendarRange, CheckCircle2, Clock3, Download, History, WalletCards } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, ErrorState } from "../../components/Shared";
import { fmt } from "../../utils/format";
import { approvedContributionSummary } from "../../utils/contributions";

export function MyHistory({ member }) {
  const [statement, setStatement] = useState(()=>member?.id ? api.peekCached(`/api/members/${member.id}/statement`) : null);
  const [error, setError] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("all");

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

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!statement) return <HistorySkeleton/>;

  const rows=statement.contributions||[];
  const allocations=statement.allocations||[];
  const allocationsFor=(contributionId)=>allocations
    .filter(a=>Number(a.contribution_id)===Number(contributionId))
    .sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  const {approved,total}=approvedContributionSummary(rows);
  const normalizedStatus=(row)=>String(row?.status||"pending").toLowerCase();
  const filteredRows=rows.filter((row)=>transactionFilter==="all" || normalizedStatus(row)===transactionFilter);
  const transactionCounts=rows.reduce((acc,row)=>{const status=normalizedStatus(row);acc.all+=1;if(status in acc)acc[status]+=1;return acc;},{all:0,approved:0,pending:0,rejected:0});
  const statuses=statement.monthly_status||[];
  const reconciliation=statement.reconciliation||null;
  const outstanding=Number(reconciliation?.current_due_total ?? statuses.filter(x=>!x.advance).reduce((sum,x)=>sum+Number(x.due||0),0));
  const advance=Number(reconciliation?.advance_allocated_total ?? statuses.filter(x=>x.advance).reduce((sum,x)=>sum+Number(x.paid||0),0));
  const reconciliationErrors=(reconciliation?.issues||[]).filter(x=>x.severity==="error");
  const recentStatuses=statuses.slice(-12).reverse();
  const monthLabel=(m)=>{if(!m)return"—";const [y,mo]=String(m).split("-");return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:"short",year:"numeric"});};
  const statusColor=(x)=>x==="paid"?"var(--success)":x==="partial"?"var(--warning)":x==="exempt"||x==="not_applicable"?"var(--muted)":"var(--danger)";

  const exportPdf=async()=>{const {exportStatementPdf}=await import("../../utils/exports");return exportStatementPdf(member);};
  const exportCsv=async()=>{const {exportStatementCsv}=await import("../../utils/exports");return exportStatementCsv(member);};

  return <>
    <section className="member-history-hero">
      <div className="member-history-hero-icon"><History size={21}/></div>
      <div style={{minWidth:0,flex:1}}>
        <div className="sans member-history-kicker">MY CONTRIBUTION HISTORY</div>
        <div className="member-history-member-code">{statement.member?.member_code||member?.member_code||"—"}</div>
        <div className="sans member-history-member-name">{statement.member?.name||member?.name} · MVR {fmt(statement.member?.monthly_amount||member?.monthly_amount)}/month</div>
      </div>
      <div className="member-history-export-actions">
        <button type="button" onClick={exportPdf} aria-label="Export PDF"><Download size={14}/><span>PDF</span></button>
        <button type="button" onClick={exportCsv} aria-label="Export CSV"><Download size={14}/><span>CSV</span></button>
      </div>
    </section>

    <section className="member-history-metrics">
      <HistoryMetric icon={<WalletCards size={15}/>} label="Total contributed" value={`MVR ${fmt(total)}`} tone="success"/>
      <HistoryMetric icon={<Clock3 size={15}/>} label="Outstanding" value={`MVR ${fmt(outstanding)}`} tone={outstanding>0?"danger":"success"}/>
      <HistoryMetric icon={<CheckCircle2 size={15}/>} label="Approved payments" value={String(approved.length)}/>
      <HistoryMetric icon={<CalendarRange size={15}/>} label="Advance allocated" value={`MVR ${fmt(advance)}`} tone={advance>0?"success":""}/>
    </section>

    {reconciliationErrors.length>0&&<div className="sans member-history-reconciliation-alert">
      <b>Contribution allocation needs review</b>
      <span>Your approved contribution total does not fully match the monthly allocation records. The fund administrator should review this account.</span>
    </div>}

    <div className="sans member-section-head"><b>MONTHLY STATUS</b><span>Latest 12 months</span></div>
    <section className="member-history-status-card">
      {recentStatuses.length===0&&<div className="sans member-history-empty-inline">No monthly contribution status yet.</div>}
      {recentStatuses.map(x=><div key={x.month} className={`sans member-history-status-row${x.advance?" advance":""}`}>
        <span className="member-history-month">{monthLabel(x.month)}{x.advance&&<small className="member-history-advance-label">Advance</small>}</span>
        <span className="member-history-status-detail">
          <b className="member-status-badge" style={{color:statusColor(x.status),borderColor:statusColor(x.status)}}>{x.status==="not_applicable"?"N/A":x.advance?`Advance ${x.status}`:x.status}</b>
          <small>{x.advance?"Allocated":"Paid"} MVR {fmt(x.paid)}{Number(x.due)>0?` · ${x.advance?"Remaining":"Due"} MVR ${fmt(x.due)}`:""}</small>
        </span>
      </div>)}
    </section>

    <div className="sans member-section-head member-history-transactions-head"><b>CONTRIBUTION TRANSACTIONS</b><span>{rows.length} total</span></div>
    <div className="member-history-filters" role="group" aria-label="Filter contribution transactions">
      {[["all","All"],["approved","Approved"],["pending","Pending"],["rejected","Rejected"]].map(([value,label])=>
        <button key={value} type="button" onClick={()=>setTransactionFilter(value)}
          className={`sans member-history-filter${transactionFilter===value?" active":""}`} aria-pressed={transactionFilter===value}>
          <span>{label}</span><b>{transactionCounts[value]||0}</b>
        </button>)}
    </div>

    {filteredRows.map((h)=>{
      const applied=allocationsFor(h.id);
      const status=normalizedStatus(h);
      return <article key={h.id} className="member-history-transaction">
        <div className="member-history-transaction-top">
          <div style={{minWidth:0}}>
            <div className="sans member-history-transaction-month">{monthLabel(h.month)}</div>
            <div className="sans member-history-transaction-ref">{h.txn_id}{h.ref_number?` · Bank ref: ${h.ref_number}`:""}</div>
          </div>
          <div className="member-history-transaction-amount">
            <div className="sans">MVR {fmt(h.amount)}</div>
            <span className={`sans status-${status}`}>{status}</span>
          </div>
        </div>
        {status==="approved"&&applied.length>0&&<div className="member-history-allocation-breakdown sans">
          <div className="member-history-allocation-title">PAYMENT ALLOCATION</div>
          {applied.map((a,index)=><div key={`${h.id}-${a.month}`} className="member-history-allocation-row">
            <span>{monthLabel(a.month)}{index>0?<small>Advance allocation</small>:null}</span><b>MVR {fmt(a.amount)}</b>
          </div>)}
        </div>}
      </article>
    })}
    {rows.length===0&&<EmptyState>No contributions yet — send a slip photo to the bot to get started.</EmptyState>}
    {rows.length>0&&filteredRows.length===0&&<EmptyState>No {transactionFilter} contributions.</EmptyState>}
  </>;
}

function HistoryMetric({icon,label,value,tone=""}){
  return <div className={`member-history-metric${tone?` ${tone}`:""}`}>
    <div className="member-history-metric-label sans">{icon}<span>{label}</span></div>
    <strong className="sans">{value}</strong>
  </div>;
}

function HistorySkeleton(){return <div aria-label="Loading statement" aria-busy="true"><div className="skeleton-block" style={{height:112,borderRadius:18,marginBottom:12}}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>{[1,2,3,4].map(i=><div key={i} className="skeleton-block" style={{height:78,borderRadius:14}}/>)}</div><div className="skeleton-block" style={{height:220,borderRadius:14,marginBottom:14}}/><div className="skeleton-block" style={{height:86,borderRadius:14}}/></div>;}
