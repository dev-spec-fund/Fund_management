import React, { Suspense, lazy, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "./api";
import { Center } from "./components/Shared";
import Overview from "./pages/Overview";
const Members = lazy(() => import("./pages/Members"));
const Reports = lazy(() => import("./pages/Reports"));
const PendingApprovals = lazy(() => import("./pages/PendingApprovals"));
const Meetings = lazy(() => import("./pages/Meetings"));
const Settings = lazy(() => import("./pages/Settings"));
const MyHistory = lazy(() => import("./pages/MemberViews").then((m) => ({ default: m.MyHistory })));
const FundView = lazy(() => import("./pages/MemberViews").then((m) => ({ default: m.FundView })));
const Activity = lazy(() => import("./pages/MemberViews").then((m) => ({ default: m.Activity })));

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bootstrapSummary, setBootstrapSummary] = useState(null);
  const [tab, setTab] = useState("overview");
  const [mode, setMode] = useState("member");

  useEffect(() => {
    // Start the safe overview request immediately so it overlaps the /me round-trip.
    api.reports.publicSummary().then(setBootstrapSummary).catch(() => {});
    api.me()
      .then((data) => { setMe(data); setMode(data?.admin ? "admin" : "member"); })
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
  const changeMode = (nextMode) => { setMode(nextMode); setTab("overview"); };

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
          <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", cursor: "pointer", color: tab === t ? "#1F3D2B" : "#7A8078", fontSize: 14, fontWeight: tab === t ? 600 : 500, paddingBottom: 6, whiteSpace: "nowrap", borderBottom: tab === t ? "2px solid #C98A4B" : "2px solid transparent", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, width: "100%", maxWidth: 480, margin: "0 auto", boxSizing: "border-box" }}>
        <Suspense fallback={<Center>Loading…</Center>}>
          {tab === "overview" && <Overview isAdmin={adminView} canFinance={canFinance} setTab={setTab} bootstrapSummary={bootstrapSummary} />}
          {tab === "pending" && canFinance && <PendingApprovals />}
          {tab === "members" && adminView && <Members isAdmin admin={me.admin} />}
          {tab === "history" && memberView && <MyHistory member={me.member} />}
          {tab === "fund" && memberView && <FundView />}
          {tab === "activity" && <Activity isAdmin={adminView} canFinance={canFinance} />}
          {tab === "reports" && adminView && <Reports setTab={setTab} />}
          {tab === "meetings" && adminView && <Meetings />}
          {tab === "settings" && adminView && <Settings admin={me.admin} />}
        </Suspense>
      </div>
    </Shell>
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
