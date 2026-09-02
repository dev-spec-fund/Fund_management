import { jsPDF } from "jspdf";
import { api } from "../api";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const money = (n) => `MVR ${fmt(n)}`;
const fileSlug = (value) => String(value || "fund").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "fund";
async function brandingFrom(source) { return source?.organization || await api.branding(); }

const C = {
  green: [36, 76, 53],
  green2: [61, 111, 76],
  greenSoft: [235, 242, 235],
  cream: [247, 244, 235],
  ink: [31, 42, 34],
  muted: [102, 112, 104],
  border: [218, 224, 218],
  row: [249, 250, 248],
  white: [255, 255, 255],
  red: [158, 75, 58],
  amber: [164, 121, 43],
};

const rgb = (doc, method, color) => doc[method](...color);
const generatedAt = () => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Indian/Maldives",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    }).format(new Date());
  } catch {
    return new Date().toLocaleString("en-GB");
  }
};

function createReport(doc, brand, title, subtitle = "") {
  const ctx = {
    doc,
    brand,
    title,
    subtitle,
    margin: 14,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    y: 0,
  };
  drawHeader(ctx, true);
  ctx.ensure = (height = 10) => {
    if (ctx.y + height > ctx.pageH - 20) {
      doc.addPage();
      drawHeader(ctx, false);
    }
  };
  return ctx;
}

function drawHeader(ctx, firstPage) {
  const { doc, brand, pageW } = ctx;
  rgb(doc, "setFillColor", C.green);
  doc.rect(0, 0, pageW, 36, "F");

  const shortName = String(brand?.short_name || "FUND").slice(0, 10).toUpperCase();
  rgb(doc, "setFillColor", C.cream);
  doc.roundedRect(14, 9, 25, 17, 3, 3, "F");
  rgb(doc, "setTextColor", C.green);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(shortName.length > 6 ? 7.5 : 9);
  doc.text(shortName, 26.5, 19.5, { align: "center" });

  rgb(doc, "setTextColor", C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(firstPage ? 16 : 12);
  doc.text(ctx.title, 46, firstPage ? 16 : 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const org = String(brand?.fund_name || "Fund Manager");
  doc.text(org, 46, firstPage ? 22 : 20);
  if (firstPage && ctx.subtitle) doc.text(ctx.subtitle, 46, 28);

  doc.setFontSize(7.5);
  doc.text(`Generated ${generatedAt()}`, pageW - 14, 29, { align: "right" });
  ctx.y = firstPage ? 46 : 43;
}

function addFooters(ctx) {
  const { doc, brand, pageW, pageH } = ctx;
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    rgb(doc, "setDrawColor", C.border);
    doc.setLineWidth(0.3);
    doc.line(14, pageH - 13, pageW - 14, pageH - 13);
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(String(brand?.fund_name || "Fund Manager"), 14, pageH - 8);
    doc.text(`Page ${p} of ${pages}`, pageW - 14, pageH - 8, { align: "right" });
  }
}

function sectionTitle(ctx, title, subtitle = "") {
  ctx.ensure(subtitle ? 18 : 13);
  const { doc, margin, pageW } = ctx;
  rgb(doc, "setTextColor", C.green);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(String(title).toUpperCase(), margin, ctx.y);
  rgb(doc, "setDrawColor", C.border);
  doc.setLineWidth(0.35);
  doc.line(margin, ctx.y + 3, pageW - margin, ctx.y + 3);
  ctx.y += 8;
  if (subtitle) {
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(String(subtitle), pageW - margin * 2);
    doc.text(lines, margin, ctx.y);
    ctx.y += lines.length * 4 + 3;
  }
}

function infoPanel(ctx, rows) {
  const { doc, margin, pageW } = ctx;
  const width = pageW - margin * 2;
  const rowH = 8;
  ctx.ensure(rows.length * rowH + 7);
  rgb(doc, "setFillColor", C.row);
  rgb(doc, "setDrawColor", C.border);
  doc.roundedRect(margin, ctx.y, width, rows.length * rowH + 5, 3, 3, "FD");
  let y = ctx.y + 7;
  rows.forEach(([label, value], i) => {
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(String(label), margin + 5, y);
    rgb(doc, "setTextColor", C.ink);
    doc.setFont("helvetica", "bold");
    doc.text(String(value ?? "-"), pageW - margin - 5, y, { align: "right" });
    if (i < rows.length - 1) {
      rgb(doc, "setDrawColor", C.border);
      doc.line(margin + 5, y + 2.7, pageW - margin - 5, y + 2.7);
    }
    y += rowH;
  });
  ctx.y += rows.length * rowH + 10;
}

function summaryCards(ctx, cards, columns = 2) {
  const { doc, margin, pageW } = ctx;
  const gap = 5;
  const width = (pageW - margin * 2 - gap * (columns - 1)) / columns;
  const h = 25;
  for (let i = 0; i < cards.length; i += columns) {
    ctx.ensure(h + 6);
    for (let c = 0; c < columns; c++) {
      const card = cards[i + c];
      if (!card) continue;
      const x = margin + c * (width + gap);
      rgb(doc, "setFillColor", card.highlight ? C.greenSoft : C.row);
      rgb(doc, "setDrawColor", C.border);
      doc.roundedRect(x, ctx.y, width, h, 3, 3, "FD");
      rgb(doc, "setTextColor", C.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.text(String(card.label || "").toUpperCase(), x + 5, ctx.y + 7);
      rgb(doc, "setTextColor", card.color || C.ink);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(card.valueSize || 13.5);
      const value = String(card.value ?? "-");
      const lines = doc.splitTextToSize(value, width - 10);
      doc.text(lines.slice(0, 2), x + 5, ctx.y + 16);
      if (card.note) {
        rgb(doc, "setTextColor", C.muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        doc.text(String(card.note), x + 5, ctx.y + 22);
      }
    }
    ctx.y += h + 6;
  }
}

function table(ctx, columns, rows, { fontSize = 7.6, header = true, rowColor } = {}) {
  const { doc, margin } = ctx;
  const x0 = margin;
  const totalW = columns.reduce((sum, c) => sum + c.width, 0);
  const headerH = 8;

  const drawHeaderRow = () => {
    if (!header) return;
    rgb(doc, "setFillColor", C.greenSoft);
    rgb(doc, "setDrawColor", C.border);
    doc.rect(x0, ctx.y, totalW, headerH, "FD");
    let x = x0;
    columns.forEach((c) => {
      rgb(doc, "setTextColor", C.green);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.1);
      doc.text(String(c.label || "").toUpperCase(), c.align === "right" ? x + c.width - 3 : x + 3, ctx.y + 5.2, { align: c.align === "right" ? "right" : "left" });
      x += c.width;
    });
    ctx.y += headerH;
  };

  ctx.ensure(headerH + 8);
  drawHeaderRow();

  rows.forEach((row, idx) => {
    const cells = columns.map((c) => {
      const raw = typeof c.value === "function" ? c.value(row) : row?.[c.key];
      const text = c.format ? c.format(raw, row) : String(raw ?? "-");
      return doc.splitTextToSize(text, Math.max(5, c.width - 6));
    });
    const lines = Math.max(1, ...cells.map((x) => x.length));
    const rowH = Math.max(7, lines * 3.6 + 4);
    if (ctx.y + rowH > ctx.pageH - 20) {
      doc.addPage();
      drawHeader(ctx, false);
      drawHeaderRow();
    }
    if (idx % 2 === 1) {
      rgb(doc, "setFillColor", C.row);
      doc.rect(x0, ctx.y, totalW, rowH, "F");
    }
    if (rowColor) {
      const fill = rowColor(row);
      if (fill) {
        rgb(doc, "setFillColor", fill);
        doc.rect(x0, ctx.y, totalW, rowH, "F");
      }
    }
    rgb(doc, "setDrawColor", C.border);
    doc.line(x0, ctx.y + rowH, x0 + totalW, ctx.y + rowH);
    let x = x0;
    columns.forEach((c, colIdx) => {
      const color = typeof c.color === "function" ? c.color(row) : (c.color || C.ink);
      rgb(doc, "setTextColor", color);
      doc.setFont("helvetica", c.bold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const lineSet = cells[colIdx];
      lineSet.forEach((line, lineIdx) => {
        doc.text(line, c.align === "right" ? x + c.width - 3 : x + 3, ctx.y + 4.7 + lineIdx * 3.6, { align: c.align === "right" ? "right" : "left" });
      });
      x += c.width;
    });
    ctx.y += rowH;
  });
  ctx.y += 6;
}

function collectionChart(ctx, months = []) {
  if (!months.length) return;
  ctx.ensure(48);
  sectionTitle(ctx, "Collection performance");
  const { doc, margin, pageW } = ctx;
  const chartH = 28;
  const chartW = pageW - margin * 2;
  const baseY = ctx.y + chartH;
  const gap = 2.5;
  const barW = Math.max(5, (chartW - gap * (months.length - 1)) / Math.max(months.length, 1));
  rgb(doc, "setDrawColor", C.border);
  doc.line(margin, baseY, pageW - margin, baseY);
  months.forEach((m, i) => {
    const rate = Math.max(0, Math.min(100, Number(m.collection_rate || 0)));
    const h = Math.max(1, chartH * rate / 100);
    const x = margin + i * (barW + gap);
    rgb(doc, "setFillColor", C.green2);
    doc.roundedRect(x, baseY - h, barW, h, 1, 1, "F");
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    const label = String(m.month || "").slice(5) || String(i + 1);
    doc.text(label, x + barW / 2, baseY + 4, { align: "center" });
  });
  ctx.y = baseY + 10;
}

function statusColor(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || s === "approved" || s === "active") return C.green2;
  if (s === "partial" || s === "pending") return C.amber;
  if (s === "unpaid" || s === "rejected" || s === "voided" || s === "reversed") return C.red;
  return C.muted;
}

export async function sendExportToTelegram(blob, filename, caption) {
  const result = await api.reports.sendDocument(blob, filename, caption);
  const message = `✅ ${result.filename || filename} sent to your Telegram chat.`;
  if (window.Telegram?.WebApp?.showAlert) window.Telegram.WebApp.showAlert(message);
  else alert(message);
  return result;
}

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
  const ctx = createReport(doc, brand, "Member Statement", `${st.member.member_code} - ${st.member.name}`);

  const statuses = st.monthly_status || [];
  const approvedContributions = (st.contributions || []).filter(x => String(x.status).toLowerCase() === "approved");
  const totalContributed = approvedContributions.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalDonations = (st.donations || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  const outstanding = statuses.reduce((s, x) => s + Number(x.due || 0), 0);
  const paidMonths = statuses.filter(x => String(x.status).toLowerCase() === "paid").length;

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

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-${st.member.member_code}-statement.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${st.member.member_code} · Member statement PDF`);
}

export async function exportFundPdf({ month, monthLabel, summary }) {
  const brand = await api.branding();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const ctx = createReport(doc, brand, "Monthly Fund Report", monthLabel);
  const expected = Number(summary.collection?.expected || 0);
  const collected = Number(summary.collection?.collected || 0);
  const rate = expected > 0 ? Math.min(100, collected / expected * 100) : 100;

  summaryCards(ctx, [
    { label: "Opening balance", value: money(summary.openingBalance), highlight: true },
    { label: "Closing balance", value: money(summary.closingBalance ?? summary.fundBalance), highlight: true, color: C.green },
    { label: "Net cash change", value: `${Number(summary.net || 0) >= 0 ? "+" : "-"} ${money(Math.abs(Number(summary.net || 0)))}`, color: Number(summary.net || 0) >= 0 ? C.green2 : C.red },
    { label: "Collection rate", value: `${rate.toFixed(1)}%`, color: C.green2 },
  ]);

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
    sectionTitle(ctx, "Expense categories");
    table(ctx,
      [
        { key: "category", label: "Category", width: 115, bold: true, format: v => v || "Uncategorised" },
        { key: "spent", label: "Amount", width: 67, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      categories
    );
  }

  if ((summary.expenseDetails || []).length) {
    sectionTitle(ctx, "Expense details", "Approved expenses included in the selected month's expense total.");
    table(ctx,
      [
        { key: "expense_date", label: "Date", width: 24, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
        { key: "txn_id", label: "Expense ID", width: 24, bold: true },
        { key: "description", label: "Description", width: 60 },
        { key: "category", label: "Category", width: 38, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 36, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      summary.expenseDetails,
      { fontSize: 7.1 }
    );
    const expenseTotal = summary.expenseDetails.reduce((sum, row) => sum + Number(row.amount || 0), 0);
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

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-fund-report-${month}.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${monthLabel} · Fund report PDF`);
}

export async function exportAnnualAgmPdf(data) {
  const year = String(data?.year || new Date().getFullYear());
  const t = data?.totals || {};
  const brand = await brandingFrom(data);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const ctx = createReport(doc, brand, "Annual / AGM Fund Report", year);

  summaryCards(ctx, [
    { label: "Opening balance", value: money(t.opening_balance), highlight: true },
    { label: "Closing balance", value: money(t.closing_balance), highlight: true, color: C.green },
    { label: "Contributions", value: money(t.contributions), color: C.green2 },
    { label: "Expenses", value: money(t.expenses), color: C.red },
  ]);

  sectionTitle(ctx, "Executive summary");
  infoPanel(ctx, [
    ["Donations received", money(t.donations)],
    ["Net cash change", `${Number(t.net || 0) >= 0 ? "+" : "-"} ${money(Math.abs(Number(t.net || 0)))}`],
    ["Annual collection rate", `${Number(t.collection_rate || 0).toFixed(1)}%`],
    ["Meetings held", String(data?.meetings || 0)],
    ["Financial reversals", String(data?.reversals?.count || 0)],
  ]);

  collectionChart(ctx, data?.months || []);

  sectionTitle(ctx, "Monthly performance");
  table(ctx,
    [
      { key: "month", label: "Month", width: 25, bold: true },
      { key: "total_due", label: "Due", width: 31, align: "right", format: v => money(v) },
      { key: "total_collected", label: "Collected", width: 36, align: "right", bold: true, format: v => money(v) },
      { key: "expenses", label: "Expenses", width: 31, align: "right", color: C.red, format: v => money(v) },
      { key: "closing_balance", label: "Closing", width: 34, align: "right", bold: true, format: v => money(v) },
      { key: "collection_rate", label: "Rate", width: 25, align: "right", color: C.green2, format: v => `${Number(v || 0).toFixed(0)}%` },
    ],
    data?.months || [],
    { fontSize: 6.9 }
  );

  if ((data?.member_contributions || []).length) {
    sectionTitle(ctx, "Member contribution summary", "Annual contribution target and collection position for active members. Exempt months are excluded from the annual target.");
    table(ctx,
      [
        { key: "member_code", label: "Member ID", width: 24, bold: true },
        { key: "name", label: "Member", width: 52 },
        { key: "annual_target", label: "Annual due", width: 30, align: "right", format: v => money(v) },
        { key: "collected", label: "Collected", width: 30, align: "right", bold: true, color: C.green2, format: v => money(v) },
        { key: "outstanding", label: "Outstanding", width: 30, align: "right", bold: true, color: r => Number(r.outstanding || 0) > 0 ? C.red : C.green2, format: v => money(v) },
        { key: "rate", label: "Rate", width: 16, align: "right", format: v => `${Number(v || 0).toFixed(0)}%` },
      ],
      data.member_contributions,
      { fontSize: 6.5 }
    );
    const memberTotals=data.member_contributions.reduce((a,row)=>({due:a.due+Number(row.annual_target||0),collected:a.collected+Number(row.collected||0),outstanding:a.outstanding+Number(row.outstanding||0)}),{due:0,collected:0,outstanding:0});
    infoPanel(ctx, [
      ["Annual member obligations", money(memberTotals.due)],
      ["Member contributions collected", money(memberTotals.collected)],
      ["Outstanding member obligations", money(memberTotals.outstanding)],
    ]);
  }

  if ((data?.donations || []).length) {
    sectionTitle(ctx, "Donation details", "Active donations included in the annual donation total.");
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
      { fontSize: 6.5 }
    );
    const donationTotal=data.donations.reduce((sum,row)=>sum+Number(row.amount||0),0);
    infoPanel(ctx, [["Detailed annual donation total", money(donationTotal)]]);
  }

  if ((data?.donation_adjustments || []).length) {
    sectionTitle(ctx, "Donation adjustments", "Reversed or voided donations remain visible for audit history and are excluded from active donation totals.");
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
      { fontSize: 6.4 }
    );
  }

  if ((data?.expense_categories || []).length) {
    sectionTitle(ctx, "Expense categories");
    table(ctx,
      [
        { key: "category", label: "Category", width: 115, bold: true, format: v => v || "Uncategorised" },
        { key: "total", label: "Annual spend", width: 67, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      data.expense_categories
    );
  }

  if ((data?.expenses || []).length) {
    sectionTitle(ctx, "Detailed expenses", "Approved expense transactions included in the annual expense total.");
    table(ctx,
      [
        { key: "transaction_month", label: "Month", width: 22, bold: true },
        { key: "expense_date", label: "Date", width: 24, format: (v,r) => String(v || r.created_at || "").slice(0,10) },
        { key: "txn_id", label: "Expense ID", width: 24, bold: true },
        { key: "description", label: "Description", width: 50 },
        { key: "category", label: "Category", width: 29, format: v => v || "Uncategorised" },
        { key: "amount", label: "Amount", width: 33, align: "right", bold: true, color: C.red, format: v => money(v) },
      ],
      data.expenses,
      { fontSize: 6.7 }
    );
    const annualExpenseTotal = data.expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    infoPanel(ctx, [["Detailed annual expense total", money(annualExpenseTotal)]]);
  }

  if ((data?.expense_adjustments || []).length) {
    sectionTitle(ctx, "Expense adjustments", "Reversed or voided expenses are retained for audit history but excluded from active annual expense totals.");
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
      { fontSize: 6.6 }
    );
  }

  ctx.ensure(28);
  sectionTitle(ctx, "Report certification");
  rgb(doc, "setFillColor", C.cream);
  rgb(doc, "setDrawColor", C.border);
  doc.roundedRect(ctx.margin, ctx.y, ctx.pageW - ctx.margin * 2, 20, 3, 3, "FD");
  rgb(doc, "setTextColor", C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("This report was generated electronically from the Fund Manager records.", ctx.margin + 5, ctx.y + 8);
  doc.text(`Reporting year: ${year}`, ctx.margin + 5, ctx.y + 14);
  ctx.y += 25;

  addFooters(ctx);
  const filename=`${fileSlug(brand.short_name)}-annual-agm-report-${year}.pdf`;
  return sendExportToTelegram(doc.output("blob"),filename,`${brand.fund_name} · ${year} · Annual / AGM Fund Report`);
}
