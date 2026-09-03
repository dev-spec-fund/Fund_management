import React, { useEffect, useState } from "react";
import { Plus, Download, ChevronLeft, ChevronRight, FileText, Table2, Paperclip } from "lucide-react";
import { LoadingState, MessageBanner, monthNavBtn } from "../components/Shared";
import { useReportsData } from "./reports/useReportsData";
import { MonthlyReportSections, AnnualAnalyticsSection } from "./reports/ReportSections";
import { ExpenseModal, DonationModal } from "./reports/ReportModals";
import DonationDetails from "./reports/DonationDetails";
import { api, onDataChange } from "../api";
import { fmt } from "../utils/format";

export default function Reports({ setTab, admin }) {
  const [showExpense, setShowExpense] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [error, setError] = useState("");
  const [donations, setDonations] = useState([]);
  const [selectedDonation, setSelectedDonation] = useState(null);
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

  const loadDonations = () => api.donations.list({ month }).then(setDonations).catch((e) => setError(e.message || "Could not load donations"));
  useEffect(() => { loadDonations(); }, [month]);
  useEffect(() => onDataChange(({ path }) => { if (path?.startsWith("/api/donations")) loadDonations(); }), [month]);

  const donationSaved = async (message = "Donation updated") => {
    await Promise.all([loadMonthly(), loadDonations()]);
    setSelectedDonation(null);
    return message;
  };

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
        <div className="report-header-actions">
          <div className="report-action-menu-wrap">
            <button type="button" onClick={() => { setShowExport(!showExport); setShowAdd(false); }} className="report-header-action sans"><Download size={13} /> Export</button>
            {showExport && <div className="report-action-menu">
              <button type="button" onClick={async () => { setShowExport(false); try { const { exportFundPdf } = await import("../utils/exports"); await exportFundPdf({ month, monthLabel, summary }); } catch (e) { setError(e.message || "Could not export PDF"); } }} className="sans"><FileText size={14} /><span><b>PDF report</b><small>Formatted monthly report</small></span></button>
              <button type="button" onClick={async () => { setShowExport(false); try { await exportCsv(); } catch (e) { setError(e.message || "Could not export CSV"); } }} className="sans"><Table2 size={14} /><span><b>CSV data</b><small>Spreadsheet-friendly export</small></span></button>
            </div>}
          </div>
          <div className="report-action-menu-wrap">
            <button type="button" onClick={() => { setShowAdd(!showAdd); setShowExport(false); }} className="report-header-action sans"><Plus size={13} /> Log</button>
            {showAdd && <div className="report-action-menu compact">
              <button type="button" onClick={() => { setShowDonation(true); setShowAdd(false); }} className="sans"><Plus size={14}/><span><b>Donation</b><small>Record incoming funds</small></span></button>
              <button type="button" onClick={() => { setShowExpense(true); setShowAdd(false); }} className="sans danger"><Plus size={14}/><span><b>Expense</b><small>Record fund spending</small></span></button>
            </div>}
          </div>
        </div>
      </div>
      <div className="reports-month-selector">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel}</div>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>
    </div>

    <MessageBanner tone="error">{error}</MessageBanner>
    <MonthlyReportSections summary={summary} trend={trend} monthLabel={monthLabel} setTab={setTab} />

    <div className="sans" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 7, fontWeight: 700 }}>DONATIONS — {monthLabel.toUpperCase()}</div>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "4px 12px", marginBottom: 16 }}>
      {donations.length === 0 ? <div className="sans" style={{ fontSize: 11, color: "var(--soft)", padding: "12px 2px" }}>No donations logged for this month.</div> : donations.map((donation) => <button key={donation.id} type="button" onClick={() => setSelectedDonation(donation)} className="sans" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left", border: 0, borderTop: "1px solid var(--divider)", background: "transparent", color: "var(--text)", padding: "10px 2px", cursor: "pointer" }}>
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{donation.donor_name}</div><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{donation.donation_date || String(donation.created_at || "").slice(0,10)} · {donation.txn_id}{donation.project_name ? ` · ${donation.project_code || ""} ${donation.project_name}` : " · General fund"}{Number(donation.document_count || 0) > 0 ? ` · ${donation.document_count} document${Number(donation.document_count) === 1 ? "" : "s"}` : ""}</div></div>
        {Number(donation.document_count || 0) > 0 && <Paperclip size={12} style={{ color: "var(--muted)", flex: "0 0 auto" }} />}
        <div style={{ textAlign: "right", flex: "0 0 auto" }}><b style={{ fontSize: 11, color: donation.status === "active" ? "var(--success)" : "var(--muted)" }}>{donation.status === "active" ? "+ " : ""}MVR {fmt(donation.amount)}</b><div style={{ fontSize: 8, color: "var(--soft)", marginTop: 2, textTransform: "uppercase" }}>{donation.status} · {donation.status === "active" ? "Edit" : "View"} ›</div></div>
      </button>)}
    </div>

    <AnnualAnalyticsSection annualYear={annualYear} setAnnualYear={setAnnualYear} annual={annual} analytics={analytics} annualBusy={annualBusy} loadAnnual={loadAnnual} setError={setError} />

    {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onSaved={loadMonthly} />}
    {showDonation && <DonationModal onClose={() => setShowDonation(false)} onSaved={async (message) => { await donationSaved(message); setShowDonation(false); }} />}
    {selectedDonation && <DonationDetails admin={admin} row={selectedDonation} onClose={() => setSelectedDonation(null)} onSaved={donationSaved} />}
  </>;
}
