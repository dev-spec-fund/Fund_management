import type { Env } from "./types";
import { safeLogError } from "./ops";
import { handleMessage } from "./bot/message";
import { handleCallback } from "./bot/callbacks";

export async function claimTelegramUpdate(env: Env, updateId: number) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) return true;

  const claimed = await env.DB.prepare(`
    INSERT INTO telegram_update_receipts(update_id,status,claimed_at,attempts,last_error)
    VALUES(?,'processing',datetime('now'),1,NULL)
    ON CONFLICT(update_id) DO UPDATE SET
      status='processing',
      claimed_at=datetime('now'),
      completed_at=NULL,
      attempts=telegram_update_receipts.attempts+1,
      last_error=NULL
    WHERE telegram_update_receipts.status='failed'
       OR (
         telegram_update_receipts.status='processing'
         AND telegram_update_receipts.claimed_at < datetime('now','-5 minutes')
       )
    RETURNING update_id
  `).bind(updateId).first<{update_id:number}>();

  // Keep the receipt table bounded without adding work to every webhook.
  if (Math.random() < 0.01) {
    await env.DB.prepare(`
      DELETE FROM telegram_update_receipts
      WHERE status IN ('completed','failed')
        AND claimed_at < datetime('now','-14 days')
    `).run().catch(() => {});
  }

  return !!claimed;
}

export async function completeTelegramUpdate(env: Env, updateId: number) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) return;
  await env.DB.prepare(`
    UPDATE telegram_update_receipts
    SET status='completed',completed_at=datetime('now'),last_error=NULL
    WHERE update_id=? AND status='processing'
  `).bind(updateId).run();
}

export async function failTelegramUpdate(env: Env, updateId: number, error: unknown) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) return;
  const message=(error instanceof Error ? error.message : String(error || 'processing failed')).slice(0,500);
  await env.DB.prepare(`
    UPDATE telegram_update_receipts
    SET status='failed',completed_at=NULL,last_error=?
    WHERE update_id=? AND status='processing'
  `).bind(message,updateId).run();
}

export async function handleUpdate(env: Env, update: any) {
  try {
    if (update.message) return handleMessage(env, update.message);
    if (update.callback_query) return handleCallback(env, update.callback_query);
  } catch (e) {
    await safeLogError(env, "bot.handleUpdate", e, { update_id: update?.update_id });
    throw e;
  }
}
