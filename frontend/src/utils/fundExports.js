import { jsPDF } from "jspdf";
import { api } from "../api";
import { C, createReport, fileSlug, infoPanel, money, sectionTitle, statusColor, summaryCards, table, addFooters, reportMeta, progressBar, certificationPanel } from "./exportCore";
import { sendExportToTelegram } from "./exportDelivery";

export async function exportFundPdf({ month, monthLabel, summary }) {
  const brand = await api.branding();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const ctx = createReport(doc, brand, "Monthly Fund Report", monthLabel);
  const expected = Number(summary.collection?.expected || 0);
  const collected = Number(summary.collection?.collected || 0);
  const rate = expected > 0 ? Math.min(100, collected / expected * 100) : 100;
  const closed = Boolean(summary?.closed || summary?.isClosed || summary?.snapshot);

  reportMeta(ctx, [
    { label: "Reporting period", value: monthLabel || month },
    { label: "Month status", value: closed ? "Closed" : "Current / open", color: closed ? C.green2 : C.amber },
    { label: "Currency", value: "Maldivian Rufiyaa (MVR)" },
  ]);

  summaryCards(ctx, [
    { label: "Opening balance", value: money(summary.openingBalance), highlight: true },
    { label: "Closing balance", value: money(summary.closingBalance ?? summary.fundBalance), highlight: true, color: C.green },
    { label: "Net cash change", value: `${Number(summary.net || 0) >= 0 ? "+" : "-"} ${money(Math.abs(Number(summary.net || 0)))}`, color: Number(summary.net || 0) >= 0 ? C.green2 : C.red },
    { label: "Collection rate", value: `${rate.toFixed(1)}%`, color: rate >= 80 ? C.green2 : rate >= 50 ? C.amber : C.red },
  ]);
  progressBar(ctx, { label: "Contribution collection", value: rate, rightLabel: expected > 0 ? `${money(collected)} of ${money(expected)}` : "No contribution target" });

  sectionTitle(ctx, "Cash movement");
  infoPanel(ctx, [
    ["Contribution cash received", money(summary.memberIncome)],
    ["Donations received", money(summary.donationIncome)],
    ["Expenses", `- ${money(summary.expenses)}`],
    ["Net cash change", `${Number(summary.net || 0) >= 0 ? "+" : "-"} ${money(Math.abs(Number(summary.net || 0)))}`],
  ]);

  sectionTitle(ctx, "Contribution collection");
  infoPanel(ctx, [
    ["Expected", money(expected)],
    ["Collected", money(collected)],
    ["Allocated to month", money(summary.allocatedContributions ?? summary.memberIncome)],
    ["Paid in advance", money(summary.advanceAllocated)],
    ["Outstanding dues", money(summary.outstanding?.total)],
    ["Outstanding members", String(summary.outstanding?.members?.length || summary.collection?.outstanding_members || 0)],
  ]);

  const categories = (summary.byCategory || []).filter(x => Number(x.spent || 0) > 0);
  if (categories.length) {
    sectionTitle(ctx, "Expense categories", "", 16);
    table(ctx,
      [
        { key: "category", label: "Category", width: 115, bold: true, format: v => v || "Uncategorised" },
        { key: "spent", label: "Amount", width: 67, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      categories
    );
  }

  const monthlyExpenseRows = summary.expenseDetails || [];
  const monthlyProjectGroups = (summary.byProject || []).map(project => ({
    ...project,
    rows: monthlyExpenseRows.filter(row => String(row.project_id || "") === String(project.project_id || "") || (!row.project_id && row.project_code && row.project_code === project.project_code)),
    donations: (summary.projectDonations || []).filter(row => String(row.project_id || "") === String(project.project_id || "")),
  }));
  if (monthlyProjectGroups.length) {
    sectionTitle(ctx, "Project activity", "Each project shows donations received for it and its approved expenses for the selected month.");
    monthlyProjectGroups.forEach(project => {
      sectionTitle(ctx, `${project.project_code} · ${project.project_name}`, `${project.budget == null ? "Open-cost project" : `Budget ${money(project.budget)}`} · Donations ${money(project.donations_received||0)} · Spent ${money(project.spent)}`, 15);
      if (project.donations.length) {
        sectionTitle(ctx, "Donations received", "Donations linked to this project in the selected month.", 14);
        table(ctx,
          [
            { key: "created_at", label: "Date", width: 27, format: v => String(v || "").slice(0,10) },
            { key: "txn_id", label: "Donation ID", width: 30, bold: true },
            { key: "donor_name", label: "Donor", width: 75 },
            { key: "amount", label: "Amount", width: 35, align: "right", bold: true, color: C.green, format: v => money(v) },
          ], project.donations, { fontSize: 7.0 }
        );
      }
      if (project.rows.length) table(ctx,
        [
          { key: "expense_date", label: "Date", width: 25, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
          { key: "txn_id", label: "Expense ID", width: 27, bold: true },
          { key: "description", label: "Description", width: 70 },
          { key: "category", label: "Category", width: 30, format: v => v || "Uncategorised" },
          { key: "amount", label: "Amount", width: 30, align: "right", bold: true, color: C.red, format: v => money(v) },
        ], project.rows, { fontSize: 7.0 }
      );
    });
  }

  const monthlyGeneralExpenses = monthlyExpenseRows.filter(row => !row.project_id && !row.project_code);
  if (monthlyGeneralExpenses.length) {
    sectionTitle(ctx, "General expenses", "Approved expenses that are not linked to a community project.", 16);
    table(ctx,
      [
        { key: "expense_date", label: "Date", width: 25, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
        { key: "txn_id", label: "Expense ID", width: 27, bold: true },
        { key: "description", label: "Description", width: 70 },
        { key: "category", label: "Category", width: 30, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 30, align: "right", bold: true, color: C.red, format: v => money(v) },
      ], monthlyGeneralExpenses, { fontSize: 7.0 }
    );
  }
  if (monthlyExpenseRows.length) {
    const expenseTotal = monthlyExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    infoPanel(ctx, [["Detailed expense total", money(expenseTotal)]]);
  }

  if ((summary.expenseAdjustments || []).length) {
    sectionTitle(ctx, "Expense adjustments", "Reversed or voided expenses are shown for audit transparency and are excluded from the active expense total.");
    table(ctx,
      [
        { key: "expense_date", label: "Date", width: 25, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
        { key: "txn_id", label: "Expense ID", width: 25, bold: true },
        { key: "description", label: "Description", width: 44 },
        { key: "category", label: "Category", width: 31, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 29, align: "right", bold: true, format: v => money(v) },
        { key: "status", label: "Status", width: 28, bold: true, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
      ],
      summary.expenseAdjustments,
      { fontSize: 6.8 }
    );
  }

  if ((summary.outstanding?.members || []).length) {
    sectionTitle(ctx, "Outstanding members", "Members with an unpaid or partially paid obligation for the selected month.");
    table(ctx,
      [
        { key: "member_code", label: "Member ID", width: 32, bold: true },
        { key: "name", label: "Member", width: 60 },
        { key: "payment_status", label: "Status", width: 30, bold: true, color: r => statusColor(r.payment_status), format: v => String(v || "").toUpperCase() },
        { key: "paid", label: "Paid", width: 30, align: "right", format: v => money(v) },
        { key: "monthly_amount", label: "Due", width: 30, align: "right", format: (v, r) => money(Math.max(0, Number(v || 0) - Number(r.paid || 0))) },
      ],
      summary.outstanding.members
    );
  }

  sectionTitle(ctx, "Report note", "", 24);
  certificationPanel(ctx, [
    `Reporting period: ${monthLabel || month}.`,
    "This report was generated electronically from Fund Manager financial records.",
    "Voided and reversed transactions are excluded from active totals and retained separately for audit history.",
  ]);

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-fund-report-${month}.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${monthLabel} · Fund report PDF`);
}

