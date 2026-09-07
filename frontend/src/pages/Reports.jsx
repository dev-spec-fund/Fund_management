import React, { useEffect, useState } from "react";
import { Plus, Download, ChevronLeft, ChevronRight, FileText, Table2, Paperclip, HeartHandshake, CircleDollarSign, ArrowRight, ReceiptText } from "lucide-react";
import { LoadingState, MessageBanner, monthNavBtn } from "../components/Shared";
import { useReportsData } from "./reports/useReportsData";
import { MonthlyReportSections, AnnualAnalyticsSection } from "./reports/ReportSections";
import { ExpenseModal, DonationModal } from "./reports/ReportModals";
import DonationDetails from "./reports/DonationDetails";
import { api, onDataChange } from "../api";
import { fmt } from "../utils/format";

export default function Reports({ setTab, admin, month: sharedMonth, onMonthChange, view = "reports" }) {
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
  } = useReportsData(sharedMonth, onMonthChange);

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

  const donationTotal = donations.filter((d)=>d.status === "active").reduce((sum,d)=>sum+Number(d.amount||0),0);

  return <>
    <div className="reports-filter-sticky page-sticky-controls">
      <div className="finance-page-head sans finance-page-head-compact">
        <div>
          <div className="finance-page-kicker">FINANCE</div>
          <div className="finance-page-title">{view === "donations" ? "Donations" : "Reports"}</div>
          <div className="finance-page-subtitle">{view === "donations" ? "Record and review incoming donations to the general fund and projects." : "Understand monthly cash flow, collection performance and annual trends."}</div>
        </div>
        <div className="report-header-actions">
          {view === "reports" && <div className="report-action-menu-wrap">
            <button type="button" onClick={() => { setShowExport(!showExport); setShowAdd(false); }} className="report-header-action sans"><Download size={13} /> Export</button>
            {showExport && <div className="report-action-menu">
              <button type="button" onClick={async () => { setShowExport(false); try { const { exportFundPdf } = await import("../utils/exports"); await exportFundPdf({ month, monthLabel, summary }); } catch (e) { setError(e.message || "Could not export PDF"); } }} className="sans"><FileText size={14} /><span><b>PDF report</b><small>Formatted monthly report</small></span></button>
              <button type="button" onClick={async () => { setShowExport(false); try { await exportCsv(); } catch (e) { setError(e.message || "Could not export CSV"); } }} className="sans"><Table2 size={14} /><span><b>CSV data</b><small>Spreadsheet-friendly export</small></span></button>
            </div>}
          </div>}
          <div className="report-action-menu-wrap">
            {view === "donations" ? (
              <button type="button" onClick={() => setShowDonation(true)} className="report-header-action sans"><Plus size={13} /> Add donation</button>
            ) : (
              <>
                <button type="button" onClick={() => { setShowAdd(!showAdd); setShowExport(false); }} className="report-header-action sans"><Plus size={13} /> Log</button>
                {showAdd && <div className="report-action-menu compact">
                  <button type="button" onClick={() => { setShowDonation(true); setShowAdd(false); }} className="sans"><Plus size={14}/><span><b>Donation</b><small>Record incoming funds</small></span></button>
                  <button type="button" onClick={() => { setShowExpense(true); setShowAdd(false); }} className="sans danger"><Plus size={14}/><span><b>Expense</b><small>Record fund spending</small></span></button>
                </div>}
              </>
            )}
          </div>
        </div>
      </div>
      {view === "donations" ? (
        <div className="finance-kpi-grid finance-kpi-grid-3 sans">
          <div className="finance-kpi-card tone-teal"><span><HeartHandshake size={16}/></span><div><small>Received</small><strong>MVR {fmt(donationTotal)}</strong></div></div>
          <div className="finance-kpi-card tone-blue"><span><ReceiptText size={16}/></span><div><small>Entries</small><strong>{donations.length}</strong></div></div>
          <div className="finance-kpi-card tone-green"><span><CircleDollarSign size={16}/></span><div><small>Month</small><strong>{monthLabel.split(" ")[0]}</strong></div></div>
        </div>
      ) : (
        <div className="finance-kpi-grid finance-kpi-grid-3 sans">
          <div className="finance-kpi-card tone-green"><span><CircleDollarSign size={16}/></span><div><small>Income</small><strong>MVR {fmt(Number(summary.memberIncome||0)+Number(summary.donationIncome||0))}</strong></div></div>
          <div className="finance-kpi-card tone-red"><span><ReceiptText size={16}/></span><div><small>Expenses</small><strong>MVR {fmt(summary.expenses)}</strong></div></div>
          <div className={`finance-kpi-card ${Number(summary.net||0)>=0?"tone-blue":"tone-amber"}`}><span><FileText size={16}/></span><div><small>Net change</small><strong>{Number(summary.net||0)>=0?"+":"−"} MVR {fmt(Math.abs(Number(summary.net||0)))}</strong></div></div>
        </div>
      )}
      <div className="reports-month-selector">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={monthNavBtn()}><ChevronLeft size={18} /></button>
        <div className="sans" style={{ textAlign: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", fontSize: 14, fontWeight: 600 }}>{monthLabel}</div>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={monthNavBtn()}><ChevronRight size={18} /></button>
      </div>
    </div>

    <MessageBanner tone="error">{error}</MessageBanner>
    {view === "reports" && <MonthlyReportSections summary={summary} trend={trend} monthLabel={monthLabel} setTab={setTab} />}

    <div className="finance-section-title sans">{view === "donations" ? `DONATIONS · ${monthLabel.toUpperCase()}` : `DONATIONS · ${monthLabel.toUpperCase()}`}</div>
    <div className="finance-transaction-list">
      {donations.length === 0 ? <div className="sans" style={{ fontSize: 11, color: "var(--soft)", padding: "12px 2px" }}>No donations logged for this month.</div> : donations.map((donation) => <button key={donation.id} type="button" onClick={() => setSelectedDonation(donation)} className="sans finance-transaction-row">
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{donation.donor_name}</div><div style={{ fontSize: 9, color: "var(--soft)", marginTop: 2 }}>{donation.donation_date || String(donation.created_at || "").slice(0,10)} · {donation.txn_id}{donation.project_name ? ` · ${donation.project_code || ""} ${donation.project_name}` : " · General fund"}{Number(donation.document_count || 0) > 0 ? ` · ${donation.document_count} document${Number(donation.document_count) === 1 ? "" : "s"}` : ""}</div></div>
        {Number(donation.document_count || 0) > 0 && <Paperclip size={12} style={{ color: "var(--muted)", flex: "0 0 auto" }} />}
        <div className="finance-transaction-side"><b className={donation.status === "active" ? "positive" : "muted"}>{donation.status === "active" ? "+ " : ""}MVR {fmt(donation.amount)}</b><div>{donation.status} · {donation.status === "active" ? "Edit" : "View"} <ArrowRight size={11}/></div></div>
      </button>)}
    </div>

    {view === "reports" && <AnnualAnalyticsSection annualYear={annualYear} setAnnualYear={setAnnualYear} annual={annual} analytics={analytics} annualBusy={annualBusy} loadAnnual={loadAnnual} setError={setError} />}

    {showExpense && <ExpenseModal onClose={() => setShowExpense(false)} onSaved={loadMonthly} />}
    {showDonation && <DonationModal onClose={() => setShowDonation(false)} onSaved={async (message) => { await donationSaved(message); setShowDonation(false); }} />}
    {selectedDonation && <DonationDetails admin={admin} row={selectedDonation} onClose={() => setSelectedDonation(null)} onSaved={donationSaved} />}
  </>;
}
