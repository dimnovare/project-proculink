"use client";

// MapperPreviewPane — the collapsible live OUTPUT preview (Task 10). It renders the
// delivered document AS THE USER WIRES, reusing the shipped previewMappingOverride endpoint
// with a ~400ms debounce cadence.
//
//   • format label       — the header names the format the server rendered (`res.format`).
//     The flow decides the format, so the pane offers no toggle (removed 2026-11-14: the
//     flow preview ignored it, so it changed nothing).
//   • just-touched highlight — the model passes the last-edited field key; the matching
//     token in the rendered text is highlighted so the user sees their edit land.
//   • copy / download    — copy the preview to the clipboard or save it as a file (the
//     extension follows the rendered format).
//   • inline error       — the endpoint returns HTTP 200 { ok:false, error } for template
//     render failures; we surface it amber, never crash.
//
// The only host is the flow variant, whose adapter supplies `preview`; when there is nothing
// to preview against we show the empty state (not an error) — offer⇔works.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrderMappingOverride, OutputFormatId } from "@/lib/api/types";
import { splitForHighlight } from "./previewHighlightModel";
import { previewBodyStyle } from "./previewBodyStyle";
import type { MapperAdapter } from "./types";

export interface MapperPreviewPaneProps {
  /** The live draft override (preview re-runs when it changes). */
  override: OrderMappingOverride;
  /** The last field key the user touched — highlighted in the rendered output. */
  lastTouched: string | null;
  /** Supplier/connection display name — drives the "what {name} receives" header. */
  supplierName?: string;
  /** connection variant with no sample order → show the honest empty state, not an error. */
  emptyHint?: string;
  /**
   * The connection's REAL output format (model.outputFormat). Seeds the header label until the
   * server reports the format it rendered. Null/undefined → CSV (legacy default).
   */
  defaultFormat?: OutputFormatId | null;
  /** The hovered/active field id (cross-column highlight) — its matching output line lights green. */
  hot?: string | null;
  /**
   * The RESOLVED VALUE of the hovered output field. The canonical output PATH (`hot`) does not
   * appear verbatim in a structured document (cXML/XML/UBL emit their own tags), so matching on
   * the path alone lit nothing there. The value DOES appear in the rendered output for every
   * format, so the pane matches value-first, path-second — making the hover→preview highlight
   * work reliably across CSV/JSON/XML/cXML/UBL/X12. Null → fall back to the path/last-touched key.
   */
  hotValue?: string | null;
  /** Hovering a preview line re-asserts the hot field (bidirectional cross-highlight). */
  onHotChange?: (id: string | null) => void;
  /**
   * Bumped when the order's line-review state changes (e.g. the last unresolved line is
   * resolved and status flips to ready). Including this in the effect deps re-triggers the
   * preview fetch so the pane doesn't sit on "Cannot transform: lines still need review"
   * after the user finishes resolving.
   */
  reviewSignal?: number;
  /** The only data source; absent → the empty state. */
  preview?: MapperAdapter["preview"];
}

const FORMAT_EXT: Record<OutputFormatId, string> = {
  csv: "csv", json: "json", xml: "xml", cxml: "xml", ubl: "xml", x12: "txt", pdf: "pdf",
};

const FORMAT_MIME: Record<OutputFormatId, string> = {
  csv: "text/csv", json: "application/json", xml: "application/xml",
  cxml: "application/xml", ubl: "application/xml", x12: "text/plain", pdf: "application/pdf",
};

/**
 * B4 plain-language copy for when a field the operator expected isn't emitted by the
 * currently-selected output format (e.g. a cXML-only block while previewing CSV). Additive
 * copy helper — states plainly that the field only belongs to other formats, so
 * "unavailable in {format}" stops reading as an error.
 */
export function formatFieldUnavailableNote(format: OutputFormatId): string {
  return `This field isn't part of ${format.toUpperCase()} output — it only applies to other formats.`;
}

export function MapperPreviewPane({ override, lastTouched, supplierName, emptyHint, defaultFormat, hot, hotValue, onHotChange, reviewSignal, preview }: MapperPreviewPaneProps) {
  // The format the SERVER actually rendered (res.format), seeded from the connection's real
  // output format. Drives the header label and the copy/download extension+mime.
  const [deliveredFormat, setDeliveredFormat] = useState<OutputFormatId>(defaultFormat ?? "csv");
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // ~300ms debounce on override — fast enough to feel live as the user wires. We show what the
  // server rendered and track the format it reports, so the header/copy/download follow the real
  // bytes. Genuine warnings/errors (e.g. "lines still need review") pass through honestly as the
  // warning, with content=null handled below.
  useEffect(() => {
    if (!preview) { setContent(null); setErr(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await preview(override);
        if (cancelled) return;
        const delivered = ((res.format ?? defaultFormat ?? "csv") as string).toLowerCase() as OutputFormatId;
        setDeliveredFormat(delivered);
        setContent(res.content);
        setErr(res.error ?? res.warning ?? null);
      } catch (e) {
        if (!cancelled) { setContent(null); setErr(e instanceof Error ? e.message : "Preview failed"); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  // reviewSignal is bumped when line-review state changes (e.g. last unresolved line
  // resolved → status flips ready). Without it the pane stays on "Cannot transform:
  // lines still need review" until the override changes.
  }, [preview, override, defaultFormat, reviewSignal]);

  const onCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked (insecure context / permission) — silently ignore; download still works.
    }
  }, [content]);

  const onDownload = useCallback(() => {
    if (!content) return;
    // Use the format the server actually rendered (deliveredFormat) so the file extension+mime
    // match the bytes — never label JSON bytes as .csv.
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

  // Build the highlighted render: isolate the OUTPUT LINE mentioning the hovered/last-touched
  // field so the user's edit + hover visibly land.
  // Handoff §7 cross-highlight: the hovered field (hot, from any column) lights its matching
  // output line green; falls back to the last-edited field so an edit still visibly lands.
  //
  // NEEDLE precedence (the founder's "hover highlight doesn't work" fix): the field's resolved
  // VALUE (hotValue) is tried FIRST because it appears verbatim in every rendered format
  // (CSV/JSON/XML/cXML/UBL/X12); the canonical PATH (hot) is the fallback (it only appears in
  // flat formats' header rows). lastTouched is the final fallback so an edit still flashes.
  // RE-ASSERT id: hovering the lit preview line must re-assert the FIELD id (hot / lastTouched),
  // never the raw value — otherwise setHoveredId(value) would break the bidirectional link.
  const reassertId = hot ?? lastTouched;
  const highlightNeedle = useMemo(() => {
    // Prefer the value only when it actually occurs in the rendered document; otherwise the
    // path/key. This keeps CSV (path in the header row) working while fixing structured formats.
    if (hotValue && content && content.includes(hotValue)) return hotValue;
    return hot ?? lastTouched;
  }, [hotValue, content, hot, lastTouched]);
  const onReassert = useCallback(() => onHotChange?.(reassertId), [onHotChange, reassertId]);
  const highlighted = useMemo(
    () => renderWithHighlight(content, highlightNeedle, onReassert),
    [content, highlightNeedle, onReassert],
  );

  // ── WP-28 / DB-4 "make the three-column relationship obvious" ───────────────
  // The cross-column link already worked: hovering a received field or an output
  // row resolves to the output line the preview should light. What made it read
  // as broken is that the preview is a SCROLLING <pre> — for any order longer
  // than the visible code area, the highlight fired on a line the operator could
  // not see, so hovering appeared to do nothing.
  //
  // `block: "nearest"` means an already-visible line does not move at all, so the
  // common case is byte-identical to today; only an off-screen match scrolls.
  const codeRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (!highlightNeedle) return;
    const el = codeRef.current?.querySelector("[data-preview-hot]");
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [highlightNeedle, content]);

  // The backend returns content: null + a "…lines still need review / cannot transform"
  // message while any line is unresolved (it will NOT emit a half-valid document — offer⇔works).
  // Detect that so the code body shows a calm, HONEST "preview available once resolved" state
  // instead of a terse "(no preview)". We never claim the order is transformable when it isn't.
  const reviewBlocked = content == null && !busy && err != null && /review|transform|resolve/i.test(err);

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
    <div style={{ border: "1px solid #E5E8EE", background: "#FBFBFD", overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* ColHead (supplier) — identical 52px header to the received/output panes so the three
          column heads form ONE connected strip (app.jsx §5.5/§5.8). */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 18px", borderBottom: "1px solid #E5E8EE", background: "#E9F1EA44" }}>
        <span aria-hidden style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", background: "#2E8E3A", boxShadow: "0 0 0 3px #E9F1EA" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: "#0B1A2F", whiteSpace: "nowrap" }}>
            Live preview · {deliveredFormat.toUpperCase()}
          </span>
          <span style={{ fontSize: 10.5, color: "#5E6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {supplierName ? `exactly what ${supplierName} receives` : "exactly what the supplier receives"}
          </span>
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* WHAT THIS CHIP IS ALLOWED TO SAY.
              Its entire evidence is the condition it is gated on — `content && !err`,
              i.e. "the transform endpoint returned a non-empty document and did not
              fail". That is a fact about PRODUCTION, not a verdict, and the word chosen
              here has to stay true for the WEAKEST format this pane renders, not the
              strongest. PREVIEW_FORMATS is csv/json/xml/cxml/ubl/x12, and the first
              three have no named standard profile at all — ConformanceService
              .ProfileForFormat returns null for them ("Xml / Csv / Json are generic
              supplier templates with no named standard profile"), so there is nothing
              they could have been checked against even in principle.

              Until 2026-08-14 this said "Valid", in forest green, behind a tick, sitting
              directly under "Live preview · {FORMAT}" and "exactly what {supplier}
              receives" — a stronger claim than the real standards check makes two screens
              over ("Checks passed"), on strictly less evidence, on the screen an operator
              reads most. Neutral fill and no tick are both deliberate: green is this
              the pass colour here and a tick is the glyph for "passed a check", and no
              check ran. The band under the format bar carries the other half of the
              sentence — what has NOT happened — so the denial is on the screen and not
              merely implied by a missing badge. */}
          {content && !err && (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, background: "#F1F3F7", color: "#5E6779", fontSize: 10.5, fontWeight: 600 }}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M9.2 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6.3z" stroke="#5E6779" strokeWidth="1.6" strokeLinejoin="round" /></svg>
              Generated
            </span>
          )}
          {lastTouched && <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>edited {lastTouched}</span>}
        </div>
      </div>
      {/* Actions bar (46px) — Copy/Download right. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 16px", borderBottom: "1px solid #E5E8EE" }}>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onCopy}
            disabled={!content}
            aria-label="Copy preview"
            style={{ display: "inline-flex", alignItems: "center", minHeight: 24, gap: 5, cursor: content ? "pointer" : "default", fontSize: 11.5, fontWeight: 600, border: 0, background: "transparent", color: copied ? "#1E6D29" : content ? "#5E6779" : "#AEB6C4" }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!content}
            aria-label="Download preview"
            style={{ display: "inline-flex", alignItems: "center", minHeight: 24, gap: 5, cursor: content ? "pointer" : "default", fontSize: 11.5, fontWeight: 600, border: 0, background: "transparent", color: content ? "#5E6779" : "#AEB6C4" }}
          >
            Download
          </button>
        </div>
      </div>

      {/* B4 sub — one plain line explaining that this preview is the exact delivered
          document. Calm + muted; sits directly under the actions bar.

          The third sentence is the other half of the "Generated" chip above: the chip states
          what happened, this states what did not. It is unconditional because it is true for
          every one of PREVIEW_FORMATS — this pane runs no check on any format, and three of
          the six have no standard to be checked against. Saying it out loud is the point:
          the recurring defect in this repo is an absent answer rendering as the favourable one,
          and a missing badge is exactly that shape. */}
      <div style={{ flexShrink: 0, padding: "8px 16px", fontSize: 11, color: "#5E6779", background: "#FBFBFD", borderBottom: "1px solid #EEF0F4", lineHeight: 1.5 }}>
        This is exactly what {supplierName ? supplierName : "the supplier"} receives. Producing this document is not a check — nothing here has been checked against a standard.
      </div>

      {err && (
        <div
          // --amber-text (#8A5310), not the one-off #9A6B00 this used to carry:
          // #9A6B00 on #FFF7E6 is 4.3999:1, under the 4.5:1 floor. #8A5310 is
          // 5.9237:1 on the same fill. Fill and border are unchanged. Same
          // migration MapperWorkbench.tsx already made for its amber surfaces.
          style={{ padding: "8px 12px", fontSize: 11, color: "var(--amber-text)", background: "#FFF7E6", borderBottom: "1px solid #F1E2BE" }}
        >
          {err}
        </div>
      )}

      {!preview ? (
        <div style={{ padding: "16px 12px", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {emptyHint ?? "No sample order to preview yet — upload or pick a sample to see the delivered output."}
        </div>
      ) : (
        <pre
          ref={codeRef}
          aria-live="polite"
          // A scrolling region with no focusable content inside it is unreachable by
          // keyboard: a mouse user scrolls the preview, a keyboard user cannot even
          // get to it (axe `scrollable-region-focusable`, WCAG 2.1.1). tabIndex={0}
          // puts it in the tab order so arrow keys / Page Up / Page Down scroll it,
          // and role+aria-label give it the name a screen reader announces on
          // arrival — a focus stop with no name is only half a fix. Same shape as
          // SupplierDockProfile.tsx's tab body.
          tabIndex={0}
          role="region"
          aria-label="Supplier-ready output preview"
          className={flash ? "mapper-preview-flash" : undefined}
          style={{
            // The docked live preview is the document operators read most, but the T7 sizing
            // (13px / 420 tall) made it over-prominent for a side-dock; right-sized to a calm
            // 12px / 300 so it reads as a companion, not a second hero column.
            // Design-system v1 (handoff §7): the code body is the signature dark "this is what
            // the supplier receives" surface — light mono on navy, the same navy as the sidebar.
            margin: 0, padding: "14px 4px 24px", flex: 1, minHeight: 0, overflow: "auto",
            fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 11.5, lineHeight: 1.95,
            background: "#0B1A2F", whiteSpace: "pre-wrap", wordBreak: "break-word",
            borderTop: "1px solid #1F3252",
            // Refreshing is a COLOUR change, never `opacity`. Element opacity drags this
            // block's light text AND its navy background toward the page behind it, and the
            // pair collapsed to 3.16:1 — see previewBodyStyle.ts for the measurement.
            ...previewBodyStyle(busy),
          }}
        >
          {content == null
            ? (busy
                ? "Rendering…"
                : reviewBlocked
                  ? (
                    <span style={{ color: "#8FA0B8", fontStyle: "normal" }}>
                      {`Preview available once all lines are resolved.\nResolve the remaining issues in the Issues panel above to\nsee exactly what ${supplierName ?? "the supplier"} receives.`}
                    </span>
                  )
                  : "(no preview)")
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
function renderWithHighlight(content: string | null, needle: string | null, onReassert?: () => void): React.ReactNode {
  if (content == null) return null;
  const { before, match, after } = splitForHighlight(content, needle);
  if (!match) return content;
  // Handoff §7 cross-highlight: the matching output line gets a green line-level wash with an
  // inset 2px green left bar + brighter text on the navy code body. Hovering the line re-asserts
  // the hovered FIELD id (not the raw value) so the highlight is bidirectional with the received
  // card, output row, and wire.
  return (
    <>
      {before}
      <mark
        data-preview-hot=""
        onMouseEnter={() => onReassert?.()}
        style={{
          background: "rgba(46,142,58,0.22)", color: "#EAF6EC",
          borderLeft: "2px solid #1E6D29", paddingLeft: 4, marginLeft: -6,
          borderRadius: 0, display: "inline",
        }}
      >
        {match}
      </mark>
      {after}
    </>
  );
}
