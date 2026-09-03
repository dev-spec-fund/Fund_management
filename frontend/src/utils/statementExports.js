import { jsPDF } from "jspdf";
import { api } from "../api";
import { brandingFrom, C, createReport, fileSlug, infoPanel, money, PDF_TYPE, sectionTitle, statusColor, summaryCards, table, addFooters, reportMeta, progressBar, certificationPanel } from "./exportCore";
import { sendExportToTelegram } from "./exportDelivery";

export async function exportStatementCsv(member) {
  const st = await api.members.statement(member.id);
  const brand=await brandingFrom(st);
  const rows = [["Group", brand.fund_name], ["Member ID", st.member.member_code], ["Member", st.member.name], [], ["Month","Status","Paid","Due","Reason"]];
  for (const x of st.monthly_status) rows.push([x.month,x.status,x.paid,x.due,x.reason||""]);
  rows.push([], ["Contribution transaction","Month","Amount","Bank reference","Status","Submitted"]);
  for (const x of st.contributions) rows.push([x.txn_id,x.month,x.amount,x.ref_number||"",x.status,x.submitted_at]);
  rows.push([], ["Donation transaction","Month","Amount","Note","Date"]);
  for (const x of (st.donations || [])) rows.push([x.txn_id,x.transaction_month||"",x.amount,x.note||"",x.created_at]);
  rows.push([], ["Balance date","Transaction","Type","Amount","Running balance"]);
  for (const x of (st.balance_history || [])) rows.push([x.at,x.txn_id,x.kind,x.amount,x.balance]);
  const safeCsv = (v) => { let x=String(v ?? ""); if (/^[=+\-@]/.test(x)) x=`'${x}`; return `"${x.replace(/"/g,'""')}"`; };
  const csv = rows.map(r => r.map(safeCsv).join(",")).join("\n");
  const filename=`${fileSlug(brand.short_name)}-${st.member.member_code}-statement.csv`;
  return sendExportToTelegram(new Blob([csv], {type:"text/csv;charset=utf-8"}), filename, `${brand.fund_name} · ${st.member.member_code} · Member statement CSV`);
}

export async function exportStatementPdf(member) {
  const st = await api.members.statement(member.id);
  const brand = await brandingFrom(st);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const ctx = createReport(doc, brand, "Member Statement", `${st.member.member_code} · ${st.member.name}`);

  const statuses = st.monthly_status || [];
  const approvedContributions = (st.contributions || []).filter(x => String(x.status).toLowerCase() === "approved");
  const totalContributed = approvedContributions.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalDonations = (st.donations || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  const outstanding = statuses.reduce((s, x) => s + Number(x.due || 0), 0);
  const paidMonths = statuses.filter(x => String(x.status).toLowerCase() === "paid").length;
  const settledRate = statuses.length ? (paidMonths / statuses.length) * 100 : 0;

  reportMeta(ctx, [
    { label: "Member ID", value: st.member.member_code },
    { label: "Account", value: Number(st.member.active ?? 1) ? "Active" : "Inactive", color: Number(st.member.active ?? 1) ? C.green2 : C.red },
    { label: "Statement scope", value: statuses.length ? `${statuses.length} month${statuses.length === 1 ? "" : "s"}` : "No obligations" },
  ]);

  infoPanel(ctx, [
    ["Member", st.member.name],
    ["Member ID", st.member.member_code],
    ["Monthly contribution", money(st.member.monthly_amount)],
    ["Account status", Number(st.member.active ?? 1) ? "Active" : "Inactive"],
  ]);

  summaryCards(ctx, [
    { label: "Total contributed", value: money(totalContributed), highlight: true, color: C.green },
    { label: "Outstanding", value: money(outstanding), color: outstanding > 0 ? C.red : C.green2 },
    { label: "Donations", value: money(totalDonations) },
    { label: "Paid months", value: `${paidMonths} / ${statuses.length || 0}` },
  ]);
  if (statuses.length) progressBar(ctx, { label: "Obligation completion", value: settledRate, rightLabel: `${paidMonths} of ${statuses.length} months fully paid` });

  sectionTitle(ctx, "Monthly status", "Monthly obligation and payment status from the member's joining month to the current month.");
  table(ctx,
    [
      { key: "month", label: "Month", width: 27, bold: true },
      { key: "status", label: "Status", width: 29, bold: true, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
      { key: "paid", label: "Paid", width: 35, align: "right", format: v => money(v) },
      { key: "due", label: "Due", width: 35, align: "right", format: v => money(v) },
      { key: "reason", label: "Reason", width: 56, format: v => v || "-" },
    ],
    statuses
  );

  sectionTitle(ctx, "Contribution transactions");
  table(ctx,
    [
      { key: "txn_id", label: "Transaction", width: 27, bold: true },
      { key: "month", label: "Month", width: 24 },
      { key: "amount", label: "Amount", width: 31, align: "right", bold: true, format: v => money(v) },
      { key: "ref_number", label: "Bank reference", width: 48, format: v => v || "-" },
      { key: "status", label: "Status", width: 26, color: r => statusColor(r.status), format: v => String(v || "").toUpperCase() },
      { key: "submitted_at", label: "Date", width: 26, format: v => String(v || "").slice(0, 10) },
    ],
    st.contributions || [],
    { fontSize: 7.1 }
  );

  if ((st.donations || []).length) {
    sectionTitle(ctx, "Donations");
    table(ctx,
      [
        { key: "txn_id", label: "Transaction", width: 30, bold: true },
        { key: "transaction_month", label: "Month", width: 27 },
        { key: "amount", label: "Amount", width: 35, align: "right", bold: true, format: v => money(v) },
        { key: "note", label: "Note", width: 60, format: v => v || "-" },
        { key: "created_at", label: "Date", width: 30, format: v => String(v || "").slice(0, 10) },
      ],
      st.donations || []
    );
  }

  if ((st.balance_history || []).length) {
    sectionTitle(ctx, "Balance history", "Running record of approved member contributions and donations.");
    table(ctx,
      [
        { key: "at", label: "Date", width: 28, format: v => String(v || "").slice(0, 10) },
        { key: "txn_id", label: "Transaction", width: 32, bold: true },
        { key: "kind", label: "Type", width: 36, format: v => String(v || "").replace(/^./, c => c.toUpperCase()) },
        { key: "amount", label: "Amount", width: 40, align: "right", format: v => money(v) },
        { key: "balance", label: "Running balance", width: 46, align: "right", bold: true, format: v => money(v) },
      ],
      st.balance_history || []
    );
  }

  sectionTitle(ctx, "Statement note", "", 24);
  certificationPanel(ctx, [
    "This statement was generated electronically from the Fund Manager ledger.",
    "Approved transactions and current member obligations are reflected at the time of generation.",
  ]);

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-${st.member.member_code}-statement.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${st.member.member_code} · Member statement PDF`);
}

