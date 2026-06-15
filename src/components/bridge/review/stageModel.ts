// stageModel — PURE helpers for the Triage Context Stage (batch 9 Phase C,
// spec: docs/strategy/2026-06-11-SPINE-REDESIGN-SPEC.md §2). No React, no DOM
// reads — everything here is unit-tested in stageModel.test.ts.
//
// Wire-geometry contract (gate G5): the stage mini-wires NEVER reimplement the
// wire layer's anchor math. computeStageWires consumes the EXPORTED pure fns
// from SpineConnectors (fallbackSourceAnchor + orderWiresForRender) and the
// wire-layer files themselves are untouched.

import { fallbackSourceAnchor, orderWiresForRender } from "../SpineConnectors";
import type { OrderValidationResult } from "@/types/procurement";
import type { FixQueueCard } from "./buildFixQueue";

// ── Canonical node id → canonical field (StandardsFieldPopover join key) ─────
// Moved here from SpineReview.tsx so both the classic spine and the Context
// Stage read the SAME mapping (no drift, no circular import).
export const NODE_TO_FIELD: Record<string, string> = {
  po:       "PoNumber",
  date:     "OrderDate",
  buyer:    "BuyerName",
  currency: "Currency",
  lines:    "Lines",
};

// ── Source-zone resolution for a Fix Queue card ──────────────────────────────
// Zone ids match DocumentAnatomy's onSection anchors: header / header-meta /
// parties / terms / lines / totals.

/** Derive the document-anatomy zone a card's issue originates from. */
export function sourceZoneForCard(card: Pick<FixQueueCard, "kind" | "lineNumber" | "title">): string {
  // Every line-scoped card (incl. line-scoped rule failures) points at the line table.
  if (card.lineNumber != null) return "lines";
  if (card.kind !== "rule-failure") return "lines";
  // Header-level rule failure — map the rule's fieldPath (stored in title) to a zone.
  const f = card.title.toLowerCase();
  if (f.includes("currency")) return "terms";
  if (f.includes("total") || f.includes("amount")) return "totals";
  if (f.includes("buyer") || f.includes("supplier") || f.includes("party")) return "parties";
  if (f.includes("po") || f.includes("order") || f.includes("date")) return "header-meta";
  return "header";
}

/** Output-preview header fragment id for a header-level rule card (null = no fragment). */
export function outputHeaderIdForCard(card: Pick<FixQueueCard, "kind" | "lineNumber" | "title">):
  "po" | "date" | "buyer" | "supplier" | "currency" | "totals" | null {
  if (card.lineNumber != null || card.kind !== "rule-failure") return null;
  const f = card.title.toLowerCase();
  if (f.includes("currency")) return "currency";
  if (f.includes("total") || f.includes("amount")) return "totals";
  if (f.includes("buyer")) return "buyer";
  if (f.includes("supplier")) return "supplier";
  if (f.includes("date")) return "date";
  if (f.includes("po") || f.includes("order")) return "po";
  return null;
}

// ── Source snippet honesty ───────────────────────────────────────────────────
// A document-styled zone crop is only honest for sources that WERE documents
// (csv / xlsx / pdf uploads). API-ingested orders (no stored file) and
// structured EDI/XML feeds get the explicit "No source snippet" fallback
// instead of a reconstructed page pretending to be their source.

export type SnippetKind = "document" | "none";

const DOCUMENT_EXTENSIONS = new Set(["csv", "xlsx", "xls", "pdf"]);

export function snippetKindForSource(sourceFileKey: string | null | undefined): SnippetKind {
  if (!sourceFileKey) return "none";
  const ext = sourceFileKey.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_EXTENSIONS.has(ext) ? "document" : "none";
}

/** Short honest label for the non-document ingestion path shown in the fallback. */
export function sourceIngestLabel(sourceFileKey: string | null | undefined): string {
  if (!sourceFileKey) return "the API";
  const ext = sourceFileKey.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xml")  return "an XML feed";
  if (ext === "edi" || ext === "x12" || ext === "edifact") return "an EDI feed";
  if (ext === "json") return "a JSON feed";
  return "a structured feed";
}

// ── Deep link: ?fix= is an alias of &line= ───────────────────────────────────

/** Parse the line deep-link param; `line` wins over its `fix` alias. */
export function parseFixLineParam(get: (key: string) => string | null): number | null {
  const raw = get("line") ?? get("fix");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// ── Responsive band resolution (one source of truth for the compositions) ────

export type StageBand = "sm" | "md" | "lg" | "xl" | "xxl";

/** <768 sm · 768–1023 md · 1024–1279 lg · 1280–1919 xl · ≥1920 xxl. */
export function bandForWidth(width: number): StageBand {
  if (width < 768) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  if (width < 1920) return "xl";
  return "xxl";
}

// ── Acceptance rules affecting one line ──────────────────────────────────────

export interface LineRuleRow {
  fieldPath: string;
  message?: string;
  passed: boolean;
  severity: "error" | "warning";
}

/** Line-scoped validation results for the given line number (header rules excluded). */
export function rulesAffectingLine(
  validationResult: OrderValidationResult | null | undefined,
  lineNumber: number | null | undefined,
): LineRuleRow[] {
  if (!validationResult || lineNumber == null) return [];
  return validationResult.results
    .filter(r => r.lineNumber === lineNumber)
    .map(r => ({ fieldPath: r.rule.fieldPath, message: r.message, passed: r.passed, severity: r.severity }));
}

/** Passed/failed/total counts across the whole last validation run (readiness row). */
export function acceptanceSummary(
  validationResult: OrderValidationResult | null | undefined,
): { passed: number; failed: number; total: number } | null {
  if (!validationResult) return null;
  const total = validationResult.results.length;
  const failed = validationResult.results.filter(r => !r.passed).length;
  return { passed: total - failed, failed, total };
}

// ── Mini-wire geometry (consumes the EXPORTED SpineConnectors fns only) ──────

/** Grid-local bounding box of one stage panel. */
export interface StageBox { top: number; bottom: number; left: number; right: number; }

export interface StageWire {
  id: string;
  /** Upstream anchor (on the source panel's edge — from fallbackSourceAnchor). */
  sx: number; sy: number;
  /** Downstream anchor (the target panel's attach point). */
  tx: number; ty: number;
}

/** A box is unusable when it has no area (panel hidden / not yet measured). */
function isDegenerate(b: StageBox | null | undefined): b is null | undefined {
  return !b || (b.right - b.left === 0 && b.bottom - b.top === 0);
}

/**
 * Compute the Context Stage mini-wires: source-zone panel → canonical line row →
 * output fragment panel. Anchor placement delegates to fallbackSourceAnchor —
 * the exported, unit-tested SpineConnectors contract that pins an endpoint to
 * the upstream panel's right edge LEVEL with the downstream anchor y, clamped
 * inside the panel (an endpoint can never fly to (0,0)). Paint order delegates
 * to orderWiresForRender (hovered wire painted last).
 */
export function computeStageWires(
  boxes: { source?: StageBox | null; canonical?: StageBox | null; output?: StageBox | null },
  canonicalAnchorY: number | null,
  hoveredId: string | null = null,
): { wire: StageWire; oi: number }[] {
  const wires: StageWire[] = [];
  const { source, canonical, output } = boxes;

  if (!isDegenerate(source) && !isDegenerate(canonical)) {
    const anchorY = canonicalAnchorY ?? (canonical.top + canonical.bottom) / 2;
    const a = fallbackSourceAnchor(
      { top: source.top, bottom: source.bottom, right: source.right },
      anchorY,
      null,
    );
    wires.push({ id: "src", sx: a.sx, sy: a.sy, tx: canonical.left, ty: anchorY });
  }

  if (!isDegenerate(canonical) && !isDegenerate(output)) {
    // Unify the out-wire on the SAME canonical-row anchorY as the src-wire so the flow reads
    // source → canonical-row → output at ONE height. The old code anchored this wire to the
    // OUTPUT panel's vertical centre, which (with alignItems:"start" and a tall OutputPreview)
    // sat far below the canonical row → the two wires met the canonical box at different heights
    // with dead vertical space. Fall back to the output centre only when no canonical anchor is
    // known (canonicalAnchorY null AND a degenerate canonical box — already excluded here, so
    // the canonical-centre is the safe fallback).
    const anchorY = canonicalAnchorY ?? (canonical.top + canonical.bottom) / 2;
    const a = fallbackSourceAnchor(
      { top: canonical.top, bottom: canonical.bottom, right: canonical.right },
      anchorY,
      null,
    );
    wires.push({ id: "out", sx: a.sx, sy: a.sy, tx: output.left, ty: anchorY });
  }

  return orderWiresForRender(wires, hoveredId);
}
