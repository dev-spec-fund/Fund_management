import React, { useEffect, useState } from "react";
import {
  Users, Receipt, ArrowUpRight, ArrowDownRight, Check, Clock, Plus, X,
  Download, ShieldCheck, Bell, ChevronLeft, AlertTriangle, Eye, Pencil, Trash2,
} from "lucide-react";
import { api } from "./api";
import { jsPDF } from "jspdf";

const fmt = (n) => Number(n || 0).toLocaleString();
const currentMonthValue = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Maldives", year: "numeric", month: "2-digit" }).format(new Date());

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function exportStatementCsv(member) {
  const st = await api.members.statement(member.id);
  const rows = [["Member ID", st.member.member_code], ["Member", st.member.name], [], ["Month","Status","Paid","Due","Reason"]];
  for (const x of st.monthly_status) rows.push([x.month,x.status,x.paid,x.due,x.reason||""]);
  rows.push([], ["Contribution transaction","Month","Amount","Bank reference","Status","Submitted"]);
  for (const x of st.contributions) rows.push([x.txn_id,x.month,x.amount,x.ref_number||"",x.status,x.submitted_at]);
  rows.push([], ["Donation transaction","Month","Amount","Note","Date"]);
  for (const x of (st.donations || [])) rows.push([x.txn_id,x.transaction_month||"",x.amount,x.note||"",x.created_at]);
  rows.push([], ["Balance date","Transaction","Type","Amount","Running balance"]);
  for (const x of (st.balance_history || [])) rows.push([x.at,x.txn_id,x.kind,x.amount,x.balance]);
  const safeCsv = (v) => { let x=String(v ?? ""); if (/^[=+\-@]/.test(x)) x=`'${x}`; return `"${x.replace(/"/g,'""')}"`; };
  const csv = rows.map(r => r.map(safeCsv).join(",")).join("\n");
  downloadText(`${st.member.member_code}-statement.csv`, csv, "text/csv;charset=utf-8");
}

async function exportStatementPdf(member) {
  const st = await api.members.statement(member.id);
  const doc = new jsPDF(); let y=18;
  doc.setFontSize(16); doc.text("Fund Member Statement", 14, y); y+=9;
  doc.setFontSize(10); doc.text(`${st.member.member_code} — ${st.member.name}`,14,y); y+=6;
  doc.text(`Monthly contribution: MVR ${fmt(st.member.monthly_amount)}`,14,y); y+=10;
  doc.setFontSize(11); doc.text("Monthly status",14,y); y+=6; doc.setFontSize(9);
  for (const x of st.monthly_status) { if(y>280){doc.addPage();y=18;} doc.text(`${x.month}  ${String(x.status).toUpperCase()}  Paid MVR ${fmt(x.paid)}  Due MVR ${fmt(x.due)}`,14,y); y+=5; }
  y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Transactions",14,y); y+=6; doc.setFontSize(9);
  for (const x of st.contributions) { if(y>280){doc.addPage();y=18;} doc.text(`${x.txn_id}  ${x.month}  MVR ${fmt(x.amount)}  ${x.ref_number||"No bank ref"}  ${x.status}`,14,y); y+=5; }
  if ((st.donations || []).length) { y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Donations",14,y); y+=6; doc.setFontSize(9); for(const x of st.donations){if(y>280){doc.addPage();y=18;}doc.text(`${x.txn_id}  ${x.transaction_month||""}  MVR ${fmt(x.amount)}  ${x.note||""}`,14,y);y+=5;} }
  y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Balance history",14,y); y+=6; doc.setFontSize(9); for(const x of (st.balance_history||[])){if(y>280){doc.addPage();y=18;}doc.text(`${String(x.at||"").slice(0,10)}  ${x.txn_id}  ${x.kind}  +MVR ${fmt(x.amount)}  Balance MVR ${fmt(x.balance)}`,14,y);y+=5;}
  doc.save(`${st.member.member_code}-statement.pdf`);
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [mode, setMode] = useState("member");

  useEffect(() => {
    api.me()
      .then((data) => {
        setMe(data);
        setMode(data?.admin ? "admin" : "member");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><Center>Loading…</Center></Shell>;
  if (error) return <Shell><Center>Couldn't connect: {error}</Center></Shell>;

  const isAdmin = !!me?.admin;
  const isMember = !!me?.member;
  const adminView = isAdmin && mode === "admin";
  const memberView = isMember && mode === "member";

  const tabs = adminView
    ? ["overview", "pending", "members", "activity", "reports", "settings"]
    : ["overview", "history", "fund", "activity"];

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setTab("overview");
  };

  return (
    <Shell isAdmin={isAdmin} isMember={isMember} mode={mode} me={me}>
      {isAdmin && isMember && (
        <div style={{ flexShrink: 0, padding: "14px 20px 0", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div className="sans" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#E9E4D8", borderRadius: 12, padding: 3 }}>
            <button onClick={() => changeMode("admin")} style={modeButton(mode === "admin")}>Admin View</button>
            <button onClick={() => changeMode("member")} style={modeButton(mode === "member")}>My Account</button>
          </div>
        </div>
      )}

      {isAdmin && !isMember && (
        <div className="sans" style={{ flexShrink: 0, margin: "14px auto 0", width: "calc(100% - 40px)", maxWidth: 440, boxSizing: "border-box", background: "#FFF6E5", border: "1px solid #EFD9A9", color: "#7A5A18", borderRadius: 10, padding: "9px 12px", fontSize: 12 }}>
          You are an admin but not yet linked to a member account. Send /start to the bot and choose “Register Myself as Member”.
        </div>
      )}

      <div className="sans" style={{ flexShrink: 0, display: "flex", gap: 18, padding: "0 20px", marginTop: 18, overflowX: "auto" }}>
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, width: "100%", maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        {tab === "overview" && <Overview isAdmin={adminView} setTab={setTab} />}
        {tab === "pending" && adminView && <PendingApprovals />}
        {tab === "members" && adminView && <Members isAdmin />}
        {tab === "history" && memberView && <MyHistory member={me.member} />}
        {tab === "fund" && memberView && <FundView />}
        {tab === "activity" && <Activity isAdmin={adminView} />}
        {tab === "reports" && adminView && <Reports />}
        {tab === "settings" && adminView && <Settings admin={me.admin} />}
      </div>
    </Shell>
  );
}

function modeButton(active) {
  return {
    border: "none",
    borderRadius: 9,
    padding: "9px 10px",
    background: active ? "#1F3D2B" : "transparent",
    color: active ? "#F7F5EF" : "#6B7268",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function Shell({ children, isAdmin, isMember, mode, me }) {
  return (
    <div style={{ fontFamily: "'Fraunces','Georgia',serif", background: "#F7F5EF", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", color: "#1F2A22" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap');
        html, body, #root { height: 100%; }
        body { margin: 0; overflow: hidden; }
        .sans { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="sans" style={{ flexShrink: 0, background: "#17212B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronLeft size={18} />
          <span style={{ fontWeight: 600 }}>Fund Bot</span>
        </div>
        {me && <div style={{ opacity: 0.75, fontSize: 12 }}>{isAdmin && isMember ? (mode === "admin" ? "Admin View" : "My Account") : isAdmin ? "Admin" : "Member"}</div>}
      </div>
      <div style={{ flexShrink: 0, background: "#1F3D2B", padding: "24px 24px 6px", color: "#F7F5EF" }}>
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
    const summaryRequest = isAdmin ? api.reports.summary() : api.reports.publicSummary();
    summaryRequest.then(setSummary).catch(() => {});
    api.reports.activity().then((a) => setActivity(a.slice(0, 5))).catch(() => {});
  }, [isAdmin]);

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

      {isAdmin && (summary.outstanding?.total || 0) > 0 && (
        <div onClick={() => setTab("members")}
          style={{ background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: 14, marginTop: 14, cursor: "pointer" }}>
          <div className="sans" style={{ fontSize: 13, color: "#A6432F", fontWeight: 600 }}>
            Outstanding dues: MVR {fmt(summary.outstanding?.total)} · {(summary.outstanding?.members || []).length} members
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
  const [month, setMonth] = useState(currentMonthValue());
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: 250 });

  const load = () => Promise.all([
    api.members.list().then(setMembers),
    api.reports.summary(month).then(setMonthlySummary),
  ]).catch(() => {});
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, month]);

  if (!isAdmin) return <Center>Member directory is admin-only in this view.</Center>;

  const addMember = async () => {
    if (!form.name.trim()) return;
    await api.members.create(form);
    setForm({ name: "", phone: "", monthly_amount: 250 });
    setShowAdd(false);
    load();
  };

  const filtered = members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
  const unpaidByMember = new Map((monthlySummary?.outstanding?.members || []).map((m) => [Number(m.id), m]));
  const activeMembers = members.filter((m) => m.active);
  const unpaidCount = activeMembers.filter((m) => unpaidByMember.has(Number(m.id))).length;
  const paidCount = activeMembers.length - unpaidCount;

  return (
    <>
      <button onClick={() => setShowAdd(true)} className="sans"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
        <Plus size={16} /> Add member
      </button>
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, background: "#EAF1EE", color: "#1F3D2B", fontSize: 12, borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
        Payments are submitted by members via Telegram — approve slips there.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", gap: 10, marginBottom: 12 }}>
        <div>
          <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 4 }}>Subscription month</div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="sans"
            style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "9px 11px", fontSize: 14, boxSizing: "border-box", background: "#fff" }} />
        </div>
        <div className="sans" style={{ textAlign: "right", fontSize: 12, color: "#6B7268", paddingBottom: 9 }}>
          <b style={{ color: "#3A6B3E" }}>{paidCount}</b> paid · <b style={{ color: "#A6432F" }}>{unpaidCount}</b> due
        </div>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="sans"
        style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

      {filtered.map((m) => {
        const monthly = unpaidByMember.get(Number(m.id));
        const status = !m.active ? "inactive" : monthly?.payment_status || "paid";
        const paid = Number(monthly?.paid || (status === "paid" ? m.monthly_amount : 0));
        const due = status === "exempt" || status === "inactive" ? 0 : Math.max(0, Number(m.monthly_amount) - paid);
        return (
          <div key={m.id} onClick={() => setSelected(m)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: m.active ? "#fff" : "#F1EFE7", opacity: m.active ? 1 : 0.65, border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8, cursor: "pointer" }}>
            <div>
              <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{m.name} <span style={{ fontSize: 11, color: "#B5AE9C", fontWeight: 500 }}>{m.member_code}</span> {!m.active && <span style={{ fontSize: 10, color: "#8A9086" }}>(inactive)</span>}</div>
              <div className="sans" style={{ fontSize: 12, color: "#8A9086" }}>{m.phone || "no phone"} · MVR {m.monthly_amount}/mo · Since {m.joined_at}</div>
              {due > 0 && <div className="sans" style={{ fontSize: 11, color: "#A6432F", marginTop: 3 }}>Due for {month}: MVR {fmt(due)}</div>}
            </div>
            <StatusBadge status={status} />
          </div>
        );
      })}
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

function StatusBadge({ status }) {
  const styles = {
    paid: { label: "Paid", color: "#1F3D2B", bg: "#EAF1EE", border: "#CFE0D6" },
    partial: { label: "Partial", color: "#7A5A18", bg: "#FFF6E5", border: "#EFD9A9" },
    unpaid: { label: "Unpaid", color: "#A6432F", bg: "#FDEDE8", border: "#F2D6D0" },
    exempt: { label: "Exempt", color: "#51606A", bg: "#EEF1F3", border: "#D7DEE3" },
    inactive: { label: "Inactive", color: "#6B7268", bg: "#F1EFE7", border: "#DED8CA" },
  };
  const s = styles[status] || styles.unpaid;
  return (
    <div className="sans" style={{ flexShrink: 0, minWidth: 58, textAlign: "center", color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 999, padding: "5px 8px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </div>
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
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
            <button className="sans" onClick={() => exportStatementPdf(member)} style={smallBtn()}>PDF statement</button>
            <button className="sans" onClick={() => exportStatementCsv(member)} style={smallBtn()}>CSV statement</button>
          </div>
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
function MyHistory({ member }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.myContributions()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (rows === null) return <Center>Loading…</Center>;
  return (
    <>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div className="sans" style={{ fontSize: 11, color: "#8A9086", letterSpacing: 1 }}>MY MEMBER ACCOUNT</div>
        <div style={{ fontSize: 24, fontWeight: 600, marginTop: 3 }}>{member?.member_code || "—"}</div>
        <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginTop: 3 }}>{member?.name} · MVR {fmt(member?.monthly_amount)}/month</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
          <button className="sans" onClick={() => exportStatementPdf(member)} style={smallBtn()}>PDF statement</button>
          <button className="sans" onClick={() => exportStatementCsv(member)} style={smallBtn()}>CSV statement</button>
        </div>
      </div>
      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>YOUR CONTRIBUTIONS</div>
      {rows.map((h) => (
        <div key={h.id} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 16px", marginBottom: 8 }}>
          <div>
            <div className="sans" style={{ fontSize: 14, fontWeight: 500 }}>{h.month}</div>
            <div className="sans" style={{ fontSize: 11, color: "#B5AE9C" }}>{h.txn_id} · Bank ref: {h.ref_number || "—"} · {h.status}</div>
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
  useEffect(() => { api.reports.publicSummary().then(setSummary).catch(() => {}); }, []);
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

      {(summary.outstanding?.total || 0) > 0 && (
        <div style={{ background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span className="sans" style={{ fontSize: 13, color: "#A6432F", fontWeight: 600 }}>Outstanding dues</span>
          <span style={{ fontWeight: 700, color: "#A6432F" }}>MVR {fmt(summary.outstanding?.total)} · {(summary.outstanding?.members || []).length} members</span>
        </div>
      )}

      <div className="sans" style={{ fontSize: 13, color: "#6B7268", marginBottom: 8, fontWeight: 600 }}>SPENDING BY CATEGORY</div>
      {(summary.byCategory || []).map((c, i) => (
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


/* ---------- Pending approvals (admin) ---------- */
function PendingApprovals() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const load = () => api.admin.pending().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!data) return <Center>{error || "Loading approvals…"}</Center>;
  const count = (data.registrations?.length || 0) + (data.contributions?.length || 0) + (data.expenses?.length || 0);
  const act = async (fn) => { try { setError(""); await fn(); await load(); } catch (e) { setError(e.message); } };
  return <>
    <div className="sans" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
      <div><div style={{fontWeight:600}}>Pending approvals</div><div style={{fontSize:12,color:"#8A9086"}}>{count} item{count===1?"":"s"} waiting</div></div>
      <button onClick={load} style={compactBtn}>Refresh</button>
    </div>
    {error && <div className="sans" style={{background:"#FDEDE8",color:"#A6432F",padding:10,borderRadius:10,fontSize:12,marginBottom:12}}>{error}</div>}

    <SectionTitle>NEW MEMBERS</SectionTitle>
    {(data.registrations || []).map((r) => <div key={r.id} style={cardStyle}>
      <div className="sans" style={{fontWeight:600,fontSize:14}}>{r.name}</div>
      <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:3}}>Telegram {r.telegram_id}{r.username ? ` · @${r.username}` : ""}</div>
      {(r.possible_matches || []).map((m) => <div key={m.id} className="sans" style={{fontSize:12,background:"#FFF6E5",padding:8,borderRadius:8,marginTop:8}}>Possible existing: <b>{m.member_code}</b> — {m.name}
        <button onClick={() => act(() => api.admin.approveRegistration(r.id, m.id))} style={{...compactBtn,marginLeft:8}}>Link</button></div>)}
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={() => act(() => api.admin.approveRegistration(r.id))} style={approveBtn}>Create & approve</button>
        <button onClick={() => act(() => api.admin.rejectRegistration(r.id, "Rejected by admin"))} style={rejectBtn}>Reject</button>
      </div>
    </div>)}
    {!data.registrations?.length && <EmptyLine>No pending member requests.</EmptyLine>}

    <SectionTitle>CONTRIBUTION SLIPS</SectionTitle>
    {(data.contributions || []).map((c) => <div key={c.id} style={cardStyle}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8}}><div><div className="sans" style={{fontWeight:600,fontSize:14}}>{c.member_name} <span style={{fontSize:11,color:"#8A9086"}}>{c.member_code}</span></div><div className="sans" style={{fontSize:11,color:"#8A9086"}}>{c.txn_id} · {c.month} · Ref {c.ref_number || "not detected"}</div></div><div className="sans" style={{fontWeight:700}}>MVR {fmt(c.amount)}</div></div>
      <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
        <button onClick={() => setEditing({...c})} style={compactBtn}>✏️ Correct OCR</button>
        <button onClick={() => act(() => api.admin.approveContribution(c.id))} style={approveBtn}>Approve</button>
        <button onClick={() => act(() => api.admin.rejectContribution(c.id, "Rejected by admin"))} style={rejectBtn}>Reject</button>
      </div>
    </div>)}
    {!data.contributions?.length && <EmptyLine>No pending contribution slips.</EmptyLine>}

    <SectionTitle>EXPENSE CONFIRMATIONS</SectionTitle>
    {(data.expenses || []).map((e) => <div key={e.id} style={cardStyle}>
      <div style={{display:"flex",justifyContent:"space-between"}}><div><div className="sans" style={{fontWeight:600,fontSize:14}}>{e.description}</div><div className="sans" style={{fontSize:11,color:"#8A9086"}}>{e.txn_id} · by {e.logged_by_name || "admin"}</div></div><div className="sans" style={{fontWeight:700}}>MVR {fmt(e.amount)}</div></div>
      <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={() => act(() => api.expenses.approve(e.id))} style={approveBtn}>Confirm</button><button onClick={() => act(() => api.expenses.reject(e.id))} style={rejectBtn}>Reject</button></div>
    </div>)}
    {!data.expenses?.length && <EmptyLine>No pending expenses.</EmptyLine>}

    {editing && <Modal title={`Correct ${editing.txn_id}`} onClose={() => setEditing(null)}>
      <Field label="Amount (MVR)" type="number" value={editing.amount} onChange={(v)=>setEditing({...editing,amount:Number(v)})}/>
      <Field label="Bank reference" value={editing.ref_number || ""} onChange={(v)=>setEditing({...editing,ref_number:v})}/>
      <Field label="Bank date (YYYY-MM-DD)" value={editing.bank_date || ""} onChange={(v)=>setEditing({...editing,bank_date:v})}/>
      <Field label="Contribution month (YYYY-MM)" value={editing.month || ""} onChange={(v)=>setEditing({...editing,month:v})}/>
      <PrimaryButton onClick={() => act(async()=>{await api.admin.correctContribution(editing.id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});setEditing(null);})}>Save correction</PrimaryButton>
    </Modal>}
  </>;
}

function SectionTitle({children}) { return <div className="sans" style={{fontSize:12,color:"#6B7268",fontWeight:700,letterSpacing:.7,margin:"18px 0 8px"}}>{children}</div>; }
function EmptyLine({children}) { return <div className="sans" style={{fontSize:12,color:"#8A9086",padding:"8px 2px 14px"}}>{children}</div>; }
const cardStyle={background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:14,marginBottom:8};
const compactBtn={background:"#F1EFE7",border:"1px solid #DED8CA",borderRadius:8,padding:"7px 10px",fontSize:12,cursor:"pointer"};
const approveBtn={...compactBtn,background:"#EAF1EE",color:"#1F3D2B",border:"1px solid #CFE0D6",fontWeight:600};
const rejectBtn={...compactBtn,background:"#FDEDE8",color:"#A6432F",border:"1px solid #F2D6D0",fontWeight:600};

/* ---------- Audit presentation ---------- */
const AUDIT_HIDDEN_KEYS = new Set(["ocr_raw","slip_file_id","file_id","telegram_file_id","photo_file_id","raw","ai_response","model_response","prompt"]);
const auditLabel = (s="") => s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const auditValue = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v.length > 90 ? `${v.slice(0,90)}…` : v;
  return null;
};
function cleanAuditObject(v, depth=0) {
  if (!v || typeof v !== "object" || depth > 3) return v;
  if (Array.isArray(v)) return v.slice(0,10).map(x=>cleanAuditObject(x,depth+1));
  return Object.fromEntries(Object.entries(v).filter(([k])=>!AUDIT_HIDDEN_KEYS.has(k.toLowerCase())).map(([k,x])=>[k,cleanAuditObject(x,depth+1)]));
}
function auditSummary(detail) {
  let d=detail;
  if (typeof d === "string") { try { d=JSON.parse(d); } catch { return [{label:"Details",value:d.slice(0,140)}]; } }
  d=cleanAuditObject(d);
  if (!d || typeof d !== "object") return [];
  const after=d.after && typeof d.after==="object" ? d.after : {};
  const before=d.before && typeof d.before==="object" ? d.before : {};
  const preferred=["member_code","txn_id","donor_name","description","amount","month","transaction_month","ref_number","status","role","name","note","reason"];
  const rows=[];
  if (d.entity) rows.push({label:"Record",value:`${auditLabel(String(d.entity))}${d.entity_id!=null?` #${d.entity_id}`:""}`});
  for (const key of preferred) {
    const av=auditValue(after[key]), bv=auditValue(before[key]);
    if (av!=null && bv!=null && av!==bv) rows.push({label:auditLabel(key),value:`${bv} → ${av}`});
    else if (av!=null) rows.push({label:auditLabel(key),value:av});
    if (rows.length>=5) break;
  }
  return rows;
}
function AuditEntry({a}) {
  const rows=auditSummary(a.detail);
  return <div className="sans" style={{padding:"11px 0",borderBottom:"1px solid #F0EDE3"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12}}>
      <b>{auditLabel(a.action)}</b><span style={{color:"#B5AE9C",fontSize:10,whiteSpace:"nowrap"}}>{a.created_at}</span>
    </div>
    {rows.map((r,i)=><div key={`${r.label}-${i}`} style={{fontSize:11,color:"#6B7268",marginTop:3}}><span style={{color:"#9A9384"}}>{r.label}:</span> {r.value}</div>)}
    <div style={{fontSize:10,color:"#B5AE9C",marginTop:4}}>by {a.admin_name || "system"}</div>
  </div>;
}

/* ---------- Settings (admin) ---------- */
function Settings({ admin }) {
  const [settings,setSettings]=useState(null); const [admins,setAdmins]=useState([]); const [audit,setAudit]=useState([]); const [health,setHealth]=useState(null); const [closures,setClosures]=useState([]); const [errors,setErrors]=useState([]); const [message,setMessage]=useState("");
  const role = admin?.role === "owner" ? "super_admin" : admin?.role;
  const superAdmin = role === "super_admin";
  const load=()=>{
    api.settings.get().then(setSettings).catch(()=>{}); api.settings.admins().then(setAdmins).catch(()=>{}); api.settings.auditLog().then(setAudit).catch(()=>{}); api.admin.health().then(setHealth).catch(()=>{}); api.admin.monthClosures().then(setClosures).catch(()=>{}); if(superAdmin) api.admin.errors().then(setErrors).catch(()=>{});
  };
  useEffect(load,[admin]);
  if(!settings)return <Center>Loading settings…</Center>;
  const saveSetting=async(key,value)=>{await api.settings.update({[key]:String(value)});setSettings({...settings,[key]:String(value)});setMessage("Saved");};
  const closeMonth=async()=>{const month=prompt("Month to close (YYYY-MM)",new Date().toISOString().slice(0,7));if(!month)return;try{await api.admin.closeMonth(month,"Closed from Fund App");load()}catch(e){setMessage(e.message)}};
  const backup=async()=>{try{const data=await api.admin.backup();downloadText(`kys-fund-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2),"application/json");}catch(e){setMessage(e.message)}};
  return <>
    {message && <div className="sans" style={{fontSize:12,background:"#EAF1EE",padding:9,borderRadius:9,marginBottom:12}}>{message}</div>}
    <SectionTitle>SYSTEM HEALTH</SectionTitle>
    <div style={cardStyle}>
      {health ? <div className="sans" style={{fontSize:12,lineHeight:1.8}}>
        <div>Database: <b>{health.db?.ok ? "✅ Online" : "❌ Error"}</b></div>
        <div>Telegram bot: <b>{health.telegram?.ok ? `✅ @${health.telegram.username || "connected"}` : "❌ Error"}</b></div>
        <div>Webhook: <b>{health.webhook?.ok && health.webhook?.url ? "✅ Configured" : "⚠️ Check webhook"}</b>{health.webhook?.pending ? ` · ${health.webhook.pending} pending` : ""}</div>
        <div>AI/OCR binding: <b>{health.ai?.ok ? "✅ Available" : "❌ Missing"}</b></div>
        <div>Mini App: {health.mini_app_url || "not set"}</div><div>Reminder: {health.reminder_schedule || "not set"}</div>
        {health.webhook?.last_error && <div style={{color:"#A6432F"}}>Webhook error: {health.webhook.last_error}</div>}
      </div> : <div className="sans" style={{fontSize:12,color:"#8A9086"}}>Checking…</div>}
      <button onClick={()=>api.admin.health().then(setHealth)} style={{...compactBtn,marginTop:8}}>Refresh health</button>
    </div>

    <SectionTitle>CONTRIBUTION & EXPENSE SETTINGS</SectionTitle>
    <div style={cardStyle}>
      <div className="sans" style={{fontSize:12,color:"#6B7268",marginBottom:4}}>Reminder day</div>
      <select value={settings.reminder_day} onChange={e=>saveSetting("reminder_day",e.target.value)} className="sans" style={{width:"100%",border:"1px solid #D9D3C4",borderRadius:8,padding:"9px 11px",fontSize:14,background:"#F7F5EF",marginBottom:12}}>{["1","5","10","15","off"].map(d=><option key={d} value={d}>{d==="off"?"Off — manual only":`Day ${d}`}</option>)}</select>
      <div className="sans" style={{fontSize:12,color:"#6B7268",marginBottom:4}}>Expense second-approval threshold (MVR)</div>
      <input type="number" value={settings.expense_approval_threshold || 5000} onChange={e=>setSettings({...settings,expense_approval_threshold:e.target.value})} onBlur={e=>saveSetting("expense_approval_threshold",e.target.value)} className="sans" style={{width:"100%",boxSizing:"border-box",border:"1px solid #D9D3C4",borderRadius:8,padding:"9px 11px",fontSize:14}} />
    </div>

    <SectionTitle>MONTH CLOSE</SectionTitle>
    <div style={cardStyle}>
      {closures.slice(0,6).map(x=><div key={x.month} className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"6px 0",borderBottom:"1px solid #F0EDE3"}}><span><b>{x.month}</b> · closed by {x.closed_by_name || "admin"}</span>{superAdmin&&<button onClick={()=>api.admin.reopenMonth(x.month).then(load)} style={compactBtn}>Reopen</button>}</div>)}
      {!closures.length&&<div className="sans" style={{fontSize:12,color:"#8A9086"}}>No months closed yet.</div>}
      {superAdmin&&<button onClick={closeMonth} style={{...approveBtn,marginTop:10}}>Close a month</button>}
    </div>

    <SectionTitle>ADMINS & ROLES</SectionTitle>
    <div style={cardStyle}>
      {admins.map(a=><div key={a.id} className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #F0EDE3",fontSize:13}}><span>{a.name}</span>{superAdmin?<select value={a.role==="owner"?"super_admin":a.role} onChange={e=>api.settings.updateAdmin(a.id,{role:e.target.value}).then(load)} style={{border:"1px solid #D9D3C4",borderRadius:8,padding:5}}><option value="super_admin">Super Admin</option><option value="treasurer">Treasurer</option><option value="viewer">Viewer</option></select>:<span>{a.role}</span>}</div>)}
      <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:8}}>Super Admin: full control · Treasurer: financial operations · Viewer: read-only.</div>
    </div>

    {superAdmin&&<><SectionTitle>DATABASE BACKUP</SectionTitle><div style={cardStyle}><div className="sans" style={{fontSize:12,color:"#6B7268",marginBottom:8}}>Download a JSON snapshot before schema or data changes. For a full D1 SQL export, use the included worker backup script.</div><button onClick={backup} style={approveBtn}>Download backup</button></div></>}

    <SectionTitle>AUDIT LOG</SectionTitle>
    <div style={cardStyle}>{audit.slice(0,100).map(a=><AuditEntry key={a.id} a={a}/>)}{!audit.length&&<EmptyLine>No audit entries.</EmptyLine>}</div>

    {superAdmin&&<><SectionTitle>RECENT ERRORS</SectionTitle><div style={cardStyle}>{errors.slice(0,50).map(e=><div key={e.id} className="sans" style={{padding:"7px 0",borderBottom:"1px solid #F0EDE3",fontSize:11}}><b>{e.source}</b> · {e.message}<div style={{color:"#B5AE9C"}}>{e.created_at}</div></div>)}{!errors.length&&<EmptyLine>No logged errors.</EmptyLine>}</div></>}
  </>;
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
