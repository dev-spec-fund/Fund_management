import React, { useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { Modal, Field } from "../../components/FormControls";
import { LoadingState, approveBtn, rejectBtn } from "../../components/Shared";
import { currentMonthValue, shiftMonthValue, todayValue } from "../../utils/date";
import { fmt } from "../../utils/format";
import Pagination, { pageSlice } from "../../components/Pagination";
import { ActivityRow, activityDayLabel } from "../../components/ActivityRow";

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
  const [page, setPage] = useState(1);

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

  const loadActivity = async (range = appliedRange, { silent = false } = {}) => {
    if (!silent) setActivityLoading(true);
    if (!silent) setActivityError("");
    try {
      setRows(await api.reports.activity({ from: range.from, to: range.to }));
    } catch (e) {
      if (!silent) {
        setRows([]);
        setActivityError(e?.message || "Could not load activity.");
      }
    } finally {
      if (!silent) setActivityLoading(false);
    }
  };
  useEffect(() => { loadActivity(appliedRange); }, [appliedRange.from, appliedRange.to]);
  useEffect(() => onDataChange(() => loadActivity(appliedRange, { silent: true })), [appliedRange.from, appliedRange.to]);
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
  if (rows === null) return <LoadingState>Loading activity…</LoadingState>;

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
  const activityPage = pageSlice(filtered, page);
  const groups = [];
  activityPage.rows.forEach((row) => {
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
        <Pagination page={activityPage.page} total={filtered.length} onChange={setPage} />
      </div>

      {editingExpense && <Modal title="Edit expense" closeDisabled={expenseBusy} onClose={() => !expenseBusy && setEditingExpense(null)}>
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
        <button type="button" disabled={expenseBusy} onClick={saveExpense} style={{...approveBtn,width:"100%",padding:"10px 12px",opacity:expenseBusy?.6:1}}>
          {expenseBusy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" disabled={expenseBusy} onClick={voidExpense} style={{...rejectBtn,width:"100%",padding:"10px 12px",marginTop:8,opacity:expenseBusy?.6:1}}>
          Void expense
        </button>
      </Modal>}
    </>
  );
}
/* ---------- Reports (admin) ---------- */
