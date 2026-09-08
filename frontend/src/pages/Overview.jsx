import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheckBig,
  Clock3,
  HeartHandshake,
  Landmark,
  ReceiptText,
  Users,
  WalletCards,
} from "lucide-react";
import { api, onDataChangeDebounced } from "../api";
import { currentMonthValue } from "../utils/date";
import { fmt } from "../utils/format";
import { ActivityRow } from "../components/ActivityRow";

export default function Overview({ isAdmin, canFinance, canReports = true, setTab, bootstrapSummary = null, member = null, adminMonth = null, branding = null }) {
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
    if (!isAdmin || canReports) {
      const summaryRequest = isAdmin ? api.reports.overview(adminMonth || undefined) : api.reports.publicSummary();
      summaryRequest.then((data) => {
        setSummary(data);
        setActivity(normalizeRecentActivity(data?.recentActivity));
      }).catch(() => {});
    }
    if (canFinance) {
      api.admin.pendingCounts()
        .then((p) => setPendingCount(Number(p?.total || 0)))
        .catch(() => setPendingCount(null));
    }
  };

  useEffect(() => {
    if (isAdmin) {
      if (canReports) {
        const path = adminMonth ? `/api/reports/overview?month=${adminMonth}` : "/api/reports/overview";
        setSummary(api.peekCached(path) || null);
      } else {
        setSummary(null);
      }
    }
    refreshOverview();
  }, [isAdmin, canFinance, canReports, adminMonth]);

  useEffect(() => onDataChangeDebounced(({ paths = [] }) => {
    const relevant = paths.some((path) =>
      path?.startsWith("/api/contributions") ||
      path?.startsWith("/api/donations") ||
      path?.startsWith("/api/expenses") ||
      path?.startsWith("/api/members") ||
      path?.startsWith("/api/projects")
    );
    if (relevant) refreshOverview();
  }, 140), [isAdmin, canFinance, canReports, adminMonth]);

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

  useEffect(() => onDataChangeDebounced(({ paths = [] }) => {
    if (paths.some((path) => path?.startsWith("/api/contributions") || path?.startsWith("/api/members"))) refreshMemberStatus();
  }, 140), [isAdmin, member?.id]);

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
  useEffect(() => onDataChangeDebounced(({ paths = [] }) => {
    if (paths.some((path) => path?.startsWith("/api/elections"))) refreshMemberElection();
  }, 120), [isAdmin, member?.id]);

  if (isAdmin && !canReports) return <section className="sans" style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:16,margin:"6px 0 14px"}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:.7,color:"var(--soft)",marginBottom:6}}>OVERVIEW</div>
    <div style={{fontSize:17,fontWeight:800,color:"var(--text)",marginBottom:5}}>Role-based access</div>
    <div style={{fontSize:11,lineHeight:1.5,color:"var(--muted)"}}>Financial dashboard figures are hidden for this role. Use the available navigation sections for the areas you are allowed to manage.</div>
    {canFinance&&pendingCount!==null&&<button type="button" onClick={()=>setTab?.("pending")} style={{marginTop:12,width:"100%",border:"1px solid var(--warning-border)",background:"var(--warning-bg)",color:"var(--warning)",borderRadius:10,padding:"10px 12px",fontSize:11,fontWeight:700}}>Pending approvals · {pendingCount}</button>}
  </section>;

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
  const monthLabel = formatMonthLabel(overviewMonth);

  const memberPaid = Number(memberStatus?.paid || 0);
  const memberDue = Number(memberStatus?.due || 0);
  const memberRate = Number(memberStatus?.required_amount ?? memberStatus?.monthly_amount ?? member?.monthly_amount ?? 0);
  const memberState = String(memberStatus?.status || "unpaid").toLowerCase();
  const memberStateLabel = memberState === "paid" ? "Paid" : memberState === "partial" ? "Partial" : memberState === "exempt" ? "Exempt" : memberState === "not_applicable" ? "Not due" : "Unpaid";
  const memberStatusTone = memberState === "paid" ? "success" : memberState === "partial" ? "warning" : memberState === "exempt" || memberState === "not_applicable" ? "neutral" : "danger";
  const firstName = String(member?.name || "").trim().split(/\s+/)[0] || "Member";

  return (
    <div className={`overview-page${isAdmin ? " overview-page--admin" : " overview-page--member"}`}>
      <header className="overview-page-head">
        <div>
          <div className="sans overview-eyebrow">{isAdmin ? "ADMIN OVERVIEW" : (branding?.short_name || "FUND")}</div>
          <h1 className="overview-page-title">{isAdmin ? "Fund overview" : `Welcome, ${firstName}`}</h1>
          <p className="sans overview-page-subtitle">{isAdmin ? `${monthLabel} performance and items needing attention.` : "Your contribution, fund position and community updates in one place."}</p>
        </div>
      </header>

      {!isAdmin && (
        <button type="button" onClick={() => setTab?.("history")} className={`member-home-contribution tone-${memberStatusTone}`} aria-label="Open my contribution history">
          {memberStatusLoading && !memberStatus ? (
            <div className="member-contribution-hero-loading">
              <span className="skeleton-block" style={{ width: "42%", height: 12 }} />
              <span className="skeleton-block" style={{ width: "58%", height: 30, marginTop: 10 }} />
              <span className="skeleton-block" style={{ width: "70%", height: 11, marginTop: 10 }} />
            </div>
          ) : (
            <>
              <div className="member-home-contribution-head">
                <div className="member-home-contribution-icon"><WalletCards size={20} aria-hidden="true" /></div>
                <div className="member-home-contribution-heading">
                  <span className="sans">MY CONTRIBUTION · {monthLabel.toUpperCase()}</span>
                  <strong>{memberStateLabel}</strong>
                </div>
                <ChevronRight size={19} className="member-home-chevron" aria-hidden="true" />
              </div>
              <div className="member-home-contribution-amount">MVR {fmt(memberPaid)} <span>/ {fmt(memberRate)}</span></div>
              <div className="sans member-home-contribution-note">
                {memberState === "exempt" || memberState === "not_applicable"
                  ? "No contribution due this month"
                  : memberDue > 0
                    ? `MVR ${fmt(memberDue)} outstanding`
                    : "Contribution complete for this month"}
              </div>
            </>
          )}
        </button>
      )}

      <section className="overview-balance-card theme-brand-surface">
        <div className="overview-balance-top">
          <div>
            <div className="sans overview-balance-label">{isAdmin ? "TOTAL FUND BALANCE" : "COMMUNITY FUND BALANCE"}</div>
            <div className="overview-balance-value">MVR {fmt(summary.fundBalance)}</div>
          </div>
          <div className={`sans overview-month-change${netMonth < 0 ? " is-negative" : ""}`}>
            {netMonth >= 0 ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowDownRight size={15} aria-hidden="true" />}
            <span>MVR {fmt(Math.abs(netMonth))}</span>
          </div>
        </div>
        <div className="sans overview-balance-foot">Net movement in {monthLabel}</div>
      </section>

      <section className="overview-metric-grid" aria-label={`${monthLabel} fund activity`}>
        <MetricCard icon={<Landmark size={18} />} label="Contributions" value={`MVR ${fmt(contributions)}`} tone="green" />
        <MetricCard icon={<ReceiptText size={18} />} label="Expenses" value={`MVR ${fmt(expenses)}`} tone="coral" />
        <MetricCard icon={<HeartHandshake size={18} />} label="Donations" value={`MVR ${fmt(donations)}`} tone="violet" />
      </section>

      <section className="overview-section">
        <div className="overview-section-head">
          <div>
            <div className="sans overview-section-kicker">MONTHLY COLLECTION</div>
            <div className="overview-section-title">{monthLabel}</div>
          </div>
          <div className="sans overview-collection-percent">{collectionPct}%</div>
        </div>
        <div className="overview-collection-card">
          <div className="sans overview-collection-values">
            <strong>MVR {fmt(collectedForProgress)}</strong>
            <span>of MVR {fmt(expected)}</span>
          </div>
          <div className="overview-progress-track" aria-label={`${collectionPct}% collected`}>
            <div className="overview-progress-fill" style={{ width: `${collectionPct}%` }} />
          </div>
          <div className="sans overview-collection-foot">
            <span>{collectionPct >= 100 ? "Collection complete" : `${100 - collectionPct}% remaining`}</span>
            {outstandingMembers > 0 && <span>{outstandingMembers} {outstandingMembers === 1 ? "member" : "members"} outstanding</span>}
          </div>
        </div>
      </section>

      {isAdmin && (
        <section className="overview-section">
          <div className="overview-section-head overview-section-head--compact">
            <div>
              <div className="sans overview-section-kicker">NEEDS ATTENTION</div>
              <div className="overview-section-title">Today</div>
            </div>
          </div>
          <div className="overview-attention-list">
            {canFinance && pendingCount !== null && (
              <AttentionRow
                icon={pendingCount > 0 ? <Clock3 size={18} /> : <CircleCheckBig size={18} />}
                title="Pending approvals"
                detail={pendingCount > 0 ? `${pendingCount} waiting for review` : "Nothing waiting"}
                tone={pendingCount > 0 ? "warning" : "success"}
                onClick={() => setTab?.("pending")}
              />
            )}
            <AttentionRow
              icon={outstandingTotal > 0 ? <AlertTriangle size={18} /> : <CircleCheckBig size={18} />}
              title="Outstanding contributions"
              detail={outstandingTotal > 0 ? `MVR ${fmt(outstandingTotal)} · ${outstandingMembers} ${outstandingMembers === 1 ? "member" : "members"}` : "No outstanding balance"}
              tone={outstandingTotal > 0 ? "danger" : "success"}
              onClick={() => setTab?.("members")}
            />
            <AttentionRow
              icon={<Users size={18} />}
              title="Members"
              detail={`${Number(summary.memberCount ?? summary.members ?? 0) || "View"} active member records`}
              tone="blue"
              onClick={() => setTab?.("members")}
            />
          </div>
        </section>
      )}

      {!isAdmin && memberElection && (
        <MemberElectionOverviewCard election={memberElection} onOpen={() => setTab?.("elections")} />
      )}

      <section className="overview-section overview-activity-section">
        <div className="overview-section-head overview-section-head--compact">
          <div>
            <div className="sans overview-section-kicker">RECENT ACTIVITY</div>
            <div className="overview-section-title">Latest movements</div>
          </div>
          {activity.length > 0 && (
            <button type="button" onClick={() => setTab?.("activity")} className="sans overview-text-action">
              View all <ChevronRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="overview-activity-list">
          {activity.map((a) => <ActivityRow key={`${a.kind}-${a.id}`} a={a} isAdmin={isAdmin} />)}
          {activity.length === 0 && <div className="sans overview-empty">No activity yet.</div>}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, tone = "green" }) {
  return (
    <div className={`overview-metric-card overview-metric-card--${tone}`}>
      <div className="overview-metric-icon">{icon}</div>
      <div className="sans overview-metric-label">{label}</div>
      <div className="overview-metric-value">{value}</div>
    </div>
  );
}

function AttentionRow({ icon, title, detail, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`overview-attention-row tone-${tone}`}>
      <span className="overview-attention-icon">{icon}</span>
      <span className="overview-attention-copy">
        <strong>{title}</strong>
        <span className="sans">{detail}</span>
      </span>
      <ChevronRight size={18} className="overview-attention-chevron" aria-hidden="true" />
    </button>
  );
}

function MemberElectionOverviewCard({ election, onOpen }) {
  const deadline = election.status === "draft" ? election.applications_close_at : election.closes_at;
  const deadlineLabel = (() => {
    if (!deadline) return "Open Elections for details";
    try {
      const d = new Date(String(deadline).includes("T") ? deadline : String(deadline).replace(" ", "T"));
      return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
    } catch { return String(deadline).replace("T", " ").slice(0, 16); }
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

  return (
    <section className="overview-section">
      <div className="overview-section-head overview-section-head--compact">
        <div>
          <div className="sans overview-section-kicker">COMMUNITY</div>
          <div className="overview-section-title">Election update</div>
        </div>
      </div>
      <button type="button" className="member-overview-election member-overview-election--modern" onClick={onOpen} aria-label={`${title}: ${election.title}`}>
        <div className="member-overview-election-main">
          <span className="sans member-overview-election-label">{label}</span>
          <div className="member-overview-election-title">{title}</div>
          <div className="sans member-overview-election-name">{election.title}</div>
          <div className="sans member-overview-election-note">{note}</div>
        </div>
        <div className="sans member-overview-election-action">
          <span>{action}</span><ChevronRight size={18} aria-hidden="true" />
        </div>
      </button>
    </section>
  );
}

function formatMonthLabel(value) {
  try {
    const [y, m] = String(value).split("-").map(Number);
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  } catch {
    return value;
  }
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
    <div className="overview-page member-overview-skeleton" aria-label="Loading overview" aria-busy="true">
      <div className="skeleton-block" style={{ width: "48%", height: 24, marginBottom: 8 }} />
      <div className="skeleton-block" style={{ width: "78%", height: 12, marginBottom: 18 }} />
      {memberView && <div className="skeleton-block" style={{ height: 132, borderRadius: 18, marginBottom: 12 }} />}
      <div className="skeleton-block" style={{ height: 130, borderRadius: 20, marginBottom: 12 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <div className="skeleton-block" style={{ height: 98, borderRadius: 15 }} />
        <div className="skeleton-block" style={{ height: 98, borderRadius: 15 }} />
        <div className="skeleton-block" style={{ height: 98, borderRadius: 15 }} />
      </div>
      <div className="skeleton-block" style={{ height: 110, borderRadius: 16, marginTop: 18 }} />
    </div>
  );
}
