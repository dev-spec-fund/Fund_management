import { jsPDF } from "jspdf";
import { brandingFrom, C, collectionChart, createReport, fileSlug, infoPanel, money, PDF_TYPE, sectionTitle, statusColor, summaryCards, table, addFooters, reportMeta, progressBar, certificationPanel } from "./exportCore";
import { sendExportToTelegram } from "./exportDelivery";

export async function exportAnnualAgmPdf(data) {
  const year = String(data?.year || new Date().getFullYear());
  const t = data?.totals || {};
  const brand = await brandingFrom(data);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const ctx = createReport(doc, brand, "Annual / AGM Fund Report", year);
  const annualRate = Number(t.due || 0) > 0 ? Number(t.collection_rate || 0) : 0;

  reportMeta(ctx, [
    { label: "Financial year", value: year },
    { label: "Report type", value: "Annual / AGM" },
    { label: "Currency", value: "Maldivian Rufiyaa (MVR)" },
  ]);

  summaryCards(ctx, [
    { label: "Opening balance", value: money(t.opening_balance), highlight: true },
    { label: "Closing balance", value: money(t.closing_balance), highlight: true, color: C.green },
    { label: "Contributions", value: money(t.contributions), color: C.green2 },
    { label: "Expenses", value: money(t.expenses), color: C.red },
  ]);
  if (Number(t.due || 0) > 0) progressBar(ctx, { label: "Annual contribution collection", value: annualRate, rightLabel: `${annualRate.toFixed(1)}% collected` });

  sectionTitle(ctx, "Executive summary");
  infoPanel(ctx, [
    ["Donations received", money(t.donations)],
    ["Net cash change", `${Number(t.net || 0) >= 0 ? "+" : "-"} ${money(Math.abs(Number(t.net || 0)))}`],
    ["Annual collection rate", Number(t.due || 0) > 0 ? `${Number(t.collection_rate || 0).toFixed(1)}%` : "N/A"],
    ["Meetings held", String(data?.meetings || 0)],
    ["Financial reversals", String(data?.reversals?.count || 0)],
  ]);

  collectionChart(ctx, data?.months || []);

  sectionTitle(ctx, "Monthly performance", "", 16);
  table(ctx,
    [
      { key: "month", label: "Month", width: 25, bold: true },
      { key: "total_due", label: "Due", width: 31, align: "right", format: v => money(v) },
      { key: "total_collected", label: "Collected", width: 36, align: "right", bold: true, format: v => money(v) },
      { key: "expenses", label: "Expenses", width: 31, align: "right", color: C.red, format: v => money(v) },
      { key: "closing_balance", label: "Closing", width: 34, align: "right", bold: true, format: v => money(v) },
      { key: "collection_rate", label: "Rate", width: 25, align: "right", color: C.green2, format: (v, row) => Number(row?.total_due || 0) > 0 ? `${Number(v || 0).toFixed(0)}%` : "N/A" },
    ],
    data?.months || [],
    { fontSize: PDF_TYPE.table }
  );

  if ((data?.member_contributions || []).length) {
    sectionTitle(ctx, "Member contribution summary", "Amounts applied to obligations are separated from advance/future contributions. Exempt months are excluded from the reporting-period target.", 16);
    table(ctx,
      [
        { key: "member_code", label: "Member ID", width: 22, bold: true },
        { key: "name", label: "Member", width: 42 },
        { key: "annual_target", label: "Due", width: 27, align: "right", format: v => money(v) },
        { key: "applied", label: "Applied", width: 27, align: "right", bold: true, color: C.green2, format: v => money(v) },
        { key: "advance", label: "Advance", width: 27, align: "right", bold: true, color: C.green2, format: v => money(v) },
        { key: "outstanding", label: "Outstanding", width: 28, align: "right", bold: true, color: r => Number(r.outstanding || 0) > 0 ? C.red : C.green2, format: v => money(v) },
        { key: "rate", label: "Rate", width: 16, align: "right", format: v => `${Number(v || 0).toFixed(0)}%` },
      ],
      data.member_contributions,
      { fontSize: PDF_TYPE.table }
    );
    const memberTotals=data.member_contributions.reduce((a,row)=>({due:a.due+Number(row.annual_target||0),applied:a.applied+Number((row.applied ?? row.collected) || 0),advance:a.advance+Number(row.advance||0),outstanding:a.outstanding+Number(row.outstanding||0)}),{due:0,applied:0,advance:0,outstanding:0});
    infoPanel(ctx, [
      ["Reporting-period member obligations", money(memberTotals.due)],
      ["Applied to member obligations", money(memberTotals.applied)],
      ["Advance / future contributions", money(memberTotals.advance)],
      ["Outstanding member obligations", money(memberTotals.outstanding)],
      ["Total contribution cash received", money(t.contributions)],
    ]);
  }

  if ((data?.donations || []).length) {
    sectionTitle(ctx, "Donation details", "Active donations included in the annual donation total.", 16);
    table(ctx,
      [
        { key: "transaction_month", label: "Month", width: 22, bold: true },
        { key: "created_at", label: "Date", width: 24, format: v => String(v || "").slice(0,10) },
        { key: "txn_id", label: "Donation ID", width: 26, bold: true },
        { key: "donor_name", label: "Donor", width: 42, format: (v,r) => r.member_code ? `${v || r.member_name || "-"} (${r.member_code})` : (v || "-") },
        { key: "note", label: "Note", width: 35, format: v => v || "-" },
        { key: "amount", label: "Amount", width: 33, align: "right", bold: true, color: C.green2, format: v => money(v) },
      ],
      data.donations,
      { fontSize: PDF_TYPE.table }
    );
    const donationTotal=data.donations.reduce((sum,row)=>sum+Number(row.amount||0),0);
    infoPanel(ctx, [["Detailed annual donation total", money(donationTotal)]]);
  }

  if ((data?.donation_adjustments || []).length) {
    sectionTitle(ctx, "Donation adjustments", "Reversed or voided donations remain visible for audit history and are excluded from active donation totals.", 16);
    table(ctx,
      [
        { key: "transaction_month", label: "Month", width: 22, bold: true },
        { key: "txn_id", label: "Donation ID", width: 28, bold: true },
        { key: "donor_name", label: "Donor", width: 45 },
        { key: "amount", label: "Amount", width: 30, align: "right", bold: true, format: v => money(v) },
        { key: "status", label: "Status", width: 25, bold: true, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
        { key: "void_reason", label: "Reason", width: 32, format: v => v || "Financial reversal" },
      ],
      data.donation_adjustments,
      { fontSize: PDF_TYPE.table }
    );
  }

  if ((data?.meeting_summary || []).length) {
    sectionTitle(ctx, "Meeting summary / RSVP", "RSVP responses are shown because the current system does not yet store confirmed post-meeting attendance.", 16);
    table(ctx,
      [
        { key: "meeting_date", label: "Date", width: 24, bold: true, format: v => String(v || "").slice(0,10) },
        { key: "title", label: "Meeting", width: 57 },
        { key: "rsvp_yes", label: "Going", width: 20, align: "right", bold: true, color: C.green2 },
        { key: "rsvp_maybe", label: "Maybe", width: 20, align: "right", color: C.amber },
        { key: "rsvp_no", label: "No", width: 18, align: "right", color: C.red },
        { key: "minutes_recorded", label: "Minutes", width: 21, align: "right", bold: true, format: v => Number(v) ? "YES" : "NO", color: r => Number(r.minutes_recorded) ? C.green2 : C.muted },
        { key: "action_total", label: "Actions", width: 22, align: "right", bold: true },
      ],
      data.meeting_summary,
      { fontSize: PDF_TYPE.table }
    );
  }

  if ((data?.meeting_actions || []).length) {
    sectionTitle(ctx, "Meeting action items", "Action items created from meetings during the reporting year.", 16);
    table(ctx,
      [
        { key: "meeting_date", label: "Date", width: 22, bold: true, format: v => String(v || "").slice(0,10) },
        { key: "meeting_title", label: "Meeting", width: 34 },
        { key: "description", label: "Action item", width: 54 },
        { key: "member_name", label: "Assigned to", width: 30, format: (v,r) => r.member_code ? `${v || "-"} (${r.member_code})` : (v || r.admin_name || "-") },
        { key: "due_date", label: "Due", width: 22, format: v => v || "-" },
        { key: "status", label: "Status", width: 20, bold: true, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
      ],
      data.meeting_actions,
      { fontSize: PDF_TYPE.table }
    );
  }

  const annualExpenseRows = data?.expenses || [];
  if ((data?.projects || []).length) {
    const activeProjects = data.projects.filter((p) => Number(p.annual_spend || 0) > 0 || Number(p.annual_donations || 0) > 0 || ["active","completed"].includes(String(p.status || "")));
    if (activeProjects.length) {
      sectionTitle(ctx, "Community projects", "Each project is shown with its expenses for the reporting year. Project spending is already included in total fund expenses.", 16);
      table(ctx,
        [
          { key: "project_code", label: "Project ID", width: 22, bold: true },
          { key: "name", label: "Project", width: 58 },
          { key: "status", label: "Status", width: 24, bold: true, format: v => String(v || "").toUpperCase() },
          { key: "budget", label: "Budget", width: 32, align: "right", format: v => v == null ? "Open cost" : money(v) },
          { key: "annual_donations", label: "Donations", width: 30, align: "right", bold: true, color: C.green, format: v => money(v) },
          { key: "annual_spend", label: "Year spend", width: 30, align: "right", bold: true, color: C.red, format: v => money(v) },
        ], activeProjects, { fontSize: PDF_TYPE.table }
      );
      activeProjects.forEach(project => {
        const rows = annualExpenseRows.filter(row => String(row.project_id || "") === String(project.id || "") || (!row.project_id && row.project_code && row.project_code === project.project_code));
        const projectDonations = (data.donations || []).filter(row => String(row.project_id || "") === String(project.id || ""));
        if (!rows.length && !projectDonations.length) return;
        sectionTitle(ctx, `${project.project_code} · ${project.name}`, `${project.budget == null ? "Open-cost project" : `Budget ${money(project.budget)}`} · Donations ${money(project.annual_donations||0)} · Year spend ${money(project.annual_spend)}`, 16);
        if (projectDonations.length) {
          sectionTitle(ctx, "Project donations", "Donations linked to this project during the reporting year.", 14);
          table(ctx,
            [
              { key: "transaction_month", label: "Month", width: 24, bold: true },
              { key: "txn_id", label: "Donation ID", width: 28, bold: true },
              { key: "donor_name", label: "Donor", width: 72 },
              { key: "amount", label: "Amount", width: 35, align: "right", bold: true, color: C.green, format: v => money(v) },
            ], projectDonations, { fontSize: PDF_TYPE.table }
          );
        }
        if (!rows.length) return;
        sectionTitle(ctx, "Project expenses", "Expenses linked to this project during the reporting year.", 14);
        table(ctx,
          [
            { key: "transaction_month", label: "Month", width: 22, bold: true },
            { key: "expense_date", label: "Date", width: 24, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
            { key: "txn_id", label: "Expense ID", width: 24, bold: true },
            { key: "description", label: "Description", width: 52 },
            { key: "category", label: "Category", width: 28, format: v => v || "Uncategorised" },
            { key: "amount", label: "Amount", width: 32, align: "right", bold: true, color: C.red, format: v => money(v) },
          ], rows, { fontSize: PDF_TYPE.table }
        );
      });
    }
  }

  if ((data?.expense_categories || []).length) {
    sectionTitle(ctx, "Expense categories", "", 16);
    table(ctx,
      [
        { key: "category", label: "Category", width: 115, bold: true, format: v => v || "Uncategorised" },
        { key: "total", label: "Annual spend", width: 67, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      data.expense_categories
    );
  }

  const annualGeneralExpenses = annualExpenseRows.filter(row => !row.project_id && !row.project_code);
  if (annualGeneralExpenses.length) {
    sectionTitle(ctx, "General expenses", "Approved annual expenses that are not linked to a community project.", 16);
    table(ctx,
      [
        { key: "transaction_month", label: "Month", width: 22, bold: true },
        { key: "expense_date", label: "Date", width: 24, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
        { key: "txn_id", label: "Expense ID", width: 24, bold: true },
        { key: "description", label: "Description", width: 50 },
        { key: "category", label: "Category", width: 29, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 33, align: "right", bold: true, color: C.red, format: v => money(v) },
      ], annualGeneralExpenses, { fontSize: PDF_TYPE.table }
    );
  }
  if (annualExpenseRows.length) {
    const annualExpenseTotal = annualExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    infoPanel(ctx, [["Detailed annual expense total", money(annualExpenseTotal)]]);
  }

  if ((data?.expense_adjustments || []).length) {
    sectionTitle(ctx, "Expense adjustments", "Reversed or voided expenses are retained for audit history but excluded from active annual expense totals.", 18);
    table(ctx,
      [
        { key: "transaction_month", label: "Month", width: 22, bold: true },
        { key: "txn_id", label: "Expense ID", width: 24, bold: true },
        { key: "description", label: "Description", width: 51 },
        { key: "category", label: "Category", width: 31, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 30, align: "right", bold: true, format: v => money(v) },
        { key: "status", label: "Status", width: 24, bold: true, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
      ],
      data.expense_adjustments,
      { fontSize: PDF_TYPE.table }
    );
  }

  sectionTitle(ctx, "Report certification", "", 30);
  certificationPanel(ctx, [
    "This Annual / AGM report was generated electronically from Fund Manager records.",
    `Reporting year: ${year}. Active totals exclude voided and reversed transactions.`,
    "Detailed adjustments remain included in the report for audit transparency.",
  ]);

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-annual-agm-report-${year}.pdf`;
  return sendExportToTelegram(doc.output("blob"),filename,`${brand.fund_name} · ${year} · Annual / AGM Fund Report`);
}
