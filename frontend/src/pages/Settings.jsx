import React, { useEffect, useState } from "react";
import { useConfirmDialog } from "../components/FormControls";
import { api, onDataChange } from "../api";
import { LoadingState, ErrorState, MessageBanner } from "../components/Shared";
import { currentMonthValue, todayValue } from "../utils/date";
import { sendExportToTelegram } from "../utils/exports";
import { pageSlice } from "../components/Pagination";
import { adminCan } from "../utils/permissions";
import { GeneralSettingsSection, AdminSettingsSection, SystemSettingsSection, AuditSettingsSection } from "./settings/SettingsSections";


export default function Settings({ admin }) {
  const { confirm, confirmationDialog } = useConfirmDialog();
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
  const [customRoles,setCustomRoles]=useState([]);
  const [newRoleName,setNewRoleName]=useState("");
  const [newRolePermissions,setNewRolePermissions]=useState(["read"]);
  const [closeCheck,setCloseCheck]=useState(null);
  const [closeBusy,setCloseBusy]=useState(false);
  const [closeMonthValue,setCloseMonthValue]=useState(currentMonthValue());
  const [closurePage,setClosurePage]=useState(1);
  const [errorPage,setErrorPage]=useState(1);
  const [errorFilter,setErrorFilter]=useState("open");
  const [auditPage,setAuditPage]=useState(1);

  const role = admin?.role === "owner" ? "super_admin" : admin?.role;
  const superAdmin = adminCan(admin, "manage_admins");
  const financeAdmin = adminCan(admin, "finance");
  const canCloseMonth = adminCan(admin, "close_month");
  const canBackup = adminCan(admin, "backup");
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

    // Keep initial Settings load lightweight. Heavy diagnostics/history are
    // fetched only when the user opens their section below.
    const jobs=[
      api.settings.admins().then(setAdmins),
      api.expenses.categories().then(setCategories),
      api.governance.monthClosures().then(setClosures),
    ];
    if(superAdmin){
      jobs.push(api.members.list().then(setMembersForAdmin));
      jobs.push(api.settings.roles().then(setCustomRoles));
    }
    await Promise.allSettled(jobs);
  };

  useEffect(()=>{ load(); },[admin?.id,role]);

  // System diagnostics are intentionally lazy: opening General/Admins/Audit no
  // longer triggers Telegram health checks or reads the error log.
  useEffect(()=>{
    if(settingsSection!=="system") return;
    api.admin.health().then(setHealth).catch(e=>setMessage(e.message));
    if(superAdmin) api.admin.errors().then(setErrors).catch(e=>setMessage(e.message));
  },[settingsSection,superAdmin,admin?.id]);

  // Audit history can be large, so load it only when the Audit section is used.
  useEffect(()=>{
    if(settingsSection!=="audit" || !financeAdmin) return;
    api.settings.auditLog().then(setAudit).catch(e=>setMessage(e.message));
  },[settingsSection,financeAdmin,admin?.id]);
  useEffect(()=>onDataChange(({path})=>{
    if(
      path?.startsWith("/api/settings") ||
      path?.startsWith("/api/expenses/categories") ||
      path?.startsWith("/api/governance/month-close") ||
      path?.startsWith("/api/admin/errors")
    ) load();
  }),[admin?.id,role]);

  if(settingsLoading)return <LoadingState>Loading settings…</LoadingState>;
  if(settingsError && !Object.keys(settings||{}).length) return <ErrorState onRetry={load}>{settingsError}</ErrorState>;

  const saveSetting=async(key,value)=>{
    try{
      await api.settings.update({[key]:String(value)});
      setSettings({...settings,[key]:String(value)});
      setMessage("Changes saved");
      setTimeout(()=>setMessage(""),1800);
    }catch(e){ setMessage(e.message); }
  };

  const reviewMonthClose=async()=>{
    setCloseBusy(true); setCloseCheck(null);
    try{ setCloseCheck(await api.governance.monthCloseCheck(closeMonthValue)); }
    catch(e){ setMessage(e.message); }
    finally{ setCloseBusy(false); }
  };

  const closeMonth=async()=>{
    const check=closeCheck || await api.governance.monthCloseCheck(closeMonthValue);
    if((check.blockers||[]).length) return setMessage(`Cannot close month: ${check.blockers.join(", ")}`);
    const label = new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${closeMonthValue}-01T00:00:00Z`));
    const pastNote = closeMonthValue < currentMonth ? "\n\nThis is a past open month. September/current-month transactions will not be changed." : "";
    const note=window.prompt(`Close ${label}?${pastNote}\n\nA permanent monthly balance snapshot will be created. Optional closing note:`,"Closed from Fund App");
    if(note===null) return;
    setCloseBusy(true);
    try{
      await api.governance.closeMonth(closeMonthValue,note);
      setCloseCheck(null); await load(); setMessage(`${label} closed and snapshot saved`);
    }catch(e){setMessage(e.message)} finally{setCloseBusy(false)}
  };

  const backup=async()=>{
    try{
      const data=await api.admin.backup();
      const slug=String(settings?.short_name||"fund").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"fund";
      const filename=`${slug}-fund-backup-${todayValue()}.json`;
      await sendExportToTelegram(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),filename,`${settings?.fund_name||"Fund"} · Super Admin database backup`);
      setMessage("Backup sent to your Telegram chat");
    }catch(e){setMessage(e.message)}
  };

  const monthClosed = closures.some(x=>x.month===closeMonthValue);
  const monthLabel = (month) => new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`));
  const shiftCloseMonth = (delta) => {
    const [y,m]=closeMonthValue.split("-").map(Number);
    const d=new Date(Date.UTC(y,m-1+delta,1));
    const next=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    if(next>currentMonth) return;
    setCloseMonthValue(next);
    setCloseCheck(null);
  };
  const tabs=[["general","General"],["admins","Admins"],["system","System"],...(financeAdmin?[["audit","Audit"]]:[])];
  const filteredErrors=errors.filter(e=>errorFilter==="all"?true:errorFilter==="resolved"?e.status==="resolved":e.status!=="resolved");
  const errorRows=pageSlice(filteredErrors,errorPage);
  const auditRows=pageSlice(audit,auditPage);

  const sectionProps={
    settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,
    closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,
    newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,
    health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage
  };

  return <>
    <MessageBanner>{message}</MessageBanner>

    <div className="settings-subnav-sticky page-sticky-controls">
      <div className="settings-subnav-scroll">
        {tabs.map(([key,label])=>
          <button key={key} type="button" onClick={()=>setSettingsSection(key)} className="sans"
            style={{flex:"0 0 auto",border:`1px solid ${settingsSection===key?"var(--primary)":"var(--border-2)"}`,background:settingsSection===key?"var(--primary)":"var(--card)",color:settingsSection===key?"var(--on-primary)":"var(--muted)",borderRadius:20,padding:"7px 13px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
            {label}
          </button>
        )}
      </div>
    </div>

    {settingsSection==="general" && <GeneralSettingsSection {...sectionProps} />}

    {settingsSection==="admins" && <AdminSettingsSection {...sectionProps} />}

    {settingsSection==="system" && <SystemSettingsSection {...sectionProps} />}

    {settingsSection==="audit" && <AuditSettingsSection {...sectionProps} />}

        {confirmationDialog}
  </>;
}

