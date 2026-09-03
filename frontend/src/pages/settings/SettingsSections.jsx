import React from "react";
import { Bell } from "lucide-react";
import { api } from "../../api";
import { SectionTitle, EmptyLine, cardStyle, compactBtn, approveBtn, rejectBtn } from "../../components/Shared";
import Pagination, { pageSlice } from "../../components/Pagination";
import { formatLocalDateTime } from "../../utils/date";

const AUDIT_HIDDEN_KEYS = new Set(["ocr_raw","slip_file_id","file_id","telegram_file_id","photo_file_id","raw","ai_response","model_response","prompt"]);
const auditLabel = (s="") => s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const auditValue = (v) => { if (v == null || v === "") return null; if (typeof v === "number" && Number.isFinite(v)) return String(v); if (typeof v === "boolean") return v ? "Yes" : "No"; if (typeof v === "string") return v.length > 90 ? `${v.slice(0,90)}…` : v; return null; };
function cleanAuditObject(v, depth=0) { if (!v || typeof v !== "object" || depth > 3) return v; if (Array.isArray(v)) return v.slice(0,10).map(x=>cleanAuditObject(x,depth+1)); return Object.fromEntries(Object.entries(v).filter(([k])=>!AUDIT_HIDDEN_KEYS.has(k.toLowerCase())).map(([k,x])=>[k,cleanAuditObject(x,depth+1)])); }
function auditSummary(detail) { let d=detail; if (typeof d === "string") { try { d=JSON.parse(d); } catch { return [{label:"Details",value:d.slice(0,140)}]; } } d=cleanAuditObject(d); if (!d || typeof d !== "object") return []; const after=d.after && typeof d.after==="object" ? d.after : {}; const before=d.before && typeof d.before==="object" ? d.before : {}; const preferred=["member_code","txn_id","donor_name","description","amount","expense_date","month","transaction_month","ref_number","status","role","name","note","reason"]; const rows=[]; if (d.entity) rows.push({label:"Record",value:`${auditLabel(String(d.entity))}${d.entity_id!=null?` #${d.entity_id}`:""}`}); for (const key of preferred) { const av=auditValue(after[key]), bv=auditValue(before[key]); if (av!=null && bv!=null && av!==bv) rows.push({label:auditLabel(key),value:`${bv} → ${av}`}); else if (av!=null) rows.push({label:auditLabel(key),value:av}); if (rows.length>=5) break; } return rows; }
function AuditEntry({a}) { const rows=auditSummary(a.detail); return <div className="sans" style={{padding:"11px 0",borderBottom:"1px solid var(--divider)"}}><div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12}}><b>{auditLabel(a.action)}</b><span style={{color:"var(--soft-4)",fontSize:10,whiteSpace:"nowrap"}}>{formatLocalDateTime(a.created_at)}</span></div>{rows.map((r,i)=><div key={`${r.label}-${i}`} style={{fontSize:11,color:"var(--muted)",marginTop:3}}><span style={{color:"var(--soft-2)"}}>{r.label}:</span> {r.value}</div>)}<div style={{fontSize:10,color:"var(--soft-4)",marginTop:4}}>by {a.admin_name || "system"}</div></div>; }

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

      <SectionTitle>MEMBER CONTRIBUTIONS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:5}}>Default monthly contribution</div>
        <div style={{display:"flex",alignItems:"center",border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--card)"}}>
          <span className="sans" style={{paddingLeft:11,fontSize:12,color:"var(--soft)"}}>MVR</span>
          <input disabled={!superAdmin} type="number" value={settings.default_monthly_amount ?? ""} onChange={e=>setSettings({...settings,default_monthly_amount:e.target.value})} onBlur={e=>superAdmin&&saveSetting("default_monthly_amount",e.target.value)} className="sans" style={{flex:1,border:0,outline:"none",padding:"9px 11px",fontSize:14,background:"transparent"}}/>
        </div>
        <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:6}}>Used automatically for new members. Existing member amounts are not changed.</div>
      </div>

      <SectionTitle>EXPENSE CATEGORIES</SectionTitle>
      <div style={cardStyle}>
        {categories.map(cat=><div key={cat.id} className="sans" style={{display:"flex",alignItems:"center",gap:7,padding:"8px 0",borderBottom:"1px solid var(--divider)",opacity:Number(cat.active)===0?.55:1}}>
          <span style={{flex:1,fontSize:12,fontWeight:600}}>{cat.name}{Number(cat.active)===0?" · Inactive":""}</span>
          {financeAdmin&&<><button type="button" style={compactBtn} onClick={async()=>{const name=prompt("Category name",cat.name);if(!name||name===cat.name)return;try{await api.expenses.updateCategory(cat.id,{name});load()}catch(e){setMessage(e.message)}}}>Edit</button>
          <button type="button" style={compactBtn} onClick={async()=>{try{await api.expenses.updateCategory(cat.id,{active:Number(cat.active)===0});load()}catch(e){setMessage(e.message)}}}>{Number(cat.active)===0?"Activate":"Deactivate"}</button>
          <button type="button" style={{...compactBtn,color:"var(--danger)"}} onClick={async()=>{if(!await confirm({title:"Delete expense category?",message:`Delete ${cat.name}? If it has historical expenses it will be deactivated instead.`,confirmLabel:"Delete"}))return;try{await api.expenses.removeCategory(cat.id);load()}catch(e){setMessage(e.message)}}}>Delete</button></>}
        </div>)}
        {financeAdmin&&<button type="button" style={{...approveBtn,width:"100%",marginTop:10}} onClick={async()=>{const name=prompt("New expense category name");if(!name)return;try{await api.expenses.addCategory(name);load()}catch(e){setMessage(e.message)}}}>+ Add category</button>}
      </div>

      <SectionTitle>PAYMENT REMINDERS</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--primary-text)"}}>Automatic reminders</div>
            <div style={{fontSize:10,color:"var(--soft)",marginTop:3}}>Telegram reminder to unpaid and partially paid members.</div>
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
          <div className="sans" style={{fontSize:10,color:"var(--soft-2)",marginTop:6}}>The daily scheduler checks at 12:00 AM Maldives time and sends only to members with an outstanding balance.</div>
        </>}

        {settings.reminder_day==="off" && <div className="sans" style={{fontSize:11,color:"var(--soft)",background:"var(--bg)",borderRadius:9,padding:10}}>Automatic reminders are off. Manual reminders are still available.</div>}

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

      <SectionTitle>MONTH MANAGEMENT</SectionTitle>
      <div style={cardStyle}>
        <div className="sans" style={{fontSize:11,color:"var(--muted)",marginBottom:7}}>Select the month to review or close</div>
        <div style={{display:"grid",gridTemplateColumns:"40px 1fr 40px",gap:8,alignItems:"center",marginBottom:10}}>
          <button type="button" disabled={closeBusy} onClick={()=>shiftCloseMonth(-1)} className="sans" aria-label="Previous month" style={{...compactBtn,height:40,fontSize:18,padding:0}}>‹</button>
          <input type="month" max={currentMonth} value={closeMonthValue} onChange={e=>{ if(!e.target.value || e.target.value>currentMonth)return; setCloseMonthValue(e.target.value); setCloseCheck(null); }} className="sans" style={{width:"100%",boxSizing:"border-box",height:40,border:"1px solid var(--border-strong)",borderRadius:9,padding:"8px 10px",fontSize:13,background:"var(--bg)",color:"var(--text)"}}/>
          <button type="button" disabled={closeBusy || closeMonthValue>=currentMonth} onClick={()=>shiftCloseMonth(1)} className="sans" aria-label="Next month" style={{...compactBtn,height:40,fontSize:18,padding:0}}>›</button>
        </div>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,marginBottom:10}}>
          <span style={{color:"var(--muted)"}}>Selected month</span>
          <b>{monthLabel(closeMonthValue)}</b>
        </div>
        <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12}}>
          <span style={{color:"var(--muted)"}}>Status</span>
          <span style={{fontWeight:700,color:monthClosed?"var(--danger)":"var(--success)"}}>{monthClosed?"Closed":"Open"}</span>
        </div>
        {closeMonthValue<currentMonth && !monthClosed && <div className="sans" style={{fontSize:10,color:"var(--warning)",marginTop:9,lineHeight:1.4}}>⚠ {monthLabel(closeMonthValue)} is a past open month. You can review and close it now; the current month stays open.</div>}
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
        {(closeCheck.blockers||[]).map((x,i)=><div key={`b-${i}`} className="sans" style={{fontSize:11,color:"var(--danger)",marginTop:4}}>⛔ {x}</div>)}
        {(closeCheck.warnings||[]).map((x,i)=><div key={`w-${i}`} className="sans" style={{fontSize:11,color:"var(--warning)",marginTop:4}}>⚠ {x}</div>)}
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
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>

      <SectionTitle>ADMINS & ROLES</SectionTitle>

      {superAdmin && <div style={{...cardStyle,marginBottom:12}}>
        <div className="sans" style={{fontSize:12,fontWeight:700,color:"var(--primary-text)"}}>Custom roles</div>
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:3,marginBottom:10}}>
          Create roles using the existing protected permission groups. Read access is always included.
        </div>

        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input
            value={newRoleName}
            onChange={e=>setNewRoleName(e.target.value)}
            placeholder="e.g. Secretary"
            className="sans"
            style={{flex:1,minWidth:0,border:"1px solid var(--border-strong)",borderRadius:8,padding:"9px 10px",background:"var(--bg)",color:"var(--text)"}}
          />
          <button type="button" disabled={!newRoleName.trim()} style={approveBtn} onClick={async()=>{
            try{
              await api.settings.createRole({name:newRoleName.trim(),permissions:newRolePermissions});
              setNewRoleName(""); setNewRolePermissions(["read"]); setMessage("Custom role created"); load();
            }catch(e){setMessage(e.message)}
          }}>Create</button>
        </div>

        <div className="sans" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:10,marginBottom:10}}>
          {[
            ["read","Read"],
            ["finance","Finance"],
            ["manage_admins","Manage admins"],
            ["close_month","Close / reopen month"],
            ["backup","Database backup"],
          ].map(([key,label])=><label key={key} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 7px",background:"var(--bg)",borderRadius:8}}>
            <input type="checkbox" checked={newRolePermissions.includes(key)} disabled={key==="read"} onChange={e=>setNewRolePermissions(p=>e.target.checked?[...new Set([...p,key])]:p.filter(x=>x!==key))}/>
            {label}
          </label>)}
        </div>

        {customRoles.length===0
          ? <div className="sans" style={{fontSize:10,color:"var(--soft)"}}>No custom roles yet.</div>
          : customRoles.map(r=><div key={r.id} className="sans" style={{padding:"10px 0",borderTop:"1px solid var(--divider)"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{r.name}</div>
                  <div style={{fontSize:9,color:"var(--soft)",marginTop:2}}>{Number(r.assigned_admins||0)} active admin{Number(r.assigned_admins||0)===1?"":"s"}</div>
                </div>
                <button type="button" disabled={Number(r.assigned_admins||0)>0} style={{...rejectBtn,padding:"6px 8px"}} onClick={async()=>{
                  if(!await confirm({title:"Delete custom role?",message:`Delete custom role "${r.name}"?`,confirmLabel:"Delete role"})) return;
                  try{await api.settings.removeRole(r.id);setMessage("Custom role removed");load()}catch(e){setMessage(e.message)}
                }}>Delete</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:8}}>
                {[
                  ["read","Read"],
                  ["finance","Finance"],
                  ["manage_admins","Manage admins"],
                  ["close_month","Close month"],
                  ["backup","Backup"],
                ].map(([key,label])=><label key={key} style={{display:"flex",alignItems:"center",gap:6,fontSize:9,padding:"5px 6px",background:"var(--bg)",borderRadius:7}}>
                  <input type="checkbox" checked={(r.permissions||[]).includes(key)} disabled={key==="read"} onChange={async e=>{
                    const next=e.target.checked?[...new Set([...(r.permissions||[]),key])]:(r.permissions||[]).filter(x=>x!==key);
                    try{await api.settings.updateRole(r.id,{permissions:next});setMessage(`${r.name} permissions updated`);load()}catch(err){setMessage(err.message)}
                  }}/>
                  {label}
                </label>)}
              </div>
            </div>)
        }
      </div>}

      {superAdmin&&<div style={{...cardStyle,marginBottom:12}}>
        <div className="sans" style={{fontSize:12,fontWeight:700,lineHeight:1.35,color:"var(--primary-text)",marginBottom:4}}>Promote existing member</div>
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginBottom:9}}>The member keeps their member account and contribution obligations. Telegram must be linked.</div>
        <select value={promoteMemberId} onChange={e=>setPromoteMemberId(e.target.value)} style={{width:"100%",border:"1px solid var(--border-strong)",borderRadius:8,padding:9,background:"var(--card)",marginBottom:8}}>
          <option value="">Select member…</option>{membersForAdmin.filter(m=>m.active!==0).map(m=><option key={m.id} value={m.id}>{m.name} · {m.member_code}{m.telegram_id?"":" · Telegram not linked"}</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <select value={promoteRole} onChange={e=>setPromoteRole(e.target.value)} style={{flex:1,border:"1px solid var(--border-strong)",borderRadius:8,padding:9,background:"var(--card)"}}>
            <option value="super_admin">Super Admin</option>
            <option value="treasurer">Treasurer</option>
            <option value="viewer">Viewer</option>
            {customRoles.map(r=><option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
          </select>
          <button type="button" disabled={!promoteMemberId} style={approveBtn} onClick={async()=>{
            const m=membersForAdmin.find(x=>String(x.id)===String(promoteMemberId));
            const selected=promoteRole.startsWith("custom:")?customRoles.find(r=>String(r.id)===promoteRole.split(":")[1]):null;
            const label=selected?.name || promoteRole.replace("_"," ");
            if(!await confirm({title:"Promote member?",message:`Promote ${m?.name||"this member"} to ${label}?`,confirmLabel:"Promote",tone:"primary"}))return;
            try{
              await api.settings.promoteMember(Number(promoteMemberId),selected?"viewer":promoteRole,selected?.id||null);
              setPromoteMemberId("");setMessage("Member promoted");load()
            }catch(e){setMessage(e.message)}
          }}>Promote</button>
        </div>
      </div>}

      <div style={cardStyle}>
        {admins.map(a=>{
          const displayRole=a.custom_role_id?`custom:${a.custom_role_id}`:(a.role==="owner"?"super_admin":a.role);
          const roleLabel=a.custom_role_name || (displayRole==="super_admin"?"Super Admin":displayRole==="treasurer"?"Treasurer":"Viewer");
          return <div key={a.id} className="sans" style={{padding:"10px 0",borderBottom:"1px solid var(--divider)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600}}>{a.member_name || a.name}</div>
                <div style={{fontSize:10,color:a.active===0?"var(--danger)":"var(--success)",marginTop:2}}>
                  {a.active===0?"Admin access inactive":"Admin access active"}
                  {a.member_code ? ` · ${a.member_code} · Member + Admin` : ""}
                </div>
              </div>
              {superAdmin
                ? <select disabled={a.active===0} value={displayRole} onChange={async e=>{
                    const value=e.target.value;
                    const selected=value.startsWith("custom:")?customRoles.find(r=>String(r.id)===value.split(":")[1]):null;
                    const label=selected?.name || e.target.options[e.target.selectedIndex].text;
                    if(!await confirm({title:"Change admin role?",message:`Change ${a.name}'s role to ${label}?`,confirmLabel:"Change role",tone:"primary"})) return;
                    api.settings.updateAdmin(a.id,{role:selected?"viewer":value,custom_role_id:selected?.id||null}).then(load).catch(err=>setMessage(err.message));
                  }} style={{border:"1px solid var(--border-strong)",borderRadius:8,padding:"6px 7px",background:"var(--bg)",fontSize:11,opacity:a.active===0?.55:1}}>
                    <option value="super_admin">Super Admin</option>
                    <option value="treasurer">Treasurer</option>
                    <option value="viewer">Viewer</option>
                    {customRoles.map(r=><option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
                  </select>
                : <span style={{fontSize:11,fontWeight:600}}>{roleLabel}</span>}
            </div>
            {superAdmin && a.member_id && a.active!==0 && Number(a.id)!==Number(admin?.id) &&
              <button type="button"
                onClick={async()=>{
                  if(!await confirm({title:"Demote admin?",message:`Demote ${a.member_name || a.name} to normal member?\n\nThey will lose admin access immediately. Their member account, Telegram link, contribution history and payment obligations will remain unchanged.`,confirmLabel:"Demote admin"})) return;
                  try{
                    await api.settings.demoteMember(a.id);
                    setMessage(`${a.member_name || a.name} demoted to member`);
                    load();
                  }catch(e){setMessage(e.message)}
                }}
                style={{...rejectBtn,width:"100%",marginTop:8,padding:"8px 10px"}}
              >
                Demote to member
              </button>}
          </div>
        })}
        <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:9,lineHeight:1.45}}>
          Built-in roles remain available. Custom roles override Treasurer/Viewer permissions for the assigned admin. At least one built-in Super Admin must always remain active.
        </div>
      </div>
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
              <b style={{color:ok?"var(--success)":"var(--danger)"}}>{ok?"● ":"● "}{ok?yes:no}</b>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}>
            <span style={{color:"var(--muted)"}}>Reminder check</span>
            <b>{health.reminder_schedule ? "Daily" : "Not set"}</b>
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
              {e.status!=="resolved"&&<button type="button" onClick={async()=>{try{await api.admin.resolveError(e.id);setErrors(await api.admin.errors())}catch(err){setMessage(err.message)}}} style={{...compactBtn,padding:"4px 7px",fontSize:9}}>Resolve</button>}
            </div>
          </div>)}
          {!filteredErrors.length&&<EmptyLine>No errors in this view.</EmptyLine>}
          <Pagination page={errorRows.page} total={filteredErrors.length} onChange={setErrorPage}/>
        </div>
      </>}
  </>;
}

export function AuditSettingsSection(ctx) {
  const {settings,setSettings,superAdmin,saveSetting,categories,financeAdmin,confirm,load,setMessage,currentMonth,closeBusy,shiftCloseMonth,closeMonthValue,setCloseMonthValue,setCloseCheck,monthLabel,monthClosed,reviewMonthClose,canCloseMonth,closeCheck,closeMonth,closures,closurePage,setClosurePage,newRoleName,setNewRoleName,newRolePermissions,setNewRolePermissions,customRoles,membersForAdmin,promoteMemberId,setPromoteMemberId,promoteRole,setPromoteRole,admins,admin,health,setHealth,canBackup,backup,errors,errorFilter,setErrorFilter,setErrorPage,errorRows,setErrors,filteredErrors,auditRows,audit,setAuditPage} = ctx;
  return <>

      <SectionTitle>AUDIT LOG</SectionTitle>
      <div style={cardStyle}>
        {auditRows.rows.map(a=><AuditEntry key={a.id} a={a}/>)}
        <Pagination page={auditRows.page} total={audit.length} onChange={setAuditPage}/>
        {!audit.length&&<EmptyLine>No audit entries.</EmptyLine>}
      </div>
  </>;
}
