import React, { useEffect, useState } from "react";
import { Plus, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, PrimaryButton, smallBtn, monthNavBtn } from "../components/Shared";
import { currentMonthValue, shiftMonthValue } from "../utils/date";
import { fmt } from "../utils/format";

export default function Reports({ setTab }) {
  const nowMonth = currentMonthValue();
  const [month, setMonth] = useState(nowMonth);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [showExpense, setShowExpense] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => api.reports.summary(month).then(setSummary).catch(() => {});
  useEffect(() => {
    setSummary(null);
    Promise.all([
      api.reports.summary(month).then(setSummary),
      api.reports.trend(month).then(setTrend),
    ]).catch(() => {});
  }, [month]);

  const shiftMonth = (delta) => {
    setMonth(shiftMonthValue(month, delta));
  };

  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));

  if (!summary) return <Center>Loading reports…</Center>;

  const maxVal = Math.max(1, ...trend.map((t) => Math.max(Number(t.income || 0), Number(t.expense || 0))));
  const members = summary.outstanding?.members || [];
  const allocatedContributions = Number(summary.allocatedContributions ?? summary.memberIncome ?? 0);
  const advanceAllocated = Number(summary.advanceAllocated || 0);
  const currentMonthAllocated = Math.max(0, allocatedContributions - advanceAllocated);
  const totalRequired = allocatedContributions + Number(summary.outstanding?.total || 0);
  const collectionPct = totalRequired > 0 ? Math.min(100, Math.round((allocatedContributions / totalRequired) * 100)) : 0;
  const activeCategories = (summary.byCategory || []).filter((c) => Number(c.spent || 0) > 0);

  const exportCsv = async () => {
    const rows = [
      ["Fund report", monthLabel],
      ["Contribution cash received", summary.memberIncome],
      ["Allocated to contribution month", allocatedContributions],
      ["Paid in advance", advanceAllocated],
      ["Donations", summary.donationIncome],
      ["Expenses", summary.expenses],
      ["Net change", summary.net],
      ["Closing balance", summary.fundBalance],
      ["Outstanding dues", summary.outstanding?.total || 0],
      ["Outstanding members", members.length],
      [],
      ["Expense category", "Amount"],
      ...activeCategories.map((c) => [c.category, c.spent]),
    ];
    const csv = rows.map((r) => r.map((v) => {
      const safe = String(v ?? "").replace(/"/g, '""');
      return `"${/^[=+\-@]/.test(safe) ? "'" + safe : safe}"`;
    }).join(",")).join("\n");
    const filename=`fund-report-${month}.csv`;
    await (await import("../utils/exports")).sendExportToTelegram(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename, `${monthLabel} · Fund report CSV`);
  };

  return (
    <>
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", letterSpacing: .4 }}>REPORTS</div>
        <div style={{ display: "flex", gap: 6, position: "relative" }}>
          <button onClick={async()=>{try{const {exportFundPdf}=await import("../utils/exports");await exportFundPdf({month,monthLabel,summary})}catch(e){alert(e.message)}}} style={{ ...smallBtn("var(--primary)"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> PDF</button>
          <button onClick={exportCsv} style={{ ...smallBtn("var(--primary)"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> CSV</button>
          <button onClick={() => setShowAdd(!showAdd)} style={{ ...smallBtn("var(--primary)"), flex: "0 0 auto", padding: "7px 10px" }}><Plus size={13} /> Add</button>
          {showAdd && (
            <div style={{ position: "absolute", right: 0, top: 38, zIndex: 5, width: 160, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 5, boxShadow: "0 8px 24px var(--shadow)" }}>
              <button onClick={() => { setShowDonation(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "var(--success)", cursor: "pointer" }}>+ Log donation</button>
              <button onClick={() => { setShowExpense(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "var(--danger)", cursor: "pointer" }}>+ Log expense</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "38px 1fr 38px", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel}</div>
        <button onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>MONTHLY SUMMARY</div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <Row label="Contribution cash received" value={`+ MVR ${fmt(summary.memberIncome)}`} color="var(--success)" />
        <Row label="Donations" value={`+ MVR ${fmt(summary.donationIncome)}`} color="var(--success)" />
        <Row label="Expenses" value={`− MVR ${fmt(summary.expenses)}`} color="var(--danger)" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
          <span className="sans" style={{ fontWeight: 700 }}>Net cash change</span>
          <span style={{ fontWeight: 700, color: Number(summary.net) >= 0 ? "var(--success)" : "var(--danger)" }}>{Number(summary.net) >= 0 ? "+" : "−"} MVR {fmt(Math.abs(Number(summary.net || 0)))}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 9 }}>
          <span className="sans" style={{ color: "var(--muted)" }}>Closing balance</span>
          <span style={{ fontWeight: 700 }}>MVR {fmt(summary.fundBalance)}</span>
        </div>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>CONTRIBUTION COLLECTION</div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}>
          <span><b>MVR {fmt(allocatedContributions)}</b> / MVR {fmt(totalRequired)}</span>
          <strong>{collectionPct}%</strong>
        </div>
        <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ width: `${collectionPct}%`, height: "100%", background: "var(--success)", borderRadius: 99 }} />
        </div>
        <div className="sans" style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid var(--divider)", fontSize: 11 }}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:10, marginBottom: advanceAllocated > 0 ? 6 : 0 }}>
            <span style={{ color:"var(--muted)" }}>Allocated to {monthLabel}</span>
            <b>MVR {fmt(allocatedContributions)}</b>
          </div>
          {advanceAllocated > 0 && <div style={{ display:"flex", justifyContent:"space-between", gap:10, color:"var(--success)" }}>
            <span>↳ Paid in advance</span>
            <b>MVR {fmt(advanceAllocated)}</b>
          </div>}
          {currentMonthAllocated > 0 && advanceAllocated > 0 && <div style={{ display:"flex", justifyContent:"space-between", gap:10, color:"var(--soft)", marginTop:5 }}>
            <span>↳ From cash received this month</span>
            <span>MVR {fmt(currentMonthAllocated)}</span>
          </div>}
        </div>
      </div>
      <div className="sans" style={{fontSize:10,color:"var(--soft)",lineHeight:1.45,margin:"-4px 2px 12px"}}>
        Advance allocations count toward collection only. The cash was already added to the fund when it was originally received, so it is not counted again here.
      </div>

      {(summary.outstanding?.total || 0) > 0 && (
        <button onClick={() => setTab?.("members")} style={{ width: "100%", background: "var(--danger-bg-3)", border: "1px solid var(--danger-border)", borderRadius: 12, padding: "13px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "var(--danger)" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding dues</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>MVR {fmt(summary.outstanding?.total)} · {members.length} members ›</span>
        </button>
      )}

      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>
        <span>CASH INCOME VS EXPENSES — 6 MONTHS</span>
        <span style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 500 }}>
          <span>● Income</span><span style={{ color: "var(--danger)" }}>● Expenses</span>
        </span>
      </div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 12px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 112 }}>
          {trend.map((d, i) => {
            const label = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${d.month}-01T00:00:00Z`));
            return (
              <div key={i} title={`Income MVR ${fmt(d.income)} · Expenses MVR ${fmt(d.expense)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", height: 84 }}>
                  <div style={{ flex: 1, minHeight: Number(d.income) > 0 ? 2 : 0, height: `${(Number(d.income || 0) / maxVal) * 100}%`, background: "var(--success)", borderRadius: "3px 3px 0 0" }} />
                  <div style={{ flex: 1, minHeight: Number(d.expense) > 0 ? 2 : 0, height: `${(Number(d.expense || 0) / maxVal) * 100}%`, background: "var(--danger)", borderRadius: "3px 3px 0 0" }} />
                </div>
                <div className="sans" style={{ fontSize: 10, color: "var(--soft)" }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>EXPENSES BY CATEGORY</div>
      {activeCategories.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", marginBottom: 7 }}>
          <span className="sans" style={{ fontSize: 13, fontWeight: 500 }}>{c.category}</span>
          <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>MVR {fmt(c.spent)}</span>
        </div>
      ))}
      {activeCategories.length === 0 && <div className="sans" style={{ fontSize: 12, color: "var(--soft)", marginBottom: 8 }}>No expenses for this month.</div>}

      {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onSaved={load} />}
      {showDonation && <DonationModal onClose={() => setShowDonation(false)} onSaved={load} />}
    </>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
      <span className="sans" style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function ExpenseModal({ onClose, onSaved }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ description: "", category_id: "", amount: "" });
  useEffect(() => { api.expenses.categories().then(setCategories).catch(() => {}); }, []);

  const save = async () => {
    if (!form.description.trim()) return;
    await api.expenses.create({ description: form.description, category_id: form.category_id || null, amount: Number(form.amount) || 0 });
    onSaved();
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Log expense">
      <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Category</div>
      <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "var(--card)" }}>
        <option value="">Select category</option>
        {categories.filter((c)=>Number(c.active)!==0).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <PrimaryButton onClick={save}>Save expense</PrimaryButton>
    </Modal>
  );
}

function DonationModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ donor_name: "", amount: "", note: "" });
  const save = async () => {
    if (!form.donor_name.trim()) return;
    await api.donations.create({ donor_name: form.donor_name, amount: Number(form.amount) || 0, note: form.note || null });
    onSaved();
    onClose();
  };
  return (
    <Modal onClose={onClose} title="Log donation">
      <Field label="Donor name" value={form.donor_name} onChange={(v) => setForm({ ...form, donor_name: v })} />
      <Field label="Amount" type="number" prefix="MVR" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <Field label="Note (optional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      <PrimaryButton onClick={save}>Save donation</PrimaryButton>
    </Modal>
  );
}


/* ---------- Pending approvals (admin) ---------- */
