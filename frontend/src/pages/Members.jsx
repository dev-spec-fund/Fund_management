import React, { useState } from "react";
import { Plus, Bell, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { api } from "../api";
import { Modal, Field, useConfirmDialog } from "../components/FormControls";
import { Center, PrimaryButton, monthNavBtn, primaryBtn, approveBtn } from "../components/Shared";
import { fmt } from "../utils/format";
import { adminCan } from "../utils/permissions";
import Pagination from "../components/Pagination";
import MemberPopup, { StatusBadge } from "./members/MemberPopup";
import useMembersData from "./members/useMembersData";

export default function Members({ isAdmin, admin, month: sharedMonth, onMonthChange }) {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const {
    month, setMonth, search, setSearch, filter, setFilter, defaultMonthly, form, setForm,
    page, setPage, load, outstandingByMember, activeMembers, memberStatus, counts, expected,
    collected, percent, filtered, memberPage, shiftMonth, monthLabel,
  } = useMembersData(isAdmin, sharedMonth, onMonthChange);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");

  if (!isAdmin) return <Center>Member directory is admin-only in this view.</Center>;
  const financeAdmin = adminCan(admin, "finance");

  const addMember = async () => {
    if (!form.name.trim()) return;
    const amount=form.monthly_amount===""?defaultMonthly:Number(form.monthly_amount);
    await api.members.create({ ...form, monthly_amount: amount });
    setForm({ name: "", phone: "", monthly_amount: String(defaultMonthly) });
    setShowAdd(false);
    load();
  };


  const sendOutstandingReminders = async () => {
    const dueCount = counts.partial + counts.unpaid;
    if (!dueCount) return;
    if (!await confirm({title:"Send payment reminders?",message:`Send Telegram payment reminders to ${dueCount} outstanding ${dueCount === 1 ? "member" : "members"} for ${monthLabel}?`,confirmLabel:"Send reminders",tone:"primary"})) return;
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
      {confirmationDialog}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "var(--primary-text)" }}>Members</div>
          <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginTop: 2 }}>{activeMembers.length} active members</div>
        </div>
        <button type="button" onClick={() => { setForm({name:"",phone:"",monthly_amount:String(defaultMonthly)}); setShowAdd(true); }} className="sans" style={primaryBtn}>
          <Plus size={15} /> Add
        </button>
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
          <label className="sans" style={{ position: "relative", fontSize: 14, fontWeight: 700, color: "var(--primary-text)", cursor: "pointer" }}>
            {monthLabel}
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" }} />
          </label>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sans" style={{ fontSize: 17, fontWeight: 750, color: "var(--primary-text)" }}>MVR {fmt(collected)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--soft)" }}>/ {fmt(expected)}</span></div>
          <div className="sans" style={{ fontSize: 12, fontWeight: 700, color: "var(--success)" }}>{percent}% collected</div>
        </div>
        <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", margin: "7px 0 10px" }}><div style={{ width: `${percent}%`, height: "100%", background: "var(--success)", borderRadius: 999 }} /></div>
        <div className="sans" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, textAlign: "center", fontSize: 9, color: "var(--muted)" }}>
          <div><b style={{ display: "block", fontSize: 14, color: "var(--success)" }}>{counts.paid}</b>Paid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "var(--warning)" }}>{counts.partial}</b>Partial</div>
          <div><b style={{ display: "block", fontSize: 14, color: "var(--danger)" }}>{counts.unpaid}</b>Unpaid</div>
          <div><b style={{ display: "block", fontSize: 14, color: "var(--neutral-text)" }}>{counts.exempt}</b>Exempt</div>
          <div><b style={{ display: "block", fontSize: 14, color: "var(--soft)" }}>{counts.not_applicable||0}</b>Not due</div>
        </div>
      </div>

      {financeAdmin && (counts.partial + counts.unpaid) > 0 && (
        <button type="button" onClick={sendOutstandingReminders} disabled={reminderBusy}
          className="sans"
          style={{...approveBtn,width:"100%",marginBottom:8}}>
          <Bell size={14} /> {reminderBusy ? "Sending reminders…" : `Remind ${counts.partial + counts.unpaid} outstanding ${counts.partial + counts.unpaid === 1 ? "member" : "members"}`}
        </button>
      )}
      {reminderMessage && <div className="sans" style={{fontSize:10,color:reminderMessage.startsWith("Sent")?"var(--success)":"var(--danger)",margin:"0 2px 10px"}}>{reminderMessage}</div>}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 3, marginBottom: 10 }}>
        {[['all','All'],['outstanding','Outstanding'],['paid','Paid'],['partial','Partial'],['unpaid','Unpaid'],['exempt','Exempt'],['not_applicable','Not due']].map(([key,label]) => (
          <button type="button" key={key} onClick={() => setFilter(key)} className={filter === key ? "expense-filter-chip active sans" : "expense-filter-chip sans"}>{label}</button>
        ))}
      </div>

      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={16} color="var(--soft)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID or phone…" className="sans" style={{ width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, padding: "10px 12px 10px 36px", fontSize: 13, boxSizing: "border-box", background: "var(--card)" }} />
      </div>

      {memberPage.rows.map((m) => {
        const monthly = outstandingByMember.get(Number(m.id));
        const status = memberStatus(m);
        const required = Number(monthly?.monthly_amount ?? m.monthly_amount ?? 0);
        const paid = Number(monthly?.paid ?? (status === "paid" ? required : 0));
        const noContributionDue = status === "exempt" || status === "inactive" || status === "not_applicable" || required <= 0.004;
        const due = noContributionDue ? 0 : Math.max(0, required - paid);
        const memberPercent = required > 0 ? Math.min(100, Math.round((paid / required) * 100)) : 0;
        return (
          <div key={m.id} onClick={() => setSelected(m)} style={{ background: m.active ? "var(--card)" : "var(--button-soft)", opacity: m.active ? 1 : 0.65, border: "1px solid var(--border)", borderRadius: 12, padding: "11px 12px", marginBottom: 7, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sans" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                  <span>{m.name} <span style={{ fontSize: 11, color: "var(--soft-4)", fontWeight: 500 }}>{m.member_code}</span></span>
                  {m.exco_role && <span className="member-exco-badge">{m.exco_role}</span>}
                </div>
                <div className="sans" style={{ fontSize: 10, color: "var(--soft)", marginTop: 2 }}>{m.phone ? m.phone : "Phone not added"} · MVR {fmt(m.monthly_amount)}/mo</div>
              </div>
              <StatusBadge status={status} />
            </div>
            {m.active && status !== "exempt" && (
              status === "not_applicable" || required <= 0.004 ? (
                <div className="sans" style={{ fontSize: 10, marginTop: 8, color: "var(--muted)" }}>
                  No contribution due for {monthLabel}
                </div>
              ) : <>
                <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 8, color: "var(--muted)" }}>
                  <span>MVR {fmt(paid)} of {fmt(required)} paid</span>
                  <span style={{ color: due > 0 ? "var(--danger)" : "var(--success)", fontWeight: 650 }}>{due > 0 ? `MVR ${fmt(due)} due` : "Complete"}</span>
                </div>
                <div style={{ height: 4, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", marginTop: 5 }}><div style={{ width: `${memberPercent}%`, height: "100%", background: status === "partial" ? "var(--warning-4)" : "var(--success)" }} /></div>
              </>
            )}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="sans" style={{ textAlign: "center", fontSize: 13, color: "var(--soft)", padding: "24px 0" }}>No members match this view.</div>}
      <Pagination page={memberPage.page} total={filtered.length} onChange={setPage} />

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
