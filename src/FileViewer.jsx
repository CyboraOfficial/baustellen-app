import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import MsgReader from "@kenjiuno/msgreader";
import "./FileViewer.css";

const MsgReaderConstructor = MsgReader.default || MsgReader;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;
const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

function PdfPages({ data, zoom, onError, onSize }) {
  const containerRef = useRef(null);
  const [pdf, setPdf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) });
    task.promise
      .then(async (doc) => {
        const firstPage = await doc.getPage(1);
        const { width, height } = firstPage.getViewport({ scale: 1 });
        if (cancelled) return;
        onSize({ width, height });
        setPdf(doc);
      })
      .catch((error) => { if (!cancelled) onError(error.message || "PDF konnte nicht gelesen werden."); });
    return () => { cancelled = true; task.destroy(); };
  }, [data]);

  useEffect(() => {
    if (!pdf || !containerRef.current) return undefined;
    const container = containerRef.current;
    let cancelled = false;
    const tasks = [];
    const timer = window.setTimeout(async () => {
      const ratio = window.devicePixelRatio || 1;
      const canvases = [];
      for (let number = 1; number <= pdf.numPages; number += 1) {
        if (cancelled) return;
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: zoom });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderTask = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null
        });
        tasks.push(renderTask);
        try { await renderTask.promise; } catch { return; }
        canvases.push(canvas);
      }
      if (!cancelled) container.replaceChildren(...canvases);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      tasks.forEach((task) => task.cancel());
    };
  }, [pdf, zoom]);

  return <div className="file-viewer-pdf" ref={containerRef} />;
}

const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".csv", ".json", ".xml", ".md", ".yaml", ".yml", ".ini",
  ".eml", ".html", ".htm", ".css", ".js", ".ts", ".sql"
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".mov", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const PREVIEW_MIME_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};

const getPreviewKind = (fileName) => {
  const extension = `.${String(fileName).split(".").pop()}`.toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".msg") return "msg";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "unsupported";
};

const cleanMailBody = (body) => String(body || "")
  .replace(/\r\n?/g, "\n")
  .replace(/\s*<(?:mailto:|https?:\/\/)[^>\s]*>/gi, "")
  .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0]/g, " ")
  .split("\n").map((line) => line.replace(/\s+$/, "")).join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const getRecipientLabel = (recipient) => {
  if (typeof recipient === "string") return recipient;
  return recipient?.email || recipient?.name || "";
};

export default function FileViewer({ fileName: mainFileName, fileNames, projectName, url: mainUrl, onClose, onNavigate }) {
  const [attachment, setAttachment] = useState(null);
  const attachmentUrlsRef = useRef([]);
  const fileName = attachment?.name ?? mainFileName;
  const url = attachment?.href ?? mainUrl;
  const [wide, setWide] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [textContent, setTextContent] = useState("");
  const [messageData, setMessageData] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [pdfData, setPdfData] = useState(null);
  const [naturalSize, setNaturalSize] = useState(null);
  const contentRef = useRef(null);

  const fitTo = (mode, size = naturalSize) => {
    const element = contentRef.current;
    if (!element || !size) return;
    const pad = previewKind === "pdf" ? 32 : 0;
    const widthZoom = (element.clientWidth - pad) / size.width;
    const heightZoom = (element.clientHeight - pad) / size.height;
    setZoom(clampZoom(mode === "width" ? widthZoom : mode === "height" ? heightZoom : Math.min(widthZoom, heightZoom)));
  };
  const [loadError, setLoadError] = useState("");
  const previewKind = getPreviewKind(fileName);
  const fileIndex = fileNames.indexOf(mainFileName);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setZoom(1);
    setTextContent("");
    setMessageData(null);
    setLoadError("");
    setPreviewUrl("");
    setPdfData(null);
    setNaturalSize(null);

    if (previewKind === "unsupported") return undefined;

    const controller = new AbortController();
    let objectUrl = "";
    const loadFile = async () => {
      setLoading(true);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Datei konnte nicht geladen werden (HTTP ${response.status}).`);

        if (previewKind === "text") {
          setTextContent(await response.text());
        } else if (previewKind === "msg") {
          const buffer = await response.arrayBuffer();
          const reader = new MsgReaderConstructor(new DataView(buffer));
          const data = reader.getFileData();
          const attachmentFiles = (data.attachments || []).map((attachment, index) => {
            const name = attachment.fileName || attachment.name || `Anhang ${index + 1}`;
            try {
              const { content } = reader.getAttachment(attachment);
              if (!content?.length) return { name, size: attachment.contentLength || 0 };
              const extension = `.${String(name).split(".").pop()}`.toLowerCase();
              const href = URL.createObjectURL(new Blob([content], {
                type: PREVIEW_MIME_TYPES[extension] || attachment.attachMimeTag || "application/octet-stream"
              }));
              attachmentUrlsRef.current.push(href);
              return { name, href, size: content.length, isImage: IMAGE_EXTENSIONS.has(extension) };
            } catch (error) {
              console.warn("Anhang konnte nicht gelesen werden:", name, error);
              return { name, size: attachment.contentLength || 0 };
            }
          });
          setMessageData({ ...data, attachmentFiles });
        } else if (previewKind === "pdf") {
          setPdfData(await response.arrayBuffer());
        } else {
          const fileData = await response.arrayBuffer();
          const extension = `.${String(fileName).split(".").pop()}`.toLowerCase();
          const contentType = PREVIEW_MIME_TYPES[extension]
            || response.headers.get("content-type")
            || "application/octet-stream";
          const blob = new Blob([fileData], { type: contentType });
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Dateivorschau konnte nicht geladen werden:", error);
          setLoadError(error.message || "Datei konnte nicht geladen werden.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadFile();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName, previewKind, url]);

  useEffect(() => {
    if (naturalSize) fitTo(previewKind === "pdf" ? "width" : "page");
  }, [naturalSize]);

  useEffect(() => {
    setAttachment(null);
    return () => {
      attachmentUrlsRef.current.forEach((href) => URL.revokeObjectURL(href));
      attachmentUrlsRef.current = [];
    };
  }, [mainFileName]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;

    const handleWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((value) => clampZoom(value * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    let drag = null;
    const handleMouseDown = (event) => {
      if (event.button !== 0 || event.target.closest("video, audio")) return;
      drag = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      element.classList.add("file-viewer-dragging");
      event.preventDefault();
    };
    const handleMouseMove = (event) => {
      if (!drag) return;
      element.scrollLeft = drag.left - (event.clientX - drag.x);
      element.scrollTop = drag.top - (event.clientY - drag.y);
    };
    const stopDrag = () => {
      drag = null;
      element.classList.remove("file-viewer-dragging");
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, []);

  const renderMessage = () => {
    if (loading) return <div className="file-viewer-state">E-Mail wird geladen …</div>;
    if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
    if (!messageData) return null;

    const recipients = Array.isArray(messageData.recipients)
      ? messageData.recipients.map(getRecipientLabel).filter(Boolean).join(", ")
      : "";
    return (
      <article className="file-viewer-email">
        <h2>{messageData.subject || fileName}</h2>
        <div className="file-viewer-email-head">
          <div className="file-viewer-email-avatar">{(messageData.senderName || messageData.senderEmail || "?").trim().charAt(0).toUpperCase()}</div>
          <div className="file-viewer-email-meta">
            <div className="file-viewer-email-from">
              <strong>{messageData.senderName || messageData.senderEmail || "Unbekannt"}</strong>
              {messageData.senderName && messageData.senderEmail && <span>&lt;{messageData.senderEmail}&gt;</span>}
            </div>
            {recipients && <div className="file-viewer-email-row"><span>An:</span><span>{recipients}</span></div>}
            {messageData.date && <div className="file-viewer-email-row"><span>Datum:</span><span>{messageData.date}</span></div>}
          </div>
        </div>
        <div className="file-viewer-email-body">{cleanMailBody(messageData.body) || "Diese Nachricht enthält keinen lesbaren Text."}</div>
        {messageData.attachmentFiles?.length > 0 && (
          <div className="file-viewer-attachments">
            <strong>Anhänge ({messageData.attachmentFiles.length})</strong>
            {messageData.attachmentFiles.map((attachment, index) => (
              <div key={`${attachment.name}-${index}`} className="file-viewer-attachment">
                {attachment.isImage && <img src={attachment.href} alt={attachment.name} draggable={false} />}
                {attachment.href && <button type="button" className="file-viewer-attachment-open" onClick={() => setAttachment({ name: attachment.name, href: attachment.href })}>👁 Ansehen</button>}
                <span>📎 {attachment.name}{attachment.size ? ` (${Math.max(1, Math.round(attachment.size / 1024))} KB)` : ""}</span>
                {attachment.href && <a href={attachment.href} download={attachment.name}>Speichern</a>}
              </div>
            ))}
          </div>
        )}
      </article>
    );
  };

  const renderPreview = () => {
    if (previewKind === "text") {
      if (loading) return <div className="file-viewer-state">Datei wird geladen …</div>;
      if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
      return <pre className="file-viewer-text" style={{ fontSize: `${13 * zoom}px` }}>{textContent}</pre>;
    }
    if (previewKind === "msg") return renderMessage();
    if (previewKind === "pdf") {
      if (loading) return <div className="file-viewer-state">PDF wird geladen …</div>;
      if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
      if (!pdfData) return null;
      return <PdfPages data={pdfData} zoom={zoom} onError={setLoadError} onSize={setNaturalSize} />;
    }
    if (previewKind === "image") {
      if (loading) return <div className="file-viewer-state">Bild wird geladen …</div>;
      if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
      return (
        <div className="file-viewer-media">
          <img src={previewUrl} alt={fileName} draggable={false}
            onLoad={(event) => setNaturalSize({ width: event.target.naturalWidth, height: event.target.naturalHeight })}
            style={naturalSize ? { width: `${naturalSize.width * zoom}px`, maxWidth: "none" } : undefined} />
        </div>
      );
    }
    if (previewKind === "video") {
      if (loading) return <div className="file-viewer-state">Video wird geladen …</div>;
      if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
      return <video className="file-viewer-player" src={previewUrl} controls />;
    }
    if (previewKind === "audio") {
      if (loading) return <div className="file-viewer-state">Audio wird geladen …</div>;
      if (loadError) return <div className="file-viewer-state file-viewer-error">{loadError}</div>;
      return <audio className="file-viewer-audio" src={previewUrl} controls />;
    }
    return (
      <div className="file-viewer-state">
        <div className="file-viewer-file-icon">📄</div>
        <strong>Für diesen Dateityp ist keine integrierte Vorschau verfügbar.</strong>
        <span>Du kannst die Datei herunterladen oder im regulären Browser öffnen.</span>
      </div>
    );
  };

  return (
    <div className="file-viewer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className={`file-viewer-panel${wide ? " file-viewer-panel-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Dateivorschau: ${fileName}`}
      >
        <header className="file-viewer-toolbar">
          <div className="file-viewer-title">
            <strong title={fileName}>{fileName}</strong>
            <span>{projectName}</span>
          </div>
          <div className="file-viewer-actions">
            {attachment && (
              <button type="button" onClick={() => setAttachment(null)}>← Zurück zur E-Mail</button>
            )}
            {["image", "pdf", "text"].includes(previewKind) && (
              <div className="file-viewer-zoom">
                <button type="button" aria-label="Verkleinern" onClick={() => setZoom((value) => clampZoom(value / 1.25))}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label="Vergrößern" onClick={() => setZoom((value) => clampZoom(value * 1.25))}>+</button>
                <button type="button" title="Auf Breite skalieren" aria-label="Auf Breite skalieren" disabled={!naturalSize} onClick={() => fitTo("width")}>↔</button>
                <button type="button" title="Auf Höhe skalieren" aria-label="Auf Höhe skalieren" disabled={!naturalSize} onClick={() => fitTo("height")}>↕</button>
                <button type="button" title="100 %" aria-label="Zoom zurücksetzen" onClick={() => setZoom(1)}>1:1</button>
              </div>
            )}
            {fileNames.length > 1 && (
              <div className="file-viewer-navigation">
                <button
                  type="button"
                  aria-label="Vorherige Datei"
                  disabled={fileIndex <= 0}
                  onClick={() => onNavigate(fileNames[fileIndex - 1])}
                >‹</button>
                <span>{fileIndex + 1} / {fileNames.length}</span>
                <button
                  type="button"
                  aria-label="Nächste Datei"
                  disabled={fileIndex < 0 || fileIndex >= fileNames.length - 1}
                  onClick={() => onNavigate(fileNames[fileIndex + 1])}
                >›</button>
              </div>
            )}
            <button type="button" onClick={() => setWide((value) => !value)} aria-label={wide ? "Breitenmodus schließen" : "Breitenmodus öffnen"}>
              {wide ? "⤢" : "⤢"} {wide ? "Schmal" : "Breit"}
            </button>
            <button type="button" className="file-viewer-close" onClick={onClose} aria-label="Vorschau schließen">✕</button>
          </div>
        </header>
        <div className="file-viewer-content" ref={contentRef}>{renderPreview()}</div>
      </section>
    </div>
  );
}
