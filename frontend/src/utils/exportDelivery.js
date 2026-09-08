import { api } from "../api";
import { showNotice } from "./systemDialogs";

export async function sendExportToTelegram(blob, filename, caption) {
  const result = await api.reports.sendDocument(blob, filename, caption);
  const message = `✅ ${result.filename || filename} sent to your Telegram chat.`;
  await showNotice({ title: "Export sent", message, buttonLabel: "Done" });
  return result;
}

