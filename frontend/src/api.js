// Point this at your deployed Worker URL (see wrangler.toml / `wrangler deploy` output)
export const API_BASE = import.meta.env.VITE_API_BASE || "https://kys-fund-worker.<your-subdomain>.workers.dev";

function initData() {
  return window.Telegram?.WebApp?.initData || "";
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
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
  return res.json();
}

export const api = {
  me: () => request("/api/me"),

  members: {
    list: () => request("/api/members"),
    get: (id) => request(`/api/members/${id}`),
    create: (data) => request("/api/members", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    exempt: (id, month, reason) =>
      request(`/api/members/${id}/exempt`, { method: "POST", body: JSON.stringify({ month, reason }) }),
  },

  expenses: {
    list: () => request("/api/expenses"),
    create: (data) => request("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id) => request(`/api/expenses/${id}`, { method: "DELETE" }),
    categories: () => request("/api/expenses/categories"),
    addCategory: (name) => request("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name }) }),
  },

  donations: {
    list: () => request("/api/donations"),
    create: (data) => request("/api/donations", { method: "POST", body: JSON.stringify(data) }),
  },

  reports: {
    activity: () => request("/api/reports/activity"),
    summary: (month) => request(`/api/reports/summary${month ? `?month=${month}` : ""}`),
    trend: () => request("/api/reports/trend"),
  },

  settings: {
    get: () => request("/api/settings"),
    update: (data) => request("/api/settings", { method: "PATCH", body: JSON.stringify(data) }),
    admins: () => request("/api/settings/admins"),
    addAdmin: (data) => request("/api/settings/admins", { method: "POST", body: JSON.stringify(data) }),
    removeAdmin: (id) => request(`/api/settings/admins/${id}`, { method: "DELETE" }),
    auditLog: () => request("/api/settings/audit-log"),
  },
};
