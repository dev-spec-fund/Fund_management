import React from "react";
import { Download } from "lucide-react";
import { smallBtn } from "../../components/Shared";
import { fmt } from "../../utils/format";

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
      <span className="sans" style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

export function MonthlyReportSections({ summary, trend, monthLabel, setTab }) {
  const maxVal = Math.max(1, ...trend.map((t) => Math.max(Number(t.income || 0), Number(t.expense || 0))));
  const members = summary.outstanding?.members || [];
  const allocatedContributions = Number(summary.allocatedContributions ?? summary.memberIncome ?? 0);
  const advanceAllocated = Number(summary.advanceAllocated || 0);
  const currentMonthAllocated = Math.max(0, allocatedContributions - advanceAllocated);
  const totalRequired = allocatedContributions + Number(summary.outstanding?.total || 0);
  const collectionPct = totalRequired > 0 ? Math.min(100, Math.round((allocatedContributions / totalRequired) * 100)) : 0;
  const activeCategories = (summary.byCategory || []).filter((c) => Number(c.spent || 0) > 0);
  const expenseDetails = summary.expenseDetails || [];
  const projectExpenseGroups = (summary.byProject || []).map((project) => ({
    ...project,
    expenses: expenseDetails.filter((e) => String(e.project_id || "") === String(project.project_id || "") || (!e.project_id && e.project_code && e.project_code === project.project_code)),
    donations: (summary.projectDonations || []).filter((d) => String(d.project_id || "") === String(project.project_id || "")),
  }));
  const generalExpenses = expenseDetails.filter((e) => !e.project_id && !e.project_code);

  return <>
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>MONTHLY SUMMARY</div>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <Row label="Opening balance" value={`MVR ${fmt(summary.openingBalance ?? 0)}`} />
      <Row label="Contribution cash received" value={`+ MVR ${fmt(summary.memberIncome)}`} color="var(--success)" />
      <Row label="Donations" value={`+ MVR ${fmt(summary.donationIncome)}`} color="var(--success)" />
      <Row label="Expenses" value={`− MVR ${fmt(summary.expenses)}`} color="var(--danger)" />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
        <span className="sans" style={{ fontWeight: 700 }}>Net cash change</span>
        <span style={{ fontWeight: 700, color: Number(summary.net) >= 0 ? "var(--success)" : "var(--danger)" }}>{Number(summary.net) >= 0 ? "+" : "−"} MVR {fmt(Math.abs(Number(summary.net || 0)))}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 9 }}>
        <span className="sans" style={{ color: "var(--muted)" }}>Closing balance</span>
        <span style={{ fontWeight: 700 }}>MVR {fmt(summary.fundBalance)}</span>
      </div>
    </div>

    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>CONTRIBUTION COLLECTION</div>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}>
        <span><b>MVR {fmt(allocatedContributions)}</b> / MVR {fmt(totalRequired)}</span>
        <strong>{collectionPct}%</strong>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${collectionPct}%`, height: "100%", background: "var(--success)", borderRadius: 99 }} />
      </div>
      <div className="sans" style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid var(--divider)", fontSize: 11 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: advanceAllocated > 0 ? 6 : 0 }}>
          <span style={{ color: "var(--muted)" }}>Allocated to {monthLabel}</span>
          <b>MVR {fmt(allocatedContributions)}</b>
        </div>
        {advanceAllocated > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "var(--success)" }}>
          <span>↳ Paid in advance</span><b>MVR {fmt(advanceAllocated)}</b>
        </div>}
        {currentMonthAllocated > 0 && advanceAllocated > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "var(--soft)", marginTop: 5 }}>
          <span>↳ From cash received this month</span><span>MVR {fmt(currentMonthAllocated)}</span>
        </div>}
      </div>
    </div>
    <div className="sans" style={{ fontSize: 10, color: "var(--soft)", lineHeight: 1.45, margin: "-4px 2px 12px" }}>
      Advance allocations count toward collection only. The cash was already added to the fund when it was originally received, so it is not counted again here.
    </div>

    {(summary.outstanding?.total || 0) > 0 && (
      <button type="button" onClick={() => setTab?.("members")} style={{ width: "100%", background: "var(--danger-bg-3)", border: "1px solid var(--danger-border)", borderRadius: 12, padding: "13px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: "var(--danger)" }}>
        <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>Outstanding dues</span>
        <span className="sans" style={{ fontSize: 12, fontWeight: 700 }}>MVR {fmt(summary.outstanding?.total)} · {members.length} members ›</span>
      </button>
    )}

    <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>
      <span>CASH INCOME VS EXPENSES — 6 MONTHS</span>
      <span style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 500 }}><span>● Income</span><span style={{ color: "var(--danger)" }}>● Expenses</span></span>
    </div>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 12px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 112 }}>
        {trend.map((d, i) => {
          const label = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${d.month}-01T00:00:00Z`));
          return <div key={i} title={`Income MVR ${fmt(d.income)} · Expenses MVR ${fmt(d.expense)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", height: 84 }}>
              <div style={{ flex: 1, minHeight: Number(d.income) > 0 ? 2 : 0, height: `${(Number(d.income || 0) / maxVal) * 100}%`, background: "var(--success)", borderRadius: "3px 3px 0 0" }} />
              <div style={{ flex: 1, minHeight: Number(d.expense) > 0 ? 2 : 0, height: `${(Number(d.expense || 0) / maxVal) * 100}%`, background: "var(--danger)", borderRadius: "3px 3px 0 0" }} />
            </div>
            <div className="sans" style={{ fontSize: 10, color: "var(--soft)" }}>{label}</div>
          </div>;
        })}
      </div>
    </div>

    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>EXPENSES BY CATEGORY</div>
    {activeCategories.map((c, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", marginBottom: 7 }}>
      <span className="sans" style={{ fontSize: 13, fontWeight: 500 }}>{c.category}</span>
      <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>MVR {fmt(c.spent)}</span>
    </div>)}
    {activeCategories.length === 0 && <div className="sans" style={{ fontSize: 12, color: "var(--soft)", marginBottom: 8 }}>No expenses for this month.</div>}

    {projectExpenseGroups.length > 0 && <>
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", margin: "20px 0 7px", fontWeight: 700 }}>PROJECT ACTIVITY</div>
      {projectExpenseGroups.map((p) => <div key={p.project_id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 9 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}><div className="sans" style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{p.project_name}</div><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{p.project_code}{p.budget == null ? " · Open-cost project" : ` · Budget MVR ${fmt(p.budget)}`}</div></div><div className="sans" style={{ textAlign: "right", whiteSpace: "nowrap" }}><div style={{ fontSize: 9, color: "var(--soft)", textTransform: "uppercase" }}>Donations / Spent</div><strong style={{ fontSize: 11, color: "var(--success)" }}>+ MVR {fmt(p.donations_received || 0)}</strong><div style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>- MVR {fmt(p.spent)}</div></div></div>
        {p.donations.length > 0 && <><div className="sans" style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", marginTop: 10, marginBottom: 2 }}>DONATIONS RECEIVED</div>{p.donations.map((d) => <div key={`d-${d.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--divider)", padding: "7px 0" }}><div className="sans" style={{ fontSize: 10, minWidth: 0 }}><b>{d.donor_name}</b><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{String(d.created_at || "").slice(0, 10)} · {d.txn_id}{d.note ? ` · ${d.note}` : ""}</div></div><b className="sans" style={{ fontSize: 10, whiteSpace: "nowrap", color: "var(--success)" }}>+ MVR {fmt(d.amount)}</b></div>)}</>}
        <div className="sans" style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", marginTop: 10, marginBottom: 2 }}>EXPENSES</div>
        {p.expenses.length ? p.expenses.map((e) => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--divider)", padding: "7px 0" }}><div className="sans" style={{ fontSize: 10, minWidth: 0 }}><b>{e.description}</b><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{String(e.expense_date || e.created_at || "").slice(0, 10)} · {e.txn_id} · {e.category || "Uncategorised"}</div></div><b className="sans" style={{ fontSize: 10, whiteSpace: "nowrap", color: "var(--danger)" }}>MVR {fmt(e.amount)}</b></div>) : <div className="sans" style={{ fontSize: 10, color: "var(--soft)", paddingTop: 5 }}>No expenses in this month.</div>}
      </div>)}
    </>}

    {generalExpenses.length > 0 && <>
      <div className="sans" style={{ fontSize: 12, color: "var(--muted)", margin: "20px 0 7px", fontWeight: 700 }}>GENERAL EXPENSES</div>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "4px 14px", marginBottom: 10 }}>
        {generalExpenses.map((e) => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--divider)", padding: "8px 0" }}><div className="sans" style={{ fontSize: 10, minWidth: 0 }}><b>{e.description}</b><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{String(e.expense_date || e.created_at || "").slice(0, 10)} · {e.txn_id} · {e.category || "Uncategorised"}</div></div><b className="sans" style={{ fontSize: 10, whiteSpace: "nowrap", color: "var(--danger)" }}>MVR {fmt(e.amount)}</b></div>)}
      </div>
    </>}
  </>;
}

export function AnnualAnalyticsSection({ annualYear, setAnnualYear, annual, analytics, annualBusy, loadAnnual, setError }) {
  return <>
    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", margin: "20px 0 7px", fontWeight: 700 }}>ANNUAL / AGM & ANALYTICS</div>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div className="annual-report-controls">
        <input className="sans" type="number" min="2000" max="2100" value={annualYear} onChange={(e) => setAnnualYear(e.target.value.slice(0, 4))} style={{ width: 90, border: "1px solid var(--border-strong)", borderRadius: 9, padding: "8px 10px", background: "var(--bg)" }} />
        <button type="button" disabled={annualBusy || annualYear.length !== 4} onClick={async () => { try { await loadAnnual(); } catch (e) { setError?.(e.message || "Could not load annual analytics"); } }} style={{ ...smallBtn("var(--primary-text)"), flex: 1 }}>{annualBusy ? "Loading…" : "Load annual report"}</button>
        {annual && <button type="button" onClick={async () => { const { exportAnnualAgmPdf } = await import("../../utils/exports"); await exportAnnualAgmPdf(annual); }} style={{ ...smallBtn("var(--primary-text)"), flex: "0 0 auto" }}><Download size={13} /> AGM PDF</button>}
      </div>
      {annual && <>
        <div className="annual-report-totals">
          {[["Contributions", annual.totals?.contributions, "var(--success)"], ["Donations", annual.totals?.donations, "var(--success)"], ["Expenses", annual.totals?.expenses, "var(--danger)"], ["Closing balance", annual.totals?.closing_balance, "var(--text)"]].map(([l, v, c]) => <div key={l} style={{ background: "var(--bg)", borderRadius: 9, padding: 10 }}><div style={{ fontSize: 9, color: "var(--soft)", textTransform: "uppercase" }}>{l}</div><b style={{ fontSize: 13, color: c }}>MVR {fmt(v)}</b></div>)}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--divider)", display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>Annual collection rate</span><b style={{ color: "var(--success)" }}>{Number(annual.totals?.due || 0) > 0 ? `${Number(annual.totals?.collection_rate || 0).toFixed(1)}%` : "N/A"}</b></div>
      </>}
      {analytics && <>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginTop: 16, marginBottom: 7 }}>12-MONTH COLLECTION PERFORMANCE</div>
        <div className="annual-collection-chart">{(annual?.months || []).map((m) => { const hasDue = Number(m.total_due || 0) > 0; const rate = hasDue ? Math.max(0, Math.min(100, Number(m.collection_rate || 0))) : 0; return <div key={m.month} title={`${m.month} · ${hasDue ? `${rate.toFixed(0)}%` : "N/A"}`} style={{ flex: 1, height: hasDue ? `${Math.max(3, rate)}%` : "0%", background: "var(--success)", borderRadius: "3px 3px 0 0", opacity: .85 }} />; })}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--soft)", marginTop: 4 }}><span>Jan</span><span>Dec</span></div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginTop: 14, marginBottom: 6 }}>TOP MEMBER COLLECTION</div>
        {(analytics.member_performance || []).slice(0, 5).map((m) => <div key={m.id} className="annual-top-member"><span><b>{m.member_code}</b><small>{m.name}</small></span><strong>{Number(m.annual_target || 0) > 0 ? `${Number(m.rate || 0).toFixed(0)}%` : "N/A"}<small>MVR {fmt(m.collected)}</small></strong></div>)}
        <div style={{ fontSize: 10, color: "var(--soft)", marginTop: 10 }}>Reversals this year: {analytics.reversals?.count || 0} · Meetings: {analytics.meetings || 0}</div>
      </>}
    </div>
  </>;
}
