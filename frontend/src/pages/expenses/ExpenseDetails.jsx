import React, { useEffect, useRef, useState } from "react";
import { Eye, FileText, Pencil, Plus, RotateCcw, Send, Tag, Trash2, Paperclip } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../../components/FormControls";
import { MessageBanner, PreviewLoadState, smallBtn } from "../../components/Shared";
import PdfPreview from "../../components/PdfPreview";
import { fmt } from "../../utils/format";
import { adminCan } from "../../utils/permissions";
import ExpenseForm from "./ExpenseForm";
import { statusLabel } from "./expenseUtils";

export default function ExpenseDetails({ admin, row, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docPreview, setDocPreview] = useState(null);
  const previewRequestRef = useRef(0);
  const [addDocumentType, setAddDocumentType] = useState("Receipt");
  const canViewDocuments = adminCan(admin, "finance");

  const loadDocuments = async () => {
    if (!canViewDocuments) return setDocuments([]);
    try {
      setDocuments(await api.expenses.documents(row.id));
    } catch (e) {
      setError(e.message || "Could not load documents");
      setDocuments([]);
    }
  };

  useEffect(() => { loadDocuments(); }, [row.id, canViewDocuments]);
  useEffect(() => () => {
    if (docPreview?.url) URL.revokeObjectURL(docPreview.url);
  }, [docPreview]);

  const addDocuments = async (files) => {
    const selected = Array.from(files || []).slice(0, 10);
    if (!selected.length) return;
    setDocBusy(true);
    setError("");
    try {
      for (const file of selected) await api.expenses.uploadDocument(row.id, file, addDocumentType);
      await loadDocuments();
    } catch (e) {
      setError(e.message || "Could not save document to Telegram");
    } finally {
      setDocBusy(false);
    }
  };

  const openDocument = async (document) => {
    const requestId = ++previewRequestRef.current;
    const name = document.display_name || document.original_filename || "Expense document";
    setDocPreview((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return { status: "loading", url: "", name, mime: document.mime_type || "", document };
    });
    setError("");
    try {
      const blob = await api.expenses.downloadDocument(row.id, document.id);
      const url = URL.createObjectURL(blob);
      if (requestId !== previewRequestRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setDocPreview({ status: "ready", url, name, mime: blob.type || document.mime_type || "application/octet-stream", document });
    } catch (e) {
      if (requestId !== previewRequestRef.current) return;
      setDocPreview({ status: "error", url: "", name, mime: document.mime_type || "", document, error: e.message || "Could not open document" });
    }
  };

  const closeDocumentPreview = () => {
    previewRequestRef.current += 1;
    setDocPreview((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });
  };

  const openPdfDocument = async () => {
    if (!docPreview?.url) return;
    try {
      const response = await fetch(docPreview.url);
      const blob = await response.blob();
      const filename = docPreview.name || "expense-document.pdf";
      const file = new File([blob], filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`, { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = docPreview.url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e) {
      setError(e?.message || "Could not open PDF");
    }
  };

  const sendDocument = async (document) => {
    setDocBusy(true);
    setError("");
    try {
      await api.expenses.sendDocumentToTelegram(row.id, document.id);
    } catch (e) {
      setError(e.message || "Could not send document to Telegram");
    } finally {
      setDocBusy(false);
    }
  };

  const editDocument = async (document) => {
    const label = prompt("Document label:", document.display_name || document.original_filename || "");
    if (label === null || !label.trim()) return;
    const type = prompt("Document type: Invoice, Receipt, Payment Slip, Quotation or Other", document.document_type || "Other");
    if (type === null) return;
    const valid = ['Invoice', 'Receipt', 'Payment Slip', 'Quotation', 'Other'];
    const normalized = valid.find((value) => value.toLowerCase() === type.trim().toLowerCase());
    if (!normalized) return setError("Choose a valid document type: Invoice, Receipt, Payment Slip, Quotation or Other.");
    setDocBusy(true);
    setError("");
    try {
      await api.expenses.updateDocument(row.id, document.id, { display_name: label.trim(), document_type: normalized });
      await loadDocuments();
    } catch (e) {
      setError(e.message || "Could not update document");
    } finally {
      setDocBusy(false);
    }
  };

  const removeDocument = async (document) => {
    const reason = prompt("Reason for removing this document from the expense:");
    if (!reason || reason.trim().length < 3) return;
    setDocBusy(true);
    setError("");
    try {
      await api.expenses.removeDocument(row.id, document.id, reason.trim());
      await loadDocuments();
    } catch (e) {
      setError(e.message || "Could not remove document");
    } finally {
      setDocBusy(false);
    }
  };

  const reverse = async () => {
    const reason = prompt("Reason for reversing this posted expense:");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.governance.reverse("expense", row.id, reason.trim());
      await onSaved(`Expense reversed · ${result.reversal_id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) return <ExpenseForm row={row} onClose={onClose} onSaved={onSaved} />;

  return <>
    <Modal onClose={onClose} closeDisabled={busy || docBusy} title={row.txn_id || "Expense details"}>
      <MessageBanner tone="error">{error}</MessageBanner>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <Detail label="Description" value={row.description} />
        <Detail label="Amount" value={`MVR ${fmt(row.amount)}`} />
        <Detail label="Expense date" value={row.expense_date || row.transaction_month || "—"} />
        <Detail label="Category" value={row.category_name || (row.project_name ? "Project expense / Uncategorised" : "Uncategorised")} />
        <Detail label="Project" value={row.project_name ? `${row.project_code || ""} ${row.project_name}`.trim() : "None / General"} />
        <Detail label="Status" value={statusLabel(row)} />
        <Detail label="Logged by" value={row.logged_by_name || `Admin #${row.logged_by}`} />
        {row.void_reason && <Detail label="Reason" value={row.void_reason} />}
        {Number(row.fund_override || 0) === 1 && <Detail label="Fund override" value={row.fund_override_reason || "Super Admin override"} />}
        {row.budget_override_reason && <Detail label="Budget override" value={row.budget_override_reason} />}
      </div>
      {canViewDocuments && <div className="sans" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginBottom: 14, background: "var(--card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}><Paperclip size={14} /> Supporting documents</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select className="sans" value={addDocumentType} onChange={(e) => setAddDocumentType(e.target.value)} disabled={docBusy} style={{ border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 7px", background: "var(--card)", color: "var(--text)", fontSize: 10 }}>{['Invoice', 'Receipt', 'Payment Slip', 'Quotation', 'Other'].map((type) => <option key={type} value={type}>{type}</option>)}</select>
            <label style={{ ...smallBtn("var(--primary-text)"), cursor: docBusy ? "wait" : "pointer", padding: "6px 9px" }}>
              <Plus size={12} /> Add
              <input disabled={docBusy} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { addDocuments(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        </div>
        {documents === null ? <div style={{ fontSize: 11, color: "var(--soft)" }}>Loading documents…</div> : documents.length === 0 ? <div style={{ fontSize: 11, color: "var(--soft)" }}>No documents attached.</div> : documents.map((document) => <div key={document.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--divider)", padding: "8px 0" }}>
          <FileText size={15} style={{ flex: "0 0 auto" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{document.display_name || document.original_filename}</div>
            <div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{document.document_type || "Other"} · {document.uploaded_by_name || "Admin"} · {document.created_at ? new Date(document.created_at.replace(" ", "T") + "Z").toLocaleString() : ""}{document.file_size ? ` · ${(Number(document.file_size) / 1024 / 1024).toFixed(Number(document.file_size) > 1048576 ? 1 : 2)} MB` : ""}</div>
          </div>
          <button type="button" disabled={docBusy} title="Preview document" onClick={() => openDocument(document)} style={{ ...smallBtn("var(--primary-text)"), padding: 6 }}><Eye size={13} /></button>
          <button type="button" disabled={docBusy} title="Send to my Telegram" onClick={() => sendDocument(document)} style={{ ...smallBtn("var(--primary-text)"), padding: 6 }}><Send size={13} /></button>
          <button type="button" disabled={docBusy} title="Edit document label/type" onClick={() => editDocument(document)} style={{ ...smallBtn("var(--primary-text)"), padding: 6 }}><Tag size={13} /></button>
          <button type="button" disabled={docBusy} title="Remove document" onClick={() => removeDocument(document)} style={{ ...smallBtn("var(--danger)"), padding: 6 }}><Trash2 size={13} /></button>
        </div>)}
      </div>}
      {canViewDocuments && documents?.length === 0 && <div className="sans" style={{ fontSize: 10, color: "var(--warning)", marginBottom: 12 }}>No supporting document is attached to this expense. This is only a warning; saving/posting is still allowed.</div>}
      {!canViewDocuments && <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginBottom: 12 }}>Supporting expense documents are restricted to finance admins.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {row.status !== "reversed" && row.status !== "voided" && <button type="button" disabled={busy} onClick={() => setEditing(true)} style={smallBtn("var(--primary-text)")}><Pencil size={13} /> Edit</button>}
        {row.status === "approved" && <button type="button" disabled={busy} onClick={reverse} style={smallBtn("var(--danger)")}><RotateCcw size={13} /> Reverse</button>}
      </div>
    </Modal>
    {docPreview && <Modal onClose={closeDocumentPreview} title={docPreview.name}>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 8, textAlign: "center" }}>
        {docPreview.status === "loading" ? <PreviewLoadState label={String(docPreview.mime).includes("pdf") ? "Loading PDF…" : "Loading document…"} /> : docPreview.status === "error" ? <PreviewLoadState status="error" error={docPreview.error} onRetry={() => openDocument(docPreview.document)} /> : String(docPreview.mime).startsWith("image/") ? <img src={docPreview.url} alt={docPreview.name} style={{ display: "block", width: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8, background: "#fff" }} /> : String(docPreview.mime).includes("pdf") ? <PdfPreview url={docPreview.url} name={docPreview.name} onOpen={openPdfDocument} onSend={docPreview.document ? () => sendDocument(docPreview.document) : undefined} sendBusy={docBusy} /> : <div className="sans" style={{ padding: 20, fontSize: 11, color: "var(--muted)" }}>This document type cannot be previewed inside the Mini App. Use “Send to my Telegram” to open the original file.</div>}
      </div>
    </Modal>}
  </>;
}

function Detail({ label, value }) {
  return <div className="sans" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--divider)", fontSize: 12 }}><span style={{ color: "var(--muted)" }}>{label}</span><strong style={{ textAlign: "right" }}>{value}</strong></div>;
}
