import React, { useEffect, useState } from "react";
import {
  Users, Receipt, ArrowUpRight, ArrowDownRight, Check, Clock, Plus, X,
  Download, ShieldCheck, Bell, ChevronLeft, AlertTriangle, Eye, Pencil, Trash2,
} from "lucide-react";
import { api } from "./api";

const fmt = (n) => Number(n || 0).toLocaleString();

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    api.me()
      .then(setMe)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><Center>Loading…</Center></Shell>;
  if (error) return <Shell><Center>Couldn't connect: {error}</Center></Shell>;

  const isAdmin = !!me?.admin;
  const tabs = isAdmin
    ? ["overview", "members", "activity", "reports", "settings"]
    : ["overview", "members", "history", "fund", "activity"];

  return (
    <Shell isAdmin={isAdmin} me={me}>
      <div className="sans" style={{ display: "flex", gap: 18, padding: "0 20px", marginTop: 18, overflowX: "auto" }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: tab === t ? "#1F3D2B" : "#7A8078",
              fontSize: 14, fontWeight: tab === t ? 600 : 500, paddingBottom: 6, whiteSpace: "nowrap",
              borderBottom: tab === t ? "2px solid #C98A4B" : "2px solid transparent",
              textTransform: "capitalize",
            }}>{t}</button>
        ))}
      </div>
      <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
        {tab === "overview" && <Overview isAdmin={isAdmin} setTab={setTab} />}
        {tab === "members" && <Members isAdmin={isAdmin} />}
        {tab === "history" && !isAdmin && <MyHistory telegramId={me?.user?.id} />}
        {tab === "fund" && !isAdmin && <FundView />}
        {tab === "activity" && <Activity isAdmin={isAdmin} />}
        {tab === "reports" && isAdmin && <Reports />}
        {tab === "settings" && isAdmin && <Settings admin={me.admin} />}
      </div>
    </Shell>
  );
}

function Shell({ children, isAdmin, me }) {
  return (
    <div style={{ fontFamily: "'Fraunces','Georgia',serif", background: "#F7F5EF", minHeight: "100vh", color: "#1F2A22" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap');
        .sans { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="sans" style={{ background: "#17212B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronLeft size={18} />
          <span style={{ fontWeight: 600 }}>Fund Bot</span>
        </div>
        {me && <div style={{ opacity: 0.75, fontSize: 12 }}>{isAdmin ? "Admin" : "Member"}</div>}
      </div>
      <div style={{ background: "#1F3D2B", padding: "24px 24px 6px", color: "#F7F5EF" }}>
        <div className="sans" style={{ fontSize: 12, letterSpacing: 2, opacity: 0.65, textTransform: "uppercase" }}>Fund</div>
        <div style={{ fontSize: 28, fontWeight: 600, marginTop: 2 }}>Ledger</div>
      </div>
      {children}
    </div>
  );
}

function Center({ children }) {
  return <div style={{ padding: 60, textAlign: "center", fontFamily: "'Inter',sans-serif", color: "#6B7268" }}>{children}</div>;
}

/* ---------- Overview ---------- */
function Overview({ isAdmin, setTab }) {
  const [summary, setSummary] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api.reports.summary().then(setSummary).catch(() => {});
    api.reports.activity().then((a) => setActivity(a.slice(0, 5))).catch(() => {});
  }, []);

  if (!summary) return <Center>Loading overview…</Center>;

  return (
    <>
      <div style={{ background: "#1F3D2B", borderRadius: 16, padding: "26px 22px", color: "#F7F5EF" }}>
        <div className="sans" style={{ fontSize: 12, opacity: 0.6, letterSpacing: 1 }}>TOTAL FUND BALANCE</div>
        <div style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>MVR {fmt(summary.fundBalance)}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
        <StatCard icon={<ArrowUpRight size={16} color="#3A6B3E" />} label="Income (mo.)" value={fmt(summary.memberIncome + summary.donationIncome)} />
        <StatCard icon={<ArrowDownRight size={16} color="#A6432F" />} label="Expenses (mo.)" value={fmt(summary.expenses)} />
      </div>

      {isAdmin && summary.outstanding.total > 0 && (
        <div onClick={() => setTab("members")}
          style={{ background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: 14, marginTop: 14, cursor: "pointer" }}>
          <div className="sans" style={{ fontSize: 13, color: "#A6432F", fontWeight: 600 }}>
            Outstanding dues: MVR {fmt(summary.outstanding.total)} · {summary.outstanding.members.length} members
          </div>
        </div>
      )}

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginTop: 22, marginBottom: 8, fontWeight: 600 }}>RECENT ACTIVITY</div>
      {activity.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
      {activity.length === 0 && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>No activity yet.</div>}
    </>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #E9E4D8" }}>
      {icon}
      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ActivityRow({ a, isAdmin }) {
  const isIn = a.kind === "contribution" || a.kind === "donation";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: isIn ? "#DDECD9" : "#F2D6D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isIn ? <ArrowUpRight size={16} color="#3A6B3E" /> : <ArrowDownRight size={16} color="#A6432F" />}
        </div>
        <div>
          <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{a.who}</div>
          <div className="sans" style={{ fontSize: 12, color: "#8A9086" }}>
            {a.kind === "contribution" ? `Contribution — ${a.month}` : a.kind === "donation" ? "Donation" : "Expense"}
          </div>
          {a.txn_id && <div className="sans" style={{ fontSize: 11, color: "#B5AE9C", marginTop: 1 }}>{a.txn_id}{a.ref ? ` · Bank ref: ${a.ref}` : ""}</div>}
          {isAdmin && a.by_name && (
            <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 1 }}>
              {a.kind === "contribution" ? "Approved by " : "Logged by "}{a.by_name}
            </div>
          )}
        </div>
      </div>
      <div className="sans" style={{ fontSize: 14, fontWeight: 600, color: isIn ? "#3A6B3E" : "#A6432F" }}>
        {isIn ? "+" : "−"}{fmt(a.amount)}
      </div>
    </div>
  );
}

/* ---------- Members (admin) ---------- */
function Members({ isAdmin }) {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: 250 });

  const load = () => api.members.list().then(setMembers).catch(() => {});
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <Center>Member directory is admin-only in this view.</Center>;

  const addMember = async () => {
    if (!form.name.trim()) return;
    await api.members.create(form);
    setForm({ name: "", phone: "", monthly_amount: 250 });
    setShowAdd(false);
    load();
  };

  const filtered = members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <button onClick={() => setShowAdd(true)} className="sans"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
        <Plus size={16} /> Add member
      </button>
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, background: "#EAF1EE", color: "#1F3D2B", fontSize: 12, borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
        Payments are submitted by members via Telegram — approve slips there.
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="sans"
        style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

      {filtered.map((m) => (
        <div key={m.id} onClick={() => setSelected(m)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: m.active ? "#fff" : "#F1EFE7", opacity: m.active ? 1 : 0.65, border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8, cursor: "pointer" }}>
          <div>
            <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 11, color: "#B5AE9C", fontWeight: 500 }}>{m.member_code}</span> {!m.active && <span style={{ fontSize: 10, color: "#8A9086" }}>(inactive)</span>}</div>
            <div className="sans" style={{ fontSize: 12, color: "#8A9086" }}>{m.phone || "no phone"} · MVR {m.monthly_amount}/mo · Since {m.joined_at}</div>
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>No members yet.</div>}

      {selected && <MemberPopup member={selected} onClose={() => setSelected(null)} onChanged={load} />}

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="Add member">
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount (MVR)" type="number" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: Number(v) })} />
          <PrimaryButton onClick={addMember}>Add member</PrimaryButton>
        </Modal>
      )}
    </>
  );
}

function MemberPopup({ member, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: member.name, phone: member.phone, monthly_amount: member.monthly_amount });

  useEffect(() => { api.members.get(member.id).then(setDetail).catch(() => {}); }, [member.id]);

  const save = async () => {
    await api.members.update(member.id, form);
    setEditing(false);
    onChanged();
    onClose();
  };

  const toggleActive = async () => {
    await api.members.update(member.id, { active: member.active ? 0 : 1 });
    onChanged();
    onClose();
  };

  return (
    <Modal onClose={onClose} title={member.name} action={<button onClick={() => setEditing(true)} style={{ background: "none", border: "none", cursor: "pointer" }}><Pencil size={17} color="#8A9086" /></button>}>
      {editing ? (
        <>
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: Number(v) })} />
          <PrimaryButton onClick={save}>Save changes</PrimaryButton>
        </>
      ) : (
        <>
          <div className="sans" style={{ fontSize: 13, color: "#8A9086", marginBottom: 16 }}>{member.member_code} · {member.phone || "no phone"} · MVR {member.monthly_amount}/mo</div>
          <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>CONTRIBUTION HISTORY</div>
          {(detail?.contributions || []).map((h) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "12px 16px", marginBottom: 8 }}>
              <div>
                <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{h.month}</div>
                <div className="sans" style={{ fontSize: 11, color: "#B5AE9C" }}>{h.txn_id} · Bank ref: {h.ref_number || "—"} · {h.status}</div>
              </div>
              <div className="sans" style={{ fontSize: 14, fontWeight: 600 }}>MVR {h.amount}</div>
            </div>
          ))}
          {(!detail || detail.contributions?.length === 0) && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>No contributions recorded yet.</div>}
          <button onClick={toggleActive} className="sans"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "none", color: member.active ? "#A6432F" : "#3A6B3E", border: "1px solid " + (member.active ? "#F2D6D0" : "#DDECD9"), borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 12 }}>
            {member.active ? "Deactivate member" : "Reactivate member"}
          </button>
        </>
      )}
    </Modal>
  );
}

/* ---------- Member-only views ---------- */
function MyHistory({ telegramId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.reports.activity()
      .then((a) => setRows(a.filter((x) => x.kind === "contribution")))
      .catch(() => setRows([]));
  }, []);
  if (rows === null) return <Center>Loading…</Center>;
  return (
    <>
      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>YOUR CONTRIBUTIONS</div>
      {rows.map((h) => (
        <div key={h.id} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8 }}>
          <div>
            <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{h.month}</div>
            <div className="sans" style={{ fontSize: 11, color: "#B5AE9C" }}>{h.txn_id} · Bank ref: {h.ref || "—"}</div>
          </div>
          <div className="sans" style={{ fontSize: 14, fontWeight: 600 }}>MVR {fmt(h.amount)}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>No contributions yet — send a slip photo to the bot to get started.</div>}
    </>
  );
}

function FundView() {
  const [summary, setSummary] = useState(null);
  useEffect(() => { api.reports.summary().then(setSummary).catch(() => {}); }, []);
  if (!summary) return <Center>Loading…</Center>;
  return (
    <>
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, background: "#EAF1EE", color: "#1F3D2B", fontSize: 12, borderRadius: 10, padding: "9px 12px", marginBottom: 14 }}>
        <Eye size={13} /> Read-only — shared with all members for transparency
      </div>
      <div style={{ background: "#1F3D2B", borderRadius: 16, padding: 22, color: "#F7F5EF", marginBottom: 14 }}>
        <div className="sans" style={{ fontSize: 12, opacity: 0.6, letterSpacing: 1 }}>TOTAL FUND BALANCE</div>
        <div style={{ fontSize: 34, fontWeight: 600, marginTop: 4 }}>MVR {fmt(summary.fundBalance)}</div>
      </div>
      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>SPENDING BY CATEGORY</div>
      {(summary.byCategory || []).map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8 }}>
          <span className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{c.category}</span>
          <span className="sans" style={{ fontSize: 14, fontWeight: 600, color: "#A6432F" }}>MVR {fmt(c.spent)}</span>
        </div>
      ))}
    </>
  );
}

/* ---------- Activity ---------- */
function Activity({ isAdmin }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => { api.reports.activity().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return <Center>Loading…</Center>;

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "in") return r.kind === "contribution" || r.kind === "donation";
    return r.kind === "expense";
  });

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["all", "in", "out"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className="sans"
            style={{ background: filter === f ? "#1F3D2B" : "#fff", color: filter === f ? "#F7F5EF" : "#6B7268", border: "1px solid " + (filter === f ? "#1F3D2B" : "#E9E4D8"), borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {f === "all" ? "All" : f === "in" ? "Income" : "Expenses"}
          </button>
        ))}
      </div>
      {filtered.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
      {filtered.length === 0 && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>Nothing here yet.</div>}
    </>
  );
}

/* ---------- Reports (admin) ---------- */
function Reports() {
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [showExpense, setShowExpense] = useState(false);
  const [showDonation, setShowDonation] = useState(false);

  const load = () => api.reports.summary().then(setSummary).catch(() => {});
  useEffect(() => {
    load();
    api.reports.trend().then(setTrend).catch(() => {});
  }, []);

  if (!summary) return <Center>Loading reports…</Center>;
  const maxVal = Math.max(1, ...trend.map((t) => Math.max(t.income, t.expense)));

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setShowDonation(true)} className="sans" style={smallBtn("#3A6B3E")}><Plus size={13} /> Log donation</button>
        <button onClick={() => setShowExpense(true)} className="sans" style={smallBtn("#A6432F")}><Plus size={13} /> Log expense</button>
      </div>

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>THIS MONTH</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <Row label="Member income" value={`+${fmt(summary.memberIncome)}`} color="#3A6B3E" />
        <Row label="Donations" value={`+${fmt(summary.donationIncome)}`} color="#3A6B3E" />
        <Row label="Expenses" value={`−${fmt(summary.expenses)}`} color="#A6432F" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, paddingTop: 8, borderTop: "1px solid #E9E4D8" }}>
          <span className="sans" style={{ fontWeight: 600 }}>Net</span>
          <span style={{ fontWeight: 700 }}>{fmt(summary.net)}</span>
        </div>
      </div>

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>INCOME VS EXPENSES — 6 MONTHS</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
          {trend.map((d, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", height: 80 }}>
                <div style={{ flex: 1, height: `${(d.income / maxVal) * 100}%`, background: "#3A6B3E", borderRadius: "3px 3px 0 0" }} />
                <div style={{ flex: 1, height: `${(d.expense / maxVal) * 100}%`, background: "#A6432F", borderRadius: "3px 3px 0 0" }} />
              </div>
              <div className="sans" style={{ fontSize: 10, color: "#8A9086" }}>{d.month.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>

      {summary.outstanding.total > 0 && (
        <div style={{ background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span className="sans" style={{ fontSize: 13, color: "#A6432F", fontWeight: 600 }}>Outstanding dues</span>
          <span style={{ fontWeight: 700, color: "#A6432F" }}>MVR {fmt(summary.outstanding.total)} · {summary.outstanding.members.length} members</span>
        </div>
      )}

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>SPENDING BY CATEGORY</div>
      {summary.byCategory.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8 }}>
          <span className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{c.category}</span>
          <span className="sans" style={{ fontSize: 14, fontWeight: 600, color: "#A6432F" }}>MVR {fmt(c.spent)}</span>
        </div>
      ))}

      {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onSaved={load} />}
      {showDonation && <DonationModal onClose={() => setShowDonation(false)} onSaved={load} />}
    </>
  );
}

function smallBtn(color) {
  return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "#fff", border: "1px solid #E9E4D8", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 600, color, cursor: "pointer" };
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
      <span className="sans" style={{ color: "#6B7268" }}>{label}</span>
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
      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 4 }}>Category</div>
      <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="sans"
        style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, background: "#fff" }}>
        <option value="">Select category</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Field label="Amount (MVR)" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
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
      <Field label="Amount (MVR)" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
      <Field label="Note (optional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
      <PrimaryButton onClick={save}>Save donation</PrimaryButton>
    </Modal>
  );
}

/* ---------- Settings (admin) ---------- */
function Settings({ admin }) {
  const [settings, setSettings] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    api.settings.get().then(setSettings).catch(() => {});
    api.settings.admins().then(setAdmins).catch(() => {});
    if (admin?.role === "owner") api.settings.auditLog().then(setAudit).catch(() => {});
  }, [admin]);

  if (!settings) return <Center>Loading settings…</Center>;

  const updateReminderDay = async (value) => {
    await api.settings.update({ reminder_day: value });
    setSettings({ ...settings, reminder_day: value });
  };

  return (
    <>
      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>REMINDER SCHEDULE</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <select value={settings.reminder_day} onChange={(e) => updateReminderDay(e.target.value)} className="sans"
          style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 8, padding: "9px 11px", fontSize: 14, background: "#F7F5EF" }}>
          {["1", "5", "10", "15", "off"].map((d) => <option key={d} value={d}>{d === "off" ? "Off — manual only" : `Day ${d}`}</option>)}
        </select>
      </div>

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>ADMINS & ROLES</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 4, marginBottom: 16 }}>
        {admins.map((a) => (
          <div key={a.id} className="sans" style={{ display: "flex", justifyContent: "space-between", padding: "11px 12px", borderBottom: "1px solid #F0EDE3", fontSize: 13 }}>
            {a.name}
            <span style={{ background: a.role === "owner" ? "#EAF1EE" : "#F4E7C9", color: a.role === "owner" ? "#1F3D2B" : "#8A6A1E", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 12 }}>{a.role}</span>
          </div>
        ))}
      </div>

      {admin?.role === "owner" && (
        <>
          <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>AUDIT LOG (owner only)</div>
          <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 4 }}>
            {(audit || []).map((a) => (
              <div key={a.id} className="sans" style={{ padding: "11px 12px", borderBottom: "1px solid #F0EDE3" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{a.action}</span>
                  <span style={{ color: "#B5AE9C", fontSize: 11 }}>{a.created_at}</span>
                </div>
                <div style={{ fontSize: 12, color: "#8A9086", marginTop: 2 }}>{a.detail} · by {a.admin_name || "system"}</div>
              </div>
            ))}
            {(!audit || audit.length === 0) && <div className="sans" style={{ fontSize: 13, color: "#8A9086", padding: 12 }}>No entries yet.</div>}
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Shared UI bits ---------- */
function Modal({ title, onClose, action, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,34,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#F7F5EF", borderRadius: "18px 18px 0 0", padding: 22, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {action}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <>
      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 4 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} className="sans"
        style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
    </>
  );
}

function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="sans"
      style={{ width: "100%", background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {children}
    </button>
  );
}
