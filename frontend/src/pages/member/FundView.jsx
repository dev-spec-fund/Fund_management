import React, { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { api, onDataChange } from "../../api";
import { Modal } from "../../components/FormControls";
import { EmptyState, ErrorState, LoadingState, compactBtn } from "../../components/Shared";
import { currentMonthValue, formatLocalDateTime } from "../../utils/date";
import { fmt } from "../../utils/format";

export function FundView() {
  const [month, setMonth] = useState(currentMonthValue());
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [expenseDetail, setExpenseDetail] = useState(null);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const loadSummary = () => {
    setSummary(null);
    setSummaryError("");
    api.reports.publicSummary(month)
      .then(setSummary)
      .catch((err) => setSummaryError(err?.message || "Could not load fund information."));
  };

  useEffect(() => {
    loadSummary();
    setExpenseDetail(null);
  }, [month]);
  useEffect(() => onDataChange(() => {
    api.reports.publicSummary(month).then(setSummary).catch(() => {});
  }), [month]);

  const openExpenseCategory = async (category) => {
    if (!category?.category_id) return;
    setExpenseLoading(true);
    setExpenseError("");
    setExpenseDetail({ category: { id: category.category_id, name: category.category }, month, total: Number(category.spent || 0), expenses: null });
    try {
      setExpenseDetail(await api.reports.publicExpenses(month, category.category_id));
    } catch (e) {
      setExpenseError(e?.message || "Could not load expense details.");
    } finally {
      setExpenseLoading(false);
    }
  };

  const shiftMonth = (delta) => {
    const [y,m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  const monthLabel = (() => {
    try {
      const [y,m] = month.split("-").map(Number);
      return new Intl.DateTimeFormat("en",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));
    } catch { return month; }
  })();

  if (summaryError) return <ErrorState onRetry={loadSummary}>{summaryError}</ErrorState>;
  if (!summary) return <FundSkeleton/>;

  const categories = summary.byCategory || [];
  const visibleCategories = showAllCategories ? categories : categories.filter(c => Number(c.spent || 0) > 0);
  const monthSpent = Number(summary.expenses || 0);
  const totalReceived = Number(summary.totalReceived || 0);
  const totalSpent = Number(summary.totalSpent || 0);
  const recent = summary.recentActivity || [];

  return (
    <>
      <div className="sans" style={{ display:"flex", alignItems:"center", gap:7, background:"var(--success-bg)", color:"var(--success-strong)", fontSize:12, borderRadius:10, padding:"9px 12px", marginBottom:14 }}>
        <Eye size={13} /> Fund information is read-only and visible to all members
      </div>

      <div className="theme-brand-surface" style={{ background:"var(--primary)", borderRadius:16, padding:22, color:"var(--on-primary)", marginBottom:10 }}>
        <div className="sans" style={{ fontSize:12, opacity:.6, letterSpacing:1 }}>TOTAL FUND BALANCE</div>
        <div style={{ fontSize:34, fontWeight:600, marginTop:4 }}>MVR {fmt(summary.fundBalance)}</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}>
          <div className="sans" style={{fontSize:10,color:"var(--soft)"}}>TOTAL RECEIVED</div>
          <div className="sans" style={{fontSize:15,fontWeight:700,color:"var(--success)",marginTop:3}}>MVR {fmt(totalReceived)}</div>
        </div>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}>
          <div className="sans" style={{fontSize:10,color:"var(--soft)"}}>TOTAL SPENT</div>
          <div className="sans" style={{fontSize:15,fontWeight:700,color:"var(--danger)",marginTop:3}}>MVR {fmt(totalSpent)}</div>
        </div>
      </div>

      <div className="sans" style={{fontSize:13,color:"var(--muted)",marginBottom:8,fontWeight:700}}>SPENDING</div>
      <div style={{display:"grid",gridTemplateColumns:"42px 1fr 42px",alignItems:"center",gap:8,marginBottom:10}}>
        <button type="button" onClick={()=>shiftMonth(-1)} style={{...compactBtn,padding:8}}>‹</button>
        <div className="sans" style={{textAlign:"center",background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:10,fontWeight:600}}>{monthLabel}</div>
        <button type="button" onClick={()=>shiftMonth(1)} style={{...compactBtn,padding:8}}>›</button>
      </div>

      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"11px 14px",marginBottom:9,display:"flex",justifyContent:"space-between"}}>
        <span className="sans" style={{fontSize:12,color:"var(--muted)"}}>Total spent this month</span>
        <b className="sans" style={{fontSize:13,color:"var(--danger)"}}>MVR {fmt(monthSpent)}</b>
      </div>

      {visibleCategories.map((c, i) => {
        const spent = Number(c.spent || 0);
        const pct = monthSpent > 0 ? Math.round((spent / monthSpent) * 100) : 0;
        return <button type="button" key={i} onClick={()=>openExpenseCategory(c)} className="member-fund-category">
          <div className="member-fund-category-head">
            <span className="sans">{c.category}</span>
            <span className="sans"><strong>MVR {fmt(spent)}</strong><b>›</b></span>
          </div>
          <div className="member-fund-category-progress"><div style={{width:`${pct}%`}}/></div>
          <div className="sans member-fund-category-meta">{spent>0?`${pct}% of this month's expenses · Tap for details`:"No expenses · Tap for details"}</div>
        </button>;
      })}

      {visibleCategories.length === 0 && <EmptyState>No spending recorded for {monthLabel}.</EmptyState>}

      {categories.some(c => Number(c.spent || 0) === 0) &&
        <button type="button" onClick={()=>setShowAllCategories(!showAllCategories)} className="sans"
          style={{width:"100%",border:0,background:"transparent",color:"var(--muted)",fontSize:11,fontWeight:600,padding:"6px 0 16px",cursor:"pointer"}}>
          {showAllCategories ? "Hide zero-value categories" : "View all categories"}
        </button>}

      <div className="sans" style={{fontSize:13,color:"var(--muted)",marginBottom:8,fontWeight:700}}>RECENT FUND ACTIVITY</div>
      {recent.map((a,i) => {
        const incoming = a.kind === "contribution" || a.kind === "donation";
        return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"11px 13px",marginBottom:7}}>
          <div style={{minWidth:0}}>
            <div className="sans" style={{fontSize:12,fontWeight:600}}>{a.label}</div>
            <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:2}}>{a.event_at ? formatLocalDateTime(a.event_at) : ""}</div>
          </div>
          <div className="sans" style={{fontSize:13,fontWeight:700,color:incoming?"var(--success)":"var(--danger)",whiteSpace:"nowrap"}}>
            {incoming ? "+" : "−"} MVR {fmt(a.amount)}
          </div>
        </div>;
      })}
      {recent.length === 0 && <div className="sans" style={{fontSize:12,color:"var(--soft)"}}>No fund activity yet.</div>}

      {expenseDetail && <Modal title={expenseDetail.category?.name || "Expense details"} closeDisabled={expenseLoading} onClose={()=>!expenseLoading&&setExpenseDetail(null)}>
        <div className="sans" style={{background:"var(--bg)",borderRadius:11,padding:12,marginBottom:12}}>
          <div style={{fontSize:10,color:"var(--soft)"}}>{monthLabel.toUpperCase()}</div>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"end",marginTop:4}}>
            <div style={{fontSize:14,fontWeight:700}}>{expenseDetail.category?.name}</div>
            <div style={{fontSize:16,fontWeight:700,color:"var(--danger)"}}>MVR {fmt(expenseDetail.total || 0)}</div>
          </div>
        </div>

        {expenseLoading && <LoadingState compact>Loading expenses…</LoadingState>}
        {expenseError && <div className="sans" style={{background:"var(--danger-bg-4)",border:"1px solid var(--danger-border-3)",borderRadius:10,padding:11,color:"var(--danger-strong)",fontSize:11}}>{expenseError}</div>}

        {!expenseLoading && !expenseError && (expenseDetail.expenses || []).map((e)=><div key={e.id}
          style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 13px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
            <div style={{minWidth:0}}>
              <div className="sans" style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{e.description || "Expense"}</div>
              <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:3}}>{e.txn_id || `Expense #${e.id}`}</div>
            </div>
            <div className="sans" style={{fontSize:14,fontWeight:700,color:"var(--danger)",whiteSpace:"nowrap"}}>MVR {fmt(e.amount)}</div>
          </div>
          <div className="sans" style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"5px 10px",fontSize:10,marginTop:10,paddingTop:9,borderTop:"1px solid var(--divider)"}}>
            <span style={{color:"var(--soft)"}}>Category</span><span>{e.category}</span>
            <span style={{color:"var(--soft)"}}>Expense month</span><span>{e.transaction_month || month}</span>
            <span style={{color:"var(--soft)"}}>Logged</span><span>{e.created_at ? formatLocalDateTime(e.created_at) : "—"}</span>
          </div>
        </div>)}

        {!expenseLoading && !expenseError && (expenseDetail.expenses || []).length===0 &&
          <div className="sans" style={{fontSize:12,color:"var(--soft)",padding:"10px 2px 4px"}}>No expenses recorded in this category for {monthLabel}.</div>}
      </Modal>}
    </>
  );
}


function FundSkeleton(){return <div aria-label="Loading fund information" aria-busy="true"><div className="skeleton-block" style={{height:42,borderRadius:10,marginBottom:14}}/><div className="skeleton-block" style={{height:105,borderRadius:16,marginBottom:10}}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}><div className="skeleton-block" style={{height:72,borderRadius:12}}/><div className="skeleton-block" style={{height:72,borderRadius:12}}/></div><div className="skeleton-block" style={{height:46,borderRadius:10,marginBottom:10}}/>{[1,2,3].map(i=><div key={i} className="skeleton-block" style={{height:68,borderRadius:12,marginBottom:8}}/>)}</div>;}
