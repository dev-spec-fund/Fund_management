import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const CHUNK_RECOVERY_KEY = "fund:chunk-recovery";

function recoverFromStaleChunk(error) {
  const message = String(error?.message || error || "");
  const isChunkFailure =
    /Importing a module script failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message);

  if (!isChunkFailure || typeof window === "undefined") return false;

  try {
    const last = Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0);
    const now = Date.now();

    // Reload at most once per 60 seconds so a genuine deployment problem
    // cannot trap the Telegram Mini App in a refresh loop.
    if (now - last < 60_000) return false;

    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(now));
    const url = new URL(window.location.href);
    url.searchParams.set("_appv", String(now));
    window.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}

// Vite emits this event when a deployed hashed chunk can no longer be loaded.
window.addEventListener("vite:preloadError", (event) => {
  if (recoverFromStaleChunk(event?.payload || event)) {
    event.preventDefault?.();
  }
});

// Some WebViews surface the same failure only as an unhandled rejection.
window.addEventListener("unhandledrejection", (event) => {
  if (recoverFromStaleChunk(event?.reason)) {
    event.preventDefault?.();
  }
});


if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);