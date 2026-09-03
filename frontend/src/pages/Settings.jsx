import React from "react";
import { useConfirmDialog } from "../components/FormControls";
import { LoadingState, ErrorState, MessageBanner } from "../components/Shared";
import { currentMonthValue } from "../utils/date";
import { pageSlice } from "../components/Pagination";
import { adminCan } from "../utils/permissions";
import { GeneralSettingsSection, AdminSettingsSection, SystemSettingsSection, AuditSettingsSection } from "./settings/SettingsSections";
import { useSettingsData } from "./settings/useSettingsData";
import { useSettingsActions } from "./settings/useSettingsActions";

export default function Settings({ admin }) {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const role = admin?.role === "owner" ? "super_admin" : admin?.role;
  const superAdmin = adminCan(admin, "manage_admins");
  const financeAdmin = adminCan(admin, "finance");
  const canCloseMonth = adminCan(admin, "close_month");
  const canBackup = adminCan(admin, "backup");
  const currentMonth = currentMonthValue();

  const data=useSettingsData({admin,role,superAdmin,financeAdmin});
  const {
    settings,setSettings,admins,audit,setAudit,health,setHealth,closures,errors,setErrors,message,setMessage,
    settingsSection,setSettingsSection,categories,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,
    customRoles,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,closeCheck,setCloseCheck,closeBusy,
    closeMonthValue,setCloseMonthValue,closurePage,setClosurePage,errorPage,setErrorPage,errorFilter,setErrorFilter,
    auditPage,setAuditPage,settingsLoading,settingsError,load,
  }=data;

  const {saveSetting,reviewMonthClose,closeMonth,backup,monthLabel,shiftCloseMonth,monthClosed}=useSettingsActions({
    settings,setSettings,setMessage,closeCheck,setCloseCheck,setCloseBusy:data.setCloseBusy,closeMonthValue,currentMonth,load,setCloseMonthValue,closures,
  });

  if(settingsLoading)return <LoadingState>Loading settings…</LoadingState>;
  if(settingsError && !Object.keys(settings||{}).length) return <ErrorState onRetry={load}>{settingsError}</ErrorState>;

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
