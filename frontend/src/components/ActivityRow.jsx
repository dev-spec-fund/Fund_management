import { ArrowUpRight, ArrowDownRight, Pencil } from "lucide-react";
import { fmt } from "../utils/format";

function activityDate(a) {
  const d = a?.at ? new Date(String(a.at).replace(" ", "T") + (String(a.at).includes("Z") ? "" : "Z")) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export function activityDayLabel(a) {
  const d = activityDate(a);
  if (!d) return "Earlier";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((today - local) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function activityTime(a) {
  const d = activityDate(a);
  return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

export function ActivityRow({ a, isAdmin, canFinance = false, onExpenseClick }) {
  const isIn = a.kind === "contribution" || a.kind === "donation";
  const type = a.kind === "contribution" ? "Contribution" : a.kind === "donation" ? "Donation" : "Expense";
  return (
    <div onClick={() => a.kind === "expense" && canFinance && onExpenseClick?.(a)}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", marginBottom: 7, cursor: a.kind === "expense" && canFinance ? "pointer" : "default" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <div style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 10, background: isIn ? "var(--success-bg-2)" : "var(--danger-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isIn ? <ArrowUpRight size={16} color="var(--success)" /> : <ArrowDownRight size={16} color="var(--danger)" />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sans" style={{ fontSize: 14, fontWeight: 600 }}>{a.who}</div>
          <div className="sans" style={{ fontSize: 12, color: "var(--soft)", marginTop: 1 }}>
            {type}{a.kind === "contribution" && a.month ? ` · ${a.month}` : ""}{a.kind === "expense" && a.category ? ` · ${a.category}` : ""}
          </div>
          <div className="sans" style={{ fontSize: 11, color: "var(--soft-3)", marginTop: 2 }}>
            {[a.member_code, a.txn_id, activityTime(a)].filter(Boolean).join(" · ")}
          </div>
          {isAdmin && a.by_name && <div className="sans" style={{ fontSize: 11, color: "var(--soft)", marginTop: 1 }}>{a.kind === "contribution" ? "Approved by " : "Logged by "}{a.by_name}</div>}
        </div>
      </div>
      <div className="sans" style={{ flex: "0 0 auto", marginLeft: 10, fontSize: 14, fontWeight: 700, color: isIn ? "var(--success)" : "var(--danger)" }}>
        <div>{isIn ? "+" : "−"} MVR {fmt(a.amount)}</div>
        {a.kind === "expense" && canFinance && <div style={{fontSize:10,fontWeight:500,color:"var(--soft)",marginTop:3,textAlign:"right"}}><Pencil size={10} style={{verticalAlign:"-1px",marginRight:3}}/>Edit</div>}
      </div>
    </div>
  );
}
/* ---------- Members (admin) ---------- */
