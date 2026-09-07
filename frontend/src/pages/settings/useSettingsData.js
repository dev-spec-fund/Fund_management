import { useCallback, useEffect, useRef, useState } from "react";
import { api, onDataChange } from "../../api";
import { currentMonthValue } from "../../utils/date";

export function useSettingsData({ admin, role, superAdmin, financeAdmin, initialSection = "general", deferCore = false }) {
  const [settings,setSettings]=useState({});
  const [admins,setAdmins]=useState([]);
  const [audit,setAudit]=useState([]);
  const [health,setHealth]=useState(null);
  const [closures,setClosures]=useState([]);
  const [errors,setErrors]=useState([]);
  const [message,setMessage]=useState("");
  const [settingsSection,setSettingsSection]=useState(initialSection);
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
  const [settingsLoading,setSettingsLoading]=useState(!deferCore && initialSection!=="audit");
  const [settingsError,setSettingsError]=useState("");
  const loadedSections=useRef(new Set());

  const loadCore=useCallback(async({showLoading=false}={})=>{
    if(showLoading) setSettingsLoading(true);
    setSettingsError("");
    try{
      const core=await api.settings.get();
      setSettings(core || {});
    }catch(e){
      setSettingsError(e?.message || "Unable to load settings");
    }finally{
      if(showLoading) setSettingsLoading(false);
    }
  },[]);

  const loadSection=useCallback(async(section,{force=false}={})=>{
    if(!section || (!force && loadedSections.current.has(section))) return;
    const jobs=[];
    const safe=(promise,setter)=>promise.then(setter).catch(e=>setMessage(e?.message || "Unable to load settings data"));

    if(section==="categories") jobs.push(safe(api.expenses.categories(),setCategories));
    if(section==="financial") jobs.push(safe(api.governance.monthClosures(),setClosures));
    if(section==="admins") {
      jobs.push(safe(api.settings.admins(),setAdmins));
      if(superAdmin){
        jobs.push(safe(api.members.list(),setMembersForAdmin));
        jobs.push(safe(api.settings.roles(),setCustomRoles));
      }
    }
    if(section==="reminders" || section==="system") jobs.push(safe(api.admin.health(),setHealth));
    if(section==="system" && superAdmin) jobs.push(safe(api.admin.errors(),setErrors));
    if(section==="audit" && financeAdmin) jobs.push(safe(api.settings.auditLog(),setAudit));

    await Promise.allSettled(jobs);
    loadedSections.current.add(section);
  },[superAdmin,financeAdmin]);

  const load=useCallback(async()=>{
    await loadCore();
    loadedSections.current.delete(settingsSection);
    await loadSection(settingsSection,{force:true});
  },[loadCore,loadSection,settingsSection]);

  useEffect(()=>{
    // The Settings directory does not need to wait for every admin dataset.
    // Load only the core settings in the background; section-specific data is fetched on demand.
    if(initialSection==="audit") {
      setSettingsLoading(false);
      return;
    }
    loadCore({showLoading:!deferCore});
  },[admin?.id,role,initialSection,deferCore,loadCore]);

  useEffect(()=>{
    loadSection(settingsSection);
  },[settingsSection,admin?.id,loadSection]);

  useEffect(()=>onDataChange(({path})=>{
    if(path?.startsWith("/api/settings")){
      loadCore();
      if(settingsSection==="admins") { loadedSections.current.delete("admins"); loadSection("admins",{force:true}); }
      return;
    }
    if(path?.startsWith("/api/expenses/categories") && settingsSection==="categories") {
      loadedSections.current.delete("categories"); loadSection("categories",{force:true});
    }
    if(path?.startsWith("/api/governance/month-close") && settingsSection==="financial") {
      loadedSections.current.delete("financial"); loadSection("financial",{force:true});
    }
    if(path?.startsWith("/api/admin/errors") && settingsSection==="system") {
      loadedSections.current.delete("system"); loadSection("system",{force:true});
    }
  }),[admin?.id,role,settingsSection,loadCore,loadSection]);

  return {
    settings,setSettings,admins,setAdmins,audit,setAudit,health,setHealth,closures,setClosures,
    errors,setErrors,message,setMessage,settingsSection,setSettingsSection,categories,setCategories,
    membersForAdmin,setMembersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,
    customRoles,setCustomRoles,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,
    closeCheck,setCloseCheck,closeBusy,setCloseBusy,closeMonthValue,setCloseMonthValue,
    closurePage,setClosurePage,errorPage,setErrorPage,errorFilter,setErrorFilter,auditPage,setAuditPage,
    settingsLoading,settingsError,load,loadSection,
  };
}
