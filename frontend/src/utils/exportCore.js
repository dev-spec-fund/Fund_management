import { api } from "../api";

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const money = (n) => `MVR ${fmt(n)}`;
export const fileSlug = (value) => String(value || "fund").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "fund";
export async function brandingFrom(source) { return source?.organization || await api.branding(); }

export const C = {
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

export const PDF_TYPE = {
  section: 10.5,
  body: 8.3,
  helper: 8.1,
  table: 6.8,
  tableHeader: 6.8,
  footer: 7.5,
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
    if (ctx.y + height > ctx.pageH - 20) {
      doc.addPage();
      drawHeader(ctx, false);
    }
  };
  return ctx;
}

export function drawHeader(ctx, firstPage) {
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

export function addFooters(ctx) {
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

export function sectionTitle(ctx, title, subtitle = "", reserveAfter = 0) {
  const { doc, margin, pageW } = ctx;
  const subtitleLines = subtitle
    ? doc.splitTextToSize(String(subtitle), pageW - margin * 2)
    : [];
  // Reserve enough room for the heading plus the first meaningful content
  // (typically a table header + first row). This prevents orphan headings.
  const titleHeight = 8 + (subtitleLines.length ? subtitleLines.length * 4 + 3 : 0);
  ctx.ensure(titleHeight + Math.max(0, reserveAfter));
  rgb(doc, "setTextColor", C.green);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(PDF_TYPE.section);
  doc.text(String(title).toUpperCase(), margin, ctx.y);
  rgb(doc, "setDrawColor", C.border);
  doc.setLineWidth(0.35);
  doc.line(margin, ctx.y + 3, pageW - margin, ctx.y + 3);
  ctx.y += 8;
  if (subtitleLines.length) {
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PDF_TYPE.helper);
    doc.text(subtitleLines, margin, ctx.y);
    ctx.y += subtitleLines.length * 4 + 3;
  }
}

export function infoPanel(ctx, rows) {
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
    doc.setFontSize(PDF_TYPE.body);
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

export function summaryCards(ctx, cards, columns = 2) {
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

export function table(ctx, columns, rows, { fontSize = PDF_TYPE.table, headerFontSize = PDF_TYPE.tableHeader, header = true, rowColor } = {}) {
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
      doc.setFontSize(headerFontSize);
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

export function collectionChart(ctx, months = []) {
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
    const hasDue = Number(m.total_due || 0) > 0;
    const rate = hasDue ? Math.max(0, Math.min(100, Number(m.collection_rate || 0))) : 0;
    const h = hasDue ? Math.max(1, chartH * rate / 100) : 0;
    const x = margin + i * (barW + gap);
    if (hasDue) {
      rgb(doc, "setFillColor", C.green2);
      doc.roundedRect(x, baseY - h, barW, h, 1, 1, "F");
    }
    rgb(doc, "setTextColor", C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    const label = String(m.month || "").slice(5) || String(i + 1);
    doc.text(label, x + barW / 2, baseY + 4, { align: "center" });
  });
  ctx.y = baseY + 10;
}

export function statusColor(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || s === "approved" || s === "active") return C.green2;
  if (s === "partial" || s === "pending") return C.amber;
  if (s === "unpaid" || s === "rejected" || s === "voided" || s === "reversed") return C.red;
  return C.muted;
}

