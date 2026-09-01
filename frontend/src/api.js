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

const GET_CACHE_TTL_MS = 30_000;
const responseCache = new Map();
const inFlightGets = new Map();
let cacheGeneration = 0;

function clearGetCache() {
  cacheGeneration += 1;
  responseCache.clear();
  // Existing GET promises cannot be cancelled, but removing them here ensures a
  // post-mutation refresh does not reuse a request that started before the write.
  inFlightGets.clear();
}

const DATA_CHANGED_EVENT = "fund:data-changed";

function shouldBroadcastDataChange(path, method) {
  if (method === "GET") return false;
  const liveDataPrefixes = [
    "/api/members",
    "/api/expenses",
    "/api/donations",
    "/api/governance/reverse",
    "/api/governance/month-close",
    "/api/admin/pending/registrations",
    "/api/admin/pending/contributions",
  ];
  return liveDataPrefixes.some((prefix) => path.startsWith(prefix));
}

function broadcastDataChange(path, method) {
  if (typeof window === "undefined" || !shouldBroadcastDataChange(path, method)) return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path, method, at: Date.now() } }));
}

export function onDataChange(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = (event) => listener(event.detail || {});
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
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

  const requestGeneration = cacheGeneration;
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
    if (isGet) {
      if (requestGeneration === cacheGeneration) {
        responseCache.set(key, { data, expiresAt: Date.now() + GET_CACHE_TTL_MS });
      }
    } else {
      clearGetCache();
      broadcastDataChange(path, method);
    }
    return data;
  };

  if (!isGet) return run();
  let promise;
  promise = run().finally(() => {
    if (inFlightGets.get(key) === promise) inFlightGets.delete(key);
  });
  inFlightGets.set(key, promise);
  return promise;
}


function currentMaldivesPeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Indian/Maldives",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || String(new Date().getUTCFullYear());
  const month = parts.find((part) => part.type === "month")?.value || String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return { year, month: `${year}-${month}` };
}

async function prefetchMemberData(memberId) {
  if (!memberId) return [];
  const { month } = currentMaldivesPeriod();
  return Promise.allSettled([
    request("/api/me/dashboard"),
    request(`/api/members/${memberId}/statement`),
    request(`/api/reports/public-summary?month=${month}`),
    request("/api/reports/activity"),
    request("/api/me/meetings"),
    request("/api/me/actions"),
  ]);
}

async function prefetchAdminData(stage = "primary", canFinance = false) {
  const { year, month } = currentMaldivesPeriod();
  let paths = [];

  if (stage === "primary") {
    paths = [
      "/api/members",
      `/api/reports/summary?month=${month}`,
      "/api/reports/activity",
      ...(canFinance ? ["/api/admin/pending"] : []),
    ];
  } else if (stage === "operations") {
    paths = [
      "/api/admin/meetings",
      ...(canFinance ? ["/api/expenses", "/api/expenses/categories"] : []),
    ];
  } else if (stage === "reports") {
    paths = [
      `/api/reports/trend?month=${month}`,
      `/api/governance/annual/${year}`,
      `/api/governance/analytics/${year}`,
    ];
  } else if (stage === "settings") {
    paths = [
      "/api/settings",
      "/api/settings/admins",
      "/api/expenses/categories",
      "/api/admin/month-close",
      "/api/admin/health",
      "/api/admin/errors",
      "/api/settings/audit-log",
    ];
  }

  return Promise.allSettled(paths.map((path) => request(path)));
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
  broadcastDataChange(path, "POST");
  return data;
}

export const api = {
  me: () => request("/api/me"),
  prefetchMemberData,
  prefetchAdminData,
  branding: () => request("/api/branding"),
  myDashboard: () => request("/api/me/dashboard"),
  myContributions: () => request("/api/me/contributions"),
  myMeetings: () => request("/api/me/meetings"),
  myActions: () => request("/api/me/actions"),
  rsvpMeeting: (id, response) => request(`/api/me/meetings/${id}/rsvp`, { method: "POST", body: JSON.stringify({ response }) }),
  completeMyAction: (id) => request(`/api/me/actions/${id}/done`, { method: "POST" }),

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
    activity: (filters = {}) => {
      const params = new URLSearchParams();
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const qs = params.toString();
      return request(`/api/reports/activity${qs ? `?${qs}` : ""}`);
    },
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

  governance: {
    monthCloseCheck: (month) => request(`/api/governance/month-close/${month}/check`),
    closeMonth: (month, note = "") => request(`/api/governance/month-close/${month}`, { method: "POST", body: JSON.stringify({ note }) }),
    snapshots: (year = "") => request(`/api/governance/snapshots${year ? `?year=${encodeURIComponent(year)}` : ""}`),
    reverse: (entity_type, entity_id, reason) => request("/api/governance/reverse", { method: "POST", body: JSON.stringify({ entity_type, entity_id, reason }) }),
    reversals: () => request("/api/governance/reversals"),
    meetingMinutes: (id) => request(`/api/governance/meetings/${id}/minutes`),
    saveMeetingMinutes: (id, data) => request(`/api/governance/meetings/${id}/minutes`, { method: "PUT", body: JSON.stringify(data) }),
    addMeetingAction: (id, data) => request(`/api/governance/meetings/${id}/actions`, { method: "POST", body: JSON.stringify(data) }),
    updateMeetingAction: (id, data) => request(`/api/governance/meeting-actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    annual: (year) => request(`/api/governance/annual/${year}`),
    analytics: (year) => request(`/api/governance/analytics/${year}`),
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
