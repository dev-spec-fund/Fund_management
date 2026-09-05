import type { Env } from "./types";
import { currentMonth, getSetting } from "./db";

export type ContributionRate = { amount:number; effective_from:string; effective_to?:string|null };

export type FirstMonthContributionRule = "full" | "half_after_15" | "next_month";

export function normalizeFirstMonthContributionRule(value:any): FirstMonthContributionRule {
  const rule=String(value||"").trim();
  return rule==="full" || rule==="next_month" ? rule : "half_after_15";
}

export async function firstMonthContributionRule(env:Env): Promise<FirstMonthContributionRule> {
  return normalizeFirstMonthContributionRule(await getSetting(env,"first_month_contribution_rule"));
}

export function contributionDueFromRate(
  baseRate:number,
  joinedAt:string|null|undefined,
  month:string,
  rule:FirstMonthContributionRule="half_after_15"
): number {
  const rate=Math.max(0,Number(baseRate||0));
  const joined=String(joinedAt||"").slice(0,10);
  const joinMonth=joined.slice(0,7);
  if(/^\d{4}-\d{2}$/.test(joinMonth)){
    if(month<joinMonth) return 0;
    if(month===joinMonth){
      if(rule==="next_month") return 0;
      if(rule==="half_after_15"){
        const day=Number(joined.slice(8,10));
        if(Number.isFinite(day) && day>15) return Number((rate/2).toFixed(2));
      }
    }
  }
  return Number(rate.toFixed(2));
}

export async function contributionDueForMonth(
  env:Env,
  memberId:number,
  month:string,
  fallback=0,
  joinedAt?:string|null
): Promise<number> {
  const [baseRate,rule,member]=await Promise.all([
    contributionRateForMonth(env,memberId,month,fallback),
    firstMonthContributionRule(env),
    joinedAt===undefined
      ? env.DB.prepare("SELECT joined_at,created_at FROM members WHERE id=?").bind(memberId).first<any>()
      : Promise.resolve(null)
  ]);
  const joined=joinedAt===undefined ? (member?.joined_at||member?.created_at||null) : joinedAt;
  return contributionDueFromRate(baseRate,joined,month,rule);
}


export async function contributionRateForMonth(env: Env, memberId:number, month:string, fallback=0): Promise<number> {
  const row=await env.DB.prepare(`SELECT amount FROM member_contribution_rates
    WHERE member_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY effective_from DESC LIMIT 1`).bind(memberId,month,month).first<any>();
  return Number(row?.amount ?? fallback ?? 0);
}

export function rateForMonthFromRows(rows:ContributionRate[], month:string, fallback=0):number {
  const match=rows.filter(r=>String(r.effective_from)<=month && (!r.effective_to || String(r.effective_to)>=month))
    .sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  return Number(match?.amount ?? fallback ?? 0);
}

export async function ensureInitialContributionRate(env:Env, memberId:number, amount:number, effectiveFrom?:string){
  const month=effectiveFrom || currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
  await env.DB.prepare(`INSERT OR IGNORE INTO member_contribution_rates(member_id,amount,effective_from)
    VALUES(?,?,?)`).bind(memberId,amount,month).run();
}

export async function setContributionRate(env:Env, memberId:number, amount:number, effectiveFrom:string, adminId?:number|null){
  const previous=await env.DB.prepare(`SELECT id,effective_from FROM member_contribution_rates
    WHERE member_id=? AND effective_from<? ORDER BY effective_from DESC LIMIT 1`).bind(memberId,effectiveFrom).first<any>();
  const next=await env.DB.prepare(`SELECT id,effective_from FROM member_contribution_rates
    WHERE member_id=? AND effective_from>? ORDER BY effective_from ASC LIMIT 1`).bind(memberId,effectiveFrom).first<any>();
  const endOfPrevious=(()=>{const [y,m]=effectiveFrom.split('-').map(Number);const d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);})();
  const endOfThis=next?(()=>{const [y,m]=String(next.effective_from).split('-').map(Number);const d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);})():null;
  const statements:any[]=[];
  if(previous) statements.push(env.DB.prepare("UPDATE member_contribution_rates SET effective_to=? WHERE id=?").bind(endOfPrevious,previous.id));
  statements.push(env.DB.prepare(`INSERT INTO member_contribution_rates(member_id,amount,effective_from,effective_to,created_by)
    VALUES(?,?,?,?,?) ON CONFLICT(member_id,effective_from) DO UPDATE SET amount=excluded.amount,effective_to=excluded.effective_to,created_by=excluded.created_by`)
    .bind(memberId,amount,effectiveFrom,endOfThis,adminId||null));
  await env.DB.batch(statements);
  const now=currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
  if(effectiveFrom<=now){
    const current=await contributionRateForMonth(env,memberId,now,amount);
    await env.DB.prepare("UPDATE members SET monthly_amount=? WHERE id=?").bind(current,memberId).run();
  }
}
