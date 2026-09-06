import type { Env } from "./types";
import { sendInBatches } from "./telegram";
import { currentDayOfMonth, currentMonth, getSetting, getBranding } from "./db";
import { isMonthClosed, safeLogError } from "./ops";
import { allocatedPaidSql } from "./allocations";
import { contributionDueForMonth } from "./contributionRates";
import { cleanupContributionReviewMessages } from "./contributionReviewMessages";
import { processElectionLifecycle } from "./elections/core";

/** Runs scheduled jobs. Contribution due reminders are sent once per month on the configured reminder_day in FUND_TIMEZONE. */
export async function runScheduled(env: Env, cron = "0 19 * * *") {
  try {
    // Governance lifecycle runs independently from contribution reminder settings.
    await processElectionLifecycle(env).catch((e)=>safeLogError(env,"scheduled.election_lifecycle",e));
    // Best-effort retention cleanup; never block financial/reminder processing.
    await cleanupContributionReviewMessages(env,180).catch((e)=>safeLogError(env,"scheduled.review_message_cleanup",e));
    // Keep contribution reminders on the original once-daily cron. The hourly
    // trigger exists only so election application/voting lifecycle is timely.
    if(cron !== "0 19 * * *") return;
    const reminderDay = (await getSetting(env, "reminder_day")) || "5";
    if (reminderDay === "off") return;
    const timeZone = env.FUND_TIMEZONE || "Indian/Maldives";
    if (String(Number(currentDayOfMonth(timeZone))) !== String(Number(reminderDay))) return;
    const month = currentMonth(timeZone);
    if (await isMonthClosed(env, month)) return;

    // Claim this month before sending so a retried/overlapping daily cron cannot
    // send the same monthly contribution reminder twice. Manual reminders remain
    // available from Settings/Members when an administrator intentionally wants
    // to send another message.
    const claim = await env.DB.prepare(`
      INSERT INTO settings(key,value) VALUES('reminder_last_sent_month',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE settings.value<>excluded.value
    `).bind(month).run();
    if (!claim.meta.changes) return;

    const branding = await getBranding(env);
    const members = await env.DB.prepare(`
      SELECT m.*, ${allocatedPaidSql} paid
      FROM members m
      WHERE m.active=1 AND m.telegram_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM exemptions e WHERE e.member_id=m.id AND e.month=?)
    `).bind(month,month,month).all<any>();

    const messages:any[]=[];
    for (const member of members.results as any[]) {
      const rate=await contributionDueForMonth(env,member.id,month,Number(member.monthly_amount||0),member.joined_at||member.created_at);
      const paid=Number(member.paid||0), due=Math.max(0,rate-paid);
      if (due <= 0.005) continue;
      const status=paid>0?"partially paid":"unpaid";
      messages.push({chatId:member.telegram_id,text:`🔔 <b>${branding.fund_name}</b> contribution reminder\n\n${month} is ${status}. Paid: MVR ${paid}. Remaining: MVR ${due}. Send a bank slip photo to submit the balance.`,context:{member_id:member.id}});
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
