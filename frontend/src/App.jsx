import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Center } from "./components/Shared";
import Overview from "./pages/Overview";
import { adminCan } from "./utils/permissions";


const THEME_VALUES = new Set(["light", "dark"]);

function resolveAppTheme() {
  if (typeof window === "undefined") return "light";
  const telegramTheme = window.Telegram?.WebApp?.colorScheme;
  if (THEME_VALUES.has(telegramTheme)) return telegramTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function applyAppTheme(theme = resolveAppTheme()) {
  if (typeof document === "undefined") return;
  const nextTheme = THEME_VALUES.has(theme) ? theme : "light";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
}

// Apply the correct palette before React paints. Telegram is the source of
// truth inside the Mini App; the device/browser preference is fallback only.
applyAppTheme();

const pageLoaders = {
  members: () => import("./pages/Members"),
  reports: () => import("./pages/Reports"),
  expenses: () => import("./pages/Expenses"),
  projects: () => import("./pages/Projects"),
  pending: () => import("./pages/PendingApprovals"),
  meetings: () => import("./pages/Meetings"),
  settings: () => import("./pages/Settings"),
  memberViews: () => import("./pages/MemberViews"),
};

const Members = lazy(pageLoaders.members);
const Reports = lazy(pageLoaders.reports);
const Expenses = lazy(pageLoaders.expenses);
const Projects = lazy(pageLoaders.projects);
const PendingApprovals = lazy(pageLoaders.pending);
const Meetings = lazy(pageLoaders.meetings);
const Settings = lazy(pageLoaders.settings);
const MyHistory = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyHistory })));
const FundView = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.FundView })));
const Activity = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.Activity })));
const MemberMeetings = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MemberMeetings })));
const MemberProjects = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MemberProjects })));
const MyActions = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyActions })));
const MyProfile = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyProfile })));

const loaderForTab = (tab, adminView = false) => {
  // Activity is shared from MemberViews, but Meetings has separate Admin and
  // Member implementations. Keep the preload target aligned with the screen
  // that will actually render so the first Admin Meetings visit is warm too.
  if (["history", "fund", "activity", "projects", "actions", "profile"].includes(tab)) return pageLoaders.memberViews;
  if (tab === "meetings") return adminView ? pageLoaders.meetings : pageLoaders.memberViews;
  return pageLoaders[tab] || null;
};

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bootstrapSummary, setBootstrapSummary] = useState(null);
  const [tab, setTab] = useState("overview");
  const [mode, setMode] = useState("member");
  const [mountedTabs, setMountedTabs] = useState(() => new Set(["overview"]));
  const contentScrollRef = useRef(null);
  const bootStartedAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);

  const isAdmin = !!me?.admin;
  const isMember = !!me?.member;
  const adminView = isAdmin && mode === "admin";
  const memberView = isMember && mode === "member";
  const canFinance = adminView && adminCan(me?.admin, "finance");
  const memberProjectsEnabled = me?.member_features?.projects !== false;
  const tabs = useMemo(() => adminView
    ? (canFinance ? ["overview", "pending", "members", "activity", "expenses", "projects", "reports", "meetings", "settings"] : ["overview", "members", "activity", "reports", "meetings", "settings"])
    : ["overview", "history", "fund", "activity", ...(memberProjectsEnabled ? ["projects"] : []), "meetings", "actions", "profile"], [adminView, canFinance, memberProjectsEnabled]);

  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncTheme = () => applyAppTheme();

    syncTheme();
    if (THEME_VALUES.has(telegram?.colorScheme) && telegram?.onEvent) {
      telegram.onEvent("themeChanged", syncTheme);
      return () => telegram.offEvent?.("themeChanged", syncTheme);
    }

    // Outside Telegram, follow the normal operating-system preference.
    media?.addEventListener?.("change", syncTheme);
    return () => media?.removeEventListener?.("change", syncTheme);
  }, []);

  useEffect(() => {
    // Start the safe overview request immediately so it overlaps the /me round-trip.
    api.reports.publicSummary().then(setBootstrapSummary).catch(() => {});
    api.me()
      .then((data) => {
        setMe(data);
        setMode(data?.admin ? "admin" : "member");
        if (import.meta.env.DEV && bootStartedAt.current && typeof performance !== "undefined") {
          if (import.meta.env.DEV) console.debug(`[Fund perf] app identity ready: ${Math.round(performance.now() - bootStartedAt.current)}ms`);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me) return undefined;

    // Preload code and API data without mounting hidden React pages. This keeps
    // navigation fast while preserving the v40 crash isolation. Admin requests
    // are staged so they do not compete with the Overview bootstrap request.
    const likelyNext = adminView
      ? (canFinance ? ["pending", "members", "activity"] : ["members", "activity"])
      : ["history", "fund", "activity", ...(memberProjectsEnabled ? ["projects"] : []), "meetings"];
    const secondary = adminView
      ? (canFinance ? ["expenses", "projects", "reports", "meetings"] : ["reports", "meetings"])
      : ["actions", "profile"];
    const later = adminView ? ["settings"] : [];

    const warmCode = (items) => {
      items.filter((name) => tabs.includes(name)).forEach((name) => loaderForTab(name, adminView)?.());
    };

    const timers = adminView ? [
      setTimeout(() => warmCode(likelyNext), 180),
      setTimeout(() => api.prefetchAdminData("primary", canFinance).catch(() => {}), 280),
      setTimeout(() => warmCode(secondary), 850),
      setTimeout(() => api.prefetchAdminData("operations", canFinance).catch(() => {}), 950),
      setTimeout(() => api.prefetchAdminData("reports", canFinance).catch(() => {}), 1450),
      // Settings is deliberately last because it is rarely the first destination
      // and its health/audit requests are the heaviest background group.
      setTimeout(() => warmCode(later), 2400),
      setTimeout(() => api.prefetchAdminData("settings", canFinance).catch(() => {}), 3000),
      // Dual-role Member data warms after the Admin UI has settled.
      setTimeout(() => {
        if (isMember && me?.member?.id) api.prefetchMemberData(me.member.id, "primary").catch(() => {});
      }, 2550),
      setTimeout(() => {
        if (isMember && me?.member?.id) api.prefetchMemberData(me.member.id, "secondary").catch(() => {});
      }, 4200),
    ] : [
      setTimeout(() => warmCode(likelyNext), 180),
      setTimeout(() => { if (isMember && me?.member?.id) api.prefetchMemberData(me.member.id, "primary").catch(() => {}); }, 280),
      // Actions/Profile are lower priority than History/Fund/Activity/Meetings.
      setTimeout(() => warmCode(secondary), 1100),
      setTimeout(() => { if (isMember && me?.member?.id) api.prefetchMemberData(me.member.id, "secondary").catch(() => {}); }, 1500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [me, adminView, canFinance, isMember, tabs]);

  // All normal screens share one scroll root. Reset it when the user intentionally
  // changes the active tab/mode so every screen opens from a predictable position.
  useEffect(() => {
    const scroller = contentScrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab, mode]);

  if (loading) return <Shell><InitialAppSkeleton /></Shell>;
  if (error) return <Shell><Center>Couldn't connect: {error}</Center></Shell>;

  const warmTab = (nextTab) => {
    loaderForTab(nextTab, adminView)?.();
    api.prefetchTabData({
      tab: nextTab,
      adminView,
      canFinance,
      memberId: me?.member?.id || null,
    }).catch(() => {});
  };

  const openTab = (nextTab) => {
    warmTab(nextTab);
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
    setTab(nextTab);
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setTab("overview");
    setMountedTabs(new Set(["overview"]));
  };

  const renderPage = (page) => {
    if (page === "overview") return <Overview isAdmin={adminView} canFinance={canFinance} setTab={openTab} bootstrapSummary={bootstrapSummary} />;
    if (page === "pending" && canFinance) return <PendingApprovals />;
    if (page === "members" && adminView) return <Members isAdmin admin={me.admin} />;
    if (page === "history" && memberView) return <MyHistory member={me.member} />;
    if (page === "fund" && memberView) return <FundView />;
    if (page === "activity") return <Activity isAdmin={adminView} canFinance={canFinance} />;
    if (page === "projects" && memberView) return <MemberProjects />;
    if (page === "meetings" && memberView) return <MemberMeetings />;
    if (page === "actions" && memberView) return <MyActions />;
    if (page === "profile" && memberView) return <MyProfile member={me.member} />;
    if (page === "expenses" && canFinance) return <Expenses admin={me.admin} />;
    if (page === "projects" && canFinance) return <Projects admin={me.admin} />;
    if (page === "reports" && adminView) return <Reports setTab={openTab} />;
    if (page === "meetings" && adminView) return <Meetings admin={me.admin} />;
    if (page === "settings" && adminView) return <Settings admin={me.admin} />;
    return null;
  };

  return (
    <Shell branding={me?.branding}>
      {isAdmin && isMember && (
        <div style={{ flexShrink: 0, padding: "14px 20px 0", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div className="sans" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--border)", borderRadius: 12, padding: 3 }}>
            <button type="button" onClick={() => changeMode("admin")} style={modeButton(mode === "admin")}>Admin View</button>
            <button type="button" onClick={() => changeMode("member")} style={modeButton(mode === "member")}>My Account</button>
          </div>
        </div>
      )}
      {isAdmin && !isMember && (
        <div className="sans" style={{ flexShrink: 0, margin: "14px auto 0", width: "calc(100% - 40px)", maxWidth: 440, boxSizing: "border-box", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", color: "var(--warning)", borderRadius: 10, padding: "9px 12px", fontSize: 12 }}>
          You are an admin but not yet linked to a member account. Send /start to the bot and choose “Register Myself as Member”.
        </div>
      )}
      <div className="sans admin-tab-strip" style={{ flexShrink: 0, display: "flex", gap: 18, padding: "0 28px", marginTop: 18, overflowX: "auto", scrollPaddingInline: 28 }}>
        {tabs.map((t) => (
          <button type="button" key={t} onPointerDown={() => warmTab(t)} onClick={() => openTab(t)} style={{ background: "none", border: "none", cursor: "pointer", color: tab === t ? "var(--primary-text)" : "var(--muted-2)", fontSize: 14, fontWeight: tab === t ? 600 : 500, paddingBottom: 6, whiteSpace: "nowrap", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>
      <main ref={contentScrollRef} className="app-page-content" style={{ padding: 20, width: "100%", maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        {tabs.filter((page) => mountedTabs.has(page)).map((page) => (
          <div
            key={`${mode}:${page}`}
            className={`page-panel${tab === page ? " page-panel--active" : ""}`}
            style={{ display: tab === page ? "block" : "none" }}
            aria-hidden={tab !== page}
          >
            <PageErrorBoundary page={page}>
              <Suspense fallback={tab === page ? <PageSkeleton /> : null}>
                {renderPage(page)}
              </Suspense>
            </PageErrorBoundary>
          </div>
        ))}
      </main>
    </Shell>
  );
}


class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(`Page ${this.props.page} crashed`, error, info); }
  componentDidUpdate(prevProps) {
    if (prevProps.page !== this.props.page && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="sans" role="alert" style={{background:"var(--danger-bg)",border:"1px solid var(--danger-border)",borderRadius:12,padding:16,color:"var(--danger)"}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:5}}>This page couldn’t be displayed.</div>
        <div style={{fontSize:11,lineHeight:1.45,marginBottom:10}}>The rest of the Mini App is still available.</div>
        <button type="button" onClick={() => this.setState({error:null})} style={{background:"var(--card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 11px",fontSize:12,cursor:"pointer"}}>Try again</button>
      </div>
    );
  }
}


function SkeletonBlock({ className = "", style }) {
  return <div className={`skeleton-block ${className}`} style={style} aria-hidden="true" />;
}

function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-label="Loading page" aria-busy="true">
      <SkeletonBlock style={{ width: "42%", height: 22, marginBottom: 16 }} />
      <SkeletonBlock style={{ width: "100%", height: 112, borderRadius: 16, marginBottom: 14 }} />
      <div className="skeleton-grid">
        <SkeletonBlock style={{ height: 92, borderRadius: 14 }} />
        <SkeletonBlock style={{ height: 92, borderRadius: 14 }} />
      </div>
      <SkeletonBlock style={{ width: "100%", height: 72, borderRadius: 14, marginTop: 14 }} />
      <SkeletonBlock style={{ width: "72%", height: 18, marginTop: 22, marginBottom: 12 }} />
      <SkeletonBlock style={{ width: "100%", height: 86, borderRadius: 14 }} />
    </div>
  );
}

function InitialAppSkeleton() {
  return (
    <>
      <div style={{ flexShrink: 0, padding: "14px 20px 0", maxWidth: 480, margin: "0 auto", width: "100%" }}>
        <SkeletonBlock style={{ height: 42, borderRadius: 12 }} />
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 18, padding: "18px 20px 0", maxWidth: 480, width: "100%", margin: "0 auto" }}>
        {[64, 58, 70, 58].map((width, i) => <SkeletonBlock key={i} style={{ width, height: 18 }} />)}
      </div>
      <div className="app-page-content app-page-content--loading" style={{ padding: 20, width: "100%", maxWidth: 480, margin: "0 auto" }}>
        <PageSkeleton />
      </div>
    </>
  );
}

function modeButton(active) {
  return { border: "none", borderRadius: 9, padding: "9px 10px", background: active ? "var(--primary)" : "transparent", color: active ? "var(--on-primary)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}

function Shell({ children, branding }) {
  return (
    <div className="app-scroll-root" style={{ fontFamily: "'Fraunces','Georgia',serif", background: "var(--bg)", color: "var(--text)" }}>
      <div className="theme-brand-surface" style={{ flexShrink: 0, background: "var(--primary)", padding: "24px 24px 6px", color: "var(--on-primary)" }}>
        <div className="sans" style={{ fontSize: 11, letterSpacing: 2, opacity: 0.72, textTransform: "uppercase" }}>{branding?.short_name || "Fund"}</div>
        <div style={{ fontSize: 28, fontWeight: 600, marginTop: 2 }}>Ledger</div>
        {branding?.fund_name && <div className="sans" style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{branding.fund_name}</div>}
      </div>
      {children}
    </div>
  );
}
