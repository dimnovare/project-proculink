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
   */
  const PEPPOL_PROFILE = /peppol[\s/]*bis|\bbis (order )?3(\.0)?\b/i;

  /** Verbs that turn a mention into a claim we produce or satisfy the profile. */
  const CONFORMANCE_VERB =
    /\bemit|\bproduc|\boutput|\bconform|\bcomplian|\bcomplies|\bcertif|\bsupported?\b|\blive\b|\bvalidat/i;

  /** …unless the same line disclaims it. Every honest line about Peppol carries one of these. */
  const DISCLAIMED = /\bnot?\b|\bnever\b|\bcannot\b|\bwithout\b|\bneither\b|\buntil\b|\bpending\b/i;

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
   * Every file that puts a standards claim in front of a reader. `help-articles.ts` and
   * `section-guides.ts` are on this list because they are not marketing pages and were therefore
   * outside every existing scan — yet the help index card and the in-app section guide render
   * their strings verbatim. A previous sweep for this claim grepped for obvious words and missed
   * five sites; a corpus that stops at a directory boundary is how that happens.
   */
  const CORPUS = [
    ...walk(join(process.cwd(), "src/lib/marketing")),
    ...walk(join(process.cwd(), "src/app/(marketing)")),
    join(process.cwd(), "src/lib/standards/catalog.ts"),
    join(process.cwd(), "src/lib/help-articles.ts"),
    join(process.cwd(), "src/lib/section-guides.ts"),
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
    expect(claims("how each standard PO field maps to cXML, UBL, EDIFACT, X12, and Peppol BIS.")).toBe(false);
  });

  it("finds none in the shipped corpus", () => {
    expect(CORPUS.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of CORPUS) {
      readFileSync(file, "utf8")
        .split("\n")
        // Number BEFORE filtering — dropping comment lines first would renumber every offender.
        .map((line, i) => ({ line, number: i + 1 }))
        // A comment is not a claim — the notes recording WHY this was removed name the profile.
        .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .forEach(({ line, number }) => {
          if (claims(line)) offenders.push(`${file.replace(process.cwd(), "")}:${number}: ${line.trim()}`);
        });
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
