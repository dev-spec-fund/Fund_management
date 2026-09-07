import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Center } from "./components/Shared";
import Overview from "./pages/Overview";
import { adminCan } from "./utils/permissions";
import { getAdminReportMonth, saveAdminReportMonth } from "./utils/adminReportMonth";
import {
  Home, Clock3, Users, Activity as ActivityIcon, ReceiptText, FolderKanban,
  BarChart3, CalendarDays, Settings as SettingsIcon, History, WalletCards,
  ListChecks, UserRound, Landmark, Scale, Grid2X2, HeartHandshake, ShieldCheck
} from "lucide-react";


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
  elections: () => import("./pages/Elections"),
  settings: () => import("./pages/Settings"),
  memberViews: () => import("./pages/MemberViews"),
};

const Members = lazy(pageLoaders.members);
const Reports = lazy(pageLoaders.reports);
const Expenses = lazy(pageLoaders.expenses);
const Projects = lazy(pageLoaders.projects);
const PendingApprovals = lazy(pageLoaders.pending);
const Meetings = lazy(pageLoaders.meetings);
const Elections = lazy(pageLoaders.elections);
const Settings = lazy(pageLoaders.settings);
const MyHistory = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyHistory })));
const FundView = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.FundView })));
const Activity = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.Activity })));
const MemberMeetings = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MemberMeetings })));
const MemberElections = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MemberElections })));
const MemberProjects = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MemberProjects })));
const MyActions = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyActions })));
const MyProfile = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyProfile })));

const loaderForTab = (tab, adminView = false) => {
  // Grouped navigation still opens the existing leaf screens. Keep preloading
  // aligned with those leaf screens so the redesign does not duplicate page logic.
  if (["history", "fund", "activity", "actions", "profile"].includes(tab)) return pageLoaders.memberViews;
  if (tab === "projects") return adminView ? pageLoaders.projects : pageLoaders.memberViews;
  if (tab === "elections") return adminView ? pageLoaders.elections : pageLoaders.memberViews;
  if (tab === "meetings") return adminView ? pageLoaders.meetings : pageLoaders.memberViews;
  if (tab === "donations") return pageLoaders.reports;
  if (tab === "audit") return pageLoaders.settings;
  return pageLoaders[tab] || null;
};

const NAV_ITEMS = {
  overview: { label: "Overview", icon: Home },
  home: { label: "Home", icon: Home },
  members: { label: "Members", icon: Users },
  finance: { label: "Finance", icon: Landmark },
  governance: { label: "Governance", icon: Scale },
  more: { label: "More", icon: Grid2X2 },
  pending: { label: "Pending", icon: Clock3 },
  expenses: { label: "Expenses", icon: ReceiptText },
  donations: { label: "Donations", icon: HeartHandshake },
  reports: { label: "Reports", icon: BarChart3 },
  projects: { label: "Projects", icon: FolderKanban },
  meetings: { label: "Meetings", icon: CalendarDays },
  elections: { label: "Elections", icon: ListChecks },
  settings: { label: "Settings", icon: SettingsIcon },
  audit: { label: "Audit Log", icon: ShieldCheck },
  fundGroup: { label: "Fund", icon: WalletCards },
  community: { label: "Community", icon: Users },
  activity: { label: "Activity", icon: ActivityIcon },
  profile: { label: "Profile", icon: UserRound },
  fund: { label: "Fund", icon: WalletCards },
  history: { label: "My History", icon: History },
  actions: { label: "My Actions", icon: ListChecks },
};

function PrimaryNavItem({ name, active, onWarm, onOpen }) {
  const meta = NAV_ITEMS[name] || { label: name, icon: Home };
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className={`app-nav-item${active ? " active" : ""}`}
      onPointerDown={onWarm}
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      aria-label={meta.label}
      title={meta.label}
    >
      <Icon size={19} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
      <span className="app-nav-label">{meta.label}</span>
    </button>
  );
}

function SectionNav({ title, sections, active, onWarm, onOpen }) {
  if (!sections?.length) return null;
  return (
    <div className="app-section-nav-wrap">
      <div className="sans app-section-title">{title}</div>
      <div className="app-section-nav" role="tablist" aria-label={`${title} sections`}>
        {sections.map((name) => {
          const meta = NAV_ITEMS[name] || { label: name, icon: Home };
          const Icon = meta.icon;
          const selected = active === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`app-section-nav-item${selected ? " active" : ""}`}
              onPointerDown={() => onWarm(name)}
              onClick={() => onOpen(name)}
            >
              <Icon size={15} strokeWidth={selected ? 2.25 : 1.9} aria-hidden="true" />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bootstrapSummary, setBootstrapSummary] = useState(null);
  const [adminMonth, setAdminMonthState] = useState(getAdminReportMonth());
  const setAdminMonth = (value) => {
    if(!/^\d{4}-\d{2}$/.test(String(value||""))) return;
    saveAdminReportMonth(value);
    setAdminMonthState(value);
  };
  const [tab, setTab] = useState("overview");
  const [mode, setMode] = useState("member");
  const [mountedTabs, setMountedTabs] = useState(() => new Set(["overview"]));
  const [lastSections, setLastSections] = useState({
    admin: { finance: "pending", governance: "projects", more: "settings" },
    member: { fundGroup: "fund", community: "projects" },
  });
  const contentScrollRef = useRef(null);
  const lastWarmRef = useRef({ key: "", at: 0 });
  const bootStartedAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);

  const isAdmin = !!me?.admin;
  const isMember = !!me?.member;
  const adminView = isAdmin && mode === "admin";
  const memberView = isMember && mode === "member";
  const canFinance = adminView && adminCan(me?.admin, "finance");
  const canManageAdmins = adminView && adminCan(me?.admin, "manage_admins");
  const memberProjectsEnabled = me?.member_features?.projects !== false;

  const sections = useMemo(() => adminView ? {
    finance: [...(canFinance ? ["pending", "expenses", "donations"] : []), "reports"],
    governance: [...(canFinance ? ["projects"] : []), "meetings", ...(canManageAdmins ? ["elections"] : [])],
    more: ["settings", ...(canFinance ? ["audit"] : [])],
  } : {
    fundGroup: ["fund", "history"],
    community: [...(memberProjectsEnabled ? ["projects"] : []), "meetings", "elections", "actions"],
  }, [adminView, canFinance, canManageAdmins, memberProjectsEnabled]);

  const primaryTabs = useMemo(() => adminView
    ? ["overview", "members", "finance", "governance", "more"]
    : ["home", "fundGroup", "community", "activity", "profile"], [adminView]);

  const tabs = useMemo(() => adminView
    ? ["overview", "members", "activity", ...sections.finance, ...sections.governance, ...sections.more]
    : ["overview", "activity", "profile", ...sections.fundGroup, ...sections.community], [adminView, sections]);

  const primaryForTab = (leaf) => {
    if (adminView) {
      if (leaf === "overview" || leaf === "activity") return "overview";
      if (leaf === "members") return "members";
      if (sections.finance.includes(leaf)) return "finance";
      if (sections.governance.includes(leaf)) return "governance";
      if (sections.more.includes(leaf)) return "more";
      return "overview";
    }
    if (leaf === "overview") return "home";
    if (sections.fundGroup.includes(leaf)) return "fundGroup";
    if (sections.community.includes(leaf)) return "community";
    if (leaf === "activity") return "activity";
    if (leaf === "profile") return "profile";
    return "home";
  };

  const activePrimary = primaryForTab(tab);
  const activeSections = sections[activePrimary] || [];
  const activeSectionTitle = NAV_ITEMS[activePrimary]?.label || "";

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

    const context = () => ({
      route: typeof window !== "undefined" ? window.location.pathname : "",
      page: tab,
      mode,
      occurred_at: new Date().toISOString(),
    });

    const onWindowError = (event) => {
      api.reportClientError({
        source: "window.error",
        message: event?.error?.message || event?.message || "Unhandled window error",
        stack: event?.error?.stack || "",
        ...context(),
      });
    };

    const onUnhandledRejection = (event) => {
      const reason=event?.reason;
      api.reportClientError({
        source: "unhandledrejection",
        message: reason?.message || String(reason || "Unhandled promise rejection"),
        stack: reason?.stack || "",
        ...context(),
      });
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [me, tab, mode]);

  useEffect(() => {
    if (!me) return undefined;

    // v69: preload JavaScript chunks, then warm only the single most likely
    // next screen's data while the browser is idle. Shared GET cache and
    // in-flight de-duplication prevent this from causing duplicate navigation fetches.
    const likelyNext = adminView
      ? (canFinance ? ["pending", "members", "expenses", "projects"] : ["members", "reports"])
      : ["history", "fund", "activity", ...(memberProjectsEnabled ? ["projects"] : []), "meetings"];
    const secondary = adminView
      ? ["activity", "reports", "meetings"]
      : ["actions", "profile"];
    const later = adminView ? ["settings"] : [];

    const warmCode = (items) => {
      items
        .filter((name) => tabs.includes(name))
        .forEach((name) => loaderForTab(name, adminView)?.());
    };

    const timers = [
      setTimeout(() => warmCode(likelyNext), 260),
      setTimeout(() => warmCode(secondary), 1400),
      setTimeout(() => warmCode(later), 2800),
    ];

    const warmLikelyData=()=>{
      const next=likelyNext.find((name)=>tabs.includes(name));
      if(!next)return;
      api.prefetchTabData({
        tab:next,
        adminView,
        canFinance,
        memberId:me?.member?.id||null,
        adminMonth:adminView?adminMonth:null,
      }).catch(()=>{});
    };
    let idleHandle=null;
    let idleTimer=null;
    if(typeof window.requestIdleCallback==="function"){
      idleHandle=window.requestIdleCallback(warmLikelyData,{timeout:1800});
    }else{
      idleTimer=setTimeout(warmLikelyData,900);
    }

    return () => {
      timers.forEach(clearTimeout);
      if(idleHandle!==null)window.cancelIdleCallback?.(idleHandle);
      if(idleTimer!==null)clearTimeout(idleTimer);
    };
  }, [me, adminView, canFinance, tabs, memberProjectsEnabled, adminMonth]);

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
    const now = Date.now();
    const key = `${mode}:${nextTab}`;
    if (lastWarmRef.current.key === key && now - lastWarmRef.current.at < 800) return;
    lastWarmRef.current = { key, at: now };

    loaderForTab(nextTab, adminView)?.();
    api.prefetchTabData({
      tab: nextTab,
      adminView,
      canFinance,
      memberId: me?.member?.id || null,
      adminMonth: adminView ? adminMonth : null,
    }).catch(() => {});
  };

  const openTab = (nextTab) => {
    if (!tabs.includes(nextTab)) return;
    warmTab(nextTab);

    const primary = primaryForTab(nextTab);
    if (sections[primary]?.includes(nextTab)) {
      const modeKey = adminView ? "admin" : "member";
      setLastSections((current) => ({
        ...current,
        [modeKey]: { ...current[modeKey], [primary]: nextTab },
      }));
    }

    // Keep a bounded warm-page window for smooth back-and-forth navigation.
    // Four recent screens preserve local UI state without returning to the old
    // unlimited hidden-page/listener buildup.
    setMountedTabs((current) => {
      const ordered = [...current].filter((page) => page !== nextTab);
      ordered.push(nextTab);
      while (ordered.length > 4) ordered.shift();
      return new Set(ordered);
    });
    setTab(nextTab);
  };

  const leafForPrimary = (primary) => {
    if (adminView) {
      if (primary === "overview") return "overview";
      if (primary === "members") return "members";
    } else {
      if (primary === "home") return "overview";
      if (primary === "activity") return "activity";
      if (primary === "profile") return "profile";
    }
    const options = sections[primary] || [];
    const modeKey = adminView ? "admin" : "member";
    const remembered = lastSections[modeKey]?.[primary];
    return options.includes(remembered) ? remembered : options[0];
  };

  const warmPrimary = (primary) => {
    const leaf = leafForPrimary(primary);
    if (leaf) warmTab(leaf);
  };

  const openPrimary = (primary) => {
    const leaf = leafForPrimary(primary);
    if (leaf) openTab(leaf);
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setTab("overview");
    setMountedTabs(new Set(["overview"]));
  };

  const renderPage = (page) => {
    if (page === "overview") return <Overview isAdmin={adminView} canFinance={canFinance} setTab={openTab} bootstrapSummary={bootstrapSummary} member={memberView ? me.member : null} adminMonth={adminView ? adminMonth : null} />;
    if (page === "pending" && canFinance) return <PendingApprovals />;
    if (page === "members" && adminView) return <Members isAdmin admin={me.admin} month={adminMonth} onMonthChange={setAdminMonth} />;
    if (page === "history" && memberView) return <MyHistory member={me.member} />;
    if (page === "fund" && memberView) return <FundView />;
    if (page === "activity") return <Activity isAdmin={adminView} canFinance={canFinance} />;
    if (page === "projects" && memberView) return <MemberProjects />;
    if (page === "meetings" && memberView) return <MemberMeetings />;
    if (page === "elections" && memberView) return <MemberElections />;
    if (page === "actions" && memberView) return <MyActions />;
    if (page === "profile" && memberView) return <MyProfile member={me.member} setTab={openTab} />;
    if (page === "expenses" && canFinance) return <Expenses admin={me.admin} />;
    if (page === "projects" && canFinance) return <Projects admin={me.admin} />;
    if (page === "donations" && canFinance) return <Reports setTab={openTab} admin={me.admin} month={adminMonth} onMonthChange={setAdminMonth} view="donations" />;
    if (page === "reports" && adminView) return <Reports setTab={openTab} admin={me.admin} month={adminMonth} onMonthChange={setAdminMonth} view="reports" />;
    if (page === "meetings" && adminView) return <Meetings admin={me.admin} />;
    if (page === "elections" && canManageAdmins) return <Elections />;
    if (page === "settings" && adminView) return <Settings admin={me.admin} adminMonth={adminMonth} onAdminMonthChange={setAdminMonth} />;
    if (page === "audit" && canFinance) return <Settings admin={me.admin} adminMonth={adminMonth} onAdminMonthChange={setAdminMonth} initialSection="audit" sectionOnly />;
    return null;
  };

  return (
    <Shell branding={me?.branding}>
      {isAdmin && isMember && (
        <div className="app-mode-wrap">
          <div className="sans app-mode-switch">
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
      <SectionNav
        title={activeSectionTitle}
        sections={activeSections}
        active={tab}
        onWarm={warmTab}
        onOpen={openTab}
      />
      <nav
        className="sans admin-tab-strip app-icon-nav"
        aria-label={adminView ? "Admin navigation" : "My Account navigation"}
        style={{ gridTemplateColumns: `repeat(${primaryTabs.length}, minmax(0, 1fr))` }}
      >
        {primaryTabs.map((name) => (
          <PrimaryNavItem
            key={name}
            name={name}
            active={activePrimary === name}
            onWarm={() => warmPrimary(name)}
            onOpen={() => openPrimary(name)}
          />
        ))}
      </nav>
      <main ref={contentScrollRef} className="app-page-content">
        {tabs.filter((page) => mountedTabs.has(page)).map((page) => (
          <div
            key={`${mode}:${page}`}
            className={`page-panel${tab === page ? " page-panel--active" : ""}`}
            style={{ display: tab === page ? "block" : "none" }}
            aria-hidden={tab !== page}
          >
            <PageErrorBoundary page={page} mode={mode}>
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
  componentDidCatch(error, info) {
    console.error(`Page ${this.props.page} crashed`, error, info);
    api.reportClientError({
      source: "page-boundary",
      message: error?.message || "Page crashed",
      stack: `${error?.stack || ""}\n${info?.componentStack || ""}`.slice(0,3500),
      route: typeof window !== "undefined" ? window.location.pathname : "",
      page: this.props.page,
      mode: this.props.mode || "",
      occurred_at: new Date().toISOString(),
    });
  }
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
      <div className="theme-brand-surface app-brand-header" style={{ flexShrink: 0, background: "var(--primary)", color: "var(--on-primary)" }}>
        <div className="sans app-brand-kicker">{branding?.short_name || "Fund"}</div>
        <div className="app-brand-title">Ledger</div>
        {branding?.fund_name && <div className="sans app-brand-name">{branding.fund_name}</div>}
      </div>
      {children}
    </div>
  );
}
