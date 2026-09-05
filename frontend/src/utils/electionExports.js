import { jsPDF } from "jspdf";
import { api } from "../api";
import { sendExportToTelegram } from "./exportDelivery";
import { addFooters, createReport, fileSlug, infoPanel, reportMeta, sectionTitle, summaryCards, table } from "./exportCore";

const fmtDate=(v)=>v?String(v).replace("T"," ").slice(0,16):"-";
const safeCsv=(v)=>{
  const s=String(v??"");
  const guarded=/^[=+\-@]/.test(s)?"'"+s:s;
  return `"${guarded.replace(/"/g,'""')}"`;
};

export async function exportElectionCsv(summary){
  const e=summary?.election||{};
  const rows=[
    ["Official Election Record",e.title||"Election"],
    ["Term",e.term||""],
    ["Applications open",fmtDate(e.applications_open_at)],
    ["Applications close",fmtDate(e.applications_close_at)],
    ["Voting open",fmtDate(e.voting_open_at)],
    ["Voting close",fmtDate(e.voting_close_at)],
    ["Certified",fmtDate(e.certified_at)],
    ["Certified by",e.certified_by_name||""],
    ["Eligible voters",summary.turnout?.eligible||0],
    ["Votes submitted",summary.turnout?.voted||0],
    ["Turnout %",Number(summary.turnout?.percent||0).toFixed(1)],
    ["Applicants",summary.applications?.total||0],
    ["Approved applications",summary.applications?.approved||0],
    ["Rejected applications",summary.applications?.rejected||0],
    ["Withdrawn applications",summary.applications?.withdrawn||0],
    [],
    ["Position","Candidate","Votes","Outcome","Candidate status"],
    ...(summary.positions||[]).flatMap(p=>(p.candidates||[]).map(c=>[p.title,c.name,c.votes,c.outcome||"",c.status||""])),
    [],
    ["Runoff position","Round","Status","Candidate","Votes","Runoff turnout"],
    ...(summary.runoffs||[]).flatMap(r=>(r.candidates||[]).map(c=>[
      r.position_title,r.round_no,r.status,c.name,c.votes,`${r.turnout?.voted||0}/${r.turnout?.eligible||0}`
    ])),
    [],
    ["Assigned EXCO role","Member","Member code","Term","Started"],
    ...(summary.assigned_exco_roles||[]).map(x=>[x.role_title,x.name,x.member_code||"",x.term||"",x.started_at||""])
  ];
  const csv=rows.map(r=>r.map(safeCsv).join(",")).join("\n");
  const filename=`election-${fileSlug(e.term||e.title||e.id)}-official-record.csv`;
  return sendExportToTelegram(new Blob([csv],{type:"text/csv;charset=utf-8"}),filename,`${e.title||"Election"} · Official election record CSV`);
}

export async function exportElectionPdf(summary){
  const e=summary?.election||{};
  const brand=await api.branding();
  const doc=new jsPDF({unit:"mm",format:"a4"});
  const ctx=createReport(doc,brand,"Election Record",`${e.title||"Election"}${e.term?` · ${e.term}`:""}`);

  reportMeta(ctx,[
    {label:"Status",value:"Certified"},
    {label:"Turnout",value:`${summary.turnout?.voted||0}/${summary.turnout?.eligible||0} · ${Number(summary.turnout?.percent||0).toFixed(1)}%`},
    {label:"Certified",value:fmtDate(e.certified_at)}
  ]);

  sectionTitle(ctx,"Governance timeline","Certified, read-only election record.");
  infoPanel(ctx,[
    ["Election",e.title||"-"],
    ["Term",e.term||"-"],
    ["Applications",`${fmtDate(e.applications_open_at)} - ${fmtDate(e.applications_close_at)}`],
    ["Voting",`${fmtDate(e.voting_open_at)} - ${fmtDate(e.voting_close_at)}`],
    ["Certified by",e.certified_by_name||"Super Admin"],
    ["Certified at",fmtDate(e.certified_at)]
  ]);

  sectionTitle(ctx,"Participation");
  summaryCards(ctx,[
    {label:"Applicants",value:summary.applications?.total||0,note:`${summary.applications?.approved||0} approved`},
    {label:"Candidates",value:summary.candidates?.active||0,note:`${summary.candidates?.withdrawn||0} withdrawn`},
    {label:"Votes submitted",value:summary.turnout?.voted||0,note:`${summary.turnout?.eligible||0} eligible`},
    {label:"Turnout",value:`${Number(summary.turnout?.percent||0).toFixed(1)}%`}
  ],2);

  sectionTitle(ctx,"Certified results");
  for(const p of summary.positions||[]){
    sectionTitle(ctx,p.title,`${p.seats} seat${Number(p.seats)===1?"":"s"}`,4);
    table(ctx,[
      {label:"Candidate",key:"name",width:82},
      {label:"Votes",key:"votes",width:28,align:"right"},
      {label:"Outcome",key:"outcome",width:44}
    ],p.candidates||[]);
  }

  if(summary.runoffs?.length){
    sectionTitle(ctx,"Runoff history");
    table(ctx,[
      {label:"Position",key:"position_title",width:55},
      {label:"Round",key:"round_no",width:20,align:"right"},
      {label:"Status",key:"status",width:30},
      {label:"Turnout",width:45,value:r=>`${r.turnout?.voted||0}/${r.turnout?.eligible||0}`}
    ],summary.runoffs);
  }

  if(summary.assigned_exco_roles?.length){
    sectionTitle(ctx,"Assigned EXCO");
    table(ctx,[
      {label:"Role",key:"role_title",width:60},
      {label:"Member",key:"name",width:70},
      {label:"Code",key:"member_code",width:30}
    ],summary.assigned_exco_roles);
  }

  sectionTitle(ctx,"Record integrity");
  infoPanel(ctx,[
    ["Record type","Certified election governance record"],
    ["Ballot identities","Not included"],
    ["Result state","Read-only after certification"]
  ]);
  addFooters(ctx);

  const blob=doc.output("blob");
  const filename=`election-${fileSlug(e.term||e.title||e.id)}-official-record.pdf`;
  return sendExportToTelegram(blob,filename,`${e.title||"Election"} · Official election record PDF`);
}
