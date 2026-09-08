import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X, Paperclip, SlidersHorizontal, ReceiptText, FileWarning, CircleDollarSign } from "lucide-react";
import { LoadingState, EmptyState, MessageBanner, monthNavBtn } from "../components/Shared";
import { shiftMonthValue } from "../utils/date";
import { fmt } from "../utils/format";
import Pagination, { pageSlice } from "../components/Pagination";
import ExpenseForm from "./expenses/ExpenseForm";
import ExpenseDetails from "./expenses/ExpenseDetails";
import useExpensesData from "./expenses/useExpensesData";
import { FILTERS, monthLabel, statusLabel, statusTone } from "./expenses/expenseUtils";
import { adminCan } from "../utils/permissions";

export default function Expenses({ admin }) {
  const canManageExpenses=adminCan(admin,"expenses_manage");
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
  const [showFilters, setShowFilters] = useState(false);

  const expensePage = pageSlice(rows || [], page);
  const handleSaved = async (text = "Expense saved") => {
    setSelected(null);
    setShowAdd(false);
    await saved(text);
  };

  return <>
    <div className="page-sticky-controls expenses-sticky-controls">
      <div className="finance-page-head sans finance-page-head-compact">
        <div>
          <div className="finance-page-kicker">FINANCE</div>
          <div className="finance-page-title">Expenses</div>
          <div className="finance-page-subtitle">Track fund spending, supporting documents and project expenses.</div>
        </div>
        {canManageExpenses&&<button type="button" onClick={() => setShowAdd(true)} className="finance-primary-button"><Plus size={15} /> Add expense</button>}
      </div>

      <div className="finance-kpi-grid finance-kpi-grid-3 sans">
        <div className="finance-kpi-card tone-red"><span><CircleDollarSign size={16}/></span><div><small>Posted</small><strong>MVR {fmt(totals.total)}</strong></div></div>
        <div className="finance-kpi-card tone-neutral"><span><ReceiptText size={16}/></span><div><small>Records</small><strong>{totals.count}</strong></div></div>
        <div className="finance-kpi-card tone-amber"><span><FileWarning size={16}/></span><div><small>Documents</small><strong>{(rows || []).filter((r)=>Number(r.document_count||0)===0).length} missing</strong></div></div>
      </div>

      <div className="reports-month-selector" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => setMonth(shiftMonthValue(month, -1))} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel(month)}</div>
        <button type="button" onClick={() => setMonth(shiftMonthValue(month, 1))} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>

      <div className="expense-filter-row sans">
        {FILTERS.map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} className={filter === value ? "expense-filter-chip active" : "expense-filter-chip"}>{label}</button>)}
      </div>

      <div className="expense-search-row">
        <div className="expense-search sans">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search expenses" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
        </div>
        <button
          type="button"
          className={`expense-filter-toggle sans${showFilters || documentsFilter !== "all" ? " active" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal size={14} />
          Filter{documentsFilter !== "all" ? " · 1" : ""}
        </button>
      </div>

      {showFilters && <div className="expense-secondary-filters sans">
        <div className="expense-secondary-filter-label">Documents</div>
        <div className="expense-filter-row">
          {[['all', 'All'], ['with', 'Has document'], ['without', 'No document']].map(([value, label]) => <button type="button" key={value} onClick={() => setDocumentsFilter(value)} className={documentsFilter === value ? "expense-filter-chip active" : "expense-filter-chip"}>{label}</button>)}
        </div>
      </div>}
    </div>

    <MessageBanner>{message}</MessageBanner>
    <MessageBanner tone="error">{error}</MessageBanner>

    {rows === null ? <LoadingState>Loading expenses…</LoadingState> : rows.length === 0 ? <EmptyState>No expenses found.</EmptyState> : expensePage.rows.map((row) => {
      const tone = statusTone(row.status);
      return <button type="button" key={row.id} onClick={() => setSelected(row)} className="expense-row">
        <div className="expense-row-main">
          <div className="sans expense-row-title-line">
            <strong className="expense-row-title">{row.description}</strong>
            {row.status !== "approved" && <span className="expense-status-badge" style={{ background: tone.bg, color: tone.color, borderColor: tone.border }}>{statusLabel(row)}</span>}
          </div>
          <div className="sans expense-row-meta">
            <span>{row.expense_date || row.transaction_month}</span>
            <span className="expense-meta-separator" aria-hidden="true"></span>
            <span>{row.category_name || (row.project_name ? "Project expense" : "Uncategorised")}</span>
            {row.project_name && <><span className="expense-meta-separator" aria-hidden="true"></span><span>{row.project_name}</span></>}
          </div>
          <div className="sans expense-row-foot">
            <span>{row.txn_id || `#${row.id}`}</span>
            {Number(row.document_count || 0) > 0
              ? <span className="expense-document-indicator" title={`${row.document_count} supporting document${Number(row.document_count) === 1 ? "" : "s"}`}><Paperclip size={10} />{row.document_count}</span>
              : <span className="expense-document-missing">No document</span>}
          </div>
        </div>
        <div className="sans expense-row-side"><div className="expense-row-amount">MVR {fmt(row.amount)}</div><ChevronRight size={15} className="expense-row-chevron" /></div>
      </button>;
    })}

    <Pagination page={expensePage.page} total={(rows || []).length} onChange={setPage} />

    {canManageExpenses && showAdd && <ExpenseForm onClose={() => setShowAdd(false)} onSaved={handleSaved} />}
    {selected && <ExpenseDetails admin={admin} row={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />}
  </>;
}
