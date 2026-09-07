import React, { useEffect, useState } from "react";
import { ArrowLeft, Bell, ChevronRight, CircleDollarSign, FolderCog, Landmark, Settings2, ShieldCheck, Wrench } from "lucide-react";
import { useConfirmDialog } from "../components/FormControls";
import { LoadingState, ErrorState, MessageBanner } from "../components/Shared";
import { currentMonthValue } from "../utils/date";
import { pageSlice } from "../components/Pagination";
import { adminCan } from "../utils/permissions";
import { GeneralSettingsSection, ContributionSettingsSection, ExpenseCategorySettingsSection, ReminderSettingsSection, MonthManagementSettingsSection, AdminSettingsSection, SystemSettingsSection, AuditSettingsSection } from "./settings/SettingsSections";
import { useSettingsData } from "./settings/useSettingsData";
import { useSettingsActions } from "./settings/useSettingsActions";

export default function Settings({ admin, adminMonth, onAdminMonthChange, initialSection = "general", sectionOnly = false }) {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const role = admin?.role === "owner" ? "super_admin" : admin?.role;
  const superAdmin = adminCan(admin, "manage_admins");
  const financeAdmin = adminCan(admin, "finance");
  const canCloseMonth = adminCan(admin, "close_month");
  const canBackup = adminCan(admin, "backup");
  const currentMonth = currentMonthValue();
  const [settingsMenuOpen,setSettingsMenuOpen]=useState(()=>!sectionOnly && initialSection==="general");

  const data=useSettingsData({admin,role,superAdmin,financeAdmin,initialSection});
  useEffect(()=>{
    if(adminMonth && adminMonth!==data.closeMonthValue){
      data.setCloseMonthValue(adminMonth);
      data.setCloseCheck(null);
    }
  },[adminMonth]);
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

  const settingsCategories=[
    {key:"general",label:"General",description:"Organization name and app branding",icon:Settings2,tone:"general"},
    {key:"contributions",label:"Contributions",description:"Contribution amount, rules and allocations",icon:CircleDollarSign,tone:"contributions"},
    {key:"reminders",label:"Reminders",description:"Monthly contribution reminder schedule",icon:Bell,tone:"reminders"},
    {key:"categories",label:"Categories",description:"Expense categories and classification",icon:FolderCog,tone:"categories"},
    {key:"financial",label:"Financial",description:"Month closing and financial controls",icon:Landmark,tone:"financial"},
    {key:"admins",label:"Admins & Roles",description:"Administrators, roles and permissions",icon:ShieldCheck,tone:"admins"},
    {key:"system",label:"System",description:"Backup, health and diagnostics",icon:Wrench,tone:"system"},
  ];
  const activeCategory=settingsCategories.find(item=>item.key===settingsSection) || settingsCategories[0];
  const filteredErrors=errors.filter(e=>errorFilter==="all"?true:errorFilter==="resolved"?e.status==="resolved":e.status!=="resolved");
  const errorRows=pageSlice(filteredErrors,errorPage);
  const auditRows=pageSlice(audit,auditPage);

  const shiftSharedCloseMonth=(delta)=>{
    const [y,m]=String(closeMonthValue).split("-").map(Number);
    const d=new Date(Date.UTC(y,m-1+delta,1));
    const value=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    if(value>currentMonth)return;
    setCloseMonthValue(value);
    setCloseCheck(null);
    onAdminMonthChange?.(value);
  };

  const sectionProps={
    settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,
    closeBusy,shiftCloseMonth:shiftSharedCloseMonth,closeMonthValue,setCloseMonthValue:(value)=>{setCloseMonthValue(value);onAdminMonthChange?.(value);},setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,
    newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,
    health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage
  };

  return <>
    <MessageBanner>{message}</MessageBanner>

    {!sectionOnly && settingsMenuOpen && <section className="settings-directory">
      <div className="settings-directory-head">
        <div>
          <div className="settings-eyebrow">SETTINGS</div>
          <h2>Settings</h2>
          <p>Manage your fund, administration and application preferences.</p>
        </div>
      </div>
      <div className="settings-directory-list">
        {settingsCategories.map(({key,label,description,icon:Icon,tone})=>
          <button key={key} type="button" className="settings-directory-row" onClick={()=>{setSettingsSection(key);setSettingsMenuOpen(false);}}>
            <span className={`settings-directory-icon ${tone}`}><Icon size={19} strokeWidth={1.9}/></span>
            <span className="settings-directory-copy">
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <ChevronRight size={18} className="settings-directory-chevron" aria-hidden="true"/>
          </button>
        )}
      </div>
    </section>}

    {!sectionOnly && !settingsMenuOpen && <div className="settings-detail-nav">
      <button type="button" className="settings-back-button" onClick={()=>setSettingsMenuOpen(true)}>
        <ArrowLeft size={17} aria-hidden="true"/>
        <span>Settings</span>
      </button>
      <span className="settings-current-section">{activeCategory.label}</span>
    </div>}

    {(sectionOnly || !settingsMenuOpen) && settingsSection==="general" && <GeneralSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="contributions" && <ContributionSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="reminders" && <ReminderSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="categories" && <ExpenseCategorySettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="financial" && <MonthManagementSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="admins" && <AdminSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="system" && <SystemSettingsSection {...sectionProps} />}
    {(sectionOnly || !settingsMenuOpen) && settingsSection==="audit" && <AuditSettingsSection {...sectionProps} />}
    {confirmationDialog}
  </>;
}
