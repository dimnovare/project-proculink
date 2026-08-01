import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DELIVERY_CHANNEL_COUNT,
  DELIVERY_METHODS,
  IMPORT_FORMATS,
  IMPORT_METHODS,
  INBOUND_FORMAT_COUNT,
  OUTBOUND_FORMAT_COUNT,
  OUTPUT_FORMATS,
  STANDARD_NAME_TOKENS,
  parseStatus,
  standardRow,
  transformStatus,
  type FormatRow,
} from "@/lib/marketing/format-catalog";
import { STANDARDS } from "@/lib/standards/catalog";

/**
 * WP-40 follow-through — **a marketing row may not sell a standard it does not measure.**
 *
 * `/formats` badged "UBL 2.1 / Peppol BIS" as **Supported**, in both directions, while the
 * standards catalog three files away said Peppol BIS Order 3.0 was `partial` in both. The two
 * rows got there by two different routes, and `format-catalog.ts` had a header comment promising
 * that this could not happen:
 *
 *     { name: "UBL 2.1 / Peppol BIS", status: parseStatus("ubl-2-1-order"), … }   // inbound
 *     { name: "UBL 2.1 / Peppol BIS", status: "live", … }                         // outbound
 *
 * The first cites a REAL id — just not its own — so the build-time throw on an unknown id saw
 * nothing wrong. The second cites no id at all, because `OUTPUT_FORMATS` hand-typed every status:
 * nothing in the codebase read the catalog's `transform` level, so the promised derivation existed
 * for `IMPORT_FORMATS` alone.
 *
 * Behind the badge there was nothing to badge. There is no Schematron in either repo,
 * `PeppolBisValidator` is invoice-only, and the one order-side check asserts the conformance ids
 * are non-empty rather than correct — while the emitter writes a GUID into the supplier party name
 * and emits no `cbc:EndpointID`. Founder decision, 2026-08-01: keep emitting UBL, drop the Peppol
 * BIS claim.
 *
 * Two mechanisms below, each doing one job. The STRUCTURAL guard binds a row's name to the catalog
 * entry it derives from, and no wording can get around it. The PROSE guard is the backstop for the
 * marketing copy that has no rows to bind.
 */

// ── Structural: a row's name is bound to the catalog entry it derives from ──────

describe("a row cannot sell a standard it does not measure", () => {
  it("refuses, at module load, the exact row that shipped", () => {
    // The inbound row verbatim at 5ac7a68. A valid id for a different standard: the shape the
    // unknown-id throw was never able to see.
    expect(() =>
      standardRow("ubl-2-1-order", "parse", "UBL 2.1 / Peppol BIS", "Order documents."),
    ).toThrow(/names the 'peppol-bis-order-3' standard but takes its badge from 'ubl-2-1-order'/);
  });

  it("refuses the mismatch in either direction, not just this one pair", () => {
    expect(() => standardRow("cxml-1-2", "transform", "cXML / EDIFACT bridge", "")).toThrow(
      /edifact-orders/,
    );
    expect(() => standardRow("x12-850", "parse", "ANSI X12 850 / SAP IDoc", "")).toThrow(
      /sap-idoc-orders05/,
    );
    // Still throws on an id that does not exist — the original guarantee is not lost, and a typo
    // is reported as a typo rather than as a name mismatch against whatever the row is called.
    expect(() => standardRow("no-such-standard", "parse", "Mystery format", "")).toThrow(
      /unknown standards catalog id 'no-such-standard'/,
    );
    expect(() => standardRow("ubl-2-2-order", "parse", "UBL 2.2", "")).toThrow(
      /unknown standards catalog id 'ubl-2-2-order'/,
    );
  });

  it("allows a row that names the standard it derives from", () => {
    expect(() => standardRow("ubl-2-1-order", "parse", "UBL 2.1 Order", "")).not.toThrow();
    expect(() => standardRow("peppol-bis-order-3", "parse", "Peppol BIS Order 3.0", "")).not.toThrow();
    // And a row naming no standard at all is not this guard's business.
    expect(() => standardRow("csv", "transform", "CSV", "Configurable columns.")).not.toThrow();
  });

  it("leaves the Peppol NETWORK alone — it is a real transport, honestly marked", () => {
    // The distinction the token list encodes: "Peppol BIS" is a document profile we cannot back;
    // "Peppol" is a network we reach through a certified access-point partner. Both AS2/AS4 rows
    // say so as `onRequest`, and nothing here should touch them.
    const network = [...IMPORT_METHODS, ...DELIVERY_METHODS].filter((r) => /peppol/i.test(r.name));
    expect(network.length, "the two access-point rows must still exist").toBe(2);
    for (const row of network) {
      expect(row.status).toBe("onRequest");
      expect(row.note).toMatch(/certified/i);
    }
  });

  const ALL_ROWS: Array<{ array: string; row: FormatRow }> = [
    ...IMPORT_METHODS.map((row) => ({ array: "IMPORT_METHODS", row })),
    ...IMPORT_FORMATS.map((row) => ({ array: "IMPORT_FORMATS", row })),
    ...DELIVERY_METHODS.map((row) => ({ array: "DELIVERY_METHODS", row })),
    ...OUTPUT_FORMATS.map((row) => ({ array: "OUTPUT_FORMATS", row })),
  ];

  it("every shipped row naming a document standard derives from that standard's entry", () => {
    // `standardRow` can only check the rows that call it. This closes the other half: a row typed
    // by hand — which is exactly what the outbound Peppol row was — carries no `catalogId`, and is
    // caught here whatever its status happens to say.
    const offenders: string[] = [];

    for (const { array, row } of ALL_ROWS) {
      for (const { token, catalogId } of STANDARD_NAME_TOKENS) {
        if (!token.test(row.name)) continue;
        if (row.catalogId !== catalogId) {
          offenders.push(
            `${array}: "${row.name}" names '${catalogId}' but derives from ` +
              `${row.catalogId ? `'${row.catalogId}'` : "nothing (hand-typed status)"}`,
          );
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the row scan is not vacuous — it really reaches derived rows", () => {
    // If ALL_ROWS were ever wired to an empty or wrong source, the test above would pass by
    // examining nothing. This is the floor under it.
    expect(ALL_ROWS.length).toBeGreaterThan(20);
    expect(ALL_ROWS.filter(({ row }) => row.catalogId).length).toBeGreaterThanOrEqual(9);
    expect(
      ALL_ROWS.filter(({ row }) => STANDARD_NAME_TOKENS.some(({ token }) => token.test(row.name))).length,
    ).toBeGreaterThanOrEqual(9);
  });
});

// ── Direction: outbound badges come from `transform`, not `parse` ───────────────

describe("outbound status is derived from what we can emit", () => {
  it("reads a different level than the inbound one", () => {
    // EDIFACT is the discriminator: `parse: partial`, `transform: planned`. Wire `transformStatus`
    // back to `parse` and these two collapse to the same value.
    expect(parseStatus("edifact-orders")).toBe("configurable");
    expect(transformStatus("edifact-orders")).toBe("onRequest");
    expect(parseStatus("edifact-orders")).not.toBe(transformStatus("edifact-orders"));
  });

  it("no output format is sold from a standard we cannot emit", () => {
    for (const row of OUTPUT_FORMATS) {
      if (!row.catalogId) continue;
      const entry = STANDARDS.find((s) => s.id === row.catalogId);
      expect(entry, `OUTPUT_FORMATS row "${row.name}" cites a missing catalog id`).toBeDefined();
      expect(
        entry!.transform,
        `"${row.name}" is offered as an output format, but the catalog says we cannot transform ` +
          `into it (transform: "${entry!.transform}"). An input-only standard is not an output.`,
      ).not.toBe("none");
    }
  });

  it("UBL is still emitted, and it is Peppol BIS that stopped being sold", () => {
    // The founder decision has two halves and this pins both. Dropping the UBL row entirely would
    // be as wrong as claiming Peppol: the OASIS UBL 2.1 Order really is produced.
    const ubl = OUTPUT_FORMATS.find((r) => r.catalogId === "ubl-2-1-order");
    expect(ubl, "the UBL output row must survive — we do emit it").toBeDefined();
    expect(ubl!.status).toBe("live");
    expect(ubl!.name).not.toMatch(/peppol/i);

    expect(
      OUTPUT_FORMATS.some((r) => r.catalogId === "peppol-bis-order-3"),
      "nothing may be sold as Peppol BIS output while no BIS validation exists",
    ).toBe(false);
  });
});

// ── The hero numbers move only on purpose ──────────────────────────────────────

describe("the landing-page counts", () => {
  it("are what the page says, so a status change is never silent", () => {
    // (home)/page.tsx renders these three as "10 inbound / 6 outbound / 6 channels". Deriving them
    // stopped the numbers drifting from the table; pinning them stops the TABLE drifting unnoticed.
    expect({ INBOUND_FORMAT_COUNT, OUTBOUND_FORMAT_COUNT, DELIVERY_CHANNEL_COUNT }).toEqual({
      INBOUND_FORMAT_COUNT: 10,
      OUTBOUND_FORMAT_COUNT: 6,
      DELIVERY_CHANNEL_COUNT: 6,
    });
  });
});

// ── Prose: no surface claims a conformance nothing can back ─────────────────────

describe("no user-facing copy claims Peppol BIS conformance", () => {
  /**
   * The profile name, not the network name. "Peppol" on its own is a legitimate word here: it is a
   * real network, reached through a certified access-point partner, and the catalog says so.
   *
   * The separator class carries a hyphen and `&nbsp;`: the first form was `peppol[\s/]*bis`, and
   * "Peppol-BIS conformant output on every plan" was invisible to it — the profile was not even
   * recognised, so all three claiming verbs in that sentence went unread.
   */
  const PEPPOL_PROFILE = /peppol(?:[\s/-]|&nbsp;|\{" "\})*bis|\bbis[\s-]?(order[\s-]?)?3(\.0)?\b/i;

  /**
   * Verbs that turn a mention into a claim we produce or satisfy the profile.
   *
   * `support` was originally `\bsupported?\b`, which matches "support" and "supported" and NOT
   * "supports" — so `ProcuLink supports Peppol BIS Order 3.0`, the single likeliest sentence a
   * marketer writes, was invisible. Every verb here is now matched on its stem.
   */
  const CONFORMANCE_VERB =
    /\bemit|\bproduc|\boutput|\bconform|\bcomplian|\bcomplies|\bcertif|\bsupport|\blive\b|\bvalidat|\bdeliver|\bgenerat|\bexport|\bavailable\b|\bready\b|\bhandles?\b/i;

  /**
   * …unless the same line disclaims it.
   *
   * This was a loose word list built around `\bnot?\b`, which matches the word "no". "No X needed"
   * is ordinary marketing register, so `Peppol BIS Order 3 output with no extra setup.` and
   * `Full Peppol BIS 3 conformance, live in production, no access point needed.` both exonerated
   * themselves on a word that had nothing to do with the claim. `without` did the same for
   * `Validated against Peppol BIS Order 3.0 without leaving ProcuLink.`
   *
   * Now a disclaimer has to be an actual negation — a negated verb, or "no" attached to the thing
   * being denied rather than to a stray noun.
   */
  const DISCLAIMED =
    /\b(not|never|neither|nor|cannot|can't|isn't|aren't|doesn't|don't|unproven|uncertified)\b|\bno[\s-]+(schematron|bis|peppol|conformance|conformant|validation|certif)/i;

  const claims = (line: string): boolean =>
    PEPPOL_PROFILE.test(line) && CONFORMANCE_VERB.test(line) && !DISCLAIMED.test(line);

  // Test files are excluded: this suite lives in src/lib/marketing, and its own must-flag controls
  // quote the defect verbatim. A guard that reads its own fixtures as production copy reports the
  // proof as the crime.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|mdx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  /**
   * Blank out comments, preserving line numbering, so the notes recording why a claim was REMOVED
   * never read as the claim.
   *
   * The first version tested `/^\s*(\/\/|\/\*|\*)/` on every line of every file, which was wrong in
   * both directions. MDX has no comment syntax, and there `*` is a bullet or a bold marker — so
   * `* Peppol BIS 3 output supported.` was dropped as a "comment" while rendering as a list item on
   * a public help page. Meanwhile a JSX brace-comment block has continuation lines that start with
   * ordinary prose, so real comments were being scanned as copy. Blanking the block forms outright
   * is the only version that is right for both.
   */
  const scannableLines = (file: string): Array<{ line: string; number: number }> => {
    const source = readFileSync(file, "utf8");
    const text = /\.mdx$/.test(file)
      ? source // no comment syntax; every line is copy
      : source
          .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
          .split("\n")
          .map((line) => (/^\s*\/\//.test(line) ? "" : line))
          .join("\n");
    return text.split("\n").map((line, i) => ({ line, number: i + 1 }));
  };

  /**
   * Every file that puts a standards claim in front of a reader.
   *
   * `(home)` is here because it is a route group that adds no path segment — `src/app/(home)/` IS
   * `/`, the highest-traffic page on the site, and it is a sibling of `(marketing)` rather than a
   * child, so a walk of `(marketing)` never reaches it. That is the same shape as the defect this
   * branch fixes in `gatedCapabilityClaims` (a corpus stopping one directory short of the file it
   * was named after), and it was still present here until an adversarial pass went looking.
   *
   * `help-articles.ts` and `section-guides.ts` are not marketing pages and were outside every
   * existing scan, yet the help index card and the in-app section guide render their strings
   * verbatim. A previous sweep for this claim grepped for obvious words and missed five sites; a
   * corpus that stops at a directory boundary is how that happens.
   */
  const CORPUS = [
    ...walk(join(process.cwd(), "src/lib/marketing")),
    ...walk(join(process.cwd(), "src/app/(marketing)")),
    ...walk(join(process.cwd(), "src/app/(home)")),
    ...walk(join(process.cwd(), "src/components/marketing")),
    join(process.cwd(), "src/lib/standards/catalog.ts"),
    join(process.cwd(), "src/lib/help-articles.ts"),
    join(process.cwd(), "src/lib/section-guides.ts"),
    join(process.cwd(), "src/lib/upload-formats.ts"),
    join(process.cwd(), "src/lib/plans.ts"),
    join(process.cwd(), "src/app/(app)/library/standards/page.tsx"),
    join(process.cwd(), "src/components/bridge/DeliveryGuidedSetup.tsx"),
    join(process.cwd(), "src/components/bridge/DeliveryConfigEditor.tsx"),
  ];

  it("recognises the claims that really shipped", () => {
    // Verbatim at 5ac7a68. A guard that cannot see its own origin defect is decoration.
    expect(claims('  { name: "UBL 2.1 / Peppol BIS", status: "live", note: "" },')).toBe(true);
    expect(
      claims(
        '  description: "Parse UBL 2.1 Order documents inbound and emit UBL / Peppol BIS Order 3 output for European e-procurement.",',
      ),
    ).toBe(true);
    expect(claims("## Outbound: emitting UBL / Peppol BIS Order 3")).toBe(true);
    expect(
      claims(
        '    blurb: "Parse UBL 2.1 Order documents inbound and emit UBL / Peppol BIS Order 3 output for European e-procurement and Peppol networks.",',
      ),
    ).toBe(true);
    expect(claims("| Peppol BIS Order 3.0 | Supported |")).toBe(true);
    expect(claims("ProcuLink is Peppol BIS 3 compliant.")).toBe(true);
  });

  it("recognises the claims an adversary wrote to get past it", () => {
    // Every line below sailed through the first version of this predicate. They are kept as
    // controls because each names a distinct hole, and narrowing any part of the pattern back out
    // reddens exactly the one it was widened for.

    // Verb stem, not verb form: `\bsupported?\b` never matched the third person singular.
    expect(claims("ProcuLink supports Peppol BIS Order 3.0.")).toBe(true);
    expect(claims("| Peppol BIS Order 3.0 | Supports |")).toBe(true);
    expect(claims("ProcuLink delivers Peppol BIS Order 3.0 documents to your access point.")).toBe(true);
    expect(claims("Generate Peppol BIS Order 3.0 files for every supplier.")).toBe(true);
    expect(claims("Export orders as Peppol BIS Order 3.0.")).toBe(true);
    expect(claims("Peppol BIS Order 3.0 — available today on every plan.")).toBe(true);
    expect(claims("Peppol BIS Order 3.0 ready out of the box.")).toBe(true);

    // Separator: a hyphen or a JSX-split space used to hide the profile name entirely.
    expect(claims("Peppol-BIS conformant output on every plan.")).toBe(true);
    expect(claims("Peppol-BIS compliant, certified, and live today.")).toBe(true);
    expect(claims('<strong>Peppol&nbsp;BIS Order 3.0</strong> is supported.')).toBe(true);

    // An incidental "no"/"without" is not a disclaimer of anything.
    expect(claims("Peppol BIS Order 3 output with no extra setup.")).toBe(true);
    expect(claims("We produce Peppol BIS Order 3.0 documents with no manual steps.")).toBe(true);
    expect(claims("Peppol BIS Order 3.0 output is supported today; there is no separate fee.")).toBe(true);
    expect(claims("Full Peppol BIS 3 conformance, live in production, no access point needed.")).toBe(true);
    expect(claims("Validated against Peppol BIS Order 3.0 without leaving ProcuLink.")).toBe(true);

    // The INBOUND row is deliberately absent from this list. Its line carries no claiming verb —
    // the claim is in the derivation, not the prose — so the structural `catalogId` guard above is
    // what catches it. Two mechanisms, each named, rather than one regex asked to do both jobs.
    expect(
      claims('  { name: "UBL 2.1 / Peppol BIS", status: parseStatus("ubl-2-1-order"), note: "Order documents." },'),
    ).toBe(false);
  });

  it("does not fire on an honest disclaimer, or on the Peppol network", () => {
    expect(claims("Peppol BIS Order 3 output is not offered — ProcuLink emits UBL 2.1.")).toBe(false);
    expect(claims("ProcuLink does not certify Peppol BIS Order 3 conformance.")).toBe(false);
    expect(claims("No BIS 3 business-rule validation runs; there is no Schematron in the product.")).toBe(false);
    expect(
      claims('  { name: "AS2 / PEPPOL network receive", status: "onRequest", note: "Through a certified access-point partner." },'),
    ).toBe(false);
    // A field-path reference is not a conformance claim: BIS constrains UBL, so the paths are real.
    // This is the landing page's line, now that `(home)` is in the corpus.
    expect(claims("how each standard PO field maps to cXML, UBL, EDIFACT, X12, and Peppol BIS.")).toBe(false);
    expect(
      claims(
        'desc: "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode.",',
      ),
    ).toBe(false);
  });

  it("reads MDX bullets and JSX comments the right way round", () => {
    // `*` is a bullet and a bold marker in MDX, never a comment — a `^\s*\*` filter dropped real
    // rendered copy. Both of these ship on a public help page.
    const bulletClaim = "* Peppol BIS 3 output supported.";
    const boldClaim = "**Peppol BIS Order 3.0** is supported end to end.";
    expect(claims(bulletClaim)).toBe(true);
    expect(claims(boldClaim)).toBe(true);
    expect(/^\s*\*/.test(bulletClaim), "the old filter would have skipped this line").toBe(true);
  });

  it("finds none in the shipped corpus", () => {
    expect(CORPUS.length).toBeGreaterThan(10);
    // The corpus really reaches the landing page — the file that sat outside it until an
    // adversarial pass went looking.
    expect(CORPUS.some((f) => f.includes(join("src", "app", "(home)")))).toBe(true);

    const offenders: string[] = [];
    for (const file of CORPUS) {
      for (const { line, number } of scannableLines(file)) {
        if (claims(line)) offenders.push(`${file.replace(process.cwd(), "")}:${number}: ${line.trim()}`);
      }
    }

    expect(
      offenders,
      "these lines tell a reader ProcuLink produces or satisfies Peppol BIS Order 3. Nothing in " +
        "either repo can back that: no Schematron, an invoice-only validator, and an order-side " +
        "check that asserts the conformance ids are non-empty rather than correct. Say \"UBL 2.1 " +
        "Order\", or disclaim it on the same line:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
