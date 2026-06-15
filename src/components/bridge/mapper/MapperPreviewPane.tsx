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
import { shouldHonorFormat, previewInfoNote } from "./previewFormatModel";

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
  /**
   * The connection's REAL output format (model.outputFormat). The toggle seeds from this so a
   * JSON supplier doesn't default to a CSV mismatch. Null/undefined → CSV (legacy default).
   */
  defaultFormat?: OutputFormatId | null;
}

const FORMAT_EXT: Record<OutputFormatId, string> = {
  csv: "csv", json: "json", xml: "xml", cxml: "xml", ubl: "xml", x12: "txt",
};

const FORMAT_MIME: Record<OutputFormatId, string> = {
  csv: "text/csv", json: "application/json", xml: "application/xml",
  cxml: "application/xml", ubl: "application/xml", x12: "text/plain",
};

export function MapperPreviewPane({ previewOrderId, override, lastTouched, supplierName, emptyHint, cycleFormatSignal, defaultFormat }: MapperPreviewPaneProps) {
  // Seed the toggle from the connection's REAL output format so a JSON supplier doesn't open
  // on a CSV mismatch. The backend (revision authority) may still swap to the pinned format —
  // deliveredFormat tracks what it actually rendered, and the header/copy/download follow that.
  const [format, setFormat] = useState<OutputFormatId>(defaultFormat ?? "csv");
  // The format the SERVER actually rendered (res.format). Drives the header label, copy/download
  // extension+mime, and the info note. In the DEFAULT (delivered-bytes) mode this is the connection's
  // real delivered format; in EXPLORATORY mode it equals the toggle.
  const [deliveredFormat, setDeliveredFormat] = useState<OutputFormatId>(defaultFormat ?? "csv");
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // The connection's REAL delivered format, learned authoritatively from a DEFAULT-mode (honorFormat
  // off) server response. We seed it from defaultFormat and refine it the first time the server tells
  // us what it actually delivers — so the exploratory label can honestly say "the supplier receives Y".
  const connectionFormatRef = useRef<OutputFormatId | null>(defaultFormat ?? null);
  // What the supplier actually receives, for the honest exploratory label. Kept in state so the label
  // re-renders when we learn it. Null until we know (no pinned/delivered format to diverge from).
  const [connectionFormat, setConnectionFormat] = useState<OutputFormatId | null>(defaultFormat ?? null);

  // Command-palette "Switch output format" → advance through PREVIEW_FORMATS. Skip the
  // initial mount (signal undefined/0) so the default CSV view isn't immediately bumped.
  useEffect(() => {
    if (!cycleFormatSignal) return;
    setFormat((f) => nextOutputFormat(f));
  }, [cycleFormatSignal]);

  // ~300ms debounce on (override, format) — fast enough to feel live as the user wires.
  //
  // TWO MODES:
  //   • DEFAULT (delivered bytes) — the toggle is on the connection's real delivered format (or we
  //     don't yet know it). honorFormat=false; the backend, under revision authority, renders exactly
  //     the bytes the supplier receives. We capture the server's reported format as the authoritative
  //     "connection delivered format" so the exploratory label can be honest.
  //   • EXPLORATORY ("what would this look like as X") — the user picked a format different from the
  //     connection's delivered one. honorFormat=true; the backend SKIPS the pinned-revision swap and
  //     renders the requested format from the canonical order. Delivery is unaffected; we label it
  //     clearly as "not the delivered format".
  //
  // We ALWAYS show what the server rendered and track the format it actually delivered, so the
  // header/copy/download follow the real bytes. Genuine warnings/errors (e.g. "lines still need
  // review") pass through honestly as the warning, with content=null handled below.
  useEffect(() => {
    if (!previewOrderId) { setContent(null); setErr(null); setInfo(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    // Opt into exploratory rendering only when we KNOW a delivered format to diverge from.
    const known = connectionFormatRef.current;
    const honor = shouldHonorFormat(format, known);
    const t = setTimeout(async () => {
      try {
        const res = await previewMappingOverride(previewOrderId, override, format, honor);
        if (cancelled) return;
        const delivered = ((res.format ?? format) as string).toLowerCase() as OutputFormatId;
        const hardMessage = res.error ?? res.warning ?? null;
        setDeliveredFormat(delivered);
        setContent(res.content);
        setErr(hardMessage);
        // In DEFAULT mode the server's reported format IS the connection's real delivered format —
        // learn it authoritatively so the exploratory label can name what the supplier receives.
        if (!honor) {
          connectionFormatRef.current = delivered;
          setConnectionFormat(delivered);
        }
        setInfo(previewInfoNote({
          honored: honor,
          selected: format,
          delivered,
          connectionFormat: known,
          hasHarderMessage: hardMessage != null,
        }));
      } catch (e) {
        if (!cancelled) { setContent(null); setErr(e instanceof Error ? e.message : "Preview failed"); setInfo(null); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [previewOrderId, override, format, connectionFormat]);

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
    // Use the format the server actually rendered (deliveredFormat) so the file extension+mime
    // match the bytes — never label JSON bytes as .csv just because the toggle still reads CSV.
    const blob = new Blob([content], { type: FORMAT_MIME[deliveredFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preview.${FORMAT_EXT[deliveredFormat]}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [content, deliveredFormat]);

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
            Live preview · {deliveredFormat.toUpperCase()}
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

      {info && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "#56627A", background: "#EEF3FB", borderBottom: "1px solid #D5E3F6", lineHeight: 1.5 }}>
          {info}
        </div>
      )}

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
            // The docked live preview is the document operators read most, but the T7 sizing
            // (13px / 420 tall) made it over-prominent for a side-dock; right-sized to a calm
            // 12px / 300 so it reads as a companion, not a second hero column.
            margin: 0, padding: "12px 14px", maxHeight: 300, overflow: "auto",
            fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.55,
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
