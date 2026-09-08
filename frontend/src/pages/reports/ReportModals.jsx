import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Modal, Field } from "../../components/FormControls";
import { MessageBanner, PrimaryButton } from "../../components/Shared";
import DocumentUploadStatus from "../../components/DocumentUploadStatus";
import { fmt } from "../../utils/format";
import { todayValue } from "../../utils/date";
import { requestText } from "../../utils/systemDialogs";

async function expenseMutationWithOverrides(run, payload = {}) {
  let next = { ...payload };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run(next);
    } catch (e) {
      if (e.code === "PROJECT_BUDGET_EXCEEDED" && e.override_allowed && !next.budget_override_reason) {
        const reason = await requestText({title:"Project budget override",message:e.message,label:"Reason for exceeding the project budget",submitLabel:"Use override",required:true,minLength:3,multiline:true,trim:true});
        if (!reason) throw e;
        next = { ...next, budget_override_reason: reason.trim() };
        continue;
      }
      if (e.code === "INSUFFICIENT_FUND" && e.override_allowed && !next.override_fund_limit) {
        const reason = await requestText({title:"Fund limit override",message:e.message,label:"Super Admin override reason",submitLabel:"Use override",required:true,minLength:3,multiline:true,trim:true});
        if (!reason) throw e;
        next = { ...next, override_fund_limit: true, override_reason: reason.trim() };
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not save expense");
}

export function ExpenseModal({ onClose, onSaved }) {
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ description: "", category_id: "", project_id: "", amount: "" });

  useEffect(() => {
    api.expenses.categories().then(setCategories).catch(() => {});
    api.projects.list({ status: "active" }).then(setProjects).catch(() => {});
  }, []);

  const save = async () => {
    if (!form.description.trim()) return;
    setError("");
    try {
      await expenseMutationWithOverrides((data) => api.expenses.create(data), {
        description: form.description,
        category_id: form.category_id || null,
        project_id: form.project_id || null,
        amount: Number(form.amount) || 0,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal onClose={onClose} title="Log expense">
      {error && <div className="sans" style={{ fontSize: 11, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
      <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Category</div>
      <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
        <option value="">Select category</option>
        {categories.filter((c) => Number(c.active) !== 0).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
      <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
        <option value="">None / General expense</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} · {p.name}{p.budget == null ? " · Open cost" : ` · MVR ${fmt(p.remaining_budget)} left`}</option>)}
      </select>
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <PrimaryButton onClick={save}>Save expense</PrimaryButton>
    </Modal>
  );
}

export function DonationModal({ onClose, onSaved, row = null }) {
  const [form, setForm] = useState({
    donor_name: row?.donor_name || "",
    amount: row?.amount ?? "",
    note: row?.note || "",
    project_id: row?.project_id || "",
    donation_date: row?.donation_date || String(row?.created_at || "").slice(0, 10) || todayValue(),
  });
  const [projects, setProjects] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentType, setDocumentType] = useState("Payment Slip");
  const [uploadStatus, setUploadStatus] = useState(null);
  const savedRecordIdRef = useRef(row?.id || null);
  const failedUploadIndexRef = useRef(0);
  const [recordCommitted, setRecordCommitted] = useState(Boolean(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createRequestIdRef = useRef(row ? null : (globalThis.crypto?.randomUUID?.() || `donation-${Date.now()}-${Math.random().toString(36).slice(2)}`));

  useEffect(() => {
    Promise.all([api.projects.list({ status: "active" }), api.projects.list({ status: "planned" })])
      .then(async ([active, planned]) => {
        const next = [...active, ...planned];
        if (row?.project_id && !next.some((p) => Number(p.id) === Number(row.project_id))) {
          try { next.push(await api.projects.get(row.project_id)); } catch {}
        }
        setProjects(next);
      })
      .catch(() => {});
  }, [row?.project_id]);

  const uploadPendingDocuments = async (donationId, startIndex = 0) => {
    if (!documents.length) return true;
    for (let index = startIndex; index < documents.length; index += 1) {
      const file = documents[index];
      try {
        setUploadStatus({ phase: "uploading", name: file.name || "Document", current: index + 1, total: documents.length });
        await api.donations.uploadDocument(donationId, file, documentType);
        failedUploadIndexRef.current = index + 1;
      } catch (uploadError) {
        failedUploadIndexRef.current = index;
        setUploadStatus({ phase: "error", name: file.name || "Document", current: index + 1, total: documents.length, error: uploadError.message || "Upload failed" });
        setError(`Donation saved, but ${documents.length - index} document${documents.length - index === 1 ? "" : "s"} still need uploading. Retry below; the donation will not be created again.`);
        return false;
      }
    }
    setUploadStatus({ phase: "processing", name: documents[documents.length - 1]?.name || "Document", current: documents.length, total: documents.length });
    setUploadStatus({ phase: "success", name: documents.length === 1 ? documents[0].name : `${documents.length} documents`, current: documents.length, total: documents.length });
    return true;
  };

  const finishSavedFlow = async () => {
    setError("");
    await onSaved?.(row ? "Donation updated" : documents.length ? `Donation logged · ${documents.length} document${documents.length === 1 ? "" : "s"} saved` : "Donation logged");
    onClose();
  };

  const retryUploads = async () => {
    const donationId = savedRecordIdRef.current;
    if (!donationId || busy) return;
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadPendingDocuments(donationId, failedUploadIndexRef.current);
      if (uploaded) await finishSavedFlow();
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form.donor_name.trim() || Number(form.amount) <= 0 || !form.donation_date) return setError("Donor name, amount and donation date are required.");
    if (!row && savedRecordIdRef.current) return retryUploads();
    setBusy(true);
    setError("");
    try {
      const payload = {
        donor_name: form.donor_name.trim(),
        amount: Number(form.amount),
        note: form.note || null,
        project_id: form.project_id || null,
        donation_date: form.donation_date,
        ...(!row && createRequestIdRef.current ? { idempotency_key: createRequestIdRef.current } : {}),
      };
      const result = row ? await api.donations.update(row.id, payload) : await api.donations.create(payload);
      const donationId = row?.id || result?.id;
      if (!donationId) throw new Error("Donation was saved but its record ID was not returned.");
      savedRecordIdRef.current = donationId;
      setRecordCommitted(true);
      failedUploadIndexRef.current = 0;
      const uploaded = !row ? await uploadPendingDocuments(donationId, 0) : true;
      if (!uploaded) return;
      await finishSavedFlow();
    } catch (e) {
      setError(e.message || "Could not save donation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={busy} title={row ? `Edit ${row.txn_id || "donation"}` : "Log donation"}>
      <MessageBanner tone="error">{error}</MessageBanner>
      <Field label="Donor name" value={form.donor_name} disabled={!row && recordCommitted} onChange={(v) => setForm({ ...form, donor_name: v })} />
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} disabled={!row && recordCommitted} onChange={(v) => setForm({ ...form, amount: v })} />
      <Field label="Donation date" type="date" value={form.donation_date} disabled={!row && recordCommitted} onChange={(v) => setForm({ ...form, donation_date: v })} />
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
      <select disabled={!row && recordCommitted} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)", color: "var(--text)" }}>
        <option value="">None / General donation</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} · {p.name}{!["planned","active"].includes(p.status) ? ` · ${p.status}` : ""}</option>)}
      </select>
      <Field label="Note (optional)" value={form.note} disabled={!row && recordCommitted} onChange={(v) => setForm({ ...form, note: v })} />
      {!row && <div className="sans" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Supporting documents (optional)</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 7 }}>
          <select disabled={busy || recordCommitted} value={documentType} onChange={(e) => setDocumentType(e.target.value)} style={{ border: "1px solid var(--border-strong)", borderRadius: 9, padding: "8px 9px", background: "var(--card)", color: "var(--text)" }}>{["Payment Slip","Receipt","Donor Letter","Agreement","Other"].map((type) => <option key={type}>{type}</option>)}</select>
          <label className="sans" style={{ border: "1px solid var(--border-strong)", borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Choose files<input disabled={busy || recordCommitted} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { const next = Array.from(e.target.files || []).slice(0, 10); setDocuments(next); failedUploadIndexRef.current = 0; setUploadStatus(next.length ? { phase: "pending", name: next.length === 1 ? next[0].name : `${next.length} documents`, current: 0, total: next.length } : null); }} /></label>
        </div>
        {documents.length > 0 && <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 6 }}>{documents.length} document{documents.length === 1 ? "" : "s"} selected</div>}
        <DocumentUploadStatus status={uploadStatus} onRetry={uploadStatus?.phase === "error" ? retryUploads : undefined} />
      </div>}
      {row && <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginBottom: 12 }}>Supporting documents are managed from Donation Details. Financial edits are blocked automatically when the donation month is closed.</div>}
      <PrimaryButton onClick={busy ? undefined : save}>{busy ? (savedRecordIdRef.current && documents.length ? "Uploading documents…" : "Saving donation…") : row ? "Save changes" : savedRecordIdRef.current && uploadStatus?.phase === "error" ? "Retry document upload" : "Save donation"}</PrimaryButton>
    </Modal>
  );
}

