import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The field reference covers the core of a purchase order. Nothing may say it covers all of it.
//
// THE DEFECT THIS PINS, verbatim — one gap wearing three faces.
//
//   1. src/app/(home)/page.tsx, the "Standards, on demand" feature card:
//
//        "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always
//         visible, never hidden behind a mode."
//
//      FIELD_STANDARDS carries 11 rows, one of which (`Lines`) is a structural container.
//      The canonical model an output rule may bind is BINDABLE_HEADER_FIELDS (33) +
//      BINDABLE_LINE_FIELDS (20) = 53, mirroring CanonicalRowFields.cs. "Every order field"
//      was false by a factor of five.
//
//   2. This screen, on a query outside those rows:
//
//        <EmptyState compact title="No fields match" sub={`Nothing for "${q}".`} />
//
//      That is a DENIAL, not a miss. A user searching `SupplierItemCode` — the resolved
//      supplier code the entire review flow exists to produce — was told the product does
//      not have it. 43 of 53 fields answered that way: LineTotal, all 8 ShipTo*, all 8
//      BillTo*, Incoterms, PaymentTerms, TaxRate, TaxAmount, GrandTotal and the rest. The
//      page's only disclosure was about emitted-vs-read-only DIRECTION; a grep for subset or
//      partial wording across src/app, src/components and src/lib returned zero user-facing
//      hits, so the limitation was stated nowhere in the product.
//
//   3. /help/output-templates routed the reader to face 2 — "down to field-level references
//      (how \"PO number\" maps to UBL cbc:ID, X12 BEG03, and so on)". The references named
//      are real; the coverage implied was not.
//
// ── Why this guard runs in BOTH directions ───────────────────────────────────
//
// The fix is copy, and copy is reversible by anybody with an opinion about marketing. So the
// premise is asserted first: while FIELD_STANDARDS references FEWER fields than the canonical
// model carries, no surface may claim all of them. If somebody ever does the research and
// closes the gap, `coverage.referenced === coverage.total` and the universal-claim ban lifts
// on its own rather than blocking an honest sentence.
//
// Every count below is DERIVED. A hand-typed 10 or 53 in a test is how the drift it guards
// gets re-encoded as an expectation — the reason `requiresPlan()` exists on this page, and
// the same reason the copy interpolates STANDARDS_FIELD_COVERAGE instead of spelling it.

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import StandardsPage from "./page";
import HomePage from "@/app/(home)/page";
import {
  FIELD_STANDARDS,
  STANDARDS_FIELD_COVERAGE as COVERAGE,
  canonicalFieldsWithoutStandards,
} from "@/lib/standards/catalog";
import { BINDABLE_HEADER_FIELDS, BINDABLE_LINE_FIELDS } from "@/lib/api/types";

afterEach(cleanup);

const HELP_REL = "src/app/(marketing)/help/output-templates/page.mdx";
const HOME_REL = "src/app/(home)/page.tsx";
const PAGE_REL = "src/app/(app)/library/standards/page.tsx";

/** Everything a screen says, as one string — the copy is split across many elements. */
const bodyText = (): string => document.body.textContent ?? "";

/** The sharpest case: a canonical field the product resolves, with no reference row. */
const SHARPEST = "SupplierItemCode";

/**
 * A universal quantifier reaching for "field" — the shape of the defect, not one sentence of
 * it. Returns the offending phrase so a failure prints what it found, or null.
 *
 * Two refinements, both learned by this guard firing on the fix itself:
 *
 *   • the span may not cross a clause boundary (`.!?:;`). "…not all of it: a field with no
 *     reference…" is two clauses, and reading across the colon manufactures a claim.
 *   • a NEGATED quantifier is the opposite claim. "not all fields", "never covers every
 *     field" are disclosures — which is exactly what this packet added — so a negator sitting
 *     immediately before the match discards it.
 *
 * Both make the guard quieter, and neither weakens it against the original sentence: "Every
 * order field maps to…" has no negator and no punctuation between quantifier and noun.
 */
function universalFieldClaim(text: string): string | null {
  const universal = /\b(?:every|each|all|any|full|complete|entire)\b[^.!?:;\n]{0,40}?\bfields?\b/gi;
  for (const match of text.matchAll(universal)) {
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    if (/\b(?:not|never|no|rather than|instead of|beyond)\b[\s,]*$/i.test(before)) continue;
    return match[0];
  }
  return null;
}

// ── Anti-vacuity: both counts, and the gap between them ──────────────────────
//
// Every assertion below is conditioned on the coverage being partial, and reads two
// registries this file does not own. If either extractor yielded zero — the catalog emptied,
// the bindable lists renamed — the sweeps would go green while proving nothing at all. So the
// floors fail rather than pass.

describe("the coverage gap being guarded is real", () => {
  it("has a non-zero numerator", () => {
    expect(
      COVERAGE.referenced,
      "no bindable canonical field carries a standards reference — the numerator extractor is broken, " +
        "not the product",
    ).toBeGreaterThan(0);
    expect(FIELD_STANDARDS.length).toBeGreaterThan(COVERAGE.referenced - 1);
  });

  it("has a non-zero denominator", () => {
    expect(
      COVERAGE.total,
      "the canonical model reports zero bindable fields — the denominator extractor is broken",
    ).toBeGreaterThan(0);
    expect(COVERAGE.total).toBe(BINDABLE_HEADER_FIELDS.length + BINDABLE_LINE_FIELDS.length);
  });

  it("is still partial, which is what every claim below is conditioned on", () => {
    expect(
      COVERAGE.referenced,
      "coverage is complete — if the research was really done, delete the conditioned assertions " +
        "below rather than loosening them",
    ).toBeLessThan(COVERAGE.total);
  });

  it("does not count the structural `Lines` row as a covered field", () => {
    // FIELD_STANDARDS.length would say 11; `Lines` is a container (cac:OrderLine / PO1), not
    // a bindable field. Counting rows instead of the intersection overstates by one.
    expect(FIELD_STANDARDS.some((f) => f.canonicalField === "Lines")).toBe(true);
    expect(COVERAGE.referenced).toBeLessThan(FIELD_STANDARDS.length);
  });

  it("leaves SupplierItemCode unreferenced, which is the case the empty state must handle", () => {
    const bindable = [...BINDABLE_HEADER_FIELDS, ...BINDABLE_LINE_FIELDS] as readonly string[];
    expect(bindable, "SupplierItemCode left the canonical model").toContain(SHARPEST);
    expect(
      FIELD_STANDARDS.some((f) => f.canonicalField === SHARPEST),
      "SupplierItemCode now has a standards row — pick another unreferenced field for the control below",
    ).toBe(false);
    expect(canonicalFieldsWithoutStandards(SHARPEST)).toContain(SHARPEST);
  });
});

// ── Face 1: the landing page ─────────────────────────────────────────────────

describe("the landing page claims no universal field coverage", () => {
  it("renders the standards feature card this test reads", () => {
    render(<HomePage />);
    expect(bodyText(), "the feature card is gone — this guard now proves nothing").toContain(
      "Standards, on demand",
    );
  });

  it("does not promise every order field", () => {
    render(<HomePage />);
    const text = bodyText();

    // The verbatim sentence first, so the mutation check has something exact to restore.
    expect(
      text,
      `the landing page promises "Every order field" while only ${COVERAGE.referenced} of ` +
        `${COVERAGE.total} canonical fields carry a standards reference`,
    ).not.toContain("Every order field");

    // Then the shape, so a synonym does not walk back in.
    expect(
      universalFieldClaim(text),
      `the landing page makes a universal claim about field coverage — ${COVERAGE.referenced} of ` +
        `${COVERAGE.total} canonical fields have a standards path recorded`,
    ).toBeNull();
  });

  it("would catch the sentence that shipped, which is what makes the sweep above worth running", () => {
    // The matcher itself, against the defect verbatim. Without this, a regex that silently
    // stopped matching anything would leave the sweep green and the claim unguarded — a
    // second kind of vacuity, in the extractor rather than in the corpus.
    expect(
      universalFieldClaim(
        "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always " +
          "visible, never hidden behind a mode.",
      ),
    ).toBe("Every order field");
    expect(universalFieldClaim("all order fields")).toBe("all order fields");
    // And not on a disclosure, which is what the fix reads like.
    expect(universalFieldClaim("the core of a purchase order, not all of it: a field")).toBeNull();
    expect(universalFieldClaim("Core order fields map to UBL")).toBeNull();
  });

  it("still says the reference exists and is never behind a mode", () => {
    // The other direction. The fix is to stop over-claiming, not to stop claiming: the
    // always-visible standards reference is a real differentiator and it must survive.
    render(<HomePage />);
    const text = bodyText();
    expect(text).toContain("never hidden behind a mode");
    for (const standard of ["UBL", "EDIFACT", "X12", "cXML", "Peppol BIS"]) {
      expect(text, `the landing card no longer names ${standard}`).toContain(standard);
    }
  });

  it("does not hand-type a coverage count into marketing copy", () => {
    // If the card ever states a number, it must interpolate the derived one. A literal
    // "10 of 53" on a marketing page is the drift this whole packet is about, re-created.
    const source = readFileSync(join(process.cwd(), HOME_REL), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      source,
      `${HOME_REL} spells a coverage fraction out instead of deriving it from STANDARDS_FIELD_COVERAGE`,
    ).not.toMatch(/\b\d+\s+of\s+(?:the\s+)?\d+\s+(?:canonical\s+)?fields?\b/i);
  });
});

// ── Face 2: the screen's own disclosure ──────────────────────────────────────

describe("the standards screen discloses its coverage up front", () => {
  it("states the fraction before the reader searches anything", () => {
    render(<StandardsPage />);
    const text = bodyText();
    expect(
      text,
      "the screen presents a five-format matrix and never says how much of the model it covers",
    ).toContain(`${COVERAGE.referenced} of the ${COVERAGE.total} canonical fields`);
  });

  it("says a missing field is still one the product can send", () => {
    // Coverage without this reads as a capability limit: "we only handle 10 fields".
    render(<StandardsPage />);
    expect(bodyText()).toMatch(/still in the order model/i);
  });

  it("derives the fraction rather than spelling it out", () => {
    const page = readFileSync(join(process.cwd(), PAGE_REL), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(page, `${PAGE_REL} must import the coverage constant to state a fraction`).toMatch(
      /import\s*\{[^}]*\bSTANDARDS_FIELD_COVERAGE\b[^}]*\}\s*from\s*"@\/lib\/standards\/catalog"/,
    );
    expect(page, `${PAGE_REL} hand-types a coverage fraction`).not.toMatch(
      /\b\d+\s+of\s+(?:the\s+)?\d+\s+(?:canonical\s+)?fields?\b/i,
    );
  });
});

// ── Face 2, the worse half: what the empty state says about a real field ─────

describe("searching a field the product carries is not answered with a denial", () => {
  /** Drive the real field search the way a reader does, then read what the screen says. */
  function search(term: string) {
    render(<StandardsPage />);
    fireEvent.change(screen.getByLabelText("Search fields or paths"), {
      target: { value: term },
    });
  }

  it(`does not tell a reader searching ${SHARPEST} that nothing matches`, () => {
    search(SHARPEST);
    const text = bodyText();

    expect(
      text,
      `${SHARPEST} is a canonical field ProcuLink resolves on every order, and the screen ` +
        'answers "No fields match" — the reader concludes the product does not have it',
    ).not.toContain("No fields match");
    expect(text).not.toContain(`Nothing for "${SHARPEST}"`);
  });

  it("names the field and says a reference is not recorded yet", () => {
    search(SHARPEST);
    const text = bodyText();
    expect(text).toContain("Supplier item code");
    expect(text, "the empty state does not distinguish missing-reference from missing-field").toMatch(
      /no standards path recorded/i,
    );
    expect(text).toMatch(/ProcuLink carries/i);
  });

  it("repeats the coverage fraction where the reader actually hit the gap", () => {
    search(SHARPEST);
    expect(bodyText()).toContain(
      `${COVERAGE.referenced} of ${COVERAGE.total} canonical fields`,
    );
  });

  it("handles a query matching several unreferenced fields without listing all of them", () => {
    // "ShipTo" matches 8. An empty state that prints eight names is a field list, not a message.
    const many = canonicalFieldsWithoutStandards("ShipTo");
    expect(many.length, "the ShipTo block left the canonical model").toBeGreaterThan(4);

    search("ShipTo");
    const text = bodyText();
    expect(text).toMatch(new RegExp(`No standards path recorded for ${many.length} matching fields`));
    expect(text).toMatch(/and \d+ more/);
  });

  it("still says no match for a name the product genuinely does not have", () => {
    // The control that keeps the branch honest in the other direction. A guard that only
    // proves "SupplierItemCode is not denied" is satisfied by never denying anything.
    const nonsense = "zzqqx";
    expect(canonicalFieldsWithoutStandards(nonsense)).toHaveLength(0);

    search(nonsense);
    const text = bodyText();
    expect(text).toContain("No fields match");
    expect(text, "a nonexistent field is presented as one ProcuLink carries").not.toMatch(
      /no standards path recorded/i,
    );
  });
});

// ── Face 3: the help article that routes the reader there ────────────────────

describe("the help article matches what the screen actually holds", () => {
  const help = readFileSync(join(process.cwd(), HELP_REL), "utf8");

  it("derives the coverage rather than implying all of it", () => {
    expect(help, `${HELP_REL} must import the coverage constant to state a fraction`).toMatch(
      /import\s*\{[^}]*\bSTANDARDS_FIELD_COVERAGE\b[^}]*\}\s*from\s*"@\/lib\/standards\/catalog"/,
    );
    expect(help).toMatch(/\{STANDARDS_FIELD_COVERAGE\.referenced\}/);
    expect(help).toMatch(/\{STANDARDS_FIELD_COVERAGE\.total\}/);
    expect(help, `${HELP_REL} hand-types a coverage fraction`).not.toMatch(
      /\b\d+\s+of\s+(?:the\s+)?\d+\s+canonical\s+fields?\b/i,
    );
  });

  it("does not imply the reference covers the whole model", () => {
    const prose = help.replace(/^import .*$/gm, "");
    expect(
      universalFieldClaim(prose),
      `${HELP_REL} sends the reader to a table that covers ${COVERAGE.referenced} of ` +
        `${COVERAGE.total} canonical fields and implies it covers them all`,
    ).toBeNull();
  });

  it("tells the reader an unreferenced field can still be sent", () => {
    expect(help).toMatch(/still in the order model/i);
  });
});
