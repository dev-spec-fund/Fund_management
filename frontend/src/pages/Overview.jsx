import React, { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { api } from "../api";
import { currentMonthValue } from "../utils/date";
import { fmt } from "../utils/format";
import { Center } from "../components/Shared";
import { ActivityRow } from "../components/ActivityRow";

export default function Overview({ isAdmin, canFinance, setTab, bootstrapSummary = null }) {
  const [summary, setSummary] = useState(bootstrapSummary);
  const [activity, setActivity] = useState([]);
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    if (!bootstrapSummary) return;
    setSummary((current) => current || bootstrapSummary);
    setActivity((current) => current.length ? current : normalizeRecentActivity(bootstrapSummary.recentActivity));
  }, [bootstrapSummary]);

  useEffect(() => {
    const summaryRequest = isAdmin ? api.reports.summary() : api.reports.publicSummary();
    summaryRequest.then((data) => {
      setSummary(data);
      setActivity(normalizeRecentActivity(data?.recentActivity));
    }).catch(() => {});
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
      <div className="theme-brand-surface" style={{ background: "var(--primary)", borderRadius: 16, padding: "23px 22px", color: "var(--on-primary)" }}>
        <div className="sans" style={{ fontSize: 11, opacity: 0.62, letterSpacing: 1.1 }}>FUND BALANCE</div>
        <div style={{ fontSize: 39, fontWeight: 600, marginTop: 4 }}>MVR {fmt(summary.fundBalance)}</div>
        <div className="sans" style={{ fontSize: 11, opacity: 0.7, marginTop: 5 }}>
          {netMonth >= 0 ? "+" : "−"} MVR {fmt(Math.abs(netMonth))} this month
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <StatCard icon={<ArrowUpRight size={15} color="var(--success)" />} label="Contributions" value={`MVR ${fmt(contributions)}`} />
        <StatCard icon={<ArrowDownRight size={15} color="var(--danger)" />} label="Expenses this month" value={`MVR ${fmt(expenses)}`} />
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 14px", marginTop: 10 }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>Donations this month</span>
          <strong style={{ color: "var(--success)" }}>+ MVR {fmt(donations)}</strong>
        </div>
      </div>

      <div className="sans" style={{ fontSize: 11, color: "var(--muted)", marginTop: 18, marginBottom: 7, fontWeight: 700, letterSpacing: .5 }}>MONTHLY COLLECTION · {monthLabel.toUpperCase()}</div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 13, padding: "13px 14px" }}>
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12 }}>
          <span><b style={{ color: "var(--primary)" }}>MVR {fmt(allocatedContributions)}</b> <span style={{ color: "var(--soft-2)" }}>/ MVR {fmt(expected)}</span></span>
          <b style={{ color: "var(--success)" }}>{collectionPct}% collected</b>
        </div>
        <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${collectionPct}%`, height: "100%", background: "var(--success)", borderRadius: 999 }} />
        </div>
      </div>

      {isAdmin && outstandingTotal > 0 && (
        <button onClick={() => setTab("members")}
          style={{ width: "100%", background: "var(--danger-bg-3)", border: "1px solid var(--danger-border)", borderRadius: 12, padding: "12px 14px", marginTop: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--danger)" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            MVR {fmt(outstandingTotal)} · {outstandingMembers} {outstandingMembers === 1 ? "member" : "members"} ›
          </span>
        </button>
      )}

      {isAdmin && pendingCount !== null && (
        <button onClick={() => setTab("pending")}
          style={{ width: "100%", background: pendingCount > 0 ? "var(--warning-bg-2)" : "var(--surface-success-soft)", border: `1px solid ${pendingCount > 0 ? "var(--warning-border-2)" : "var(--success-border-2)"}`, borderRadius: 12, padding: "12px 14px", marginTop: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: pendingCount > 0 ? "var(--warning)" : "var(--success)" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Pending approvals</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            {pendingCount > 0 ? `${pendingCount} waiting ›` : "✓ None waiting"}
          </span>
        </button>
      )}

      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, letterSpacing: .5 }}>RECENT ACTIVITY</span>
        {activity.length > 0 && <button onClick={() => setTab("activity")} style={{ border: 0, background: "transparent", padding: 0, color: "var(--success)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>View all →</button>}
      </div>
      {activity.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
      {activity.length === 0 && <div className="sans" style={{ fontSize: 12, color: "var(--soft)" }}>No activity yet.</div>}
    </>
  );
}

function normalizeRecentActivity(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 4).map((row, index) => ({
    ...row,
    id: row.id ?? `recent-${index}`,
    who: row.who ?? row.label ?? "Fund activity",
    at: row.at ?? row.event_at ?? null,
  }));
}

function StatCard({ icon, label, value }) {
  return (
    <div style={{ background: "var(--card)", borderRadius: 14, padding: 16, border: "1px solid var(--border)" }}>
      {icon}
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

