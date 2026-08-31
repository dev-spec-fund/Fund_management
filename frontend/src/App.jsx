import React, { useEffect, useState } from "react";
import {
  Users, Receipt, ArrowUpRight, ArrowDownRight, Check, Clock, Plus, X,
  Download, ShieldCheck, Bell, ChevronLeft, ChevronRight, AlertTriangle, Eye, Pencil, Trash2, Search,
} from "lucide-react";
import { api } from "./api";
import { Modal, Field } from "./components/FormControls";
import { currentMonthValue, shiftMonthValue, todayValue } from "./utils/date";
import { exportFundPdf, exportStatementCsv, exportStatementPdf, sendExportToTelegram } from "./utils/exports";

const fmt = (n) => Number(n || 0).toLocaleString();
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
  const canFinance = adminView && ["owner","super_admin","treasurer"].includes(me?.admin?.role);

  const tabs = adminView
    ? (canFinance ? ["overview", "pending", "members", "activity", "reports", "meetings", "settings"] : ["overview", "members", "activity", "reports", "meetings", "settings"])
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
        {tab === "overview" && <Overview isAdmin={adminView} canFinance={canFinance} setTab={setTab} />}
        {tab === "pending" && canFinance && <PendingApprovals />}
        {tab === "members" && adminView && <Members isAdmin admin={me.admin} />}
        {tab === "history" && memberView && <MyHistory member={me.member} />}
        {tab === "fund" && memberView && <FundView />}
        {tab === "activity" && <Activity isAdmin={adminView} canFinance={canFinance} />}
        {tab === "reports" && adminView && <Reports setTab={setTab} />}
        {tab === "meetings" && adminView && <Meetings />}
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
        html, body, #root { height: 100%; width: 100%; max-width: 100%; overflow-x: hidden; }
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; overflow: hidden; overscroll-behavior-x: none; }
        input:focus, textarea:focus, select:focus {
          border-color: #2F5A3D !important;
          background: #F4F8F5 !important;
          box-shadow: 0 0 0 2px rgba(47,90,61,0.10) !important;
          outline: none !important;
        }
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
function Overview({ isAdmin, canFinance, setTab }) {
  const [summary, setSummary] = useState(null);
  const [activity, setActivity] = useState([]);
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    const summaryRequest = isAdmin ? api.reports.summary() : api.reports.publicSummary();
    summaryRequest.then(setSummary).catch(() => {});
    api.reports.activity().then((a) => setActivity(a.slice(0, 4))).catch(() => {});
    if (canFinance) {
      api.admin.pending().then((p) => {
        const count =
          (p?.registrations?.length || 0) +
          (p?.contributions?.length || 0) +
          (p?.expenses?.length || 0);
        setPendingCount(count);
      }).catch(() => setPendingCount(null));
    }
  }, [isAdmin, canFinance]);

  if (!summary) return <Center>Loading overview…</Center>;

  const contributions = Number(summary.memberIncome || 0);
  const allocatedContributions = Number(summary.allocatedContributions ?? summary.memberIncome ?? 0);
  const donations = Number(summary.donationIncome || 0);
  const expenses = Number(summary.expenses || 0);
  const netMonth = contributions + donations - expenses;
  const outstandingTotal = Number(summary.outstanding?.total || 0);
  const outstandingMembers = (summary.outstanding?.members || []).length;
  const expected = allocatedContributions + outstandingTotal;
  const collectionPct = expected > 0 ? Math.min(100, Math.round((allocatedContributions / expected) * 100)) : 0;
  const overviewMonth = summary.month || currentMonthValue();
  const monthLabel = (() => {
    try {
      const [y, m] = overviewMonth.split("-").map(Number);
      return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
    } catch {
      return overviewMonth;
    }
  })();

  return (
    <>
      <div style={{ background: "#1F3D2B", borderRadius: 16, padding: "23px 22px", color: "#F7F5EF" }}>
        <div className="sans" style={{ fontSize: 11, opacity: 0.62, letterSpacing: 1.1 }}>FUND BALANCE</div>
        <div style={{ fontSize: 39, fontWeight: 600, marginTop: 4 }}>MVR {fmt(summary.fundBalance)}</div>
        <div className="sans" style={{ fontSize: 11, opacity: 0.7, marginTop: 5 }}>
          {netMonth >= 0 ? "+" : "−"} MVR {fmt(Math.abs(netMonth))} this month
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <StatCard icon={<ArrowUpRight size={15} color="#3A6B3E" />} label="Contributions" value={`MVR ${fmt(contributions)}`} />
        <StatCard icon={<ArrowDownRight size={15} color="#A6432F" />} label="Expenses this month" value={`MVR ${fmt(expenses)}`} />
      </div>

      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 13, padding: "12px 14px", marginTop: 10 }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "#6B7268" }}>Donations this month</span>
          <strong style={{ color: "#3A6B3E" }}>+ MVR {fmt(donations)}</strong>
        </div>
      </div>

      <div className="sans" style={{ fontSize: 11, color: "#6B7268", marginTop: 18, marginBottom: 7, fontWeight: 700, letterSpacing: .5 }}>MONTHLY COLLECTION · {monthLabel.toUpperCase()}</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 13, padding: "13px 14px" }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12 }}>
          <span><b style={{ color: "#1F3D2B" }}>MVR {fmt(allocatedContributions)}</b> <span style={{ color: "#9A9384" }}>/ MVR {fmt(expected)}</span></span>
          <b style={{ color: "#3A6B3E" }}>{collectionPct}% collected</b>
        </div>
        <div style={{ height: 6, background: "#ECE8DE", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${collectionPct}%`, height: "100%", background: "#3A6B3E", borderRadius: 999 }} />
        </div>
      </div>

      {isAdmin && outstandingTotal > 0 && (
        <button onClick={() => setTab("members")}
          style={{ width: "100%", background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: "12px 14px", marginTop: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#A6432F" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            MVR {fmt(outstandingTotal)} · {outstandingMembers} {outstandingMembers === 1 ? "member" : "members"} ›
          </span>
        </button>
      )}

      {isAdmin && pendingCount !== null && (
        <button onClick={() => setTab("pending")}
          style={{ width: "100%", background: pendingCount > 0 ? "#FFF7E8" : "#EEF4F0", border: `1px solid ${pendingCount > 0 ? "#E8D7A8" : "#D3E3D9"}`, borderRadius: 12, padding: "12px 14px", marginTop: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: pendingCount > 0 ? "#7A5A18" : "#3A6B3E" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Pending approvals</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            {pendingCount > 0 ? `${pendingCount} waiting ›` : "✓ None waiting"}
          </span>
        </button>
      )}

      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#6B7268", fontWeight: 700, letterSpacing: .5 }}>RECENT ACTIVITY</span>
        {activity.length > 0 && <button onClick={() => setTab("activity")} style={{ border: 0, background: "transparent", padding: 0, color: "#3A6B3E", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>View all →</button>}
      </div>
      {activity.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
      {activity.length === 0 && <div className="sans" style={{ fontSize: 12, color: "#8A9086" }}>No activity yet.</div>}
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

function activityDate(a) {
  const d = a?.at ? new Date(String(a.at).replace(" ", "T") + (String(a.at).includes("Z") ? "" : "Z")) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function activityDayLabel(a) {
  const d = activityDate(a);
  if (!d) return "Earlier";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((today - local) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function activityTime(a) {
  const d = activityDate(a);
  return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

function ActivityRow({ a, isAdmin, canFinance = false, onExpenseClick }) {
  const isIn = a.kind === "contribution" || a.kind === "donation";
  const type = a.kind === "contribution" ? "Contribution" : a.kind === "donation" ? "Donation" : "Expense";
  return (
    <div onClick={() => a.kind === "expense" && canFinance && onExpenseClick?.(a)}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "11px 14px", marginBottom: 7, cursor: a.kind === "expense" && canFinance ? "pointer" : "default" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <div style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 10, background: isIn ? "#DDECD9" : "#F2D6D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isIn ? <ArrowUpRight size={16} color="#3A6B3E" /> : <ArrowDownRight size={16} color="#A6432F" />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sans" style={{ fontSize: 14, fontWeight: 600 }}>{a.who}</div>
          <div className="sans" style={{ fontSize: 12, color: "#8A9086", marginTop: 1 }}>
            {type}{a.kind === "contribution" && a.month ? ` · ${a.month}` : ""}{a.kind === "expense" && a.category ? ` · ${a.category}` : ""}
          </div>
          <div className="sans" style={{ fontSize: 11, color: "#AAA493", marginTop: 2 }}>
            {[a.member_code, a.txn_id, activityTime(a)].filter(Boolean).join(" · ")}
          </div>
          {isAdmin && a.by_name && <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 1 }}>{a.kind === "contribution" ? "Approved by " : "Logged by "}{a.by_name}</div>}
        </div>
      </div>
      <div className="sans" style={{ flex: "0 0 auto", marginLeft: 10, fontSize: 14, fontWeight: 700, color: isIn ? "#3A6B3E" : "#A6432F" }}>
        <div>{isIn ? "+" : "−"} MVR {fmt(a.amount)}</div>
        {a.kind === "expense" && canFinance && <div style={{fontSize:10,fontWeight:500,color:"#8A9086",marginTop:3,textAlign:"right"}}><Pencil size={10} style={{verticalAlign:"-1px",marginRight:3}}/>Edit</div>}
      </div>
    </div>
  );
}
/* ---------- Members (admin) ---------- */
function Members({ isAdmin, admin }) {
  const [members, setMembers] = useState([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");
  const [defaultMonthly, setDefaultMonthly] = useState(250);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: "" });

  const load = () => Promise.all([
    api.members.list().then(setMembers),
    api.reports.summary(month).then(setMonthlySummary),
  ]).catch(() => {});
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, month]);
  useEffect(() => { if (isAdmin) api.settings.get().then(s=>{ const v=Number(s.default_monthly_amount)||250; setDefaultMonthly(v); setForm(f=>({...f,monthly_amount:f.monthly_amount===""?String(v):f.monthly_amount})); }).catch(()=>{}); }, [isAdmin]);

  if (!isAdmin) return <Center>Member directory is admin-only in this view.</Center>;
  const financeAdmin = ["owner","super_admin","treasurer"].includes(admin?.role);

  const addMember = async () => {
    if (!form.name.trim()) return;
    const amount=form.monthly_amount===""?defaultMonthly:Number(form.monthly_amount);
    await api.members.create({ ...form, monthly_amount: amount });
    setForm({ name: "", phone: "", monthly_amount: String(defaultMonthly) });
    setShowAdd(false);
    load();
  };

  const outstandingByMember = new Map((monthlySummary?.outstanding?.members || []).map((m) => [Number(m.id), m]));
  const activeMembers = members.filter((m) => m.active);
  const memberStatus = (m) => {
    if (!m.active) return "inactive";
    return outstandingByMember.get(Number(m.id))?.payment_status || "paid";
  };
  const counts = activeMembers.reduce((a, m) => { a[memberStatus(m)] = (a[memberStatus(m)] || 0) + 1; return a; }, { paid: 0, partial: 0, unpaid: 0, exempt: 0 });
  const expected = activeMembers.reduce((sum, m) => sum + Number(m.monthly_amount || 0), 0);
  const dueTotal = Number(monthlySummary?.outstanding?.total || 0);
  const collected = Math.max(0, expected - dueTotal);
  const percent = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
  const filtered = members.filter((m) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || m.name.toLowerCase().includes(q) || String(m.member_code || "").toLowerCase().includes(q) || String(m.phone || "").includes(q);
    const status = memberStatus(m);
    const matchesFilter = filter === "all" || (filter === "outstanding" ? status === "partial" || status === "unpaid" : status === filter);
    return matchesSearch && matchesFilter;
  });

  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  const sendOutstandingReminders = async () => {
    const dueCount = counts.partial + counts.unpaid;
    if (!dueCount) return;
    if (!confirm(`Send Telegram payment reminders to ${dueCount} outstanding ${dueCount === 1 ? "member" : "members"} for ${monthLabel}?`)) return;
    try {
      setReminderBusy(true);
      setReminderMessage("");
      const result = await api.admin.sendPaymentReminders({ month });
      setReminderMessage(`Sent ${result.sent || 0} reminder${Number(result.sent || 0) === 1 ? "" : "s"}${result.unlinked ? ` · ${result.unlinked} not linked to Telegram` : ""}.`);
    } catch (e) {
      setReminderMessage(e.message);
    } finally {
      setReminderBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "#1F3D2B" }}>Members</div>
          <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 2 }}>{activeMembers.length} active members</div>
        </div>
        <button onClick={() => { setForm({name:"",phone:"",monthly_amount:String(defaultMonthly)}); setShowAdd(true); }} className="sans" style={{ display: "flex", alignItems: "center", gap: 5, background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 9, padding: "8px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={15} /> Add
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
          <label className="sans" style={{ position: "relative", fontSize: 14, fontWeight: 700, color: "#1F3D2B", cursor: "pointer" }}>
            {monthLabel}
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" }} />
          </label>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sans" style={{ fontSize: 18, fontWeight: 750, color: "#1F3D2B" }}>MVR {fmt(collected)} <span style={{ fontSize: 12, fontWeight: 500, color: "#8A9086" }}>/ {fmt(expected)}</span></div>
          <div className="sans" style={{ fontSize: 12, fontWeight: 700, color: "#3A6B3E" }}>{percent}% collected</div>
        </div>
        <div style={{ height: 6, background: "#ECE8DE", borderRadius: 999, overflow: "hidden", margin: "8px 0 13px" }}><div style={{ width: `${percent}%`, height: "100%", background: "#3A6B3E", borderRadius: 999 }} /></div>
        <div className="sans" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5, textAlign: "center", fontSize: 10, color: "#6B7268" }}>
          <div><b style={{ display: "block", fontSize: 14, color: "#3A6B3E" }}>{counts.paid}</b>Paid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#7A5A18" }}>{counts.partial}</b>Partial</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#A6432F" }}>{counts.unpaid}</b>Unpaid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#51606A" }}>{counts.exempt}</b>Exempt</div>
        </div>
      </div>

      {financeAdmin && (counts.partial + counts.unpaid) > 0 && (
        <button onClick={sendOutstandingReminders} disabled={reminderBusy}
          className="sans"
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:7, background:"#EAF1EE", color:"#1F3D2B", border:"1px solid #CFE0D6", borderRadius:11, padding:"10px 12px", fontSize:12, fontWeight:700, cursor:reminderBusy?"default":"pointer", opacity:reminderBusy?.7:1, marginBottom:8 }}>
          <Bell size={14} /> {reminderBusy ? "Sending reminders…" : `Remind ${counts.partial + counts.unpaid} outstanding ${counts.partial + counts.unpaid === 1 ? "member" : "members"}`}
        </button>
      )}
      {reminderMessage && <div className="sans" style={{fontSize:10,color:reminderMessage.startsWith("Sent")?"#3A6B3E":"#A6432F",margin:"0 2px 10px"}}>{reminderMessage}</div>}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 3, marginBottom: 10 }}>
        {[['all','All'],['outstanding','Outstanding'],['paid','Paid'],['partial','Partial'],['unpaid','Unpaid'],['exempt','Exempt']].map(([key,label]) => (
          <button key={key} onClick={() => setFilter(key)} className="sans" style={{ flexShrink: 0, border: filter === key ? "1px solid #1F3D2B" : "1px solid #DED8CA", background: filter === key ? "#1F3D2B" : "#fff", color: filter === key ? "#fff" : "#6B7268", borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={16} color="#8A9086" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID or phone…" className="sans" style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px 10px 36px", fontSize: 13, boxSizing: "border-box", background: "#fff" }} />
      </div>

      {filtered.map((m) => {
        const monthly = outstandingByMember.get(Number(m.id));
        const status = memberStatus(m);
        const paid = Number(monthly?.paid ?? (status === "paid" ? m.monthly_amount : 0));
        const due = status === "exempt" || status === "inactive" ? 0 : Math.max(0, Number(m.monthly_amount) - paid);
        const memberPercent = Number(m.monthly_amount) > 0 ? Math.min(100, Math.round((paid / Number(m.monthly_amount)) * 100)) : 0;
        return (
          <div key={m.id} onClick={() => setSelected(m)} style={{ background: m.active ? "#fff" : "#F1EFE7", opacity: m.active ? 1 : 0.65, border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 14px", marginBottom: 8, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sans" style={{ fontSize: 14, fontWeight: 650, color: "#222" }}>{m.name} <span style={{ fontSize: 11, color: "#B5AE9C", fontWeight: 500 }}>{m.member_code}</span></div>
                <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 2 }}>{m.phone ? m.phone : "Phone not added"} · MVR {fmt(m.monthly_amount)}/mo</div>
              </div>
              <StatusBadge status={status} />
            </div>
            {m.active && status !== "exempt" && <>
              <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 10, color: "#6B7268" }}>
                <span>MVR {fmt(paid)} of {fmt(m.monthly_amount)} paid</span>
                <span style={{ color: due > 0 ? "#A6432F" : "#3A6B3E", fontWeight: 650 }}>{due > 0 ? `MVR ${fmt(due)} due` : "Complete"}</span>
              </div>
              <div style={{ height: 4, background: "#ECE8DE", borderRadius: 999, overflow: "hidden", marginTop: 6 }}><div style={{ width: `${memberPercent}%`, height: "100%", background: status === "partial" ? "#B58A3D" : "#3A6B3E" }} /></div>
            </>}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="sans" style={{ textAlign: "center", fontSize: 13, color: "#8A9086", padding: "24px 0" }}>No members match this view.</div>}

      {selected && <MemberPopup member={selected} month={month} canRemind={financeAdmin} onClose={() => setSelected(null)} onChanged={load} />}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="Add member">
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" prefix="MVR" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: v })} />
          <PrimaryButton onClick={addMember}>Add member</PrimaryButton>
        </Modal>
      )}
    </>
  );
}

function monthNavBtn() {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#F7F5EF", color: "#1F3D2B", border: "1px solid #E9E4D8", borderRadius: 9, cursor: "pointer" };
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

function MemberPopup({ member, month, canRemind, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [form, setForm] = useState({ name: member.name, phone: member.phone, monthly_amount: member.monthly_amount });

  useEffect(() => { api.members.statement(member.id).then(setDetail).catch(() => {}); }, [member.id]);

  const save = async () => {
    await api.members.update(member.id, { ...form, monthly_amount: Number(form.monthly_amount) });
    setEditing(false);
    onChanged();
    onClose();
  };

  const toggleActive = async () => {
    const action = member.active ? "deactivate" : "reactivate";
    if (!confirm(`${action === "deactivate" ? "Deactivate" : "Reactivate"} ${member.name}?`)) return;
    await api.members.update(member.id, { active: member.active ? 0 : 1 });
    onChanged();
    onClose();
  };

  const contributions = detail?.contributions || [];
  const allocations = detail?.allocations || [];
  const monthlyStatuses = detail?.monthly_status || [];
  const currentStatus = monthlyStatuses.find((x) => x.month === month);
  const monthlyAmount = Number(member.monthly_amount || 0);
  const currentPaid = Number(currentStatus?.paid || 0);
  const currentDue = currentStatus?.status === "exempt" ? 0 : Number(currentStatus?.due ?? Math.max(0, monthlyAmount - currentPaid));
  const currentLabel = currentStatus?.status || (currentPaid >= monthlyAmount && monthlyAmount > 0 ? "paid" : currentPaid > 0 ? "partial" : "unpaid");
  const totalContributed = contributions
    .filter((x) => x.status === "approved")
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const approved = contributions
    .filter((x) => x.status === "approved")
    .sort((a,b) => String(b.approved_at || b.submitted_at || "").localeCompare(String(a.approved_at || a.submitted_at || "")));
  const rejected = contributions
    .filter((x) => x.status !== "approved")
    .sort((a,b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));

  const allocationsFor = (contributionId) =>
    allocations
      .filter((a) => Number(a.contribution_id) === Number(contributionId))
      .sort((a,b) => String(a.month).localeCompare(String(b.month)));

  const looksLikeBankRef = (value) => {
    if (!value) return false;
    const v = String(value).trim();
    if (v.length < 6) return false;
    if (/\s/.test(v)) return false;
    if (!/[0-9]/.test(v)) return false;
    return /^[A-Z0-9\-_/]+$/i.test(v);
  };

  const statusColor = currentLabel === "paid" ? "#3A6B3E" : currentLabel === "partial" ? "#7A5A18" : currentLabel === "exempt" ? "#51606A" : "#A6432F";
  const monthLabel = (() => {
    try { return new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)); }
    catch { return month; }
  })();

  const contributionCard = (h) => {
    const applied = allocationsFor(h.id);
    const refValid = looksLikeBankRef(h.ref_number);
    return (
      <div key={h.id} style={{ background:"#fff", border:"1px solid #E9E4D8", borderRadius:12, padding:"12px 13px", marginBottom:8 }}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
          <div style={{minWidth:0}}>
            <div className="sans" style={{fontSize:13,fontWeight:700,color:"#1F3D2B"}}>{h.txn_id}</div>
            <div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:2,textTransform:"capitalize"}}>
              {h.status}{h.approved_at ? ` · ${formatLocalDateTime(h.approved_at)}` : h.submitted_at ? ` · ${formatLocalDateTime(h.submitted_at)}` : ""}
            </div>
          </div>
          <div className="sans" style={{fontSize:14,fontWeight:700,whiteSpace:"nowrap"}}>MVR {fmt(h.amount)}</div>
        </div>

        <div className="sans" style={{fontSize:10,color:refValid?"#6B7268":"#A46B24",marginTop:8}}>
          {refValid ? <>Bank ref: <b style={{color:"#1F3D2B"}}>{h.ref_number}</b></> : <>⚠ Reference needs review: <b>{h.ref_number || "not detected"}</b></>}
        </div>

        {applied.length > 0 && (
          <div style={{background:"#F7F5EF",borderRadius:9,padding:"8px 9px",marginTop:8}}>
            <div className="sans" style={{fontSize:9,fontWeight:700,color:"#6B7268",letterSpacing:.5,marginBottom:4}}>APPLIED TO</div>
            {applied.map((a,i)=> {
              const monthly = Number(member.monthly_amount || 0);
              const label = Number(a.amount) + .005 >= monthly ? "Paid" : "Allocated";
              return <div key={i} className="sans" style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:10,padding:"3px 0"}}>
                <span>{a.month}</span>
                <span><b>MVR {fmt(a.amount)}</b> · {label}</span>
              </div>
            })}
          </div>
        )}

        {applied.length === 0 && h.status === "approved" && (
          <div className="sans" style={{fontSize:9,color:"#9A9384",marginTop:7}}>
            Legacy contribution · applied to {h.month}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} title={member.name} action={<button onClick={() => setEditing(true)} style={{ background:"none", border:"none", cursor:"pointer" }}><Pencil size={17} color="#8A9086" /></button>}>
      {editing ? (
        <>
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" prefix="MVR" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: v })} />
          <PrimaryButton onClick={save}>Save changes</PrimaryButton>
        </>
      ) : (
        <>
          <div className="sans" style={{fontSize:12,color:"#8A9086"}}>
            {member.member_code} · {member.phone || "Phone not added"} · MVR {fmt(member.monthly_amount)}/mo
          </div>
          <div className="sans" style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:member.telegram_id?"#3A6B3E":"#8A9086",marginTop:5}}>
            <span>{member.telegram_id ? "●" : "○"}</span>{member.telegram_id ? "Telegram linked" : "Telegram not linked"}
          </div>

          <div style={{background:"#F7F5EF",border:"1px solid #E9E4D8",borderRadius:12,padding:13,marginTop:14}}>
            <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                <div style={{fontSize:10,color:"#8A9086"}}>{monthLabel}</div>
                <div style={{fontSize:15,fontWeight:700,color:statusColor,textTransform:"capitalize",marginTop:2}}>{currentLabel}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700}}>MVR {fmt(currentPaid)} / {fmt(monthlyAmount)}</div>
                <div style={{fontSize:10,color:currentDue>0?"#A6432F":"#3A6B3E",marginTop:2}}>{currentDue>0?`MVR ${fmt(currentDue)} due`:"No amount due"}</div>
              </div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:9,marginBottom:16}}>
            <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:11}}>
              <div className="sans" style={{fontSize:9,color:"#8A9086"}}>TOTAL CONTRIBUTED</div>
              <div className="sans" style={{fontSize:14,fontWeight:700,marginTop:3}}>MVR {fmt(totalContributed)}</div>
            </div>
            <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:11}}>
              <div className="sans" style={{fontSize:9,color:"#8A9086"}}>CURRENT OUTSTANDING</div>
              <div className="sans" style={{fontSize:14,fontWeight:700,color:currentDue>0?"#A6432F":"#3A6B3E",marginTop:3}}>MVR {fmt(currentDue)}</div>
            </div>
          </div>

          <div className="sans" style={{fontSize:11,color:"#6B7268",marginBottom:8,fontWeight:700,letterSpacing:.5}}>CONTRIBUTION HISTORY</div>
          {approved.map(contributionCard)}
          {approved.length===0 && <div className="sans" style={{fontSize:12,color:"#8A9086",padding:"8px 0"}}>No approved contributions yet.</div>}

          {rejected.length>0 && (
            <>
              <button onClick={()=>setShowRejected(!showRejected)} className="sans"
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"10px 2px",color:"#8A9086",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                <span>REJECTED / VOIDED · {rejected.length}</span><span>{showRejected?"▲":"▼"}</span>
              </button>
              {showRejected && rejected.map(contributionCard)}
            </>
          )}

          <div className="sans" style={{fontSize:10,color:"#8A9086",fontWeight:700,marginTop:12,marginBottom:6}}>EXPORT STATEMENT</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button className="sans" onClick={() => exportStatementPdf(member)} style={smallBtn()}>PDF</button>
            <button className="sans" onClick={() => exportStatementCsv(member)} style={smallBtn()}>CSV</button>
          </div>

          {member.active && canRemind && currentDue > 0 && <button className="sans" disabled={reminding} onClick={async()=>{
            if(!confirm(`Send a payment reminder to ${member.name} for ${monthLabel}?`)) return;
            try{
              setReminding(true); setReminderNote("");
              const r=await api.admin.sendPaymentReminders({month,member_id:member.id});
              setReminderNote(r.sent ? "Reminder sent." : (r.reason || "No reminder sent."));
            }catch(e){setReminderNote(e.message)} finally{setReminding(false)}
          }} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"#EAF1EE",color:"#1F3D2B",border:"1px solid #CFE0D6",borderRadius:10,padding:11,fontSize:12,fontWeight:700,cursor:"pointer",marginTop:10}}>
            <Bell size={14}/>{reminding?"Sending…":"Send payment reminder"}
          </button>}

          {member.active && canRemind && currentDue <= 0 && (
            <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"#F2F5F3",color:"#6B7268",border:"1px solid #E0E6E2",borderRadius:10,padding:10,fontSize:11,fontWeight:600,marginTop:10}}>
              ✓ Paid — no reminder needed
            </div>
          )}

          {reminderNote && <div className="sans" style={{fontSize:10,color:"#6B7268",marginTop:5,textAlign:"center"}}>{reminderNote}</div>}

          <button onClick={toggleActive} className="sans"
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"none",color:member.active?"#A6432F":"#3A6B3E",border:"1px solid "+(member.active?"#F2D6D0":"#DDECD9"),borderRadius:10,padding:12,fontSize:13,fontWeight:600,cursor:"pointer",marginTop:12}}>
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
  useEffect(() => { api.myContributions().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return <Center>Loading…</Center>;
  const approved = rows.filter((r) => String(r.status).toLowerCase() === "approved");
  const total = approved.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const monthLabel = (m) => { if (!m) return "—"; const [y,mo]=String(m).split("-"); return new Date(Number(y),Number(mo)-1,1).toLocaleDateString("en-GB",{month:"long",year:"numeric"}); };
  const statusStyle = (status) => { const x=String(status||"").toLowerCase(); return {color:x==="approved"?"#3A6B3E":x==="rejected"?"#A6432F":"#8A6B24",background:x==="approved"?"#EAF1EE":x==="rejected"?"#FAECE8":"#FBF4DF"}; };
  return <>
    <div style={{background:"#1F3D2B",borderRadius:16,padding:"20px 22px",marginBottom:12,color:"#F7F5EF"}}>
      <div className="sans" style={{fontSize:11,opacity:.62,letterSpacing:1.1}}>MY MEMBER ACCOUNT</div>
      <div style={{fontSize:28,fontWeight:600,marginTop:4}}>{member?.member_code||"—"}</div>
      <div className="sans" style={{fontSize:13,opacity:.72,marginTop:4}}>{member?.name} · MVR {fmt(member?.monthly_amount)}/month</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
      <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"#8A9086"}}>TOTAL CONTRIBUTED</div><b className="sans">MVR {fmt(total)}</b></div>
      <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:13}}><div className="sans" style={{fontSize:10,color:"#8A9086"}}>PAYMENTS</div><b className="sans">{approved.length} approved</b></div>
    </div>
    <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}><b style={{fontSize:13,color:"#6B7268"}}>CONTRIBUTION HISTORY</b><div style={{display:"flex",gap:6}}><button onClick={()=>exportStatementPdf(member)} style={smallBtn()}>PDF</button><button onClick={()=>exportStatementCsv(member)} style={smallBtn()}>CSV</button></div></div>
    {rows.map((h)=><div key={h.id} style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:"13px 16px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><div><div className="sans" style={{fontSize:14,fontWeight:600}}>{monthLabel(h.month)}</div><div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:3}}>{h.txn_id} · Bank ref: {h.ref_number||"—"}</div></div><div style={{textAlign:"right"}}><div className="sans" style={{fontSize:14,fontWeight:600}}>MVR {fmt(h.amount)}</div><span className="sans" style={{...statusStyle(h.status),fontSize:10,fontWeight:600,padding:"3px 7px",borderRadius:99,display:"inline-block",marginTop:4,textTransform:"capitalize"}}>{h.status||"pending"}</span></div></div>
      {Array.isArray(h.allocations)&&h.allocations.length>0&&<div className="sans" style={{background:"#F7F5EF",borderRadius:9,padding:9,marginTop:10,fontSize:11}}><b>Applied to</b>{h.allocations.map((x,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span>{monthLabel(x.month)}</span><span>MVR {fmt(x.amount)}</span></div>)}</div>}
    </div>)}
    {rows.length===0&&<div className="sans" style={{fontSize:13,color:"#8A9086"}}>No contributions yet — send a slip photo to the bot to get started.</div>}
  </>;
}

function FundView() {
  const [month, setMonth] = useState(currentMonthValue());
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [expenseDetail, setExpenseDetail] = useState(null);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const loadSummary = () => {
    setSummary(null);
    setSummaryError("");
    api.reports.publicSummary(month)
      .then(setSummary)
      .catch((err) => setSummaryError(err?.message || "Could not load fund information."));
  };

  useEffect(() => {
    loadSummary();
    setExpenseDetail(null);
  }, [month]);

  const openExpenseCategory = async (category) => {
    if (!category?.category_id) return;
    setExpenseLoading(true);
    setExpenseError("");
    setExpenseDetail({ category: { id: category.category_id, name: category.category }, month, total: Number(category.spent || 0), expenses: null });
    try {
      setExpenseDetail(await api.reports.publicExpenses(month, category.category_id));
    } catch (e) {
      setExpenseError(e?.message || "Could not load expense details.");
    } finally {
      setExpenseLoading(false);
    }
  };

  const shiftMonth = (delta) => {
    const [y,m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };

  const monthLabel = (() => {
    try {
      const [y,m] = month.split("-").map(Number);
      return new Intl.DateTimeFormat("en",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));
    } catch { return month; }
  })();

  if (summaryError) return (
    <div className="sans" style={{background:"#FFF7F3",border:"1px solid #E9CFC5",borderRadius:12,padding:16,color:"#8E3F2E"}}>
      <div style={{fontWeight:700,marginBottom:5}}>Fund information unavailable</div>
      <div style={{fontSize:12,marginBottom:12}}>{summaryError}</div>
      <button onClick={loadSummary} style={compactBtn}>Try again</button>
    </div>
  );
  if (!summary) return <Center>Loading…</Center>;

  const categories = summary.byCategory || [];
  const visibleCategories = showAllCategories ? categories : categories.filter(c => Number(c.spent || 0) > 0);
  const monthSpent = Number(summary.expenses || 0);
  const totalReceived = Number(summary.totalReceived || 0);
  const totalSpent = Number(summary.totalSpent || 0);
  const recent = summary.recentActivity || [];

  return (
    <>
      <div className="sans" style={{ display:"flex", alignItems:"center", gap:7, background:"#EAF1EE", color:"#1F3D2B", fontSize:12, borderRadius:10, padding:"9px 12px", marginBottom:14 }}>
        <Eye size={13} /> Fund information is read-only and visible to all members
      </div>

      <div style={{ background:"#1F3D2B", borderRadius:16, padding:22, color:"#F7F5EF", marginBottom:10 }}>
        <div className="sans" style={{ fontSize:12, opacity:.6, letterSpacing:1 }}>TOTAL FUND BALANCE</div>
        <div style={{ fontSize:34, fontWeight:600, marginTop:4 }}>MVR {fmt(summary.fundBalance)}</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
        <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:13}}>
          <div className="sans" style={{fontSize:10,color:"#8A9086"}}>TOTAL RECEIVED</div>
          <div className="sans" style={{fontSize:15,fontWeight:700,color:"#3A6B3E",marginTop:3}}>MVR {fmt(totalReceived)}</div>
        </div>
        <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:13}}>
          <div className="sans" style={{fontSize:10,color:"#8A9086"}}>TOTAL SPENT</div>
          <div className="sans" style={{fontSize:15,fontWeight:700,color:"#A6432F",marginTop:3}}>MVR {fmt(totalSpent)}</div>
        </div>
      </div>

      <div className="sans" style={{fontSize:13,color:"#6B7268",marginBottom:8,fontWeight:700}}>SPENDING</div>
      <div style={{display:"grid",gridTemplateColumns:"42px 1fr 42px",alignItems:"center",gap:8,marginBottom:10}}>
        <button onClick={()=>shiftMonth(-1)} style={{...compactBtn,padding:8}}>‹</button>
        <div className="sans" style={{textAlign:"center",background:"#fff",border:"1px solid #E9E4D8",borderRadius:10,padding:10,fontWeight:600}}>{monthLabel}</div>
        <button onClick={()=>shiftMonth(1)} style={{...compactBtn,padding:8}}>›</button>
      </div>

      <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:"11px 14px",marginBottom:9,display:"flex",justifyContent:"space-between"}}>
        <span className="sans" style={{fontSize:12,color:"#6B7268"}}>Total spent this month</span>
        <b className="sans" style={{fontSize:13,color:"#A6432F"}}>MVR {fmt(monthSpent)}</b>
      </div>

      {visibleCategories.map((c, i) => {
        const spent = Number(c.spent || 0);
        const pct = monthSpent > 0 ? Math.round((spent / monthSpent) * 100) : 0;
        return <button key={i} onClick={()=>openExpenseCategory(c)}
          style={{width:"100%",textAlign:"left",background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:"12px 14px",marginBottom:8,cursor:"pointer",color:"inherit"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
            <span className="sans" style={{fontSize:14,fontWeight:500}}>{c.category}</span>
            <span style={{display:"flex",alignItems:"center",gap:7}}>
              <span className="sans" style={{fontSize:14,fontWeight:700,color:"#A6432F"}}>MVR {fmt(spent)}</span>
              <span className="sans" style={{fontSize:16,color:"#9A9384"}}>›</span>
            </span>
          </div>
          {spent > 0 && <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:4}}>{pct}% of this month's expenses · Tap for details</div>}
          {spent === 0 && <div className="sans" style={{fontSize:10,color:"#B2ACA0",marginTop:4}}>No expenses · Tap for details</div>}
        </button>;
      })}

      {visibleCategories.length === 0 &&
        <div className="sans" style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:14,color:"#8A9086",fontSize:12,marginBottom:8}}>
          No spending recorded for {monthLabel}.
        </div>}

      {categories.some(c => Number(c.spent || 0) === 0) &&
        <button onClick={()=>setShowAllCategories(!showAllCategories)} className="sans"
          style={{width:"100%",border:0,background:"transparent",color:"#6B7268",fontSize:11,fontWeight:600,padding:"6px 0 16px",cursor:"pointer"}}>
          {showAllCategories ? "Hide zero-value categories" : "View all categories"}
        </button>}

      <div className="sans" style={{fontSize:13,color:"#6B7268",marginBottom:8,fontWeight:700}}>RECENT FUND ACTIVITY</div>
      {recent.map((a,i) => {
        const incoming = a.kind === "contribution" || a.kind === "donation";
        return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:"11px 13px",marginBottom:7}}>
          <div style={{minWidth:0}}>
            <div className="sans" style={{fontSize:12,fontWeight:600}}>{a.label}</div>
            <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:2}}>{a.event_at ? formatLocalDateTime(a.event_at) : ""}</div>
          </div>
          <div className="sans" style={{fontSize:13,fontWeight:700,color:incoming?"#3A6B3E":"#A6432F",whiteSpace:"nowrap"}}>
            {incoming ? "+" : "−"} MVR {fmt(a.amount)}
          </div>
        </div>;
      })}
      {recent.length === 0 && <div className="sans" style={{fontSize:12,color:"#8A9086"}}>No fund activity yet.</div>}

      {expenseDetail && <Modal title={expenseDetail.category?.name || "Expense details"} onClose={()=>!expenseLoading&&setExpenseDetail(null)}>
        <div className="sans" style={{background:"#F7F5EF",borderRadius:11,padding:12,marginBottom:12}}>
          <div style={{fontSize:10,color:"#8A9086"}}>{monthLabel.toUpperCase()}</div>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"end",marginTop:4}}>
            <div style={{fontSize:14,fontWeight:700}}>{expenseDetail.category?.name}</div>
            <div style={{fontSize:16,fontWeight:700,color:"#A6432F"}}>MVR {fmt(expenseDetail.total || 0)}</div>
          </div>
        </div>

        {expenseLoading && <Center>Loading expenses…</Center>}
        {expenseError && <div className="sans" style={{background:"#FFF7F3",border:"1px solid #E9CFC5",borderRadius:10,padding:11,color:"#8E3F2E",fontSize:11}}>{expenseError}</div>}

        {!expenseLoading && !expenseError && (expenseDetail.expenses || []).map((e)=><div key={e.id}
          style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:"12px 13px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
            <div style={{minWidth:0}}>
              <div className="sans" style={{fontSize:13,fontWeight:700,color:"#1F2A22"}}>{e.description || "Expense"}</div>
              <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:3}}>{e.txn_id || `Expense #${e.id}`}</div>
            </div>
            <div className="sans" style={{fontSize:14,fontWeight:700,color:"#A6432F",whiteSpace:"nowrap"}}>MVR {fmt(e.amount)}</div>
          </div>
          <div className="sans" style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"5px 10px",fontSize:10,marginTop:10,paddingTop:9,borderTop:"1px solid #F0EDE3"}}>
            <span style={{color:"#8A9086"}}>Category</span><span>{e.category}</span>
            <span style={{color:"#8A9086"}}>Expense month</span><span>{e.transaction_month || month}</span>
            <span style={{color:"#8A9086"}}>Logged</span><span>{e.created_at ? formatLocalDateTime(e.created_at) : "—"}</span>
          </div>
        </div>)}

        {!expenseLoading && !expenseError && (expenseDetail.expenses || []).length===0 &&
          <div className="sans" style={{fontSize:12,color:"#8A9086",padding:"10px 2px 4px"}}>No expenses recorded in this category for {monthLabel}.</div>}
      </Modal>}
    </>
  );
}

/* ---------- Activity ---------- */
function Activity({ isAdmin, canFinance = false }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("all");
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  const loadActivity = () => api.reports.activity().then(setRows).catch(() => setRows([]));
  useEffect(() => { loadActivity(); }, []);
  useEffect(() => { if (canFinance) api.expenses.categories().then(setExpenseCategories).catch(() => {}); }, [canFinance]);

  const openExpense = (row) => {
    if (!canFinance || row.kind !== "expense") return;
    setExpenseError("");
    setEditingExpense({
      ...row,
      description: row.description || row.who || "",
      category_id: row.category_id || "",
      transaction_month: row.transaction_month || String(row.created_at || "").slice(0, 7),
      amount: Number(row.amount || 0),
    });
  };

  const saveExpense = async () => {
    if (!editingExpense) return;
    if (!editingExpense.description?.trim()) return setExpenseError("Description is required.");
    if (!(Number(editingExpense.amount) > 0)) return setExpenseError("Enter a valid amount.");
    setExpenseBusy(true); setExpenseError("");
    try {
      await api.expenses.update(editingExpense.id, {
        description: editingExpense.description.trim(),
        category_id: editingExpense.category_id ? Number(editingExpense.category_id) : null,
        amount: Number(editingExpense.amount),
        transaction_month: editingExpense.transaction_month,
      });
      setEditingExpense(null);
      await loadActivity();
    } catch (e) { setExpenseError(e.message || "Could not update expense."); }
    finally { setExpenseBusy(false); }
  };

  const voidExpense = async () => {
    if (!editingExpense) return;
    const reason = window.prompt("Reason for voiding this expense:");
    if (reason === null) return;
    if (!reason.trim()) return setExpenseError("A void reason is required.");
    if (!window.confirm(`Void ${editingExpense.txn_id || "this expense"}? The record will remain in the audit history.`)) return;
    setExpenseBusy(true); setExpenseError("");
    try {
      await api.expenses.remove(editingExpense.id, reason.trim());
      setEditingExpense(null);
      await loadActivity();
    } catch (e) { setExpenseError(e.message || "Could not void expense."); }
    finally { setExpenseBusy(false); }
  };
  if (rows === null) return <Center>Loading…</Center>;

  const filtered = rows.filter((r) => filter === "all" || r.kind === filter);
  const income = filtered.filter((r) => r.kind === "contribution" || r.kind === "donation").reduce((n, r) => n + Number(r.amount || 0), 0);
  const expenses = filtered.filter((r) => r.kind === "expense").reduce((n, r) => n + Number(r.amount || 0), 0);
  const groups = [];
  filtered.forEach((row) => {
    const label = activityDayLabel(row);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  });

  const filters = [
    ["all", "All"], ["contribution", "Contributions"], ["donation", "Donations"], ["expense", "Expenses"]
  ];

  return (
    <>
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#8A9086" }}>Recent activity</div>
        <div style={{ fontSize: 12, color: income - expenses >= 0 ? "#3A6B3E" : "#A6432F", fontWeight: 700 }}>Net {income - expenses >= 0 ? "+" : "−"}MVR {fmt(Math.abs(income - expenses))}</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {filters.map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} className="sans"
            style={{ flex: "0 0 auto", background: filter === value ? "#1F3D2B" : "#fff", color: filter === value ? "#F7F5EF" : "#6B7268", border: "1px solid " + (filter === value ? "#1F3D2B" : "#E9E4D8"), borderRadius: 20, padding: "6px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sans" style={{ display: "flex", alignItems: "center", gap: 8, margin: "13px 2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: "#8A9086" }}>
            <span>{group.label}</span><span style={{ height: 1, flex: 1, background: "#E9E4D8" }} />
          </div>
          {group.rows.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} canFinance={canFinance} onExpenseClick={openExpense} />)}
        </div>
      ))}
      {filtered.length === 0 && <div className="sans" style={{ fontSize: 13, color: "#8A9086" }}>Nothing here yet.</div>}

      {editingExpense && <Modal title="Edit expense" onClose={() => !expenseBusy && setEditingExpense(null)}>
        <div className="sans" style={{fontSize:11,color:"#6B7268",background:"#EAF1EE",padding:"9px 10px",borderRadius:9,marginBottom:12,lineHeight:1.45}}>
          {editingExpense.txn_id || `Expense #${editingExpense.id}`} · Changes are saved to the audit log. Use Void instead of permanently deleting a financial record.
        </div>
        <Field label="Description" value={editingExpense.description || ""} onChange={(v)=>setEditingExpense({...editingExpense,description:v})}/>
        <Field label="Amount" type="number" prefix="MVR" value={editingExpense.amount} onChange={(v)=>setEditingExpense({...editingExpense,amount:v})}/>
        <label className="sans" style={{display:"block",fontSize:11,color:"#6B7268",marginBottom:10}}>
          <span style={{display:"block",marginBottom:5}}>Category</span>
          <select value={editingExpense.category_id || ""} onChange={(e)=>setEditingExpense({...editingExpense,category_id:e.target.value})}
            style={{width:"100%",padding:"10px 11px",border:"1px solid #DED8CA",borderRadius:9,background:"#fff",fontSize:13}}>
            <option value="">Uncategorised</option>
            {expenseCategories.filter(c=>Number(c.active)!==0 || Number(c.id)===Number(editingExpense.category_id)).map(c=><option key={c.id} value={c.id}>{c.name}{Number(c.active)===0?" (inactive)":""}</option>)}
          </select>
        </label>
        <Field label="Expense month" type="month" value={editingExpense.transaction_month || ""} onChange={(v)=>setEditingExpense({...editingExpense,transaction_month:v})}/>
        {expenseError && <div className="sans" style={{fontSize:11,color:"#A6432F",background:"#FDEDE8",padding:9,borderRadius:8,marginBottom:10}}>{expenseError}</div>}
        <button disabled={expenseBusy} onClick={saveExpense} style={{...approveBtn,width:"100%",padding:"10px 12px",opacity:expenseBusy?.6:1}}>
          {expenseBusy ? "Saving…" : "Save changes"}
        </button>
        <button disabled={expenseBusy} onClick={voidExpense} style={{...rejectBtn,width:"100%",padding:"10px 12px",marginTop:8,opacity:expenseBusy?.6:1}}>
          Void expense
        </button>
      </Modal>}
    </>
  );
}
/* ---------- Reports (admin) ---------- */
function Reports({ setTab }) {
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
    await sendExportToTelegram(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename, `${monthLabel} · Fund report CSV`);
  };

  return (
    <>
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1F3D2B", letterSpacing: .4 }}>REPORTS</div>
        <div style={{ display: "flex", gap: 6, position: "relative" }}>
          <button onClick={()=>exportFundPdf({month,monthLabel,summary}).catch(e=>alert(e.message))} style={{ ...smallBtn("#1F3D2B"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> PDF</button>
          <button onClick={exportCsv} style={{ ...smallBtn("#1F3D2B"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> CSV</button>
          <button onClick={() => setShowAdd(!showAdd)} style={{ ...smallBtn("#1F3D2B"), flex: "0 0 auto", padding: "7px 10px" }}><Plus size={13} /> Add</button>
          {showAdd && (
            <div style={{ position: "absolute", right: 0, top: 38, zIndex: 5, width: 160, background: "#fff", border: "1px solid #E9E4D8", borderRadius: 10, padding: 5, boxShadow: "0 8px 24px rgba(31,61,43,.12)" }}>
              <button onClick={() => { setShowDonation(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "#3A6B3E", cursor: "pointer" }}>+ Log donation</button>
              <button onClick={() => { setShowExpense(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "#A6432F", cursor: "pointer" }}>+ Log expense</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "38px 1fr 38px", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel}</div>
        <button onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 7, fontWeight: 700 }}>MONTHLY SUMMARY</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <Row label="Contribution cash received" value={`+ MVR ${fmt(summary.memberIncome)}`} color="#3A6B3E" />
        <Row label="Donations" value={`+ MVR ${fmt(summary.donationIncome)}`} color="#3A6B3E" />
        <Row label="Expenses" value={`− MVR ${fmt(summary.expenses)}`} color="#A6432F" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, paddingTop: 9, borderTop: "1px solid #E9E4D8" }}>
          <span className="sans" style={{ fontWeight: 700 }}>Net cash change</span>
          <span style={{ fontWeight: 700, color: Number(summary.net) >= 0 ? "#3A6B3E" : "#A6432F" }}>{Number(summary.net) >= 0 ? "+" : "−"} MVR {fmt(Math.abs(Number(summary.net || 0)))}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 9 }}>
          <span className="sans" style={{ color: "#6B7268" }}>Closing balance</span>
          <span style={{ fontWeight: 700 }}>MVR {fmt(summary.fundBalance)}</span>
        </div>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 7, fontWeight: 700 }}>CONTRIBUTION COLLECTION</div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}>
          <span><b>MVR {fmt(allocatedContributions)}</b> / MVR {fmt(totalRequired)}</span>
          <strong>{collectionPct}%</strong>
        </div>
        <div style={{ height: 7, borderRadius: 99, background: "#E9E4D8", overflow: "hidden" }}>
          <div style={{ width: `${collectionPct}%`, height: "100%", background: "#3A6B3E", borderRadius: 99 }} />
        </div>
        <div className="sans" style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid #F0EDE3", fontSize: 11 }}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:10, marginBottom: advanceAllocated > 0 ? 6 : 0 }}>
            <span style={{ color:"#6B7268" }}>Allocated to {monthLabel}</span>
            <b>MVR {fmt(allocatedContributions)}</b>
          </div>
          {advanceAllocated > 0 && <div style={{ display:"flex", justifyContent:"space-between", gap:10, color:"#3A6B3E" }}>
            <span>↳ Paid in advance</span>
            <b>MVR {fmt(advanceAllocated)}</b>
          </div>}
          {currentMonthAllocated > 0 && advanceAllocated > 0 && <div style={{ display:"flex", justifyContent:"space-between", gap:10, color:"#8A9086", marginTop:5 }}>
            <span>↳ From cash received this month</span>
            <span>MVR {fmt(currentMonthAllocated)}</span>
          </div>}
        </div>
      </div>
      <div className="sans" style={{fontSize:10,color:"#8A9086",lineHeight:1.45,margin:"-4px 2px 12px"}}>
        Advance allocations count toward collection only. The cash was already added to the fund when it was originally received, so it is not counted again here.
      </div>

      {(summary.outstanding?.total || 0) > 0 && (
        <button onClick={() => setTab?.("members")} style={{ width: "100%", background: "#FBF1EE", border: "1px solid #F2D6D0", borderRadius: 12, padding: "13px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "#A6432F" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding dues</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>MVR {fmt(summary.outstanding?.total)} · {members.length} members ›</span>
        </button>
      )}

      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#6B7268", marginBottom: 7, fontWeight: 700 }}>
        <span>CASH INCOME VS EXPENSES — 6 MONTHS</span>
        <span style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 500 }}>
          <span>● Income</span><span style={{ color: "#A6432F" }}>● Expenses</span>
        </span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "14px 12px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 112 }}>
          {trend.map((d, i) => {
            const label = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${d.month}-01T00:00:00Z`));
            return (
              <div key={i} title={`Income MVR ${fmt(d.income)} · Expenses MVR ${fmt(d.expense)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", height: 84 }}>
                  <div style={{ flex: 1, minHeight: Number(d.income) > 0 ? 2 : 0, height: `${(Number(d.income || 0) / maxVal) * 100}%`, background: "#3A6B3E", borderRadius: "3px 3px 0 0" }} />
                  <div style={{ flex: 1, minHeight: Number(d.expense) > 0 ? 2 : 0, height: `${(Number(d.expense || 0) / maxVal) * 100}%`, background: "#A6432F", borderRadius: "3px 3px 0 0" }} />
                </div>
                <div className="sans" style={{ fontSize: 10, color: "#8A9086" }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sans" style={{ fontSize: 12, color: "#6B7268", marginBottom: 7, fontWeight: 700 }}>EXPENSES BY CATEGORY</div>
      {activeCategories.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "#fff", border: "1px solid #E9E4D8", borderRadius: 12, padding: "11px 14px", marginBottom: 7 }}>
          <span className="sans" style={{ fontSize: 13, fontWeight: 500 }}>{c.category}</span>
          <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "#A6432F" }}>MVR {fmt(c.spent)}</span>
        </div>
      ))}
      {activeCategories.length === 0 && <div className="sans" style={{ fontSize: 12, color: "#8A9086", marginBottom: 8 }}>No expenses for this month.</div>}

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
function PendingApprovals() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastChecked, setLastChecked] = useState(null);

  const load = () => api.admin.pending()
    .then((d) => { setData(d); setLastChecked(new Date()); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  if (!data) return <Center>{error || "Loading approvals…"}</Center>;

  const registrations = data.registrations || [];
  const contributions = data.contributions || [];
  const expenses = data.expenses || [];
  const count = registrations.length + contributions.length + expenses.length;

  const act = async (fn) => {
    try {
      setError("");
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const filters = [
    ["all", "All", count],
    ["contributions", "Slips", contributions.length],
    ["registrations", "Members", registrations.length],
    ["expenses", "Expenses", expenses.length],
  ];

  const showContributions = filter === "all" || filter === "contributions";
  const showRegistrations = filter === "all" || filter === "registrations";
  const showExpenses = filter === "all" || filter === "expenses";
  const checkedLabel = lastChecked
    ? lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return <>
    <div className="sans" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
      <div>
        <div style={{fontWeight:700,fontSize:15}}>Pending approvals</div>
        {count > 0
          ? <div style={{fontSize:11,color:"#8A9086",marginTop:2}}>{count} item{count===1?"":"s"} waiting</div>
          : <div style={{fontSize:11,color:"#3A6B3E",marginTop:2}}>All caught up</div>}
      </div>
      <button onClick={load} aria-label="Refresh approvals"
        style={{...compactBtn,width:34,height:34,padding:0,borderRadius:10,fontSize:17}}>↻</button>
    </div>

    {error && <div className="sans" style={{background:"#FDEDE8",color:"#A6432F",padding:10,borderRadius:10,fontSize:12,marginBottom:12}}>{error}</div>}

    {count === 0 ? (
      <div style={{background:"#fff",border:"1px solid #E3EBDD",borderRadius:16,padding:"34px 20px",textAlign:"center",marginTop:18}}>
        <div style={{width:48,height:48,borderRadius:24,background:"#EAF1EE",color:"#3A6B3E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,margin:"0 auto 12px"}}>✓</div>
        <div className="sans" style={{fontSize:16,fontWeight:700,color:"#1F3D2B"}}>All caught up</div>
        <div className="sans" style={{fontSize:12,color:"#8A9086",lineHeight:1.55,marginTop:6}}>
          No approvals are waiting.<br/>New submissions will appear here.
        </div>
        {checkedLabel && <div className="sans" style={{fontSize:10,color:"#B5AE9C",marginTop:16}}>Last checked {checkedLabel}</div>}
      </div>
    ) : (
      <>
        <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:3,marginBottom:16}}>
          {filters.map(([key,label,n]) => (
            <button key={key} onClick={()=>setFilter(key)} className="sans"
              style={{flex:"0 0 auto",border:`1px solid ${filter===key?"#1F3D2B":"#E2DDD0"}`,background:filter===key?"#1F3D2B":"#fff",color:filter===key?"#F7F5EF":"#6B7268",borderRadius:20,padding:"6px 11px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
              {label} {n}
            </button>
          ))}
        </div>

        {showContributions && contributions.length > 0 && <>
          <SectionTitle>CONTRIBUTION SLIPS</SectionTitle>
          {contributions.map((c) => {
            const needsReview = !c.ref_number || !c.bank_date || !Number(c.amount);
            return <div key={c.id} style={{...cardStyle,padding:13}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
                <div style={{minWidth:0}}>
                  <div className="sans" style={{fontWeight:700,fontSize:14}}>{c.member_name}</div>
                  <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:2}}>{c.member_code || ""}{c.month ? ` · ${c.month}` : ""}</div>
                </div>
                <div className="sans" style={{fontWeight:700,fontSize:14,whiteSpace:"nowrap"}}>MVR {fmt(c.amount)}</div>
              </div>
              <div className="sans" style={{fontSize:11,color:"#6B7268",marginTop:8}}>
                Ref: <b style={{color:c.ref_number?"#1F3D2B":"#A6432F"}}>{c.ref_number || "Not detected"}</b>
              </div>
              {c.created_at && <div className="sans" style={{fontSize:10,color:"#B5AE9C",marginTop:4}}>Submitted {formatLocalDateTime(c.created_at)}</div>}
              <div className="sans" style={{fontSize:10,color:needsReview?"#A46B24":"#3A6B3E",marginTop:7,fontWeight:600}}>
                {needsReview ? "⚠ OCR needs review" : "✓ OCR details detected"}
              </div>
              {Array.isArray(c.allocation_preview) && c.allocation_preview.length>0 && (
                <div className="sans" style={{background:"#F7F5EF",borderRadius:9,padding:9,marginTop:8,fontSize:10,color:"#59645B"}}>
                  <b style={{color:"#1F3D2B"}}>Will be applied to</b>
                  {c.allocation_preview.map((a,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                    <span>{a.month}</span><span>MVR {fmt(a.amount)} · {a.status_after==="paid"?"Paid":"Partial"}</span>
                  </div>)}
                </div>
              )}
              <button onClick={() => setEditing({...c})}
                style={{...approveBtn,width:"100%",marginTop:10,padding:"9px 10px"}}>
                Review →
              </button>
            </div>;
          })}
        </>}

        {showRegistrations && registrations.length > 0 && <>
          <SectionTitle>NEW MEMBERS</SectionTitle>
          {registrations.map((r) => <div key={r.id} style={{...cardStyle,padding:13}}>
            <div className="sans" style={{fontWeight:700,fontSize:14}}>{r.name}</div>
            <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:3}}>
              {r.username ? `@${r.username}` : "Telegram user"} · {r.telegram_id}
            </div>
            {r.created_at && <div className="sans" style={{fontSize:10,color:"#B5AE9C",marginTop:4}}>Submitted {formatLocalDateTime(r.created_at)}</div>}
            {(r.possible_matches || []).map((m) => <div key={m.id} className="sans"
              style={{fontSize:11,background:"#FFF6E5",padding:8,borderRadius:8,marginTop:8}}>
              Possible existing member: <b>{m.member_code}</b> — {m.name}
              <button onClick={() => act(() => api.admin.approveRegistration(r.id, m.id))} style={{...compactBtn,marginLeft:7}}>Link</button>
            </div>)}
            <div style={{display:"flex",gap:7,marginTop:10}}>
              <button onClick={() => act(() => api.admin.approveRegistration(r.id))} style={{...approveBtn,flex:1}}>Create & approve</button>
              <button onClick={() => act(() => api.admin.rejectRegistration(r.id, "Rejected by admin"))} style={rejectBtn}>Reject</button>
            </div>
          </div>)}
        </>}

        {showExpenses && expenses.length > 0 && <>
          <SectionTitle>EXPENSE CONFIRMATIONS</SectionTitle>
          {expenses.map((e) => <div key={e.id} style={{...cardStyle,padding:13}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
              <div style={{minWidth:0}}>
                <div className="sans" style={{fontWeight:700,fontSize:14}}>{e.description}</div>
                <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:2}}>{e.txn_id} · by {e.logged_by_name || "admin"}</div>
              </div>
              <div className="sans" style={{fontWeight:700,fontSize:14,whiteSpace:"nowrap"}}>MVR {fmt(e.amount)}</div>
            </div>
            {e.created_at && <div className="sans" style={{fontSize:10,color:"#B5AE9C",marginTop:5}}>Submitted {formatLocalDateTime(e.created_at)}</div>}
            <div style={{display:"flex",gap:7,marginTop:10}}>
              <button onClick={() => act(() => api.expenses.approve(e.id))} style={{...approveBtn,flex:1}}>Confirm</button>
              <button onClick={() => act(() => api.expenses.reject(e.id))} style={rejectBtn}>Reject</button>
            </div>
          </div>)}
        </>}
      </>
    )}

    {editing && <Modal title={`Review ${editing.txn_id}`} onClose={() => setEditing(null)}>
      <div className="sans" style={{fontSize:11,color:"#6B7268",background:"#F7F5EF",padding:9,borderRadius:8,marginBottom:10}}>
        Verify the bank slip details before approval. Correct any OCR mistakes first.
      </div>
      <Field label="Amount" type="number" prefix="MVR" value={editing.amount} onChange={(v)=>setEditing({...editing,amount:v})}/>
      <Field label="Bank reference" value={editing.ref_number || ""} onChange={(v)=>setEditing({...editing,ref_number:v})}/>
      <Field label="Bank date (YYYY-MM-DD)" value={editing.bank_date || ""} onChange={(v)=>setEditing({...editing,bank_date:v})}/>
      <Field label="Contribution month (YYYY-MM)" value={editing.month || ""} onChange={(v)=>setEditing({...editing,month:v})}/>
      {Array.isArray(editing.allocation_preview) && editing.allocation_preview.length>0 && <div className="sans" style={{background:"#EAF1EE",borderRadius:9,padding:10,marginBottom:10,fontSize:11}}>
        <b>Automatic allocation preview</b>
        {editing.allocation_preview.map((a,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginTop:5}}><span>{a.month}</span><span>MVR {fmt(a.amount)} · {a.status_after==="paid"?"Paid":"Partial"}</span></div>)}
      </div>}
      <div style={{display:"flex",gap:8}}>
        <button style={{...compactBtn,flex:1}} onClick={() => act(async()=>{
          await api.admin.correctContribution(editing.id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});
          setEditing(null);
        })}>Save correction</button>
        <button style={{...approveBtn,flex:1}} onClick={() => act(async()=>{
          await api.admin.correctContribution(editing.id,{amount:editing.amount,ref_number:editing.ref_number||null,bank_date:editing.bank_date||null,month:editing.month});
          await api.admin.approveContribution(editing.id);
          setEditing(null);
        })}>Approve</button>
      </div>
      <button style={{...rejectBtn,width:"100%",marginTop:8}} onClick={() => act(async()=>{
        await api.admin.rejectContribution(editing.id,"Rejected by admin");
        setEditing(null);
      })}>Reject contribution</button>
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
      <b>{auditLabel(a.action)}</b><span style={{color:"#B5AE9C",fontSize:10,whiteSpace:"nowrap"}}>{formatLocalDateTime(a.created_at)}</span>
    </div>
    {rows.map((r,i)=><div key={`${r.label}-${i}`} style={{fontSize:11,color:"#6B7268",marginTop:3}}><span style={{color:"#9A9384"}}>{r.label}:</span> {r.value}</div>)}
    <div style={{fontSize:10,color:"#B5AE9C",marginTop:4}}>by {a.admin_name || "system"}</div>
  </div>;
}


/* ---------- Meetings (admin) ---------- */
function Meetings(){
  const emptyForm={title:"",meeting_date:"",meeting_time:"",venue:"",agenda:"",rsvp_deadline:""};
  const [rows,setRows]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [selected,setSelected]=useState(null);
  const [details,setDetails]=useState(null);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [form,setForm]=useState(emptyForm);
  const [openGroups,setOpenGroups]=useState({yes:true,maybe:false,no:false,pending:true});

  const load=()=>api.admin.meetings().then(setRows).catch(e=>setMessage(e.message));
  useEffect(()=>{load()},[]);

  const fmtMeetingDateTime=(date,time)=>{
    if(!date)return "";
    try{
      const d=new Date(`${date}T${time||"00:00"}:00`);
      const datePart=new Intl.DateTimeFormat("en",{day:"numeric",month:"short",year:"numeric"}).format(d);
      const timePart=time?new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(d):"";
      return timePart?`${datePart} · ${timePart}`:datePart;
    }catch{return `${date}${time?` · ${time}`:""}`}
  };

  const meetingLifecycle=(m)=>{
    if(m.status==="cancelled") return {label:"Cancelled",color:"#A6432F",bg:"#FDEDE8"};
    const now=new Date();
    const when=new Date(`${m.meeting_date}T${m.meeting_time||"00:00"}:00`);
    if(!Number.isNaN(when.getTime()) && when.getTime()<now.getTime()) return {label:"Completed",color:"#51606A",bg:"#EEF0F1"};
    if(!m.sent_at && m.status!=="sent") return {label:"Draft",color:"#6B7268",bg:"#F3F0E7"};
    return {label:"Upcoming",color:"#315C35",bg:"#EAF1EE"};
  };

  const openDetails=async(m)=>{
    setSelected(m);setDetails(null);setEditing(false);setMessage("");
    try{setDetails(await api.admin.meeting(m.id))}
    catch(e){setMessage(e.message||"Could not load meeting details")}
  };

  const create=async()=>{
    setBusy(true);setMessage("");
    try{
      const meeting=await api.admin.createMeeting(form);
      setShowCreate(false);setForm(emptyForm);await load();
      if(window.confirm("Meeting created. Send Telegram invitations to all active linked members now?")){
        const r=await api.admin.sendMeetingInvites(meeting.id);
        setMessage(`Invitations sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
        await load();
      }
    }catch(e){setMessage(e.message||"Could not create meeting")}finally{setBusy(false)}
  };

  const send=async(m)=>{
    if(!window.confirm(`Send "${m.title}" invitation to all active Telegram-linked members?`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.sendMeetingInvites(m.id);
      setMessage(`Invitations sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
      await load();if(selected?.id===m.id)await openDetails(m);
    }catch(e){setMessage(e.message||"Could not send invitations")}finally{setBusy(false)}
  };

  const beginEdit=()=>{
    if(!details)return;
    setForm({
      title:details.title||"",meeting_date:details.meeting_date||"",meeting_time:details.meeting_time||"",
      venue:details.venue||"",agenda:details.agenda||"",rsvp_deadline:details.rsvp_deadline||""
    });
    setEditing(true);
  };

  const saveEdit=async()=>{
    if(!details)return;
    setBusy(true);setMessage("");
    try{
      const result=await api.admin.updateMeeting(details.id,form);
      setEditing(false);await load();await openDetails(result);
      if(!result.changed){
        setMessage("No changes to save.");
        return;
      }
      const label=result.rescheduled?"Meeting rescheduled.":"Meeting updated.";
      if(details.status==="sent"&&window.confirm(result.rescheduled
        ?"Meeting rescheduled. Notify members of the new date/time now?"
        :"Meeting updated. Notify members of the changes now?")){
        const r=await api.admin.notifyMeetingUpdate(details.id,{
          rescheduled:result.rescheduled,
          previous_date:result.previous_date,
          previous_time:result.previous_time,
          changed_fields:result.changed_fields
        });
        setMessage(`${result.rescheduled?"Reschedule":"Update"} sent: ${r.sent}${r.unlinked?` · ${r.unlinked} unlinked`:""}${r.failed?` · ${r.failed} failed`:""}`);
      }else setMessage(label);
    }catch(e){setMessage(e.message||"Could not update meeting")}finally{setBusy(false)}
  };

  const cancelMeeting=async()=>{
    if(!details)return;
    const reason=window.prompt("Reason for cancelling this meeting:");
    if(reason===null)return;
    if(!reason.trim())return setMessage("Cancellation reason is required.");
    if(!window.confirm(`Cancel "${details.title}"? Telegram-linked members will be notified.`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.cancelMeeting(details.id,reason.trim());
      setMessage(`Meeting cancelled · ${r.sent||0} notification${Number(r.sent||0)===1?"":"s"} sent.`);
      await load();await openDetails(r.meeting);
    }catch(e){setMessage(e.message||"Could not cancel meeting")}finally{setBusy(false)}
  };

  const remindPending=async()=>{
    if(!details)return;
    const pending=details.responses?.pending||[];
    const linked=pending.filter(x=>x.telegram_id).length;
    if(!linked)return setMessage("No awaiting members are linked to Telegram.");
    if(!window.confirm(`Send an RSVP reminder to ${linked} awaiting ${linked===1?"member":"members"}?`))return;
    setBusy(true);setMessage("");
    try{
      const r=await api.admin.remindMeetingPending(details.id);
      setMessage(`RSVP reminder sent to ${r.sent} member${Number(r.sent)===1?"":"s"}${r.unlinked?` · ${r.unlinked} awaiting member(s) not linked`:""}.`);
      setDetails(await api.admin.meeting(details.id));
      await load();
    }catch(e){setMessage(e.message||"Could not send RSVP reminder")}finally{setBusy(false)}
  };

  const group=(key,label,list,color)=>{
    const open=openGroups[key];
    return <div style={{borderTop:"1px solid #F0EDE3",paddingTop:8,marginTop:8}}>
      <button onClick={()=>setOpenGroups({...openGroups,[key]:!open})} className="sans"
        style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"2px 0 6px",cursor:"pointer"}}>
        <span style={{fontSize:10,fontWeight:700,color,letterSpacing:.3}}>{label} · {list?.length||0}</span>
        <span style={{fontSize:10,color:"#9A9384"}}>{open?"▲":"▼"}</span>
      </button>
      {open&&((list||[]).length===0
        ? <div className="sans" style={{fontSize:10,color:"#A7A195",paddingBottom:4}}>None</div>
        : (list||[]).map(x=><div key={x.id} className="sans" style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,padding:"6px 0",borderBottom:"1px solid #F5F1E8"}}>
            <span><b>{x.name}</b>{x.member_code?` · ${x.member_code}`:""}</span>
            <span style={{color:"#9A9384",textAlign:"right"}}>
              {x.responded_at?formatLocalDateTime(x.responded_at):x.telegram_id?"Telegram linked":"Not linked"}
            </span>
          </div>))}
    </div>
  };

  return <>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div>
        <div className="sans" style={{fontSize:15,fontWeight:700,color:"#1F3D2B"}}>Meetings</div>
        <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:2}}>Invitations, RSVP and meeting schedule</div>
      </div>
      <button onClick={()=>{setForm(emptyForm);setShowCreate(true)}} style={{...approveBtn,padding:"9px 12px"}}>+ New meeting</button>
    </div>

    {message&&<div className="sans" style={{fontSize:11,padding:10,borderRadius:9,background:"#EAF1EE",color:"#1F3D2B",marginBottom:12}}>{message}</div>}

    {rows===null?<Center>Loading…</Center>:rows.length===0
      ?<div className="sans" style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:18,color:"#8A9086",fontSize:12}}>No meetings created yet.</div>
      :rows.map(m=>{
        const answered=Number(m.going||0)+Number(m.maybe||0)+Number(m.declined||0);
        const status=meetingLifecycle(m);
        return <div key={m.id} style={{background:"#fff",border:`1px solid ${status.label==="Cancelled"?"#EFD5CF":"#E9E4D8"}`,borderRadius:12,padding:14,marginBottom:10,opacity:status.label==="Cancelled"?.78:1}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:700,fontSize:15}}>{m.title}</div>
              <div className="sans" style={{fontSize:11,color:"#8A9086",marginTop:4}}>{fmtMeetingDateTime(m.meeting_date,m.meeting_time)}{m.venue?` · ${m.venue}`:""}</div>
            </div>
            <span className="sans" style={{fontSize:10,padding:"5px 8px",height:"fit-content",borderRadius:99,background:status.bg,color:status.color}}>{status.label}</span>
          </div>
          <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:12,textAlign:"center"}}>
            <div><b>{m.going||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Going</div></div>
            <div><b>{m.maybe||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Maybe</div></div>
            <div><b>{m.declined||0}</b><div style={{fontSize:9,color:"#8A9086"}}>Declined</div></div>
            <div><b>{answered}</b><div style={{fontSize:9,color:"#8A9086"}}>Responded</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:status.label==="Cancelled"?"1fr":"1fr 1fr",gap:7,marginTop:12}}>
            <button onClick={()=>openDetails(m)} style={{...compactBtn,width:"100%",padding:"9px 10px"}}>View details</button>
            {status.label!=="Cancelled"&&<button disabled={busy} onClick={()=>send(m)} style={{...approveBtn,width:"100%",padding:"9px 10px",opacity:busy?.6:1}}>{m.sent_at?"Resend":"Send invite"}</button>}
          </div>
        </div>
      })}

    {showCreate&&<Modal title="New meeting" onClose={()=>!busy&&setShowCreate(false)}>
      <Field label="Meeting title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
      <Field label="Date" type="date" value={form.meeting_date} onChange={v=>setForm({...form,meeting_date:v})}/>
      <Field label="Time" type="time" value={form.meeting_time} onChange={v=>setForm({...form,meeting_time:v})}/>
      <Field label="Venue / location" value={form.venue} onChange={v=>setForm({...form,venue:v})}/>
      <label className="sans" style={{display:"block",fontSize:11,color:"#6B7268",marginBottom:10}}>
        <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
        <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
          style={{width:"100%",padding:"10px 11px",border:"1px solid #DED8CA",borderRadius:9,background:"#fff",fontSize:13,resize:"vertical"}}/>
      </label>
      <Field label="RSVP deadline (optional)" value={form.rsvp_deadline} onChange={v=>setForm({...form,rsvp_deadline:v})}/>
      <button disabled={busy} onClick={create} style={{...approveBtn,width:"100%",padding:"10px 12px",opacity:busy?.6:1}}>{busy?"Creating…":"Create meeting"}</button>
    </Modal>}

    {selected&&<Modal title={details?.title||selected.title} onClose={()=>!busy&&setSelected(null)}>
      {!details?<Center>Loading details…</Center>:editing?<>
        <Field label="Meeting title" value={form.title} onChange={v=>setForm({...form,title:v})}/>
        <Field label="Date" type="date" value={form.meeting_date} onChange={v=>setForm({...form,meeting_date:v})}/>
        <Field label="Time" type="time" value={form.meeting_time} onChange={v=>setForm({...form,meeting_time:v})}/>
        <Field label="Venue / location" value={form.venue} onChange={v=>setForm({...form,venue:v})}/>
        <label className="sans" style={{display:"block",fontSize:11,color:"#6B7268",marginBottom:10}}>
          <span style={{display:"block",marginBottom:5}}>Agenda / message</span>
          <textarea value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} rows={4}
            style={{width:"100%",padding:"10px 11px",border:"1px solid #DED8CA",borderRadius:9,background:"#fff",fontSize:13,resize:"vertical"}}/>
        </label>
        <Field label="RSVP deadline (optional)" value={form.rsvp_deadline} onChange={v=>setForm({...form,rsvp_deadline:v})}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button disabled={busy} onClick={()=>setEditing(false)} style={{...compactBtn,padding:10}}>Cancel edit</button>
          <button disabled={busy} onClick={saveEdit} style={{...approveBtn,padding:10}}>{busy?"Saving…":"Save changes"}</button>
        </div>
      </>:<>
        {(()=>{
          const status=meetingLifecycle(details);
          const yes=details.responses?.yes||[],maybe=details.responses?.maybe||[],no=details.responses?.no||[],pending=details.responses?.pending||[];
          const total=details.total_members||0;
          return <>
            <div style={{background:"#F7F5EF",borderRadius:11,padding:12}}>
              <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <span style={{color:"#8A9086"}}>Status</span>
                <span style={{fontWeight:700,color:status.color,background:status.bg,padding:"3px 7px",borderRadius:99}}>{status.label}</span>
              </div>
              <div className="sans" style={{fontSize:16,fontWeight:700,color:"#1F3D2B",marginTop:12}}>{fmtMeetingDateTime(details.meeting_date,details.meeting_time)}</div>
              <div className="sans" style={{fontSize:12,color:"#6B7268",marginTop:4}}>{details.venue||"Venue not specified"}</div>
              {details.rsvp_deadline&&<div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:6}}>RSVP by {details.rsvp_deadline}</div>}
            </div>

            <div className="sans" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:10,textAlign:"center",background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:"10px 6px"}}>
              <div><b style={{color:"#3A6B3E"}}>{yes.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Going</div></div>
              <div><b style={{color:"#7A5A18"}}>{maybe.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Maybe</div></div>
              <div><b style={{color:"#A6432F"}}>{no.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Declined</div></div>
              <div><b>{pending.length}</b><div style={{fontSize:9,color:"#8A9086"}}>Awaiting</div></div>
            </div>

            {(details.sent_at||details.last_notification_at)&&<div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:9,lineHeight:1.55}}>
              {details.sent_at&&<div>Invitation sent: {formatLocalDateTime(details.sent_at)}</div>}
              {details.last_notification_at&&<div>Last notification: {formatLocalDateTime(details.last_notification_at)}</div>}
            </div>}

            {details.agenda&&<>
              <div className="sans" style={{fontSize:10,fontWeight:700,color:"#6B7268",marginTop:14,marginBottom:5}}>AGENDA / MESSAGE</div>
              <div className="sans" style={{fontSize:12,lineHeight:1.5,background:"#fff",border:"1px solid #E9E4D8",borderRadius:10,padding:11}}>{details.agenda}</div>
            </>}

            {details.status==="cancelled"&&<div className="sans" style={{fontSize:11,lineHeight:1.45,background:"#FDEDE8",color:"#A6432F",padding:10,borderRadius:9,marginTop:12}}>
              <b>Cancelled</b>{details.cancelled_at?` · ${formatLocalDateTime(details.cancelled_at)}`:""}<br/>{details.cancel_reason||"Cancelled by admin"}
            </div>}

            <div className="sans" style={{fontSize:10,fontWeight:700,color:"#6B7268",marginTop:16}}>RSVP DETAILS · {total} ACTIVE MEMBERS</div>
            {group("yes","GOING",yes,"#3A6B3E")}
            {group("maybe","MAYBE",maybe,"#7A5A18")}
            {group("no","DECLINED",no,"#A6432F")}
            {group("pending","AWAITING RESPONSE",pending,"#6B7268")}

            {details.status!=="cancelled"&&<>
              {pending.length>0&&<button disabled={busy} onClick={remindPending} style={{...approveBtn,width:"100%",padding:10,marginTop:14}}>
                Remind awaiting members
              </button>}
              <button disabled={busy} onClick={beginEdit} style={{...compactBtn,width:"100%",padding:10,marginTop:8}}>Edit / reschedule</button>
              {details.sent_at&&<button disabled={busy} onClick={async()=>{
                setBusy(true);setMessage("");
                try{
                  setMessage("Edit the meeting first. Member notifications are offered automatically after a real change.");
                  return;
                  setDetails(await api.admin.meeting(details.id));await load();
                }catch(e){setMessage(e.message)}finally{setBusy(false)}
              }} style={{...compactBtn,width:"100%",padding:10,marginTop:8}}>Changes notify after saving</button>}
              <button disabled={busy} onClick={cancelMeeting} style={{...rejectBtn,width:"100%",padding:10,marginTop:8}}>Cancel meeting</button>
            </>}
          </>;
        })()}
      </>}
    </Modal>}
  </>
}

/* ---------- Settings (admin) ---------- */
function formatLocalDateTime(value) {
  if (!value) return "";
  const raw=String(value);
  const d=new Date(raw.includes("T") ? raw : raw.replace(" ","T")+"Z");
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("en", {timeZone:"Indian/Maldives",day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"}).format(d);
}

function Settings({ admin }) {
  const [settings,setSettings]=useState(null);
  const [admins,setAdmins]=useState([]);
  const [audit,setAudit]=useState([]);
  const [health,setHealth]=useState(null);
  const [closures,setClosures]=useState([]);
  const [errors,setErrors]=useState([]);
  const [message,setMessage]=useState("");
  const [settingsSection,setSettingsSection]=useState("general");
  const [categories,setCategories]=useState([]);
  const [membersForAdmin,setMembersForAdmin]=useState([]);
  const [promoteMemberId,setPromoteMemberId]=useState("");
  const [promoteRole,setPromoteRole]=useState("treasurer");

  const role = admin?.role === "owner" ? "super_admin" : admin?.role;
  const superAdmin = role === "super_admin";
  const financeAdmin = superAdmin || role === "treasurer";
  const currentMonth = currentMonthValue();

  const [settingsLoading,setSettingsLoading]=useState(true);
  const [settingsError,setSettingsError]=useState("");

  const load=async()=>{
    setSettingsLoading(true);
    setSettingsError("");
    try{
      // Settings itself is the only request required to render this page.
      // Load it first so a slow audit/health/admin request cannot leave the
      // entire Settings screen stuck behind a loading state.
      const core=await api.settings.get();
      setSettings(core || {});
    }catch(e){
      setSettingsError(e?.message || "Unable to load settings");
      setSettings({});
    }finally{
      setSettingsLoading(false);
    }

    // Secondary panels are independent and may fail without blocking Settings.
    const jobs=[
      api.settings.admins().then(setAdmins),
      api.expenses.categories().then(setCategories),
      api.admin.health().then(setHealth),
      api.admin.monthClosures().then(setClosures),
    ];
    if(financeAdmin) jobs.push(api.settings.auditLog().then(setAudit));
    if(superAdmin){
      jobs.push(api.members.list().then(setMembersForAdmin));
      jobs.push(api.admin.errors().then(setErrors));
    }
    await Promise.allSettled(jobs);
  };

  useEffect(()=>{ load(); },[admin?.id,role]);

  if(settingsLoading)return <Center>Loading settings…</Center>;
  if(settingsError && !Object.keys(settings||{}).length) return <div style={{...cardStyle,textAlign:"center"}}>
    <div className="sans" style={{fontSize:13,fontWeight:700,color:"#A6432F"}}>Settings could not load</div>
    <div className="sans" style={{fontSize:11,color:"#6B7268",marginTop:6}}>{settingsError}</div>
    <button onClick={load} className="sans" style={{
      marginTop:12,
      border:"none",
      borderRadius:9,
      padding:"9px 14px",
      background:"#1F3D2B",
      color:"#F7F5EF",
      fontSize:12,
      fontWeight:700,
      cursor:"pointer"
    }}>Retry</button>
  </div>;

  const saveSetting=async(key,value)=>{
    try{
      await api.settings.update({[key]:String(value)});
      setSettings({...settings,[key]:String(value)});
      setMessage("Changes saved");
      setTimeout(()=>setMessage(""),1800);
    }catch(e){ setMessage(e.message); }
  };

  const closeMonth=async()=>{
    const label = new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${currentMonth}-01T00:00:00Z`));
    if(!confirm(`Close ${label}?\n\nApproved financial records for this month will be locked until a Super Admin reopens it.`)) return;
    try{
      await api.admin.closeMonth(currentMonth,"Closed from Fund App");
      load();
      setMessage(`${label} closed`);
    }catch(e){setMessage(e.message)}
  };

  const backup=async()=>{
    try{
      const data=await api.admin.backup();
      const filename=`kys-fund-backup-${todayValue()}.json`;
      await sendExportToTelegram(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),filename,"Super Admin database backup");
      setMessage("Backup sent to your Telegram chat");
    }catch(e){setMessage(e.message)}
  };

  const monthClosed = closures.some(x=>x.month===currentMonth);
  const tabs=[["general","General"],["admins","Admins"],["system","System"],...(financeAdmin?[["audit","Audit"]]:[])];

  return <>
    {message && <div className="sans" style={{fontSize:12,background:"#EAF1EE",padding:9,borderRadius:9,marginBottom:12}}>{message}</div>}

    <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:16,paddingBottom:2}}>
      {tabs.map(([key,label])=>
        <button key={key} onClick={()=>setSettingsSection(key)} className="sans"
          style={{flex:"0 0 auto",border:`1px solid ${settingsSection===key?"#1F3D2B":"#E2DDD0"}`,background:settingsSection===key?"#1F3D2B":"#fff",color:settingsSection===key?"#F7F5EF":"#6B7268",borderRadius:20,padding:"7px 13px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
          {label}{key==="system" && errors.length>0 ? ` · ${errors.length}` : ""}
        </button>
      )}
    </div>

    {settingsSection==="general" && <>
      <SectionTitle>MEMBER CONTRIBUTIONS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:12,color:"#6B7268",marginBottom:5}}>Default monthly contribution</div>
        <div style={{display:"flex",alignItems:"center",border:"1px solid #D9D3C4",borderRadius:8,background:"#fff"}}>
          <span className="sans" style={{paddingLeft:11,fontSize:12,color:"#8A9086"}}>MVR</span>
          <input disabled={!superAdmin} type="number" value={settings.default_monthly_amount ?? ""} onChange={e=>setSettings({...settings,default_monthly_amount:e.target.value})} onBlur={e=>superAdmin&&saveSetting("default_monthly_amount",e.target.value)} className="sans" style={{flex:1,border:0,outline:"none",padding:"9px 11px",fontSize:14,background:"transparent"}}/>
        </div>
        <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:6}}>Used automatically for new members. Existing member amounts are not changed.</div>
      </div>

      <SectionTitle>EXPENSE CATEGORIES</SectionTitle>
      <div style={cardStyle}>
        {categories.map(cat=><div key={cat.id} className="sans" style={{display:"flex",alignItems:"center",gap:7,padding:"8px 0",borderBottom:"1px solid #F0EDE3",opacity:Number(cat.active)===0?.55:1}}>
          <span style={{flex:1,fontSize:12,fontWeight:600}}>{cat.name}{Number(cat.active)===0?" · Inactive":""}</span>
          {financeAdmin&&<><button style={compactBtn} onClick={async()=>{const name=prompt("Category name",cat.name);if(!name||name===cat.name)return;try{await api.expenses.updateCategory(cat.id,{name});load()}catch(e){setMessage(e.message)}}}>Edit</button>
          <button style={compactBtn} onClick={async()=>{try{await api.expenses.updateCategory(cat.id,{active:Number(cat.active)===0});load()}catch(e){setMessage(e.message)}}}>{Number(cat.active)===0?"Activate":"Deactivate"}</button>
          <button style={{...compactBtn,color:"#A6432F"}} onClick={async()=>{if(!confirm(`Delete ${cat.name}? If it has historical expenses it will be deactivated instead.`))return;try{await api.expenses.removeCategory(cat.id);load()}catch(e){setMessage(e.message)}}}>Delete</button></>}
        </div>)}
        {financeAdmin&&<button style={{...approveBtn,width:"100%",marginTop:10}} onClick={async()=>{const name=prompt("New expense category name");if(!name)return;try{await api.expenses.addCategory(name);load()}catch(e){setMessage(e.message)}}}>+ Add category</button>}
      </div>

      <SectionTitle>PAYMENT REMINDERS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#1F3D2B"}}>Automatic reminders</div>
            <div style={{fontSize:10,color:"#8A9086",marginTop:3}}>Telegram reminder to unpaid and partially paid members.</div>
          </div>
          <button disabled={!financeAdmin} onClick={()=>financeAdmin&&saveSetting("reminder_day",settings.reminder_day==="off"?"5":"off")}
            aria-label="Toggle automatic reminders"
            style={{width:42,height:24,border:0,borderRadius:999,padding:3,background:settings.reminder_day==="off"?"#D8D4C8":"#3A6B3E",cursor:"pointer"}}>
            <span style={{display:"block",width:18,height:18,borderRadius:999,background:"#fff",transform:settings.reminder_day==="off"?"translateX(0)":"translateX(18px)",transition:"transform .15s"}}/>
          </button>
        </div>

        {settings.reminder_day!=="off" && <>
          <div className="sans" style={{fontSize:11,color:"#6B7268",marginBottom:5}}>Send automatically on</div>
          <select disabled={!financeAdmin} value={settings.reminder_day || "5"} onChange={e=>financeAdmin&&saveSetting("reminder_day",e.target.value)}
            className="sans" style={{width:"100%",border:"1px solid #D9D3C4",borderRadius:9,padding:"10px 11px",fontSize:13,background:"#F7F5EF"}}>
            {Array.from({length:28},(_,i)=>String(i+1)).map(d=><option key={d} value={d}>Day {d} of each month</option>)}
          </select>
          <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:6}}>The daily scheduler checks at 12:00 AM Maldives time and sends only to members with an outstanding balance.</div>
        </>}

        {settings.reminder_day==="off" && <div className="sans" style={{fontSize:11,color:"#8A9086",background:"#F7F5EF",borderRadius:9,padding:10}}>Automatic reminders are off. Manual reminders are still available.</div>}

        {financeAdmin && <button onClick={async()=>{
          if(!confirm("Send payment reminders now to all members with an outstanding balance for the current month?")) return;
          try{
            setMessage("Sending reminders…");
            const r=await api.admin.sendPaymentReminders({month:currentMonth});
            setMessage(`Sent ${r.sent||0} payment reminder${Number(r.sent||0)===1?"":"s"}.`);
          }catch(e){setMessage(e.message)}
        }} style={{...approveBtn,width:"100%",marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Bell size={14}/> Send reminders now
        </button>}
      </div>

      <SectionTitle>FINANCIAL APPROVALS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:12,color:"#6B7268",marginBottom:4}}>Second-approval threshold</div>
        <div style={{display:"flex",alignItems:"center",border:"1px solid #D9D3C4",borderRadius:8,background:"#fff",overflow:"hidden"}}>
          <span className="sans" style={{padding:"0 0 0 11px",fontSize:12,color:"#8A9086"}}>MVR</span>
          <input type="number" value={settings.expense_approval_threshold ?? ""}
            onChange={e=>setSettings({...settings,expense_approval_threshold:e.target.value})}
            onBlur={e=>saveSetting("expense_approval_threshold",e.target.value)}
            className="sans" style={{flex:1,minWidth:0,border:0,outline:"none",padding:"9px 11px",fontSize:14,background:"transparent"}} />
        </div>
        <div className="sans" style={{fontSize:10,color:"#9A9384",marginTop:6}}>Expenses at or above this amount require a second finance admin.</div>
      </div>

      <SectionTitle>MONTH MANAGEMENT</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,marginBottom:10}}>
          <span style={{color:"#6B7268"}}>Current month</span>
          <b>{new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${currentMonth}-01T00:00:00Z`))}</b>
        </div>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12}}>
          <span style={{color:"#6B7268"}}>Status</span>
          <span style={{fontWeight:700,color:monthClosed?"#A6432F":"#3A6B3E"}}>{monthClosed?"Closed":"Open"}</span>
        </div>
        {superAdmin && !monthClosed && <button onClick={closeMonth} style={{...rejectBtn,marginTop:12}}>Close current month</button>}
        {superAdmin && monthClosed && <button onClick={()=>api.admin.reopenMonth(currentMonth).then(load).catch(e=>setMessage(e.message))} style={{...approveBtn,marginTop:12}}>Reopen current month</button>}
      </div>

      {closures.length>0 && <>
        <SectionTitle>CLOSED MONTHS</SectionTitle>
        <div style={cardStyle}>
          {closures.slice(0,6).map(x=>
            <div key={x.month} className="sans" style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11,padding:"7px 0",borderBottom:"1px solid #F0EDE3"}}>
              <span><b>{x.month}</b><div style={{color:"#9A9384",marginTop:2}}>by {x.closed_by_name || "admin"}</div></span>
              {superAdmin&&<button onClick={()=>api.admin.reopenMonth(x.month).then(load).catch(e=>setMessage(e.message))} style={compactBtn}>Reopen</button>}
            </div>
          )}
        </div>
      </>}
    </>}

    {settingsSection==="admins" && <>
      <SectionTitle>ADMINS & ROLES</SectionTitle>
      {superAdmin&&<div style={{...cardStyle,marginBottom:12}}>
        <div className="sans" style={{fontSize:13,fontWeight:700,color:"#1F3D2B",marginBottom:4}}>Promote existing member</div>
        <div className="sans" style={{fontSize:10,color:"#8A9086",marginBottom:9}}>The member keeps their member account and contribution obligations. Telegram must be linked.</div>
        <select value={promoteMemberId} onChange={e=>setPromoteMemberId(e.target.value)} style={{width:"100%",border:"1px solid #D9D3C4",borderRadius:8,padding:9,background:"#fff",marginBottom:8}}>
          <option value="">Select member…</option>{membersForAdmin.filter(m=>m.active!==0).map(m=><option key={m.id} value={m.id}>{m.name} · {m.member_code}{m.telegram_id?"":" · Telegram not linked"}</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <select value={promoteRole} onChange={e=>setPromoteRole(e.target.value)} style={{flex:1,border:"1px solid #D9D3C4",borderRadius:8,padding:9,background:"#fff"}}><option value="super_admin">Super Admin</option><option value="treasurer">Treasurer</option><option value="viewer">Viewer</option></select>
          <button disabled={!promoteMemberId} style={approveBtn} onClick={async()=>{const m=membersForAdmin.find(x=>String(x.id)===String(promoteMemberId));if(!confirm(`Promote ${m?.name||"this member"} to ${promoteRole.replace("_"," ")}?`))return;try{await api.settings.promoteMember(Number(promoteMemberId),promoteRole);setPromoteMemberId("");setMessage("Member promoted");load()}catch(e){setMessage(e.message)}}}>Promote</button>
        </div>
      </div>}
      <div style={cardStyle}>
        {admins.map(a=>{
          const displayRole=a.role==="owner"?"super_admin":a.role;
          const roleLabel=displayRole==="super_admin"?"Super Admin":displayRole==="treasurer"?"Treasurer":"Viewer";
          return <div key={a.id} className="sans" style={{padding:"10px 0",borderBottom:"1px solid #F0EDE3"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600}}>{a.member_name || a.name}</div>
                <div style={{fontSize:10,color:a.active===0?"#A6432F":"#3A6B3E",marginTop:2}}>
                  {a.active===0?"Admin access inactive":"Admin access active"}
                  {a.member_code ? ` · ${a.member_code} · Member + Admin` : ""}
                </div>
              </div>
              {superAdmin
                ? <select disabled={a.active===0} value={displayRole} onChange={e=>{
                    if(!confirm(`Change ${a.name}'s role to ${e.target.options[e.target.selectedIndex].text}?`)) return;
                    api.settings.updateAdmin(a.id,{role:e.target.value}).then(load).catch(err=>setMessage(err.message));
                  }} style={{border:"1px solid #D9D3C4",borderRadius:8,padding:"6px 7px",background:"#F7F5EF",fontSize:11,opacity:a.active===0?.55:1}}>
                    <option value="super_admin">Super Admin</option>
                    <option value="treasurer">Treasurer</option>
                    <option value="viewer">Viewer</option>
                  </select>
                : <span style={{fontSize:11,fontWeight:600}}>{roleLabel}</span>}
            </div>
            {superAdmin && a.member_id && a.active!==0 && Number(a.id)!==Number(admin?.id) &&
              <button
                onClick={async()=>{
                  if(!confirm(`Demote ${a.member_name || a.name} to normal member?\n\nThey will lose admin access immediately. Their member account, Telegram link, contribution history and payment obligations will remain unchanged.`)) return;
                  try{
                    await api.settings.demoteMember(a.id);
                    setMessage(`${a.member_name || a.name} demoted to member`);
                    load();
                  }catch(e){setMessage(e.message)}
                }}
                style={{...rejectBtn,width:"100%",marginTop:8,padding:"8px 10px"}}
              >
                Demote to member
              </button>}
          </div>
        })}
        <div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:9,lineHeight:1.45}}>Super Admin: full control · Treasurer: financial operations · Viewer: read-only. Promoted members remain normal contributing members; demotion removes only admin access.</div>
      </div>
    </>}

    {settingsSection==="system" && <>
      <SectionTitle>SYSTEM STATUS</SectionTitle>
      <div style={cardStyle}>
        {health ? <div className="sans" style={{fontSize:12}}>
          {[
            ["Database",health.db?.ok,"Online","Error"],
            ["Telegram",health.telegram?.ok,health.telegram?.username?`@${health.telegram.username}`:"Connected","Error"],
            ["Webhook",health.webhook?.ok && !!health.webhook?.url,"Active","Check"],
            ["AI / OCR",health.ai?.ok,"Available","Missing"],
          ].map(([label,ok,yes,no])=>
            <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #F0EDE3"}}>
              <span style={{color:"#6B7268"}}>{label}</span>
              <b style={{color:ok?"#3A6B3E":"#A6432F"}}>{ok?"● ":"● "}{ok?yes:no}</b>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}>
            <span style={{color:"#6B7268"}}>Reminder check</span>
            <b>{health.reminder_schedule ? "Daily" : "Not set"}</b>
          </div>
        </div> : <div className="sans" style={{fontSize:12,color:"#8A9086"}}>Checking…</div>}
        <button onClick={()=>api.admin.health().then(setHealth).catch(e=>setMessage(e.message))} style={{...compactBtn,marginTop:8}}>Refresh status</button>
      </div>

      {superAdmin && <>
        <SectionTitle>DATABASE BACKUP</SectionTitle>
        <div style={cardStyle}>
          <div className="sans" style={{fontSize:11,color:"#6B7268",marginBottom:10}}>Create a JSON backup before important schema or financial data changes.</div>
          <button onClick={backup} style={approveBtn}>Create backup</button>
        </div>

        <SectionTitle>RECENT ERRORS {errors.length>0?`· ${errors.length}`:""}</SectionTitle>
        <div style={cardStyle}>
          {errors.some(e=>e.status!=="resolved")&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
            <button onClick={async()=>{
              if(!confirm("Mark all open errors as resolved? Error history will be retained.")) return;
              try{
                await api.admin.resolveAllErrors();
                setErrors(await api.admin.errors());
                setMessage("Open errors marked resolved");
              }catch(e){setMessage(e.message)}
            }} style={compactBtn}>Resolve all open</button>
          </div>}
          {errors.slice(0,30).map(e=><div key={e.id} className="sans" style={{padding:"8px 0",borderBottom:"1px solid #F0EDE3",fontSize:11,opacity:e.status==="resolved"?.62:1}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
              <b>{e.source}</b>
              <span style={{fontSize:9,fontWeight:700,color:e.status==="resolved"?"#6B7268":"#A6432F"}}>{e.status==="resolved"?"RESOLVED":"OPEN"}</span>
            </div>
            <div style={{color:"#6B7268",marginTop:2}}>{e.message}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:3}}>
              <span style={{color:"#B5AE9C"}}>{formatLocalDateTime(e.created_at)}</span>
              {e.status!=="resolved"&&<button onClick={async()=>{try{await api.admin.resolveError(e.id);setErrors(await api.admin.errors())}catch(err){setMessage(err.message)}}} style={{...compactBtn,padding:"4px 7px",fontSize:9}}>Resolve</button>}
            </div>
          </div>)}
          {!errors.length&&<EmptyLine>No logged errors.</EmptyLine>}
        </div>
      </>}
    </>}

    {settingsSection==="audit" && <>
      <SectionTitle>AUDIT LOG</SectionTitle>
      <div style={cardStyle}>
        {audit.slice(0,100).map(a=><AuditEntry key={a.id} a={a}/>)}
        {!audit.length&&<EmptyLine>No audit entries.</EmptyLine>}
      </div>
    </>}
  </>;
}

/* ---------- Shared UI bits ---------- */

function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="sans"
      style={{ width: "100%", background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {children}
    </button>
  );
}
