import { currentMonthValue } from "./date";

const KEY="fund_admin_report_month";

export function getAdminReportMonth(){
  try{
    const value=sessionStorage.getItem(KEY);
    return /^\d{4}-\d{2}$/.test(value||"") ? value : currentMonthValue();
  }catch{return currentMonthValue();}
}

export function saveAdminReportMonth(value){
  if(!/^\d{4}-\d{2}$/.test(String(value||"")))return;
  try{sessionStorage.setItem(KEY,String(value));}catch{}
}
