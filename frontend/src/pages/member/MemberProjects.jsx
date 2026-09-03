import React, { useEffect, useState } from "react";
import { Eye, FolderKanban } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, LoadingState, compactBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";

const statusTone = (status) => status === "active" ? "var(--success-strong)" : "var(--muted)";

export function MemberProjects() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = ({ silent = false } = {}) => {
    if (!silent) {
      setData(null);
      setError("");
    }
    return api.myProjects()
      .then(setData)
      .catch((e) => {
        if (!silent) setError(e?.message || "Could not load projects.");
      });
  };

  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(({ path }) => {
    if (path?.startsWith("/api/projects") || path?.startsWith("/api/expenses") || path?.startsWith("/api/donations") || path?.startsWith("/api/settings")) {
      load({ silent: true });
    }
  }), []);

  if (error) return <div className="sans" style={{background:"var(--danger-bg-4)",border:"1px solid var(--danger-border-3)",borderRadius:12,padding:16,color:"var(--danger-strong)"}}>
    <div style={{fontWeight:700,marginBottom:5}}>Projects unavailable</div>
    <div style={{fontSize:12,marginBottom:12}}>{error}</div>
    <button type="button" onClick={()=>load()} style={compactBtn}>Try again</button>
  </div>;

  if (!data) return <LoadingState>Loading projects…</LoadingState>;
  if (data.enabled === false) return <EmptyState>Project visibility is currently disabled for members.</EmptyState>;

  const projects = data.projects || [];
  if (!projects.length) return <EmptyState>No active or completed projects yet.</EmptyState>;

  return <>
    <div className="sans" style={{display:"flex",alignItems:"center",gap:7,background:"var(--success-bg)",color:"var(--success-strong)",fontSize:12,borderRadius:10,padding:"9px 12px",marginBottom:14}}>
      <Eye size={13}/> Project information is read-only. Only approved spending is shown.
    </div>

    {projects.map((p) => {
      const open = expanded === p.id;
      const budget = p.budget == null ? null : Number(p.budget);
      const spent = Number(p.spent || 0);
      const remaining = p.remaining_budget == null ? null : Number(p.remaining_budget);
      const pct = budget == null ? 0 : Math.max(0, Math.min(100, Number(p.budget_used_pct || 0)));
      const expenses = p.expenses || [];
      return <div key={p.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:10}}>
        <button type="button" onClick={()=>setExpanded(open?null:p.id)} style={{display:"block",width:"100%",border:0,background:"transparent",padding:0,color:"inherit",textAlign:"left",cursor:"pointer"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
            <div style={{minWidth:0}}>
              <div className="sans" style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                <FolderKanban size={15}/><strong style={{fontSize:14}}>{p.name}</strong>
                <span style={{fontSize:9,fontWeight:700,color:statusTone(p.status),textTransform:"uppercase"}}>{p.status}</span>
              </div>
              <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:4}}>{p.project_code}{p.responsible_member_name?` · ${p.responsible_member_name}`:""}</div>
            </div>
            <span className="sans" style={{fontSize:17,color:"var(--soft)"}}>{open?"⌃":"⌄"}</span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
            <Metric label="Spent" value={`MVR ${fmt(spent)}`} />
            <Metric label={budget == null?"Budget":"Remaining"} value={budget == null?"Open cost":`MVR ${fmt(remaining)}`} />
          </div>
          {budget != null && <div style={{height:5,borderRadius:99,background:"var(--divider)",overflow:"hidden",marginTop:10}}><div style={{height:"100%",width:`${pct}%`,background:Number(p.budget_used_pct||0)>100?"var(--danger)":pct>=90?"var(--warning)":"var(--success-strong)",borderRadius:99}}/></div>}
          <div className="sans" style={{fontSize:10,color:"var(--soft)",marginTop:8}}>{expenses.length} approved expense{expenses.length===1?"":"s"} · Tap {open?"to hide":"for details"}</div>
        </button>

        {open && <div style={{marginTop:13,paddingTop:12,borderTop:"1px solid var(--divider)"}}>
          {p.description && <div className="sans" style={{fontSize:11,color:"var(--muted)",lineHeight:1.55,marginBottom:10}}>{p.description}</div>}
          <Detail label="Budget" value={budget == null?"Open cost":`MVR ${fmt(budget)}`}/>
          <Detail label="Total spent" value={`MVR ${fmt(spent)}`}/>
          {budget != null && <Detail label="Remaining" value={`MVR ${fmt(remaining)}`}/>} 
          <Detail label="Responsible" value={p.responsible_member_name || "Not assigned"}/>
          <Detail label="Start" value={p.start_date || "—"}/>
          <Detail label="Target end" value={p.target_end_date || "—"}/>

          <div className="sans" style={{fontSize:11,fontWeight:700,color:"var(--muted)",margin:"14px 0 7px"}}>APPROVED PROJECT EXPENSES</div>
          {expenses.length === 0 ? <div className="sans" style={{fontSize:11,color:"var(--soft)"}}>No expenses yet.</div> : expenses.map((e)=><div key={e.id} style={{display:"flex",justifyContent:"space-between",gap:10,borderTop:"1px solid var(--divider)",padding:"9px 0"}}>
            <div className="sans" style={{fontSize:11,minWidth:0}}><b>{e.description}</b><div style={{fontSize:9,color:"var(--soft)",marginTop:2}}>{e.expense_date || "—"} · {e.category || "Uncategorised"}</div></div>
            <b className="sans" style={{fontSize:11,whiteSpace:"nowrap",color:"var(--danger)"}}>MVR {fmt(e.amount)}</b>
          </div>)}
        </div>}
      </div>;
    })}
  </>;
}

function Metric({label,value}) { return <div className="sans" style={{border:"1px solid var(--divider)",borderRadius:10,padding:"9px 10px"}}><div style={{fontSize:9,color:"var(--soft)",textTransform:"uppercase"}}>{label}</div><strong style={{display:"block",fontSize:12,marginTop:3}}>{value}</strong></div>; }
function Detail({label,value}) { return <div className="sans" style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid var(--divider)",fontSize:11}}><span style={{color:"var(--muted)"}}>{label}</span><strong style={{textAlign:"right"}}>{value}</strong></div>; }
