
export function MessageBanner({ children, tone = "success" }) {
  if (!children) return null;
  const error = tone === "error";
  return (
    <div className="sans" style={{
      fontSize: 11, padding: 10, borderRadius: 9, marginBottom: 12,
      background: error ? "var(--danger-bg)" : "var(--success-bg)",
      color: error ? "var(--danger)" : "var(--success-strong)",
      border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`
    }}>{children}</div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "var(--primary-text)" }}>{title}</div>
        {subtitle && <div className="sans" style={{ fontSize: 11, color: "var(--soft)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Center({ children }) {
  return <div style={{ padding: 60, textAlign: "center", fontFamily: "\'Inter\',sans-serif", color: "var(--muted)" }}>{children}</div>;
}

export function PageState({ kind = "empty", title, message, action, compact = false }) {
  const isError = kind === "error";
  const isLoading = kind === "loading";
  const resolvedTitle = title || (isLoading ? "Loading…" : isError ? "Something went wrong" : "Nothing to show");
  return (
    <div className="sans" role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} style={{
      padding: compact ? "22px 14px" : "48px 18px", textAlign: "center", color: "var(--muted)"
    }}>
      <div style={{fontSize:13,fontWeight:700,color:isError?"var(--danger)":"var(--primary-text)"}}>{resolvedTitle}</div>
      {message && <div style={{fontSize:11,lineHeight:1.5,margin:"6px auto 0",maxWidth:320,color:"var(--soft)"}}>{message}</div>}
      {action && <div style={{marginTop:12,display:"flex",justifyContent:"center"}}>{action}</div>}
    </div>
  );
}

export function LoadingState({ children = "Loading…", compact = false }) {
  return <PageState kind="loading" title={children} compact={compact} />;
}
export function EmptyState({ children = "Nothing to show.", compact = false }) {
  return <PageState kind="empty" title={children} compact={compact} />;
}
export function ErrorState({ children = "Could not load this view.", onRetry, compact = false }) {
  return <PageState kind="error" title="Could not load" message={children} compact={compact} action={onRetry ? <button type="button" onClick={onRetry} style={compactBtn}>Try again</button> : null} />;
}

export const buttonBase = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  minHeight: 38, borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 600,
  lineHeight: 1.2, cursor: "pointer", boxSizing: "border-box", whiteSpace: "nowrap",
};

export const compactBtn = {
  ...buttonBase, minHeight: 32, padding: "6px 10px",
  background: "var(--button-soft)", color: "var(--primary-text)",
  border: "1px solid var(--border-strong-2)",
};
export const primaryBtn = {
  ...buttonBase, background: "var(--primary)", color: "var(--on-primary)",
  border: "1px solid var(--primary)",
};
export const secondaryBtn = {
  ...buttonBase, background: "var(--button-soft)", color: "var(--primary-text)",
  border: "1px solid var(--border-strong-2)",
};
export const approveBtn = {
  ...buttonBase, background: "var(--success-bg)", color: "var(--success-strong)",
  border: "1px solid var(--success-border)",
};
export const rejectBtn = {
  ...buttonBase, background: "var(--danger-bg)", color: "var(--danger)",
  border: "1px solid var(--danger-border)",
};

export function PrimaryButton({ onClick, children, disabled = false, type = "button" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="sans"
      style={{ ...primaryBtn, width: "100%", minHeight: 44, borderRadius: 10, padding: "11px 14px", fontSize: 13, fontWeight: 700 }}>
      {children}
    </button>
  );
}

export function SectionTitle({children}) { return <div className="sans" style={{fontSize:12,color:"var(--muted)",fontWeight:700,letterSpacing:.7,margin:"18px 0 8px"}}>{children}</div>; }
export function EmptyLine({children}) { return <div className="sans" style={{fontSize:12,color:"var(--soft)",padding:"8px 2px 14px"}}>{children}</div>; }
export const cardStyle={background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:14,marginBottom:8};

export function monthNavBtn() {
  return { ...compactBtn, width: 36, minWidth: 36, height: 36, minHeight: 36, padding: 0, background: "var(--card)" };
}

export function smallBtn(color = "var(--primary-text)") {
  const isSuccess = color === "var(--success)" || color === "var(--success-strong)";
  const isDanger = color === "var(--danger)" || color === "var(--danger-strong)";
  if (isSuccess) return { ...approveBtn, flex: 1 };
  if (isDanger) return { ...rejectBtn, flex: 1 };
  return { ...secondaryBtn, flex: 1, color };
}
