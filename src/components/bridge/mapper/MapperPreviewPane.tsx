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
   * after the user finishes resolving — they no longer have to switch format tabs to refresh.
   */
  reviewSignal?: number;
}

const FORMAT_EXT: Record<OutputFormatId, string> = {
  csv: "csv", json: "json", xml: "xml", cxml: "xml", ubl: "xml", x12: "txt",
};

const FORMAT_MIME: Record<OutputFormatId, string> = {
  csv: "text/csv", json: "application/json", xml: "application/xml",
  cxml: "application/xml", ubl: "application/xml", x12: "text/plain",
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

export function MapperPreviewPane({ previewOrderId, override, lastTouched, supplierName, emptyHint, cycleFormatSignal, defaultFormat, hot, hotValue, onHotChange, reviewSignal }: MapperPreviewPaneProps) {
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
  // Has the user manually chosen a preview format (toggle / palette cycle)? Until they do, we snap the
  // toggle to the connection's REAL delivered format once the server tells us what it is — so a JSON
  // supplier doesn't sit on a highlighted CSV toggle just because the client-side guess defaulted to CSV.
  const userPickedFormatRef = useRef(false);

  // Command-palette "Switch output format" → advance through PREVIEW_FORMATS. Skip the
  // initial mount (signal undefined/0) so the default CSV view isn't immediately bumped.
  useEffect(() => {
    if (!cycleFormatSignal) return;
    userPickedFormatRef.current = true;
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
          // First time we learn the supplier's real delivered format, snap the toggle to it (unless the
          // user has already picked a format to explore) so the highlighted toggle matches the bytes.
          if (!userPickedFormatRef.current && delivered !== format) {
            setFormat(delivered);
            setDeliveredFormat(delivered);
          }
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
  // reviewSignal is bumped when line-review state changes (e.g. last unresolved line
  // resolved → status flips ready). Without it the pane stays on "Cannot transform:
  // lines still need review" until the user switches format tabs.
  }, [previewOrderId, override, format, connectionFormat, reviewSignal]);

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
          {content && !err && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, background: "#E9F1EA", color: "#1E6D29", fontSize: 10.5, fontWeight: 600 }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M13.5 4.5 6.5 11.5 3 8" stroke="#1E6D29" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Valid
            </span>
          )}
          {lastTouched && <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>edited {lastTouched}</span>}
        </div>
      </div>
      {/* Format + actions bar (46px) — app.jsx §7.1: segmented control left, Copy/Download right. */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 16px", borderBottom: "1px solid #E5E8EE" }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#F1F3F7", borderRadius: 8 }}>
          {PREVIEW_FORMATS.map((f) => {
            const active = format === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => { userPickedFormatRef.current = true; setFormat(f.value); }}
                aria-pressed={active}
                title={active ? `Delivered as ${f.label}` : `Preview as ${f.label}`}
                style={{
                  padding: "4px 9px", borderRadius: 6, cursor: "pointer",
                  fontSize: 11, fontWeight: 600, border: "1px solid transparent",
                  background: active ? "#1E6D29" : "transparent",
                  // --ink-muted, not --ink-faint: the inactive buttons are transparent over
                  // the segmented track's #F1F3F7 (= --surface-2), and #667085 on #F1F3F7 is
                  // 4.4781:1 — a marginal AA fail at this 11px size. #5E6779 is 5.1199:1.
                  // --ink-faint is fine on --bg (4.6439:1); it is the PAIRING with the raised
                  // track that fails, not the token. Same resolution as settings/page.tsx.
                  color: active ? "#FFFFFF" : "var(--ink-muted)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onCopy}
            disabled={!content}
            aria-label="Copy preview"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: content ? "pointer" : "default", fontSize: 11.5, fontWeight: 600, border: 0, background: "transparent", color: copied ? "#1E6D29" : content ? "#5E6779" : "#AEB6C4" }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!content}
            aria-label="Download preview"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: content ? "pointer" : "default", fontSize: 11.5, fontWeight: 600, border: 0, background: "transparent", color: content ? "#5E6779" : "#AEB6C4" }}
          >
            Download
          </button>
        </div>
      </div>

      {/* B4 format-toggle sub — one plain line explaining that this preview is the exact
          delivered document, and that the format buttons above switch the previewed output
          type. Calm + muted; sits directly under the segmented control it describes. */}
      <div style={{ flexShrink: 0, padding: "8px 16px", fontSize: 11, color: "#5E6779", background: "#FBFBFD", borderBottom: "1px solid #EEF0F4", lineHeight: 1.5 }}>
        This is exactly what {supplierName ? supplierName : "the supplier"} receives. Switch formats to preview a different output type.
      </div>

      {info && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "#5E6779", background: "#EEF3FB", borderBottom: "1px solid #D5E3F6", lineHeight: 1.5 }}>
          {info}
        </div>
      )}

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

      {!previewOrderId ? (
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
            background: "#0B1A2F", color: "#C8D1E0", whiteSpace: "pre-wrap", wordBreak: "break-word",
            borderTop: "1px solid #1F3252",
            opacity: busy ? 0.55 : 1, transition: "opacity 150ms",
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
