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
  if (path.startsWith("/api/reports/summary") || path.startsWith("/api/reports/overview") || path.startsWith("/api/reports/public-summary")) return 15_000;
  if (path.startsWith("/api/members/overview")) return 15_000;
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

export async function request(path, options = {}) {
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

export async function prefetchTabData({ tab, adminView = false, canFinance = false, memberId = null, adminMonth = null } = {}) {
  const current = currentMaldivesPeriod();
  const month = adminView && /^\d{4}-\d{2}$/.test(String(adminMonth||"")) ? String(adminMonth) : current.month;
  const year = month.slice(0,4) || current.year;
  let paths = [];

  if (adminView) {
    if (tab === "members") paths = [`/api/members/overview?month=${month}`];
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
    else if (tab === "settings") {
      // Settings now loads each directory section on demand. Prefetch only the
      // small core settings payload so opening Settings stays fast without
      // eagerly downloading admins, categories, or financial history.
      paths = ["/api/settings"];
    }
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

export async function upload(path, formData) {
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

export async function reportClientError(payload = {}) {
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

export async function downloadBlob(path) {
  const res = await fetch(apiUrl(path), { headers: { "X-Telegram-Init-Data": initData() } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.blob();
}
