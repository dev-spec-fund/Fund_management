import React, { useState } from "react";
import { Plus, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { LoadingState, smallBtn, monthNavBtn } from "../components/Shared";
import { fmt } from "../utils/format";
import { useReportsData } from "./reports/useReportsData";
import { MonthlyReportSections, AnnualAnalyticsSection } from "./reports/ReportSections";
import { ExpenseModal, DonationModal } from "./reports/ReportModals";

export default function Reports({ setTab }) {
  const [showExpense, setShowExpense] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const {
    month,
    monthLabel,
    summary,
    trend,
    annualYear,
    setAnnualYear,
    annual,
    analytics,
    annualBusy,
    shiftMonth,
    loadMonthly,
    loadAnnual,
  } = useReportsData();

  if (!summary) return <LoadingState>Loading reports…</LoadingState>;

  const allocatedContributions = Number(summary.allocatedContributions ?? summary.memberIncome ?? 0);
  const advanceAllocated = Number(summary.advanceAllocated || 0);
  const activeCategories = (summary.byCategory || []).filter((c) => Number(c.spent || 0) > 0);
  const expenseDetails = summary.expenseDetails || [];
  const projectExpenseGroups = (summary.byProject || []).map((project) => ({
    ...project,
    expenses: expenseDetails.filter((e) => String(e.project_id || "") === String(project.project_id || "") || (!e.project_id && e.project_code && e.project_code === project.project_code)),
    donations: (summary.projectDonations || []).filter((d) => String(d.project_id || "") === String(project.project_id || "")),
  }));

  const exportCsv = async () => {
    const members = summary.outstanding?.members || [];
    const rows = [
      ["Fund report", monthLabel],
      ["Opening balance", summary.openingBalance ?? 0],
      ["Contribution cash received", summary.memberIncome],
      ["Allocated to contribution month", allocatedContributions],
      ["Paid in advance", advanceAllocated],
      ["Donations", summary.donationIncome],
      ["Expenses", summary.expenses],
      ["Net change", summary.net],
      ["Closing balance", summary.fundBalance],
      ["Outstanding dues", summary.outstanding?.total || 0],
      ["Outstanding members", members.length],
      [],
      ["Expense category", "Amount"],
      ...activeCategories.map((c) => [c.category, c.spent]),
      [],
      ["Project", "Project donations", "Project expenses"],
      ...projectExpenseGroups.map((p) => [`${p.project_code} · ${p.project_name}`, p.donations_received || 0, p.spent || 0]),
    ];
    const csv = rows.map((r) => r.map((v) => {
      const safe = String(v ?? "").replace(/"/g, '""');
      return `"${/^[=+\-@]/.test(safe) ? "'" + safe : safe}"`;
    }).join(",")).join("\n");
    const filename = `fund-report-${month}.csv`;
    const { sendExportToTelegram } = await import("../utils/exports");
    await sendExportToTelegram(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename, `${monthLabel} · Fund report CSV`);
  };

  return <>
    <div className="reports-filter-sticky page-sticky-controls">
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-text)", letterSpacing: .4 }}>REPORTS</div>
        <div style={{ display: "flex", gap: 6, position: "relative" }}>
          <button type="button" onClick={async () => { try { const { exportFundPdf } = await import("../utils/exports"); await exportFundPdf({ month, monthLabel, summary }); } catch (e) { alert(e.message); } }} style={{ ...smallBtn("var(--primary-text)"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> PDF</button>
          <button type="button" onClick={exportCsv} style={{ ...smallBtn("var(--primary-text)"), flex: "0 0 auto", padding: "7px 10px" }}><Download size={13} /> CSV</button>
          <button type="button" onClick={() => setShowAdd(!showAdd)} style={{ ...smallBtn("var(--primary-text)"), flex: "0 0 auto", padding: "7px 10px" }}><Plus size={13} /> Log</button>
          {showAdd && <div style={{ position: "absolute", right: 0, top: 38, zIndex: 8, width: 160, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 5, boxShadow: "0 8px 24px var(--shadow)" }}>
            <button type="button" onClick={() => { setShowDonation(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "var(--success)", cursor: "pointer" }}>+ Log donation</button>
            <button type="button" onClick={() => { setShowExpense(true); setShowAdd(false); }} className="sans" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "9px 10px", color: "var(--danger)", cursor: "pointer" }}>+ Log expense</button>
          </div>}
        </div>
      </div>
      <div className="reports-month-selector">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel}</div>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>
    </div>

    <MonthlyReportSections summary={summary} trend={trend} monthLabel={monthLabel} setTab={setTab} />
    <AnnualAnalyticsSection annualYear={annualYear} setAnnualYear={setAnnualYear} annual={annual} analytics={analytics} annualBusy={annualBusy} loadAnnual={loadAnnual} />

    {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onSaved={loadMonthly} />}
    {showDonation && <DonationModal onClose={() => setShowDonation(false)} onSaved={loadMonthly} />}
  </>;
}
