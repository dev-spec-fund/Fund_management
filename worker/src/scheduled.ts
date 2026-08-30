import type { Env } from "./types";
import { sendMessage } from "./telegram";
import { currentDayOfMonth, currentMonth, getSetting } from "./db";

/** Runs daily and evaluates reminder dates in FUND_TIMEZONE (Indian/Maldives by default). */
export async function runScheduled(env: Env) {
  const reminderDay = await getSetting(env, "reminder_day");
  if (!reminderDay || reminderDay === "off") return;

  const timeZone = env.FUND_TIMEZONE || "Indian/Maldives";
  if (String(Number(currentDayOfMonth(timeZone))) !== String(Number(reminderDay))) return;

  const month = currentMonth(timeZone);
  const unpaid = await env.DB.prepare(`
    SELECT m.* FROM members m
    WHERE m.active = 1
    AND m.telegram_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM contributions c
      WHERE c.member_id = m.id AND c.month = ? AND c.status = 'approved'
    )
    AND NOT EXISTS (
      SELECT 1 FROM exemptions e WHERE e.member_id = m.id AND e.month = ?
    )
  `).bind(month, month).all<any>();

  for (const member of unpaid.results) {
    await sendMessage(env, member.telegram_id,
      `🔔 Reminder: your MVR ${member.monthly_amount} contribution for ${month} hasn't been received yet. Send a slip photo to submit it.`
    );
  }
}
