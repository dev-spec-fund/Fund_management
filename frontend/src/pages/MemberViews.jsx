import React, { useEffect, useState } from "react";
import { X, Eye } from "lucide-react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, compactBtn, approveBtn, rejectBtn } from "../components/Shared";
import { currentMonthValue, formatLocalDateTime, shiftMonthValue, todayValue } from "../utils/date";
import { fmt } from "../utils/format";
import { ActivityRow, activityDayLabel } from "../components/ActivityRow";

function smallBtn(color) {
  return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 600, color, cursor: "pointer" };
}

export function MyHistory({ member }) {
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!member?.id) return;
    setStatement(null); setError("");
    api.members.statement(member.id).then(setStatement).catch((e) => setError(e?.message || "Could not load your statement"));
  }, [member?.id]);
  if (error) return <div className="sans" style={{background:"var(--danger-bg)",border:"1px solid var(--danger-border)",borderRadius:12,padding:14,color:"var(--danger)"}}>{error}</div>;
  if (!statement) return <Center>Loading your statement…</Center>;
  const rows=statement.contributions||[];
  const approved=rows.filter(r=>String(r.status).toLowerCase()==="approved");
  const total=approved.reduce((sum,r)=>sum+Number(r.amount||0),0);
  const statuses=statement.monthly_status||[];
  const outstanding=statuses.reduce((sum,x)=>sum+Number(x.due||0),0);
  const advance=Math.max(0,total-statuses.reduce((sum,x)=>sum+Number(x.paid||0),0));
  const recentStatuses=statuses.slice(-12).reverse();
  const monthLabel=(m)=>{if(!m)return"—";const [y,mo]=String(m).split("-");return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:"short",year:"numeric"});};
  const statusColor=(x)=>x==="paid"?"var(--success)":x==="partial"?"var(--warning)":x==="exempt"?"var(--muted)":"var(--danger)";
  const pending=rows.filter(r=>String(r.status).toLowerCase()==="pending");
  const rates=statement.contribution_rates||[];
  return <>
    <div className="theme-brand-surface" style={{background:"var(--primary)",borderRadius:16,padding:"20px 22px",marginBottom:12,color:"var(--on-primary)"}}>
      <div className="sans" style={{fontSize:11,opacity:.62,letterSpacing:1.1}}>MY MEMBER ACCOUNT</div>
      <div style={{fontSize:28,fontWeight:600,marginTop:4}}>{statement.member?.member_code||member?.member_code||"—"}</div>
      <div className="sans" style={{fontSize:13,opacity:.72,marginTop:4}}>{statement.member?.name||member?.name} · MVR {fmt(statement.member?.monthly_amount||member?.monthly_amount)}/month</div>
    </div>
    {pending.length>0 && <div style={{background:"var(--warning-bg-2)",border:"1px solid var(--warning-border-2)",borderRadius:12,padding:"11px 13px",marginBottom:10}}>
      <div className="sans" style={{fontSize:11,fontWeight:800,color:"var(--warning)",marginBottom:6}}>PAYMENT UNDER REVIEW</div>
      {pending.map(p=><div key={p.id} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,padding:"5px 0"}}><span>{p.txn_id} · {monthLabel(p.month)}</span><b>MVR {fmt(p.amount)}</b></div>)}
    </div>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>TOTAL CONTRIBUTED</div><b className="sans">MVR {fmt(total)}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>OUTSTANDING</div><b className="sans" style={{color:outstanding>0?"var(--danger)":"var(--success)"}}>MVR {fmt(outstanding)}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>APPROVED PAYMENTS</div><b className="sans">{approved.length}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>ADVANCE</div><b className="sans" style={{color:advance>0?"var(--success)":"inherit"}}>MVR {fmt(advance)}</b></div>
    </div>
    <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"16px 0 9px"}}><b style={{fontSize:13,color:"var(--muted)"}}>MONTHLY STATUS</b><div style={{display:"flex",gap:6}}><button onClick={async()=>{const {exportStatementPdf}=await import("../utils/exports");return exportStatementPdf(member)}} style={smallBtn()}>PDF</button><button onClick={async()=>{const {exportStatementCsv}=await import("../utils/exports");return exportStatementCsv(member)}} style={smallBtn()}>CSV</button></div></div>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"4px 14px",marginBottom:16}}>
      {recentStatuses.map(x=><div key={x.month} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,padding:"9px 0",borderBottom:"1px solid var(--divider)",fontSize:12}}><span>{monthLabel(x.month)}</span><span style={{textAlign:"right"}}><b style={{color:statusColor(x.status),textTransform:"capitalize"}}>{x.status}</b><div style={{fontSize:10,color:"var(--soft)"}}>Paid MVR {fmt(x.paid)}{Number(x.due)>0?` · Due MVR ${fmt(x.due)}`:""}</div></span></div>)}
    </div>
    {rates.length>0 && <>
      <div className="sans" style={{fontSize:13,fontWeight:700,color:"var(--muted)",marginBottom:9}}>CONTRIBUTION RATE HISTORY</div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"4px 14px",marginBottom:16}}>
        {rates.map((r,i)=><div key={`${r.effective_from}-${i}`} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,padding:"9px 0",borderBottom:i===rates.length-1?"none":"1px solid var(--divider)",fontSize:12}}><span>{monthLabel(r.effective_from)}{r.effective_to?` – ${monthLabel(r.effective_to)}`:" – Current"}</span><b>MVR {fmt(r.amount)}/month</b></div>)}
      </div>
    </>}
    <div className="sans" style={{fontSize:13,fontWeight:700,color:"var(--muted)",marginBottom:9}}>CONTRIBUTION TRANSACTIONS</div>
    {rows.map((h)=><div key={h.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 16px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><div><div className="sans" style={{fontSize:14,fontWeight:600}}>{monthLabel(h.month)}</div><div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>{h.txn_id}{h.ref_number?` · Bank ref: ${h.ref_number}`:""}</div></div><div style={{textAlign:"right"}}><div className="sans" style={{fontSize:14,fontWeight:600}}>MVR {fmt(h.amount)}</div><span className="sans" style={{color:h.status==="approved"?"var(--success)":h.status==="reversed"?"var(--warning)":"var(--muted)",fontSize:10,fontWeight:600,textTransform:"capitalize"}}>{h.status||"pending"}</span></div></div>
    </div>)}
    {rows.length===0&&<div className="sans" style={{fontSize:13,color:"var(--soft)"}}>No contributions yet — send a slip photo to the bot to get started.</div>}
  </>;
}

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

  if (summaryError) return (
    <div className="sans" style={{background:"var(--danger-bg-4)",border:"1px solid var(--danger-border-3)",borderRadius:12,padding:16,color:"var(--danger-strong)"}}>
      <div style={{fontWeight:700,marginBottom:5}}>Fund information unavailable</div>
      <div style={{fontSize:12,marginBottom:12}}>{summaryError}</div>
      <button onClick={loadSummary} style={compactBtn}>Try again</button>
    </div>
  );
  if (!summary) return <Center>Loading…</Center>;

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
        <button onClick={()=>shiftMonth(-1)} style={{...compactBtn,padding:8}}>‹</button>
        <div className="sans" style={{textAlign:"center",background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:10,fontWeight:600}}>{monthLabel}</div>
        <button onClick={()=>shiftMonth(1)} style={{...compactBtn,padding:8}}>›</button>
      </div>

      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"11px 14px",marginBottom:9,display:"flex",justifyContent:"space-between"}}>
        <span className="sans" style={{fontSize:12,color:"var(--muted)"}}>Total spent this month</span>
        <b className="sans" style={{fontSize:13,color:"var(--danger)"}}>MVR {fmt(monthSpent)}</b>
      </div>

      {visibleCategories.map((c, i) => {
        const spent = Number(c.spent || 0);
        const pct = monthSpent > 0 ? Math.round((spent / monthSpent) * 100) : 0;
        return <button key={i} onClick={()=>openExpenseCategory(c)}
          style={{width:"100%",textAlign:"left",background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",marginBottom:8,cursor:"pointer",color:"inherit"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
            <span className="sans" style={{fontSize:14,fontWeight:500}}>{c.category}</span>
            <span style={{display:"flex",alignItems:"center",gap:7}}>
              <span className="sans" style={{fontSize:14,fontWeight:700,color:"var(--danger)"}}>MVR {fmt(spent)}</span>
              <span className="sans" style={{fontSize:16,color:"var(--soft-2)"}}>›</span>
            </span>
          </div>
          {spent > 0 && <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:4}}>{pct}% of this month's expenses · Tap for details</div>}
          {spent === 0 && <div className="sans" style={{fontSize:10,color:"var(--soft-4)",marginTop:4}}>No expenses · Tap for details</div>}
        </button>;
      })}

      {visibleCategories.length === 0 &&
        <div className="sans" style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,color:"var(--soft)",fontSize:12,marginBottom:8}}>
          No spending recorded for {monthLabel}.
        </div>}

      {categories.some(c => Number(c.spent || 0) === 0) &&
        <button onClick={()=>setShowAllCategories(!showAllCategories)} className="sans"
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

      {expenseDetail && <Modal title={expenseDetail.category?.name || "Expense details"} onClose={()=>!expenseLoading&&setExpenseDetail(null)}>
        <div className="sans" style={{background:"var(--bg)",borderRadius:11,padding:12,marginBottom:12}}>
          <div style={{fontSize:10,color:"var(--soft)"}}>{monthLabel.toUpperCase()}</div>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"end",marginTop:4}}>
            <div style={{fontSize:14,fontWeight:700}}>{expenseDetail.category?.name}</div>
            <div style={{fontSize:16,fontWeight:700,color:"var(--danger)"}}>MVR {fmt(expenseDetail.total || 0)}</div>
          </div>
        </div>

        {expenseLoading && <Center>Loading expenses…</Center>}
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
            <span style={{color:"var(--soft)"}}>Expense date</span><span>{e.expense_date || `${e.transaction_month || month}-01`}</span>
            <span style={{color:"var(--soft)"}}>Logged</span><span>{e.created_at ? formatLocalDateTime(e.created_at) : "—"}</span>
          </div>
        </div>)}

        {!expenseLoading && !expenseError && (expenseDetail.expenses || []).length===0 &&
          <div className="sans" style={{fontSize:12,color:"var(--soft)",padding:"10px 2px 4px"}}>No expenses recorded in this category for {monthLabel}.</div>}
      </Modal>}
    </>
  );
}

/* ---------- Activity ---------- */
export function Activity({ isAdmin, canFinance = false }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("all");
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayValue());
  const [appliedRange, setAppliedRange] = useState({ from: "", to: "", label: "All recent" });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const monthEnd = (month) => {
    const [year, mon] = String(month).split("-").map(Number);
    return `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0")}`;
  };
  const rangeForPreset = (preset) => {
    const currentMonth = currentMonthValue();
    const today = todayValue();
    if (preset === "this_month") return { from: `${currentMonth}-01`, to: today, label: "This month" };
    if (preset === "last_month") {
      const month = shiftMonthValue(currentMonth, -1);
      return { from: `${month}-01`, to: monthEnd(month), label: "Last month" };
    }
    if (preset === "3_months") {
      const month = shiftMonthValue(currentMonth, -2);
      return { from: `${month}-01`, to: today, label: "Last 3 months" };
    }
    if (preset === "6_months") {
      const month = shiftMonthValue(currentMonth, -5);
      return { from: `${month}-01`, to: today, label: "Last 6 months" };
    }
    if (preset === "this_year") return { from: `${currentMonth.slice(0,4)}-01-01`, to: today, label: "This year" };
    return { from: "", to: "", label: "All recent" };
  };

  const loadActivity = async (range = appliedRange) => {
    setActivityLoading(true);
    setActivityError("");
    try {
      setRows(await api.reports.activity({ from: range.from, to: range.to }));
    } catch (e) {
      setRows([]);
      setActivityError(e?.message || "Could not load activity.");
    } finally {
      setActivityLoading(false);
    }
  };
  useEffect(() => { loadActivity(appliedRange); }, [appliedRange.from, appliedRange.to]);
  useEffect(() => { if (canFinance) api.expenses.categories().then(setExpenseCategories).catch(() => {}); }, [canFinance]);

  const changeDatePreset = (value) => {
    setDatePreset(value);
    if (value === "custom") {
      if (!customFrom) setCustomFrom(`${currentMonthValue()}-01`);
      return;
    }
    setAppliedRange(rangeForPreset(value));
  };

  const applyCustomRange = () => {
    if (!customFrom || !customTo) return setActivityError("Choose both From and To dates.");
    if (customFrom > customTo) return setActivityError("From date cannot be after To date.");
    setActivityError("");
    setAppliedRange({ from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` });
  };

  const clearDateRange = () => {
    setDatePreset("all");
    setCustomFrom("");
    setCustomTo(todayValue());
    setAppliedRange(rangeForPreset("all"));
  };

  const openExpense = (row) => {
    if (!canFinance || row.kind !== "expense") return;
    setExpenseError("");
    setEditingExpense({
      ...row,
      description: row.description || row.who || "",
      category_id: row.category_id || "",
      expense_date: row.expense_date || (row.transaction_month ? `${row.transaction_month}-01` : String(row.created_at || "").slice(0, 10)),
      transaction_month: row.transaction_month || String(row.created_at || "").slice(0, 7),
      amount: Number(row.amount || 0),
    });
  };

  const saveExpense = async () => {
    if (!editingExpense) return;
    if (!editingExpense.description?.trim()) return setExpenseError("Description is required.");
    if (!(Number(editingExpense.amount) > 0)) return setExpenseError("Enter a valid amount.");
    setExpenseBusy(true); setExpenseError("");
    try {
      await api.expenses.update(editingExpense.id, {
        description: editingExpense.description.trim(),
        category_id: editingExpense.category_id ? Number(editingExpense.category_id) : null,
        amount: Number(editingExpense.amount),
        expense_date: editingExpense.expense_date,
      });
      setEditingExpense(null);
      await loadActivity();
    } catch (e) { setExpenseError(e.message || "Could not update expense."); }
    finally { setExpenseBusy(false); }
  };

  const voidExpense = async () => {
    if (!editingExpense) return;
    const reason = window.prompt("Reason for voiding this expense:");
    if (reason === null) return;
    if (!reason.trim()) return setExpenseError("A void reason is required.");
    if (!window.confirm(`Void ${editingExpense.txn_id || "this expense"}? The record will remain in the audit history.`)) return;
    setExpenseBusy(true); setExpenseError("");
    try {
      await api.expenses.remove(editingExpense.id, reason.trim());
      setEditingExpense(null);
      await loadActivity();
    } catch (e) { setExpenseError(e.message || "Could not void expense."); }
    finally { setExpenseBusy(false); }
  };

  const reverseActivity = async (row) => {
    if (!canFinance) return;
    const reason=window.prompt(`Reason for reversing ${row.txn_id || row._kind || "transaction"}:`);
    if(reason===null) return;
    if(reason.trim().length<3) return window.alert("Please enter a reversal reason.");
    if(!window.confirm(`Reverse ${row.txn_id || "this transaction"}? The original record will remain in the audit/reversal history.`)) return;
    try {
      const r=await api.governance.reverse(row._kind || row.kind,row.id,reason.trim());
      window.alert(`Reversed as ${r.reversal_id}`);
      await loadActivity();
    } catch(e) { window.alert(e.message || "Could not reverse transaction"); }
  };
  if (rows === null) return <Center>Loading…</Center>;

  const normalizeKind = (value) => {
    const kind = String(value || "").trim().toLowerCase();
    if (kind === "contributions") return "contribution";
    if (kind === "donations") return "donation";
    if (kind === "expenses") return "expense";
    return kind;
  };
  const normalizedRows = rows.map((row) => ({ ...row, _kind: normalizeKind(row.kind) }));
  const filtered = normalizedRows.filter((r) => filter === "all" || r._kind === filter);
  const income = filtered.filter((r) => r._kind === "contribution" || r._kind === "donation").reduce((n, r) => n + Number(r.amount || 0), 0);
  const expenses = filtered.filter((r) => r._kind === "expense").reduce((n, r) => n + Number(r.amount || 0), 0);
  const groups = [];
  filtered.forEach((row) => {
    const label = activityDayLabel(row);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  });

  const counts = normalizedRows.reduce((acc, row) => {
    acc.all += 1;
    if (row._kind in acc) acc[row._kind] += 1;
    return acc;
  }, { all: 0, contribution: 0, donation: 0, expense: 0 });

  const filters = [
    ["all", "All"], ["contribution", "Contributions"], ["donation", "Donations"], ["expense", "Expenses"]
  ];

  return (
    <>
      <div className="activity-filter-sticky page-sticky-controls">
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--soft)" }}>Activity</div>
            <div style={{ fontSize: 10, color: "var(--soft-2)", marginTop: 2 }}>{appliedRange.label}</div>
          </div>
          <div style={{ fontSize: 12, color: income - expenses >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>Net {income - expenses >= 0 ? "+" : "−"}MVR {fmt(Math.abs(income - expenses))}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 7, marginBottom: 7 }}>
          <select value={datePreset} onChange={(e) => changeDatePreset(e.target.value)} className="sans activity-date-select" aria-label="Activity date range">
            <option value="all">All recent</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="3_months">Last 3 months</option>
            <option value="6_months">Last 6 months</option>
            <option value="this_year">This year</option>
            <option value="custom">Custom dates</option>
          </select>
          {(datePreset !== "all" || appliedRange.from || appliedRange.to) && <button type="button" className="sans activity-clear-filter" onClick={clearDateRange}>Clear</button>}
        </div>

        {datePreset === "custom" && <div className="activity-custom-range">
          <label className="sans"><span>From</span><input type="date" value={customFrom} max={customTo || undefined} onChange={(e)=>setCustomFrom(e.target.value)} /></label>
          <label className="sans"><span>To</span><input type="date" value={customTo} min={customFrom || undefined} onChange={(e)=>setCustomTo(e.target.value)} /></label>
          <button type="button" className="sans" onClick={applyCustomRange}>Apply</button>
        </div>}

        <div className="activity-type-filters">
          {filters.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className="sans"
              style={{ flex: "0 0 auto", background: filter === value ? "var(--primary)" : "var(--card)", color: filter === value ? "var(--on-primary)" : "var(--muted)", border: "1px solid " + (filter === value ? "var(--primary)" : "var(--border)"), borderRadius: 20, padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
              {label} <span style={{ opacity: filter === value ? .82 : .68, marginLeft: 3 }}>{counts[value]}</span>
            </button>
          ))}
        </div>
        {activityError && <div className="sans activity-filter-error">{activityError}</div>}
        {activityLoading && rows !== null && <div className="sans activity-filter-loading">Refreshing activity…</div>}
      </div>
      <div key={`activity-results-${filter}-${appliedRange.from}-${appliedRange.to}`} className="activity-results">
        {groups.map((group) => (
          <div key={`${filter}-${group.label}`}>
            <div className="sans" style={{ display: "flex", alignItems: "center", gap: 8, margin: "13px 2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: "var(--soft)" }}>
              <span>{group.label}</span><span style={{ height: 1, flex: 1, background: "var(--border)" }} />
            </div>
            {group.rows.map((a) => <ActivityRow key={`${filter}-${a._kind}-${a.id}`} a={a} isAdmin={isAdmin} canFinance={canFinance} onExpenseClick={openExpense} onReverse={reverseActivity} />)}
          </div>
        ))}
        {filtered.length === 0 && <div className="sans" style={{ fontSize: 13, color: "var(--soft)" }}>Nothing here yet.</div>}
      </div>

      {editingExpense && <Modal title="Edit expense" onClose={() => !expenseBusy && setEditingExpense(null)}>
        <div className="sans" style={{fontSize:11,color:"var(--muted)",background:"var(--success-bg)",padding:"9px 10px",borderRadius:9,marginBottom:12,lineHeight:1.45}}>
          {editingExpense.txn_id || `Expense #${editingExpense.id}`} · Changes are saved to the audit log. Use Void instead of permanently deleting a financial record.
        </div>
        <Field label="Description" value={editingExpense.description || ""} onChange={(v)=>setEditingExpense({...editingExpense,description:v})}/>
        <Field label="Amount" type="number" prefix="MVR" value={editingExpense.amount} onChange={(v)=>setEditingExpense({...editingExpense,amount:v})}/>
        <label className="sans" style={{display:"block",fontSize:11,color:"var(--muted)",marginBottom:10}}>
          <span style={{display:"block",marginBottom:5}}>Category</span>
          <select value={editingExpense.category_id || ""} onChange={(e)=>setEditingExpense({...editingExpense,category_id:e.target.value})}
            style={{width:"100%",padding:"10px 11px",border:"1px solid var(--border-strong-2)",borderRadius:9,background:"var(--card)",fontSize:13}}>
            <option value="">Uncategorised</option>
            {expenseCategories.filter(c=>Number(c.active)!==0 || Number(c.id)===Number(editingExpense.category_id)).map(c=><option key={c.id} value={c.id}>{c.name}{Number(c.active)===0?" (inactive)":""}</option>)}
          </select>
        </label>
        <Field label="Expense date" type="date" value={editingExpense.expense_date || ""} onChange={(v)=>setEditingExpense({...editingExpense,expense_date:v,transaction_month:String(v||"").slice(0,7)})}/>
        {expenseError && <div className="sans" style={{fontSize:11,color:"var(--danger)",background:"var(--danger-bg)",padding:9,borderRadius:8,marginBottom:10}}>{expenseError}</div>}
        <button disabled={expenseBusy} onClick={saveExpense} style={{...approveBtn,width:"100%",padding:"10px 12px",opacity:expenseBusy?.6:1}}>
          {expenseBusy ? "Saving…" : "Save changes"}
        </button>
        <button disabled={expenseBusy} onClick={voidExpense} style={{...rejectBtn,width:"100%",padding:"10px 12px",marginTop:8,opacity:expenseBusy?.6:1}}>
          Void expense
        </button>
      </Modal>}
    </>
  );
}

export function MemberMeetings() {
  const [rows,setRows]=useState(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(null);
  const load=()=>api.myMeetings().then(setRows).catch(e=>setError(e.message||"Could not load meetings"));
  useEffect(()=>{load();},[]);
  const rsvp=async(id,response)=>{setBusy(id);setError("");try{await api.myMeetingRsvp(id,response);await load();}catch(e){setError(e.message||"Could not save RSVP");}finally{setBusy(null);}};
  if(rows===null&&!error)return <Center>Loading meetings…</Center>;
  const now=todayValue();
  return <>
    <div className="sans" style={{fontSize:13,fontWeight:800,color:"var(--muted)",marginBottom:10}}>MY MEETINGS</div>
    {error&&<div className="sans" style={{padding:10,borderRadius:9,background:"var(--danger-bg)",color:"var(--danger)",marginBottom:10,fontSize:11}}>{error}</div>}
    {(rows||[]).map(m=>{const past=String(m.meeting_date)<now;return <div key={m.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:13,padding:14,marginBottom:9}}>
      <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:10}}><div><b style={{fontSize:13}}>{m.title}</b><div style={{fontSize:10,color:"var(--soft)",marginTop:3}}>{m.meeting_date} · {m.meeting_time}{m.venue?` · ${m.venue}`:""}</div></div><span style={{fontSize:10,fontWeight:700,color:m.status==='cancelled'?"var(--danger)":past?"var(--muted)":"var(--success)"}}>{m.status==='cancelled'?"Cancelled":past?"Past":"Upcoming"}</span></div>
      {m.agenda&&<div className="sans" style={{fontSize:11,color:"var(--muted)",marginTop:9,lineHeight:1.5}}><b>Agenda:</b> {m.agenda}</div>}
      {!past&&m.status!=='cancelled'&&<div style={{display:"flex",gap:6,marginTop:10}}>{[["yes","Going"],["maybe","Maybe"],["no","Not going"]].map(([v,l])=><button key={v} type="button" disabled={busy===m.id} onClick={()=>rsvp(m.id,v)} className="sans" style={{flex:1,padding:"8px 6px",borderRadius:8,border:"1px solid var(--border)",background:m.rsvp===v?"var(--primary)":"var(--surface-2)",color:m.rsvp===v?"var(--on-primary)":"var(--muted)",fontSize:10,fontWeight:700}}>{l}</button>)}</div>}
      {past&&(m.minutes||m.decisions)&&<div style={{marginTop:10,paddingTop:9,borderTop:"1px solid var(--divider)"}}>{m.minutes&&<div className="sans" style={{fontSize:11,lineHeight:1.5}}><b>Minutes</b><div style={{color:"var(--muted)",whiteSpace:"pre-wrap",marginTop:3}}>{m.minutes}</div></div>}{m.decisions&&<div className="sans" style={{fontSize:11,lineHeight:1.5,marginTop:8}}><b>Decisions</b><div style={{color:"var(--muted)",whiteSpace:"pre-wrap",marginTop:3}}>{m.decisions}</div></div>}</div>}
    </div>})}
    {(rows||[]).length===0&&<div className="sans" style={{fontSize:12,color:"var(--soft)"}}>No meetings yet.</div>}
  </>;
}

export function MyActions() {
  const [rows,setRows]=useState(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(null);
  const load=()=>api.myActions().then(setRows).catch(e=>setError(e.message||"Could not load action items"));
  useEffect(()=>{load();},[]);
  const done=async id=>{setBusy(id);try{await api.completeMyAction(id);await load();}catch(e){setError(e.message||"Could not complete action item");}finally{setBusy(null);}};
  if(rows===null&&!error)return <Center>Loading action items…</Center>;
  const today=todayValue();
  return <>
    <div className="sans" style={{fontSize:13,fontWeight:800,color:"var(--muted)",marginBottom:10}}>MY ACTION ITEMS</div>
    {error&&<div className="sans" style={{padding:10,borderRadius:9,background:"var(--danger-bg)",color:"var(--danger)",marginBottom:10,fontSize:11}}>{error}</div>}
    {(rows||[]).map(a=>{const overdue=a.status==='open'&&a.due_date&&a.due_date<today;return <div key={a.id} style={{background:"var(--card)",border:`1px solid ${overdue?'var(--danger-border)':'var(--border)'}`,borderRadius:13,padding:14,marginBottom:9}}>
      <div className="sans" style={{fontSize:13,fontWeight:700}}>{a.description}</div>
      <div className="sans" style={{fontSize:10,color:overdue?"var(--danger)":"var(--soft)",marginTop:4}}>{a.meeting_title}{a.due_date?` · Due ${a.due_date}`:""}{overdue?" · OVERDUE":""}</div>
      <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:9}}><span style={{fontSize:10,fontWeight:700,color:a.status==='done'?"var(--success)":"var(--warning)",textTransform:"uppercase"}}>{a.status}</span>{a.status==='open'&&<button type="button" disabled={busy===a.id} onClick={()=>done(a.id)} style={{...approveBtn,padding:"7px 10px",fontSize:10}}>Mark done</button>}</div>
    </div>})}
    {(rows||[]).length===0&&<div className="sans" style={{fontSize:12,color:"var(--soft)"}}>No action items assigned to you.</div>}
  </>;
}

export function MyProfile({ member }) {
  const [rates,setRates]=useState(null);
  useEffect(()=>{if(member?.id)api.members.contributionRates(member.id).then(setRates).catch(()=>setRates([]));},[member?.id]);
  const joined=member?.joined_at||member?.created_at;
  return <>
    <div className="theme-brand-surface" style={{background:"var(--primary)",borderRadius:16,padding:"20px 22px",marginBottom:12,color:"var(--on-primary)"}}><div className="sans" style={{fontSize:10,opacity:.65,letterSpacing:1}}>MY PROFILE</div><div style={{fontSize:27,fontWeight:600,marginTop:4}}>{member?.name||"Member"}</div><div className="sans" style={{fontSize:12,opacity:.72,marginTop:3}}>{member?.member_code||"—"}</div></div>
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:13,padding:"4px 14px"}}>{[["Member ID",member?.member_code],["Phone",member?.phone||"Not set"],["Monthly contribution",`MVR ${fmt(member?.monthly_amount||0)}`],["Member since",joined?String(joined).slice(0,10):"—"],["Status",Number(member?.active)!==0?"Active":"Inactive"]].map(([k,v])=><div key={k} className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"11px 0",borderBottom:"1px solid var(--divider)",fontSize:12}}><span style={{color:"var(--soft)"}}>{k}</span><b style={{textAlign:"right"}}>{v}</b></div>)}</div>
    <div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:10,lineHeight:1.5}}>Profile details are managed by fund administrators. Your Telegram account is linked automatically.</div>
    {rates&&rates.length>0&&<><div className="sans" style={{fontSize:12,fontWeight:800,color:"var(--muted)",margin:"18px 0 8px"}}>CONTRIBUTION RATE HISTORY</div>{rates.map(r=><div key={r.id} className="sans" style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",marginBottom:7,display:"flex",justifyContent:"space-between",fontSize:11}}><span>{r.effective_from}{r.effective_to?` – ${r.effective_to}`:" – Current"}</span><b>MVR {fmt(r.amount)}</b></div>)}</>}
  </>;
}

/* ---------- Reports (admin) ---------- */
