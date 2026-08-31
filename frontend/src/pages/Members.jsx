import React, { useEffect, useState } from "react";
import { Plus, X, Bell, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import { api } from "../api";
import { Modal, Field } from "../components/FormControls";
import { Center, PrimaryButton, smallBtn } from "../components/Shared";
import { currentMonthValue, formatLocalDateTime } from "../utils/date";
import { fmt } from "../utils/format";

export default function Members({ isAdmin, admin }) {
  const [members, setMembers] = useState([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");
  const [defaultMonthly, setDefaultMonthly] = useState(250);
  const [form, setForm] = useState({ name: "", phone: "", monthly_amount: "" });

  const load = () => Promise.all([
    api.members.list().then(setMembers),
    api.reports.summary(month).then(setMonthlySummary),
  ]).catch(() => {});
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, month]);
  useEffect(() => { if (isAdmin) api.settings.get().then(s=>{ const v=Number(s.default_monthly_amount)||250; setDefaultMonthly(v); setForm(f=>({...f,monthly_amount:f.monthly_amount===""?String(v):f.monthly_amount})); }).catch(()=>{}); }, [isAdmin]);

  if (!isAdmin) return <Center>Member directory is admin-only in this view.</Center>;
  const financeAdmin = ["owner","super_admin","treasurer"].includes(admin?.role);

  const addMember = async () => {
    if (!form.name.trim()) return;
    const amount=form.monthly_amount===""?defaultMonthly:Number(form.monthly_amount);
    await api.members.create({ ...form, monthly_amount: amount });
    setForm({ name: "", phone: "", monthly_amount: String(defaultMonthly) });
    setShowAdd(false);
    load();
  };

  const outstandingByMember = new Map((monthlySummary?.outstanding?.members || []).map((m) => [Number(m.id), m]));
  const activeMembers = members.filter((m) => m.active);
  const memberStatus = (m) => {
    if (!m.active) return "inactive";
    return outstandingByMember.get(Number(m.id))?.payment_status || "paid";
  };
  const counts = activeMembers.reduce((a, m) => { a[memberStatus(m)] = (a[memberStatus(m)] || 0) + 1; return a; }, { paid: 0, partial: 0, unpaid: 0, exempt: 0 });
  const expected = activeMembers.reduce((sum, m) => sum + Number(m.monthly_amount || 0), 0);
  const dueTotal = Number(monthlySummary?.outstanding?.total || 0);
  const collected = Math.max(0, expected - dueTotal);
  const percent = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
  const filtered = members.filter((m) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || m.name.toLowerCase().includes(q) || String(m.member_code || "").toLowerCase().includes(q) || String(m.phone || "").includes(q);
    const status = memberStatus(m);
    const matchesFilter = filter === "all" || (filter === "outstanding" ? status === "partial" || status === "unpaid" : status === filter);
    return matchesSearch && matchesFilter;
  });

  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  const sendOutstandingReminders = async () => {
    const dueCount = counts.partial + counts.unpaid;
    if (!dueCount) return;
    if (!confirm(`Send Telegram payment reminders to ${dueCount} outstanding ${dueCount === 1 ? "member" : "members"} for ${monthLabel}?`)) return;
    try {
      setReminderBusy(true);
      setReminderMessage("");
      const result = await api.admin.sendPaymentReminders({ month });
      setReminderMessage(`Sent ${result.sent || 0} reminder${Number(result.sent || 0) === 1 ? "" : "s"}${result.unlinked ? ` · ${result.unlinked} not linked to Telegram` : ""}.`);
    } catch (e) {
      setReminderMessage(e.message);
    } finally {
      setReminderBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "#1F3D2B" }}>Members</div>
          <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 2 }}>{activeMembers.length} active members</div>
        </div>
        <button onClick={() => { setForm({name:"",phone:"",monthly_amount:String(defaultMonthly)}); setShowAdd(true); }} className="sans" style={{ display: "flex", alignItems: "center", gap: 5, background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 9, padding: "8px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={15} /> Add
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E9E4D8", borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
          <label className="sans" style={{ position: "relative", fontSize: 14, fontWeight: 700, color: "#1F3D2B", cursor: "pointer" }}>
            {monthLabel}
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" }} />
          </label>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sans" style={{ fontSize: 18, fontWeight: 750, color: "#1F3D2B" }}>MVR {fmt(collected)} <span style={{ fontSize: 12, fontWeight: 500, color: "#8A9086" }}>/ {fmt(expected)}</span></div>
          <div className="sans" style={{ fontSize: 12, fontWeight: 700, color: "#3A6B3E" }}>{percent}% collected</div>
        </div>
        <div style={{ height: 6, background: "#ECE8DE", borderRadius: 999, overflow: "hidden", margin: "8px 0 13px" }}><div style={{ width: `${percent}%`, height: "100%", background: "#3A6B3E", borderRadius: 999 }} /></div>
        <div className="sans" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5, textAlign: "center", fontSize: 10, color: "#6B7268" }}>
          <div><b style={{ display: "block", fontSize: 14, color: "#3A6B3E" }}>{counts.paid}</b>Paid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#7A5A18" }}>{counts.partial}</b>Partial</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#A6432F" }}>{counts.unpaid}</b>Unpaid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "#51606A" }}>{counts.exempt}</b>Exempt</div>
        </div>
      </div>

      {financeAdmin && (counts.partial + counts.unpaid) > 0 && (
        <button onClick={sendOutstandingReminders} disabled={reminderBusy}
          className="sans"
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:7, background:"#EAF1EE", color:"#1F3D2B", border:"1px solid #CFE0D6", borderRadius:11, padding:"10px 12px", fontSize:12, fontWeight:700, cursor:reminderBusy?"default":"pointer", opacity:reminderBusy?.7:1, marginBottom:8 }}>
          <Bell size={14} /> {reminderBusy ? "Sending reminders…" : `Remind ${counts.partial + counts.unpaid} outstanding ${counts.partial + counts.unpaid === 1 ? "member" : "members"}`}
        </button>
      )}
      {reminderMessage && <div className="sans" style={{fontSize:10,color:reminderMessage.startsWith("Sent")?"#3A6B3E":"#A6432F",margin:"0 2px 10px"}}>{reminderMessage}</div>}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 3, marginBottom: 10 }}>
        {[['all','All'],['outstanding','Outstanding'],['paid','Paid'],['partial','Partial'],['unpaid','Unpaid'],['exempt','Exempt']].map(([key,label]) => (
          <button key={key} onClick={() => setFilter(key)} className="sans" style={{ flexShrink: 0, border: filter === key ? "1px solid #1F3D2B" : "1px solid #DED8CA", background: filter === key ? "#1F3D2B" : "#fff", color: filter === key ? "#fff" : "#6B7268", borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={16} color="#8A9086" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID or phone…" className="sans" style={{ width: "100%", border: "1px solid #D9D3C4", borderRadius: 10, padding: "10px 12px 10px 36px", fontSize: 13, boxSizing: "border-box", background: "#fff" }} />
      </div>

      {filtered.map((m) => {
        const monthly = outstandingByMember.get(Number(m.id));
        const status = memberStatus(m);
        const paid = Number(monthly?.paid ?? (status === "paid" ? m.monthly_amount : 0));
        const due = status === "exempt" || status === "inactive" ? 0 : Math.max(0, Number(m.monthly_amount) - paid);
        const memberPercent = Number(m.monthly_amount) > 0 ? Math.min(100, Math.round((paid / Number(m.monthly_amount)) * 100)) : 0;
        return (
          <div key={m.id} onClick={() => setSelected(m)} style={{ background: m.active ? "#fff" : "#F1EFE7", opacity: m.active ? 1 : 0.65, border: "1px solid #E9E4D8", borderRadius: 12, padding: "13px 14px", marginBottom: 8, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sans" style={{ fontSize: 14, fontWeight: 650, color: "#222" }}>{m.name} <span style={{ fontSize: 11, color: "#B5AE9C", fontWeight: 500 }}>{m.member_code}</span></div>
                <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 2 }}>{m.phone ? m.phone : "Phone not added"} · MVR {fmt(m.monthly_amount)}/mo</div>
              </div>
              <StatusBadge status={status} />
            </div>
            {m.active && status !== "exempt" && <>
              <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 10, color: "#6B7268" }}>
                <span>MVR {fmt(paid)} of {fmt(m.monthly_amount)} paid</span>
                <span style={{ color: due > 0 ? "#A6432F" : "#3A6B3E", fontWeight: 650 }}>{due > 0 ? `MVR ${fmt(due)} due` : "Complete"}</span>
              </div>
              <div style={{ height: 4, background: "#ECE8DE", borderRadius: 999, overflow: "hidden", marginTop: 6 }}><div style={{ width: `${memberPercent}%`, height: "100%", background: status === "partial" ? "#B58A3D" : "#3A6B3E" }} /></div>
            </>}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="sans" style={{ textAlign: "center", fontSize: 13, color: "#8A9086", padding: "24px 0" }}>No members match this view.</div>}

      {selected && <MemberPopup member={selected} month={month} canRemind={financeAdmin} onClose={() => setSelected(null)} onChanged={load} />}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="Add member">
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" prefix="MVR" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: v })} />
          <PrimaryButton onClick={addMember}>Add member</PrimaryButton>
        </Modal>
      )}
    </>
  );
}

function monthNavBtn() {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#F7F5EF", color: "#1F3D2B", border: "1px solid #E9E4D8", borderRadius: 9, cursor: "pointer" };
}

function StatusBadge({ status }) {
  const styles = {
    paid: { label: "Paid", color: "#1F3D2B", bg: "#EAF1EE", border: "#CFE0D6" },
    partial: { label: "Partial", color: "#7A5A18", bg: "#FFF6E5", border: "#EFD9A9" },
    unpaid: { label: "Unpaid", color: "#A6432F", bg: "#FDEDE8", border: "#F2D6D0" },
    exempt: { label: "Exempt", color: "#51606A", bg: "#EEF1F3", border: "#D7DEE3" },
    inactive: { label: "Inactive", color: "#6B7268", bg: "#F1EFE7", border: "#DED8CA" },
  };
  const s = styles[status] || styles.unpaid;
  return (
    <div className="sans" style={{ flexShrink: 0, minWidth: 58, textAlign: "center", color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 999, padding: "5px 8px", fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </div>
  );
}

function MemberPopup({ member, month, canRemind, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [form, setForm] = useState({ name: member.name, phone: member.phone, monthly_amount: member.monthly_amount });

  useEffect(() => { api.members.statement(member.id).then(setDetail).catch(() => {}); }, [member.id]);

  const save = async () => {
    await api.members.update(member.id, { ...form, monthly_amount: Number(form.monthly_amount) });
    setEditing(false);
    onChanged();
    onClose();
  };

  const toggleActive = async () => {
    const action = member.active ? "deactivate" : "reactivate";
    if (!confirm(`${action === "deactivate" ? "Deactivate" : "Reactivate"} ${member.name}?`)) return;
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

  const statusColor = currentLabel === "paid" ? "#3A6B3E" : currentLabel === "partial" ? "#7A5A18" : currentLabel === "exempt" ? "#51606A" : "#A6432F";
  const monthLabel = (() => {
    try { return new Intl.DateTimeFormat("en",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)); }
    catch { return month; }
  })();

  const contributionCard = (h) => {
    const applied = allocationsFor(h.id);
    const refValid = looksLikeBankRef(h.ref_number);
    return (
      <div key={h.id} style={{ background:"#fff", border:"1px solid #E9E4D8", borderRadius:12, padding:"12px 13px", marginBottom:8 }}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
          <div style={{minWidth:0}}>
            <div className="sans" style={{fontSize:13,fontWeight:700,color:"#1F3D2B"}}>{h.txn_id}</div>
            <div className="sans" style={{fontSize:10,color:"#8A9086",marginTop:2,textTransform:"capitalize"}}>
              {h.status}{h.approved_at ? ` · ${formatLocalDateTime(h.approved_at)}` : h.submitted_at ? ` · ${formatLocalDateTime(h.submitted_at)}` : ""}
            </div>
          </div>
          <div className="sans" style={{fontSize:14,fontWeight:700,whiteSpace:"nowrap"}}>MVR {fmt(h.amount)}</div>
        </div>

        <div className="sans" style={{fontSize:10,color:refValid?"#6B7268":"#A46B24",marginTop:8}}>
          {refValid ? <>Bank ref: <b style={{color:"#1F3D2B"}}>{h.ref_number}</b></> : <>⚠ Reference needs review: <b>{h.ref_number || "not detected"}</b></>}
        </div>

        {applied.length > 0 && (
          <div style={{background:"#F7F5EF",borderRadius:9,padding:"8px 9px",marginTop:8}}>
            <div className="sans" style={{fontSize:9,fontWeight:700,color:"#6B7268",letterSpacing:.5,marginBottom:4}}>APPLIED TO</div>
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
          <div className="sans" style={{fontSize:9,color:"#9A9384",marginTop:7}}>
            Legacy contribution · applied to {h.month}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={onClose} title={member.name} action={<button onClick={() => setEditing(true)} style={{ background:"none", border:"none", cursor:"pointer" }}><Pencil size={17} color="#8A9086" /></button>}>
      {editing ? (
        <>
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Phone" value={form.phone || ""} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Monthly amount" type="number" prefix="MVR" value={form.monthly_amount} onChange={(v) => setForm({ ...form, monthly_amount: v })} />
          <PrimaryButton onClick={save}>Save changes</PrimaryButton>
        </>
      ) : (
        <>
          <div className="sans" style={{fontSize:12,color:"#8A9086"}}>
            {member.member_code} · {member.phone || "Phone not added"} · MVR {fmt(member.monthly_amount)}/mo
          </div>
          <div className="sans" style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:member.telegram_id?"#3A6B3E":"#8A9086",marginTop:5}}>
            <span>{member.telegram_id ? "●" : "○"}</span>{member.telegram_id ? "Telegram linked" : "Telegram not linked"}
          </div>

          <div style={{background:"#F7F5EF",border:"1px solid #E9E4D8",borderRadius:12,padding:13,marginTop:14}}>
            <div className="sans" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                <div style={{fontSize:10,color:"#8A9086"}}>{monthLabel}</div>
                <div style={{fontSize:15,fontWeight:700,color:statusColor,textTransform:"capitalize",marginTop:2}}>{currentLabel}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700}}>MVR {fmt(currentPaid)} / {fmt(monthlyAmount)}</div>
                <div style={{fontSize:10,color:currentDue>0?"#A6432F":"#3A6B3E",marginTop:2}}>{currentDue>0?`MVR ${fmt(currentDue)} due`:"No amount due"}</div>
              </div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:9,marginBottom:16}}>
            <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:11}}>
              <div className="sans" style={{fontSize:9,color:"#8A9086"}}>TOTAL CONTRIBUTED</div>
              <div className="sans" style={{fontSize:14,fontWeight:700,marginTop:3}}>MVR {fmt(totalContributed)}</div>
            </div>
            <div style={{background:"#fff",border:"1px solid #E9E4D8",borderRadius:11,padding:11}}>
              <div className="sans" style={{fontSize:9,color:"#8A9086"}}>CURRENT OUTSTANDING</div>
              <div className="sans" style={{fontSize:14,fontWeight:700,color:currentDue>0?"#A6432F":"#3A6B3E",marginTop:3}}>MVR {fmt(currentDue)}</div>
            </div>
          </div>

          <div className="sans" style={{fontSize:11,color:"#6B7268",marginBottom:8,fontWeight:700,letterSpacing:.5}}>CONTRIBUTION HISTORY</div>
          {approved.map(contributionCard)}
          {approved.length===0 && <div className="sans" style={{fontSize:12,color:"#8A9086",padding:"8px 0"}}>No approved contributions yet.</div>}

          {rejected.length>0 && (
            <>
              <button onClick={()=>setShowRejected(!showRejected)} className="sans"
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",border:0,background:"transparent",padding:"10px 2px",color:"#8A9086",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                <span>REJECTED / VOIDED · {rejected.length}</span><span>{showRejected?"▲":"▼"}</span>
              </button>
              {showRejected && rejected.map(contributionCard)}
            </>
          )}

          <div className="sans" style={{fontSize:10,color:"#8A9086",fontWeight:700,marginTop:12,marginBottom:6}}>EXPORT STATEMENT</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button className="sans" onClick={async () => { const { exportStatementPdf } = await import("../utils/exports"); return exportStatementPdf(member); }} style={smallBtn()}>PDF</button>
            <button className="sans" onClick={async () => { const { exportStatementCsv } = await import("../utils/exports"); return exportStatementCsv(member); }} style={smallBtn()}>CSV</button>
          </div>

          {member.active && canRemind && currentDue > 0 && <button className="sans" disabled={reminding} onClick={async()=>{
            if(!confirm(`Send a payment reminder to ${member.name} for ${monthLabel}?`)) return;
            try{
              setReminding(true); setReminderNote("");
              const r=await api.admin.sendPaymentReminders({month,member_id:member.id});
              setReminderNote(r.sent ? "Reminder sent." : (r.reason || "No reminder sent."));
            }catch(e){setReminderNote(e.message)} finally{setReminding(false)}
          }} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"#EAF1EE",color:"#1F3D2B",border:"1px solid #CFE0D6",borderRadius:10,padding:11,fontSize:12,fontWeight:700,cursor:"pointer",marginTop:10}}>
            <Bell size={14}/>{reminding?"Sending…":"Send payment reminder"}
          </button>}

          {member.active && canRemind && currentDue <= 0 && (
            <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"#F2F5F3",color:"#6B7268",border:"1px solid #E0E6E2",borderRadius:10,padding:10,fontSize:11,fontWeight:600,marginTop:10}}>
              ✓ Paid — no reminder needed
            </div>
          )}

          {reminderNote && <div className="sans" style={{fontSize:10,color:"#6B7268",marginTop:5,textAlign:"center"}}>{reminderNote}</div>}

          <button onClick={toggleActive} className="sans"
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",background:"none",color:member.active?"#A6432F":"#3A6B3E",border:"1px solid "+(member.active?"#F2D6D0":"#DDECD9"),borderRadius:10,padding:12,fontSize:13,fontWeight:600,cursor:"pointer",marginTop:12}}>
            {member.active ? "Deactivate member" : "Reactivate member"}
          </button>
        </>
      )}
    </Modal>
  );
}

/* ---------- Member-only views ---------- */
