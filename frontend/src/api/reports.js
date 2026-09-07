import { request, upload } from "./client";

export const reportsApi = {
  activity: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const qs = params.toString();
    return request(`/api/reports/activity${qs ? `?${qs}` : ""}`);
  },
  summary: (month) => request(`/api/reports/summary${month ? `?month=${month}` : ""}`),
  overview: (month) => request(`/api/reports/overview${month ? `?month=${month}` : ""}`),
  publicSummary: (month) => request(`/api/reports/public-summary${month ? `?month=${month}` : ""}`),
  publicExpenses: (month, categoryId) => request(`/api/reports/public-expenses?month=${encodeURIComponent(month)}&category_id=${encodeURIComponent(categoryId)}`),
  trend: (month) => request(`/api/reports/trend${month ? `?month=${month}` : ""}`),
  sendDocument: (blob, filename, caption = "") => {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("filename", filename);
    if (caption) form.append("caption", caption);
    return upload("/api/reports/send-document", form);
  },
};
