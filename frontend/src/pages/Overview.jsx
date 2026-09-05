import React, { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { api, onDataChangeDebounced } from "../api";
import { currentMonthValue } from "../utils/date";
import { fmt } from "../utils/format";
import { LoadingState } from "../components/Shared";
import { ActivityRow } from "../components/ActivityRow";

export default function Overview({ isAdmin, canFinance, setTab, bootstrapSummary = null, member = null, adminMonth = null }) {
  const [summary, setSummary] = useState(bootstrapSummary);
  const [activity, setActivity] = useState([]);
  const [pendingCount, setPendingCount] = useState(null);
  const [memberStatus, setMemberStatus] = useState(null);
  const [memberStatusLoading, setMemberStatusLoading] = useState(false);
  const [memberElection, setMemberElection] = useState(null);

  useEffect(() => {
    if (!bootstrapSummary) return;
    setSummary((current) => current || bootstrapSummary);
    setActivity((current) => current.length ? current : normalizeRecentActivity(bootstrapSummary.recentActivity));
  }, [bootstrapSummary]);

  const refreshOverview = () => {
    const summaryRequest = isAdmin ? api.reports.summary(adminMonth || undefined) : api.reports.publicSummary();
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
  };

  useEffect(() => {
    if (isAdmin) {
      const path=adminMonth ? `/api/reports/summary?month=${adminMonth}` : "/api/reports/summary";
      setSummary(api.peekCached(path) || null);
    }
    refreshOverview();
  }, [isAdmin, canFinance, adminMonth]);

  useEffect(() => onDataChangeDebounced(({paths=[]}) => {
    const relevant=paths.some((path)=>
      path?.startsWith("/api/contributions") ||
      path?.startsWith("/api/donations") ||
      path?.startsWith("/api/expenses") ||
      path?.startsWith("/api/members") ||
      path?.startsWith("/api/projects")
    );
    if(relevant)refreshOverview();
  },140), [isAdmin, canFinance, adminMonth]);

  const refreshMemberStatus = () => {
    if (isAdmin || !member?.id) return;
    setMemberStatusLoading(true);
    api.members.statement(member.id)
      .then((statement) => {
        const statuses = statement?.monthly_status || [];
        const month = currentMonthValue();
        const current = statuses.find((row) => row.month === month) || statuses[statuses.length - 1] || null;
        setMemberStatus(current);
      })
      .catch(() => setMemberStatus(null))
      .finally(() => setMemberStatusLoading(false));
  };

  useEffect(() => {
    refreshMemberStatus();
  }, [isAdmin, member?.id]);

  useEffect(() => onDataChangeDebounced(({paths=[]}) => {
    if(paths.some((path)=>path?.startsWith("/api/contributions")||path?.startsWith("/api/members")))refreshMemberStatus();
  },140), [isAdmin, member?.id]);

  const refreshMemberElection = () => {
    if (isAdmin || !member?.id) { setMemberElection(null); return; }
    api.elections.list().then((rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const priority = list.find((e) => e.status === "open" && e.eligible && !e.my_vote)
        || list.find((e) => e.status === "draft" && e.application_phase === "open")
        || list.find((e) => Number(e.open_runoffs || 0) > 0)
        || null;
      setMemberElection(priority);
    }).catch(() => setMemberElection(null));
  };

  useEffect(() => { refreshMemberElection(); }, [isAdmin, member?.id]);
  useEffect(() => onDataChangeDebounced(({paths=[]}) => {
    if(paths.some((path)=>path?.startsWith("/api/elections")))refreshMemberElection();
  },120), [isAdmin, member?.id]);

  if (!summary) return <OverviewSkeleton memberView={!isAdmin} />;

  const contributions = Number(summary.memberIncome || 0);
  const allocatedContributions = Number(summary.allocatedContributions ?? summary.memberIncome ?? 0);
  const donations = Number(summary.donationIncome || 0);
  const expenses = Number(summary.expenses || 0);
  const netMonth = contributions + donations - expenses;
  const outstandingTotal = Number(summary.outstanding?.total || 0);
  const outstandingMembers = isAdmin
    ? (summary.outstanding?.members || []).length
    : Number(summary.collection?.outstanding_members || 0);
  const collectedForProgress = isAdmin
    ? allocatedContributions
    : Number(summary.collection?.collected ?? allocatedContributions ?? 0);
  const expected = isAdmin
    ? allocatedContributions + outstandingTotal
    : Number(summary.collection?.expected ?? collectedForProgress ?? 0);
  const collectionPct = expected > 0 ? Math.min(100, Math.round((collectedForProgress / expected) * 100)) : 0;
  const overviewMonth = summary.month || currentMonthValue();
  const monthLabel = (() => {
    try {
      const [y, m] = overviewMonth.split("-").map(Number);
      return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
    } catch {
      return overviewMonth;
    }
  })();

  const memberPaid = Number(memberStatus?.paid || 0);
  const memberDue = Number(memberStatus?.due || 0);
  const memberRate = Number(memberStatus?.required_amount ?? memberStatus?.monthly_amount ?? member?.monthly_amount ?? 0);
  const memberState = String(memberStatus?.status || "unpaid").toLowerCase();
  const memberStateLabel = memberState === "paid" ? "Paid" : memberState === "partial" ? "Partial" : memberState === "exempt" ? "Exempt" : memberState === "not_applicable" ? "Not due" : "Unpaid";
  const memberStateColor = memberState === "paid" ? "var(--success)" : memberState === "partial" ? "var(--warning)" : memberState === "exempt" || memberState === "not_applicable" ? "var(--muted)" : "var(--danger)";

  return (
    <>
      {!isAdmin && (
        <button type="button" onClick={() => setTab?.("history")} className="member-contribution-hero" aria-label="Open my contribution history">
          {memberStatusLoading && !memberStatus ? (
            <div className="member-contribution-hero-loading">
              <span className="skeleton-block" style={{width:"42%",height:12}} />
              <span className="skeleton-block" style={{width:"58%",height:30,marginTop:10}} />
              <span className="skeleton-block" style={{width:"70%",height:11,marginTop:10}} />
            </div>
          ) : (
            <>
              <div className="sans member-contribution-hero-top">
                <span>MY CONTRIBUTION · {monthLabel.toUpperCase()}</span>
                <strong style={{color:memberStateColor}}>{memberState === "paid" ? "✓ " : ""}{memberStateLabel}</strong>
              </div>
              <div className="member-contribution-hero-amount">MVR {fmt(memberPaid)} <span>/ {fmt(memberRate)}</span></div>
              <div className="sans member-contribution-hero-bottom">
                <span>{memberState === "exempt" || memberState === "not_applicable" ? "No contribution due this month" : memberDue > 0 ? `MVR ${fmt(memberDue)} outstanding` : "Contribution complete for this month"}</span>
                <strong>View history ›</strong>
              </div>
            </>
          )}
        </button>
      )}

      {!isAdmin && memberElection && (
        <MemberElectionOverviewCard election={memberElection} onOpen={() => setTab?.("elections")} />
      )}

      <div className={`theme-brand-surface${!isAdmin ? " member-fund-card" : ""}`} style={{ background: "var(--primary)", borderRadius: 16, padding: !isAdmin ? "17px 19px" : "23px 22px", color: "var(--on-primary)", marginTop: !isAdmin ? 10 : 0 }}>
        <div className="sans" style={{ fontSize: 11, opacity: 0.62, letterSpacing: 1.1 }}>{isAdmin ? "FUND BALANCE" : "TOTAL FUND BALANCE"}</div>
        <div style={{ fontSize: isAdmin ? 39 : 30, fontWeight: 600, marginTop: 4 }}>MVR {fmt(summary.fundBalance)}</div>
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
          <span><b style={{ color: "var(--primary-text)" }}>MVR {fmt(collectedForProgress)}</b> <span style={{ color: "var(--soft-2)" }}>/ MVR {fmt(expected)}</span></span>
          <b style={{ color: "var(--success)" }}>{collectionPct}% collected</b>
        </div>
        <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${collectionPct}%`, height: "100%", background: "var(--success)", borderRadius: 999 }} />
        </div>
      </div>

      {isAdmin && outstandingTotal > 0 && (
        <button type="button" onClick={() => setTab("members")}
          style={{ width: "100%", background: "var(--danger-bg-3)", border: "1px solid var(--danger-border)", borderRadius: 12, padding: "12px 14px", marginTop: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--danger)" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            MVR {fmt(outstandingTotal)} · {outstandingMembers} {outstandingMembers === 1 ? "member" : "members"} ›
          </span>
        </button>
      )}

      {isAdmin && pendingCount !== null && (
        <button type="button" onClick={() => setTab("pending")}
          style={{ width: "100%", background: pendingCount > 0 ? "var(--warning-bg-2)" : "var(--surface-success-soft)", border: `1px solid ${pendingCount > 0 ? "var(--warning-border-2)" : "var(--success-border-2)"}`, borderRadius: 12, padding: "12px 14px", marginTop: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", color: pendingCount > 0 ? "var(--warning)" : "var(--success)" }}>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Pending approvals</span>
          <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>
            {pendingCount > 0 ? `${pendingCount} waiting ›` : "✓ None waiting"}
          </span>
        </button>
      )}

      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, letterSpacing: .5 }}>RECENT ACTIVITY</span>
        {activity.length > 0 && <button type="button" onClick={() => setTab("activity")} style={{ border: 0, background: "transparent", padding: 0, color: "var(--success)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>View all →</button>}
      </div>
      {activity.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
      {activity.length === 0 && <div className="sans" style={{ fontSize: 12, color: "var(--soft)" }}>No activity yet.</div>}
    </>
  );
}

function MemberElectionOverviewCard({ election, onOpen }) {
  const deadline = election.status === "draft" ? election.applications_close_at : election.closes_at;
  const deadlineLabel = (() => {
    if (!deadline) return "Open Elections for details";
    try {
      const d = new Date(String(deadline).includes("T") ? deadline : String(deadline).replace(" ", "T"));
      return new Intl.DateTimeFormat("en", { day:"numeric", month:"short", hour:"numeric", minute:"2-digit" }).format(d);
    } catch { return String(deadline).replace("T", " ").slice(0,16); }
  })();

  let label = "EXCO ELECTION", title = "Applications Open", action = "Apply now";
  let note = `Applications close ${deadlineLabel}`;
  if (Number(election.open_runoffs || 0) > 0) {
    title = "Runoff Open"; action = "Vote now"; note = `Runoff voting is open · ${deadlineLabel}`;
  } else if (election.status === "open") {
    title = election.my_vote ? "Vote Submitted" : "Voting Open";
    action = election.my_vote ? "View election" : "Vote now";
    note = election.my_vote ? "Your secret ballot has been submitted" : `Voting closes ${deadlineLabel}`;
  } else if (election.my_application_status === "pending") {
    title = "Application Pending"; action = "View application"; note = `Admin review pending · closes ${deadlineLabel}`;
  } else if (election.my_application_status === "approved") {
    title = "Candidate Approved"; action = "View election"; note = "Your candidate application has been approved";
  }

  return <button type="button" className="member-overview-election" onClick={onOpen} aria-label={`${title}: ${election.title}`}>
    <div className="member-overview-election-main">
      <span className="sans member-overview-election-label">{label}</span>
      <div className="member-overview-election-title">{title}</div>
      <div className="sans member-overview-election-name">{election.title}</div>
      <div className="sans member-overview-election-note">{note}</div>
    </div>
    <div className="sans member-overview-election-action">
      <span>{action}</span><strong>›</strong>
    </div>
  </button>;
}

function normalizeRecentActivity(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 4).map((row, index) => ({
    ...row,
    id: row.id ?? `recent-${index}`,
    who: row.who ?? row.label ?? "Fund activity",
    at: row.at ?? row.event_at ?? null,
  }));
}

function OverviewSkeleton({ memberView = false }) {
  return (
    <div className="member-overview-skeleton" aria-label="Loading overview" aria-busy="true">
      {memberView && <div className="skeleton-block" style={{height:118,borderRadius:16,marginBottom:10}} />}
      <div className="skeleton-block" style={{height:memberView?92:128,borderRadius:16,marginBottom:12}} />
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div className="skeleton-block" style={{height:88,borderRadius:13}} />
        <div className="skeleton-block" style={{height:88,borderRadius:13}} />
      </div>
      <div className="skeleton-block" style={{height:52,borderRadius:13,marginTop:10}} />
    </div>
  );
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

