import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, action, children }) {
  const readViewport = () => ({
    height: Math.round(window.visualViewport?.height || window.innerHeight || 700),
    top: Math.round(window.visualViewport?.offsetTop || 0),
  });
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setViewport(readViewport());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const keepFocusedFieldVisible = (e) => {
    const el = e.target;
    if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
    window.setTimeout(() => {
      try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch {}
    }, 180);
  };

  return (
    <div
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
        background: "rgba(31,42,34,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 50,
        boxSizing: "border-box",
        paddingTop: "max(10px, env(safe-area-inset-top))"
      }}
    >
      <div style={{
        background: "var(--bg)",
        borderRadius: "18px 18px 0 0",
        width: "100%",
        maxWidth: 480,
        height: `calc(${viewport.height}px - max(10px, env(safe-area-inset-top)))`,
        maxHeight: `calc(${viewport.height}px - max(10px, env(safe-area-inset-top)))`,
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
        overscrollBehavior: "contain",
        touchAction: "pan-y",
        WebkitOverflowScrolling: "touch",
        scrollPaddingTop: 74,
        scrollPaddingBottom: 150,
        padding: "0 22px calc(22px + env(safe-area-inset-bottom))"
      }}>
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 62,
          paddingTop: 6,
          background: "var(--bg)",
          borderBottom: "1px solid var(--divider-2)",
          marginBottom: 14
        }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {action}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 8 }}><X size={20} /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
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
      className="sans"
      style={{
        width: "100%",
        minWidth: 0,
        border: prefix ? 0 : `1.5px solid ${focused ? "var(--focus)" : "var(--border-strong)"}`,
        outline: "none",
        borderRadius: prefix ? 0 : 10,
        padding: "10px 12px",
        fontSize: 14,
        boxSizing: "border-box",
        background: focused ? "var(--focus-bg)" : "var(--card)",
        boxShadow: focused ? "0 0 0 2px rgba(47,90,61,0.10)" : "none",
        transition: "border-color .15s ease, background .15s ease, box-shadow .15s ease"
      }}
    />
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="sans" style={{
        fontSize: 12,
        color: focused ? "var(--primary)" : "var(--muted)",
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
          boxShadow: focused ? "0 0 0 2px rgba(47,90,61,0.10)" : "none",
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

