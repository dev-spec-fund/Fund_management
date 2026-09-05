import React, { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, Download, Eye, Paperclip, Pencil, Send } from "lucide-react";
import { api } from "../../api";
import { Modal, Field, useConfirmDialog } from "../../components/FormControls";
import { PreviewLoadState, PrimaryButton, smallBtn, approveBtn, rejectBtn } from "../../components/Shared";
import { formatLocalDateTime } from "../../utils/date";
import { fmt } from "../../utils/format";

export function StatusBadge({ status }) {
  const styles = {
    paid: { label: "Paid", color: "var(--success-strong)", bg: "var(--success-bg)", border: "var(--success-border)" },
    partial: { label: "Partial", color: "var(--warning)", bg: "var(--warning-bg)", border: "var(--warning-border)" },
    unpaid: { label: "Unpaid", color: "var(--danger)", bg: "var(--danger-bg)", border: "var(--danger-border)" },
    exempt: { label: "Exempt", color: "var(--neutral-text)", bg: "var(--surface-neutral-soft)", border: "var(--surface-neutral-3)" },
    not_applicable: { label: "Not due", color: "var(--muted)", bg: "var(--button-soft)", border: "var(--border-strong-2)" },
    inactive: { label: "Inactive", color: "var(--muted)", bg: "var(--button-soft)", border: "var(--border-strong-2)" },
  };
  const s = styles[status] || styles.unpaid;
  return (
    <div className="sans" style={{ flexShrink: 0, minWidth: 58, textAlign: "center", color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 999, padding: "5px 8px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </div>
  );
}

function formatMemberPopupDate(value){
  if(!value)return "—";
  try{return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${String(value).slice(0,10)}T00:00:00`));}
  catch{return String(value).slice(0,10)}
}

export default function MemberPopup({ member, month, canEdit = false, canRemind, onClose, onChanged }) {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [slipPreview, setSlipPreview] = useState(null);
  const slipPreviewRequestRef = useRef(0);
  const [slipBusy, setSlipBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [expandedContribution, setExpandedContribution] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [form, setForm] = useState({ name: member.name, phone: member.phone, monthly_amount: member.monthly_amount });

  useEffect(() => { api.members.statement(member.id).then(setDetail).catch(() => {}); }, [member.id]);
  useEffect(() => () => {
    if (slipPreview?.url) URL.revokeObjectURL(slipPreview.url);
  }, [slipPreview]);

  const save = async () => {
    await api.members.update(member.id, { ...form, monthly_amount: Number(form.monthly_amount) });
    setEditing(false);
    onChanged();
    onClose();
  };

  const openContributionSlip = async (contribution) => {
    const requestId = ++slipPreviewRequestRef.current;
    const txnId = contribution.txn_id || "Contribution";
    setSlipPreview((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return { status: "loading", url: "", txnId, mime: contribution.slip_mime_type || "image/jpeg", contribution };
    });
    setSlipBusy(true);
    setActionMessage("");
    try {
      const blob = await api.members.contributionSlip(member.id, contribution.id);
      const url = URL.createObjectURL(blob);
      if (requestId !== slipPreviewRequestRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setSlipPreview({ status: "ready", url, txnId, mime: blob.type || "image/jpeg", contribution });
    } catch (e) {
      if (requestId !== slipPreviewRequestRef.current) return;
      setSlipPreview({ status: "error", url: "", txnId, mime: contribution.slip_mime_type || "", contribution, error: e.message || "Could not open payment slip" });
    } finally {
      if (requestId === slipPreviewRequestRef.current) setSlipBusy(false);
    }
  };

  const closeSlipPreview = () => {
    slipPreviewRequestRef.current += 1;
    setSlipBusy(false);
    setSlipPreview((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });
  };

  const sendContributionSlip = async (contribution) => {
    try { await api.members.sendContributionSlipToTelegram(member.id,contribution.id); setActionMessage("Payment slip sent to your Telegram."); }
    catch (e) { setActionMessage(e.message || "Could not send payment slip to Telegram"); }
  };

  const toggleActive = async () => {
    const action = member.active ? "deactivate" : "reactivate";
    if (!await confirm({title:`${action === "deactivate" ? "Deactivate" : "Reactivate"} member?`,message:`${action === "deactivate" ? "Deactivate" : "Reactivate"} ${member.name}?`,confirmLabel:action === "deactivate" ? "Deactivate" : "Reactivate",tone:action === "deactivate" ? "danger" : "primary"})) return;
    await api.members.update(member.id, { active: member.active ? 0 : 1 });
    onChanged();
    onClose();
  };

  const contributions = detail?.contributions || [];
  const allocations = detail?.allocations || [];
  const monthlyStatuses = detail?.monthly_status || [];
  const currentStatus = monthlyStatuses.find((x) => x.month === month);
  const monthlyAmount = Number(member.monthly_amount || 0);
  const currentPaid = Number(currentStatus?.paid || 0);
  const currentDue = currentStatus?.status === "exempt" ? 0 : Number(currentStatus?.due ?? Math.max(0, monthlyAmount - currentPaid));
  const currentLabel = currentStatus?.status || (currentPaid >= monthlyAmount && monthlyAmount > 0 ? "paid" : currentPaid > 0 ? "partial" : "unpaid");
  const totalContributed = contributions
    .filter((x) => x.status === "approved")
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const approved = contributions
    .filter((x) => x.status === "approved")
    .sort((a,b) => String(b.approved_at || b.submitted_at || "").localeCompare(String(a.approved_at || a.submitted_at || "")));
  const rejected = contributions
    .filter((x) => x.status !== "approved")
    .sort((a,b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));

  const allocationsFor = (contributionId) =>
    allocations
      .filter((a) => Number(a.contribution_id) === Number(contributionId))
      .sort((a,b) => String(a.month).localeCompare(String(b.month)));

  const looksLikeBankRef = (value) => {
    if (!value) return false;
    const v = String(value).trim();
    if (v.length < 6) return false;
    if (/\s/.test(v)) return false;
    if (!/[0-9]/.test(v)) return false;
    return /^[A-Z0-9\-_/]+$/i.test(v);
  };

  const statusColor = currentLabel === "paid" ? "var(--success)" : currentLabel === "partial" ? "var(--warning)" : currentLabel === "exempt" ? "var(--neutral-text)" : "var(--danger)";
  const monthLabel = (() => {
    try { return new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)); }
    catch { return month; }
  })();

  const contributionCard = (h) => {
    const applied = allocationsFor(h.id);
    const refValid = looksLikeBankRef(h.ref_number);
    const expanded = Number(expandedContribution) === Number(h.id);
    const when = h.approved_at || h.submitted_at;
    return (
      <div key={h.id} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:11, marginBottom:7, overflow:"hidden" }}>
        <button
          type="button"
          onClick={() => setExpandedContribution(expanded ? null : h.id)}
          aria-expanded={expanded}
          className="sans"
          style={{width:"100%",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto auto",alignItems:"center",gap:9,border:0,background:"transparent",padding:"10px 11px",textAlign:"left",cursor:"pointer",color:"var(--text)"}}
        >
          <div style={{minWidth:0}}>
            <div style={{fontSize:11,fontWeight:750,color:"var(--primary-text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.txn_id || "Contribution"}</div>
            <div style={{fontSize:9,color:"var(--soft)",marginTop:2,textTransform:"capitalize"}}>
              {h.status}{when ? ` · ${formatLocalDateTime(when)}` : ""}
            </div>
          </div>
          <div style={{fontSize:13,fontWeight:750,whiteSpace:"nowrap"}}>MVR {fmt(h.amount)}</div>
          <ChevronDown size={15} color="var(--soft)" style={{transition:"transform .18s ease",transform:expanded?"rotate(180deg)":"none"}} />
        </button>

        {expanded && <div style={{borderTop:"1px solid var(--border)",padding:"9px 11px 11px",background:"var(--bg)"}}>
          <div className="sans" style={{fontSize:10,color:refValid?"var(--muted)":"var(--warning-3)"}}>
            {refValid ? <>Bank ref: <b style={{color:"var(--primary-text)"}}>{h.ref_number}</b></> : <>⚠ Reference needs review: <b>{h.ref_number || "not detected"}</b></>}
          </div>

          {Boolean(h.has_slip) && canRemind && <div className="sans" style={{display:"flex",alignItems:"center",gap:7,background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"7px 8px",marginTop:8}}>
            <Paperclip size={13} color="var(--muted)"/>
            <div style={{flex:1,minWidth:0,fontSize:10,fontWeight:700,color:"var(--primary-text)"}}>Payment slip</div>
            <button type="button" title="Preview payment slip" disabled={slipBusy} onClick={()=>openContributionSlip(h)} style={{...smallBtn("var(--primary-text)"),padding:6,opacity:slipBusy?.65:1}}><Eye size={13}/></button>
            <button type="button" title="Send payment slip to my Telegram" onClick={()=>sendContributionSlip(h)} style={{...smallBtn("var(--primary-text)"),padding:6}}><Send size={13}/></button>
          </div>}

          {applied.length > 0 && (
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"7px 9px",marginTop:8}}>
              <div className="sans" style={{fontSize:9,fontWeight:700,color:"var(--muted)",letterSpacing:.5,marginBottom:3}}>APPLIED TO</div>
              {applied.map((a,i)=> {
                const monthly = Number(member.monthly_amount || 0);
                const label = Number(a.amount) + .005 >= monthly ? "Paid" : "Allocated";
                return <div key={i} className="sans" style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:10,padding:"3px 0"}}>
                  <span>{a.month}</span>
                  <span><b>MVR {fmt(a.amount)}</b> · {label}</span>
                </div>
              })}
            </div>
          )}

          {applied.length === 0 && h.status === "approved" && (
            <div className="sans" style={{fontSize:9,color:"var(--soft-2)",marginTop:7}}>
              Legacy contribution · applied to {h.month}
            </div>
          )}
        </div>}
      </div>
    );
  };

  return (
    <>
    {confirmationDialog}
    <Modal onClose={onClose} title={member.name} action={canEdit ? <button type="button" onClick={() => setEditing(true)} style={{ background:"none", border:"none", cursor:"pointer" }}><Pencil size={17} color="var(--soft)" /></button> : null}>
      {actionMessage && <div className="sans" style={{fontSize:11,padding:9,borderRadius:8,marginBottom:10,background:"var(--surface-cool)",color:"var(--primary-text)"}}>{actionMessage}</div>}
      {editing ? (
        <>
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" prefix="MVR" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: v })} />
          <PrimaryButton onClick={save}>Save changes</PrimaryButton>
        </>
      ) : (
        <>
          <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--primary-text)"}}>{member.member_code}</div>
              <div style={{fontSize:10,color:"var(--soft)",marginTop:2}}>{member.phone || "Phone not added"} · MVR {fmt(member.monthly_amount)}/mo</div>
              <div style={{fontSize:9,color:"var(--soft)",marginTop:4}}>Joined {formatMemberPopupDate(detail?.member?.joined_at||member.joined_at||member.created_at)} · Role: <b style={{color:"var(--primary-text)"}}>{detail?.member?.exco_role||member.exco_role||"Member"}</b></div>
            </div>
            <div style={{fontSize:9,fontWeight:700,color:member.telegram_id?"var(--success)":"var(--soft)",whiteSpace:"nowrap"}}>
              {member.telegram_id ? "● Telegram linked" : "○ Not linked"}
            </div>
          </div>

          <div className="sans member-popup-exco">
            <span>CURRENT MEMBER ROLE</span><b>{detail?.member?.exco_role||member.exco_role||"Member"}</b>
          </div>

          <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:11,padding:11,marginTop:11}}>
            <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                <div style={{fontSize:10,color:"var(--soft)"}}>{monthLabel}</div>
                <div style={{fontSize:15,fontWeight:700,color:statusColor,textTransform:"capitalize",marginTop:2}}>{currentLabel}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700}}>MVR {fmt(currentPaid)} / {fmt(monthlyAmount)}</div>
                <div style={{fontSize:10,color:currentDue>0?"var(--danger)":"var(--success)",marginTop:2}}>{currentDue>0?`MVR ${fmt(currentDue)} due`:"No amount due"}</div>
              </div>
            </div>
          </div>

          <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,margin:"9px 1px 14px",fontSize:10,color:"var(--soft)"}}>
            <span>Total contributed <b style={{color:"var(--primary-text)"}}>MVR {fmt(totalContributed)}</b></span>
            <span>Outstanding <b style={{color:currentDue>0?"var(--danger)":"var(--success)"}}>MVR {fmt(currentDue)}</b></span>
          </div>

          {detail?.reconciliation&&<div className={`sans member-reconciliation-card ${detail.reconciliation.ok?"ok":"error"}`}>
            <div className="member-reconciliation-head"><span><b>ALLOCATION RECONCILIATION</b><small>{detail.reconciliation.ok?"Approved cash and monthly ledger reconcile":"Allocation mismatch needs review"}</small></span><strong>{detail.reconciliation.ok?"✓ OK":"!"}</strong></div>
            <div className="member-reconciliation-grid">
              <span>Approved<b>MVR {fmt(detail.reconciliation.approved_total)}</b></span>
              <span>Effective allocated<b>MVR {fmt(detail.reconciliation.effective_allocated_total)}</b></span>
              <span>Advance<b>MVR {fmt(detail.reconciliation.advance_allocated_total)}</b></span>
              <span>Current due<b>MVR {fmt(detail.reconciliation.current_due_total)}</b></span>
            </div>
            {!!detail.reconciliation.legacy_fallback_total&&<div className="member-reconciliation-legacy">Legacy fallback: MVR {fmt(detail.reconciliation.legacy_fallback_total)} from approved transactions without explicit allocation rows.</div>}
            {!!detail.reconciliation.issues?.length&&<div className="member-reconciliation-issues">
              {detail.reconciliation.issues.map((issue,i)=><div key={`${issue.code}-${issue.allocation_id||issue.contribution_id||i}`} className={issue.severity}><b>{issue.severity==="error"?"Issue":"Check"}</b><span>{issue.message}</span></div>)}
            </div>}
          </div>}

          <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"var(--muted)",marginBottom:7,fontWeight:700,letterSpacing:.45}}><span>CONTRIBUTION HISTORY</span><span style={{fontSize:9,fontWeight:600,color:"var(--soft)"}}>Tap to expand</span></div>
          {approved.map(contributionCard)}
          {approved.length===0 && <div className="sans" style={{fontSize:12,color:"var(--soft)",padding:"8px 0"}}>No approved contributions yet.</div>}

          {rejected.length>0 && (
            <>
              <button type="button" onClick={()=>setShowRejected(!showRejected)} className="sans"
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"10px 2px",color:"var(--soft)",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                <span>REJECTED / VOIDED · {rejected.length}</span><span>{showRejected?"▲":"▼"}</span>
              </button>
              {showRejected && rejected.map(contributionCard)}
            </>
          )}

          <button type="button" className="sans" onClick={()=>setShowExport(!showExport)} style={{...smallBtn(),width:"100%",marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
            <Download size={14}/> Export statement
          </button>
          {showExport && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:7}}>
            <button type="button" className="sans" onClick={async () => { const { exportStatementPdf } = await import("../../utils/exports"); return exportStatementPdf(member); }} style={smallBtn()}>PDF</button>
            <button type="button" className="sans" onClick={async () => { const { exportStatementCsv } = await import("../../utils/exports"); return exportStatementCsv(member); }} style={smallBtn()}>CSV</button>
          </div>}

          {member.active && canRemind && currentDue > 0 && <button type="button" className="sans" disabled={reminding} onClick={async()=>{
            if(!await confirm({title:"Send payment reminder?",message:`Send a payment reminder to ${member.name} for ${monthLabel}?`,confirmLabel:"Send reminder",tone:"primary"})) return;
            try{
              setReminding(true); setReminderNote("");
              const r=await api.admin.sendPaymentReminders({month,member_id:member.id});
              setReminderNote(r.sent ? "Reminder sent." : (r.reason || "No reminder sent."));
            }catch(e){setReminderNote(e.message)} finally{setReminding(false)}
          }} style={{...approveBtn,width:"100%",marginTop:10}}>
            <Bell size={14}/>{reminding?"Sending…":"Send payment reminder"}
          </button>}

          {member.active && canRemind && currentDue <= 0 && (
            <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"var(--surface-cool)",color:"var(--muted)",border:"1px solid var(--surface-neutral-2)",borderRadius:10,padding:10,fontSize:11,fontWeight:600,marginTop:10}}>
              ✓ Paid — no reminder needed
            </div>
          )}

          {reminderNote && <div className="sans" style={{fontSize:10,color:"var(--muted)",marginTop:5,textAlign:"center"}}>{reminderNote}</div>}

          {canEdit && <button type="button" onClick={toggleActive} className="sans"
            style={{...(member.active?rejectBtn:approveBtn),width:"100%",marginTop:12}}>
            {member.active ? "Deactivate member" : "Reactivate member"}
          </button>}
        </>
      )}
    </Modal>
    {slipPreview && (
      <Modal onClose={closeSlipPreview} title={`Payment slip · ${slipPreview.txnId}`}>
        <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:12,padding:8,textAlign:"center"}}>
          {slipPreview.status === "loading" ? (
            <PreviewLoadState label="Loading payment slip…" />
          ) : slipPreview.status === "error" ? (
            <PreviewLoadState status="error" error={slipPreview.error} onRetry={() => openContributionSlip(slipPreview.contribution)} />
          ) : String(slipPreview.mime).startsWith("image/") ? (
            <img src={slipPreview.url} alt={`Payment slip ${slipPreview.txnId}`} style={{display:"block",width:"100%",maxHeight:"70vh",objectFit:"contain",borderRadius:8,background:"#fff"}} />
          ) : (
            <div className="sans" style={{padding:20,fontSize:11,color:"var(--muted)"}}>This attachment cannot be previewed as an image. Use “Send to Telegram” to open the original file.</div>
          )}
        </div>
      </Modal>
    )}
    </>
  );
}
