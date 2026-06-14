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

import { useCallback, useEffect, useMemo, useState } from "react";
import { previewMappingOverride } from "@/lib/api-client";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";
import { PREVIEW_FORMATS } from "@/lib/api/types";
import { nextOutputFormat } from "./mapperCommands";

export interface MapperPreviewPaneProps {
  /** The order to preview against (order variant: the order; connection variant: a sample). */
  previewOrderId: string | null;
  /** The live draft override (preview re-runs when it changes). */
  override: OrderMappingOverride;
  /** The last field key the user touched — highlighted in the rendered output. */
  lastTouched: string | null;
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

export function MapperPreviewPane({ previewOrderId, override, lastTouched, emptyHint, cycleFormatSignal }: MapperPreviewPaneProps) {
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

  // ~400ms debounce on (override, format) — mirrors OutputMappingEditor's preview cadence.
  useEffect(() => {
    if (!previewOrderId) { setContent(null); setErr(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await previewMappingOverride(previewOrderId, override, format);
        if (cancelled) return;
        setContent(res.content);
        setErr(res.error ?? res.warning ?? null);
      } catch (e) {
        if (!cancelled) { setContent(null); setErr(e instanceof Error ? e.message : "Preview failed"); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 400);
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

  // Build the highlighted render: split the content around the last-touched token so the
  // user's most recent edit is visible. Plain string match (the rendered value of the field).
  const highlighted = useMemo(
    () => renderWithHighlight(content, lastTouched),
    [content, lastTouched],
  );

  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
          Live preview
        </span>
        {lastTouched && <span style={{ fontSize: 10, color: "#5E3DB0" }}>edited {lastTouched}</span>}
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
          style={{
            margin: 0, padding: "10px 12px", maxHeight: 240, overflow: "auto",
            fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.5,
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
 * Render `content` as React nodes, wrapping the first occurrence of the last-touched value
 * in a violet highlight. When `lastTouched` is null or not found, returns the plain string.
 * Pure presentation — string-split, no regex injection risk.
 */
function renderWithHighlight(content: string | null, lastTouched: string | null): React.ReactNode {
  if (content == null) return null;
  if (!lastTouched) return content;
  const idx = content.indexOf(lastTouched);
  if (idx < 0) return content;
  const before = content.slice(0, idx);
  const match = content.slice(idx, idx + lastTouched.length);
  const after = content.slice(idx + lastTouched.length);
  return (
    <>
      {before}
      <mark style={{ background: "#EEE7FB", color: "#5E3DB0", borderRadius: 3, padding: "0 2px" }}>{match}</mark>
      {after}
    </>
  );
}
