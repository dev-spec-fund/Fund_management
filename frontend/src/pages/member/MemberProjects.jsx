import React, { useEffect, useState } from "react";
import { Eye, FolderKanban } from "lucide-react";
import { api, onDataChange } from "../../api";
import { EmptyState, compactBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";

const statusTone = (status) => status === "active" ? "var(--success)" : "var(--muted)";

export function MemberProjects() {
  const [data, setData] = useState(()=>api.peekCached("/api/me/projects"));
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [detailSections, setDetailSections] = useState({});

  const load = ({ silent = false } = {}) => {
    if (!silent) { setData((current)=>current || api.peekCached("/api/me/projects")); setError(""); }
    return api.myProjects().then(setData).catch((e) => {
      if (!silent) setError(e?.message || "Could not load projects.");
    });
  };

  useEffect(() => { load(); }, []);
  useEffect(() => onDataChange(({ path }) => {
    if (path?.startsWith("/api/projects") || path?.startsWith("/api/expenses") || path?.startsWith("/api/donations") || path?.startsWith("/api/settings")) {
      load({ silent: true });
    }
  }), []);

  const toggleDetailSection=(projectId,section)=>{
    const key=`${projectId}:${section}`;
    setDetailSections((current)=>({...current,[key]:!current[key]}));
  };
  const sectionOpen=(projectId,section)=>!!detailSections[`${projectId}:${section}`];

  if (error) return <div className="sans" style={{background:"var(--danger-bg-4)",border:"1px solid var(--danger-border-3)",borderRadius:12,padding:16,color:"var(--danger-strong)"}}>
    <div style={{fontWeight:700,marginBottom:5}}>Projects unavailable</div>
    <div style={{fontSize:12,marginBottom:12}}>{error}</div>
    <button type="button" onClick={()=>load()} style={compactBtn}>Try again</button>
  </div>;

  if (!data) return <ProjectsSkeleton/>;
  if (data.enabled === false) return <EmptyState>Project visibility is currently disabled for members.</EmptyState>;

  const projects = data.projects || [];
  if (!projects.length) return <EmptyState>No active or completed projects yet.</EmptyState>;

  return <>
    <div className="sans member-projects-notice">
      <Eye size={13}/> Project finances are read-only. Only approved expenses and active project donations are shown.
    </div>

    {projects.map((p) => {
      const open = expanded === p.id;
      const budget = p.budget == null ? null : Number(p.budget);
      const spent = Number(p.spent || 0);
      const received = Number(p.donations_received || 0);
      const remaining = p.remaining_budget == null ? null : Number(p.remaining_budget);
      const pct = budget == null ? 0 : Math.max(0, Math.min(100, Number(p.budget_used_pct || 0)));
      const rawPct = Number(p.budget_used_pct || 0);
      const expenses = p.expenses || [];
      const donations = p.donations || [];
      const progressTone = rawPct > 100 ? "var(--danger)" : pct >= 90 ? "var(--warning)" : "var(--success)";

      return <article key={p.id} className={`member-project-card${open?" expanded":""}`}>
        <button type="button" onClick={()=>setExpanded(open?null:p.id)} className="member-project-toggle" aria-expanded={open}>
          <div className="member-project-header">
            <div style={{minWidth:0}}>
              <div className="sans member-project-title-row">
                <FolderKanban size={16}/>
                <strong>{p.name}</strong>
                <span className="member-project-status" style={{color:statusTone(p.status)}}>{p.status}</span>
              </div>
              <div className="sans member-project-meta">{p.project_code}{p.responsible_member_name?` · ${p.responsible_member_name}`:""}</div>
            </div>
            <span className={`member-project-chevron${open?" open":""}`} aria-hidden="true">⌄</span>
          </div>

          <div className="member-project-metrics">
            <Metric label="Received" value={`MVR ${fmt(received)}`} tone="success"/>
            <Metric label="Spent" value={`MVR ${fmt(spent)}`} tone="danger"/>
            <Metric label={budget == null?"Budget":"Budget left"} value={budget == null?"Open cost":`MVR ${fmt(remaining)}`} tone={remaining != null && remaining < 0 ? "danger" : ""}/>
          </div>

          {budget != null && <>
            <div className="member-project-progress">
              <div style={{width:`${pct}%`,background:progressTone}}/>
            </div>
            <div className="sans member-project-progress-label">
              <span>{Math.round(rawPct)}% of budget spent</span>
              <span>MVR {fmt(spent)} / {fmt(budget)}</span>
            </div>
          </>}

          <div className="sans member-project-tap-hint">
            <span>{donations.length} donation{donations.length===1?"":"s"} · {expenses.length} expense{expenses.length===1?"":"s"}</span>
            <strong>{open?"Hide details":"View details"} ›</strong>
          </div>
        </button>

        <div className={`member-project-expand${open?" open":""}`} aria-hidden={!open}>
          <div className="member-project-expand-inner">
            <div className="member-project-details">
              {p.description && <div className="sans member-project-description">{p.description}</div>}
              <Detail label="Project budget" value={budget == null?"Open cost":`MVR ${fmt(budget)}`}/>
              <Detail label="Donations received" value={`MVR ${fmt(received)}`} tone="success"/>
              <Detail label="Total spent" value={`MVR ${fmt(spent)}`} tone="danger"/>
              {budget != null && <Detail label="Budget remaining" value={`MVR ${fmt(remaining)}`} tone={remaining<0?"danger":""}/>}
              <Detail label="Responsible" value={p.responsible_member_name || "Not assigned"}/>
              <Detail label="Start" value={p.start_date || "—"}/>
              <Detail label="Target end" value={p.target_end_date || "—"} last/>

              <ProjectSubsection
                title="PROJECT DONATIONS"
                count={donations.length}
                open={sectionOpen(p.id,"donations")}
                onToggle={()=>toggleDetailSection(p.id,"donations")}
              >
                {donations.length === 0 ? <div className="sans member-project-empty">No project donations yet.</div> : donations.map((d)=>
                  <div key={d.id} className="member-project-transaction">
                    <div className="sans"><b>{d.txn_id || "Donation"}</b><div>{d.donation_date || "—"}</div></div>
                    <strong className="sans" style={{color:"var(--success)"}}>+ MVR {fmt(d.amount)}</strong>
                  </div>
                )}
              </ProjectSubsection>

              <ProjectSubsection
                title="APPROVED PROJECT EXPENSES"
                count={expenses.length}
                open={sectionOpen(p.id,"expenses")}
                onToggle={()=>toggleDetailSection(p.id,"expenses")}
              >
                {expenses.length === 0 ? <div className="sans member-project-empty">No expenses yet.</div> : expenses.map((e)=>
                  <div key={e.id} className="member-project-transaction">
                    <div className="sans"><b>{e.description}</b><div>{e.expense_date || "—"} · {e.category || "Uncategorised"}</div></div>
                    <strong className="sans" style={{color:"var(--danger)"}}>− MVR {fmt(e.amount)}</strong>
                  </div>
                )}
              </ProjectSubsection>
            </div>
          </div>
        </div>
      </article>;
    })}
  </>;
}

function ProjectSubsection({title,count,open,onToggle,children}) {
  return <div className="member-project-subsection">
    <button type="button" onClick={onToggle} className="member-project-subsection-toggle" aria-expanded={open}>
      <span className="sans">{title} <b>{count}</b></span>
      <span className={`member-project-subsection-chevron${open?" open":""}`}>⌄</span>
    </button>
    <div className={`member-project-subsection-body${open?" open":""}`}>
      <div>{children}</div>
    </div>
  </div>;
}

function Metric({label,value,tone=""}) {
  const color=tone==="success"?"var(--success)":tone==="danger"?"var(--danger)":"var(--text)";
  return <div className="sans member-project-metric"><div>{label}</div><strong style={{color}}>{value}</strong></div>;
}
function Detail({label,value,tone="",last=false}) {
  const color=tone==="success"?"var(--success)":tone==="danger"?"var(--danger)":"var(--text)";
  return <div className="sans member-project-detail" style={{borderBottom:last?0:undefined}}><span>{label}</span><strong style={{color}}>{value}</strong></div>;
}
function ProjectsSkeleton(){
  return <div aria-label="Loading projects" aria-busy="true">
    <div className="skeleton-block" style={{height:42,borderRadius:10,marginBottom:14}}/>
    {[1,2,3].map(i=><div key={i} className="skeleton-block" style={{height:170,borderRadius:14,marginBottom:10}}/>)}
  </div>;
}
