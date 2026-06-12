"use client";

// ContextStage — the full per-card context surface of the Triage sub-view
// (batch 9 Phase C; spec §2). For the selected Fix Queue card it shows:
//   breadcrumb → SOURCE zone crop → CANONICAL line row + the SAME extracted
//   controls the classic spine binds → OUTPUT fragment (OutputPreview with the
//   format-honesty rules) → "Acceptance rules affecting this line" strip,
// with mini-wires connecting source → canonical → output.
//
// Invariants:
//   • Wire-geometry contract (gate G5): anchors come from computeStageWires,
//     which delegates to the EXPORTED SpineConnectors pure fns
//     (fallbackSourceAnchor + orderWiresForRender). The wire-layer files are
//     untouched and this overlay never draws on the triptych.
//   • Honesty (gate G6): the source crop renders only for document sources
//     (csv/xlsx/pdf) — API/EDI-ingested orders get an explicit "No source
//     snippet available" fallback; the output fragment obeys
//     cXML-only-when-configured; rules come from the real validation result.
//   • Single-path (gate G2): every control routes through useResolveActions —
//     nothing here marks a line resolved locally.

import { useLayoutEffect, useRef, useState, useCallback, type ReactNode } from "react";
import type { Order, OrderLine } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { StandardsFieldPopover } from "../StandardsFieldPopover";
import { AiSuggestionContent } from "./AiSuggestionContent";
import { ManualCodeRow, type LineEditApi } from "./ManualCodeRow";
import { KbdLight } from "./Kbd";
import { OutputPreview } from "./OutputPreview";
import { formatMoney } from "./orderDisplay";
import type { FixQueueCard } from "./buildFixQueue";
import type { ResolveActionsApi } from "./hooks/useResolveActions";
import type { AcceptanceValidationApi } from "./hooks/useAcceptanceValidation";
import {
  NODE_TO_FIELD,
  sourceZoneForCard,
  outputHeaderIdForCard,
  snippetKindForSource,
  sourceIngestLabel,
  rulesAffectingLine,
  computeStageWires,
  type StageBox,
} from "./stageModel";

const KIND_LABEL: Record<FixQueueCard["kind"], string> = {
  "ai-suggestion": "AI suggestion",
  "manual-code":   "Needs a supplier code",
  "review-flag":   "Flagged for review",
  "rule-failure":  "Acceptance rule",
};

// Gutter x-offset for the stacked wire rail (px, container-local).
const GUTTER_X = 11;

// ── Source zone crop ──────────────────────────────────────────────────────────
// A compact, document-styled snippet of the zone the selected issue originates
// from — reconstructed from parsed fields (same honesty label as
// DocumentAnatomy). For line cards: the line's table row with one row of
// context either side. For header-level cards: the matching header zone line.

function SourceZoneCrop({ order, zone, line }: {
  order: Order;
  zone: string;
  line: OrderLine | null;
}) {
  const dateLabel = order.orderDate || "—";

  let body: ReactNode;
  if (zone === "lines") {
    if (order.lines.length === 0) {
      body = <div style={{ fontSize: 9.5, color: "#888", fontStyle: "italic" }}>No line items parsed yet.</div>;
    } else {
      // Selected line ± one neighbour, selected highlighted.
      const sorted = [...order.lines].sort((a, b) => a.lineNumber - b.lineNumber);
      const idx = line ? sorted.findIndex(l => l.id === line.id) : 0;
      const from = Math.max(0, idx - 1);
      const rows = sorted.slice(from, Math.min(sorted.length, from + 3));
      // table-layout:fixed + a generous description column lets the description
      // WRAP (up to ~2 lines) instead of clipping to a near-zero cell ("D.");
      // the full text is always available via the cell title tooltip.
      body = (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 22 }} />
            <col style={{ width: "30%" }} />
            <col />
            <col style={{ width: 34 }} />
          </colgroup>
          <tbody>
            {rows.map((l) => {
              const isSel = line != null && l.id === line.id;
              const desc = l.description ?? "—";
              return (
                <tr key={l.id} style={isSel ? { background: "rgba(46,142,58,0.08)", outline: "1.5px solid #2E8E3A" } : undefined}>
                  <td style={{ padding: "3px 4px", borderBottom: "1px dotted #E0E0E0", color: "#888", verticalAlign: "top" }}>{l.lineNumber}</td>
                  <td style={{ padding: "3px 4px", borderBottom: "1px dotted #E0E0E0", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "top" }} title={l.buyerItemCode}>{l.buyerItemCode}</td>
                  <td style={{ padding: "3px 6px", borderBottom: "1px dotted #E0E0E0", overflow: "hidden", verticalAlign: "top", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={desc}>{desc}</td>
                  <td style={{ padding: "3px 4px", borderBottom: "1px dotted #E0E0E0", textAlign: "right", whiteSpace: "nowrap", color: "#555", verticalAlign: "top" }}>×{l.quantity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
  } else if (zone === "parties") {
    body = <div style={{ fontSize: 9.5 }}>Buyer: {order.buyerName ?? "—"} · Supplier: {order.supplierName}</div>;
  } else if (zone === "terms") {
    body = <div style={{ fontSize: 9.5 }}>Currency: {order.currency} · {order.lines.length} line{order.lines.length !== 1 ? "s" : ""}</div>;
  } else if (zone === "totals") {
    body = (
      <div style={{ fontSize: 9.5, fontWeight: 700, textAlign: "right" }}>
        Grand total: {formatMoney(order.currency, order.grandTotal ?? order.lines.reduce((s, l) => s + Number(l.unitPrice) * Number(l.quantity), 0))}
      </div>
    );
  } else {
    // header / header-meta — buyer name + "PURCHASE ORDER po# · date" line.
    body = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "Inter,sans-serif", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {order.buyerName ?? "Buyer (parsing…)"}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, flexShrink: 0 }}>
          PURCHASE ORDER {order.poNumber} · {dateLabel}
        </span>
      </div>
    );
  }

  return (
    <div data-testid="source-zone-crop" style={{ borderRadius: 9, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE", minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 7 }}>
        Source · reconstructed from parsed fields
      </div>
      <div style={{ borderRadius: 6, background: "#FFFFFF", padding: "9px 11px", fontFamily: "'Times New Roman',serif", color: "#1a1a1a", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #ECEFF4", minWidth: 0, overflow: "hidden" }}>
        {body}
      </div>
    </div>
  );
}

/** Honest fallback when the order has no document source to crop (API/EDI). */
function NoSourceSnippet({ sourceFileKey }: { sourceFileKey: string | null | undefined }) {
  return (
    <div data-testid="source-zone-crop" style={{ borderRadius: 8, padding: "12px 12px", background: "#F6F7FA", border: "1px dashed #D5DAE3" }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#56627A", marginBottom: 3 }}>No source snippet available</div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.45 }}>
        This order arrived via {sourceIngestLabel(sourceFileKey)} — there is no document page to crop.
        The parsed values below are the source of truth.
      </div>
    </div>
  );
}

// ── Acceptance-rules strip ────────────────────────────────────────────────────

function LineRulesStrip({ validation, lineNumber }: {
  validation: AcceptanceValidationApi;
  lineNumber: number | null | undefined;
}) {
  const rows = rulesAffectingLine(validation.validationResult, lineNumber);
  return (
    <div data-testid="line-rules-strip" style={{ marginTop: 12, borderTop: "1px dashed #E2E6EE", paddingTop: 9 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", marginBottom: 6 }}>
        Acceptance rules affecting this line
      </div>
      {validation.validationResult == null ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
          Not validated yet — run “Validate against profile” to see which rules apply.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>No acceptance rules flag this line.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((r, i) => (
            <div key={`${r.fieldPath}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 11.5 }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, alignSelf: "center", background: r.passed ? "#2E8E3A" : r.severity === "warning" ? "#C97A14" : "#C53A3A" }} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#0B1A2F", flexShrink: 0 }}>{r.fieldPath}</span>
              <span style={{ color: "#56627A", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message ?? (r.passed ? "passes" : "failing")}</span>
              <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10, fontWeight: 700, color: r.passed ? "#1E6D29" : r.severity === "warning" ? "#C97A14" : "#C53A3A" }}>
                {r.passed ? "pass" : r.severity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mini-wires overlay ────────────────────────────────────────────────────────
// Measures the three stage panels and draws source→canonical→output connectors.
// Anchor placement is delegated to computeStageWires (exported SpineConnectors
// contract); this overlay only paints. Re-measures via ResizeObserver and
// commits state ONLY when the rounded geometry changed (no update loops).

interface MiniWire { id: string; sx: number; sy: number; tx: number; ty: number; oi: number }

function useStageWires(wide: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const canonicalRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const [wires, setWires] = useState<MiniWire[]>([]);
  const sigRef = useRef("");

  const measure = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const cb = c.getBoundingClientRect();
    const box = (el: HTMLElement | null): StageBox | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { top: r.top - cb.top, bottom: r.bottom - cb.top, left: r.left - cb.left, right: r.right - cb.left };
    };
    const src = box(sourceRef.current);
    const can = box(canonicalRef.current);
    const out = box(outputRef.current);

    // Stacked: wires run down the left gutter, so the panels' boxes are
    // narrowed to the gutter line; wide: full panel boxes (horizontal hops).
    const gutterise = (b: StageBox | null): StageBox | null =>
      b ? { ...b, left: GUTTER_X, right: GUTTER_X } : null;
    const canonicalAnchorY = can ? can.top + 16 : null;

    const computed = computeStageWires(
      wide
        ? { source: src, canonical: can, output: out }
        : { source: gutterise(src), canonical: gutterise(can), output: gutterise(out) },
      canonicalAnchorY,
      null,
    ).map(({ wire, oi }) => {
      // Downstream attach point: wide mode hops to the panel's left edge at the
      // computed anchor y; stacked mode drops down the gutter to the next
      // panel's gutter dot.
      if (wide) return { ...wire, oi };
      const target = wire.id === "src" ? can : out;
      return { ...wire, tx: GUTTER_X, ty: target ? target.top + 16 : wire.ty, oi };
    });

    const sig = computed.map(w => `${w.id}:${Math.round(w.sx)},${Math.round(w.sy)},${Math.round(w.tx)},${Math.round(w.ty)}`).join("|");
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setWires(computed);
  }, [wide]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    [containerRef, sourceRef, canonicalRef, outputRef].forEach(r => { if (r.current) ro.observe(r.current); });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  return { containerRef, sourceRef, canonicalRef, outputRef, wires };
}

function StageWireSvg({ wires, wide }: { wires: MiniWire[]; wide: boolean }) {
  if (wires.length === 0) return null;
  return (
    <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
      {wires.map((w) => {
        const stroke = w.id === "src" ? "#1E66C9" : "#2E8E3A";
        const d = wide
          ? `M ${w.sx} ${w.sy} C ${w.sx + 22} ${w.sy} ${w.tx - 22} ${w.ty} ${w.tx} ${w.ty}`
          : `M ${w.sx} ${w.sy} C ${w.sx} ${w.sy + 14} ${w.tx} ${w.ty - 14} ${w.tx} ${w.ty}`;
        return (
          <g key={w.id}>
            <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} />
            <circle cx={w.sx} cy={w.sy} r={2.6} fill={stroke} />
            <circle cx={w.tx} cy={w.ty} r={2.4} fill="#FFFFFF" stroke={stroke} strokeWidth={1.4} />
          </g>
        );
      })}
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export interface ContextStageProps {
  order: Order;
  orderId: string;
  labels: PartyLabels;
  selected: FixQueueCard;
  selectedLine: OrderLine | null;
  lineEdit: LineEditApi;
  resolve: ResolveActionsApi;
  validation: AcceptanceValidationApi;
  onSkip: () => void;
  /** The selected card's primary control — focus auto-advance target. */
  setPrimaryControl: (el: HTMLButtonElement | null) => void;
  crossed: boolean;
  fieldValues: Record<string, string>;
  onOutputAction: (message: string) => void;
  /** ≥1920px: stage panels render side-by-side instead of stacked. */
  wide?: boolean;
  /** Render without the outer card chrome (mobile accordion inlines the stage). */
  bare?: boolean;
}

export function ContextStage({
  order, orderId, labels, selected, selectedLine,
  lineEdit, resolve, validation, onSkip, setPrimaryControl,
  crossed, fieldValues, onOutputAction, wide = false, bare = false,
}: ContextStageProps) {
  const { containerRef, sourceRef, canonicalRef, outputRef, wires } = useStageWires(wide);

  const zone = sourceZoneForCard(selected);
  const snippetKind = snippetKindForSource(order.sourceFileKey);
  const headerFragmentId = outputHeaderIdForCard(selected);
  // Canonical field for the StandardsFieldPopover: line cards map to "Lines";
  // header-level rule cards map through the zone→node heuristic when possible.
  const canonicalField = selected.lineNumber != null || selected.kind !== "rule-failure"
    ? NODE_TO_FIELD["lines"]
    : headerFragmentId ? NODE_TO_FIELD[headerFragmentId] ?? null : null;

  const breadcrumb = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid #EEF0F4" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }} data-testid="stage-breadcrumb">
        {selected.lineNumber != null ? `Line ${selected.lineNumber}` : selected.headerLevel ? "Order header" : "Acceptance rule"}
      </span>
      <span style={{ fontSize: 10.5, color: "#C6CDDA" }}>·</span>
      <span style={{ fontSize: 10.5, color: "#56627A", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {selected.kind === "ai-suggestion" ? KIND_LABEL[selected.kind] : selected.title}
      </span>
      <button
        type="button"
        onClick={onSkip}
        aria-label="Skip — keep flagged, move to the next issue"
        title="Skip — keep flagged (S). The issue stays open and still blocks Send."
        style={{
          marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 10.5, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
          border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A",
          cursor: "pointer", minHeight: 26,
        }}
      >
        Skip — keep flagged
        <KbdLight>S</KbdLight>
      </button>
    </div>
  );

  // ── Canonical panel content (the SAME extracted controls the classic binds) ──
  let canonicalContent: ReactNode;
  if (selectedLine) {
    canonicalContent = (
      <>
        {/* Canonical line row — same information shape as the classic spine row. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#A8B0BF" }}>
              {selectedLine.lineNumber}
            </span>
            {canonicalField && <StandardsFieldPopover canonicalField={canonicalField} label="Line items" />}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", minWidth: 0 }}>
            {selectedLine.description ?? selectedLine.buyerItemCode}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#A8B0BF" }}>
            <span>{selectedLine.buyerItemCode}</span>
            <span style={{ color: "#C6CDDA" }}>·</span>
            <span>×{selectedLine.quantity}</span>
            {selectedLine.lineAmount != null && (
              <>
                <span style={{ color: "#C6CDDA" }}>·</span>
                <span title="Line amount">{formatMoney(order.currency, selectedLine.lineAmount)}</span>
              </>
            )}
          </span>
          <span style={{ marginLeft: "auto", flexShrink: 0 }}>
            {selectedLine.supplierItemCode ? (
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: "#1E6D29" }}>{selectedLine.supplierItemCode}</span>
            ) : (
              <span style={{ fontSize: 10.5, fontWeight: 700, background: "#FBE3E3", color: "#C53A3A", borderRadius: 4, padding: "1px 6px" }}>missing</span>
            )}
          </span>
        </div>

        {/* Controls — the SAME extracted components the classic spine binds. */}
        <div style={{ marginTop: 12 }}>
          {selected.kind === "ai-suggestion" && selectedLine.aiSuggestion && (
            <AiSuggestionContent
              sn={{
                id: selectedLine.id,
                lineNo: selectedLine.lineNumber,
                sku: selectedLine.buyerItemCode,
                pct: Math.round(selectedLine.aiSuggestion.confidence * 100),
                aiSuggestedCode: selectedLine.aiSuggestion.supplierItemCode,
                aiReason: selectedLine.aiSuggestion.reason,
              }}
              showAcceptKbd
              showManualKbd
              accepting={resolve.acceptingLineId === selectedLine.id}
              onAccept={resolve.acceptSuggestion}
              lineEdit={lineEdit}
              acceptButtonRef={setPrimaryControl}
            />
          )}

          {selected.kind === "manual-code" && (
            lineEdit.editId === selectedLine.id ? (
              <ManualCodeRow
                sn={{ id: selectedLine.id, lineNo: selectedLine.lineNumber, sku: selectedLine.buyerItemCode }}
                lineEdit={lineEdit}
                saving={resolve.acceptingLineId === selectedLine.id}
              />
            ) : (
              <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 4, height: 4, borderRadius: 1, background: "#C53A3A", display: "inline-block" }} />
                  Needs a supplier code
                </span>
                <button
                  type="button"
                  ref={setPrimaryControl}
                  onClick={() => resolve.startLineEdit(selectedLine.id, "")}
                  aria-label={`Set supplier code for line ${selectedLine.lineNumber}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "1px solid #1E66C9", background: "#FFFFFF", color: "#1E66C9", cursor: "pointer", minHeight: 32 }}
                >
                  Set supplier code
                  <KbdLight>E</KbdLight>
                </button>
              </div>
            )
          )}

          {selected.kind === "review-flag" && (
            <div style={{ borderRadius: 8, padding: "10px 12px", background: "#FFF8EA", border: "1px solid #F0D39A" }}>
              <div style={{ fontSize: 11.5, color: "#7A4D0A", lineHeight: 1.45, marginBottom: 8 }}>
                This line was flagged during import — it already has a supplier code, but the
                values couldn&apos;t be verified automatically. Check quantity, price and code,
                then confirm.
              </div>
              {lineEdit.editId === selectedLine.id ? (
                <ManualCodeRow
                  sn={{ id: selectedLine.id, lineNo: selectedLine.lineNumber, sku: selectedLine.buyerItemCode }}
                  lineEdit={lineEdit}
                  saving={resolve.acceptingLineId === selectedLine.id}
                />
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    ref={setPrimaryControl}
                    onClick={() => resolve.confirmFlaggedLine(selectedLine)}
                    disabled={resolve.acceptingLineId === selectedLine.id}
                    aria-label={`Confirm values for line ${selectedLine.lineNumber}`}
                    style={{ fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none", background: "#2E8E3A", color: "#FFFFFF", cursor: resolve.acceptingLineId === selectedLine.id ? "default" : "pointer", opacity: resolve.acceptingLineId === selectedLine.id ? 0.6 : 1, minHeight: 32 }}
                  >
                    {resolve.acceptingLineId === selectedLine.id ? "Saving…" : "✓ Confirm values"}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve.startLineEdit(selectedLine.id, selectedLine.supplierItemCode ?? "")}
                    disabled={resolve.acceptingLineId === selectedLine.id}
                    aria-label={`Edit supplier code for line ${selectedLine.lineNumber}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A", cursor: "pointer", minHeight: 32 }}
                  >
                    Edit code
                    <KbdLight>E</KbdLight>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* A line-scoped RULE failure: the fix is data-side — link the action. */}
          {selected.kind === "rule-failure" && (
            <div>
              {selected.detail && (
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#56627A", lineHeight: 1.5 }}>{selected.detail}</p>
              )}
              <button
                type="button"
                ref={setPrimaryControl}
                onClick={() => validation.validate()}
                disabled={validation.isValidating}
                style={{ minHeight: 28, padding: "5px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: validation.isValidating ? "default" : "pointer", opacity: validation.isValidating ? 0.7 : 1 }}
              >
                {validation.isValidating ? "Validating…" : "Re-validate"}
              </button>
            </div>
          )}
        </div>
      </>
    );
  } else if (selected.kind === "rule-failure") {
    canonicalContent = (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: "#0B1A2F" }}>{selected.title}</span>
            {canonicalField && <StandardsFieldPopover canonicalField={canonicalField} />}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C53A3A", textTransform: "capitalize" }}>failing</span>
        </div>
        {selected.detail && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#56627A", lineHeight: 1.5 }}>{selected.detail}</p>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          From the last acceptance-profile validation. Fix the order data (or accept the risk in
          the send confirmation) and re-validate.
        </p>
        <button
          type="button"
          ref={setPrimaryControl}
          onClick={() => validation.validate()}
          disabled={validation.isValidating}
          style={{ marginTop: 10, minHeight: 28, padding: "5px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: validation.isValidating ? "default" : "pointer", opacity: validation.isValidating ? 0.7 : 1 }}
        >
          {validation.isValidating ? "Validating…" : "Re-validate"}
        </button>
      </div>
    );
  } else {
    canonicalContent = (
      <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>This line is no longer on the order.</div>
    );
  }

  // Output fragment is only meaningful when there is a target in the output doc.
  const showOutputFragment = selectedLine != null || headerFragmentId != null;

  const panels = (
    <div
      ref={containerRef}
      style={
        wide
          ? { position: "relative", display: "grid", gridTemplateColumns: "minmax(0,0.95fr) minmax(0,1.1fr) minmax(0,1fr)", gap: 30, alignItems: "start" }
          : { position: "relative", display: "flex", flexDirection: "column", gap: 16, paddingLeft: 24 }
      }
    >
      <StageWireSvg wires={wires} wide={wide} />
      <div ref={sourceRef} style={{ position: "relative", zIndex: 2, minWidth: 0 }}>
        {snippetKind === "document" ? (
          <SourceZoneCrop order={order} zone={zone} line={selectedLine} />
        ) : (
          <NoSourceSnippet sourceFileKey={order.sourceFileKey} />
        )}
      </div>
      {/* CANONICAL zone — given the same peer-card chrome + label as Source and
          Output so the three zones read as a clear left→middle→right progression
          and the controls (Set supplier code etc.) sit in a calm framed panel. */}
      <div ref={canonicalRef} style={{ position: "relative", zIndex: 2, minWidth: 0 }}>
        <div style={{ borderRadius: 9, padding: 11, background: "#FBFCFD", border: "1px solid #E2E6EE", minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)", marginBottom: 8 }}>
            Canonical line
          </div>
          {canonicalContent}
        </div>
      </div>
      {showOutputFragment && (
        <div ref={outputRef} style={{ position: "relative", zIndex: 2, minWidth: 0 }}>
          <OutputPreview
            order={order}
            crossed={crossed}
            fieldValues={fieldValues}
            onOutputAction={onOutputAction}
            orderId={orderId}
            artifacts={order.artifacts}
            fragment={{ lineId: selectedLine?.id, headerId: headerFragmentId }}
          />
        </div>
      )}
    </div>
  );

  const body = (
    <>
      {breadcrumb}
      <div style={{ padding: "12px 14px" }}>
        {panels}
        {/* Rules strip — line-scoped cards only (rule cards ARE the rule). */}
        {selected.lineId != null && selected.kind !== "rule-failure" && (
          <LineRulesStrip validation={validation} lineNumber={selected.lineNumber} />
        )}
      </div>
    </>
  );

  if (bare) {
    return <div data-testid="context-stage">{body}</div>;
  }
  return (
    <div data-testid="context-stage" style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      {body}
    </div>
  );
}
