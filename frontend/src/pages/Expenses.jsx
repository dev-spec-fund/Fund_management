import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, Pencil, RotateCcw, Check, X, Paperclip, FileText, Send, Eye } from "lucide-react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, MessageBanner, PrimaryButton, smallBtn, monthNavBtn } from "../components/Shared";
import { currentMonthValue, shiftMonthValue, todayValue } from "../utils/date";
import { fmt } from "../utils/format";

const FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["reversed", "Reversed"],
  ["voided", "Voided/Rejected"],
];

function monthLabel(month) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}

function statusLabel(row) {
  if (row.status === "voided" && String(row.void_reason || "").toLowerCase().includes("reject")) return "Rejected";
  return String(row.status || "").replace(/^./, (c) => c.toUpperCase());
}

function statusTone(status) {
  if (status === "approved") return { bg: "var(--success-bg)", color: "var(--success-strong)", border: "var(--success-border)" };
  if (status === "pending") return { bg: "var(--warning-bg)", color: "var(--warning)", border: "var(--warning-border)" };
  return { bg: "var(--danger-bg)", color: "var(--danger)", border: "var(--danger-border)" };
}

async function expenseMutationWithOverrides(run, payload = {}) {
  let next = { ...payload };
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await run(next); } catch (e) {
      if (e.code === "PROJECT_BUDGET_EXCEEDED" && e.override_allowed && !next.budget_override_reason) {
        const reason = prompt(`${e.message}\n\nReason for exceeding the project budget:`);
        if (!reason || reason.trim().length < 3) throw e;
        next = { ...next, budget_override_reason: reason.trim() };
        continue;
      }
      if (e.code === "INSUFFICIENT_FUND" && e.override_allowed && !next.override_fund_limit) {
        const reason = prompt(`${e.message}\n\nSuper Admin override reason:`);
        if (!reason || reason.trim().length < 3) throw e;
        next = { ...next, override_fund_limit: true, override_reason: reason.trim() };
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not save expense");
}

export default function Expenses({ admin }) {
  const [month, setMonth] = useState(currentMonthValue());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = async () => {
    setError("");
    try {
      const data = await api.expenses.list({ month, status: filter === "all" ? "" : filter, q: debouncedQuery });
      setRows(data);
    } catch (e) {
      setError(e.message || "Could not load expenses");
      setRows([]);
    }
  };

  useEffect(() => { setRows(null); load(); }, [month, filter, debouncedQuery]);

  const totals = useMemo(() => {
    const base = rows || [];
    return {
      total: base.reduce((s, r) => s + (r.status === "approved" ? Number(r.amount || 0) : 0), 0),
      pending: base.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.amount || 0), 0),
      count: base.length,
    };
  }, [rows]);

  const saved = async (text = "Expense saved") => {
    setSelected(null); setShowAdd(false); setMessage(text); await load();
  };

  return (
    <>
      <div className="page-sticky-controls expenses-sticky-controls">
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-text)", letterSpacing: .4 }}>EXPENSES</div>
            <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 2 }}>{totals.count} records · Approved MVR {fmt(totals.total)}</div>
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

        <div className="expense-search sans">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search description, category or ID" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
        </div>
      </div>

      <MessageBanner>{message}</MessageBanner>
      <MessageBanner tone="error">{error}</MessageBanner>
      {totals.pending > 0 && <div className="sans" style={{ fontSize: 11, color: "var(--warning)", marginBottom: 10 }}>Pending approval: MVR {fmt(totals.pending)}</div>}

      {rows === null ? <Center>Loading expenses…</Center> : rows.length === 0 ? <Center>No expenses found.</Center> : rows.map((row) => {
        const tone = statusTone(row.status);
        return <button type="button" key={row.id} onClick={() => setSelected(row)} className="expense-row">
          <div style={{ minWidth: 0, textAlign: "left" }}>
            <div className="sans" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>{row.description}</strong>
              <span style={{ fontSize: 9, padding: "3px 6px", borderRadius: 999, background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}>{statusLabel(row)}</span>
              {Number(row.document_count||0)>0 && <span title={`${row.document_count} supporting document${Number(row.document_count)===1?"":"s"}`} style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:9, color:"var(--muted)" }}><Paperclip size={10} />{row.document_count}</span>}
            </div>
            <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginTop: 4 }}>
              {row.expense_date || row.transaction_month} · {row.category_name || (row.project_name ? "Project expense / Uncategorised" : "Uncategorised")}{row.project_name ? ` · ${row.project_name}` : ""} · {row.txn_id || `#${row.id}`}
            </div>
          </div>
          <div className="sans" style={{ color: "var(--danger)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>MVR {fmt(row.amount)}</div>
        </button>;
      })}

      {showAdd && <ExpenseForm admin={admin} onClose={() => setShowAdd(false)} onSaved={saved} />}
      {selected && <ExpenseDetails admin={admin} row={selected} onClose={() => setSelected(null)} onSaved={saved} />}
    </>
  );
}

function ExpenseForm({ admin, onClose, onSaved, row = null }) {
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    description: row?.description || "",
    category_id: row?.category_id || "",
    project_id: row?.project_id || "",
    amount: row?.amount ?? "",
    expense_date: row?.expense_date || (row?.transaction_month ? `${row.transaction_month}-01` : todayValue()),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  useEffect(() => { api.expenses.categories().then(setCategories).catch(() => {}); api.projects.list({ status: "active" }).then(setProjects).catch(() => {}); }, []);

  const save = async () => {
    if (!form.description.trim() || !form.expense_date || Number(form.amount) <= 0) return setError("Description, amount and expense date are required.");
    if (!form.project_id && !form.category_id) return setError("Category is required for a normal expense. Select a project to make category optional.");
    setBusy(true); setError("");
    try {
      const payload = { description: form.description.trim(), category_id: form.category_id || null, project_id: form.project_id || null, amount: Number(form.amount), expense_date: form.expense_date };
      const result = row
        ? await expenseMutationWithOverrides((data) => api.expenses.update(row.id, data), payload)
        : await expenseMutationWithOverrides((data) => api.expenses.create(data), payload);
      const expenseId = row?.id || result?.id;
      if (documents.length && expenseId) {
        try {
          for (const file of documents) await api.expenses.uploadDocument(expenseId, file);
        } catch (uploadError) {
          setError(`Expense saved, but a document could not be saved to Telegram: ${uploadError.message || "Upload failed"}. Open the expense and retry.`);
          return;
        }
      }
      await onSaved(row ? "Expense updated" : documents.length ? `Expense added · ${documents.length} document${documents.length===1?"":"s"} saved` : "Expense added");
    } catch (e) { setError(e.message || "Could not save expense"); } finally { setBusy(false); }
  };

  return <Modal onClose={onClose} title={row ? "Edit expense" : "Add expense"}>
    <MessageBanner tone="error">{error}</MessageBanner>
    <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{form.project_id ? "Category (optional)" : "Category"}</div>
    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="sans" style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
      <option value="">{form.project_id ? "No category / Project expense" : "Select category"}</option>
      {categories.filter((c) => Number(c.active) !== 0 || Number(c.id) === Number(form.category_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
    <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans" style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
      <option value="">None / General expense</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} · {p.name}{p.budget == null ? " · Open cost" : ` · MVR ${fmt(p.remaining_budget)} left`}</option>)}
      {row?.project_id && !projects.some((p) => Number(p.id) === Number(row.project_id)) && <option value={row.project_id}>{row.project_code || "Project"} · {row.project_name || "Linked project"}</option>}
    </select>
    <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
    <Field label="Expense date" type="date" value={form.expense_date} onChange={(v) => setForm({ ...form, expense_date: v })} />
    <div className="sans" style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Supporting documents (optional)</div>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "1px dashed var(--border-strong)", borderRadius: 10, padding: "10px 12px", cursor: "pointer", background: "var(--card)", fontSize: 12 }}>
        <Paperclip size={14} /> {documents.length ? `${documents.length} file${documents.length===1?"":"s"} selected` : "Attach receipt, invoice, slip or PDF"}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => setDocuments(Array.from(e.target.files || []).slice(0, 10))} />
      </label>
      <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 5 }}>Up to 10 files per save · maximum 20 MB each · stored in Telegram, with references kept in D1.</div>
      {documents.length > 0 && <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>{documents.map((f) => f.name).join(" · ")}</div>}
    </div>
    <PrimaryButton onClick={busy ? undefined : save}>{busy ? "Saving…" : row ? "Save changes" : "Save expense"}</PrimaryButton>
  </Modal>;
}

function ExpenseDetails({ admin, row, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState(null);
  const [docBusy, setDocBusy] = useState(false);
  const canViewDocuments = ["owner","super_admin","treasurer"].includes(String(admin?.role || ""));

  const loadDocuments = async () => { if (!canViewDocuments) return setDocuments([]); try { setDocuments(await api.expenses.documents(row.id)); } catch (e) { setError(e.message || "Could not load documents"); setDocuments([]); } };
  useEffect(() => { loadDocuments(); }, [row.id, canViewDocuments]);

  const addDocuments = async (files) => {
    const selected = Array.from(files || []).slice(0, 10); if (!selected.length) return;
    setDocBusy(true); setError("");
    try { for (const file of selected) await api.expenses.uploadDocument(row.id, file); await loadDocuments(); }
    catch (e) { setError(e.message || "Could not save document to Telegram"); } finally { setDocBusy(false); }
  };
  const openDocument = async (doc) => {
    setDocBusy(true); setError("");
    try { const blob=await api.expenses.downloadDocument(row.id, doc.id); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.target="_blank"; a.rel="noopener noreferrer"; a.download=doc.original_filename || "document"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { setError(e.message || "Could not open document"); } finally { setDocBusy(false); }
  };
  const sendDocument = async (doc) => {
    setDocBusy(true); setError("");
    try { await api.expenses.sendDocumentToTelegram(row.id, doc.id); }
    catch (e) { setError(e.message || "Could not send document to Telegram"); } finally { setDocBusy(false); }
  };

  if (editing) return <ExpenseForm admin={admin} row={row} onClose={onClose} onSaved={onSaved} />;

  const approve = async () => { setBusy(true); setError(""); try { await expenseMutationWithOverrides((data) => api.expenses.approve(row.id, data), {}); await onSaved("Expense approved"); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const reject = async () => { if (!confirm("Reject this pending expense?")) return; setBusy(true); setError(""); try { await api.expenses.reject(row.id); await onSaved("Expense rejected"); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const reverse = async () => {
    const reason = prompt("Reason for reversing this approved expense:");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError("");
    try { const r = await api.governance.reverse("expense", row.id, reason.trim()); await onSaved(`Expense reversed · ${r.reversal_id}`); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return <Modal onClose={onClose} title={row.txn_id || "Expense details"}>
    <MessageBanner tone="error">{error}</MessageBanner>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <Detail label="Description" value={row.description} />
      <Detail label="Amount" value={`MVR ${fmt(row.amount)}`} />
      <Detail label="Expense date" value={row.expense_date || row.transaction_month || "—"} />
      <Detail label="Category" value={row.category_name || (row.project_name ? "Project expense / Uncategorised" : "Uncategorised")} />
      <Detail label="Project" value={row.project_name ? `${row.project_code || ""} ${row.project_name}`.trim() : "None / General"} />
      <Detail label="Status" value={statusLabel(row)} />
      <Detail label="Logged by" value={row.logged_by_name || `Admin #${row.logged_by}`} />
      {row.approved_by_name && <Detail label="Approved by" value={row.approved_by_name} />}
      {row.void_reason && <Detail label="Reason" value={row.void_reason} />}
      {Number(row.fund_override||0)===1 && <Detail label="Fund override" value={row.fund_override_reason || "Super Admin override"} />}
      {row.budget_override_reason && <Detail label="Budget override" value={row.budget_override_reason} />}
    </div>
    {canViewDocuments && <div className="sans" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginBottom: 14, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><Paperclip size={14} /> Supporting documents</div>
        <label style={{ ...smallBtn("var(--primary-text)"), cursor: docBusy ? "wait" : "pointer", padding: "6px 9px" }}>
          <Plus size={12} /> Add
          <input disabled={docBusy} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { addDocuments(e.target.files); e.target.value=""; }} />
        </label>
      </div>
      {documents === null ? <div style={{ fontSize: 11, color: "var(--soft)" }}>Loading documents…</div> : documents.length === 0 ? <div style={{ fontSize: 11, color: "var(--soft)" }}>No documents attached.</div> : documents.map((doc) => <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--divider)", padding: "8px 0" }}>
        <FileText size={15} style={{ flex: "0 0 auto" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.original_filename}</div>
          <div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{doc.uploaded_by_name || "Admin"} · {doc.created_at ? new Date(doc.created_at.replace(" ","T")+"Z").toLocaleString() : ""}{doc.file_size ? ` · ${(Number(doc.file_size)/1024/1024).toFixed(Number(doc.file_size)>1048576?1:2)} MB` : ""}</div>
        </div>
        <button type="button" disabled={docBusy} title="Open document" onClick={() => openDocument(doc)} style={{ ...smallBtn("var(--primary-text)"), padding: 6 }}><Eye size={13} /></button>
        <button type="button" disabled={docBusy} title="Send to my Telegram" onClick={() => sendDocument(doc)} style={{ ...smallBtn("var(--primary-text)"), padding: 6 }}><Send size={13} /></button>
      </div>)}
    </div>}
    {!canViewDocuments && <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginBottom: 12 }}>Supporting expense documents are restricted to finance admins.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {row.status !== "reversed" && row.status !== "voided" && <button type="button" disabled={busy} onClick={() => setEditing(true)} style={smallBtn("var(--primary-text)")}><Pencil size={13} /> Edit</button>}
      {row.status === "pending" && <button type="button" disabled={busy} onClick={approve} style={smallBtn("var(--success-strong)")}><Check size={13} /> Approve</button>}
      {row.status === "pending" && <button type="button" disabled={busy} onClick={reject} style={smallBtn("var(--danger)")}><X size={13} /> Reject</button>}
      {row.status === "approved" && <button type="button" disabled={busy} onClick={reverse} style={smallBtn("var(--danger)")}><RotateCcw size={13} /> Reverse</button>}
    </div>
    {row.status === "pending" && <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginTop: 10 }}>If you created this expense and it requires second approval, another finance admin must approve it.</div>}
  </Modal>;
}

function Detail({ label, value }) {
  return <div className="sans" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--divider)", fontSize: 12 }}><span style={{ color: "var(--muted)" }}>{label}</span><strong style={{ textAlign: "right" }}>{value}</strong></div>;
}
