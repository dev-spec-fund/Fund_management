import React, { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { api } from "../../api";
import { Modal, Field } from "../../components/FormControls";
import { MessageBanner, PrimaryButton } from "../../components/Shared";
import DocumentUploadStatus from "../../components/DocumentUploadStatus";
import { todayValue } from "../../utils/date";
import { fmt } from "../../utils/format";
import { expenseMutationWithOverrides } from "./expenseUtils";

export default function ExpenseForm({ onClose, onSaved, row = null }) {
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
  const createRequestIdRef = useRef(row ? null : (globalThis.crypto?.randomUUID?.() || `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [documentType, setDocumentType] = useState("Receipt");
  const [uploadStatus, setUploadStatus] = useState(null);
  const savedRecordIdRef = useRef(row?.id || null);
  const failedUploadIndexRef = useRef(0);
  const [recordCommitted, setRecordCommitted] = useState(Boolean(row));

  useEffect(() => {
    api.expenses.categories().then(setCategories).catch(() => {});
    api.projects.list({ status: "active" }).then(setProjects).catch(() => {});
  }, []);

  const uploadPendingDocuments = async (expenseId, startIndex = 0) => {
    if (!documents.length) return true;
    for (let index = startIndex; index < documents.length; index += 1) {
      const file = documents[index];
      try {
        setUploadStatus({ phase: "uploading", name: file.name || "Document", current: index + 1, total: documents.length });
        await api.expenses.uploadDocument(expenseId, file, documentType);
        failedUploadIndexRef.current = index + 1;
      } catch (uploadError) {
        failedUploadIndexRef.current = index;
        setUploadStatus({ phase: "error", name: file.name || "Document", current: index + 1, total: documents.length, error: uploadError.message || "Upload failed" });
        setError(`Expense saved, but ${documents.length - index} document${documents.length - index === 1 ? "" : "s"} still need uploading. Retry below; the expense will not be created again.`);
        return false;
      }
    }
    setUploadStatus({ phase: "processing", name: documents[documents.length - 1]?.name || "Document", current: documents.length, total: documents.length });
    setUploadStatus({ phase: "success", name: documents.length === 1 ? documents[0].name : `${documents.length} documents`, current: documents.length, total: documents.length });
    return true;
  };

  const finishSavedFlow = async () => {
    setError("");
    await onSaved(row ? "Expense updated" : documents.length ? `Expense added · ${documents.length} document${documents.length === 1 ? "" : "s"} saved` : "Expense added");
  };

  const retryUploads = async () => {
    const expenseId = savedRecordIdRef.current;
    if (!expenseId || busy) return;
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadPendingDocuments(expenseId, failedUploadIndexRef.current);
      if (uploaded) await finishSavedFlow();
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form.description.trim() || !form.expense_date || Number(form.amount) <= 0) return setError("Description, amount and expense date are required.");
    if (!form.project_id && !form.category_id) return setError("Category is required for a normal expense. Select a project to make category optional.");
    if (!row && savedRecordIdRef.current) return retryUploads();
    setBusy(true);
    setError("");
    try {
      const payload = {
        description: form.description.trim(),
        category_id: form.category_id || null,
        project_id: form.project_id || null,
        amount: Number(form.amount),
        expense_date: form.expense_date,
        ...(!row && createRequestIdRef.current ? { idempotency_key: createRequestIdRef.current } : {}),
      };
      const result = row
        ? await expenseMutationWithOverrides((data) => api.expenses.update(row.id, data), payload)
        : await expenseMutationWithOverrides((data) => api.expenses.create(data), payload);
      const expenseId = row?.id || result?.id;
      if (!expenseId) throw new Error("Expense was saved but its record ID was not returned.");
      savedRecordIdRef.current = expenseId;
      setRecordCommitted(true);
      failedUploadIndexRef.current = 0;
      const uploaded = await uploadPendingDocuments(expenseId, 0);
      if (!uploaded) return;
      await finishSavedFlow();
    } catch (e) {
      setError(e.message || "Could not save expense");
    } finally {
      setBusy(false);
    }
  };

  return <Modal onClose={onClose} closeDisabled={busy} title={row ? "Edit expense" : "Add expense"}>
    <MessageBanner tone="error">{error}</MessageBanner>
    <Field label="Description" value={form.description} disabled={!row && recordCommitted} onChange={(value) => setForm({ ...form, description: value })} />
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{form.project_id ? "Category (optional)" : "Category"}</div>
    <select disabled={!row && recordCommitted} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="sans" style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
      <option value="">{form.project_id ? "No category / Project expense" : "Select category"}</option>
      {categories.filter((category) => Number(category.active) !== 0 || Number(category.id) === Number(form.category_id)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
    <select disabled={!row && recordCommitted} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans" style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
      <option value="">None / General expense</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.name}{project.budget == null ? " · Open cost" : ` · MVR ${fmt(project.remaining_budget)} left`}</option>)}
      {row?.project_id && !projects.some((project) => Number(project.id) === Number(row.project_id)) && <option value={row.project_id}>{row.project_code || "Project"} · {row.project_name || "Linked project"}</option>}
    </select>
    <Field label="Amount" type="number" prefix="MVR" value={form.amount} disabled={!row && recordCommitted} onChange={(value) => setForm({ ...form, amount: value })} />
    <Field label="Expense date" type="date" value={form.expense_date} disabled={!row && recordCommitted} onChange={(value) => setForm({ ...form, expense_date: value })} />
    <div className="sans" style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Supporting documents (optional)</div>
      <select className="sans" disabled={busy || (!row && recordCommitted)} value={documentType} onChange={(e) => setDocumentType(e.target.value)} style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "9px 10px", marginBottom: 7, background: "var(--card)", color: "var(--text)" }}>
        {['Invoice', 'Receipt', 'Payment Slip', 'Quotation', 'Other'].map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "1px dashed var(--border-strong)", borderRadius: 10, padding: "10px 12px", cursor: "pointer", background: "var(--card)", fontSize: 12 }}>
        <Paperclip size={14} /> {documents.length ? `${documents.length} file${documents.length === 1 ? "" : "s"} selected` : "Attach receipt, invoice, slip or PDF"}
        <input disabled={busy || (!row && recordCommitted)} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { const next = Array.from(e.target.files || []).slice(0, 10); setDocuments(next); failedUploadIndexRef.current = 0; setUploadStatus(next.length ? { phase: "pending", name: next.length === 1 ? next[0].name : `${next.length} documents`, current: 0, total: next.length } : null); }} />
      </label>
      <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 5 }}>Up to 10 files per save · maximum 20 MB each · stored in Telegram, with references kept in D1.</div>
      {documents.length > 0 && <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>{documents.map((file) => file.name).join(" · ")}</div>}
      <DocumentUploadStatus status={uploadStatus} onRetry={uploadStatus?.phase === "error" ? retryUploads : undefined} />
    </div>
    <PrimaryButton onClick={busy ? undefined : save}>{busy ? (savedRecordIdRef.current && documents.length ? "Uploading documents…" : "Saving expense…") : row ? "Save changes" : savedRecordIdRef.current && uploadStatus?.phase === "error" ? "Retry document upload" : "Save expense"}</PrimaryButton>
  </Modal>;
}
