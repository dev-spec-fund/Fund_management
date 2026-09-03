import { api } from "../api";

export async function sendExportToTelegram(blob, filename, caption) {
  const result = await api.reports.sendDocument(blob, filename, caption);
  const message = `✅ ${result.filename || filename} sent to your Telegram chat.`;
  if (window.Telegram?.WebApp?.showAlert) window.Telegram.WebApp.showAlert(message);
  else alert(message);
  return result;
}

