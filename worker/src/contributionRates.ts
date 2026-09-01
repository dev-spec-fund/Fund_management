import type { Env } from "./types";
import { currentMonth } from "./db";

export type ContributionRate = { amount:number; effective_from:string; effective_to?:string|null };

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
