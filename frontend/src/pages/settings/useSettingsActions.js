import { api } from "../../api";
import { todayValue } from "../../utils/date";
import { sendExportToTelegram } from "../../utils/exports";

export function useSettingsActions({
  settings,setSettings,setMessage,closeCheck,setCloseCheck,setCloseBusy,closeMonthValue,
  currentMonth,load,setCloseMonthValue,closures,
}) {
  const saveSetting=async(key,value)=>{
    try{
      await api.settings.update({[key]:String(value)});
      setSettings(current=>({...current,[key]:String(value)}));
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

  const monthLabel = (month) => new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`));

  const closeMonth=async()=>{
    const check=closeCheck || await api.governance.monthCloseCheck(closeMonthValue);
    if((check.blockers||[]).length) return setMessage(`Cannot close month: ${check.blockers.join(", ")}`);
    const label = monthLabel(closeMonthValue);
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

  const shiftCloseMonth = (delta) => {
    const [y,m]=closeMonthValue.split("-").map(Number);
    const d=new Date(Date.UTC(y,m-1+delta,1));
    const next=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    if(next>currentMonth) return;
    setCloseMonthValue(next);
    setCloseCheck(null);
  };

  const monthClosed = closures.some(x=>x.month===closeMonthValue);

  return {saveSetting,reviewMonthClose,closeMonth,backup,monthLabel,shiftCloseMonth,monthClosed};
}
