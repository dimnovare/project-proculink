import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STANDARDS } from "@/lib/standards/catalog";

/**
 * Help copy may not tell a reader that the emitted UBL order carries identifiers the emitter does
 * not write.
 *
 * ── The defect ────────────────────────────────────────────────────────────────────────────────
 * `help/ubl-and-peppol` shipped this, verbatim:
 *
 *   **The conformance identifiers are written, not verified.** The emitted document carries
 *   `cbc:CustomizationID` and `cbc:ProfileID`. The order-side check available in the app reports
 *   whether they are *present* — not whether their contents are right for your profile.
 *
 * Both halves were false. `UblOrderTransformService` emits neither element, and the two order-side
 * checks that required them were deleted with them — they asserted a value the emitter had just
 * written, and UBL 2.1 marks both `minOccurs="0"` so requiring them was never a UBL rule.
 *
 * ── Why it is not a harmless under-claim ──────────────────────────────────────────────────────
 * Peppol composes a document type identifier as
 * `<syntax specific id>##<customization id>::<version>`, so the customization ID is part of the key
 * an access point looks up to find what a receiver accepts. An order carrying none is unaddressable
 * on the network. The sentence told a customer a file was routable when it is not.
 *
 * ── Why the existing guards could not catch it ────────────────────────────────────────────────
 * Two claim scanners already read this file and both exonerate the line:
 *
 *   - `gatedCapabilityClaims.test.ts` short-circuits on its `NEGATED` arm. The sentence is phrased
 *     as a denial ("written, **not** verified"), so it never reaches the standards lookup — while
 *     its affirmative premise rides along inside the denial, unexamined.
 *   - `format-catalog.test.ts` fires only on lines naming the Peppol PROFILE plus a conformance
 *     verb. This line names two ELEMENTS.
 *
 * Both model "does this line claim conformance?". Neither models "does this line assert a fact
 * about the bytes we emit?", which is the question that was wrong here. This file asks that one.
 *
 * ── Derived, not hand-typed ───────────────────────────────────────────────────────────────────
 * The ground truth comes from the catalog row that records it, so the day the emitter starts
 * writing a profile again the catalog is what changes and this guard follows. A hard-coded
 * expectation here would be one more literal to drift.
 */
describe("help copy may not claim the UBL emitter writes a profile identifier", () => {
  const PEPPOL_ORDER_ROW = STANDARDS.find((s) => s.id === "peppol-bis-order-3");

  /** The identifiers the emitter does not write. */
  const IDENTIFIER = /cbc:(CustomizationID|ProfileID)/i;

  /**
   * An emission verb followed by one of the identifiers, with NO negation in between.
   *
   * The negation has to be scoped to the span between the verb and the element, not tested against
   * the whole line — and that is the entire lesson of this defect. A line-level negation arm is
   * what let the original sentence through both existing scanners: it opens "written, **not**
   * verified", so a whole-line test for `\bnot\b` exonerates the affirmative clause that follows
   * it. The first draft of THIS guard made the same mistake and failed its own must-flag control,
   * which is why the control is written first and kept.
   *
   * The 80-character window keeps the verb and the element in the same clause; a negation anywhere
   * inside that window blocks the match.
   */
  const AFFIRMATIVE_EMISSION =
    /(carr(?:y|ies|ied|ying)|emit(?:s|ted|ting)?|writ(?:e|es|ten|ing)|wrote|includ(?:e|es|ing)|contain(?:s|ing)?|declar(?:e|es|ed|ing)|populat(?:e|es|ed))\b(?:(?!\b(?:no|not|never|neither|nor|without|cannot|absent|omit|omits|omitted|removed|dropped)\b).){0,80}?cbc:(?:CustomizationID|ProfileID)/i;

  const claimsWeEmitAnIdentifier = (line: string): boolean => AFFIRMATIVE_EMISSION.test(line);

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.mdx$/.test(entry)) out.push(full);
    }
    return out;
  };

  const HELP_PAGES = walk(join(process.cwd(), "src/app/(marketing)/help"));

  it("recognises the sentence that really shipped", () => {
    // Verbatim, from the revision this guard was written against. A guard that cannot see its own
    // origin defect is decoration.
    expect(
      claimsWeEmitAnIdentifier(
        "- **The conformance identifiers are written, not verified.** The emitted document carries `cbc:CustomizationID` and `cbc:ProfileID`. The order-side check available in the app reports whether they are *present* — not whether their contents are right for your profile.",
      ),
      "the phrasing that shipped: a false premise wrapped inside a denial",
    ).toBe(true);

    // The shapes a writer reaches for next.
    expect(claimsWeEmitAnIdentifier("The emitted order includes `cbc:ProfileID`.")).toBe(true);
    expect(claimsWeEmitAnIdentifier("ProcuLink writes `cbc:CustomizationID` into every UBL order.")).toBe(true);
    expect(claimsWeEmitAnIdentifier("Each document declares `cbc:CustomizationID` for your profile.")).toBe(true);
  });

  it("leaves the honest denial alone", () => {
    expect(
      claimsWeEmitAnIdentifier(
        "The emitted order carries neither `cbc:CustomizationID` nor `cbc:ProfileID`.",
      ),
    ).toBe(false);
    expect(claimsWeEmitAnIdentifier("No `cbc:CustomizationID` is emitted.")).toBe(false);
    expect(
      claimsWeEmitAnIdentifier("Both elements are absent, which is what a plain UBL 2.1 Order looks like."),
    ).toBe(false);
  });

  it("the catalog still records that the emitter declares no profile", () => {
    // The premise this guard rests on. If the emitter ever starts writing a profile again, this is
    // what has to change first, and this assertion is what says so out loud.
    expect(PEPPOL_ORDER_ROW, "the catalog row must exist for the guard to have a premise").toBeDefined();
    expect(PEPPOL_ORDER_ROW!.transform).toBe("planned");
    expect(PEPPOL_ORDER_ROW!.conformance).toMatch(/no cbc:CustomizationID and no cbc:ProfileID/i);
  });

  it("finds no such claim in any shipped help page", () => {
    // Anti-vacuity floor, both halves: the corpus must really be read, and it must really contain
    // the article whose sentence this guard exists for.
    expect(HELP_PAGES.length, "the corpus must really be reading help pages").toBeGreaterThan(5);
    const corpus = HELP_PAGES.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(IDENTIFIER.test(corpus), "the article discussing these identifiers must be in the corpus").toBe(true);

    const offenders: string[] = [];
    for (const file of HELP_PAGES) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (claimsWeEmitAnIdentifier(line)) {
            offenders.push(`${file.replace(process.cwd(), "")}:${i + 1}: ${line.trim()}`);
          }
        });
    }

    expect(
      offenders,
      "these lines tell a reader the emitted UBL order carries a profile identifier. It carries " +
        "neither, and a document without cbc:CustomizationID cannot be addressed by a Peppol " +
        "access point — so this reads as routable when it is not:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
