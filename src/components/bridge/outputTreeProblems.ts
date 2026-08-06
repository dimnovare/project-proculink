// outputTreeProblems — design-time validation for the output designer (WP-16 · S14/S16).
//
// A layout that cannot produce a valid document must fail HERE, while the author is looking at it,
// not as an exception at delivery after they have left the screen. Two separate gaps produced that:
//
//   1. **The emitter's throw sites were never checked in the browser.** A prefix with no address,
//      both namespace modes at once, a repeating list with no item template, a format the node tree
//      cannot render — every one of them saves happily today and throws when the order is sent.
//
//   2. **The tree path runs a smaller validator than the fixed transforms.**
//      `OutputTemplateEmitter.Emit` calls `GuardResolved` (needs review + missing supplier item
//      code). All six fixed transforms call `OutputFieldValidator.ValidateEntity`, which ALSO
//      refuses a negative unit price and a non-positive quantity. So the same order that a fixed
//      transform refuses is silently accepted by a designed layout.
//
// THE TIER SPLIT IS THE HONEST PART. Today every failure is red text in the preview pane, so an
// order with unresolved lines — which is not a layout problem at all — reads as "your layout is
// broken", and the operator goes looking in the wrong place.
//
//   • **Tier 1 · Problem** — the layout itself cannot produce a valid file. Blocks the save.
//   • **Tier 2 · Not ready** — the layout is fine; this ORDER is not ready. Never blocks the save.
//   • **Tier 3 · Warning** — it will deliver, and it is probably not what you meant. Never blocks.
//
// Founder ruling 2026-07-31, recorded so it is not re-litigated: the checks the tree path gains from
// `OutputFieldValidator` ship as a WARNING, not a block. Blocking would stop orders that deliver
// today.

import type { OutputNode, OutputNodeTemplate, OutputFormat } from "@/lib/api/types";
import type { OrderLine } from "@/types/procurement";

export type ProblemTier = 1 | 2 | 3;

export type ProblemKind =
  | "prefix-without-namespace"
  | "namespace-mode-collision"
  | "format-not-renderable"
  | "invalid-xml-name"
  | "duplicate-csv-column"
  | "no-csv-columns"
  | "empty-repeating-list"
  | "duplicate-json-name"
  | "unbound-value"
  | "line-needs-review"
  | "line-missing-supplier-code"
  | "line-non-positive-quantity"
  | "line-negative-price";

export interface DesignProblem {
  /** Stable within one collection pass — the React key and the "Fix" target. */
  id: string;
  kind: ProblemKind;
  tier: ProblemTier;
  /** A plain sentence. Never a code, never an exception message. */
  message: string;
  /** The label on the jump control, when there is somewhere to jump to. */
  actionLabel?: string;
  /** Child-index path of the offending node, for the tree jump. */
  path?: number[];
}

/**
 * Mirror of `OutputTreeFormats.IsRenderable` — an exhaustive switch with NO default arm on the
 * backend, deliberately, so a new format has to be classified rather than defaulting to renderable.
 *
 * cXML carries a DOCTYPE and a From/To/Sender header; UBL carries mandatory UBLVersionID /
 * CustomizationID / ProfileID; X12 and EDIFACT are positional segments inside an ISA/GS or UNB/UNH
 * envelope. None of that is expressible as a generic element tree, so a tree-emitted document would
 * be well-formed and REJECTED by the receiver. Each is produced instead by its own dedicated
 * transform, configured on the supplier's Delivery tab.
 */
const RENDERABLE_FORMATS: readonly string[] = ["json", "xml", "csv"];

export function isRenderableTreeFormat(format: OutputFormat | string | null | undefined): boolean {
  return RENDERABLE_FORMATS.includes((format ?? "").toString().trim().toLowerCase());
}

/** How the format reads in a sentence, for the copy. `cXml` is the wire spelling, not the label. */
export const FORMAT_LABELS: Record<string, string> = {
  cxml: "cXML", ubl: "UBL", ublorder: "UBL", x12: "EDI X12", x12_850: "EDI X12 850",
  edifactorders: "EDIFACT", json: "JSON", xml: "XML", csv: "CSV",
};

export function formatLabel(format: OutputFormat | string | null | undefined): string {
  const key = (format ?? "").toString().trim().toLowerCase();
  return FORMAT_LABELS[key] ?? key.toUpperCase();
}

/**
 * Characters `XmlWriter` refuses in an element name, plus a leading character that cannot start one.
 *
 * Deliberately NOT a full XML `Name` production. A stricter regex would flag names an existing
 * layout legitimately carries — an inferred sample can keep a qualified `a:b` — and this check
 * BLOCKS THE SAVE, so a false positive would lock an author out of their own layout. It rejects only
 * what is unambiguously unwritable.
 */
const XML_NAME_BAD_CHARS = /[\s<>&"'/\\#%()[\]{}|+*!$^~,;=?@`]/;
const XML_NAME_BAD_START = /^[0-9.-]/;

function isValidXmlName(name: string): boolean {
  if (name.trim() === "") return false;
  if (XML_NAME_BAD_START.test(name)) return false;
  return !XML_NAME_BAD_CHARS.test(name);
}

/** A leaf that carries a value. Containers hold no value and cannot be "unbound". */
function isLeaf(n: OutputNode): boolean {
  return n.nodeType === "field" || n.nodeType === "attribute";
}

function isBound(n: OutputNode): boolean {
  const r = n.rule;
  if (!r) return false;
  return !!(r.canonicalField || r.sourceToken || r.expression) || r.fixedValue != null;
}

function walk(node: OutputNode, path: number[], visit: (n: OutputNode, p: number[]) => void): void {
  visit(node, path);
  (node.children ?? []).forEach((c, i) => walk(c, [...path, i], visit));
}

/**
 * Tier 1 and tier 3 — everything decidable from the LAYOUT alone, with no order and no round trip.
 *
 * Pure and synchronous on purpose: this runs on every keystroke, and a validation that needed the
 * server would be a validation that lags the edit that caused it.
 */
export function collectLayoutProblems(t: OutputNodeTemplate): DesignProblem[] {
  const out: DesignProblem[] = [];
  const format = (t.format ?? "").toString().toLowerCase();
  const isXml = format === "xml";
  const isCsv = format === "csv";
  const isJson = format === "json";

  // ── The format itself ──────────────────────────────────────────────────────
  if (!isRenderableTreeFormat(t.format)) {
    const label = formatLabel(t.format);
    out.push({
      id: "format-not-renderable",
      kind: "format-not-renderable",
      tier: 1,
      message: `${label} can't be built from a layout. It carries an envelope the receiving system checks before it looks at your order, so ProcuLink builds ${label} itself.`,
      actionLabel: "Choose what to do",
    });
  }

  // ── Namespaces ─────────────────────────────────────────────────────────────
  const rootMapUsed = !!t.namespaces && Object.keys(t.namespaces).length > 0;
  let perNodeUsed = false;

  const csvColumns: { name: string; path: number[] }[] = [];

  walk(t.root, [], (n, path) => {
    const prefix = (n.prefix ?? "").trim();
    const uri = (n.namespace ?? "").trim();
    if (prefix !== "" || uri !== "") perNodeUsed = true;

    // The emitter throws on a prefix with no namespace: there is nothing for it to bind to.
    if (prefix !== "" && uri === "") {
      out.push({
        id: `prefix-without-namespace:${path.join(".")}`,
        kind: "prefix-without-namespace",
        tier: 1,
        message: `"${prefix}" has a prefix but no web address. A prefix needs an address to point at.`,
        actionLabel: "Fix",
        path,
      });
    }

    if (isXml && !isValidXmlName(n.name)) {
      out.push({
        id: `invalid-xml-name:${path.join(".")}`,
        kind: "invalid-xml-name",
        tier: 1,
        message: `"${n.name}" isn't a valid tag name. Start it with a letter and use no spaces.`,
        actionLabel: "Fix",
        path,
      });
    }

    // A repeating list with no item template emits nothing at all — every order line is dropped and
    // the file looks fine. Silent data loss is the worst failure this editor can produce.
    if (n.nodeType === "array" && (n.children ?? []).length === 0) {
      out.push({
        id: `empty-repeating-list:${path.join(".")}`,
        kind: "empty-repeating-list",
        tier: 1,
        message: `The repeating list "${n.name}" is empty, so no order lines would be sent.`,
        actionLabel: "Fix",
        path,
      });
    }

    if (isLeaf(n)) {
      if (isCsv) csvColumns.push({ name: n.name, path });
      if (!isBound(n)) {
        out.push({
          id: `unbound-value:${path.join(".")}`,
          kind: "unbound-value",
          tier: 3,
          message: `"${n.name}" has no field, so it will always be sent empty.`,
          actionLabel: "Pick a field",
          path,
        });
      }
    }

    // JSON objects are maps: two properties with the same name means the LAST one silently wins.
    // Scoped to one object — the same name inside a different object is legal and common.
    if (isJson && n.nodeType === "object") {
      const seen = new Set<string>();
      for (const child of n.children ?? []) {
        if (seen.has(child.name)) {
          out.push({
            id: `duplicate-json-name:${path.join(".")}:${child.name}`,
            kind: "duplicate-json-name",
            tier: 1,
            message: `Two values in "${n.name}" are both called "${child.name}". Names must be different.`,
            actionLabel: "Fix",
            path,
          });
        }
        seen.add(child.name);
      }
    }
  });

  // The emitter refuses a tree that declares namespaces in both places. Reported once, not per node.
  if (rootMapUsed && perNodeUsed) {
    out.push({
      id: "namespace-mode-collision",
      kind: "namespace-mode-collision",
      tier: 1,
      message: "Namespaces are set both at the top and on individual elements. Pick one place.",
      actionLabel: "Pick one place",
    });
  }

  // ── CSV columns ────────────────────────────────────────────────────────────
  if (isCsv) {
    if (csvColumns.length === 0) {
      out.push({ id: "no-csv-columns", kind: "no-csv-columns", tier: 1, message: "This layout has no columns yet." });
    }
    const seen = new Set<string>();
    for (const col of csvColumns) {
      if (seen.has(col.name)) {
        out.push({
          id: `duplicate-csv-column:${col.path.join(".")}`,
          kind: "duplicate-csv-column",
          tier: 1,
          message: `Two columns are both called "${col.name}". Column names must be different.`,
          actionLabel: "Fix",
          path: col.path,
        });
      }
      seen.add(col.name);
    }
  }

  return out;
}

/** "3 order lines" / "1 order line" — a count that reads as a sentence, not as a template. */
function lineCount(n: number): string {
  return n === 1 ? "1 order line" : `${n} order lines`;
}

/**
 * Tier 2 — the ORDER-side checks, mirroring `OutputFieldValidator.CollectEntityProblems`.
 *
 * The first two (`needsReview`, missing supplier item code) are what the tree path's `GuardResolved`
 * already refuses, so they are reported here for completeness. The last two — a NON-POSITIVE
 * QUANTITY and a NEGATIVE UNIT PRICE — are the checks the tree path has always skipped while all six
 * fixed transforms enforce them, and closing that gap is the point of this packet.
 *
 * The asymmetry between the two is deliberate and mirrored exactly: quantity is `<= 0` (a zero
 * quantity is held), price is `< 0` (a zero price is a real free-of-charge line and delivers today).
 *
 * The buyer-item-code check is NOT mirrored: it fires only for EDIFACT / X12_850 / X12, and a layout
 * can never be in one of those formats — `IsRenderable` is false for all three. Mirroring it would
 * add a rule that can never fire, which is how a mirror starts to drift.
 */
export function collectOrderProblems(lines: readonly OrderLine[]): DesignProblem[] {
  const out: DesignProblem[] = [];

  const needsReview = lines.filter((l) => l.needsReview);
  if (needsReview.length > 0) {
    out.push({
      id: "line-needs-review",
      kind: "line-needs-review",
      tier: 2,
      message: `${lineCount(needsReview.length)} still need${needsReview.length === 1 ? "s" : ""} review, so this order can't be built. The layout itself is fine.`,
      actionLabel: "Go to the lines",
    });
  }

  const missingCode = lines.filter((l) => (l.supplierItemCode ?? "").trim() === "");
  if (missingCode.length > 0) {
    out.push({
      id: "line-missing-supplier-code",
      kind: "line-missing-supplier-code",
      tier: 2,
      message: `${lineCount(missingCode.length)} ${missingCode.length === 1 ? "doesn't" : "don't"} have a supplier item code yet, so this order can't be built. The layout itself is fine.`,
      actionLabel: "Go to the lines",
    });
  }

  for (const l of lines) {
    if (l.quantity <= 0) {
      const word = l.quantity === 0 ? "zero" : "negative";
      out.push({
        id: `line-non-positive-quantity:${l.lineNumber}`,
        kind: "line-non-positive-quantity",
        tier: 2,
        message: `Line ${l.lineNumber}'s quantity is ${l.quantity}. Orders with a ${word} quantity are held for review.`,
        actionLabel: `Go to line ${l.lineNumber}`,
      });
    }
    if (l.unitPrice < 0) {
      out.push({
        id: `line-negative-price:${l.lineNumber}`,
        kind: "line-negative-price",
        tier: 2,
        message: `Line ${l.lineNumber}'s unit price is ${l.unitPrice}. Orders with a negative price are held for review.`,
        actionLabel: `Go to line ${l.lineNumber}`,
      });
    }
  }

  return out;
}

/** Only a tier-1 problem stops a save. A layout can be correct for an order that is not ready. */
export function blocksSave(problems: readonly DesignProblem[]): boolean {
  return problems.some((p) => p.tier === 1);
}

export function problemCounts(problems: readonly DesignProblem[]): { problems: number; notReady: number; warnings: number } {
  return {
    problems: problems.filter((p) => p.tier === 1).length,
    notReady: problems.filter((p) => p.tier === 2).length,
    warnings: problems.filter((p) => p.tier === 3).length,
  };
}
