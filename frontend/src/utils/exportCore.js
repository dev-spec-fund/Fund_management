import { api } from "../api";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => `MVR ${fmt(n)}`;
export const fileSlug = (value) => String(value || "fund").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "fund";
export async function brandingFrom(source) { return source?.organization || await api.branding(); }

export const C = {
  green: [35, 74, 51],
  green2: [62, 111, 76],
  green3: [111, 148, 120],
  greenSoft: [237, 244, 238],
  greenTint: [247, 250, 247],
  cream: [248, 246, 239],
  cream2: [252, 250, 245],
  ink: [31, 39, 33],
  muted: [103, 111, 105],
  faint: [145, 151, 146],
  border: [220, 225, 220],
  borderStrong: [203, 211, 204],
  row: [249, 250, 249],
  white: [255, 255, 255],
  red: [154, 72, 57],
  redSoft: [249, 239, 236],
  amber: [158, 116, 42],
  amberSoft: [250, 245, 233],
};

export const PDF_TYPE = {
  eyebrow: 7.2,
  title: 20,
  subtitle: 9,
  section: 10.2,
  body: 8.2,
  helper: 7.6,
  table: 6.8,
  tableHeader: 6.6,
  footer: 7.2,
};

export const rgb = (doc, method, color) => doc[method](...color);
export const generatedAt = () => {
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

function monogram(brand) {
  return String(brand?.short_name || brand?.fund_name || "FUND")
    .trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "FUND";
}

export function createReport(doc, brand, title, subtitle = "") {
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
    if (ctx.y + height > ctx.pageH - 21) {
      doc.addPage();
      drawHeader(ctx, false);
    }
  };
  return ctx;
}

export function drawHeader(ctx, firstPage) {
  const { doc, brand, pageW } = ctx;
  if (firstPage) {
    // Editorial masthead: restrained, modern and printable in both colour and greyscale.
    rgb(doc, "setFillColor", C.cream2);
    doc.rect(0, 0, pageW, 48, "F");
    rgb(doc, "setFillColor", C.green);
    doc.rect(0, 0, 5, 48, "F");

    rgb(doc, "setFillColor", C.green);
    doc.roundedRect(14, 11, 27, 20, 3.5, 3.5, "F");
    rgb(doc, "setTextColor", C.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(monogram(brand).length > 4 ? 7.8 : 9.5);
    doc.text(monogram(brand), 27.5, 23.5, { align: "center" });

    rgb(doc, "setTextColor", C.green2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(PDF_TYPE.eyebrow);
    doc.text("FUND MANAGER · OFFICIAL REPORT", 48, 13.5);

    rgb(doc, "setTextColor", C.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(PDF_TYPE.title);
    doc.text(String(ctx.title), 48, 23.5);

    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PDF_TYPE.subtitle);
    const sub = ctx.subtitle ? `${ctx.subtitle}  ·  ${String(brand?.fund_name || "Fund Manager")}` : String(brand?.fund_name || "Fund Manager");
    doc.text(doc.splitTextToSize(sub, pageW - 63).slice(0, 1), 48, 30.5);

    rgb(doc, "setDrawColor", C.borderStrong);
    doc.setLineWidth(0.35);
    doc.line(14, 39.5, pageW - 14, 39.5);
    rgb(doc, "setTextColor", C.faint);
    doc.setFontSize(7.2);
    doc.text(`Generated ${generatedAt()} · Maldives Time`, 14, 44.2);
    doc.text("Financial records · Electronically generated", pageW - 14, 44.2, { align: "right" });
    ctx.y = 55;
    return;
  }

  rgb(doc, "setFillColor", C.white);
  doc.rect(0, 0, pageW, 22, "F");
  rgb(doc, "setFillColor", C.green);
  doc.rect(0, 0, pageW, 2.2, "F");
  rgb(doc, "setTextColor", C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.2);
  doc.text(String(ctx.title), 14, 12.5);
  rgb(doc, "setTextColor", C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  const continuation = ctx.subtitle ? `${ctx.subtitle} · ${String(brand?.fund_name || "Fund Manager")}` : String(brand?.fund_name || "Fund Manager");
  doc.text(continuation, pageW - 14, 12.5, { align: "right" });
  rgb(doc, "setDrawColor", C.border);
  doc.line(14, 18, pageW - 14, 18);
  ctx.y = 27;
}

export function reportMeta(ctx, items = []) {
  if (!items.length) return;
  const { doc, margin, pageW } = ctx;
  const width = pageW - margin * 2;
  const gap = 3;
  const colW = (width - gap * (items.length - 1)) / items.length;
  const h = 17;
  ctx.ensure(h + 7);
  items.forEach((item, i) => {
    const x = margin + i * (colW + gap);
    rgb(doc, "setFillColor", C.greenTint);
    rgb(doc, "setDrawColor", C.border);
    doc.roundedRect(x, ctx.y, colW, h, 2.5, 2.5, "FD");
    rgb(doc, "setTextColor", C.faint);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.4);
    doc.text(String(item.label || "").toUpperCase(), x + 4, ctx.y + 5.5);
    rgb(doc, "setTextColor", item.color || C.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.3);
    const text = doc.splitTextToSize(String(item.value ?? "-"), colW - 8);
    doc.text(text.slice(0, 1), x + 4, ctx.y + 12);
  });
  ctx.y += h + 8;
}

export function addFooters(ctx) {
  const { doc, brand, pageW, pageH } = ctx;
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    rgb(doc, "setDrawColor", C.border);
    doc.setLineWidth(0.3);
    doc.line(14, pageH - 14, pageW - 14, pageH - 14);
    rgb(doc, "setTextColor", C.faint);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PDF_TYPE.footer);
    doc.text(`${String(brand?.short_name || "FUND").toUpperCase()} · ${String(brand?.fund_name || "Fund Manager")}`, 14, pageH - 8.5);
    doc.text(`Page ${p} / ${pages}`, pageW - 14, pageH - 8.5, { align: "right" });
  }
}

export function sectionTitle(ctx, title, subtitle = "", reserveAfter = 0) {
  const { doc, margin, pageW } = ctx;
  const subtitleLines = subtitle ? doc.splitTextToSize(String(subtitle), pageW - margin * 2 - 4) : [];
  const titleHeight = 9 + (subtitleLines.length ? subtitleLines.length * 3.8 + 3 : 0);
  ctx.ensure(titleHeight + Math.max(0, reserveAfter));

  rgb(doc, "setFillColor", C.green);
  doc.roundedRect(margin, ctx.y - 2.2, 2.2, 7.5, 1, 1, "F");
  rgb(doc, "setTextColor", C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(PDF_TYPE.section);
  doc.text(String(title), margin + 6, ctx.y + 2.5);
  ctx.y += 8.5;
  if (subtitleLines.length) {
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PDF_TYPE.helper);
    doc.text(subtitleLines, margin + 6, ctx.y);
    ctx.y += subtitleLines.length * 3.8 + 3.5;
  }
}

export function infoPanel(ctx, rows) {
  const { doc, margin, pageW } = ctx;
  if (!rows?.length) return;
  const width = pageW - margin * 2;
  const rowH = 8.2;
  ctx.ensure(rows.length * rowH + 8);
  rgb(doc, "setFillColor", C.white);
  rgb(doc, "setDrawColor", C.border);
  doc.roundedRect(margin, ctx.y, width, rows.length * rowH + 4, 3, 3, "FD");
  let y = ctx.y + 6.8;
  rows.forEach(([label, value], i) => {
    if (i > 0) {
      rgb(doc, "setDrawColor", C.border);
      doc.line(margin + 5, y - 4.2, pageW - margin - 5, y - 4.2);
    }
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PDF_TYPE.body);
    doc.text(String(label), margin + 5, y);
    rgb(doc, "setTextColor", C.ink);
    doc.setFont("helvetica", "bold");
    doc.text(String(value ?? "-"), pageW - margin - 5, y, { align: "right" });
    y += rowH;
  });
  ctx.y += rows.length * rowH + 9;
}

export function summaryCards(ctx, cards, columns = 2) {
  const { doc, margin, pageW } = ctx;
  const gap = 4.5;
  const width = (pageW - margin * 2 - gap * (columns - 1)) / columns;
  const h = 27;
  for (let i = 0; i < cards.length; i += columns) {
    ctx.ensure(h + 6);
    for (let c = 0; c < columns; c++) {
      const card = cards[i + c];
      if (!card) continue;
      const x = margin + c * (width + gap);
      const accent = card.color || (card.highlight ? C.green : C.green3);
      rgb(doc, "setFillColor", card.highlight ? C.greenSoft : C.white);
      rgb(doc, "setDrawColor", C.border);
      doc.roundedRect(x, ctx.y, width, h, 3, 3, "FD");
      rgb(doc, "setFillColor", accent);
      doc.roundedRect(x, ctx.y, 2.3, h, 1.2, 1.2, "F");
      rgb(doc, "setTextColor", C.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.7);
      doc.text(String(card.label || "").toUpperCase(), x + 6, ctx.y + 7);
      rgb(doc, "setTextColor", card.color || C.ink);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(card.valueSize || 13);
      const value = String(card.value ?? "-");
      const lines = doc.splitTextToSize(value, width - 12);
      doc.text(lines.slice(0, 2), x + 6, ctx.y + 17);
      if (card.note) {
        rgb(doc, "setTextColor", C.muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.4);
        doc.text(String(card.note), x + 6, ctx.y + 23.5);
      }
    }
    ctx.y += h + 6;
  }
}

export function progressBar(ctx, { label, value = 0, rightLabel = "" } = {}) {
  const { doc, margin, pageW } = ctx;
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  const width = pageW - margin * 2;
  ctx.ensure(16);
  rgb(doc, "setTextColor", C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text(String(label || "Progress"), margin, ctx.y + 3);
  rgb(doc, "setTextColor", C.muted);
  doc.setFont("helvetica", "normal");
  doc.text(String(rightLabel || `${pct.toFixed(1)}%`), pageW - margin, ctx.y + 3, { align: "right" });
  rgb(doc, "setFillColor", C.border);
  doc.roundedRect(margin, ctx.y + 6, width, 3.5, 1.7, 1.7, "F");
  if (pct > 0) {
    rgb(doc, "setFillColor", pct >= 80 ? C.green2 : pct >= 50 ? C.amber : C.red);
    doc.roundedRect(margin, ctx.y + 6, Math.max(2, width * pct / 100), 3.5, 1.7, 1.7, "F");
  }
  ctx.y += 15;
}

export function table(ctx, columns, rows, { fontSize = PDF_TYPE.table, headerFontSize = PDF_TYPE.tableHeader, header = true, rowColor } = {}) {
  const { doc, margin } = ctx;
  if (!rows?.length) return;
  const x0 = margin;
  const totalW = columns.reduce((sum, c) => sum + c.width, 0);
  const headerH = 8.5;

  const drawHeaderRow = () => {
    if (!header) return;
    rgb(doc, "setFillColor", C.green);
    doc.roundedRect(x0, ctx.y, totalW, headerH, 1.5, 1.5, "F");
    let x = x0;
    columns.forEach((c) => {
      rgb(doc, "setTextColor", C.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(headerFontSize);
      doc.text(String(c.label || "").toUpperCase(), c.align === "right" ? x + c.width - 3 : x + 3, ctx.y + 5.5, { align: c.align === "right" ? "right" : "left" });
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
    const rowH = Math.max(7.5, lines * 3.55 + 4.2);
    if (ctx.y + rowH > ctx.pageH - 21) {
      doc.addPage();
      drawHeader(ctx, false);
      drawHeaderRow();
    }
    const custom = rowColor ? rowColor(row) : null;
    if (custom || idx % 2 === 1) {
      rgb(doc, "setFillColor", custom || C.row);
      doc.rect(x0, ctx.y, totalW, rowH, "F");
    }
    rgb(doc, "setDrawColor", C.border);
    doc.setLineWidth(0.25);
    doc.line(x0, ctx.y + rowH, x0 + totalW, ctx.y + rowH);
    let x = x0;
    columns.forEach((c, colIdx) => {
      const color = typeof c.color === "function" ? c.color(row) : (c.color || C.ink);
      rgb(doc, "setTextColor", color);
      doc.setFont("helvetica", c.bold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const lineSet = cells[colIdx];
      lineSet.forEach((line, lineIdx) => {
        doc.text(line, c.align === "right" ? x + c.width - 3 : x + 3, ctx.y + 5 + lineIdx * 3.55, { align: c.align === "right" ? "right" : "left" });
      });
      x += c.width;
    });
    ctx.y += rowH;
  });
  ctx.y += 7;
}

export function collectionChart(ctx, months = []) {
  if (!months.length) return;
  sectionTitle(ctx, "Collection performance", "Monthly contribution collection rate across the reporting period.", 46);
  const { doc, margin, pageW } = ctx;
  const chartH = 31;
  const chartW = pageW - margin * 2;
  const baseY = ctx.y + chartH;
  const gap = 2.8;
  const barW = Math.max(5, (chartW - gap * (months.length - 1)) / Math.max(months.length, 1));
  rgb(doc, "setFillColor", C.greenTint);
  doc.roundedRect(margin, ctx.y - 3, chartW, chartH + 13, 3, 3, "F");
  rgb(doc, "setDrawColor", C.borderStrong);
  doc.line(margin + 4, baseY, pageW - margin - 4, baseY);
  months.forEach((m, i) => {
    const hasDue = Number(m.total_due || 0) > 0;
    const rate = hasDue ? Math.max(0, Math.min(100, Number(m.collection_rate || 0))) : 0;
    const h = hasDue ? Math.max(1, (chartH - 5) * rate / 100) : 0;
    const x = margin + i * (barW + gap);
    if (hasDue) {
      rgb(doc, "setFillColor", rate >= 80 ? C.green2 : rate >= 50 ? C.amber : C.red);
      doc.roundedRect(x, baseY - h, barW, h, 1.1, 1.1, "F");
    }
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.1);
    const label = String(m.month || "").slice(5) || String(i + 1);
    doc.text(label, x + barW / 2, baseY + 4.5, { align: "center" });
  });
  ctx.y = baseY + 11;
}

export function certificationPanel(ctx, lines = []) {
  const { doc, margin, pageW } = ctx;
  const body = lines.filter(Boolean);
  const h = Math.max(22, 10 + body.length * 5);
  ctx.ensure(h + 5);
  rgb(doc, "setFillColor", C.cream2);
  rgb(doc, "setDrawColor", C.borderStrong);
  doc.roundedRect(margin, ctx.y, pageW - margin * 2, h, 3, 3, "FD");
  rgb(doc, "setTextColor", C.green);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("ELECTRONIC RECORD", margin + 5, ctx.y + 6.5);
  rgb(doc, "setTextColor", C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(PDF_TYPE.body);
  body.forEach((line, i) => doc.text(String(line), margin + 5, ctx.y + 13 + i * 5));
  ctx.y += h + 6;
}

export function statusColor(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || s === "approved" || s === "active" || s === "completed") return C.green2;
  if (s === "partial" || s === "pending" || s === "maybe") return C.amber;
  if (s === "unpaid" || s === "rejected" || s === "voided" || s === "reversed" || s === "cancelled") return C.red;
  return C.muted;
}
