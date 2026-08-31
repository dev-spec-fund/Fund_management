import React, { useEffect, useState } from "react";
import { X, Eye } from "lucide-react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, compactBtn, approveBtn, rejectBtn } from "../components/Shared";
import { currentMonthValue, formatLocalDateTime } from "../utils/date";
import { fmt } from "../utils/format";
import { ActivityRow, activityDayLabel } from "../components/ActivityRow";

function smallBtn(color) {
  return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 600, color, cursor: "pointer" };
}

export function MyHistory({ member }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.myContributions().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return <Center>Loading…</Center>;
  const approved = rows.filter((r) => String(r.status).toLowerCase() === "approved");
  const total = approved.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const monthLabel = (m) => { if (!m) return "—"; const [y,mo]=String(m).split("-"); return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:"long",year:"numeric"}); };
  const statusStyle = (status) => { const x=String(status||"").toLowerCase(); return {color:x==="approved"?"var(--success)":x==="rejected"?"var(--danger)":"var(--warning-2)",background:x==="approved"?"var(--success-bg)":x==="rejected"?"var(--danger-bg-2)":"var(--warning-bg-3)"}; };
  return <>
    <div className="theme-brand-surface" style={{background:"var(--primary)",borderRadius:16,padding:"20px 22px",marginBottom:12,color:"var(--on-primary)"}}>
      <div className="sans" style={{fontSize:11,opacity:.62,letterSpacing:1.1}}>MY MEMBER ACCOUNT</div>
      <div style={{fontSize:28,fontWeight:600,marginTop:4}}>{member?.member_code||"—"}</div>
      <div className="sans" style={{fontSize:13,opacity:.72,marginTop:4}}>{member?.name} · MVR {fmt(member?.monthly_amount)}/month</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>TOTAL CONTRIBUTED</div><b className="sans">MVR {fmt(total)}</b></div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"var(--soft)"}}>PAYMENTS</div><b className="sans">{approved.length} approved</b></div>
    </div>
    <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}><b style={{fontSize:13,color:"var(--muted)"}}>CONTRIBUTION HISTORY</b><div style={{display:"flex",gap:6}}><button onClick={async()=>{const {exportStatementPdf}=await import("../utils/exports");return exportStatementPdf(member)}} style={smallBtn()}>PDF</button><button onClick={async()=>{const {exportStatementCsv}=await import("../utils/exports");return exportStatementCsv(member)}} style={smallBtn()}>CSV</button></div></div>
    {rows.map((h)=><div key={h.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 16px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><div><div className="sans" style={{fontSize:14,fontWeight:600}}>{monthLabel(h.month)}</div><div className="sans" style={{fontSize:11,color:"var(--soft)",marginTop:3}}>{h.txn_id} · Bank ref: {h.ref_number||"—"}</div></div><div style={{textAlign:"right"}}><div className="sans" style={{fontSize:14,fontWeight:600}}>MVR {fmt(h.amount)}</div><span className="sans" style={{...statusStyle(h.status),fontSize:10,fontWeight:600,padding:"3px 7px",borderRadius:99,display:"inline-block",marginTop:4,textTransform:"capitalize"}}>{h.status||"pending"}</span></div></div>
      {Array.isArray(h.allocations)&&h.allocations.length>0&&<div className="sans" style={{background:"var(--bg)",borderRadius:9,padding:9,marginTop:10,fontSize:11}}><b>Applied to</b>{h.allocations.map((x,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span>{monthLabel(x.month)}</span><span>MVR {fmt(x.amount)}</span></div>)}</div>}
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
      <div className="sans" style={{ display:"flex", alignItems:"center", gap:7, background:"var(--success-bg)", color:"var(--primary)", fontSize:12, borderRadius:10, padding:"9px 12px", marginBottom:14 }}>
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

/* ---------- Activity ---------- */
export function Activity({ isAdmin, canFinance = false }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("all");
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const loadActivity = () => api.reports.activity().then(setRows).catch(() => setRows([]));
  useEffect(() => { loadActivity(); }, []);
  useEffect(() => { if (canFinance) api.expenses.categories().then(setExpenseCategories).catch(() => {}); }, [canFinance]);

  const openExpense = (row) => {
    if (!canFinance || row.kind !== "expense") return;
    setExpenseError("");
    setEditingExpense({
      ...row,
      description: row.description || row.who || "",
      category_id: row.category_id || "",
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
        transaction_month: editingExpense.transaction_month,
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
  if (rows === null) return <Center>Loading…</Center>;

  const filtered = rows.filter((r) => filter === "all" || r.kind === filter);
  const income = filtered.filter((r) => r.kind === "contribution" || r.kind === "donation").reduce((n, r) => n + Number(r.amount || 0), 0);
  const expenses = filtered.filter((r) => r.kind === "expense").reduce((n, r) => n + Number(r.amount || 0), 0);
  const groups = [];
  filtered.forEach((row) => {
    const label = activityDayLabel(row);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  });

  const filters = [
    ["all", "All"], ["contribution", "Contributions"], ["donation", "Donations"], ["expense", "Expenses"]
  ];

  return (
    <>
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "var(--soft)" }}>Recent activity</div>
        <div style={{ fontSize: 12, color: income - expenses >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>Net {income - expenses >= 0 ? "+" : "−"}MVR {fmt(Math.abs(income - expenses))}</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {filters.map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} className="sans"
            style={{ flex: "0 0 auto", background: filter === value ? "var(--primary)" : "var(--card)", color: filter === value ? "var(--on-primary)" : "var(--muted)", border: "1px solid " + (filter === value ? "var(--primary)" : "var(--border)"), borderRadius: 20, padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sans" style={{ display: "flex", alignItems: "center", gap: 8, margin: "13px 2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: "var(--soft)" }}>
            <span>{group.label}</span><span style={{ height: 1, flex: 1, background: "var(--border)" }} />
          </div>
          {group.rows.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} canFinance={canFinance} onExpenseClick={openExpense} />)}
        </div>
      ))}
      {filtered.length === 0 && <div className="sans" style={{ fontSize: 13, color: "var(--soft)" }}>Nothing here yet.</div>}

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
        <Field label="Expense month" type="month" value={editingExpense.transaction_month || ""} onChange={(v)=>setEditingExpense({...editingExpense,transaction_month:v})}/>
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
/* ---------- Reports (admin) ---------- */
