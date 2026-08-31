
export function MessageBanner({ children, tone = "success" }) {
  if (!children) return null;
  const error = tone === "error";
  return (
    <div className="sans" style={{
      fontSize: 11, padding: 10, borderRadius: 9, marginBottom: 12,
      background: error ? "#FDEDE8" : "#EAF1EE",
      color: error ? "#A6432F" : "#1F3D2B",
      border: `1px solid ${error ? "#F2D6D0" : "#CFE0D6"}`
    }}>{children}</div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div className="sans" style={{ fontSize: 15, fontWeight: 700, color: "#1F3D2B" }}>{title}</div>
        {subtitle && <div className="sans" style={{ fontSize: 11, color: "#8A9086", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Center({ children }) {
  return <div style={{ padding: 60, textAlign: "center", fontFamily: "\'Inter\',sans-serif", color: "#6B7268" }}>{children}</div>;
}

export function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="sans"
      style={{ width: "100%", background: "#1F3D2B", color: "#F7F5EF", border: "none", borderRadius: 10, padding: 13, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {children}
    </button>
  );
}

export function SectionTitle({children}) { return <div className="sans" style={{fontSize:12,color:"#6B7268",fontWeight:700,letterSpacing:.7,margin:"18px 0 8px"}}>{children}</div>; }
export function EmptyLine({children}) { return <div className="sans" style={{fontSize:12,color:"#8A9086",padding:"8px 2px 14px"}}>{children}</div>; }
export const cardStyle={background:"#fff",border:"1px solid #E9E4D8",borderRadius:12,padding:14,marginBottom:8};
export const compactBtn={background:"#F1EFE7",border:"1px solid #DED8CA",borderRadius:8,padding:"7px 10px",fontSize:12,cursor:"pointer"};
export const approveBtn={...compactBtn,background:"#EAF1EE",color:"#1F3D2B",border:"1px solid #CFE0D6",fontWeight:600};
export const rejectBtn={...compactBtn,background:"#FDEDE8",color:"#A6432F",border:"1px solid #F2D6D0",fontWeight:600};

export function monthNavBtn() {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#F7F5EF", color: "#1F3D2B", border: "1px solid #E9E4D8", borderRadius: 9, cursor: "pointer" };
}

export function smallBtn(color) {
  return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "#fff", border: "1px solid #E9E4D8", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 600, color, cursor: "pointer" };
}
