import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Modal, Field } from "../../components/FormControls";
import { MessageBanner, PrimaryButton } from "../../components/Shared";
import { fmt } from "../../utils/format";
import { todayValue } from "../../utils/date";

async function expenseMutationWithOverrides(run, payload = {}) {
  let next = { ...payload };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run(next);
    } catch (e) {
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

  const save = async () => {
    if (!form.donor_name.trim() || Number(form.amount) <= 0 || !form.donation_date) return setError("Donor name, amount and donation date are required.");
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
      if (!row && documents.length && donationId) {
        try {
          for (const file of documents) await api.donations.uploadDocument(donationId, file, documentType);
        } catch (uploadError) {
          setError(`Donation saved, but a document could not be saved to Telegram: ${uploadError.message || "Upload failed"}. Open the donation and retry.`);
          return;
        }
      }
      await onSaved?.(row ? "Donation updated" : documents.length ? `Donation logged · ${documents.length} document${documents.length === 1 ? "" : "s"} saved` : "Donation logged");
      onClose();
    } catch (e) {
      setError(e.message || "Could not save donation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={busy} title={row ? `Edit ${row.txn_id || "donation"}` : "Log donation"}>
      <MessageBanner tone="error">{error}</MessageBanner>
      <Field label="Donor name" value={form.donor_name} onChange={(v) => setForm({ ...form, donor_name: v })} />
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <Field label="Donation date" type="date" value={form.donation_date} onChange={(v) => setForm({ ...form, donation_date: v })} />
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
      <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)", color: "var(--text)" }}>
        <option value="">None / General donation</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} · {p.name}{!["planned","active"].includes(p.status) ? ` · ${p.status}` : ""}</option>)}
      </select>
      <Field label="Note (optional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      {!row && <div className="sans" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Supporting documents (optional)</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 7 }}>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} style={{ border: "1px solid var(--border-strong)", borderRadius: 9, padding: "8px 9px", background: "var(--card)", color: "var(--text)" }}>{["Payment Slip","Receipt","Donor Letter","Agreement","Other"].map((type) => <option key={type}>{type}</option>)}</select>
          <label className="sans" style={{ border: "1px solid var(--border-strong)", borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Choose files<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { setDocuments(Array.from(e.target.files || []).slice(0, 10)); }} /></label>
        </div>
        {documents.length > 0 && <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 6 }}>{documents.length} document{documents.length === 1 ? "" : "s"} selected</div>}
      </div>}
      {row && <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginBottom: 12 }}>Supporting documents are managed from Donation Details. Financial edits are blocked automatically when the donation month is closed.</div>}
      <PrimaryButton onClick={busy ? undefined : save}>{busy ? "Saving…" : row ? "Save changes" : "Save donation"}</PrimaryButton>
    </Modal>
  );
}

