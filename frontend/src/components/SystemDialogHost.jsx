import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "./FormControls";
import { settleSystemDialog, subscribeSystemDialog } from "../utils/systemDialogs";

const buttonBase = {
  minHeight: 42,
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
};

export default function SystemDialogHost() {
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => subscribeSystemDialog(setDialog), []);
  useEffect(() => {
    setValue(dialog?.defaultValue ?? "");
    setError("");
  }, [dialog?.id]);

  const choiceOptions = useMemo(() => dialog?.options || [], [dialog]);
  if (!dialog) return null;

  const cancel = () => settleSystemDialog(dialog.id, null);
  const submit = (overrideValue) => {
    if (dialog.kind === "notice") return settleSystemDialog(dialog.id, true);
    const candidate = overrideValue !== undefined ? overrideValue : value;
    const text = String(candidate ?? "");
    const normalized = dialog.trim ? text.trim() : text;
    if (dialog.required && !normalized.trim()) {
      setError("This field is required.");
      return;
    }
    if (dialog.minLength && normalized.trim().length < dialog.minLength) {
      setError(`Enter at least ${dialog.minLength} characters.`);
      return;
    }
    settleSystemDialog(dialog.id, normalized);
  };

  if (dialog.kind === "notice") {
    return (
      <Modal title={dialog.title} onClose={() => settleSystemDialog(dialog.id, true)}>
        <div className="sans" style={{fontSize:13,lineHeight:1.55,color:"var(--muted)",whiteSpace:"pre-line",marginBottom:18}}>{dialog.message}</div>
        <button type="button" onClick={() => settleSystemDialog(dialog.id, true)} className="sans" style={{...buttonBase,width:"100%",border:"1px solid var(--primary)",background:"var(--primary)",color:"var(--on-primary)"}}>{dialog.buttonLabel}</button>
      </Modal>
    );
  }

  const inputStyle = {
    width: "100%",
    border: "1.5px solid var(--border-strong)",
    outline: "none",
    borderRadius: 10,
    padding: "10px 12px",
    minHeight: 44,
    fontSize: 16,
    boxSizing: "border-box",
    background: "var(--card)",
    color: "var(--text)",
  };

  return (
    <Modal title={dialog.title} onClose={cancel}>
      {dialog.message ? <div className="sans" style={{fontSize:13,lineHeight:1.5,color:"var(--muted)",whiteSpace:"pre-line",marginBottom:12}}>{dialog.message}</div> : null}
      <div className="sans" style={{fontSize:12,color:"var(--muted)",marginBottom:4}}>{dialog.label}</div>
      {dialog.kind === "choice" ? (
        <select value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} className="sans" style={inputStyle} autoFocus>
          <option value="">Select</option>
          {choiceOptions.map((option) => {
            const item = typeof option === "string" ? { value: option, label: option } : option;
            return <option key={String(item.value)} value={String(item.value)}>{item.label}</option>;
          })}
        </select>
      ) : dialog.multiline ? (
        <textarea value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} placeholder={dialog.placeholder || ""} className="sans" rows={4} style={{...inputStyle,resize:"vertical"}} autoFocus />
      ) : (
        <input value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} placeholder={dialog.placeholder || ""} type={dialog.kind === "datetime" ? "datetime-local" : "text"} className={`sans${dialog.kind === "datetime" ? " native-date-time-control" : ""}`} style={inputStyle} autoFocus />
      )}
      {error ? <div className="sans" style={{fontSize:11,color:"var(--danger)",marginTop:6}}>{error}</div> : null}
      {dialog.kind === "datetime" && dialog.allowEmpty ? (
        <button type="button" onClick={() => submit("")} className="sans" style={{...buttonBase,width:"100%",marginTop:10,border:"1px solid var(--border-strong-2)",background:"var(--button-soft)",color:"var(--primary-text)"}}>{dialog.emptyLabel}</button>
      ) : null}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}>
        <button type="button" onClick={cancel} className="sans" style={{...buttonBase,border:"1px solid var(--border-strong-2)",background:"var(--button-soft)",color:"var(--primary-text)"}}>{dialog.cancelLabel}</button>
        <button type="button" onClick={() => submit()} className="sans" style={{...buttonBase,border:"1px solid var(--primary)",background:"var(--primary)",color:"var(--on-primary)"}}>{dialog.submitLabel}</button>
      </div>
    </Modal>
  );
}
