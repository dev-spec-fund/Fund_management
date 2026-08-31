import type { Env } from "./types";
import { sendMessage } from "./telegram";
import { currentDayOfMonth, currentMonth, getSetting } from "./db";
import { ensureOperationalSchema, isMonthClosed, safeLogError } from "./ops";

/** Runs daily and evaluates reminder dates in FUND_TIMEZONE (Indian/Maldives by default). */
export async function runScheduled(env: Env) {
  try {
    await ensureOperationalSchema(env);
    const reminderDay = await getSetting(env, "reminder_day");
    if (!reminderDay || reminderDay === "off") return;
    const timeZone = env.FUND_TIMEZONE || "Indian/Maldives";
    if (String(Number(currentDayOfMonth(timeZone))) !== String(Number(reminderDay))) return;
    const month = currentMonth(timeZone);
    if (await isMonthClosed(env, month)) return;

    const members = await env.DB.prepare(`
      SELECT m.*, COALESCE((
        SELECT SUM(c.amount) FROM contributions c
        WHERE c.member_id=m.id AND c.month=? AND c.status='approved'
      ),0) paid
      FROM members m
      WHERE m.active=1 AND m.telegram_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM exemptions e WHERE e.member_id=m.id AND e.month=?)
    `).bind(month,month).all<any>();

    for (const member of members.results) {
      const paid=Number(member.paid||0), due=Math.max(0,Number(member.monthly_amount||0)-paid);
      if (due <= 0.005) continue;
      const status=paid>0?"partially paid":"unpaid";
      await sendMessage(env,member.telegram_id,
        `🔔 Reminder: ${month} is ${status}. Paid: MVR ${paid}. Remaining: MVR ${due}. Send a bank slip photo to submit the balance.`
      );
    }
  } catch (e) {
    await safeLogError(env,"scheduled.reminders",e);
    throw e;
  }
}
