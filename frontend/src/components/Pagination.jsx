import React from "react";

export const PAGE_SIZE = 20;
export const pageSlice = (rows = [], page = 1, pageSize = PAGE_SIZE) => {
  const safe = Array.isArray(rows) ? rows : [];
  const pages = Math.max(1, Math.ceil(safe.length / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * pageSize;
  return { rows: safe.slice(start, start + pageSize), page: current, pages };
};

export default function Pagination({ page = 1, total = 0, pageSize = PAGE_SIZE, onChange }) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return <div className="sans" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,margin:"12px 0 4px"}}>
    <button type="button" disabled={current<=1} onClick={()=>onChange?.(current-1)} style={{border:"1px solid var(--border-strong)",background:"var(--card)",color:"var(--text)",borderRadius:9,padding:"7px 11px",fontSize:11,fontWeight:600,opacity:current<=1?.45:1}}>Previous</button>
    <span style={{fontSize:10,color:"var(--muted)"}}>Page {current} of {pages}</span>
    <button type="button" disabled={current>=pages} onClick={()=>onChange?.(current+1)} style={{border:"1px solid var(--border-strong)",background:"var(--card)",color:"var(--text)",borderRadius:9,padding:"7px 11px",fontSize:11,fontWeight:600,opacity:current>=pages?.45:1}}>Next</button>
  </div>;
}
