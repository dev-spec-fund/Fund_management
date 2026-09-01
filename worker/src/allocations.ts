import type { Env } from "./types";
import { rateForMonthFromRows } from "./contributionRates";

export type Allocation = { month: string; amount: number; status_after: "paid" | "partial" };

export function nextMonth(month: string): string {
  const [y,m]=month.split("-").map(Number);
  const d=new Date(Date.UTC(y,m,1));
  return d.toISOString().slice(0,7);
}

/** Paid amount for a month. New contributions use allocations; historical rows fall back to contributions.month. */
export async function paidForMonth(env: Env, memberId: number, month: string): Promise<number> {
  const row=await env.DB.prepare(`
    SELECT COALESCE(SUM(amount),0) total FROM (
      SELECT ca.amount amount
      FROM contribution_allocations ca
      JOIN contributions c ON c.id=ca.contribution_id
      WHERE ca.member_id=? AND ca.month=? AND c.status='approved'
      UNION ALL
      SELECT c.amount amount
      FROM contributions c
      WHERE c.member_id=? AND c.month=? AND c.status='approved'
        AND NOT EXISTS (SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
    )
  `).bind(memberId,month,memberId,month).first<any>();
  return Number(row?.total||0);
}

/** Build a forward allocation plan without changing the database.
 * Exemptions, closures and existing paid totals are prefetched so a large
 * advance payment does not cause hundreds of sequential D1 queries.
 */
export async function buildAllocationPlan(env: Env, contribution: any): Promise<Allocation[]> {
  const member=await env.DB.prepare("SELECT id,monthly_amount FROM members WHERE id=?").bind(contribution.member_id).first<any>();
  if(!member) throw new Error("Member not found");
  const fallbackMonthly=Number(member.monthly_amount||0);
  if(!Number.isFinite(fallbackMonthly) || fallbackMonthly<=0) throw new Error("Member monthly contribution amount is invalid");

  let remaining=Number(contribution.amount||0);
  if(!Number.isFinite(remaining) || remaining<=0) throw new Error("Contribution amount is invalid");

  const months:string[]=[];
  let cursor=String(contribution.month);
  for(let i=0;i<120;i++){ months.push(cursor); cursor=nextMonth(cursor); }
  const lastMonth=months[months.length-1];

  const [exemptions, closures, paidRows, rateRows] = await Promise.all([
    env.DB.prepare("SELECT month FROM exemptions WHERE member_id=? AND month>=? AND month<=?")
      .bind(member.id,months[0],lastMonth).all<any>(),
    env.DB.prepare("SELECT month FROM month_closures WHERE month>=? AND month<=?")
      .bind(months[0],lastMonth).all<any>(),
    env.DB.prepare(`
      SELECT month,COALESCE(SUM(amount),0) paid FROM (
        SELECT ca.month month,ca.amount amount
        FROM contribution_allocations ca
        JOIN contributions c ON c.id=ca.contribution_id
        WHERE ca.member_id=? AND ca.month>=? AND ca.month<=? AND c.status='approved'
        UNION ALL
        SELECT c.month month,c.amount amount
        FROM contributions c
        WHERE c.member_id=? AND c.month>=? AND c.month<=? AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
      ) GROUP BY month
    `).bind(member.id,months[0],lastMonth,member.id,months[0],lastMonth).all<any>(),
    env.DB.prepare("SELECT amount,effective_from,effective_to FROM member_contribution_rates WHERE member_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from").bind(member.id,lastMonth,months[0]).all<any>()
  ]);

  const exemptSet=new Set(exemptions.results.map((r:any)=>String(r.month)));
  const closedSet=new Set(closures.results.map((r:any)=>String(r.month)));
  const paidMap=new Map(paidRows.results.map((r:any)=>[String(r.month),Number(r.paid||0)]));
  const plan:Allocation[]=[];

  for(const month of months){
    if(remaining<=0.004) break;
    if(exemptSet.has(month) || closedSet.has(month)) continue;
    const monthly=rateForMonthFromRows(rateRows.results as any[],month,fallbackMonthly);
    const already=Number(paidMap.get(month)||0);
    const needed=Math.max(0,monthly-already);
    if(needed<=0.004) continue;
    const amount=Math.min(remaining,needed);
    const after=already+amount;
    plan.push({month,amount:Number(amount.toFixed(2)),status_after:after+0.005>=monthly?"paid":"partial"});
    paidMap.set(month,after);
    remaining=Number((remaining-amount).toFixed(2));
  }
  if(remaining>0.004) throw new Error("Could not allocate the full contribution within 120 future months");
  return plan;
}

export async function approveWithAllocations(env: Env, contributionId: number, adminId: number) {
  const contribution=await env.DB.prepare("SELECT * FROM contributions WHERE id=?").bind(contributionId).first<any>();
  if(!contribution) throw new Error("Contribution not found");
  if(contribution.status!=="pending") throw new Error(`Already ${contribution.status}`);

  const plan=await buildAllocationPlan(env,contribution);
  const statements:any[]=[
    env.DB.prepare("UPDATE contributions SET status='approved',approved_by=?,approved_at=datetime('now'),ocr_raw=NULL WHERE id=? AND status='pending'").bind(adminId,contributionId),
    env.DB.prepare("DELETE FROM contribution_allocations WHERE contribution_id=?").bind(contributionId),
  ];
  for(const a of plan){
    statements.push(env.DB.prepare(`
      INSERT INTO contribution_allocations(contribution_id,member_id,month,amount)
      VALUES(?,?,?,?)
    `).bind(contributionId,contribution.member_id,a.month,a.amount));
  }
  const result=await env.DB.batch(statements);
  const changed=(result[0] as any)?.meta?.changes;
  if(!changed) throw new Error("Already reviewed");
  return {contribution,allocations:plan};
}

export function allocationReceipt(allocations: Allocation[]): string {
  return allocations.map(a=>`• ${a.month} — MVR ${a.amount.toFixed(2)} — ${a.status_after==="paid"?"Paid":"Partial"}`).join("\n");
}

export const allocatedPaidSql = `
  COALESCE((
    SELECT SUM(ca.amount)
    FROM contribution_allocations ca
    JOIN contributions ac ON ac.id=ca.contribution_id
    WHERE ca.member_id=m.id AND ca.month=? AND ac.status='approved'
  ),0)
  +
  COALESCE((
    SELECT SUM(lc.amount)
    FROM contributions lc
    WHERE lc.member_id=m.id AND lc.month=? AND lc.status='approved'
      AND NOT EXISTS (SELECT 1 FROM contribution_allocations lx WHERE lx.contribution_id=lc.id)
  ),0)
`;
