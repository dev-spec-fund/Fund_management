import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { Modal, Field } from "../../components/FormControls";
import { PrimaryButton } from "../../components/Shared";
import { fmt } from "../../utils/format";

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

export function DonationModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ donor_name: "", amount: "", note: "", project_id: "" });
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    Promise.all([api.projects.list({ status: "active" }), api.projects.list({ status: "planned" })])
      .then(([active, planned]) => setProjects([...active, ...planned]))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!form.donor_name.trim()) return;
    await api.donations.create({
      donor_name: form.donor_name,
      amount: Number(form.amount) || 0,
      note: form.note || null,
      project_id: form.project_id || null,
    });
    onSaved();
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Log donation">
      <Field label="Donor name" value={form.donor_name} onChange={(v) => setForm({ ...form, donor_name: v })} />
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Project (optional)</div>
      <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)", color: "var(--text)" }}>
        <option value="">None / General donation</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} · {p.name}</option>)}
      </select>
      <Field label="Note (optional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      <PrimaryButton onClick={save}>Save donation</PrimaryButton>
    </Modal>
  );
}
