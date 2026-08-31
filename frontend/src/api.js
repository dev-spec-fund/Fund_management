// Set VITE_API_BASE to the deployed Worker URL (see frontend/.env.example).
// Do not silently fall back to a placeholder: a missing value should fail clearly.
const configuredApiBase = String(import.meta.env.VITE_API_BASE || "").trim();
export const API_BASE = configuredApiBase.replace(/\/+$/, "");

function apiUrl(path) {
  if (!API_BASE) {
    throw new Error("Frontend API is not configured. Set VITE_API_BASE to your deployed Worker URL.");
  }
  return `${API_BASE}${path}`;
}

function initData() {
  return window.Telegram?.WebApp?.initData || "";
}

const GET_CACHE_TTL_MS = 20_000;
const responseCache = new Map();
const inFlightGets = new Map();

function clearGetCache() {
  responseCache.clear();
}

function cacheKey(path) {
  return `${initData()}::${path}`;
}

async function request(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const key = isGet ? cacheKey(path) : null;

  if (isGet) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) responseCache.delete(key);
    const pending = inFlightGets.get(key);
    if (pending) return pending;
  }

  const run = async () => {
    const res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData(),
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    const data = await res.json();
    if (isGet) responseCache.set(key, { data, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    else clearGetCache();
    return data;
  };

  if (!isGet) return run();
  const promise = run().finally(() => inFlightGets.delete(key));
  inFlightGets.set(key, promise);
  return promise;
}

async function upload(path, formData) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "X-Telegram-Init-Data": initData() },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  clearGetCache();
  return data;
}

export const api = {
  me: () => request("/api/me"),
  myContributions: () => request("/api/me/contributions"),

  members: {
    list: () => request("/api/members"),
    get: (id) => request(`/api/members/${id}`),
    create: (data) => request("/api/members", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    exempt: (id, month, reason) =>
      request(`/api/members/${id}/exempt`, { method: "POST", body: JSON.stringify({ month, reason }) }),
    statement: (id) => request(`/api/members/${id}/statement`),
    monthlyStatus: (id, month) => request(`/api/members/${id}/monthly-status${month ? `?month=${month}` : ""}`),
  },

  expenses: {
    list: () => request("/api/expenses"),
    create: (data) => request("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id, reason) => request(`/api/expenses/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    approve: (id) => request(`/api/expenses/${id}/approve`, { method: "POST" }),
    reject: (id) => request(`/api/expenses/${id}/reject`, { method: "POST" }),
    categories: () => request("/api/expenses/categories"),
    addCategory: (name) => request("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name }) }),
    updateCategory: (id, data) => request(`/api/expenses/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeCategory: (id) => request(`/api/expenses/categories/${id}`, { method: "DELETE" }),
  },

  donations: {
    list: () => request("/api/donations"),
    create: (data) => request("/api/donations", { method: "POST", body: JSON.stringify(data) }),
    remove: (id, reason) => request(`/api/donations/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
  },

  reports: {
    activity: () => request("/api/reports/activity"),
    summary: (month) => request(`/api/reports/summary${month ? `?month=${month}` : ""}`),
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
  },

  settings: {
    get: () => request("/api/settings"),
    update: (data) => request("/api/settings", { method: "PATCH", body: JSON.stringify(data) }),
    admins: () => request("/api/settings/admins"),
    addAdmin: (data) => request("/api/settings/admins", { method: "POST", body: JSON.stringify(data) }),
    promoteMember: (member_id, role) => request("/api/settings/admins/promote-member", { method: "POST", body: JSON.stringify({ member_id, role }) }),
    demoteMember: (id) => request(`/api/settings/admins/${id}/demote-member`, { method: "POST" }),
    removeAdmin: (id) => request(`/api/settings/admins/${id}`, { method: "DELETE" }),
    updateAdmin: (id, data) => request(`/api/settings/admins/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    auditLog: () => request("/api/settings/audit-log"),
  },

  admin: {
    pending: () => request("/api/admin/pending"),
    sendPaymentReminders: (data = {}) => request("/api/admin/payment-reminders", { method: "POST", body: JSON.stringify(data) }),
    meetings: () => request("/api/admin/meetings"),
    meeting: (id) => request(`/api/admin/meetings/${id}`),
    createMeeting: (data) => request("/api/admin/meetings", { method: "POST", body: JSON.stringify(data) }),
    updateMeeting: (id, data) => request(`/api/admin/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    cancelMeeting: (id, reason = "") => request(`/api/admin/meetings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
    sendMeetingInvites: (id) => request(`/api/admin/meetings/${id}/send`, { method: "POST" }),
    notifyMeetingUpdate: (id, data = {}) => request(`/api/admin/meetings/${id}/notify-update`, { method: "POST", body: JSON.stringify(data) }),
    remindMeetingPending: (id) => request(`/api/admin/meetings/${id}/remind-pending`, { method: "POST" }),
    approveRegistration: (id, member_id) => request(`/api/admin/pending/registrations/${id}/approve`, { method: "POST", body: JSON.stringify({ member_id }) }),
    rejectRegistration: (id, reason) => request(`/api/admin/pending/registrations/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    correctContribution: (id, data) => request(`/api/admin/pending/contributions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    approveContribution: (id) => request(`/api/admin/pending/contributions/${id}/approve`, { method: "POST" }),
    rejectContribution: (id, reason) => request(`/api/admin/pending/contributions/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    health: () => request("/api/admin/health"),
    errors: () => request("/api/admin/errors"),
    resolveError: (id) => request(`/api/admin/errors/${id}/resolve`, { method: "POST" }),
    resolveAllErrors: () => request("/api/admin/errors/resolve-all", { method: "POST" }),
    monthClosures: () => request("/api/admin/month-close"),
    closeMonth: (month, note) => request(`/api/admin/month-close/${month}`, { method: "POST", body: JSON.stringify({ note }) }),
    reopenMonth: (month) => request(`/api/admin/month-close/${month}`, { method: "DELETE" }),
    backup: () => request("/api/admin/backup"),
  },
};
