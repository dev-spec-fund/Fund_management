import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "./api";
import { Center } from "./components/Shared";
import Overview from "./pages/Overview";

const pageLoaders = {
  members: () => import("./pages/Members"),
  reports: () => import("./pages/Reports"),
  pending: () => import("./pages/PendingApprovals"),
  meetings: () => import("./pages/Meetings"),
  settings: () => import("./pages/Settings"),
  memberViews: () => import("./pages/MemberViews"),
};

const Members = lazy(pageLoaders.members);
const Reports = lazy(pageLoaders.reports);
const PendingApprovals = lazy(pageLoaders.pending);
const Meetings = lazy(pageLoaders.meetings);
const Settings = lazy(pageLoaders.settings);
const MyHistory = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.MyHistory })));
const FundView = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.FundView })));
const Activity = lazy(() => pageLoaders.memberViews().then((m) => ({ default: m.Activity })));

const loaderForTab = (tab) => {
  if (["history", "fund", "activity"].includes(tab)) return pageLoaders.memberViews;
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

  const isAdmin = !!me?.admin;
  const isMember = !!me?.member;
  const adminView = isAdmin && mode === "admin";
  const memberView = isMember && mode === "member";
  const canFinance = adminView && ["owner", "super_admin", "treasurer"].includes(me?.admin?.role);
  const tabs = useMemo(() => adminView
    ? (canFinance ? ["overview", "pending", "members", "activity", "reports", "meetings", "settings"] : ["overview", "members", "activity", "reports", "meetings", "settings"])
    : ["overview", "history", "fund", "activity"], [adminView, canFinance]);

  useEffect(() => {
    // Start the safe overview request immediately so it overlaps the /me round-trip.
    api.reports.publicSummary().then(setBootstrapSummary).catch(() => {});
    api.me()
      .then((data) => { setMe(data); setMode(data?.admin ? "admin" : "member"); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me) return undefined;

    // Stage background mounting so Overview becomes interactive first. Hidden mounted
    // pages run their normal data loaders and keep their state, making later tab taps instant.
    const likelyNext = adminView
      ? (canFinance ? ["pending", "members", "activity"] : ["members", "activity"])
      : ["history", "fund", "activity"];
    const secondary = adminView ? ["reports", "meetings"] : [];
    const later = adminView ? ["settings"] : [];

    const warm = (items) => {
      items.filter((name) => tabs.includes(name)).forEach((name) => loaderForTab(name)?.());
      setMountedTabs((current) => {
        const next = new Set(current);
        items.filter((name) => tabs.includes(name)).forEach((name) => next.add(name));
        return next;
      });
    };

    const timers = [
      setTimeout(() => warm(likelyNext), 180),
      setTimeout(() => warm(secondary), 700),
      setTimeout(() => warm(later), 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [me, adminView, canFinance, tabs]);

  if (loading) return <Shell><InitialAppSkeleton /></Shell>;
  if (error) return <Shell><Center>Couldn't connect: {error}</Center></Shell>;

  const openTab = (nextTab) => {
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
    loaderForTab(nextTab)?.();
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
    if (page === "reports" && adminView) return <Reports setTab={openTab} />;
    if (page === "meetings" && adminView) return <Meetings />;
    if (page === "settings" && adminView) return <Settings admin={me.admin} />;
    return null;
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
          <button key={t} onClick={() => openTab(t)} style={{ background: "none", border: "none", cursor: "pointer", color: tab === t ? "#1F3D2B" : "#7A8078", fontSize: 14, fontWeight: tab === t ? 600 : 500, paddingBottom: 6, whiteSpace: "nowrap", borderBottom: tab === t ? "2px solid #C98A4B" : "2px solid transparent", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, width: "100%", maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        {tabs.filter((page) => mountedTabs.has(page)).map((page) => (
          <div
            key={`${mode}:${page}`}
            className={`page-panel${tab === page ? " page-panel--active" : ""}`}
            style={{ display: tab === page ? "block" : "none" }}
            aria-hidden={tab !== page}
          >
            <Suspense fallback={tab === page ? <PageSkeleton /> : null}>
              {renderPage(page)}
            </Suspense>
          </div>
        ))}
      </div>
    </Shell>
  );
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
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 20, width: "100%", maxWidth: 480, margin: "0 auto" }}>
        <PageSkeleton />
      </div>
    </>
  );
}

function modeButton(active) {
  return { border: "none", borderRadius: 9, padding: "9px 10px", background: active ? "#1F3D2B" : "transparent", color: active ? "#F7F5EF" : "#6B7268", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}

function Shell({ children, isAdmin, isMember, mode, me }) {
  return (
    <div style={{ fontFamily: "'Fraunces','Georgia',serif", background: "#F7F5EF", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", color: "#1F2A22" }}>
      <div className="sans" style={{ flexShrink: 0, background: "#17212B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", fontSize: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><ChevronLeft size={18} /><span style={{ fontWeight: 600 }}>Fund Bot</span></div>
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
