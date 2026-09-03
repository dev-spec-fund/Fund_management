import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, ExternalLink, Send } from "lucide-react";
import { smallBtn } from "./Shared";

let pdfRuntimePromise = null;

async function pdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfRuntimePromise;
}

export default function PdfPreview({ url, name = "PDF document", onOpen, onSend, sendBusy = false }) {
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(320);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(220, Math.floor(node.clientWidth || 320)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task = null;
    setPdf(null);
    setPages(0);
    setPage(1);
    setZoom(1);
    setError("");
    setLoading(true);

    (async () => {
      try {
        const pdfjs = await pdfRuntime();
        if (cancelled) return;
        task = pdfjs.getDocument({ url });
        const document = await task.promise;
        if (cancelled) {
          await document.destroy();
          return;
        }
        setPdf(document);
        setPages(document.numPages || 0);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Could not load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try { task?.destroy?.(); } catch {}
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;

    (async () => {
      setRendering(true);
      setError("");
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const available = Math.max(200, width - 18);
        const fitScale = available / base.width;
        const scale = Math.max(0.25, Math.min(4, fitScale * zoom));
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });
        const ratio = Math.min(2, window.devicePixelRatio || 1);

        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, viewport.width, viewport.height);
        renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch (e) {
        if (!cancelled && e?.name !== "RenderingCancelledException") setError(e?.message || "Could not render PDF page");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      try { renderTask?.cancel?.(); } catch {}
    };
  }, [pdf, page, zoom, width]);

  useEffect(() => () => {
    try { pdf?.destroy?.(); } catch {}
  }, [pdf]);

  const control = { ...smallBtn("var(--primary-text)"), minWidth: 36, padding: "7px 9px" };

  return <div className="sans">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <button type="button" aria-label="Previous PDF page" disabled={!pdf || page <= 1 || rendering} onClick={() => setPage((p) => Math.max(1, p - 1))} style={control}><ChevronLeft size={15}/></button>
        <div style={{fontSize:10,fontWeight:700,minWidth:76,textAlign:"center",color:"var(--muted)"}}>{pages ? `Page ${page} of ${pages}` : "Loading…"}</div>
        <button type="button" aria-label="Next PDF page" disabled={!pdf || page >= pages || rendering} onClick={() => setPage((p) => Math.min(pages, p + 1))} style={control}><ChevronRight size={15}/></button>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <button type="button" aria-label="Zoom PDF out" disabled={!pdf || zoom <= .7 || rendering} onClick={() => setZoom((z) => Math.max(.7, Number((z - .15).toFixed(2))))} style={control}><Minus size={14}/></button>
        <button type="button" title="Reset PDF zoom" disabled={!pdf || rendering} onClick={() => setZoom(1)} style={{...control,minWidth:52,fontSize:10}}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom PDF in" disabled={!pdf || zoom >= 2.5 || rendering} onClick={() => setZoom((z) => Math.min(2.5, Number((z + .15).toFixed(2))))} style={control}><Plus size={14}/></button>
      </div>
    </div>

    <div ref={viewportRef} style={{position:"relative",overflow:"auto",WebkitOverflowScrolling:"touch",maxHeight:"64vh",background:"var(--surface-cool)",border:"1px solid var(--border)",borderRadius:10,padding:8,textAlign:"center"}}>
      {(loading || rendering) && <div style={{position:"absolute",top:10,right:10,zIndex:2,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 7px",fontSize:9,color:"var(--muted)"}}>{loading ? "Loading PDF…" : "Rendering…"}</div>}
      {error ? <div style={{padding:"28px 12px",fontSize:11,color:"var(--danger)"}}>{error}</div> : <canvas ref={canvasRef} aria-label={`${name}, page ${page}`} style={{display:pdf?"block":"none",margin:"0 auto",background:"#fff",boxShadow:"0 1px 5px rgba(0,0,0,.18)"}} />}
    </div>

    <div style={{display:"grid",gridTemplateColumns:onSend?"1fr 1fr":"1fr",gap:8,marginTop:10}}>
      {onOpen && <button type="button" onClick={onOpen} style={smallBtn("var(--primary-text)")}><ExternalLink size={13}/> Open PDF</button>}
      {onSend && <button type="button" disabled={sendBusy} onClick={onSend} style={smallBtn("var(--primary-text)")}><Send size={13}/> {sendBusy ? "Sending…" : "Send to Telegram"}</button>}
    </div>
  </div>;
}
