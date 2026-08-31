
export function MessageBanner({ children, tone = "success" }) {
  if (!children) return null;
  const error = tone === "error";
  return (
    <div className="sans" style={{
      fontSize: 11, padding: 10, borderRadius: 9, marginBottom: 12,
      background: error ? "var(--danger-bg)" : "var(--success-bg)",
      color: error ? "var(--danger)" : "var(--primary)",
      border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`
    }}>{children}</div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "var(--primary)" }}>{title}</div>
        {subtitle && <div className="sans" style={{ fontSize: 11, color: "var(--soft)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Center({ children }) {
  return <div style={{ padding: 60, textAlign: "center", fontFamily: "\'Inter\',sans-serif", color: "var(--muted)" }}>{children}</div>;
}

export function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="sans"
      style={{ width: "100%", background: "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {children}
    </button>
  );
}

export function SectionTitle({children}) { return <div className="sans" style={{fontSize:12,color:"var(--muted)",fontWeight:700,letterSpacing:.7,margin:"18px 0 8px"}}>{children}</div>; }
export function EmptyLine({children}) { return <div className="sans" style={{fontSize:12,color:"var(--soft)",padding:"8px 2px 14px"}}>{children}</div>; }
export const cardStyle={background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:8};
export const compactBtn={background:"var(--button-soft)",border:"1px solid var(--border-strong-2)",borderRadius:8,padding:"7px 10px",fontSize:12,cursor:"pointer"};
export const approveBtn={...compactBtn,background:"var(--success-bg)",color:"var(--primary)",border:"1px solid var(--success-border)",fontWeight:600};
export const rejectBtn={...compactBtn,background:"var(--danger-bg)",color:"var(--danger)",border:"1px solid var(--danger-border)",fontWeight:600};

export function monthNavBtn() {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "var(--bg)", color: "var(--primary)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer" };
}

export function smallBtn(color) {
  return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 600, color, cursor: "pointer" };
}
