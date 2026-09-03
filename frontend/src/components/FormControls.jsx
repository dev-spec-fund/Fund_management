import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({ title, onClose, action, children, closeDisabled = false }) {
  const readViewport = () => ({
    height: Math.round(window.visualViewport?.height || window.innerHeight || 700),
    top: Math.round(window.visualViewport?.offsetTop || 0),
  });
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const vv = window.visualViewport;
    const appRoot = document.querySelector(".app-page-content");
    const previousOverflowY = appRoot?.style.overflowY || "";
    const previousScrollTop = appRoot?.scrollTop || 0;

    // Lock only the normal page scroller. The modal body remains the single active
    // vertical scroller, which avoids gesture transfer to the page behind it.
    if (appRoot) {
      appRoot.style.overflowY = "hidden";
    }

    const update = () => setViewport(readViewport());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const onKeyDown = (event) => { if (event.key === "Escape" && !closeDisabled) onClose?.(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKeyDown);
      if (appRoot) {
        appRoot.style.overflowY = previousOverflowY;
        appRoot.scrollTop = previousScrollTop;
      }
    };
  }, [closeDisabled, onClose]);

  const keepFocusedFieldVisible = (e) => {
    const el = e.target;
    if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
    window.setTimeout(() => {
      try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch {}
    }, 220);
  };

  const modal = (
    <div
      className="app-modal-overlay"
      role="presentation"
      onFocusCapture={keepFocusedFieldVisible}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        top: viewport.top,
        height: viewport.height,
        width: "100%",
        maxWidth: "100vw",
        overflow: "hidden",
        background: "var(--overlay)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
        boxSizing: "border-box",
        paddingTop: "max(10px, env(safe-area-inset-top))"
      }}
    >
      <div className="app-modal-sheet" role="dialog" aria-modal="true" aria-label={title || "Dialog"} style={{
        background: "var(--bg)",
        borderRadius: "16px 16px 0 0",
        width: "100%",
        maxWidth: 480,
        height: `min(92dvh, ${Math.max(320, viewport.height - 10)}px)`,
        maxHeight: `calc(${viewport.height}px - max(10px, env(safe-area-inset-top)))`,
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column"
      }}>
        <div className="app-modal-header" style={{
          flex: "0 0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 56,
          padding: "5px 14px 0 18px",
          background: "var(--bg)",
          borderBottom: "1px solid var(--divider-2)"
        }}>
          <div style={{ fontSize: 16, lineHeight: 1.2, fontWeight: 600 }}>{title}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {action}
            <button type="button" onClick={onClose} disabled={closeDisabled} aria-label="Close" style={{ background: "none", border: "none", cursor: closeDisabled ? "not-allowed" : "pointer", opacity: closeDisabled ? .45 : 1, padding: 8 }}><X size={20} /></button>
          </div>
        </div>
        <div className="app-modal-body" style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowX: "hidden",
          overflowY: "auto",
          boxSizing: "border-box",
          padding: "12px 18px calc(20px + env(safe-area-inset-bottom))"
        }}>
          {children}
        </div>
      </div>
    </div>
  );

  // Render outside .app-page-content. This is important on iOS/Telegram:
  // a fixed descendant of the locked page scroller can inherit gesture/overflow
  // restrictions and make long forms (such as Meeting create/edit) unscrollable.
  return createPortal(modal, document.body);
}

export function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const settle = (value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(value);
  };

  const askConfirm = ({ title = "Confirm action", message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger" } = {}) =>
    new Promise((resolve) => {
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setDialog({ title, message, confirmLabel, cancelLabel, tone });
    });

  const confirmationDialog = dialog ? (
    <Modal title={dialog.title} onClose={() => settle(false)}>
      <div className="sans" style={{fontSize:13,lineHeight:1.55,color:"var(--muted)",whiteSpace:"pre-line",marginBottom:18}}>{dialog.message}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <button type="button" onClick={() => settle(false)} className="sans" style={{minHeight:42,borderRadius:10,border:"1px solid var(--border-strong-2)",background:"var(--button-soft)",color:"var(--primary-text)",fontWeight:700,cursor:"pointer"}}>{dialog.cancelLabel}</button>
        <button type="button" onClick={() => settle(true)} className="sans" style={{minHeight:42,borderRadius:10,border:`1px solid ${dialog.tone === "danger" ? "var(--danger-border)" : "var(--primary)"}`,background:dialog.tone === "danger" ? "var(--danger-bg)" : "var(--primary)",color:dialog.tone === "danger" ? "var(--danger)" : "var(--on-primary)",fontWeight:700,cursor:"pointer"}}>{dialog.confirmLabel}</button>
      </div>
    </Modal>
  ) : null;

  return { confirm: askConfirm, confirmationDialog };
}

export function Field({ label, value, onChange, type = "text", prefix = null, placeholder = "" }) {
  const external = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(external);
  }, [external, focused]);

  const input = (
    <input
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        onChange(next);
      }}
      onBlur={() => {
        setFocused(false);
        onChange(draft);
      }}
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      placeholder={placeholder}
      className={`sans${["date","time","month","datetime-local"].includes(type) ? " native-date-time-control" : ""}`}
      style={{
        width: "100%",
        minWidth: 0,
        border: prefix ? 0 : `1.5px solid ${focused ? "var(--focus)" : "var(--border-strong)"}`,
        outline: "none",
        borderRadius: prefix ? 0 : 10,
        padding: "10px 12px",
        fontSize: 16,
        boxSizing: "border-box",
        background: focused ? "var(--focus-bg)" : "var(--card)",
        boxShadow: focused ? "0 0 0 2px var(--focus-ring)" : "none",
        transition: "border-color .15s ease, background .15s ease, box-shadow .15s ease"
      }}
    />
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="sans" style={{
        fontSize: 12,
        color: focused ? "var(--primary-text)" : "var(--muted)",
        fontWeight: focused ? 700 : 400,
        marginBottom: 4,
        transition: "color .15s ease, font-weight .15s ease"
      }}>{label}</div>
      {prefix ? (
        <div style={{
          display:"flex",
          alignItems:"center",
          border:`1.5px solid ${focused ? "var(--focus)" : "var(--border-strong)"}`,
          borderRadius:10,
          background: focused ? "var(--focus-bg)" : "var(--card)",
          overflow:"hidden",
          boxShadow: focused ? "0 0 0 2px var(--focus-ring)" : "none",
          transition:"border-color .15s ease, background .15s ease, box-shadow .15s ease"
        }}>
          <span className="sans" style={{
            paddingLeft:12,
            fontSize:12,
            color:focused ? "var(--focus)" : "var(--soft)",
            fontWeight:focused ? 700 : 400,
            flex:"0 0 auto"
          }}>{prefix}</span>
          {input}
        </div>
      ) : input}
    </div>
  );
}

