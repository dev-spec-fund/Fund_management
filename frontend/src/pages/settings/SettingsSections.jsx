import React, { useEffect, useMemo, useState } from "react";
import { Plus, AlertTriangle, Ban, Bell, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock3, Search, SlidersHorizontal, UserRound, X, ShieldCheck, UserPlus, MoreHorizontal } from "lucide-react";
import { api } from "../../api";
import { SectionTitle, EmptyLine, cardStyle, compactBtn, approveBtn, rejectBtn } from "../../components/Shared";
import Pagination, { pageSlice } from "../../components/Pagination";
import { formatLocalDateTime } from "../../utils/date";

const AUDIT_HIDDEN_KEYS = new Set(["ocr_raw","slip_file_id","file_id","telegram_file_id","photo_file_id","raw","ai_response","model_response","prompt"]);
const auditLabel = (s="") => s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const auditValue = (v) => { if (v == null || v === "") return null; if (typeof v === "number" && Number.isFinite(v)) return String(v); if (typeof v === "boolean") return v ? "Yes" : "No"; if (typeof v === "string") return v.length > 90 ? `${v.slice(0,90)}…` : v; return null; };
function cleanAuditObject(v, depth=0) { if (!v || typeof v !== "object" || depth > 3) return v; if (Array.isArray(v)) return v.slice(0,10).map(x=>cleanAuditObject(x,depth+1)); return Object.fromEntries(Object.entries(v).filter(([k])=>!AUDIT_HIDDEN_KEYS.has(k.toLowerCase())).map(([k,x])=>[k,cleanAuditObject(x,depth+1)])); }
function auditSummary(detail) { let d=detail; if (typeof d === "string") { try { d=JSON.parse(d); } catch { return [{label:"Details",value:d.slice(0,140)}]; } } d=cleanAuditObject(d); if (!d || typeof d !== "object") return []; const after=d.after && typeof d.after==="object" ? d.after : {}; const before=d.before && typeof d.before==="object" ? d.before : {}; const preferred=["member_code","txn_id","donor_name","description","amount","expense_date","month","transaction_month","ref_number","status","role","name","note","reason"]; const rows=[]; if (d.entity) rows.push({label:"Record",value:`${auditLabel(String(d.entity))}${d.entity_id!=null?` #${d.entity_id}`:""}`}); for (const key of preferred) { const av=auditValue(after[key]), bv=auditValue(before[key]); if (av!=null && bv!=null && av!==bv) rows.push({label:auditLabel(key),value:`${bv} → ${av}`}); else if (av!=null) rows.push({label:auditLabel(key),value:av}); if (rows.length>=5) break; } return rows; }
function AuditEntry({a}) {
  const rows=auditSummary(a.detail);
  const [open,setOpen]=useState(false);
  const actor=a.admin_name || "system";
  const preview=rows[0]?.value;
  return <div className={`sans admin-audit-row${open?" open":""}`}>
    <button type="button" className="admin-audit-summary" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span className="admin-audit-dot" aria-hidden="true"/>
      <span className="admin-audit-summary-main">
        <span className="admin-audit-summary-line">
          <b className="admin-audit-action">{auditLabel(a.action)}</b>
          <time>{formatLocalDateTime(a.created_at)}</time>
        </span>
        <span className="admin-audit-meta">{preview?`${preview} · `:""}by {actor}</span>
      </span>
      <ChevronDown size={16} className="admin-audit-chevron" aria-hidden="true"/>
    </button>
    {open&&rows.length>0&&<div className="admin-audit-details">{rows.map((r,i)=><div key={`${r.label}-${i}`}><span>{r.label}</span><strong>{r.value}</strong></div>)}</div>}
  </div>;
}

export function GeneralSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>
      <SectionTitle>ORGANIZATION</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:5}}>Group Name</div>
        <input disabled={!superAdmin} value={settings.fund_name ?? ""} onChange={e=>setSettings({...settings,fund_name:e.target.value})} onBlur={e=>superAdmin&&e.target.value.trim()&&saveSetting("fund_name",e.target.value.trim())} className="sans" placeholder="Organization / group name" style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border-strong)",borderRadius:9,padding:"10px 11px",fontSize:13,background:"var(--bg)",color:"var(--text)"}}/>
        <div className="sans" style={{fontSize:12,color:"var(--muted)",margin:"12px 0 5px"}}>Short Name</div>
        <input disabled={!superAdmin} maxLength={20} value={settings.short_name ?? ""} onChange={e=>setSettings({...settings,short_name:e.target.value})} onBlur={e=>superAdmin&&e.target.value.trim()&&saveSetting("short_name",e.target.value.trim())} className="sans" placeholder="e.g. KYS" style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border-strong)",borderRadius:9,padding:"10px 11px",fontSize:13,background:"var(--bg)",color:"var(--text)"}}/>
        <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:7}}>Used automatically in Telegram messages, reports, statements, backups and compact app branding.</div>
      </div>


  </>;
}

export function ContributionSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>
      <SectionTitle>MEMBER CONTRIBUTIONS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:5}}>Default monthly contribution</div>
        <div style={{display:"flex",alignItems:"center",border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--card)"}}>
          <span className="sans" style={{paddingLeft:11,fontSize:12,color:"var(--soft)"}}>MVR</span>
          <input disabled={!superAdmin} type="number" value={settings.default_monthly_amount ?? ""} onChange={e=>setSettings({...settings,default_monthly_amount:e.target.value})} onBlur={e=>superAdmin&&saveSetting("default_monthly_amount",e.target.value)} className="sans" style={{flex:1,border:0,outline:"none",padding:"9px 11px",fontSize:14,background:"transparent"}}/>
        </div>
        <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:6}}>Used automatically for new members. Existing member amounts are not changed.</div>

        <div className="sans" style={{fontSize:12,color:"var(--muted)",margin:"14px 0 5px"}}>New member first-month rule</div>
        <select
          disabled={!superAdmin}
          value={settings.first_month_contribution_rule || "half_after_15"}
          onChange={e=>superAdmin&&saveSetting("first_month_contribution_rule",e.target.value)}
          className="sans"
          style={{width:"100%",border:"1px solid var(--border-strong)",borderRadius:9,padding:"10px 11px",fontSize:13,background:"var(--bg)",color:"var(--text)"}}
        >
          <option value="half_after_15">Full through day 15 · Half after day 15</option>
          <option value="full">Full contribution for join month</option>
          <option value="next_month">Start contribution from next month</option>
        </select>
        <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:6,lineHeight:1.45}}>
          Default: members joining on days 1–15 pay the full amount; members joining on day 16 or later pay 50% for that first month. Following months use the full monthly contribution.
        </div>
      </div>


  </>;
}

export function ExpenseCategorySettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>
      <SectionTitle>EXPENSE CATEGORIES</SectionTitle>
      <div style={cardStyle}>
        {categories.map(cat=><div key={cat.id} className="sans" style={{display:"flex",alignItems:"center",gap:7,padding:"8px 0",borderBottom:"1px solid var(--divider)",opacity:Number(cat.active)===0?.55:1}}>
          <span style={{flex:1,fontSize:12,fontWeight:600}}>{cat.name}{Number(cat.active)===0?" · Inactive":""}</span>
          {financeAdmin&&<><button type="button" style={compactBtn} onClick={async()=>{const name=prompt("Category name",cat.name);if(!name||name===cat.name)return;try{await api.expenses.updateCategory(cat.id,{name});load()}catch(e){setMessage(e.message)}}}>Edit</button>
          <button type="button" style={compactBtn} onClick={async()=>{try{await api.expenses.updateCategory(cat.id,{active:Number(cat.active)===0});load()}catch(e){setMessage(e.message)}}}>{Number(cat.active)===0?"Activate":"Deactivate"}</button>
          <button type="button" style={{...compactBtn,color:"var(--danger)"}} onClick={async()=>{if(!await confirm({title:"Delete expense category?",message:`Delete ${cat.name}? If it has historical expenses it will be deactivated instead.`,confirmLabel:"Delete"}))return;try{await api.expenses.removeCategory(cat.id);load()}catch(e){setMessage(e.message)}}}>Delete</button></>}
        </div>)}
        {financeAdmin&&<button type="button" style={{...approveBtn,width:"100%",marginTop:10}} onClick={async()=>{const name=prompt("New expense category name");if(!name)return;try{await api.expenses.addCategory(name);load()}catch(e){setMessage(e.message)}}}><Plus size={15}/> Add category</button>}
      </div>


  </>;
}

export function ReminderSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>
      <SectionTitle>PAYMENT REMINDERS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--primary-text)"}}>Automatic reminders</div>
            <div style={{fontSize:10,color:"var(--soft)",marginTop:3}}>Once-monthly Telegram reminder to unpaid and partially paid members.</div>
          </div>
          <button type="button" disabled={!financeAdmin} onClick={()=>financeAdmin&&saveSetting("reminder_day",settings.reminder_day==="off"?"5":"off")}
            aria-label="Toggle automatic reminders"
            style={{width:42,height:24,border:0,borderRadius:999,padding:3,background:settings.reminder_day==="off"?"var(--toggle-off)":"var(--success)",cursor:"pointer"}}>
            <span style={{display:"block",width:18,height:18,borderRadius:999,background:"var(--card)",transform:settings.reminder_day==="off"?"translateX(0)":"translateX(18px)",transition:"transform .15s"}}/>
          </button>
        </div>

        {settings.reminder_day!=="off" && <>
          <div className="sans" style={{fontSize:11,color:"var(--muted)",marginBottom:5}}>Send automatically on</div>
          <select disabled={!financeAdmin} value={settings.reminder_day || "5"} onChange={e=>financeAdmin&&saveSetting("reminder_day",e.target.value)}
            className="sans" style={{width:"100%",border:"1px solid var(--border-strong)",borderRadius:9,padding:"10px 11px",fontSize:13,background:"var(--bg)"}}>
            {Array.from({length:28},(_,i)=>String(i+1)).map(d=><option key={d} value={d}>Day {d} of each month</option>)}
          </select>
          <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:6}}>Sent once per month on the selected day, to members who still have an outstanding balance. Automatic reminders will not repeat again during the same month.</div>
        </>}

        {settings.reminder_day==="off" && <div className="sans" style={{fontSize:11,color:"var(--soft)",background:"var(--bg)",borderRadius:9,padding:10}}>Automatic reminders are off. Manual reminders are still available.</div>}

        {health?.reminder_last_result && <div className="sans" style={{marginTop:10,background:"var(--bg)",borderRadius:9,padding:10,fontSize:11,color:"var(--muted)"}}>
          <div style={{fontWeight:700,color:"var(--primary-text)",marginBottom:5}}>Last automatic reminder · {health.reminder_last_result.month}</div>
          <div>Due {health.reminder_last_result.due || 0} · Sent {health.reminder_last_result.sent || 0} · Unlinked {health.reminder_last_result.unlinked || 0} · Failed {health.reminder_last_result.failed || 0}</div>
        </div>}

        {financeAdmin && <button type="button" onClick={async()=>{
          if(!await confirm({title:"Send payment reminders?",message:"Send payment reminders now to all members with an outstanding balance for the current month?",confirmLabel:"Send reminders",tone:"primary"})) return;
          try{
            setMessage("Sending reminders…");
            const r=await api.admin.sendPaymentReminders({month:currentMonth});
            setMessage(`Sent ${r.sent||0} payment reminder${Number(r.sent||0)===1?"":"s"}.`);
          }catch(e){setMessage(e.message)}
        }} style={{...approveBtn,width:"100%",marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Bell size={14}/> Send reminders now
        </button>}
      </div>


  </>;
}

export function MonthManagementSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>
      <SectionTitle>MONTH MANAGEMENT</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:11,color:"var(--muted)",marginBottom:7}}>Select the month to review or close</div>
        <div style={{display:"grid",gridTemplateColumns:"40px 1fr 40px",gap:8,alignItems:"center",marginBottom:10}}>
          <button type="button" disabled={closeBusy} onClick={()=>shiftCloseMonth(-1)} className="sans" aria-label="Previous month" style={{...compactBtn,height:40,padding:0,display:"grid",placeItems:"center"}}><ChevronLeft size={18}/></button>
          <input type="month" max={currentMonth} value={closeMonthValue} onChange={e=>{ if(!e.target.value || e.target.value>currentMonth)return; setCloseMonthValue(e.target.value); setCloseCheck(null); }} className="sans native-date-time-control native-month-control" style={{width:"100%",boxSizing:"border-box",height:40,border:"1px solid var(--border-strong)",borderRadius:9,padding:"0 10px",fontSize:16,background:"var(--bg)",color:"var(--text)"}}/>
          <button type="button" disabled={closeBusy || closeMonthValue>=currentMonth} onClick={()=>shiftCloseMonth(1)} className="sans" aria-label="Next month" style={{...compactBtn,height:40,padding:0,display:"grid",placeItems:"center"}}><ChevronRight size={18}/></button>
        </div>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,marginBottom:10}}>
          <span style={{color:"var(--muted)"}}>Selected month</span>
          <b>{monthLabel(closeMonthValue)}</b>
        </div>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12}}>
          <span style={{color:"var(--muted)"}}>Status</span>
          <span style={{fontWeight:700,color:monthClosed?"var(--danger)":"var(--success)"}}>{monthClosed?"Closed":"Open"}</span>
        </div>
        {closeMonthValue<currentMonth && !monthClosed && <div className="sans settings-inline-alert warning"><AlertTriangle size={14}/><span>{monthLabel(closeMonthValue)} is a past open month. You can review and close it now; the current month stays open.</span></div>}
        {superAdmin && !monthClosed && <button type="button" disabled={closeBusy} onClick={reviewMonthClose} style={{...rejectBtn,marginTop:12}}>{closeBusy?"Checking…":"Review month closing"}</button>}
        {canCloseMonth && monthClosed && <button type="button" onClick={()=>api.governance.reopenMonth(closeMonthValue).then(()=>{setCloseCheck(null);return load()}).catch(e=>setMessage(e.message))} style={{...approveBtn,marginTop:12}}>Reopen {monthLabel(closeMonthValue)}</button>}
      </div>

      {superAdmin && !monthClosed && closeCheck && <div style={{...cardStyle,marginTop:10,borderColor:(closeCheck.blockers||[]).length?"var(--danger-border)":"var(--success-border)"}}>
        <div className="sans" style={{fontSize:13,fontWeight:700,marginBottom:3}}>Monthly Closing Assistant</div>
        <div className="sans" style={{fontSize:10,color:"var(--muted)",marginBottom:8}}>{monthLabel(closeMonthValue)}</div>
        <div className="sans" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11,marginBottom:10}}>
          <div><span style={{color:"var(--soft)"}}>Opening balance</span><br/><b>MVR {Number(closeCheck.opening_balance||0).toLocaleString()}</b></div>
          <div><span style={{color:"var(--soft)"}}>Closing balance</span><br/><b>MVR {Number(closeCheck.closing_balance||0).toLocaleString()}</b></div>
          <div><span style={{color:"var(--soft)"}}>Collected</span><br/><b>MVR {Number(closeCheck.total_collected||0).toLocaleString()} / {Number(closeCheck.total_due||0).toLocaleString()}</b></div>
          <div><span style={{color:"var(--soft)"}}>Collection rate</span><br/><b>{Math.round(Number(closeCheck.collection_rate||0))}%</b></div>
        </div>
        {(closeCheck.blockers||[]).map((x,i)=><div key={`b-${i}`} className="sans settings-inline-alert danger"><Ban size={13}/><span>{x}</span></div>)}
        {(closeCheck.warnings||[]).map((x,i)=><div key={`w-${i}`} className="sans settings-inline-alert warning"><AlertTriangle size={13}/><span>{x}</span></div>)}
        {canCloseMonth && (closeCheck.blockers||[]).length===0 && <button type="button" disabled={closeBusy} onClick={closeMonth} style={{...rejectBtn,width:"100%",marginTop:12}}>Create snapshot & close month</button>}
      </div>}

      {closures.length>0 && <>
        <SectionTitle>CLOSED MONTHS</SectionTitle>
        <div style={cardStyle}>
          {pageSlice(closures,closurePage).rows.map(x=>
            <div key={x.month} className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,fontSize:11,padding:"7px 0",borderBottom:"1px solid var(--divider)"}}>
              <span><b>{x.month}</b><div style={{color:"var(--soft-2)",marginTop:2}}>by {x.closed_by_name || "admin"}</div></span>
              <div style={{display:"flex",gap:6}}>
                <button type="button" onClick={async()=>{try{const summary=await api.reports.summary(x.month);const {exportFundPdf}=await import("../../utils/exports");await exportFundPdf({month:x.month,monthLabel:monthLabel(x.month),summary});}catch(e){setMessage(e.message||"Could not create closed-month PDF")}}} style={compactBtn}>PDF</button>
                {canCloseMonth&&<button type="button" onClick={()=>api.governance.reopenMonth(x.month).then(load).catch(e=>setMessage(e.message))} style={compactBtn}>Reopen</button>}
              </div>
            </div>
          )}
          <Pagination page={pageSlice(closures,closurePage).page} total={closures.length} onChange={setClosurePage}/>
        </div>
      </>}

  </>;
}

export function AdminSettingsSection(ctx) {
  const {superAdmin,confirm,load,setMessage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,loadAdminSupport} = ctx;
  const [accessSheet,setAccessSheet]=useState(null);
  const permissionRows=[["read","Read access"],["finance","Finance access"],["manage_admins","Manage admins"],["close_month","Close / reopen month"],["backup","Database backup"]];
  const roleName=(a)=>a.custom_role_name || ((a.role==="owner"||a.role==="super_admin")?"Super Admin":a.role==="treasurer"?"Treasurer":"Viewer");
  const openPromote=()=>{ loadAdminSupport?.("members"); loadAdminSupport?.("roles"); setAccessSheet("promote"); };
  const openCreateRole=()=>{ loadAdminSupport?.("roles"); setAccessSheet("role"); };
  useEffect(()=>{
    if(!accessSheet)return undefined;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=e=>{if(e.key==="Escape")setAccessSheet(null)};
    window.addEventListener("keydown",onKey);
    return ()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",onKey)};
  },[accessSheet]);
  return <>
    <SectionTitle>ADMINS & ROLES</SectionTitle>
    <div className="settings-access-summary sans">
      <div><strong>{admins.filter(a=>a.active!==0).length}</strong><span>Active admins</span></div>
      <div><strong>{customRoles.length}</strong><span>Custom roles</span></div>
    </div>

    <div className="settings-access-section sans">
      <div className="settings-access-heading">
        <div><h3>Admins</h3><p>People with administrative access.</p></div>
        {superAdmin&&<button type="button" className="settings-inline-action-button" onClick={openPromote}><UserPlus size={17}/><span>Promote</span></button>}
      </div>
      <div className="settings-access-list">
        {admins.map(a=>{
          const displayRole=a.custom_role_id?`custom:${a.custom_role_id}`:(a.role==="owner"?"super_admin":a.role);
          return <details key={a.id} className="settings-access-item" onToggle={e=>{if(e.currentTarget.open)loadAdminSupport?.("roles");}}>
            <summary>
              <span className="settings-access-icon"><ShieldCheck size={18}/></span>
              <span className="settings-access-main"><strong>{a.member_name||a.name}</strong><small>{roleName(a)}{a.member_code?` · ${a.member_code}`:""}</small></span>
              <span className={`settings-access-state ${a.active===0?"inactive":""}`}>{a.active===0?"Inactive":"Active"}</span>
              <MoreHorizontal size={18} className="settings-access-more"/>
            </summary>
            {superAdmin&&<div className="settings-access-detail">
              <label>Role<select disabled={a.active===0} value={displayRole} onChange={async e=>{
                const value=e.target.value; const selected=value.startsWith("custom:")?customRoles.find(r=>String(r.id)===value.split(":")[1]):null; const label=selected?.name||e.target.options[e.target.selectedIndex].text;
                if(!await confirm({title:"Change admin role?",message:`Change ${a.name}'s role to ${label}?`,confirmLabel:"Change role",tone:"primary"}))return;
                api.settings.updateAdmin(a.id,{role:selected?"viewer":value,custom_role_id:selected?.id||null}).then(load).catch(err=>setMessage(err.message));
              }}><option value="super_admin">Super Admin</option><option value="treasurer">Treasurer</option><option value="viewer">Viewer</option>{customRoles.map(r=><option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</select></label>
              {a.member_id&&a.active!==0&&Number(a.id)!==Number(admin?.id)&&<button type="button" className="settings-danger-text" onClick={async()=>{
                if(!await confirm({title:"Demote admin?",message:`Demote ${a.member_name||a.name} to normal member?\n\nTheir member account, Telegram link, contribution history and payment obligations remain unchanged.`,confirmLabel:"Demote admin"}))return;
                try{await api.settings.demoteMember(a.id);setMessage(`${a.member_name||a.name} demoted to member`);load()}catch(e){setMessage(e.message)}
              }}>Demote to member</button>}
            </div>}
          </details>
        })}
      </div>
    </div>

    <div className="settings-access-section sans">
      <div className="settings-access-heading">
        <div><h3>Roles</h3><p>Open a role only when you need to edit permissions.</p></div>
        {superAdmin&&<button type="button" className="settings-inline-action-button" onClick={openCreateRole}><Plus size={17}/><span>Create</span></button>}
      </div>
      <div className="settings-access-list">
        <div className="settings-role-static"><span><strong>Super Admin</strong><small>Full system access</small></span><ShieldCheck size={18}/></div>
        <div className="settings-role-static"><span><strong>Treasurer</strong><small>Built-in finance role</small></span><ShieldCheck size={18}/></div>
        <div className="settings-role-static"><span><strong>Viewer</strong><small>Built-in read-only role</small></span><ShieldCheck size={18}/></div>
        {customRoles.map(r=><details key={r.id} className="settings-access-item settings-role-item">
          <summary><span className="settings-access-main"><strong>{r.name}</strong><small>{(r.permissions||[]).length} permissions · {Number(r.assigned_admins||0)} admin{Number(r.assigned_admins||0)===1?"":"s"}</small></span><MoreHorizontal size={18}/></summary>
          <div className="settings-access-detail settings-permission-list">{permissionRows.map(([key,label])=><label key={key}><span><strong>{label}</strong>{key==="read"&&<small>Always enabled</small>}</span><input type="checkbox" checked={(r.permissions||[]).includes(key)} disabled={key==="read"} onChange={async e=>{const next=e.target.checked?[...new Set([...(r.permissions||[]),key])]:(r.permissions||[]).filter(x=>x!==key);try{await api.settings.updateRole(r.id,{permissions:next});setMessage(`${r.name} permissions updated`);load()}catch(err){setMessage(err.message)}}}/></label>)}
            <button type="button" disabled={Number(r.assigned_admins||0)>0} className="settings-danger-text" onClick={async()=>{if(!await confirm({title:"Delete custom role?",message:`Delete custom role "${r.name}"?`,confirmLabel:"Delete role"}))return;try{await api.settings.removeRole(r.id);setMessage("Custom role removed");load()}catch(e){setMessage(e.message)}}}>{Number(r.assigned_admins||0)>0?"Role is in use":"Delete role"}</button>
          </div>
        </details>)}
      </div>
      <p className="settings-access-note">Custom roles override Treasurer/Viewer permissions. At least one built-in Super Admin must remain active.</p>
    </div>

    {accessSheet&&<div className="settings-access-sheet-layer" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setAccessSheet(null)}}>
      <section className="settings-access-sheet sans" role="dialog" aria-modal="true" aria-labelledby={`settings-${accessSheet}-title`}>
        <div className="settings-access-sheet-handle" aria-hidden="true"/>
        <div className="settings-access-sheet-head">
          <div>
            <h3 id={`settings-${accessSheet}-title`}>{accessSheet==="promote"?"Promote member":"Create role"}</h3>
            <p>{accessSheet==="promote"?"Give an existing member administrative access.":"Create a reusable role with only the permissions it needs."}</p>
          </div>
          <button type="button" className="settings-access-sheet-close" onClick={()=>setAccessSheet(null)} aria-label="Close"><X size={19}/></button>
        </div>

        {accessSheet==="promote"?<div className="settings-access-sheet-body">
          <label className="settings-sheet-field"><span>Member</span><select value={promoteMemberId} onChange={e=>setPromoteMemberId(e.target.value)}>
            <option value="">Select member…</option>{membersForAdmin.filter(m=>m.active!==0).map(m=><option key={m.id} value={m.id}>{m.name} · {m.member_code}{m.telegram_id?"":" · Telegram not linked"}</option>)}
          </select></label>
          <label className="settings-sheet-field"><span>Role</span><select value={promoteRole} onChange={e=>setPromoteRole(e.target.value)}>
            <option value="super_admin">Super Admin</option><option value="treasurer">Treasurer</option><option value="viewer">Viewer</option>
            {customRoles.map(r=><option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
          </select></label>
          <p className="settings-sheet-note">The member keeps their member account and contribution obligations. Telegram must be linked.</p>
          <button type="button" disabled={!promoteMemberId} className="settings-sheet-primary" onClick={async()=>{
            const m=membersForAdmin.find(x=>String(x.id)===String(promoteMemberId));
            const selected=promoteRole.startsWith("custom:")?customRoles.find(r=>String(r.id)===promoteRole.split(":")[1]):null;
            const label=selected?.name || promoteRole.replace("_"," ");
            if(!await confirm({title:"Promote member?",message:`Promote ${m?.name||"this member"} to ${label}?`,confirmLabel:"Promote",tone:"primary"}))return;
            try{await api.settings.promoteMember(Number(promoteMemberId),selected?"viewer":promoteRole,selected?.id||null);setPromoteMemberId("");setMessage("Member promoted");setAccessSheet(null);load()}catch(e){setMessage(e.message)}
          }}>Promote member</button>
        </div>:<div className="settings-access-sheet-body">
          <label className="settings-sheet-field"><span>Role name</span><input value={newRoleName} onChange={e=>setNewRoleName(e.target.value)} placeholder="e.g. Secretary"/></label>
          <div className="settings-permission-list settings-sheet-permissions">{permissionRows.map(([key,label])=><label key={key}><span><strong>{label}</strong>{key==="read"&&<small>Always enabled</small>}</span><input type="checkbox" checked={newRolePermissions.includes(key)} disabled={key==="read"} onChange={e=>setNewRolePermissions(p=>e.target.checked?[...new Set([...p,key])]:p.filter(x=>x!==key))}/></label>)}</div>
          <button type="button" disabled={!newRoleName.trim()} className="settings-sheet-primary" onClick={async()=>{try{await api.settings.createRole({name:newRoleName.trim(),permissions:newRolePermissions});setNewRoleName("");setNewRolePermissions(["read"]);setMessage("Custom role created");setAccessSheet(null);load()}catch(e){setMessage(e.message)}}}>Create role</button>
        </div>}
      </section>
    </div>}
  </>;
}

export function SystemSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>

      <SectionTitle>SYSTEM STATUS</SectionTitle>
      <div style={cardStyle}>
        {health ? <div className="sans" style={{fontSize:12}}>
          {[
            ["Database",health.db?.ok,"Online","Error"],
            ["Telegram",health.telegram?.ok,health.telegram?.username?`@${health.telegram.username}`:"Connected","Error"],
            ["Webhook",health.webhook?.ok && !!health.webhook?.url,"Active","Check"],
            ["AI / OCR",health.ai?.ok,"Available","Missing"],
          ].map(([label,ok,yes,no])=>
            <div key={label} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--divider)"}}>
              <span style={{color:"var(--muted)"}}>{label}</span>
              <b className="settings-health-status" style={{color:ok?"var(--success)":"var(--danger)"}}>{ok?<CircleCheck size={14}/>:<CircleX size={14}/>}<span>{ok?yes:no}</span></b>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}>
            <span style={{color:"var(--muted)"}}>Contribution due reminder</span>
            <b>{health.reminder_day === "off" ? "Off" : `Monthly · Day ${health.reminder_day || 5}`}</b>
          </div>
        </div> : <div className="sans" style={{fontSize:12,color:"var(--soft)"}}>Checking…</div>}
        <button type="button" onClick={()=>api.admin.health().then(setHealth).catch(e=>setMessage(e.message))} style={{...compactBtn,marginTop:8}}>Refresh status</button>
      </div>

      {superAdmin && <>
        <SectionTitle>DATABASE BACKUP</SectionTitle>
        <div style={cardStyle}>
          <div className="sans" style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>Create a JSON backup before important schema or financial data changes.</div>
          {canBackup ? <button type="button" onClick={backup} style={approveBtn}>Create backup</button> : <div className="sans" style={{fontSize:10,color:"var(--soft)"}}>Backup permission required.</div>}
        </div>

        <SectionTitle>RECENT ERRORS</SectionTitle>
        <div style={cardStyle}>
          <div className="expense-filter-row sans" style={{marginBottom:8}}>{[["open","Open"],["resolved","Resolved"],["all","All"]].map(([v,l])=><button key={v} type="button" onClick={()=>{setErrorFilter(v);setErrorPage(1)}} className={errorFilter===v?"expense-filter-chip active":"expense-filter-chip"}>{l}{v==="all"?` ${errors.length}`:""}</button>)}</div>
          {errors.some(e=>e.status!=="resolved")&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
            <button type="button" onClick={async()=>{
              if(!await confirm({title:"Resolve all errors?",message:"Mark all open errors as resolved? Error history will be retained.",confirmLabel:"Resolve all",tone:"primary"})) return;
              try{
                await api.admin.resolveAllErrors();
                setErrors(await api.admin.errors());
                setMessage("Open errors marked resolved");
              }catch(e){setMessage(e.message)}
            }} style={compactBtn}>Resolve all open</button>
          </div>}
          {errorRows.rows.map(e=><div key={e.id} className="sans" style={{padding:"8px 0",borderBottom:"1px solid var(--divider)",fontSize:11,opacity:e.status==="resolved"?.62:1}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
              <b>{e.source}</b>
              <span style={{fontSize:9,fontWeight:700,color:e.status==="resolved"?"var(--muted)":"var(--danger)"}}>{e.status==="resolved"?"RESOLVED":"OPEN"}</span>
            </div>
            <div style={{color:"var(--muted)",marginTop:2}}>{e.message}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:3}}>
              <span style={{color:"var(--soft-4)"}}>{formatLocalDateTime(e.created_at)}</span>
              {e.status!=="resolved"&&<div style={{display:"flex",gap:5}}>
                {e.source==="telegram.contribution_review_sync"&&<button type="button" onClick={async()=>{try{const r=await api.admin.retryError(e.id);setErrors(await api.admin.errors());setMessage(r?.ok?"Telegram review message updated":"Retry failed")}catch(err){setMessage(err.message)}}} style={{...compactBtn,padding:"4px 7px",fontSize:9}}>Retry Telegram</button>}
                <button type="button" onClick={async()=>{try{await api.admin.resolveError(e.id);setErrors(await api.admin.errors())}catch(err){setMessage(err.message)}}} style={{...compactBtn,padding:"4px 7px",fontSize:9}}>Resolve</button>
              </div>}
            </div>
          </div>)}
          {!filteredErrors.length&&<EmptyLine>No errors in this view.</EmptyLine>}
          <Pagination page={errorRows.page} total={filteredErrors.length} onChange={setErrorPage}/>
        </div>
      </>}
  </>;
}

export function AuditSettingsSection(ctx) {
  const {financeAdmin,audit,setAuditPage,auditPage} = ctx;
  const [query,setQuery]=useState("");
  const [action,setAction]=useState("all");
  const [actor,setActor]=useState("all");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [showFilters,setShowFilters]=useState(false);

  const actions=useMemo(()=>[...new Set((audit||[]).map(a=>a.action).filter(Boolean))].sort(),[audit]);
  const actors=useMemo(()=>[...new Set((audit||[]).map(a=>a.admin_name || "system"))].sort(),[audit]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return (audit||[]).filter(a=>{
      if(action!=="all" && a.action!==action) return false;
      if(actor!=="all" && (a.admin_name||"system")!==actor) return false;
      const created=a.created_at?new Date(a.created_at):null;
      if(dateFrom && created && created < new Date(`${dateFrom}T00:00:00`)) return false;
      if(dateTo && created && created > new Date(`${dateTo}T23:59:59.999`)) return false;
      if(!q) return true;
      const hay=[a.action,a.admin_name,a.detail,formatLocalDateTime(a.created_at)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  },[audit,query,action,actor,dateFrom,dateTo]);
  useEffect(()=>{ setAuditPage(1); },[query,action,actor,dateFrom,dateTo,setAuditPage]);
  const activeFilters=(action!=="all"?1:0)+(actor!=="all"?1:0)+(dateFrom||dateTo?1:0);
  const rows=pageSlice(filtered,auditPage);

  if(!financeAdmin) return <div className="settings-empty-card sans">You do not have permission to view the audit log.</div>;
  return <>
    <div className="settings-page-head audit-page-head sans">
      <div>
        <div className="settings-eyebrow">System history</div>
        <div className="audit-title-line"><h2>Audit Log</h2><span className="audit-record-badge">{filtered.length} records</span></div>
        <p>Track important financial, member, governance and administration changes.</p>
      </div>
    </div>

    <div className="audit-filter-card sans">
      <label className="audit-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search action, admin or detail"/></label>
      <div className="audit-filter-actions">
        <button type="button" className="audit-action-filter" onClick={()=>setShowFilters(true)}><SlidersHorizontal size={15}/><span>{action==="all"?"All actions":auditLabel(action)}</span></button>
        <button type="button" className={`audit-open-filter${activeFilters?" active":""}`} onClick={()=>setShowFilters(true)}><SlidersHorizontal size={15}/> Filter{activeFilters?` · ${activeFilters}`:""}</button>
      </div>
    </div>

    {showFilters&&<div className="audit-filter-sheet-wrap" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowFilters(false)}}>
      <div className="audit-filter-sheet sans" role="dialog" aria-modal="true" aria-label="Audit filters">
        <div className="audit-filter-sheet-head"><div><b>Filter audit log</b><span>Narrow results by action or admin.</span></div><button type="button" onClick={()=>setShowFilters(false)} aria-label="Close filters"><X size={18}/></button></div>
        <label className="audit-sheet-field"><span><SlidersHorizontal size={15}/> Action type</span><select value={action} onChange={e=>setAction(e.target.value)}><option value="all">All actions</option>{actions.map(x=><option key={x} value={x}>{auditLabel(x)}</option>)}</select></label>
        <label className="audit-sheet-field"><span><UserRound size={15}/> Admin</span><select value={actor} onChange={e=>setActor(e.target.value)}><option value="all">All admins</option>{actors.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <div className="audit-date-grid">
          <label className="audit-sheet-field"><span>From date</span><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
          <label className="audit-sheet-field"><span>To date</span><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
        </div>
        <div className="audit-filter-sheet-actions"><button type="button" onClick={()=>{setAction("all");setActor("all");setDateFrom("");setDateTo("")}}>Reset</button><button type="button" className="primary" onClick={()=>setShowFilters(false)}>Apply</button></div>
      </div>
    </div>}

    <div className="audit-timeline sans">
      {rows.rows.map(a=><AuditEntry key={a.id} a={a}/>)}
      {!filtered.length&&<div className="settings-empty-card"><Clock3 size={20}/><b>No audit entries found</b><span>Try changing the filters or search.</span></div>}
    </div>
    <Pagination page={rows.page} total={filtered.length} onChange={setAuditPage}/>
  </>;
}

