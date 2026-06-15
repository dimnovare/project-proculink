"use client";

// MapperPreviewPane — the collapsible live OUTPUT preview (Task 10). It renders the
// delivered document AS THE USER WIRES, reusing the shipped previewMappingOverride endpoint
// with the SAME ~400ms debounce cadence as OutputMappingEditor's template-mode preview.
//
//   • format toggle      — CSV / JSON / XML / cXML / UBL / X12 (PREVIEW_FORMATS); the
//     backend renders all six.
//   • just-touched highlight — the model passes the last-edited field key; the matching
//     token in the rendered text is highlighted so the user sees their edit land.
//   • copy / download    — copy the preview to the clipboard or save it as a file (the
//     extension follows the chosen format).
//   • inline error       — the endpoint returns HTTP 200 { ok:false, error } for template
//     render failures; we surface it amber, never crash.
//
// For variant="connection" there is no single order to preview, so the host points the pane
// at a sample/recent order via previewOrderId; when none exists we show the empty state
// (not an error) — offer⇔works.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewMappingOverride } from "@/lib/api-client";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";
import { PREVIEW_FORMATS } from "@/lib/api/types";
import { nextOutputFormat } from "./mapperCommands";
import { splitForHighlight } from "./previewHighlightModel";

export interface MapperPreviewPaneProps {
  /** The order to preview against (order variant: the order; connection variant: a sample). */
  previewOrderId: string | null;
  /** The live draft override (preview re-runs when it changes). */
  override: OrderMappingOverride;
  /** The last field key the user touched — highlighted in the rendered output. */
  lastTouched: string | null;
  /** Supplier/connection display name — drives the "what {name} receives" header. */
  supplierName?: string;
  /** connection variant with no sample order → show the honest empty state, not an error. */
  emptyHint?: string;
  /**
   * Bumped by the command palette "Switch output format" command — cycles the format
   * through PREVIEW_FORMATS. A counter so each invocation advances once.
   */
  cycleFormatSignal?: number;
}

const FORMAT_EXT: Record<OutputFormatId, string> = {
  csv: "csv", json: "json", xml: "xml", cxml: "xml", ubl: "xml", x12: "txt",
};

const FORMAT_MIME: Record<OutputFormatId, string> = {
  csv: "text/csv", json: "application/json", xml: "application/xml",
  cxml: "application/xml", ubl: "application/xml", x12: "text/plain",
};

export function MapperPreviewPane({ previewOrderId, override, lastTouched, supplierName, emptyHint, cycleFormatSignal }: MapperPreviewPaneProps) {
  const [format, setFormat] = useState<OutputFormatId>("csv");
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Command-palette "Switch output format" → advance through PREVIEW_FORMATS. Skip the
  // initial mount (signal undefined/0) so the default CSV view isn't immediately bumped.
  useEffect(() => {
    if (!cycleFormatSignal) return;
    setFormat((f) => nextOutputFormat(f));
  }, [cycleFormatSignal]);

  // ~300ms debounce on (override, format) — fast enough to feel live as the user wires.
  // FIX F (format toggle): we pass the SELECTED format to the endpoint and verify the body we
  // got back is actually that format. If the backend returns a different format than requested
  // (e.g. it can't render the chosen one for this mapping), we surface an honest
  // "preview unavailable in {FORMAT}" rather than silently showing JSON for a CSV request.
  useEffect(() => {
    if (!previewOrderId) { setContent(null); setErr(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await previewMappingOverride(previewOrderId, override, format);
        if (cancelled) return;
        const returned = (res.format ?? "").toLowerCase();
        if (returned && returned !== format && !res.error) {
          // The server rendered a DIFFERENT format than we asked for → don't show the wrong body.
          setContent(null);
          setErr(`Preview unavailable in ${format.toUpperCase()} for this mapping — the server returned ${returned.toUpperCase()}. Pick another format or adjust the mapping.`);
        } else {
          setContent(res.content);
          setErr(res.error ?? res.warning ?? null);
        }
      } catch (e) {
        if (!cancelled) { setContent(null); setErr(e instanceof Error ? e.message : "Preview failed"); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [previewOrderId, override, format]);

  const onCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked (insecure context / permission) — silently ignore; download still works.
    }
  }, [content]);

  const onDownload = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: FORMAT_MIME[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preview.${FORMAT_EXT[format]}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [content, format]);

  // Build the highlighted render: isolate the OUTPUT LINE mentioning the last-touched field
  // (by key/path or its resolved value) so the user's most recent edit visibly lands.
  const highlighted = useMemo(
    () => renderWithHighlight(content, lastTouched),
    [content, lastTouched],
  );

  // One-shot flash whenever the rendered content changes — a calm "it updated" pulse.
  const [flash, setFlash] = useState(false);
  const prevContentRef = useRef<string | null>(null);
  useEffect(() => {
    if (content == null) return;
    if (prevContentRef.current !== null && prevContentRef.current !== content) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 480);
      prevContentRef.current = content;
      return () => clearTimeout(t);
    }
    prevContentRef.current = content;
  }, [content]);

  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#1E6D29" }}>
            Live preview
          </span>
          <span style={{ fontSize: 10, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {supplierName ? `What ${supplierName} receives` : "What the supplier receives"}
          </span>
        </span>
        {lastTouched && <span style={{ fontSize: 10, color: "#5E3DB0", flexShrink: 0 }}>edited {lastTouched}</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {PREVIEW_FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFormat(f.value)}
              aria-pressed={format === f.value}
              style={{
                padding: "2px 8px", borderRadius: 999, cursor: "pointer", fontSize: 10, fontWeight: 700,
                border: `1px solid ${format === f.value ? "#2E8E3A" : "#DCE0E8"}`,
                background: format === f.value ? "#EAF6EC" : "#FFFFFF",
                color: format === f.value ? "#1E6D29" : "var(--ink-faint)",
              }}
            >
              {f.label}
            </button>
          ))}
          <span style={{ width: 1, height: 16, background: "#E2E6EE", margin: "0 2px" }} aria-hidden />
          <button
            type="button"
            onClick={onCopy}
            disabled={!content}
            aria-label="Copy preview"
            style={{ padding: "2px 8px", borderRadius: 6, cursor: content ? "pointer" : "default", fontSize: 10, fontWeight: 700, border: "1px solid #DCE0E8", background: "#FFFFFF", color: content ? "#345470" : "#AEB6C4" }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!content}
            aria-label="Download preview"
            style={{ padding: "2px 8px", borderRadius: 6, cursor: content ? "pointer" : "default", fontSize: 10, fontWeight: 700, border: "1px solid #DCE0E8", background: "#FFFFFF", color: content ? "#345470" : "#AEB6C4" }}
          >
            Download
          </button>
        </div>
      </div>

      {err && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "#9A6B00", background: "#FFF7E6", borderBottom: "1px solid #F1E2BE" }}>
          {err}
        </div>
      )}

      {!previewOrderId ? (
        <div style={{ padding: "16px 12px", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {emptyHint ?? "No sample order to preview yet — upload or pick a sample to see the delivered output."}
        </div>
      ) : (
        <pre
          aria-live="polite"
          className={flash ? "mapper-preview-flash" : undefined}
          style={{
            // T7 — the docked live preview is the document operators read most.
            // Bumped body 11→13 + taller (240→420) now that the pane is wider, so
            // the delivered output is comfortably legible, not a cramped 11px strip.
            margin: 0, padding: "12px 14px", maxHeight: 420, overflow: "auto",
            fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.55,
            color: "#0B1A2F", whiteSpace: "pre-wrap", wordBreak: "break-word",
            opacity: busy ? 0.55 : 1, transition: "opacity 150ms",
          }}
        >
          {content == null
            ? (busy ? "Rendering…" : "(no preview)")
            : highlighted}
        </pre>
      )}
    </div>
  );
}

/**
 * Render `content` as React nodes, wrapping the OUTPUT LINE that mentions the last-touched
 * field (by key/path or its resolved value) in a violet highlight so the user's most recent
 * edit visibly lands. When `lastTouched` is null or not found, returns the plain string. Pure
 * presentation — string-split (no regex injection risk).
 */
function renderWithHighlight(content: string | null, lastTouched: string | null): React.ReactNode {
  if (content == null) return null;
  const { before, match, after } = splitForHighlight(content, lastTouched);
  if (!match) return content;
  return (
    <>
      {before}
      <mark style={{ background: "#EEE7FB", color: "#5E3DB0", borderRadius: 3, padding: "0 2px", display: "inline" }}>{match}</mark>
      {after}
    </>
  );
}
