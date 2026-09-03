import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X, Paperclip } from "lucide-react";
import { LoadingState, EmptyState, MessageBanner, smallBtn, monthNavBtn } from "../components/Shared";
import { shiftMonthValue } from "../utils/date";
import { fmt } from "../utils/format";
import Pagination, { pageSlice } from "../components/Pagination";
import ExpenseForm from "./expenses/ExpenseForm";
import ExpenseDetails from "./expenses/ExpenseDetails";
import useExpensesData from "./expenses/useExpensesData";
import { FILTERS, monthLabel, statusLabel, statusTone } from "./expenses/expenseUtils";

export default function Expenses({ admin }) {
  const {
    month, setMonth,
    filter, setFilter,
    documentsFilter, setDocumentsFilter,
    query, setQuery,
    rows,
    message,
    error,
    page, setPage,
    totals,
    saved,
  } = useExpensesData();
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);

  const expensePage = pageSlice(rows || [], page);
  const handleSaved = async (text = "Expense saved") => {
    setSelected(null);
    setShowAdd(false);
    await saved(text);
  };

  return <>
    <div className="page-sticky-controls expenses-sticky-controls">
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-text)", letterSpacing: .4 }}>EXPENSES</div>
          <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 2 }}>{totals.count} records · Posted MVR {fmt(totals.total)}</div>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} style={{ ...smallBtn("var(--primary-text)"), flex: "0 0 auto", padding: "8px 11px" }}><Plus size={14} /> Add</button>
      </div>

      <div className="reports-month-selector" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => setMonth(shiftMonthValue(month, -1))} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel(month)}</div>
        <button type="button" onClick={() => setMonth(shiftMonthValue(month, 1))} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>

      <div className="expense-filter-row sans">
        {FILTERS.map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} className={filter === value ? "expense-filter-chip active" : "expense-filter-chip"}>{label}</button>)}
      </div>
      <div className="expense-filter-row sans" style={{ marginTop: 6 }}>
        {[['all', 'All docs'], ['with', 'Has documents'], ['without', 'No documents']].map(([value, label]) => <button type="button" key={value} onClick={() => setDocumentsFilter(value)} className={documentsFilter === value ? "expense-filter-chip active" : "expense-filter-chip"}>{label}</button>)}
      </div>

      <div className="expense-search sans">
        <Search size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search description, category or ID" />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
      </div>
    </div>

    <MessageBanner>{message}</MessageBanner>
    <MessageBanner tone="error">{error}</MessageBanner>

    {rows === null ? <LoadingState>Loading expenses…</LoadingState> : rows.length === 0 ? <EmptyState>No expenses found.</EmptyState> : expensePage.rows.map((row) => {
      const tone = statusTone(row.status);
      return <button type="button" key={row.id} onClick={() => setSelected(row)} className="expense-row">
        <div style={{ minWidth: 0, textAlign: "left" }}>
          <div className="sans" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{row.description}</strong>
            {row.status !== "approved" && <span style={{ fontSize: 9, padding: "3px 6px", borderRadius: 999, background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>{statusLabel(row)}</span>}
            {Number(row.document_count || 0) > 0 ? <span title={`${row.document_count} supporting document${Number(row.document_count) === 1 ? "" : "s"}`} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, color: "var(--muted)" }}><Paperclip size={10} />{row.document_count}</span> : <span title="No supporting document" style={{ fontSize: 9, color: "var(--warning)" }}>No document</span>}
          </div>
          <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginTop: 4 }}>
            {row.expense_date || row.transaction_month} · {row.category_name || (row.project_name ? "Project expense / Uncategorised" : "Uncategorised")}{row.project_name ? ` · ${row.project_name}` : ""} · {row.txn_id || `#${row.id}`}
          </div>
        </div>
        <div className="sans" style={{ color: "var(--danger)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>MVR {fmt(row.amount)}</div>
      </button>;
    })}

    <Pagination page={expensePage.page} total={(rows || []).length} onChange={setPage} />

    {showAdd && <ExpenseForm onClose={() => setShowAdd(false)} onSaved={handleSaved} />}
    {selected && <ExpenseDetails admin={admin} row={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />}
  </>;
}
