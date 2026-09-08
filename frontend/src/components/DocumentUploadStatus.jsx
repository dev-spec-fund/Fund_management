import React from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, RotateCcw } from "lucide-react";

export default function DocumentUploadStatus({ status, onRetry }) {
  if (!status) return null;
  const phase = status.phase || "uploading";
  const failed = phase === "error";
  const done = phase === "success";
  const processing = phase === "processing";
  const title = failed ? "Document upload failed" : done ? "Uploaded" : processing ? "Processing document…" : "Uploading document…";
  const detail = failed
    ? (status.error || "Could not upload this document.")
    : status.name
      ? `${status.name}${status.total > 1 ? ` · ${status.current || 1} of ${status.total}` : ""}`
      : (processing ? "Finishing document…" : "Please wait");
  const Icon = failed ? AlertCircle : done ? CheckCircle2 : LoaderCircle;

  return <div className="sans" role={failed ? "alert" : "status"} aria-live="polite" style={{
    display:"flex",alignItems:"center",gap:9,padding:"9px 10px",margin:"8px 0",
    border:"1px solid var(--border)",borderRadius:10,background:"var(--bg)"
  }}>
    <Icon size={16} className={!failed && !done ? "document-upload-spinner" : undefined} style={{flex:"0 0 auto",color:failed?"var(--danger)":done?"var(--success)":"var(--primary-text)"}} />
    <div style={{minWidth:0,flex:1}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--text)"}}>{title}</div>
      <div style={{fontSize:9,color:"var(--soft)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{detail}</div>
    </div>
    {failed && onRetry && <button type="button" onClick={onRetry} style={{border:"1px solid var(--border-strong)",borderRadius:8,background:"var(--card)",color:"var(--text)",padding:"6px 8px",display:"inline-flex",alignItems:"center",gap:5,fontSize:10,fontWeight:700}}><RotateCcw size={12}/> Retry</button>}
  </div>;
}
