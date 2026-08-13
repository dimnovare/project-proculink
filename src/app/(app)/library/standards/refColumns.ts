// The reference columns the standards matrix renders, and what each one means
// commercially as well as technically.
//
// This lived inside `page.tsx` until the two filters below needed to be readable by a test.
// A Next.js page module may not carry arbitrary named exports — `next build` rejects them
// against `OmitWithTag<…, "default" | "viewport" | …>` — so the table moved here rather than
// being duplicated into the test, which is the shape that produced the defect it now guards.

import type { CanonicalFieldStandards } from "@/lib/standards/catalog";
import { STANDARDS } from "@/lib/standards/catalog";
import { MINIMUM_PLAN, type GatedCapability } from "@/lib/gatedCapabilities";

// ── Local presentation order — cXML first, versioned labels (design spec) ──────
// key is a field on CanonicalFieldStandards. The header labels here are the exact
// columnheader strings the design render shows (and the e2e contract asserts):
// "cXML 1.2", "UBL 2.1", "EDIFACT", "X12", "Peppol BIS".
export type RefKey = keyof Pick<
  CanonicalFieldStandards,
  "cxml" | "ubl" | "edifact" | "x12" | "peppolBis"
>;

//
// `catalogId` is what makes the direction line derivable instead of typed. The column
// LABELS cannot carry the marker themselves: tests/e2e/standards.spec.ts:33-34 asserts each
// columnheader's accessible name with `exact: true`, and that is the locked design contract, so
// appending "(read only)" to a `<th>` would break the render this screen was ported from. The
// disclosure goes above the table instead, where it can be a sentence rather than a tag.
export const REF_COLUMNS: ReadonlyArray<{ key: RefKey; label: string; catalogId: string }> = [
  { key: "cxml", label: "cXML 1.2", catalogId: "cxml-1-2" },
  { key: "ubl", label: "UBL 2.1", catalogId: "ubl-2-1-order" },
  { key: "edifact", label: "EDIFACT", catalogId: "edifact-orders" },
  { key: "x12", label: "X12", catalogId: "x12-850" },
  { key: "peppolBis", label: "Peppol BIS", catalogId: "peppol-bis-order-3" },
];

/**
 * Which standards are gated on OUTPUT, and by which capability — keyed by catalog id.
 *
 * ── Why this exists, beside `catalogId` rather than folded into it ────────────
 *
 * `emits()` below reads `STANDARDS[].transform`, which answers a TECHNICAL question: can
 * ProcuLink build this document? The direction line was derived from that alone and read
 * "ProcuLink produces cXML 1.2, UBL 2.1 and X12." flat — an honest technical filter carrying
 * no commercial one, on a page that names no tier anywhere else. cXML output is refused
 * below Operations, so that sentence offered a Growth org a capability the API declines.
 *
 * The two questions are genuinely separate and neither answers the other, so the gate is its
 * own lookup. The TIER is not here — that stays in `MINIMUM_PLAN`, the mirror of the backend
 * gate table, so re-tiering cXML moves this screen's copy with it.
 */
export const GATED_STANDARD_OUTPUT: Readonly<Record<string, GatedCapability>> = {
  "cxml-1-2": "cxml",
};

/** Can ProcuLink produce this standard at all? Read off the catalog, never typed here. */
export const emits = (catalogId: string): boolean =>
  STANDARDS.find((s) => s.id === catalogId)?.transform === "supported";

/** The capability gating this standard's output, or undefined when nothing gates it. */
export const gateFor = (catalogId: string): GatedCapability | undefined =>
  GATED_STANDARD_OUTPUT[catalogId];

/**
 * Columns the screen presents as formats ProcuLink produces, split on whether a plan gate
 * applies. Both halves derive — the first from the standards catalog, the second from the
 * mirrored gate table — so a shipped transform or a re-tiering changes this on its own.
 */
export const EMITTED_COLUMNS = REF_COLUMNS.filter((c) => emits(c.catalogId));
export const READ_ONLY_COLUMNS = REF_COLUMNS.filter((c) => !emits(c.catalogId));
export const GATED_EMITTED_COLUMNS = EMITTED_COLUMNS.filter((c) => gateFor(c.catalogId) !== undefined);
export const UNGATED_EMITTED_COLUMNS = EMITTED_COLUMNS.filter((c) => gateFor(c.catalogId) === undefined);

/** Every gated capability named above really has a mirrored minimum plan. */
export const gateIsMirrored = (capability: GatedCapability): boolean =>
  MINIMUM_PLAN[capability] !== undefined;
