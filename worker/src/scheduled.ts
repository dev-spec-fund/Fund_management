import type { Env } from "./types";
import { sendInBatches } from "./telegram";
import { currentDayOfMonth, currentMonth, getSetting } from "./db";
import { isMonthClosed, safeLogError } from "./ops";
import { allocatedPaidSql } from "./allocations";
import { contributionRateForMonth } from "./contributionRates";

/** Runs daily and evaluates reminder dates in FUND_TIMEZONE (Indian/Maldives by default). */
export async function runScheduled(env: Env) {
  try {
    const reminderDay = await getSetting(env, "reminder_day");
    if (!reminderDay || reminderDay === "off") return;
    const timeZone = env.FUND_TIMEZONE || "Indian/Maldives";
    if (String(Number(currentDayOfMonth(timeZone))) !== String(Number(reminderDay))) return;
    const month = currentMonth(timeZone);
    if (await isMonthClosed(env, month)) return;

    const members = await env.DB.prepare(`
      SELECT m.*, ${allocatedPaidSql} paid
      FROM members m
      WHERE m.active=1 AND m.telegram_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM exemptions e WHERE e.member_id=m.id AND e.month=?)
    `).bind(month,month,month).all<any>();

    const messages:any[]=[];
    for (const member of members.results as any[]) {
      const rate=await contributionRateForMonth(env,member.id,month,Number(member.monthly_amount||0));
      const paid=Number(member.paid||0), due=Math.max(0,rate-paid);
      if (due <= 0.005) continue;
      const status=paid>0?"partially paid":"unpaid";
      messages.push({chatId:member.telegram_id,text:`🔔 Reminder: ${month} is ${status}. Paid: MVR ${paid}. Remaining: MVR ${due}. Send a bank slip photo to submit the balance.`,context:{member_id:member.id}});
    }
    const result = await sendInBatches(env, messages, 6);
    for (const failure of result.failures) {
      await safeLogError(env,"scheduled.reminder_send",failure.error,failure.message.context);
    }
  } catch (e) {
    await safeLogError(env,"scheduled.reminders",e);
    throw e;
  }
}
