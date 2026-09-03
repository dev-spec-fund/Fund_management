import type { Env } from "./types";
import { safeLogError } from "./ops";
import { handleMessage } from "./bot/message";
import { handleCallback } from "./bot/callbacks";

export async function handleUpdate(env: Env, update: any) {
  try {
    if (update.message) return handleMessage(env, update.message);
    if (update.callback_query) return handleCallback(env, update.callback_query);
  } catch (e) {
    await safeLogError(env, "bot.handleUpdate", e, { update_id: update?.update_id });
    throw e;
  }
}
