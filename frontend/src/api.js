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

const DEFAULT_GET_CACHE_TTL_MS = 25_000;
const MAX_GET_CACHE_ENTRIES = 100;
const MAX_PERF_METRICS = 40;
const responseCache = new Map();
const inFlightGets = new Map();
const perfMetrics = [];
let cacheGeneration = 0;
const PERF_DEBUG = Boolean(import.meta.env.DEV);

function cacheTtlFor(path) {
  if (path === "/api/me" || path === "/api/branding" || path === "/api/settings") return 60_000;
  if (path.startsWith("/api/members/") && path.endsWith("/statement")) return 20_000;
  if (path.startsWith("/api/reports/summary") || path.startsWith("/api/reports/public-summary")) return 15_000;
  if (path.startsWith("/api/reports/trend") || path.startsWith("/api/governance/annual/") || path.startsWith("/api/governance/analytics/")) return 30_000;
  if (path.startsWith("/api/projects") || path === "/api/me/projects") return 25_000;
  if (path.startsWith("/api/elections/exco/") || path === "/api/elections/archive") return 60_000;
  if (path === "/api/elections" || path.startsWith("/api/elections/")) return 20_000;
  if (path === "/api/admin/meetings" || path === "/api/me/meetings") return 20_000;
  if (path === "/api/me/governance-archive") return 60_000;
  if (path.startsWith("/api/admin/pending")) return 8_000;
  return DEFAULT_GET_CACHE_TTL_MS;
}

function recordPerf(label, startedAt, extra = "") {
  if (!startedAt || typeof performance === "undefined") return;
  const elapsed = Math.round(performance.now() - startedAt);
  perfMetrics.push({ label, ms: elapsed, at: Date.now(), extra });
  while (perfMetrics.length > MAX_PERF_METRICS) perfMetrics.shift();
  if (typeof window !== "undefined") window.__FUND_PERF__ = perfMetrics;
  if (PERF_DEBUG && elapsed >= 120) console.debug(`[Fund perf] ${label}: ${elapsed}ms${extra ? ` · ${extra}` : ""}`);
}

function clearGetCache({ preserveStable = false } = {}) {
  cacheGeneration += 1;
  if (!preserveStable) {
    responseCache.clear();
  } else {
    for (const key of [...responseCache.keys()]) {
      const stable = key.endsWith("::/api/me") || key.endsWith("::/api/branding");
      if (!stable) responseCache.delete(key);
    }
  }
  // Existing GET promises cannot be cancelled, but removing them here ensures a
  // post-mutation refresh does not reuse a request that started before the write.
  inFlightGets.clear();
}

function invalidateCacheMatching(matchers = []) {
  cacheGeneration += 1;
  const tests=matchers.map((m)=>typeof m==="function"?m:(path)=>path.startsWith(m));
  for(const [key,entry] of [...responseCache.entries()]){
    const path=entry?.path || key.slice(key.indexOf("::")+2);
    if(tests.some((test)=>test(path))) responseCache.delete(key);
  }
  for(const [key] of [...inFlightGets.entries()]){
    const path=key.slice(key.indexOf("::")+2);
    if(tests.some((test)=>test(path))) inFlightGets.delete(key);
  }
}

function invalidateAfterMutation(path) {
  const p=String(path||"");

  if(p.startsWith("/api/elections")){
    invalidateCacheMatching([
      "/api/elections",
      "/api/me/governance-archive",
      "/api/me/dashboard"
    ]);
    return;
  }

  if(p.startsWith("/api/admin/meetings") || p.startsWith("/api/governance/meetings") || p.startsWith("/api/governance/meeting-")){
    invalidateCacheMatching([
      "/api/admin/meetings",
      "/api/governance/meetings",
      "/api/governance/meeting-",
      "/api/me/meetings",
      "/api/me/actions",
      "/api/me/dashboard",
      "/api/elections/exco/"
    ]);
    return;
  }

  if(p.startsWith("/api/contributions") || p.startsWith("/api/donations") || p.startsWith("/api/expenses")){
    invalidateCacheMatching([
      "/api/reports/",
      "/api/admin/pending",
      "/api/members/",
      "/api/me/dashboard",
      "/api/me/contributions",
      "/api/expenses",
      "/api/projects",
      "/api/me/projects"
    ]);
    return;
  }

  if(p.startsWith("/api/projects")){
    invalidateCacheMatching(["/api/projects","/api/me/projects","/api/reports/"]);
    return;
  }

  if(p.startsWith("/api/members")){
    invalidateCacheMatching([
      "/api/members",
      "/api/me",
      "/api/me/dashboard",
      "/api/reports/",
      "/api/admin/pending",
      "/api/elections"
    ]);
    return;
  }

  if(p.startsWith("/api/settings")){
    clearGetCache({preserveStable:false});
    return;
  }

  // Unknown writes remain conservative.
  clearGetCache({preserveStable:true});
}

const DATA_CHANGED_EVENT = "fund:data-changed";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function shouldBroadcastDataChange(method) {
  return MUTATION_METHODS.has(method);
}

function broadcastDataChange(path, method) {
  if (typeof window === "undefined" || !shouldBroadcastDataChange(method)) return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path, method, at: Date.now() } }));
}

export function onDataChange(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = (event) => listener(event.detail || {});
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
}

export function onDataChangeDebounced(listener, delay = 120) {
  if (typeof window === "undefined") return () => {};
  let timer=null;
  let latest={};
  const paths=new Set();
  const handler=(event)=>{
    latest=event.detail||{};
    if(latest.path)paths.add(latest.path);
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{
      timer=null;
      const batch={...latest,paths:[...paths]};
      paths.clear();
      listener(batch);
    },Math.max(0,Number(delay)||0));
  };
  window.addEventListener(DATA_CHANGED_EVENT,handler);
  return ()=>{
    if(timer)clearTimeout(timer);
    window.removeEventListener(DATA_CHANGED_EVENT,handler);
  };
}

function cacheKey(path) {
  return `${initData()}::${path}`;
}

function storeGetCache(key, path, data) {
  responseCache.delete(key);
  const now=Date.now();
  responseCache.set(key, { path, data, fetchedAt:now, expiresAt: now + cacheTtlFor(path) });
  while (responseCache.size > MAX_GET_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey === undefined) break;
    responseCache.delete(oldestKey);
  }
}

async function request(path, options = {}) {
  const { forceFresh = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const key = isGet ? cacheKey(path) : null;

  if (isGet && !forceFresh) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      recordPerf(`CACHE ${path}`, typeof performance !== "undefined" ? performance.now() : 0, "hit");
      return cached.data;
    }
    const pending = inFlightGets.get(key);
    if (pending) return pending;
  }

  const requestGeneration = cacheGeneration;
  const run = async () => {
    const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
    const res = await fetch(apiUrl(path), {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData(),
        ...(fetchOptions.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = new Error(body.error || `Request failed: ${res.status}`);
      Object.assign(error, body, { status: res.status });
      throw error;
    }
    const data = await res.json();
    if (startedAt) recordPerf(`${method} ${path}`, startedAt, "network");
    if (isGet) {
      if (requestGeneration === cacheGeneration) {
        storeGetCache(key, path, data);
      }
    } else {
      invalidateAfterMutation(path);
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


export function peekCached(path, { allowExpired = true } = {}) {
  const cached=responseCache.get(cacheKey(path));
  if(!cached)return null;
  if(!allowExpired && cached.expiresAt<=Date.now())return null;
  return cached.data;
}

export function refreshCached(path) {
  return request(path,{forceFresh:true});
}

export function performanceSnapshot() {
  return [...perfMetrics];
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

async function prefetchTabData({ tab, adminView = false, canFinance = false, memberId = null, adminMonth = null } = {}) {
  const current = currentMaldivesPeriod();
  const month = adminView && /^\d{4}-\d{2}$/.test(String(adminMonth||"")) ? String(adminMonth) : current.month;
  const year = month.slice(0,4) || current.year;
  let paths = [];

  if (adminView) {
    if (tab === "members") paths = ["/api/members"];
    else if (tab === "pending" && canFinance) paths = ["/api/admin/pending"];
    else if (tab === "activity") paths = ["/api/reports/activity"];
    else if (tab === "expenses" && canFinance) paths = ["/api/expenses", "/api/expenses/categories", "/api/projects"];
    else if (tab === "projects" && canFinance) paths = ["/api/projects", "/api/members"];
    else if (tab === "meetings") paths = ["/api/admin/meetings"];
    else if (tab === "elections") paths = ["/api/elections","/api/members"];
    else if (tab === "reports") paths = [
      `/api/reports/summary?month=${month}`,
      `/api/reports/trend?month=${month}`,
      `/api/governance/annual/${year}`,
      `/api/governance/analytics/${year}`,
    ];
    else if (tab === "settings") paths = [
      "/api/settings", "/api/settings/admins", "/api/expenses/categories",
      "/api/governance/month-close",
    ];
  } else {
    if (tab === "history" && memberId) paths = [`/api/members/${memberId}/statement`];
    else if (tab === "fund") paths = [`/api/reports/public-summary?month=${month}`];
    else if (tab === "activity") paths = ["/api/reports/activity"];
    else if (tab === "projects") paths = ["/api/me/projects"];
    else if (tab === "meetings") paths = ["/api/me/meetings"];
    else if (tab === "elections") paths = ["/api/elections","/api/me/governance-archive"];
    else if (tab === "actions") paths = ["/api/me/actions"];
    else if (tab === "profile") paths = ["/api/me/dashboard"];
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
  invalidateAfterMutation(path);
  broadcastDataChange(path, "POST");
  return data;
}

async function reportClientError(payload = {}) {
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
    try {
      await fetch(apiUrl("/api/client-error"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData(),
        },
        body: JSON.stringify(payload),
        signal: controller?.signal,
        keepalive: true,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // Diagnostics must never create another visible app error.
  }
}

async function downloadBlob(path) {
  const res = await fetch(apiUrl(path), { headers: { "X-Telegram-Init-Data": initData() } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.blob();
}

export const api = {
  me: () => request("/api/me"),
  reportClientError,
  prefetchTabData,
  peekCached,
  refreshCached,
  performanceSnapshot,
  branding: () => request("/api/branding"),
  myDashboard: () => request("/api/me/dashboard"),
  myContributions: () => request("/api/me/contributions"),
  myMeetings: () => request("/api/me/meetings"),
  myProjects: () => request("/api/me/projects"),
  myActions: () => request("/api/me/actions"),
  myGovernanceArchive: () => request("/api/me/governance-archive"),
  rsvpMeeting: (id, response) => request(`/api/me/meetings/${id}/rsvp`, { method: "POST", body: JSON.stringify({ response }) }),
  completeMyAction: (id) => request(`/api/me/actions/${id}/done`, { method: "POST" }),

  members: {
    list: () => request("/api/members"),
    create: (data) => request("/api/members", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    statement: (id) => request(`/api/members/${id}/statement`),
    contributionSlip: (memberId, contributionId) => downloadBlob(`/api/members/${memberId}/contributions/${contributionId}/slip/file`),
    sendContributionSlipToTelegram: (memberId, contributionId) => request(`/api/members/${memberId}/contributions/${contributionId}/slip/send-to-telegram`, { method: "POST" }),
  },

  expenses: {
    list: ({ month = "", status = "", q = "", documents = "" } = {}) => {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      if (documents) params.set("documents", documents);
      const query = params.toString();
      return request(`/api/expenses${query ? `?${query}` : ""}`);
    },
    create: (data) => request("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id, reason) => request(`/api/expenses/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    documents: (id) => request(`/api/expenses/${id}/documents`),
    uploadDocument: (id, file, documentType = "") => {
      const form = new FormData();
      form.append("file", file, file.name || "document");
      if (documentType) form.append("document_type", documentType);
      return upload(`/api/expenses/${id}/documents`, form);
    },
    downloadDocument: (expenseId, documentId) => downloadBlob(`/api/expenses/${expenseId}/documents/${documentId}/file`),
    sendDocumentToTelegram: (expenseId, documentId) => request(`/api/expenses/${expenseId}/documents/${documentId}/send-to-telegram`, { method: "POST" }),
    updateDocument: (expenseId, documentId, data) => request(`/api/expenses/${expenseId}/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeDocument: (expenseId, documentId, reason) => request(`/api/expenses/${expenseId}/documents/${documentId}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    categories: () => request("/api/expenses/categories"),
    addCategory: (name) => request("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name }) }),
    updateCategory: (id, data) => request(`/api/expenses/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeCategory: (id) => request(`/api/expenses/categories/${id}`, { method: "DELETE" }),
  },

  projects: {
    list: ({ status = "", q = "" } = {}) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      const qs = params.toString();
      return request(`/api/projects${qs ? `?${qs}` : ""}`);
    },
    get: (id) => request(`/api/projects/${id}`),
    create: (data) => request("/api/projects", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },

  donations: {
    list: ({ month = "", status = "", q = "", documents = "" } = {}) => {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      if (documents) params.set("documents", documents);
      const qs = params.toString();
      return request(`/api/donations${qs ? `?${qs}` : ""}`);
    },
    get: (id) => request(`/api/donations/${id}`),
    create: (data) => request("/api/donations", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/donations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id, reason) => request(`/api/donations/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    documents: (id) => request(`/api/donations/${id}/documents`),
    uploadDocument: (id, file, documentType = "") => {
      const form = new FormData();
      form.append("file", file, file.name || "document");
      if (documentType) form.append("document_type", documentType);
      return upload(`/api/donations/${id}/documents`, form);
    },
    downloadDocument: (donationId, documentId) => downloadBlob(`/api/donations/${donationId}/documents/${documentId}/file`),
    sendDocumentToTelegram: (donationId, documentId) => request(`/api/donations/${donationId}/documents/${documentId}/send-to-telegram`, { method: "POST" }),
    updateDocument: (donationId, documentId, data) => request(`/api/donations/${donationId}/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeDocument: (donationId, documentId, reason) => request(`/api/donations/${donationId}/documents/${documentId}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
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
    promoteMember: (member_id, role, custom_role_id = null) => request("/api/settings/admins/promote-member", { method: "POST", body: JSON.stringify({ member_id, role, custom_role_id }) }),
    demoteMember: (id) => request(`/api/settings/admins/${id}/demote-member`, { method: "POST" }),
    updateAdmin: (id, data) => request(`/api/settings/admins/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    roles: () => request("/api/settings/roles"),
    createRole: (data) => request("/api/settings/roles", { method: "POST", body: JSON.stringify(data) }),
    updateRole: (id, data) => request(`/api/settings/roles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeRole: (id) => request(`/api/settings/roles/${id}`, { method: "DELETE" }),
    auditLog: () => request("/api/settings/audit-log"),
  },

  governance: {
    monthClosures: () => request("/api/governance/month-close"),
    monthCloseCheck: (month) => request(`/api/governance/month-close/${month}/check`),
    closeMonth: (month, note = "") => request(`/api/governance/month-close/${month}`, { method: "POST", body: JSON.stringify({ note }) }),
    reopenMonth: (month) => request(`/api/governance/month-close/${month}`, { method: "DELETE" }),
    reverse: (entity_type, entity_id, reason) => request("/api/governance/reverse", { method: "POST", body: JSON.stringify({ entity_type, entity_id, reason }) }),
    meetingMinutes: (id) => request(`/api/governance/meetings/${id}/minutes`),
    saveMeetingMinutes: (id, data) => request(`/api/governance/meetings/${id}/minutes`, { method: "PUT", body: JSON.stringify(data) }),
    addMeetingResolution: (id, data) => request(`/api/governance/meetings/${id}/resolutions`, { method: "POST", body: JSON.stringify(data) }),
    updateMeetingResolution: (id, data) => request(`/api/governance/meeting-resolutions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    meetingResolutionHistory: (id) => request(`/api/governance/meeting-resolutions/${id}/history`),
    addMeetingAction: (id, data) => request(`/api/governance/meetings/${id}/actions`, { method: "POST", body: JSON.stringify(data) }),
    updateMeetingAction: (id, data) => request(`/api/governance/meeting-actions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    annual: (year) => request(`/api/governance/annual/${year}`),
    analytics: (year) => request(`/api/governance/analytics/${year}`),
  },

  elections: {
    list: () => request("/api/elections"),
    get: (id) => request(`/api/elections/${id}`),
    readiness: (id) => request(`/api/elections/${id}/readiness`),
    repairApplicationSync: (id) => request(`/api/elections/${id}/repair-application-sync`, { method:"POST" }),
    summary: (id) => request(`/api/elections/${id}/summary`),
    notifications: (id) => request(`/api/elections/${id}/notifications`),
    dashboard: () => request("/api/elections/dashboard"),
    archive: () => request("/api/elections/archive"),
    create: (data) => request("/api/elections", { method:"POST", body:JSON.stringify(data) }),
    update: (id,data) => request(`/api/elections/${id}`, { method:"PATCH", body:JSON.stringify(data) }),
    extendApplications: (id,applications_close_at) => request(`/api/elections/${id}/extend-applications`, { method:"POST", body:JSON.stringify({applications_close_at}) }),
    addPosition: (id,data) => request(`/api/elections/${id}/positions`, { method:"POST", body:JSON.stringify(data) }),
    addCandidate: (id,data) => request(`/api/elections/${id}/candidates`, { method:"POST", body:JSON.stringify(data) }),
    apply: (id,data) => request(`/api/elections/${id}/applications`, { method:"POST", body:JSON.stringify(data) }),
    withdrawApplication: (id,applicationId) => request(`/api/elections/${id}/applications/${applicationId}/withdraw`, { method:"POST" }),
    reviewApplication: (id,applicationId,decision,reason="") => request(`/api/elections/${id}/applications/${applicationId}/review`, { method:"POST", body:JSON.stringify({decision,reason}) }),
    reopenApplication: (id,applicationId) => request(`/api/elections/${id}/applications/${applicationId}/reopen`, { method:"POST" }),
    reassignApplication: (id,applicationId,position_id) => request(`/api/elections/${id}/applications/${applicationId}/reassign`, { method:"POST", body:JSON.stringify({position_id}) }),
    withdrawCandidate: (id,candidateId,reason) => request(`/api/elections/${id}/candidates/${candidateId}/withdraw`, { method:"POST", body:JSON.stringify({reason}) }),
    remindNonVoters: (id) => request(`/api/elections/${id}/remind-nonvoters`, { method:"POST" }),
    certify: (id) => request(`/api/elections/${id}/certify`, { method:"POST" }),
    startRunoff: (id,data) => request(`/api/elections/${id}/runoffs`, { method:"POST", body:JSON.stringify(data) }),
    closeRunoff: (id,runoffId) => request(`/api/elections/${id}/runoffs/${runoffId}/close`, { method:"POST" }),
    voteRunoff: (id,runoffId,candidate_ids) => request(`/api/elections/${id}/runoffs/${runoffId}/vote`, { method:"POST", body:JSON.stringify({candidate_ids}) }),
    currentExco: () => request("/api/elections/exco/current"),
    excoTerms: () => request("/api/elections/exco/terms"),
    currentHandover: () => request("/api/elections/exco/handover/current"),
    updateHandoverItem: (handoverId,itemId,data) => request(`/api/elections/exco/handover/${handoverId}/items/${itemId}`, { method:"PATCH", body:JSON.stringify(data) }),
    completeHandover: (handoverId,notes="") => request(`/api/elections/exco/handover/${handoverId}/complete`, { method:"POST", body:JSON.stringify({notes}) }),
    timeline: (id) => request(`/api/elections/${id}/timeline`),
    excoWorkboard: () => request("/api/elections/exco/workboard"),
    createResponsibility: (data) => request("/api/elections/exco/responsibilities", { method:"POST", body:JSON.stringify(data) }),
    updateResponsibility: (id,data) => request(`/api/elections/exco/responsibilities/${id}`, { method:"PATCH", body:JSON.stringify(data) }),
    responsibilityHistory: (id) => request(`/api/elections/exco/responsibilities/${id}/history`),
    close: (id) => request(`/api/elections/${id}/close`, { method:"POST" }),
    deleteUnusedDraft: (id) => request(`/api/elections/${id}`, { method:"DELETE" }),
    vote: (id,selections) => request(`/api/elections/${id}/vote`, { method:"POST", body:JSON.stringify({selections}) }),
  },

  admin: {
    pending: () => request("/api/admin/pending"),
    sendPaymentReminders: (data = {}) => request("/api/admin/payment-reminders", { method: "POST", body: JSON.stringify(data) }),
    meetings: () => request("/api/admin/meetings"),
    meeting: (id) => request(`/api/admin/meetings/${id}`),
    createMeeting: (data) => request("/api/admin/meetings", { method: "POST", body: JSON.stringify(data) }),
    updateMeeting: (id, data) => request(`/api/admin/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    cancelMeeting: (id, reason = "") => request(`/api/admin/meetings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
    saveMeetingAttendance: (id, entries) => request(`/api/admin/meetings/${id}/attendance`, { method: "PUT", body: JSON.stringify({ entries }) }),
    completeMeeting: (id) => request(`/api/admin/meetings/${id}/complete`, { method: "POST" }),
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
    retryError: (id) => request(`/api/admin/errors/${id}/retry`, { method: "POST" }),
    resolveError: (id) => request(`/api/admin/errors/${id}/resolve`, { method: "POST" }),
    resolveAllErrors: () => request("/api/admin/errors/resolve-all", { method: "POST" }),
    backup: () => request("/api/admin/backup"),
  },
};
