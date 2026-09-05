import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireMemberOrAdmin } from "../auth";
import { logAudit, generateMemberCode, currentMonth, currentDate, getSetting, getBranding } from "../db";
import { auditEntity, ensureOperationalSchema, findDuplicateMembers, normalizeName, normalizePhone, requireOpenMonth } from "../ops";
import { boundedText, flag, money, telegramId, validMonth } from "../validation";
import { paidForMonth } from "../allocations";
import { contributionRateForMonth, contributionDueForMonth, contributionDueFromRate, firstMonthContributionRule, rateForMonthFromRows, setContributionRate, ensureInitialContributionRate } from "../contributionRates";
import { downloadTelegramFile, sendPhoto } from "../telegram";

export const membersRoute = new Hono<AppEnv>();

membersRoute.get("/", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!;
  const viewer=admin.role==='viewer';
  const rows = await c.env.DB.prepare(viewer
    ? `SELECT m.id,m.member_code,m.name,NULL phone,m.monthly_amount,m.active,m.joined_at,m.created_at,NULL telegram_id,
        (SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1) exco_role
       FROM members m ORDER BY m.name`
    : `SELECT m.id,m.member_code,m.name,m.phone,m.monthly_amount,m.active,m.joined_at,m.created_at,m.telegram_id,
        (SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1) exco_role
       FROM members m ORDER BY m.name`).all();
  return c.json(rows.results);
});

membersRoute.get("/:id", requireAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const id = c.req.param("id");
  const admin=c.get("admin")!;
  const viewer=admin.role==='viewer';
  const member = await c.env.DB.prepare(viewer
    ? `SELECT m.id,m.member_code,m.name,NULL phone,m.monthly_amount,m.active,m.joined_at,m.created_at,NULL telegram_id,
        (SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1) exco_role
       FROM members m WHERE m.id=?`
    : `SELECT m.id,m.member_code,m.name,m.phone,m.monthly_amount,m.active,m.joined_at,m.created_at,m.telegram_id,
        (SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1) exco_role
       FROM members m WHERE m.id=?`).bind(id).first();
  if (!member) return c.json({ error: "Not found" }, 404);
  const contributions = await c.env.DB.prepare(
    `SELECT id,txn_id,member_id,amount,month,${viewer?"NULL":"ref_number"} ref_number,status,approved_by,submitted_at,approved_at,${viewer?"NULL":"bank_date"} bank_date,corrected_by,corrected_at,voided_by,voided_at,void_reason
     FROM contributions WHERE member_id = ? ORDER BY month DESC, submitted_at DESC`
  ).bind(id).all();
  const excoHistory=await c.env.DB.prepare(`SELECT x.role_title,x.term,x.started_at,x.ended_at,e.title election_title
    FROM exco_role_assignments x JOIN elections e ON e.id=x.election_id WHERE x.member_id=? ORDER BY x.started_at DESC,x.id DESC`).bind(id).all<any>();
  return c.json({ ...member, contributions: contributions.results, exco_history:excoHistory.results });
});

membersRoute.get("/:id/monthly-status", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const month = c.req.query("month") || currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives");
  if (!validMonth(month)) return c.json({error:"Month must use YYYY-MM"},400);
  const member = await c.env.DB.prepare("SELECT id,monthly_amount,joined_at,created_at FROM members WHERE id=?").bind(id).first<any>();
  if (!member) return c.json({error:"Not found"},404);
  const ex = await c.env.DB.prepare("SELECT reason FROM exemptions WHERE member_id=? AND month=?").bind(id,month).first<any>();
  const total = await paidForMonth(c.env,id,month);
  const rate = await contributionDueForMonth(c.env,id,month,Number(member.monthly_amount),member.joined_at||member.created_at);
  const status = ex ? "exempt" : total <= 0 ? "unpaid" : total + 0.005 < rate ? "partial" : "paid";
  return c.json({month,status,paid:total,due:ex?0:Math.max(0,rate-total),monthly_amount:rate,exemption_reason:ex?.reason||null});
});

membersRoute.get("/:id/statement", requireMemberOrAdmin, async (c) => {
  await ensureOperationalSchema(c.env);
  const id = Number(c.req.param("id"));
  const admin=c.get("admin");
  const user=c.get("telegramUser");
  if (!admin) {
    const own=await c.env.DB.prepare("SELECT id FROM members WHERE id=? AND telegram_id=? AND active=1 LIMIT 1")
      .bind(id,String(user?.id||"")).first<any>();
    if(!own) return c.json({error:"You can only export your own statement"},403);
  }
  const viewer=admin?.role==='viewer';
  const member = await c.env.DB.prepare(viewer
    ? `SELECT m.id,m.member_code,m.name,NULL phone,m.monthly_amount,m.active,m.joined_at,m.created_at,NULL telegram_id,
        COALESCE((SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1),'Member') exco_role
       FROM members m WHERE m.id=?`
    : `SELECT m.id,m.member_code,m.name,m.phone,m.monthly_amount,m.active,m.joined_at,m.created_at,m.telegram_id,
        COALESCE((SELECT x.role_title FROM exco_role_assignments x WHERE x.member_id=m.id AND x.ended_at IS NULL ORDER BY x.id DESC LIMIT 1),'Member') exco_role
       FROM members m WHERE m.id=?`).bind(id).first<any>();
  if (!member) return c.json({error:"Not found"},404);
  const contributions = await c.env.DB.prepare(`SELECT id,txn_id,amount,month,${viewer?"NULL":"ref_number"} ref_number,status,submitted_at,approved_at,${viewer?"0":"CASE WHEN slip_file_id IS NOT NULL AND trim(slip_file_id)<>'' THEN 1 ELSE 0 END"} has_slip FROM contributions WHERE member_id=? ORDER BY submitted_at`).bind(id).all<any>();
  const allocations = await c.env.DB.prepare(`
    SELECT ca.id,ca.contribution_id,ca.month,ca.amount
    FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
    WHERE ca.member_id=? AND c.status='approved' ORDER BY ca.month,ca.id
  `).bind(id).all<any>();
  const integrityAllocations = await c.env.DB.prepare(`
    SELECT ca.id,ca.contribution_id,ca.member_id,ca.month,ca.amount,c.status contribution_status,c.amount contribution_amount,c.month contribution_month
    FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
    WHERE ca.member_id=? ORDER BY ca.contribution_id,ca.month,ca.id
  `).bind(id).all<any>();
  const exemptions = await c.env.DB.prepare("SELECT month,reason,created_at FROM exemptions WHERE member_id=? ORDER BY month").bind(id).all<any>();
  const rates = await c.env.DB.prepare("SELECT amount,effective_from,effective_to,created_at FROM member_contribution_rates WHERE member_id=? ORDER BY effective_from").bind(id).all<any>();
  const donations = await c.env.DB.prepare(`SELECT txn_id,donor_name,amount,note,transaction_month,status,created_at FROM donations
    WHERE COALESCE(status,'active')='active' AND member_id=? ORDER BY created_at`).bind(id).all<any>();
  const approved = contributions.results.filter((x:any)=>x.status==='approved');
  const balanceItems=[...approved.map((r:any)=>({at:r.approved_at||r.submitted_at,txn_id:r.txn_id,amount:Number(r.amount||0),kind:'contribution'})),...donations.results.map((r:any)=>({at:r.created_at,txn_id:r.txn_id,amount:Number(r.amount||0),kind:'donation'}))].sort((a:any,b:any)=>String(a.at).localeCompare(String(b.at)));
  const balanceHistory:any[]=[];
  let running=0;
  for (const r of balanceItems) { running += Number(r.amount||0); balanceHistory.push({...r,balance:running}); }
  const firstMonth = member.joined_at?.slice(0,7) || currentMonth(c.env.FUND_TIMEZONE || 'Indian/Maldives');
  const nowMonth = currentMonth(c.env.FUND_TIMEZONE || 'Indian/Maldives');
  const latestAllocatedMonth=(allocations.results as any[]).reduce((latest:any,row:any)=>{
    const month=String(row.month||'');
    return /^\d{4}-\d{2}$/.test(month) && month>latest ? month : latest;
  },nowMonth);
  const statusEndMonth=latestAllocatedMonth>nowMonth?latestAllocatedMonth:nowMonth;
  const months:string[]=[]; let [y,m]=firstMonth.split('-').map(Number); const [ey,em]=statusEndMonth.split('-').map(Number);
  while (y<ey || (y===ey && m<=em)) { months.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} }
  const exSet = new Map(exemptions.results.map((x:any)=>[x.month,x]));
  const allocationMap=new Map<string,number>();
  for(const a of allocations.results) allocationMap.set(a.month,(allocationMap.get(a.month)||0)+Number(a.amount||0));
  // Historical approved transactions without allocation rows keep their original month.
  for(const x of approved){
    const hasAllocation=allocations.results.some((a:any)=>Number(a.contribution_id)===Number(x.id));
    if(!hasAllocation) allocationMap.set(x.month,(allocationMap.get(x.month)||0)+Number(x.amount||0));
  }
  const firstMonthRule=await firstMonthContributionRule(c.env);
  member.monthly_amount=rateForMonthFromRows(rates.results as any[],nowMonth,Number(member.monthly_amount));
  const statuses = months.map(month=>{
    const paid=allocationMap.get(month)||0;
    const ex=exSet.get(month) as any;
    const baseRate=rateForMonthFromRows(rates.results as any[],month,Number(member.monthly_amount));
    const rate=contributionDueFromRate(baseRate,member.joined_at||member.created_at,month,firstMonthRule);
    const isAdvance=month>nowMonth;
    const status=ex?'exempt':rate<=0.004?'not_applicable':paid<=0?'unpaid':paid+0.005<rate?'partial':'paid';
    return {month,status,paid,due:ex?0:Math.max(0,rate-paid),monthly_amount:rate,reason:ex?.reason||null,advance:isAdvance};
  });

  // Reconcile approved cash against allocation rows and the effective monthly
  // status ledger. Legacy approved rows without allocation records continue to
  // use their original contribution month, but are explicitly reported so they
  // can be identified without making the member statement mathematically wrong.
  const money2=(value:any)=>Math.round(Number(value||0)*100)/100;
  const approvedTotal=money2(approved.reduce((sum:any,x:any)=>sum+Number(x.amount||0),0));
  const actualAllocatedTotal=money2((allocations.results as any[]).reduce((sum:any,x:any)=>sum+Number(x.amount||0),0));
  const perContribution=(approved as any[]).map((contribution:any)=>{
    const rows=(allocations.results as any[]).filter((a:any)=>Number(a.contribution_id)===Number(contribution.id));
    const allocated=money2(rows.reduce((sum:any,a:any)=>sum+Number(a.amount||0),0));
    const amount=money2(contribution.amount);
    const legacyFallback=rows.length===0;
    const effectiveAllocated=legacyFallback?amount:allocated;
    const difference=money2(amount-effectiveAllocated);
    return {
      contribution_id:contribution.id,
      txn_id:contribution.txn_id,
      amount,
      allocated,
      effective_allocated:effectiveAllocated,
      difference,
      allocation_rows:rows.length,
      legacy_fallback:legacyFallback,
      ok:Math.abs(difference)<0.005
    };
  });
  const legacyFallbackTotal=money2(perContribution.filter((x:any)=>x.legacy_fallback).reduce((sum:any,x:any)=>sum+x.amount,0));
  const effectiveAllocatedTotal=money2(perContribution.reduce((sum:any,x:any)=>sum+x.effective_allocated,0));
  const statusPaidTotal=money2(statuses.reduce((sum:any,x:any)=>sum+Number(x.paid||0),0));
  const unallocatedTotal=money2(Math.max(0,approvedTotal-effectiveAllocatedTotal));
  const overallocatedTotal=money2(Math.max(0,effectiveAllocatedTotal-approvedTotal));
  const issues:any[]=[];

  for(const item of perContribution){
    if(item.legacy_fallback)issues.push({
      severity:'warning',code:'legacy_missing_allocation_rows',contribution_id:item.contribution_id,txn_id:item.txn_id,
      message:`${item.txn_id||'Approved contribution'} has no allocation rows; its original month is being used as a legacy fallback.`
    });
    else if(item.difference>0.004)issues.push({
      severity:'error',code:'contribution_underallocated',contribution_id:item.contribution_id,txn_id:item.txn_id,
      amount:item.difference,message:`${item.txn_id||'Approved contribution'} has MVR ${item.difference.toFixed(2)} not allocated to a month.`
    });
    else if(item.difference<-0.004)issues.push({
      severity:'error',code:'contribution_overallocated',contribution_id:item.contribution_id,txn_id:item.txn_id,
      amount:Math.abs(item.difference),message:`${item.txn_id||'Approved contribution'} is allocated above its approved amount by MVR ${Math.abs(item.difference).toFixed(2)}.`
    });
  }

  for(const row of integrityAllocations.results as any[]){
    if(String(row.contribution_status)!=='approved')issues.push({
      severity:'error',code:'allocation_on_nonapproved_contribution',contribution_id:row.contribution_id,allocation_id:row.id,
      message:`Allocation ${row.id} is attached to a ${row.contribution_status||'non-approved'} contribution.`
    });
    if(String(row.month)<firstMonth)issues.push({
      severity:'error',code:'allocation_before_membership',contribution_id:row.contribution_id,allocation_id:row.id,
      message:`Allocation ${row.id} is dated before the member joined.`
    });
  }

  if(Math.abs(statusPaidTotal-effectiveAllocatedTotal)>0.004)issues.push({
    severity:'error',code:'monthly_status_mismatch',
    message:`Monthly status totals differ from effective contribution allocations by MVR ${Math.abs(statusPaidTotal-effectiveAllocatedTotal).toFixed(2)}.`
  });

  const reconciliation={
    ok:!issues.some((x:any)=>x.severity==='error'),
    approved_total:approvedTotal,
    actual_allocated_total:actualAllocatedTotal,
    legacy_fallback_total:legacyFallbackTotal,
    effective_allocated_total:effectiveAllocatedTotal,
    monthly_status_paid_total:statusPaidTotal,
    unallocated_total:unallocatedTotal,
    overallocated_total:overallocatedTotal,
    current_due_total:money2(statuses.filter((x:any)=>!x.advance).reduce((sum:any,x:any)=>sum+Number(x.due||0),0)),
    advance_allocated_total:money2(statuses.filter((x:any)=>x.advance).reduce((sum:any,x:any)=>sum+Number(x.paid||0),0)),
    issues,
    contributions:perContribution
  };

  const organization=await getBranding(c.env);
  return c.json({organization,member,contributions:contributions.results,allocations:allocations.results,donations:donations.results,monthly_status:statuses,balance_history:balanceHistory,contribution_rates:rates.results,reconciliation});
});

membersRoute.get("/:id/contributions/:contributionId/slip/file", requireFinance, async (c) => {
  await ensureOperationalSchema(c.env);
  const memberId=Number(c.req.param("id")); const contributionId=Number(c.req.param("contributionId"));
  if(!Number.isInteger(memberId)||memberId<=0||!Number.isInteger(contributionId)||contributionId<=0) return c.json({error:"Invalid contribution"},400);
  const contribution=await c.env.DB.prepare("SELECT id,txn_id,slip_file_id FROM contributions WHERE id=? AND member_id=?").bind(contributionId,memberId).first<any>();
  if(!contribution)return c.json({error:"Contribution not found"},404);
  if(!contribution.slip_file_id)return c.json({error:"No payment slip is attached to this contribution"},404);
  const file=await downloadTelegramFile(c.env,String(contribution.slip_file_id));
  if(!file)return c.json({error:"Could not retrieve the payment slip from Telegram"},502);
  const ext=file.mime==="image/png"?"png":file.mime==="image/webp"?"webp":file.mime==="application/pdf"?"pdf":"jpg";
  const filename=`${String(contribution.txn_id||`contribution-${contributionId}`).replace(/[^A-Za-z0-9._-]+/g,"-")}-payment-slip.${ext}`;
  return new Response(file.bytes,{headers:{"Content-Type":file.mime,"Content-Disposition":`inline; filename="${filename}"`,"Cache-Control":"private, no-store"}});
});

membersRoute.post("/:id/contributions/:contributionId/slip/send-to-telegram", requireFinance, async (c) => {
  await ensureOperationalSchema(c.env);
  const admin=c.get("admin")!; const memberId=Number(c.req.param("id")); const contributionId=Number(c.req.param("contributionId"));
  const contribution=await c.env.DB.prepare(`SELECT c.id,c.txn_id,c.amount,c.slip_file_id,m.name member_name FROM contributions c JOIN members m ON m.id=c.member_id WHERE c.id=? AND c.member_id=?`).bind(contributionId,memberId).first<any>();
  if(!contribution)return c.json({error:"Contribution not found"},404);
  if(!contribution.slip_file_id)return c.json({error:"No payment slip is attached to this contribution"},404);
  const sent=await sendPhoto(c.env,admin.telegram_id,String(contribution.slip_file_id),`Payment slip · ${contribution.txn_id} · ${contribution.member_name} · MVR ${Number(contribution.amount||0).toFixed(2)}`);
  if(!sent)return c.json({error:"Could not send the payment slip to Telegram"},502);
  await auditEntity(c.env,admin.id,"contribution_slip_sent_to_telegram","contribution",contributionId,null,{member_id:memberId,txn_id:contribution.txn_id});
  return c.json({ok:true});
});

membersRoute.post("/", requireFinance, async (c) => {
  const admin = c.get("admin")!;
  const body = await c.req.json<any>();
  const name=boundedText(body.name,120,true); const phone=boundedText(body.phone,40);
  const configuredDefault=Number(await getSetting(c.env,'default_monthly_amount')) || 250;
  const monthly=money(body.monthly_amount === undefined || body.monthly_amount === '' ? configuredDefault : body.monthly_amount,1000000);
  const tg=body.telegram_id ? telegramId(body.telegram_id) : null;
  if(!name || monthly===null || (body.telegram_id && !tg)) return c.json({error:"Invalid member data"},400);
  const duplicates = await findDuplicateMembers(c.env, name, phone, tg);
  if (duplicates.length) return c.json({error:"Possible duplicate member",duplicates},409);
  const memberCode = await generateMemberCode(c.env);
  const res = await c.env.DB.prepare(
    "INSERT INTO members (member_code, telegram_id, name, phone, monthly_amount, normalized_name, normalized_phone, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(memberCode, tg, name, phone || null, monthly, normalizeName(name), normalizePhone(phone)||null,currentDate(c.env.FUND_TIMEZONE || "Indian/Maldives")).run();
  await ensureInitialContributionRate(c.env,Number(res.meta.last_row_id),monthly,currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives"));
  await auditEntity(c.env, admin.id, "member_created", "member", Number(res.meta.last_row_id), null, {member_code:memberCode,...body});
  return c.json({ id: res.meta.last_row_id, member_code: memberCode }, 201);
});

membersRoute.patch("/:id", requireFinance, async (c) => {
  const admin = c.get("admin")!; const id = Number(c.req.param("id"));
  const body = await c.req.json<any>();
  const before = await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<any>();
  if (!before) return c.json({ error: "Not found" }, 404);
  const name=boundedText(body.name ?? before.name,120,true); const phone=boundedText(body.phone ?? before.phone,40); const monthly=money(body.monthly_amount ?? before.monthly_amount,1000000); const active=body.active===undefined?Number(before.active):flag(body.active); const tg=body.telegram_id===undefined?before.telegram_id:(body.telegram_id===null||body.telegram_id===''?null:telegramId(body.telegram_id));
  if(!name || monthly===null || active===null || (body.telegram_id && !tg)) return c.json({error:"Invalid member data"},400);
  const duplicates = await findDuplicateMembers(c.env, name, phone, tg, id);
  if (duplicates.length) return c.json({error:"Possible duplicate member",duplicates},409);
  if (Number(before.active)===1 && Number(active)===0 && before.telegram_id) {
    const activeAdmin = await c.env.DB.prepare("SELECT id,role FROM admins WHERE telegram_id=? AND COALESCE(active,1)=1 LIMIT 1")
      .bind(String(before.telegram_id)).first<any>();
    if (activeAdmin) return c.json({
      error:"This member still has active admin access. Deactivate/remove their admin account in Settings before deactivating the member.",
      code:"MEMBER_HAS_ACTIVE_ADMIN",
      admin_id:activeAdmin.id,
      admin_role:activeAdmin.role
    },409);
  }
  if (Number(before.active)===1 && Number(active)===0) {
    const activeExco = await c.env.DB.prepare("SELECT id,role_title,term FROM exco_role_assignments WHERE member_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
      .bind(id).first<any>();
    if (activeExco) return c.json({
      error:"This member still holds a current EXCO role. End or replace that EXCO assignment before deactivating the member.",
      code:"MEMBER_HAS_ACTIVE_EXCO_ROLE",
      exco_assignment_id:activeExco.id,
      exco_role:activeExco.role_title,
      exco_term:activeExco.term||null
    },409);
  }
  const monthlyChanged=Number(monthly)!==Number(before.monthly_amount);
  const effective=monthlyChanged?currentMonth(c.env.FUND_TIMEZONE || "Indian/Maldives"):null;
  if(monthlyChanged){
    try{await requireOpenMonth(c.env,effective!);}catch(e:any){return c.json({error:e.message},409);}
  }
  await c.env.DB.prepare("UPDATE members SET name=?,phone=?,active=?,telegram_id=?,normalized_name=?,normalized_phone=? WHERE id=?")
    .bind(name,phone||null,active,tg,normalizeName(name),normalizePhone(phone)||null,id).run();
  if (monthlyChanged) await setContributionRate(c.env,id,Number(monthly),effective!,admin.id);
  const after = await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(id).first<any>();
  await auditEntity(c.env,admin.id,body.active!==undefined&&body.active!==before.active?(body.active?"member_reactivated":"member_deactivated"):"member_updated","member",id,before,after);
  return c.json({ok:true});
});

membersRoute.get("/:id/contribution-rates", requireMemberOrAdmin, async (c) => {
  const id=Number(c.req.param("id")); const admin=c.get("admin"); const user=c.get("telegramUser");
  if(!admin){ const own=await c.env.DB.prepare("SELECT id FROM members WHERE id=? AND telegram_id=? AND active=1").bind(id,String(user?.id||"")).first<any>(); if(!own)return c.json({error:"You can only view your own contribution rates"},403); }
  const rows=await c.env.DB.prepare("SELECT id,amount,effective_from,effective_to,created_at FROM member_contribution_rates WHERE member_id=? ORDER BY effective_from DESC").bind(id).all<any>();
  return c.json(rows.results);
});

membersRoute.post("/:id/contribution-rates", requireFinance, async (c) => {
  const admin=c.get("admin")!; const id=Number(c.req.param("id")); const body=await c.req.json<any>();
  const amount=money(body.amount,1000000); const effective=String(body.effective_from||"");
  if(!amount || !validMonth(effective)) return c.json({error:"Valid amount and effective month are required"},400);
  const member=await c.env.DB.prepare("SELECT * FROM members WHERE id=?").bind(id).first<any>(); if(!member)return c.json({error:"Member not found"},404);
  const latestClosed=await c.env.DB.prepare("SELECT month FROM month_closures ORDER BY month DESC LIMIT 1").first<any>();
  if(latestClosed?.month && effective<=String(latestClosed.month)) return c.json({error:`Contribution rate must start after the latest closed month (${latestClosed.month})`},409);
  await setContributionRate(c.env,id,amount,effective,admin.id);
  await auditEntity(c.env,admin.id,"member_contribution_rate_changed","member",id,{monthly_amount:member.monthly_amount},{monthly_amount:amount,effective_from:effective});
  return c.json({ok:true,rates:(await c.env.DB.prepare("SELECT id,amount,effective_from,effective_to,created_at FROM member_contribution_rates WHERE member_id=? ORDER BY effective_from DESC").bind(id).all<any>()).results});
});

membersRoute.post("/:id/exempt", requireFinance, async (c) => {
  const admin = c.get("admin")!; const id = Number(c.req.param("id"));
  const body = await c.req.json<{ month: string; reason?: string }>();
  if(!Number.isInteger(id) || id<=0) return c.json({error:"Invalid member"},400);
  if(!validMonth(body.month)) return c.json({error:"Month must use YYYY-MM"},400);
  const member=await c.env.DB.prepare("SELECT id FROM members WHERE id=?").bind(id).first();
  if(!member) return c.json({error:"Member not found"},404);
  const reason=boundedText(body.reason,500);
  try { await requireOpenMonth(c.env,body.month); } catch(e:any){ return c.json({error:e.message},409); }
  const allocated=await c.env.DB.prepare(`SELECT COALESCE(SUM(ca.amount),0) paid
    FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
    WHERE ca.member_id=? AND ca.month=? AND c.status='approved'`).bind(id,body.month).first<any>();
  if(Number(allocated?.paid||0)>0.004) return c.json({
    error:"This month already has an approved contribution payment allocated to it. Remove/reverse the payment before granting an exemption.",
    code:"EXEMPTION_HAS_PAYMENT"
  },409);
  await c.env.DB.prepare("INSERT OR REPLACE INTO exemptions (member_id,month,reason,granted_by) VALUES (?,?,?,?)")
    .bind(id,body.month,reason||null,admin.id).run();
  await logAudit(c.env,admin.id,"member_exempted",`Member #${id} — ${body.month} — ${reason||''}`);
  return c.json({ok:true});
});
