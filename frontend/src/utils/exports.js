import { jsPDF } from "jspdf";
import { api } from "../api";

const fmt = (n) => Number(n || 0).toLocaleString();
const fileSlug = (value) => String(value || "fund").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "fund";
async function brandingFrom(source) { return source?.organization || await api.branding(); }

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
  const brand=await brandingFrom(st);
  const doc = new jsPDF(); let y=18;
  doc.setFontSize(10); doc.text(brand.fund_name,14,y); y+=6;
  doc.setFontSize(16); doc.text("Member Statement", 14, y); y+=9;
  doc.setFontSize(10); doc.text(`${st.member.member_code} — ${st.member.name}`,14,y); y+=6;
  doc.text(`Monthly contribution: MVR ${fmt(st.member.monthly_amount)}`,14,y); y+=10;
  doc.setFontSize(11); doc.text("Monthly status",14,y); y+=6; doc.setFontSize(9);
  for (const x of st.monthly_status) { if(y>280){doc.addPage();y=18;} doc.text(`${x.month}  ${String(x.status).toUpperCase()}  Paid MVR ${fmt(x.paid)}  Due MVR ${fmt(x.due)}`,14,y); y+=5; }
  y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Transactions",14,y); y+=6; doc.setFontSize(9);
  for (const x of st.contributions) { if(y>280){doc.addPage();y=18;} doc.text(`${x.txn_id}  ${x.month}  MVR ${fmt(x.amount)}  ${x.ref_number||"No bank ref"}  ${x.status}`,14,y); y+=5; }
  if ((st.donations || []).length) { y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Donations",14,y); y+=6; doc.setFontSize(9); for(const x of st.donations){if(y>280){doc.addPage();y=18;}doc.text(`${x.txn_id}  ${x.transaction_month||""}  MVR ${fmt(x.amount)}  ${x.note||""}`,14,y);y+=5;} }
  y+=5; if(y>270){doc.addPage();y=18;} doc.setFontSize(11); doc.text("Balance history",14,y); y+=6; doc.setFontSize(9); for(const x of (st.balance_history||[])){if(y>280){doc.addPage();y=18;}doc.text(`${String(x.at||"").slice(0,10)}  ${x.txn_id}  ${x.kind}  +MVR ${fmt(x.amount)}  Balance MVR ${fmt(x.balance)}`,14,y);y+=5;}
  const filename=`${fileSlug(brand.short_name)}-${st.member.member_code}-statement.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${st.member.member_code} · Member statement PDF`);
}

export async function exportFundPdf({ month, monthLabel, summary }) {
  const brand=await api.branding();
  const doc = new jsPDF(); let y=18;
  const line=(label,value)=>{ doc.text(label,14,y); doc.text(String(value),120,y); y+=7; };
  doc.setFontSize(10); doc.text(brand.fund_name,14,y); y+=6;
  doc.setFontSize(16); doc.text("Fund Report",14,y); y+=9;
  doc.setFontSize(11); doc.text(monthLabel,14,y); y+=10;
  doc.setFontSize(10);
  line("Opening balance", `MVR ${fmt(summary.openingBalance ?? 0)}`);
  line("Contribution cash received", `MVR ${fmt(summary.memberIncome)}`);
  line("Allocated contributions", `MVR ${fmt(summary.allocatedContributions ?? summary.memberIncome)}`);
  line("Paid in advance", `MVR ${fmt(summary.advanceAllocated)}`);
  line("Donations", `MVR ${fmt(summary.donationIncome)}`);
  line("Expenses", `MVR ${fmt(summary.expenses)}`);
  line("Net change", `MVR ${fmt(summary.net)}`);
  line("Closing balance", `MVR ${fmt(summary.closingBalance ?? summary.fundBalance)}`);
  line("Outstanding dues", `MVR ${fmt(summary.outstanding?.total)}`);
  y+=5; doc.setFontSize(11); doc.text("Expense categories",14,y); y+=7; doc.setFontSize(9);
  for(const c of (summary.byCategory||[]).filter(x=>Number(x.spent||0)>0)){ if(y>280){doc.addPage();y=18;} doc.text(String(c.category||"Uncategorised"),14,y); doc.text(`MVR ${fmt(c.spent)}`,120,y); y+=6; }
  const filename=`${fileSlug(brand.short_name)}-fund-report-${month}.pdf`;
  return sendExportToTelegram(doc.output("blob"), filename, `${brand.fund_name} · ${monthLabel} · Fund report PDF`);
}

export async function exportAnnualAgmPdf(data) {
  const year=String(data?.year||new Date().getFullYear());
  const t=data?.totals||{};
  const brand=await brandingFrom(data);
  const doc=new jsPDF(); let y=18;
  const add=(label,value)=>{doc.text(String(label),14,y);doc.text(String(value),125,y);y+=7;};
  const page=()=>{if(y>274){doc.addPage();y=18;}};
  doc.setFontSize(10);doc.text(brand.fund_name,14,y);y+=6;
  doc.setFontSize(17);doc.text(`Annual / AGM Fund Report ${year}`,14,y);y+=10;
  doc.setFontSize(10);
  add("Opening balance",`MVR ${fmt(t.opening_balance)}`);
  add("Contributions received",`MVR ${fmt(t.contributions)}`);
  add("Donations received",`MVR ${fmt(t.donations)}`);
  add("Expenses",`MVR ${fmt(t.expenses)}`);
  add("Net cash change",`MVR ${fmt(t.net)}`);
  add("Closing balance",`MVR ${fmt(t.closing_balance)}`);
  add("Annual collection rate",`${Number(t.collection_rate||0).toFixed(1)}%`);
  add("Meetings",String(data?.meetings||0));
  add("Financial reversals",String(data?.reversals?.count||0));
  y+=5; doc.setFontSize(12);doc.text("Monthly summary",14,y);y+=7;doc.setFontSize(8.5);
  for(const m of data?.months||[]){page();doc.text(`${m.month}  Collected MVR ${fmt(m.total_collected)} / ${fmt(m.total_due)}  Expenses MVR ${fmt(m.expenses)}  Closing MVR ${fmt(m.closing_balance)}  ${Number(m.collection_rate||0).toFixed(0)}%`,14,y);y+=5;}
  y+=5;page();doc.setFontSize(12);doc.text("Expense categories",14,y);y+=7;doc.setFontSize(9);
  for(const c of data?.expense_categories||[]){page();add(c.category,`MVR ${fmt(c.total)}`);}
  const filename=`${fileSlug(brand.short_name)}-annual-agm-report-${year}.pdf`;
  return sendExportToTelegram(doc.output("blob"),filename,`${brand.fund_name} · ${year} · Annual / AGM Fund Report`);
}
