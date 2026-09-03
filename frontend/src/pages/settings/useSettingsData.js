import { useCallback, useEffect, useState } from "react";
import { api, onDataChange } from "../../api";
import { currentMonthValue } from "../../utils/date";

export function useSettingsData({ admin, role, superAdmin, financeAdmin }) {
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
  const [settingsLoading,setSettingsLoading]=useState(true);
  const [settingsError,setSettingsError]=useState("");

  const load=useCallback(async()=>{
    setSettingsLoading(true);
    setSettingsError("");
    try{
      const core=await api.settings.get();
      setSettings(core || {});
    }catch(e){
      setSettingsError(e?.message || "Unable to load settings");
      setSettings({});
    }finally{
      setSettingsLoading(false);
    }

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
  },[superAdmin]);

  useEffect(()=>{ load(); },[admin?.id,role,load]);

  useEffect(()=>{
    if(settingsSection!=="system") return;
    api.admin.health().then(setHealth).catch(e=>setMessage(e.message));
    if(superAdmin) api.admin.errors().then(setErrors).catch(e=>setMessage(e.message));
  },[settingsSection,superAdmin,admin?.id]);

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
  }),[admin?.id,role,load]);

  return {
    settings,setSettings,admins,setAdmins,audit,setAudit,health,setHealth,closures,setClosures,
    errors,setErrors,message,setMessage,settingsSection,setSettingsSection,categories,setCategories,
    membersForAdmin,setMembersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,
    customRoles,setCustomRoles,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,
    closeCheck,setCloseCheck,closeBusy,setCloseBusy,closeMonthValue,setCloseMonthValue,
    closurePage,setClosurePage,errorPage,setErrorPage,errorFilter,setErrorFilter,auditPage,setAuditPage,
    settingsLoading,settingsError,load,
  };
}
