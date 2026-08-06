import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MINIMUM_PLAN } from "@/lib/gatedCapabilities";
import { DELIVERY_METHODS, IMPORT_METHODS, OUTPUT_FORMATS, type FormatRow } from "@/lib/marketing/format-catalog";
import { PLANS, effectiveFeatures, inheritanceLine, type Plan } from "@/lib/plans";

/**
 * WP-11 follow-through — **the tier a capability is ADVERTISED on must be the tier the backend
 * really gates it at.**
 *
 * WP-11 fixed four 403 codes that named Integration (€999) for gates whose real minimum was Growth
 * (€149). It fixed the codes. It did not check the pages a buyer reads *before* they ever see a
 * 403 — and `/formats`, which feeds the landing-page counts, was still telling everyone that IMAP,
 * SFTP and S3 ingestion were "Integration plan". Same false claim, same €850/month gap, on the more
 * visible surface.
 *
 * The rule this file enforces is CLAUDE.md §11.5's: *a capability may only be listed on a tier if
 * the backend really gates it there.* Both directions are failures — advertising a capability above
 * its real gate overcharges, and advertising one below its gate promises something the API refuses.
 */

// ── The backend gate table, mirrored ────────────────────────────────────────────
//
// Source of truth: ProcuLink.Core/Constants/PlanConstants.cs → `MinimumPlan`, enforced there by
// ProcuLink.Api.Tests/Architecture/BillingGateEnforcementIsRealTests (which reads compiled IL, so
// a row cannot be declared without a real enforcement site). It is a hand-kept mirror because the
// frontend cannot import C#. That is exactly why it is small, in one place, and asserted: drift has
// to break a test rather than sit in prose. If you change a minimum plan in PlanConstants.cs, that
// mirror is the other half of the change.
//
// The mirror used to live HERE, in the test file, and that turned out to be half a solution. Copy
// that needed to name a tier could not read it — a test file is not importable from a help page —
// so six help surfaces, the landing page and the print one-pager either typed the tier by hand or,
// far more often, named none at all. `src/lib/gatedCapabilities.ts` is the same table moved
// somewhere the copy can derive from it (`requiresPlan()`), with this suite as one more consumer
// rather than its owner.
const BACKEND_MINIMUM_PLAN = MINIMUM_PLAN;

const PLAN_NAMES = [
  "pilot",
  "growth",
  "operations",
  "integration",
  "distributor",
  "enterprise",
] as const;

/** Ladder position, cheapest first — "sold below its gate" is a comparison, not a string match. */
const rank = (plan: string): number => {
  const i = PLAN_NAMES.indexOf(plan as (typeof PLAN_NAMES)[number]);
  if (i < 0) throw new Error(`unknown plan '${plan}' — PLAN_NAMES is the ladder`);
  return i;
};

/**
 * Every `.ts`/`.tsx`/`.mdx` file under a directory. Module-scoped: more than one guard walks it.
 * Test files are skipped — a suite whose must-flag controls quote the defect verbatim would
 * otherwise be reported as committing it.
 */
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
 * The first version tested `/^\s*(\/\/|\/\*|\*)/` per line, which was wrong in both directions.
 * MDX has no comment syntax and `*` there is a bullet or a bold marker — 19 shipping help pages
 * already open paragraphs with `**bold**`, so real rendered copy was being skipped. Meanwhile a
 * JSX brace-comment block has continuation lines of ordinary prose, so real comments were scanned
 * as copy. Blanking the block forms outright is the only version right for both.
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
 * Every surface a buyer reads before they pay.
 *
 * `(home)` is a route group that adds no path segment, so `src/app/(home)/` IS `/` — the landing
 * page, a SIBLING of `(marketing)` rather than a child, which a walk of `(marketing)` never
 * reaches. It sells gated channels in its own hand-written copy. Leaving it out would have been
 * the identical defect to the one this file's own corpus note describes: a scan stopping one
 * directory short of the file it is named after.
 */
const buyerFacingLines = (): Array<{ file: string; line: string; number: number }> => {
  const files = [
    ...walk(join(process.cwd(), "src/lib/marketing")),
    ...walk(join(process.cwd(), "src/app/(marketing)")),
    ...walk(join(process.cwd(), "src/app/(home)")),
    ...walk(join(process.cwd(), "src/components/marketing")),
    join(process.cwd(), "src/lib/plans.ts"),
    join(process.cwd(), "src/lib/help-articles.ts"),
  ];
  return files.flatMap((file) =>
    scannableLines(file).map(({ line, number }) => ({
      file: file.replace(process.cwd(), ""),
      line,
      number,
    })),
  );
};

/**
 * SSO by any name a marketer would actually use.
 *
 * `\b` matters at the front: "subprocessors" contains "sso" and appears on six marketing pages.
 * Everything after `single-sign-on` was added when an adversarial pass pointed out that the
 * pattern recognised four spellings of a concept that has a dozen — "OpenID Connect" is the
 * literal expansion of OIDC and did not match, and "Enterprise Connections" is the name of the
 * Clerk product that would actually be switched on. None of these strings exist in the repo today,
 * which is the point: a green result should mean absence, not a narrow vocabulary.
 */
const SELLS_SSO =
  /\bsso\b|\bsaml\b|\boidc\b|openid connect|single[- ]sign[- ]on|\bscim\b|directory sync|identity provider|\bidp\b|federated login|\bokta\b|\bentra\b|azure ad|onelogin|enterprise connections/i;

/**
 * Every gated capability that has a ROW on `/formats`, and where to find it.
 *
 * This list used to hold three entries — IMAP, SFTP and S3 — and the test below used to accept a
 * row that named no plan at all, on the reasoning that "vagueness is not a false claim". Both
 * halves were wrong, and in the same direction:
 *
 *   • Three of the ten mirrored rows were consulted. `webhookDelivery`, `cxml` and
 *     `erpConnectors` also have catalog rows, and all three shipped with no tier — the ERP rows
 *     sat between SFTP and email as though a €2,500/mo connector were an ordinary file drop.
 *   • Vagueness IS a false claim on a comparison table. Sixteen lines above the ERP rows, three
 *     ingestion rows each end "Growth plan and up." A reader who has learned that convention
 *     reads a row with no tier as "included", because on this page that is what it means.
 *
 * `bulkMapping`, `advancedAudit`, `customSupplierRules` and `sso` are deliberately absent: they
 * have no `/formats` row to check. They are pricing-card capabilities and are policed by the card
 * scans further down, which is stated here rather than left as a silent gap.
 */
const GATED_CATALOG_ROWS: ReadonlyArray<{
  label: string;
  rows: FormatRow[];
  matches: RegExp;
  minimumPlan: string;
}> = [
  { label: "IMAP / email inbox polling", rows: IMPORT_METHODS, matches: /imap|email inbox/i, minimumPlan: BACKEND_MINIMUM_PLAN.emailIngestion },
  { label: "SFTP pull", rows: IMPORT_METHODS, matches: /sftp/i, minimumPlan: BACKEND_MINIMUM_PLAN.sftpIngestion },
  { label: "S3 / R2 pull", rows: IMPORT_METHODS, matches: /s3|r2 bucket/i, minimumPlan: BACKEND_MINIMUM_PLAN.s3Ingestion },
  { label: "HTTPS webhook delivery", rows: DELIVERY_METHODS, matches: /webhook/i, minimumPlan: BACKEND_MINIMUM_PLAN.webhookDelivery },
  { label: "Erply / Directo ERP delivery", rows: DELIVERY_METHODS, matches: /\berp\b/i, minimumPlan: BACKEND_MINIMUM_PLAN.erpConnectors },
  { label: "cXML output", rows: OUTPUT_FORMATS, matches: /\bcxml\b/i, minimumPlan: BACKEND_MINIMUM_PLAN.cxml },
];

/** The plan names a row's name+note mention, cheapest-first. */
const plansNamedIn = (row: FormatRow): string[] =>
  PLAN_NAMES.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(`${row.name} ${row.note ?? ""}`));

describe("advertised tier matches the enforced tier", () => {
  it.each(GATED_CATALOG_ROWS)(
    "$label: every /formats row for it names its real minimum plan",
    ({ label, rows, matches, minimumPlan }) => {
      const gated = rows.filter((m) => matches.test(m.name));
      expect(gated.length, `no /formats row matches ${label} — this test would be vacuous`).toBeGreaterThan(0);

      for (const row of gated) {
        const named = plansNamedIn(row);

        expect(
          named,
          `"${row.name}" is gated at ${minimumPlan} and names no plan. On a page where the ` +
            `ingestion rows each say "Growth plan and up", a row with no tier reads as included on ` +
            `every plan — which is how the ERP connectors were advertised at €149. Derive the tier ` +
            `with requiresPlan() from src/lib/gatedCapabilities.ts.`,
        ).not.toEqual([]);

        for (const plan of named) {
          expect(
            plan,
            `"${row.name}" tells the reader this needs the ${plan} plan, but the backend gates it ` +
              `at ${minimumPlan}. Naming a dearer tier sells an upgrade the customer does not need; ` +
              `naming a cheaper one promises something the API will refuse.`,
          ).toBe(minimumPlan);
        }
      }
    },
  );

  it("names no plan on the catalog rows nothing gates", () => {
    // The other direction, and the reason the rows above cannot simply be "every row names a
    // tier". `BillingGateErrors.RequiredFeatures` adds a requirement for the ERP protocols, for
    // `http`, and for the `cxml` output format — and for nothing else. SFTP, FTPS and email
    // DELIVERY are on every plan, so putting a tier on them would be the same defect mirrored:
    // an upgrade sold to a customer who does not need one. (Inbound SFTP and email are gated;
    // those are different rows, above, and they do name Growth.)
    const gatedRows = new Set(
      GATED_CATALOG_ROWS.flatMap(({ rows, matches }) => rows.filter((r) => matches.test(r.name))),
    );
    const ungated = [...IMPORT_METHODS, ...DELIVERY_METHODS, ...OUTPUT_FORMATS].filter((r) => !gatedRows.has(r));
    expect(ungated.length, "the corpus must really contain ungated rows").toBeGreaterThan(5);

    const offenders = ungated
      .filter((r) => plansNamedIn(r).length > 0)
      .map((r) => `${r.name} — names ${plansNamedIn(r).join(", ")}`);

    expect(
      offenders,
      "these /formats rows name a plan, but no BillingFeature gates them. Every plan has them:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("no pricing card sells a capability whose backend gate was deleted", () => {
    // "Custom output templates" named the saved-template subsystem retired by BE #75, whose plan
    // flag (CustomTemplates) was deleted by BE #80. Nothing gates it, so nothing may sell it as a
    // tier differentiator — the output designer and per-order overrides are on every plan.
    const retiredClaims = [/custom output template/i, /mapping library/i, /template library/i];

    for (const plan of PLANS) {
      for (const feature of plan.features) {
        for (const retired of retiredClaims) {
          expect(
            retired.test(feature),
            `the ${plan.id} card sells "${feature}", but no BillingFeature gates it — the subsystem ` +
              `behind that name was retired. A bullet nothing enforces is a false claim about the ` +
              `price list, which is the defect WP-11 exists to prevent.`,
          ).toBe(false);
        }
      }
    }
  });

  it("every plan-gated channel is sold from Growth up, on every paid tier", () => {
    // Paying MORE must never take a capability away, and the four channels are decoupled from
    // volume — so once a paid card mentions channels it must not imply a channel is missing.
    //
    // This reads `effectiveFeatures`, not `plan.features`. Since the cards were restructured
    // around `inheritsFrom` ("Everything in Growth, plus"), the tiers above Growth no longer
    // RESTATE the channels — that restatement is exactly what forced six lists to agree by hand
    // and is what they failed at. Reading only `plan.features` would now report the fixed cards
    // as broken; reading `billingSummary` alone would pass whatever the bullets said, because
    // every paid summary ends "· all channels". The set the card actually communicates is the
    // inherited one, so that is the set to check.
    const paidTiers = PLANS.filter((p) => p.id !== "pilot" && p.id !== "enterprise");
    expect(paidTiers.length).toBeGreaterThan(0);

    for (const plan of paidTiers) {
      const inherited = effectiveFeatures(plan);
      expect(
        inherited.length,
        `${plan.id} inherits nothing and lists nothing`,
      ).toBeGreaterThanOrEqual(plan.features.length);

      const blob = inherited.join(" ").toLowerCase();
      expect(
        /channel|webhook|sftp|s3|email/.test(blob),
        `the ${plan.id} card never mentions delivery or ingestion channels — not in its own ` +
          `bullets and not through the tiers it inherits — yet the backend grants all four from ` +
          `Growth up. Silence here reads as "not included" on the tier comparison.`,
      ).toBe(true);
    }
  });

  it("the Pilot card sells no capability the backend gates behind a paid plan", () => {
    const pilot = PLANS.find((p) => p.id === "pilot");
    expect(pilot).toBeDefined();

    const gated = [/webhook/i, /\bsftp\b/i, /\bs3\b/i, /\bimap\b/i, /\bcxml\b/i, /erp\b/i, /\bsso\b/i];
    for (const feature of pilot!.features) {
      for (const pattern of gated) {
        expect(
          pattern.test(feature),
          `the Pilot card offers "${feature}", but every BillingFeature is withheld below Growth ` +
            `(NoFeature_IsAvailableOnPilot in the backend suite). The trial would refuse it.`,
        ).toBe(false);
      }
    }
  });
});

describe("cancellation is disclosed where cancelling happens", () => {
  /**
   * `/pricing` has carried this since WP-11 (pinned by cancelDisclosure.test.tsx). But a customer
   * about to cancel is in Settings → Billing pressing "Manage in Stripe", not on the marketing
   * site — and Stripe's own portal cannot describe what ends on the ProcuLink side. The warning has
   * to exist at the point of action, and in the help article that documents that action.
   */
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the billing settings screen warns before handing off to the Stripe portal", () => {
    const source = read("src/components/bridge/BillingSection.tsx");

    expect(source).toMatch(/if you cancel/i);
    expect(source, "must name the channels that stop, not just say 'processing stops'").toMatch(/email/i);
    expect(source).toMatch(/sftp/i);
    expect(source).toMatch(/rest api/i);
    expect(source, "must say existing data survives, or it reads as data loss").toMatch(
      /stays readable|remain|still/i,
    );
    expect(source, "must tell them to redirect suppliers — nothing is queued for later").toMatch(
      /redirect your suppliers/i,
    );
  });

  it("the billing help article says what cancelling does, not only how to do it", () => {
    const article = read("src/app/(marketing)/help/billing-faq/page.mdx");

    const howTo = article.search(/## How to cancel/i);
    expect(howTo).toBeGreaterThan(-1);
    const section = article.slice(howTo);

    expect(section, "the section must state the consequence").toMatch(/stops accepting new orders/i);
    expect(section).toMatch(/redirect your suppliers/i);
    expect(section).toMatch(/readable and exportable|remain/i);
  });

  it("user-facing cancellation copy never leaks the internal status name", () => {
    // `read_only` / "frozen" are database and ops words. The customer needs the consequence, and
    // the same rule already guards /pricing — this extends it to the in-app surface.
    const source = read("src/components/bridge/BillingSection.tsx");
    const disclosure = source.slice(source.search(/If you cancel/i));

    expect(disclosure).not.toMatch(/read_only/);
    expect(disclosure).not.toMatch(/\bfrozen\b/i);
  });
});

describe("the tier→capability claim list is not duplicated outside plans.ts", () => {
  /**
   * `format-catalog.ts` drifted precisely because it held its own copy of a plan claim. Any NEW
   * marketing file that starts naming plans for gated channels is the same failure being reintroduced
   * somewhere this suite does not yet look, so the scan is over the whole marketing tree rather than
   * a fixed list of files.
   */
  /**
   * "<channel> … <dearer plan> plan(s)" close together on one line.
   *
   * Every part of the tail is load-bearing, and each was added because the previous form missed a
   * claim that really shipped:
   *
   *   • `\+?` / `plans?` — the first form ended `\b(integration|distributor|enterprise) plan\b`,
   *     the exact four-word phrasing format-catalog.ts happened to use. It read straight past the
   *     changelog's "IMAP email polling — Integration+ plans now auto-ingest …" for five releases:
   *     a `+` broke `integration plan`, and the plural broke `plan\b`.
   *   • `[^\n]` rather than `[^.\n]` — the window used to stop at a full stop, so a claim only
   *     counted if the channel and the tier sat in ONE sentence. The three rows this whole file
   *     exists to prevent do not:
   *
   *         note: "We poll your mailbox for order attachments. Integration plan."   (0e3c445^)
   *
   *     The channel is in `name:`, the tier is in `note:`, and a full stop sits between them — so
   *     the guard matched none of its own origin defects. Widened to the line, which is the unit
   *     these rows are written in. `{0,120}` still keeps two unrelated sentences apart.
   *
   * A pattern that only recognises the one wording it was written against guards that wording,
   * not the claim. The controls below pin every shape that has actually shipped.
   */
  const DEARER_TIER_CLAIM =
    /(imap|sftp|s3 ?\/? ?r2|s3 bucket)[^\n]{0,120}?\b(integration|distributor|enterprise)\+?\s+plans?\b/i;

  /** Which gated channel a line is talking about, and the tier that really unlocks it. */
  const CHANNELS = [
    { source: "imap|email inbox polling", minimumPlan: BACKEND_MINIMUM_PLAN.emailIngestion },
    { source: "sftp", minimumPlan: BACKEND_MINIMUM_PLAN.sftpIngestion },
    { source: "s3 ?\\/? ?r2|s3 bucket", minimumPlan: BACKEND_MINIMUM_PLAN.s3Ingestion },
  ];

  /**
   * The changelog is append-only: changelog-append-only.test.ts freezes every pre-2026-07-30 entry
   * byte for byte, because editing the entry that announced a feature claims it never shipped. So a
   * wrong tier inside a frozen entry cannot be edited out, and the remedy that contract prescribes
   * is a NEW entry putting it right.
   *
   * This is that allowance, and it is deliberately narrow: the correction must name the SAME
   * channel and the REAL minimum tier, and it must sit ABOVE the claim it corrects — the page is
   * newest-first, so "above" is what a reader meets first. Anything looser would be an exemption
   * for the changelog rather than a requirement that the record be put right.
   */
  const correctedAbove = (lines: string[], index: number): boolean => {
    const named = CHANNELS.filter((c) => new RegExp(c.source, "i").test(lines[index]));
    if (named.length === 0) return false;
    const above = lines.slice(0, index).join("\n");
    return named.every((c) =>
      new RegExp(`(?:${c.source})[^.\\n]{0,200}?\\b${c.minimumPlan}\\b`, "i").test(above),
    );
  };

  /** The one file whose history cannot be edited, so the one file the allowance applies to. */
  const APPEND_ONLY = join(process.cwd(), "src/app/(marketing)/changelog/page.tsx");

  it("no marketing copy claims a gated ingestion channel needs a tier above Growth", () => {
    // `src/lib/plans.ts` is in this corpus deliberately. The describe above is titled "not
    // duplicated outside plans.ts" and walked `src/lib/marketing` — one directory level below the
    // file it is named after, so the price list itself was never scanned by the widest scan in
    // this suite. That is how `"SSO (SAML/OIDC)"` sat on the Enterprise card unexamined: not
    // because a pattern was too narrow, but because the corpus stopped short of the file.
    const files = [
      ...walk(join(process.cwd(), "src/lib/marketing")),
      ...walk(join(process.cwd(), "src/app/(marketing)")),
      join(process.cwd(), "src/lib/plans.ts"),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!DEARER_TIER_CLAIM.test(line)) return;
        if (file === APPEND_ONLY && correctedAbove(lines, i)) return;
        offenders.push(`${file.replace(process.cwd(), "")}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(
      offenders,
      "these lines sell an ingestion channel at a tier dearer than the one the backend gates it " +
        "at (Growth). State the real minimum, or name no plan at all:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("recognises the phrasings that have shipped, not only the one it was written against", () => {
    // format-catalog.ts as it stood at 0e3c445^ — the three rows WP-11 fixed, verbatim. These are
    // the claims this file was written to prevent, so a pattern that misses them is decoration.
    for (const row of [
      '  { name: "Email inbox polling (IMAP)", status: "live", note: "We poll your mailbox for order attachments. Integration plan." },',
      '  { name: "SFTP folder pull", status: "live", note: "Point us at an SFTP folder; we import new files. Integration plan." },',
      '  { name: "S3 / R2 bucket pull", status: "live", note: "Watch a bucket prefix for order files. Integration plan." },',
    ]) {
      expect(DEARER_TIER_CLAIM.test(row), `the origin defect must match: ${row}`).toBe(true);
    }

    // The changelog's wording, which the first form of this pattern also let through.
    expect(
      DEARER_TIER_CLAIM.test('      "IMAP email polling — Integration+ plans now auto-ingest purchase orders from designated mailboxes",'),
    ).toBe(true);
    // The plural and the "+" independently, so narrowing either back out reddens this.
    expect(DEARER_TIER_CLAIM.test("SFTP folder pull — Enterprise plans only.")).toBe(true);
    expect(DEARER_TIER_CLAIM.test("S3 / R2 bucket pull — Distributor+ plan and up.")).toBe(true);

    // A correct claim is not an offence, and neither is naming no plan at all.
    expect(
      DEARER_TIER_CLAIM.test('  { name: "Email inbox polling (IMAP)", status: "live", note: "We poll your mailbox for order attachments. Growth plan and up." },'),
    ).toBe(false);
    expect(DEARER_TIER_CLAIM.test('  { name: "SFTP folder pull", status: "live", note: "Point us at an SFTP folder; we import new files." },')).toBe(false);
    // Nor is a tier named next to a capability that really is gated there — the offence is the
    // join of an INGESTION CHANNEL with a tier dearer than Growth, not any mention of a tier.
    expect(DEARER_TIER_CLAIM.test("Bulk mapping import, cXML support, advanced audit trail. Operations plan and up.")).toBe(false);
    // Distance and the line are what bound a claim now that the full stop no longer does. 120
    // characters spans `name:` → `note:` in a catalog row; a tier named far away, or on another
    // line, is not a claim about the channel.
    expect(DEARER_TIER_CLAIM.test(`SFTP folder pull.${" spacer".repeat(20)} Enterprise plan.`)).toBe(false);
    expect(DEARER_TIER_CLAIM.test("SFTP folder pull.\nEnterprise plan and up.")).toBe(false);
  });

  it("forgives a frozen claim only for a correction above it naming that channel and the real tier", () => {
    const claim = '"IMAP email polling — Integration+ plans now auto-ingest purchase orders from designated mailboxes",';
    const fix = '"IMAP email polling is included on Growth and up.",';

    expect(DEARER_TIER_CLAIM.test(claim)).toBe(true);
    expect(correctedAbove([claim], 0), "nothing above it corrects nothing").toBe(false);
    expect(correctedAbove(["SFTP folder pull — Growth plan and up.", claim], 1), "another channel is not a correction").toBe(
      false,
    );
    expect(correctedAbove(['"IMAP polling — Operations plan and up.",', claim], 1), "a tier that is still wrong is not a correction").toBe(
      false,
    );
    expect(correctedAbove([claim, fix], 0), "newest-first: a correction below is the one a reader meets second").toBe(false);
    expect(correctedAbove([fix, claim], 1)).toBe(true);
  });

  it("still sees the changelog's frozen tier claim, and finds it corrected", () => {
    // The only place the allowance is in use. If the pattern is ever narrowed so this line stops
    // matching, the allowance goes quiet and the guard reads green while blind — which is exactly
    // how "Integration+ plans" survived. So the match itself is asserted, not just its absence.
    const lines = readFileSync(APPEND_ONLY, "utf8").split("\n");
    const flagged = lines.map((line, i) => ({ line, i })).filter(({ line }) => DEARER_TIER_CLAIM.test(line));

    expect(flagged.map(({ line }) => line.trim()), "the frozen v1.4 IMAP line, and nothing else").toHaveLength(1);
    expect(flagged[0].line).toMatch(/imap/i);
    expect(
      correctedAbove(lines, flagged[0].i),
      "the frozen line cannot be edited, so a later entry has to state the real tier above it",
    ).toBe(true);
  });
});

/**
 * How each of the mirrored gate rows is SOLD on a pricing card.
 *
 * Keyed by `BACKEND_MINIMUM_PLAN`, so the type checker — not a reviewer — is what forces a matcher
 * to exist for every row. Adding a member to the mirror without adding one here fails
 * `bun run typecheck`.
 *
 * This map exists because the mirror was not one. `BACKEND_MINIMUM_PLAN` reads like the backend
 * gate table, and is described in its own comment as the thing drift "has to break a test rather
 * than sit in prose" against. Three of its ten rows were consulted (by `CHANNEL_CLAIM_PATTERNS`);
 * the other seven, `sso` among them, could be deleted outright without reddening anything. A table
 * nobody reads is prose wearing a test's clothes, which is precisely what it was written against.
 */

/**
 * A matcher may be a pattern or a predicate. `advancedAudit` needs the predicate form because
 * what separates the gated capability from the ungated one is SCOPE, not a keyword — see its
 * note below.
 */
type ClaimMatcher = RegExp | ((text: string) => boolean);

const claims = (sells: ClaimMatcher, text: string): boolean =>
  typeof sells === "function" ? sells(text) : sells.test(text);

/**
 * The org-wide, cross-order delivery log — `GET /api/audit`, refused below Operations by
 * `AuditController.GetAuditLog` (AuditController.cs:49) with `advanced_audit_requires_operations`
 * and rendered as "The full delivery log is not included in your plan" (CrossingsLog.tsx:606).
 *
 * This matcher used to be `/advanced audit/i`, and that is exactly why a live Growth org was
 * shown that refusal on 2026-08-06 while the Growth card sold them "Audit log". The bullet
 * carried no tier word for the scans above to catch, and no "advanced" for this one — so both
 * halves of the suite read straight past it.
 *
 * The real product boundary is scope, not the adjective. A PER-ORDER trail is open on every
 * plan including Pilot: `GET /api/orders/{id}/audit` (OrdersController.cs:2029) has no gate,
 * and is pinned deliberately as the IL scanner's negative control
 * (`Scanner_Control_DoesNotInventAGateWhereThereIsNone`,
 * BillingGateEnforcementIsRealTests.cs:143-155). So a bullet that scopes itself to one order
 * is honest on any tier, and a bullet that does not is a claim on the gated log.
 */
const SELLS_ORG_WIDE_AUDIT = (text: string): boolean =>
  (/\baudit\b/i.test(text) || /\bdelivery log\b/i.test(text)) &&
  !/\bper[- ]order\b|\bsingle[- ]order\b|\border[- ]level\b|\bfor (?:each|any|a single) order\b/i.test(text);

const CAPABILITY_CLAIMS: Record<keyof typeof BACKEND_MINIMUM_PLAN, { label: string; sells: ClaimMatcher }> = {
  webhookDelivery: { label: "webhook / API delivery", sells: /webhook/i },
  // Scoped to ingestion. A bare /\bemail\b/ would read an ordinary "Email support" bullet on the
  // Pilot card as Pilot selling Growth-gated inbound email — a false positive whose only obvious
  // fix is to narrow the pattern, which is how these guards lose their teeth.
  emailIngestion: {
    label: "inbound email ingestion",
    sells: /email[^\n]{0,40}(ingest|inbox|polling|channel)|(ingest|inbox|polling|channel)[^\n]{0,40}email/i,
  },
  sftpIngestion: { label: "SFTP ingestion", sells: /\bsftp\b/i },
  s3Ingestion: { label: "S3 / R2 ingestion", sells: /\bs3\b/i },
  bulkMapping: { label: "bulk mapping import/export", sells: /bulk mapping/i },
  cxml: { label: "cXML support", sells: /\bcxml\b/i },
  advancedAudit: { label: "the org-wide delivery log", sells: SELLS_ORG_WIDE_AUDIT },
  erpConnectors: { label: "ERP connectors", sells: /\berp\b/i },
  customSupplierRules: { label: "custom transformation rules", sells: /custom (transformation|supplier) rule/i },
  sso: { label: "SSO", sells: SELLS_SSO },
};

/** The cheapest tier whose card sells this capability, or null when no card sells it. */
const cheapestSeller = (plans: Plan[], sells: ClaimMatcher): Plan | null => {
  const selling = plans.filter((p) => p.features.some((f) => claims(sells, f)));
  if (selling.length === 0) return null;
  return selling.reduce((a, b) => (rank(a.id) <= rank(b.id) ? a : b));
};

/** `PLANS` with one extra bullet on one card — used to replay defects that really shipped. */
const withBullet = (planId: string, bullet: string): Plan[] =>
  PLANS.map((p) => (p.id === planId ? { ...p, features: [...p.features, bullet] } : p));

describe("the mirrored gate table is load-bearing, row by row", () => {
  it("has a matcher for every mirrored row, and mirrors no row it cannot match", () => {
    expect(Object.keys(CAPABILITY_CLAIMS).sort()).toEqual(Object.keys(BACKEND_MINIMUM_PLAN).sort());
  });

  it.each(Object.entries(CAPABILITY_CLAIMS))(
    "%s: no card sells it below the tier the backend gates it at",
    (key, { label, sells }) => {
      const minimumPlan = BACKEND_MINIMUM_PLAN[key as keyof typeof BACKEND_MINIMUM_PLAN];
      const cheapest = cheapestSeller(PLANS, sells);
      if (cheapest === null) return; // unsold is a separate question — pinned in the next test

      expect(
        rank(cheapest.id),
        `the ${cheapest.id} card sells ${label}, but the backend gates it at ${minimumPlan}. A ` +
          `customer who buys ${cheapest.id} for that bullet meets a 403, which is the same false ` +
          `claim WP-11 fixed in the other direction.`,
      ).toBeGreaterThanOrEqual(rank(minimumPlan));
    },
  );

  /**
   * MUST-FLAG CONTROL for the defect of 2026-08-06, quoted exactly as it shipped.
   *
   * `plans.ts:165` read `"Audit log"` on the Growth card while `/operations/log` refused a live
   * Growth org outright. Every guard in this repo that has ever mattered was the one replaying
   * its own origin defect, so the bullet is put back here — on a copy of `PLANS`, so the control
   * cannot be satisfied by the shipped file happening to be correct — and the same
   * `cheapestSeller` the real assertion uses has to place it below Operations.
   */
  it("catches the Growth 'Audit log' bullet that shipped, and lets the honest wording through", () => {
    const cheapest = cheapestSeller(withBullet("growth", "Audit log"), CAPABILITY_CLAIMS.advancedAudit.sells);
    expect(cheapest?.id, "the reintroduced defect must be seen at all").toBe("growth");
    expect(
      rank(cheapest!.id),
      "and must be seen as BELOW Operations — a matcher that finds it but ranks it fine is decoration",
    ).toBeLessThan(rank(BACKEND_MINIMUM_PLAN.advancedAudit));

    // Wordings that are unambiguously the gated cross-order log, on a tier that cannot serve it.
    for (const bullet of ["Audit log", "Full delivery log", "Delivery log export", "Audit trail"]) {
      expect(claims(CAPABILITY_CLAIMS.advancedAudit.sells, bullet), `must flag: ${bullet}`).toBe(true);
    }

    // And the honest Growth capability, which really is open on every plan including Pilot.
    // If these ever start flagging, the guard has stopped distinguishing the two products and
    // the only obvious repair is to narrow it back to `/advanced audit/i` — the blind version.
    for (const bullet of ["Per-order audit trail", "Per order audit trail", "Audit trail for each order"]) {
      expect(claims(CAPABILITY_CLAIMS.advancedAudit.sells, bullet), `must allow: ${bullet}`).toBe(false);
    }

    // The Operations/Integration wording that already shipped still has to register as a sale,
    // or `pins exactly which gated capabilities no card currently sells` goes quiet.
    expect(claims(CAPABILITY_CLAIMS.advancedAudit.sells, "Advanced audit trail + priority support")).toBe(true);
  });

  it("pins exactly which gated capabilities no card currently sells", () => {
    // The floor under the early return above. An unsold capability is legitimate — SSO is unsold
    // on purpose — but it must be a decision on this list, not a bullet that quietly went missing.
    const unsold = Object.entries(CAPABILITY_CLAIMS)
      .filter(([, { sells }]) => !PLANS.some((p) => p.features.some((f) => claims(sells, f))))
      .map(([key]) => key);

    expect(
      unsold,
      "SSO is deliberately unsold until a Settings surface exists (see below, and the note on the " +
        "Enterprise card in plans.ts). Anything else appearing here is a bullet that went missing.",
    ).toEqual(["sso"]);
  });
});

describe("SSO is sold only where it can be configured", () => {
  /**
   * `BillingFeature.Sso` is the one BillingFeature that refuses nothing. Its only production
   * reference is a `PlanConstants.PlanHasFeature` lookup surfaced as `BillingStatus.SsoAvailable`
   * (StripeBillingService.cs:191), and the IL-scanning gate test exempts it on the grounds that
   * "the flag drives the Settings availability/upsell only"
   * (BillingGateEnforcementIsRealTests.cs:100-103).
   *
   * That exemption names a Settings surface. There is none — `ssoAvailable` has no type field, no
   * mock, and no consumer anywhere in this codebase, and `SettingsTab` has no SSO member — while
   * `plans.ts` and `/security` both sold it. Founder decision, 2026-08-01: stop selling it until
   * the surface exists.
   *
   * The guard is BIDIRECTIONAL on purpose, so nobody has to remember that decision. While there is
   * no Settings SSO tab, no card and no marketing page may sell SSO. The moment such a tab appears,
   * this same test demands the price list say which plan includes it. Reversal becomes a change the
   * suite asks for, rather than a note somebody has to find.
   */
  const SETTINGS_DIR = join(process.cwd(), "src/app/(app)/settings");

  /**
   * Does a Settings surface for SSO exist?
   *
   * The first version of this probe read the `type SettingsTab = …;` union alone, and an
   * adversarial pass broke it three ways: a nested `settings/sso/page.tsx` route, an SSO card
   * inside the existing org tab, and — worst — the idiomatic dedupe
   * `type SettingsTab = (typeof TABS)[number]["id"]`, after which the union names no tabs at all.
   * That last one makes the probe answer "no surface" *without throwing* while a real tab renders:
   * a guard gone quiet while reading green, which is the exact failure mode this file keeps
   * meeting. So it scans the whole settings tree, where a route, a TABS entry, or the import of an
   * `SsoSection` all have to appear.
   *
   * What it still cannot see, stated rather than hidden: Clerk Enterprise Connections configured
   * out-of-band, with no ProcuLink screen at all. That is the delivery model the deleted /security
   * sentence described ("we set them up with you during onboarding"), so if SSO ships that way the
   * bullet has to be restored by hand and this probe will not prompt for it.
   */
  const settingsHasSsoSurface = (): boolean => {
    const files = walk(SETTINGS_DIR);
    if (files.length === 0) {
      throw new Error(
        `${SETTINGS_DIR} has no source files. This guard reads that tree to decide whether an SSO ` +
          "surface exists — rewire it before the move lands, rather than letting it answer 'no'.",
      );
    }
    return files.some((file) =>
      scannableLines(file).some(({ line }) => /\bsso\b|\bsaml\b/i.test(line)),
    );
  };

  const sellers = (): string[] => [
    ...PLANS.flatMap((p) =>
      p.features.filter((f) => SELLS_SSO.test(f)).map((f) => `plans.ts — ${p.id} card: "${f}"`),
    ),
    ...buyerFacingLines()
      .filter(({ line }) => SELLS_SSO.test(line))
      .map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`),
  ];

  it("the Settings-surface probe answers no today, and refuses to guess when the tree moves", () => {
    expect(settingsHasSsoSurface()).toBe(false);
    expect(walk(SETTINGS_DIR).length, "the probe must really be reading files").toBeGreaterThan(0);
    expect(() => walk(join(process.cwd(), "src/app/(app)/settings-that-moved"))).toThrow();
  });

  it("finds the claims that shipped, so a green result means absence and not blindness", () => {
    // The two sites that really sold it, verbatim at 5ac7a68. A pattern that misses its own origin
    // defect is decoration — and a bare /sso/i would also match "subprocessors", which appears on
    // six marketing pages, so the word boundary is load-bearing in both directions.
    expect(SELLS_SSO.test('      "SSO (SAML/OIDC)",')).toBe(true);
    expect(
      SELLS_SSO.test(
        '    body: "Org-scoped data isolation on every query, scoped API keys you can revoke instantly, and short-lived sessions by default. Role-based access and SAML/OIDC SSO are available on Enterprise — we set them up with you during onboarding.",',
      ),
    ).toBe(true);
    expect(SELLS_SSO.test("Single sign-on for your whole org")).toBe(true);
    expect(SELLS_SSO.test("A list of our subprocessors and what each one processes.")).toBe(false);

    // The spellings a marketer reaches for when they are not writing an acronym. None of these
    // exist in the repo today; each was invisible to the first version of this pattern.
    expect(SELLS_SSO.test("Log in with OpenID Connect")).toBe(true);
    expect(SELLS_SSO.test("Bring your own identity provider — Okta, Entra ID, or Google Workspace")).toBe(true);
    expect(SELLS_SSO.test("Federated login and SCIM directory sync on Enterprise")).toBe(true);
    expect(SELLS_SSO.test("We switch on Clerk Enterprise Connections for you")).toBe(true);
  });

  it("sells SSO if and only if Settings can configure it", () => {
    const hasSurface = settingsHasSsoSurface();
    const sold = sellers();

    if (hasSurface) {
      // Specifically the PRICE LIST, not merely "some page mentions it". `sellers()` unions the
      // cards with every buyer-facing line, so asserting on its length alone would let one passing
      // mention in a help article satisfy the guard while the Enterprise card stayed silent.
      expect(
        PLANS.some((p) => p.features.some((f) => SELLS_SSO.test(f))),
        "Settings now has an SSO surface, so the price list has to say which plan includes it — " +
          "put the bullet back on the Enterprise card. Its minimum plan is " +
          `${BACKEND_MINIMUM_PLAN.sso} (PlanConstants.MinimumPlan).`,
      ).toBe(true);
    } else {
      expect(
        sold,
        "these surfaces sell SSO, but there is no Settings SSO tab and `ssoAvailable` has no " +
          "consumer in this app, so a customer who pays for it has nowhere to set it up. Ship the " +
          "surface first; this guard will then ask for the bullet back:\n" + sold.join("\n"),
      ).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Every bullet is accounted for.
//
// The scans above are organised by CAPABILITY: "here is a thing the backend gates, which cards
// name it, is the cheapest of them at or above its gate". That leaves a whole class invisible —
// a bullet naming a capability NO `BillingFeature` grants at that tier. `"Audit log"` on the
// Growth card was exactly that shape and survived both dedicated guards for it:
//
//   • `gatedCapabilityClaims`' tier scans look for a TIER WORD next to a capability.
//     "Audit log" contains no tier word, so there was nothing for them to compare.
//   • the backend's `BillingFeatureGateCoverageTests` pins the ladder per enum member. A
//     marketing bullet naming no enum member at all is outside anything it can see.
//
// So this sweep runs the other direction — bullet first — and demands every single one be
// explained by something: a gated capability (whose tier the scans above then police), a quota
// the plan really carries, or an explicit allowlist entry saying why nothing gates it. Silence
// is the failure. A bullet nobody can account for is how the last one shipped.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Bullets that name a capability NOTHING gates, because it is genuinely on every plan — or that
 * are commercial/service prose with no code behind them at all.
 *
 * This list is the escape hatch, so it is deliberately uncomfortable to use: every entry needs a
 * reason, and `no allowlist entry is dead` below fails the build for any entry that stops
 * matching a live bullet. It cannot be used to pre-authorise a claim that has not shipped yet,
 * and it cannot quietly outlive the bullet it was written for.
 */
const UNGATED_BULLETS: ReadonlyArray<{ matches: RegExp; why: string }> = [
  {
    matches: /^CSV\/XLSX\/PDF\/XML upload$/i,
    why: "no BillingFeature gates a parser format — every plan, Pilot included, uploads all four",
  },
  {
    matches: /^Manual review$/i,
    why: "the review screen has no gate; it is the product's core loop, not a tier differentiator",
  },
  {
    matches: /^Supplier-ready export$/i,
    why: "downloading the transform artifact is ungated — the DELIVERY CHANNELS are what gate (WebhookDelivery, Growth+), and they are sold as their own bullets",
  },
  {
    matches: /^Field mapping \+ validation$/i,
    why: "the field mapper and validation rules are ungated. Only BULK mapping import/export is gated (BulkMapping, Operations+), and Operations/Distributor sell that separately",
  },
  {
    matches: /^Per-order audit trail$/i,
    why:
      "GET /api/orders/{id}/audit (OrdersController.cs:2029) has no gate and is pinned as the IL " +
      "scanner's negative control (BillingGateEnforcementIsRealTests.cs:143-155). Every plan " +
      "including Pilot really has this. The ORG-WIDE log is the gated one and is sold from " +
      "Operations up",
  },
  {
    matches: /^(Assisted|Priority|Dedicated) onboarding$/i,
    why: "human onboarding effort, delivered by people. No code path gates it and none should",
  },
  {
    matches: /^Founder-led supplier setup$/i,
    why: "human service on the Distributor tier, arranged manually (see SETUP_FEE_NOTE)",
  },
  {
    matches: /^SLA$/i,
    why: "a contractual commitment in the Enterprise agreement, not a feature flag",
  },
];

/** Parsed shape of a quota bullet — "150 orders/month", "5 suppliers", "Custom volume". */
const parseQuotaBullet = (
  bullet: string,
): { kind: "orders" | "suppliers"; value: number | null; saysMonthly: boolean } | null => {
  const numeric = /^([\d,]+)\s+(orders?|suppliers?)\b/i.exec(bullet);
  if (numeric) {
    return {
      kind: /^orders?$/i.test(numeric[2]) ? "orders" : "suppliers",
      value: Number(numeric[1].replace(/,/g, "")),
      saysMonthly: /\/\s*month|per month/i.test(bullet),
    };
  }
  // Enterprise states its allowances as custom rather than as a number.
  if (/^custom volume$/i.test(bullet)) return { kind: "orders", value: null, saysMonthly: false };
  if (/^custom suppliers?$/i.test(bullet)) return { kind: "suppliers", value: null, saysMonthly: false };
  return null;
};

/**
 * Split a bullet into the INDEPENDENT claims it makes.
 *
 * ── The bypass this closes ──────────────────────────────────────────────────────
 *
 * `accountFor` used to declare a bullet accounted for the moment ANY `CAPABILITY_CLAIMS` matcher
 * hit it. The Operations card read `"Advanced audit trail + priority support"`;
 * `advancedAudit.sells` matched on "Advanced audit trail", the whole bullet was marked explained,
 * and "priority support" never reached `UNGATED_BULLETS` — whose entries are anchored,
 * single-claim patterns like `/^(Assisted|Priority|Dedicated) onboarding$/i` and could not have
 * matched it anyway.
 *
 * So a compound bullet launders an unbacked claim through a backed one. That is a general bypass,
 * not one bullet: `"cXML support and a dedicated Slack channel"` would have passed identically.
 * Every clause now has to be accounted for on its own.
 *
 * ── Why only these separators ───────────────────────────────────────────────────
 *
 * ` + `, ` & ` and ` and ` join two independent claims. `·`, `,` and `/` enumerate members of ONE
 * claim — "Email · SFTP · S3 ingestion" shares a head noun, and shredding it produces the fragment
 * "Email", which no honest matcher could recognise and which would push a later reader to weaken
 * this until it caught nothing. Splitting on the conjunctions is what the defect used; splitting
 * on the list separators would only manufacture false positives.
 */
const splitClauses = (bullet: string): string[] =>
  bullet
    .split(/\s+(?:\+|&|and|plus)\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

type Verdict = { ok: true; because: string } | { ok: false; problem: string };

/**
 * What backs this bullet on this card? Shared by the real sweep and by its must-flag controls, so
 * a control cannot pass against logic the sweep does not actually run.
 */
const accountFor = (plan: Plan, bullet: string): Verdict => {
  const quota = parseQuotaBullet(bullet);
  if (quota) {
    const declared = quota.kind === "orders" ? plan.orderLimit : plan.supplierLimit;
    if (quota.value !== declared) {
      return {
        ok: false,
        problem:
          `the ${plan.id} card advertises "${bullet}", but the plan's ${quota.kind} allowance is ` +
          `${declared ?? "custom"}. The bullet and the number the app enforces have to be the same number.`,
      };
    }
    if (quota.kind === "orders" && quota.value !== null && quota.saysMonthly !== plan.orderLimitIsMonthly) {
      return {
        ok: false,
        problem:
          `the ${plan.id} card advertises "${bullet}", but orderLimitIsMonthly is ` +
          `${plan.orderLimitIsMonthly}. Pilot's 20 is a one-off trial total and the paid tiers reset ` +
          `monthly — saying the wrong one misstates what the customer is buying.`,
      };
    }
    return { ok: true, because: `quota bullet, matches plan.${quota.kind === "orders" ? "orderLimit" : "supplierLimit"}` };
  }

  // An UNGATED_BULLETS entry matching the WHOLE bullet accounts for the whole bullet. That is the
  // one place a compound may be excused in one go, and it is safe precisely because it is not
  // silent: the entry is anchored, hand-written, carries a stated reason, and `no allowlist entry
  // is dead` deletes it the moment the bullet stops existing. The bypass was never the allowlist —
  // it was a CAPABILITY matcher answering for text it had not read.
  const wholeBullet = UNGATED_BULLETS.find(({ matches }) => matches.test(bullet));
  if (wholeBullet) return { ok: true, because: `ungated: ${wholeBullet.why}` };

  const because: string[] = [];
  const unaccounted: string[] = [];

  for (const clause of splitClauses(bullet)) {
    const gated = Object.entries(CAPABILITY_CLAIMS).find(([, { sells }]) => claims(sells, clause));
    if (gated) {
      because.push(`"${clause}" → BillingFeature.${gated[0]} (its tier is policed above)`);
      continue;
    }
    const ungated = UNGATED_BULLETS.find(({ matches }) => matches.test(clause));
    if (ungated) {
      because.push(`"${clause}" → ungated: ${ungated.why}`);
      continue;
    }
    unaccounted.push(clause);
  }

  if (unaccounted.length === 0) return { ok: true, because: because.join("; ") };

  return {
    ok: false,
    problem:
      `the ${plan.id} card sells "${bullet}", and nothing accounts for ` +
      unaccounted.map((c) => `"${c}"`).join(" or ") +
      `: no BillingFeature matcher recognises it, it is not one of the plan's own quotas, and it ` +
      `is not on UNGATED_BULLETS. Either it names something a gate really grants — in which case ` +
      `teach CAPABILITY_CLAIMS that wording, so the tier scans can police it — or nothing ` +
      `enforces it, in which case add it to UNGATED_BULLETS with the reason, or delete the ` +
      `bullet. This is the exact shape "Audit log" had on the Growth card, and the shape ` +
      `"priority support" hid in behind "Advanced audit trail +".`,
  };
};

describe("every pricing-card bullet is accounted for by something real", () => {
  const everyBullet = PLANS.flatMap((plan) => plan.features.map((bullet) => ({ plan, bullet })));

  it("scans a real corpus — every plan, and bullets on all of them", () => {
    // The anti-vacuity floor. An empty or half-empty sweep passes every assertion below while
    // proving nothing, which is the failure mode this whole file keeps meeting.
    expect(PLANS.length, "the ladder itself").toBeGreaterThanOrEqual(6);
    // Derived from the ladder, not a round number. It was a hand-typed 30, which is a floor that
    // has to be re-typed every time the cards change shape — and when `inheritsFrom` let the
    // dearer tiers stop restating inherited bullets, a correct total of 29 read as a regression.
    // Every card owes two quota bullets (asserted below) plus at least one differentiator, so
    // three per card is the same floor expressed as the rule it was standing in for.
    for (const plan of PLANS) {
      expect(
        plan.features.length,
        `the ${plan.id} card must state both allowances and at least one differentiator`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(everyBullet.length, "bullets across all cards").toBeGreaterThanOrEqual(PLANS.length * 3);
  });

  it("no bullet on any card claims something nothing backs", () => {
    const unaccounted = everyBullet
      .map(({ plan, bullet }) => accountFor(plan, bullet))
      .filter((v): v is Extract<Verdict, { ok: false }> => !v.ok)
      .map((v) => v.problem);

    expect(unaccounted, unaccounted.join("\n\n")).toEqual([]);
  });

  it("every card states both of its own allowances, and states them correctly", () => {
    // The floor under the quota branch: it only checks bullets that LOOK like quotas, so a card
    // that simply stopped naming its order or supplier limit would sail through untouched.
    for (const plan of PLANS) {
      const kinds = plan.features.map(parseQuotaBullet).filter(Boolean).map((q) => q!.kind);
      expect(kinds, `the ${plan.id} card must state its order allowance`).toContain("orders");
      expect(kinds, `the ${plan.id} card must state its supplier allowance`).toContain("suppliers");
    }
  });

  it("no allowlist entry is dead", () => {
    // An entry that matches nothing is a standing permission for a claim nobody is making. It
    // either belongs to a bullet that was deleted, or it was added in advance of one — and the
    // second is how an allowlist turns into a bypass.
    // Clauses count as well as whole bullets: an entry written for one half of a compound is
    // doing real work even though no bullet matches it end to end.
    const live = everyBullet.flatMap(({ bullet }) => [bullet, ...splitClauses(bullet)]);
    const orphans = UNGATED_BULLETS.filter(({ matches }) => !live.some((text) => matches.test(text))).map(
      ({ matches }) => matches.source,
    );

    expect(
      orphans,
      "these UNGATED_BULLETS entries match no bullet on any card. Delete them — an allowlist may " +
        "only excuse claims that are actually being made:\n" + orphans.join("\n"),
    ).toEqual([]);
  });

  it("flags the shapes it exists to catch", () => {
    const growth = PLANS.find((p) => p.id === "growth")!;
    const pilot = PLANS.find((p) => p.id === "pilot")!;

    // 1. The origin defect. "Audit log" IS recognised here (it names the gated org-wide log), so
    //    this sweep hands it to the tier scans — which is where it is refused. Accounting for it
    //    and policing its tier are two different jobs; this asserts the handoff really happens.
    const audit = accountFor(growth, "Audit log");
    expect(audit.ok).toBe(true);
    expect(audit.ok && audit.because).toMatch(/advancedAudit/);
    expect(rank(cheapestSeller(withBullet("growth", "Audit log"), CAPABILITY_CLAIMS.advancedAudit.sells)!.id))
      .toBeLessThan(rank(BACKEND_MINIMUM_PLAN.advancedAudit));

    // 2. A capability bullet nothing grants and nothing excuses — the class this sweep adds.
    for (const invented of ["Dedicated account manager", "99.99% uptime guarantee", "Unlimited seats"]) {
      const v = accountFor(growth, invented);
      expect(v.ok, `must flag an unbacked bullet: ${invented}`).toBe(false);
    }

    // 3. A quota bullet that disagrees with the number the app enforces.
    expect(accountFor(growth, "500 orders/month").ok, "Growth's real allowance is 150").toBe(false);
    expect(accountFor(growth, "50 suppliers").ok, "Growth's real allowance is 5").toBe(false);

    // 4. Pilot's 20 is a one-off trial total, not a monthly reset.
    expect(accountFor(pilot, "20 orders/month").ok, "Pilot does not reset monthly").toBe(false);
    expect(accountFor(pilot, "20 orders total").ok).toBe(true);

    // 5. And the honest wording this defect was fixed with really does pass.
    expect(accountFor(growth, "Per-order audit trail").ok).toBe(true);
  });

  /**
   * MUST-FLAG CONTROL for the compound-bullet bypass, quoted exactly as it shipped.
   *
   * `plans.ts:210` read `"Advanced audit trail + priority support"` on the €399 Operations card.
   * Priority support is not a `BillingFeature`; `BillingFeature.cs:20-21` records that
   * `SlaOnboarding` was deleted for exactly this reason — an SLA and named support are fulfilled
   * by people and no code path can check them — and the published commitment is undifferentiated
   * anyway: `/support` offers every plan, free Pilot included, the same "within one business day".
   *
   * It survived because `advancedAudit.sells` matched "Advanced audit trail" and the whole bullet
   * was then declared accounted for. This replays it on a COPY of `PLANS`, so the control cannot
   * be satisfied by the shipped file happening to be correct.
   */
  it("catches an unbacked claim hiding in a compound bullet behind a backed one", () => {
    const operations = PLANS.find((p) => p.id === "operations")!;

    const shipped = accountFor(operations, "Advanced audit trail + priority support");
    expect(shipped.ok, "the bullet that shipped on the €399 card must be refused").toBe(false);
    // `in` rather than `!shipped.ok &&`: this repo compiles with `strictNullChecks: false`, under
    // which the boolean discriminant does not narrow the union.
    expect(
      "problem" in shipped && shipped.problem,
      "and refused for the RIGHT clause: a message naming the audit half would mean the split ran backwards",
    ).toMatch(/priority support/i);

    // The backed half on its own is still fine — the fix must not have been "ban the word audit".
    expect(accountFor(operations, "Advanced audit trail").ok).toBe(true);

    // The same laundering with other conjunctions, and with the unbacked claim FIRST, so the fix
    // cannot be an ordering accident.
    for (const compound of [
      "cXML support and a dedicated Slack channel",
      "Bulk mapping import/export & quarterly business reviews",
      "Priority support + advanced audit trail",
      "24/7 phone support and ERP connectors",
    ]) {
      expect(accountFor(operations, compound).ok, `must flag: ${compound}`).toBe(false);
    }

    // Genuine multi-capability bullets must still pass, or the only obvious repair is to stop
    // splitting — which restores the bypass. Both halves of each of these are really accounted for.
    for (const honest of [
      "Webhook/API delivery + email · SFTP · S3 ingestion",
      "Bulk mapping import/export + cXML support",
      "Field mapping + validation",
      "Email · SFTP · S3 ingestion",
    ]) {
      expect(accountFor(operations, honest).ok, `must allow: ${honest}`).toBe(true);
    }
  });
});

/**
 * Reading the price list left to right.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * Gates are MINIMUM-plan, so Integration and Distributor both include `Cxml`, `BulkMapping` and
 * `AdvancedAudit`. Their cards listed none of them. Integration named neither cXML nor bulk
 * mapping; Distributor named neither cXML nor advanced audit. Nothing on either card was false —
 * and a buyer comparing €399 to €999 to €1,499 saw the dearer tiers LOSE capabilities, which on a
 * comparison table is the same thing as a false claim, made about the cheaper tier's competitor.
 *
 * ── Why nothing already here could see it ───────────────────────────────────────
 *
 * Every scan above asks "is this capability sold BELOW its gate" (`:512`). Silent omission is
 * invisible to a guard that only ever looks at what a card DOES say. The nearest thing, "every
 * plan-gated channel is sold from Growth up", tested one hard-coded family of capabilities with a
 * keyword blob, and passed on `billingSummary` regardless of the bullets.
 *
 * ── How it is fixed, and therefore what this checks ─────────────────────────────
 *
 * Restating the inherited bullets on every card is the obvious repair, and it is the one the
 * founder's design position rules out — `docs/design-system/pricing-security-rebalance.md` §1:
 * "Stop selling by bullet count… 'Everything in {previous}, plus' + max 3 differentiating
 * bullets", on a fixed comparison axis of orders/month and suppliers. So the ladder is declared
 * once, as `Plan.inheritsFrom`, and monotonicity follows from the structure instead of from six
 * hand-maintained lists agreeing.
 *
 * That makes the chain itself the thing worth guarding: break one `inheritsFrom` and the
 * capability set of every tier above it collapses. Both halves are asserted — the chain is a
 * chain, and the effective sets really are monotone — because the second alone would read as
 * near-tautological and the first alone would not notice a capability that never enters the
 * ladder at all.
 */
describe("a dearer tier never appears to include less than a cheaper one", () => {
  /** The ladder as the pricing page renders it, cheapest first. */
  const ladder = PLANS.filter((p) => !p.hidden);

  /** Which gated capabilities a tier's card communicates, inherited bullets included. */
  const communicates = (plan: Plan): string[] =>
    Object.entries(CAPABILITY_CLAIMS)
      .filter(([, { sells }]) => effectiveFeatures(plan).some((f) => claims(sells, f)))
      .map(([key]) => key);

  it("the visible ladder is the ranked ladder, and it is a chain", () => {
    expect(ladder.map((p) => p.id), "PLAN_NAMES is the rank order used by every comparison above").toEqual([
      ...PLAN_NAMES,
    ]);
    expect(ladder[0].inheritsFrom, `${ladder[0].id} is the bottom of the ladder`).toBeNull();

    for (let i = 1; i < ladder.length; i++) {
      expect(
        ladder[i].inheritsFrom,
        `the ${ladder[i].id} card must declare that it includes everything in ${ladder[i - 1].id}. ` +
          "A break here silently empties the tier of every capability it no longer restates.",
      ).toBe(ladder[i - 1].id);
    }
  });

  it("renders the inheritance it declares, naming the tier below by name", () => {
    // The line the reader actually sees. `inheritsFrom` being right is worth nothing if the card
    // does not say so, and the pricing page takes this exact string.
    expect(inheritanceLine(ladder[0]), "Pilot inherits nothing").toBeNull();
    for (let i = 1; i < ladder.length; i++) {
      expect(inheritanceLine(ladder[i])).toBe(`Everything in ${ladder[i - 1].name}, plus`);
    }
  });

  it("no tier communicates fewer gated capabilities than the tier below it", () => {
    // Anti-vacuity: if the matchers stopped recognising the bullets, every set would be empty and
    // "monotone" would hold trivially.
    const top = communicates(ladder[ladder.length - 1]);
    expect(top.length, "the top tier must communicate most of the ladder, or this proves nothing").toBeGreaterThanOrEqual(6);

    const losses: string[] = [];
    for (let i = 1; i < ladder.length; i++) {
      const below = communicates(ladder[i - 1]);
      const here = communicates(ladder[i]);
      for (const capability of below) {
        if (!here.includes(capability)) {
          losses.push(
            `the ${ladder[i].id} card (€${ladder[i].priceMonthly ?? "custom"}) does not communicate ` +
              `${CAPABILITY_CLAIMS[capability as keyof typeof CAPABILITY_CLAIMS].label}, but the ` +
              `cheaper ${ladder[i - 1].id} card does — and the gate is a MINIMUM, so ${ladder[i].id} ` +
              "really includes it.",
          );
        }
      }
    }

    expect(losses, losses.join("\n")).toEqual([]);
  });

  it("catches a broken chain, which is how the omission would come back", () => {
    // MUST-FLAG CONTROL. Replayed on a copy, so it cannot pass because the shipped file is fine.
    // Cutting Integration loose is exactly the state the cards shipped in: it stops communicating
    // cXML, bulk mapping and advanced audit while costing €600/month more than the tier that does.
    const broken: Plan[] = PLANS.map((p) => (p.id === "integration" ? { ...p, inheritsFrom: null } : p));
    const byId = (id: string) => broken.find((p) => p.id === id)!;

    const chainOf = (plan: Plan): string[] => {
      const out: string[] = [];
      let cur: Plan | undefined = plan;
      while (cur) {
        out.unshift(...cur.features);
        cur = cur.inheritsFrom == null ? undefined : byId(cur.inheritsFrom);
      }
      return out;
    };
    const communicatesIn = (plan: Plan): string[] =>
      Object.entries(CAPABILITY_CLAIMS)
        .filter(([, { sells }]) => chainOf(plan).some((f) => claims(sells, f)))
        .map(([key]) => key);

    const lost = communicatesIn(byId("operations")).filter((c) => !communicatesIn(byId("integration")).includes(c));
    expect(lost, "a severed link must show up as capabilities the dearer tier appears to lose").not.toEqual([]);
    expect(lost).toContain("cxml");
  });
});

/**
 * The workspace-wide delivery log, and the export of it.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * `/security` shipped this, unqualified, to every reader:
 *
 *     "Export the full delivery log for any order at any time."
 *
 * Two failures, and the second is the worse one:
 *
 *   1. It named no tier. The workspace-wide log is `GET /api/audit`, gated on
 *      `BillingFeature.AdvancedAudit` -> Operations (`PlanConstants.cs:276`). A Growth or Pilot
 *      reader takes an unqualified sentence as included, and `/operations/log` then refuses them
 *      with `advanced_audit_requires_operations` (`CrossingsLog.tsx:413-416`).
 *   2. "for any order at any time" described a per-order export that does not exist as such. The
 *      only CSV export of audit data in the product is on that same Operations-gated page
 *      (`CrossingsLog.tsx:441`). It does honour the `?orderId=` filter, so an Operations customer
 *      can export one order's rows -- but only from the page it loaded, which the page itself
 *      discloses as partial (`windowPartial`). The claim was untrue on EVERY tier, not merely
 *      mis-tiered, which is why naming a tier alone would not have repaired it.
 *
 * This sat on the security page, which is what a buyer's compliance reviewer reads before signing.
 *
 * ── Why the guards already here could not see it ────────────────────────────────
 *
 * They compare a capability against a NAMED tier, so a claim naming no tier at all is invisible to
 * them; and the newest of them reaches `PLANS.features` only, while this claim lived in free
 * marketing prose. Hence a guard whose offence is the claim itself rather than a tier mismatch.
 *
 * ── What this guard can and cannot do ───────────────────────────────────────────
 *
 * Stated plainly, because a guard trusted past its reach is worse than none. It is LINE-SCOPED and
 * VOCABULARY-BOUND. It catches an offer to export or open the workspace-wide log that names no
 * tier, or names one below Operations. It does NOT catch a claim split across two lines, nor one
 * avoiding both the nouns and the verbs below -- "download your complete order history as a
 * spreadsheet" names neither. Its corpus is `buyerFacingLines()`, which does not reach the
 * `/sign-in` and `/sign-up` trust strips; those say "Full audit trail", which is true per order,
 * but a delivery-log claim added there would not be seen. Each arm below is pinned by a control
 * quoting copy that really shipped.
 *
 * The line between an offence and an honest sentence is deliberate, and it is NOT "mentions the
 * log". Recording is universal and append-only on every plan, and so is reading ONE order's
 * history: `GET /api/orders/{id}/audit` is ungated on purpose, pinned as the IL scanner's negative
 * control (`BillingGateEnforcementIsRealTests.cs:143-155`) and rendered at `OrderWorkshop.tsx:377`.
 * A sentence saying the log RECORDS something is true and stays. The offence is directing a reader
 * to OPEN or EXPORT the workspace-wide log without saying what it costs. Over-correcting the true
 * half into something timid gives away real sales value, so the controls pin that too.
 */
describe("the workspace-wide delivery log is not offered below the tier that unlocks it", () => {
  /** Nouns for a recorded trail, in the spellings marketing copy actually uses. */
  const AUDIT_RECORD = String.raw`(?:delivery|audit|activity|event)\s+(?:log|trail|history)`;

  /** The workspace-wide surface specifically -- the one that is gated. */
  const LOG_SURFACE = /\b(?:delivery|audit|activity|event)\s+log\b/i;

  /**
   * Getting audit data OUT. No export of it exists on any tier below Operations, so this arm needs
   * no tier comparison of its own -- any undisclosed export claim is wrong.
   *
   * `[^.\n]` is what bounds it, not a character count. The landing page carries
   *
   *     "... or download the artifact. Encrypted credentials, AES-GCM at rest, full audit trail
   *      per attempt."
   *
   * where "download" and "audit trail" sit 70 characters apart in TWO sentences about two
   * different things -- the transformed output file, and the recording. A width-bounded window
   * flags that; a sentence-bounded one does not, and an export claim is written as one sentence.
   */
  const EXPORT_VERB = String.raw`(?:export|exports|exported|exporting|download|downloads|downloadable)`;
  const EXPORTS_AUDIT_DATA = new RegExp(
    `\\b${EXPORT_VERB}\\b[^.\\n]{0,60}?\\b${AUDIT_RECORD}\\b` +
      `|\\b${AUDIT_RECORD}\\b[^.\\n]{0,60}?\\b${EXPORT_VERB}\\b`,
    "i",
  );

  /**
   * Writing the navigation path IS directing the reader there, so this arm needs no verb -- which
   * matters, because the help bullet that shipped had none. Its imperative ("Where to watch
   * statuses") was a heading away, where a line-scoped guard cannot reach.
   */
  const NAV_PATH_TO_THE_LOG = /\boperations\s*(?:→|->|›|»|>|\/)\s*log\b/i;

  /**
   * Verbs of ACCESS, not of RECORD. "records", "keeps", "captures", "retained" and "shows" are
   * deliberately absent: they describe what the system does, which is true for everyone, and
   * flagging them would push a later reader to narrow this pattern until it caught nothing.
   */
  const READS = /\b(?:open|opens|check|checks|go to|view|views|see|watch|browse|filter|search|read|reads)\b/i;

  /**
   * A tier disclosure, DERIVED from the mirrored gate row rather than typed -- if `AdvancedAudit`
   * moves in `PlanConstants.cs`, the mirror above is the one edit and this follows it.
   *
   * It requires a plan WORD beside the tier name, which is the whole point: the offending bullet
   * read "**Operations -> Log**", so any check for the bare string "operations" would have excused
   * the exact line this guard exists to catch.
   */
  const MIN_PLAN = BACKEND_MINIMUM_PLAN.advancedAudit;
  const DEAR_ENOUGH = PLAN_NAMES.slice(rank(MIN_PLAN)).join("|");
  const DISCLOSES_TIER = new RegExp(
    `\\b(?:${DEAR_ENOUGH})\\b[^\\n]{0,40}?\\b(?:plan|plans|tier|and up|or above|and above)\\b` +
      `|\\b(?:plan|plans|tier)\\b[^\\n]{0,40}?\\b(?:${DEAR_ENOUGH})\\b`,
    "i",
  );

  /** Does this line offer the gated log without saying what it costs? */
  const offends = (line: string): boolean => {
    const claims =
      EXPORTS_AUDIT_DATA.test(line) ||
      NAV_PATH_TO_THE_LOG.test(line) ||
      (READS.test(line) && LOG_SURFACE.test(line));
    return claims && !DISCLOSES_TIER.test(line);
  };

  it("no buyer-facing line offers the delivery log or its export without naming the tier", () => {
    const lines = buyerFacingLines();

    // Anti-vacuity. A corpus that silently emptied -- a renamed route group, a walk stopping one
    // directory short -- would make every assertion below pass while reading nothing at all.
    expect(lines.length, "the corpus must really be reading copy").toBeGreaterThan(1000);
    expect(
      lines.filter(({ file }) => /security[\\/]page\.tsx$/.test(file)).length,
      "the security page is where the defect shipped; it has to be inside the corpus",
    ).toBeGreaterThan(0);
    expect(
      lines.filter(({ file }) => file.endsWith(".mdx")).length,
      "the help articles are MDX; a corpus that skips them misses half the surface",
    ).toBeGreaterThan(0);

    const offenders = lines
      .filter(({ line }) => offends(line))
      .map(({ file, number, line }) => `${file}:${number}: ${line.trim()}`);

    expect(
      offenders,
      "these lines offer the workspace-wide delivery log, or an export of audit data, without " +
        `saying it starts at ${MIN_PLAN}. GET /api/audit is gated on BillingFeature.AdvancedAudit ` +
        "and /operations/log refuses anything cheaper. Name the tier, or describe the per-order " +
        "history instead -- that one really is on every plan:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("flags the claims that shipped, verbatim, so a green result means absence and not blindness", () => {
    // `/security` as it stood at the commit before this one -- the exact source line, not a
    // tidier paraphrase. A control rewritten to suit the pattern proves only that the pattern
    // matches itself.
    expect(
      offends(
        '    body: "Every parse, edit, validation and delivery attempt is recorded in an append-only audit log. Export the full delivery log for any order at any time.",',
      ),
      "the /security claim this guard exists for",
    ).toBe(true);

    // `/help/dashboard-and-statuses` at the same commit. It carries no verb at all, and the word
    // "Operations" appears as a NAV LABEL -- both of which a looser guard reads as innocent.
    expect(
      offends("- **Operations → Log** — a date-grouped audit trail of every status change and event."),
      "the help article's undisclosed destination",
    ).toBe(true);

    // Shapes that have not shipped here but are one edit away.
    expect(offends("Download the full delivery log whenever you need it."), "download, not export").toBe(true);
    expect(offends("Export your audit trail to CSV at any time."), "audit trail, not the word log").toBe(true);
    expect(offends("Open the delivery log to see every event across your workspace."), "open, not export").toBe(true);
    expect(offends("Head to Operations / Log for the whole history."), "the slash form of the nav path").toBe(true);
  });

  it("treats a tier below the gate as an offence too, and takes the gate from the mirror", () => {
    // Naming SOME tier is not the bar; naming one that really unlocks it is.
    expect(
      offends("Export the full delivery log for any order — Growth plan and up."),
      "growth is below the gate",
    ).toBe(true);
    expect(offends("Export the full delivery log for any order — Pilot plan.")).toBe(true);

    // And the acceptance is pinned to the mirrored row, not to a literal. The tier directly below
    // the minimum must not excuse a claim; the minimum and everything above it must.
    const below = PLAN_NAMES[rank(MIN_PLAN) - 1];
    expect(DISCLOSES_TIER.test(`${below} plan and up`), `${below} is one rung below ${MIN_PLAN}`).toBe(false);
    for (const plan of PLAN_NAMES.slice(rank(MIN_PLAN))) {
      expect(DISCLOSES_TIER.test(`included from the ${plan} plan up`), `${plan} is at or above the gate`).toBe(true);
    }
  });

  it("leaves alone the sentences that are true on every plan", () => {
    // Recording happens for everyone. Saying so is not selling the gated surface.
    expect(offends("Audit log entries are retained for the life of the account."), "/privacy:124").toBe(false);
    expect(
      offends("The order shows **delivered**, and the delivery log records the attempt with the supplier's response."),
      "review-an-order:143 -- a statement of record, not an instruction to open a gated page",
    ).toBe(false);
    expect(
      offends("later be marked as rejected by the supplier, and the delivery log keeps both facts."),
      "review-an-order:161 -- likewise",
    ).toBe(false);
    expect(
      offends("Every attempt is logged in an append-only audit trail."),
      "how-it-works:120",
    ).toBe(false);
    // Two sentences, two subjects: the artifact is downloadable per order, the audit trail is a
    // separate statement of record. This is the line that made a width-bounded window wrong.
    expect(
      offends(
        "HTTP webhook, SFTP, email or ERP connector — or download the artifact. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.",
      ),
      "(home)/page.tsx:195 -- neither half is a delivery-log export claim",
    ).toBe(false);
    // The changelog is frozen byte-for-byte by changelog-append-only.test.ts, so a guard flagging
    // it could not be satisfied at all. It is also true: the per-order history is ungated.
    expect(offends('      "Audit log — full event history for every order",'), "the frozen v1.1 entry").toBe(false);
    // The per-order trail, which every plan really does get, must stay sellable in plain words.
    expect(
      offends("Open the order to read its full audit trail — every attempt, on every plan."),
      "per-order, ungated, and worth selling",
    ).toBe(false);
  });
});

/**
 * "Append-only", and every other promise about how records BEHAVE.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * `/security` carried the phrase in four places at once — the card title, the card body, the page
 * description and the OG description — and `/how-it-works` in a fifth:
 *
 *     title: "Append-only audit trail",
 *     "Every parse, edit, validation and delivery attempt is recorded in an append-only audit log."
 *
 * Four greps falsify it, and a security page is exactly where someone runs them:
 *
 *   • `DeliveryService.cs:975-983` UPDATES the in-flight `dispatching` row IN PLACE to its terminal
 *     outcome — `existingAttempt.Status = status; …ResponseCode…ResponseBody…AcknowledgedAt…
 *     ArtifactSha256 =`.
 *   • `OpsController.cs:251` — `attempt.CapSupersededAt = now;` stamps existing rows on requeue.
 *   • `DataErasureService.cs:136,139,140` — HARD DELETE. `RemoveRange` over `DeliveryAttempts`,
 *     `PoPassportEvents` and `AuditEvents`.
 *   • `IDataRetentionService.cs:4-16` prunes those same three tables past a retention window.
 *
 * No database-level immutability backs any of them. The repo's only immutability trigger is on
 * `supplier_connection_revisions`, a different table.
 *
 * There is real mitigation, and it is why the intent was honest: erasure is `[AdminOnly]` behind an
 * env allowlist and fails closed, so a customer cannot delete their own records; retention is off by
 * default; and a destructive cap-reset was deliberately replaced by the non-destructive
 * `CapSupersededAt` stamp after a P1. The system is append-only-ISH by design. But a marketing page
 * does not get to claim the intent — it claims the property, and the property is not enforced.
 *
 * ── Why this is its own guard ───────────────────────────────────────────────────
 *
 * The block above catches a capability sold at the wrong TIER. This is the adjacent class and the
 * tier machinery cannot see it: a durability claim is wrong on every tier at once, so there is no
 * tier to compare against. What makes it wrong is the storage layer, not the price list.
 *
 * ── Why it is an outright ban rather than a conditional ─────────────────────────
 *
 * The SSO guard below asks "does the Settings surface exist?" and demands the bullet back when it
 * does. The same shape is tempting here and is not available: the enforcement that would make
 * "append-only" true lives in the BACKEND repo, which this suite cannot read — it is a separate
 * checkout that is not present on CI. A probe that silently answers "no enforcement" because the
 * path does not exist is not a probe. So the ban is unconditional and the exit is documented
 * instead: if a DB trigger or an equivalent ever makes audit/delivery/passport rows genuinely
 * immutable, delete this block and put the word back — do not weaken the pattern to sneak it past.
 */
describe("no buyer-facing copy claims records are immutable, because nothing enforces it", () => {
  /** The three tables the claim was made about. */
  const RECORD_NOUN = String.raw`(?:audit|delivery|passport|order)\s+(?:log|logs|trail|trails|record|records|history|event|events|attempt|attempts)`;

  /**
   * Words that promise the row cannot change. "Append-only" is the one that shipped; the rest are
   * what a writer reaches for next once it is gone, which is the point — a guard that bans exactly
   * one phrase teaches the phrase, not the rule.
   */
  const IMMUTABILITY_WORD = String.raw`(?:append[- ]only|immutable|immutability|unalterable|unchangeable|tamper[- ](?:proof|evident)|write[- ]once)`;

  const CLAIMS_IMMUTABLE = new RegExp(
    `\\b${IMMUTABILITY_WORD}\\b[^.\\n]{0,60}?\\b${RECORD_NOUN}\\b` +
      `|\\b${RECORD_NOUN}\\b[^.\\n]{0,60}?\\b${IMMUTABILITY_WORD}\\b`,
    "i",
  );

  /**
   * The same promise spelled as a sentence rather than an adjective. This one is here because it
   * was the near-miss: it was proposed as the REPLACEMENT for "append-only" during review
   * ("Records are never overwritten by a retry and never deleted by the product") and it is
   * falsified by the very same `RemoveRange` lines. Swapping one falsifiable claim for another is
   * the failure this whole file exists to stop, so the replacement is guarded too.
   */
  const CLAIMS_NEVER_DESTROYED =
    /\brecords?\b[^.\n]{0,50}?\bnever\b[^.\n]{0,30}?\b(?:deleted|erased|removed|destroyed|purged|overwritten)\b/i;

  const offends = (line: string): boolean => CLAIMS_IMMUTABLE.test(line) || CLAIMS_NEVER_DESTROYED.test(line);

  it("no buyer-facing line promises records cannot be changed or deleted", () => {
    const lines = buyerFacingLines();

    // Anti-vacuity, same reasoning as the block above: an emptied corpus must fail, not pass.
    expect(lines.length, "the corpus must really be reading copy").toBeGreaterThan(1000);
    expect(
      lines.filter(({ file }) => /security[\\/]page\.tsx$/.test(file)).length,
      "the security page carried four of the five instances; it has to be in the corpus",
    ).toBeGreaterThan(0);

    const offenders = lines
      .filter(({ line }) => offends(line))
      .map(({ file, number, line }) => `${file}:${number}: ${line.trim()}`);

    expect(
      offenders,
      "these lines promise records are immutable or undeletable. Nothing enforces that: " +
        "DeliveryService.cs:975-983 updates attempt rows in place, OpsController.cs:251 stamps " +
        "them at requeue, and DataErasureService.cs:136-140 hard-deletes DeliveryAttempts, " +
        "PoPassportEvents and AuditEvents via RemoveRange. Say what is recorded instead:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("flags every instance that shipped, verbatim", () => {
    // All five, exactly as they stood before this change. Quoting them is the only way a green
    // result means the copy is clean rather than the pattern being blind.
    for (const shipped of [
      '    title: "Append-only audit trail",',
      '    body: "Every parse, edit, validation and delivery attempt is recorded in an append-only audit log. Export the full delivery log for any order at any time.",',
      '    "ProcuLink sits between your buyers and suppliers. How we protect that position — encryption, EU-region storage, an append-only audit trail, and responsible AI.",',
      '    "Encryption, EU-region storage, an append-only audit trail, access control, and responsible AI — how ProcuLink protects the orders passing through it.",',
      '      "The canonical order is transformed into the exact format the supplier requires and delivered over their channel — webhook, SFTP, email or ERP connector. Every attempt is logged in an append-only audit trail.",',
    ]) {
      expect(offends(shipped), `the shipped instance must match: ${shipped.trim().slice(0, 70)}…`).toBe(true);
    }

    // The words a writer reaches for once "append-only" is banned.
    expect(offends("An immutable audit trail of every change."), "immutable").toBe(true);
    expect(offends("Tamper-proof delivery records."), "tamper-proof").toBe(true);
    expect(offends("Write-once audit log."), "write-once").toBe(true);
    // And the sentence form, which was proposed as the replacement during review.
    expect(
      offends("Records are never overwritten by a retry and never deleted by the product; requeues supersede rather than erase."),
      "the near-miss replacement — falsified by the same RemoveRange lines",
    ).toBe(true);
  });

  it("leaves the honest replacement alone", () => {
    // What actually shipped. Every clause is checkable: the fields are on DeliveryAttempt.cs
    // (Channel 11, Destination 12, AttemptedAt 25, ResponseCode 26, AttemptNumber 69,
    // ArtifactSha256 94), OrdersController makes no HasFeatureAsync call, and the response-body
    // clause is scoped to the channels whose CapturesSupplierResponseBody is true.
    expect(
      offends(
        "Every parse, edit, validation and delivery attempt is recorded. Each delivery attempt carries its timestamp, channel, endpoint, attempt number, response code, and the SHA-256 fingerprint of the bytes dispatched; on channels that return one — webhook, email API, ERP — a failed or rejected attempt also stores the supplier's response. A retry adds a new numbered attempt rather than replacing the previous one, and requeueing supersedes earlier attempts rather than erasing them. You can open any single order and read its complete history on every plan; the workspace-wide delivery log across all orders, with filtering and CSV export, is included from the Operations plan up.",
      ),
      "describing what is stored is not a durability promise",
    ).toBe(false);
    expect(
      offends("Every attempt is recorded with its response code and a SHA-256 fingerprint of the bytes sent."),
      "/how-it-works, as replaced",
    ).toBe(false);
    // "Supersedes rather than erases" is the accurate description of OpsController.cs:251 and must
    // stay sayable — it is a statement about what requeue does, not a promise about forever.
    expect(offends("Requeueing supersedes earlier attempts rather than erasing them.")).toBe(false);
    // A tier claim is the other block's business, not this one's.
    expect(offends("The workspace-wide delivery log is included from the Operations plan up.")).toBe(false);
  });
});

/**
 * A gated capability presented with NO tier at all.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * CLAUDE.md §11.5 says a capability may only be listed on a tier if the backend really gates it
 * there, and every guard above reads that as "do not name the WRONG tier". The corollary shipped
 * on eleven surfaces: **naming no tier is not neutral.** cXML output was sold as an unconditional
 * "Supported" — `/help/output-templates`, `/help/guides/set-up-supplier-delivery`,
 * `/help/delivery-setup`, `/help/guides/add-a-supplier`, `/help/csv-xlsx-field-guide`,
 * `/help/guides/map-supplier-po-fields`, the whole of `/help/cxml-setup`, and `/formats` — while
 * `BillingGateErrors.RequiredFeatures` maps `outputFormat: "cxml"` to `BillingFeature.Cxml`, so a
 * Growth org saving that delivery config is refused with `cxml_output_requires_operations`. The
 * ERP connectors were worse: listed beside SFTP and email on the landing page, the print
 * one-pager, `/how-it-works`, `/help` and `/formats` as though a €2,500/mo capability were an
 * ordinary file drop. Only `/help/billing-faq` got it right.
 *
 * The same documents name the tier correctly for IMAP, S3 and SFTP. A reader who has learned that
 * convention on one page reads its absence on the next as "included".
 *
 * ── Why it is FILE-scoped, not line-scoped ──────────────────────────────────────
 *
 * Because a reader reads an article, not a line. `/help/cxml-setup` mentions cXML in fifteen
 * places; making each one carry a tier would be unreadable, and a line-scoped guard would demand
 * exactly that. One disclosure per file is the honest unit, and it is what these articles now do.
 *
 * ── What it can and cannot see ──────────────────────────────────────────────────
 *
 * Stated plainly, because a guard trusted past its reach is worse than none.
 *
 *   • It catches cXML in a sentence with outbound vocabulary, and cXML in a format-support table
 *     row — the two shapes that shipped. It does NOT catch cXML presented as an output across two
 *     lines with neither carrying a direction word: `AnimatedPipelinePanel.tsx` renders
 *     "supplier output" on line 120 and a bare `CXML` chip on line 122, and this reads past it.
 *     (The page that renders that panel, `/how-it-works`, does disclose.)
 *   • It catches the ERP adapters by name, which is safe because Erply and Directo exist in this
 *     product only as delivery channels. A generic "your ERP" is deliberately not a claim.
 *   • It says nothing about `webhookDelivery`, `emailIngestion`, `customSupplierRules` or
 *     `advancedAudit` in prose. Those are separate clusters with their own untiered surfaces
 *     still outstanding; extending this list is the follow-up, and the shape is already here.
 */
describe("a gated capability is never presented with no tier at all", () => {
  /**
   * Two files are outside this scan, and both for a reason, not for convenience. The list is
   * asserted below so it cannot quietly grow.
   *
   *   • `plans.ts` — a bullet on a pricing card IS tiered: the card's own header is the tier.
   *     The card scans police it far more precisely (`no card sells it below the tier the backend
   *     gates it at`, and the monotonicity block above).
   *   • the changelog — frozen byte for byte by `changelog-append-only.test.ts`, so an entry
   *     cannot be edited to add a tier even if one wanted to. A dated release note records what
   *     shipped that day; it is not the price list.
   */
  const EXEMPT = [
    join(process.cwd(), "src/lib/plans.ts"),
    join(process.cwd(), "src/app/(marketing)/changelog/page.tsx"),
  ];

  /** Every buyer-facing file, with its scannable lines — the same corpus, grouped by file. */
  const buyerFacingFiles = (): Array<{ file: string; lines: string[] }> => {
    const byFile = new Map<string, string[]>();
    for (const { file, line } of buyerFacingLines()) {
      const list = byFile.get(file) ?? [];
      list.push(line);
      byFile.set(file, list);
    }
    return [...byFile].map(([file, lines]) => ({ file, lines }));
  };

  /** Words that put a format in the OUTBOUND direction. Inbound cXML parsing is ungated. */
  const OUTPUT_VERB = String.raw`(?:output|outbound|emit|emits|emitted|produce|produces|deliver|delivers|delivered|delivery|send|sends|sending|supplier receives)`;

  const CXML_IN_PROSE = new RegExp(
    `\\bcxml\\b[^.\\n]{0,90}?\\b${OUTPUT_VERB}\\b|\\b${OUTPUT_VERB}\\b[^.\\n]{0,90}?\\bcxml\\b`,
    "i",
  );

  /**
   * The header row of the markdown table a line belongs to, or null.
   *
   * The origin defect is a table cell: `| cXML 1.2 | Supported |`, under `| Format | Output
   * support |`. The direction lives in the header, two lines up, where nothing line-scoped can
   * reach it — which is why a guard written only against prose would have read straight past the
   * page it was written for.
   */
  const tableHeaderFor = (lines: string[], index: number): string | null => {
    if (!/^\s*\|/.test(lines[index])) return null;
    for (let i = index - 1; i >= 0 && /^\s*\|/.test(lines[i]); i--) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) return lines[i - 1] ?? null;
    }
    return null;
  };

  /** Does line `i` present cXML as something ProcuLink SENDS? */
  const presentsCxmlOutput = (lines: string[], i: number): boolean => {
    const line = lines[i];
    if (!/\bcxml\b/i.test(line)) return false;
    if (CXML_IN_PROSE.test(line)) return true;
    // A format-support table row. "Supported" beside a format name is a support claim whether or
    // not the header happens to spell out the direction — `| Format | Status |` carried one too.
    const header = tableHeaderFor(lines, i);
    return header !== null && /\bsupported\b|\boutput\b|\bnot offered\b/i.test(`${line} ${header}`);
  };

  /**
   * The ERP adapters, by name. Erply and Directo exist in this product only as delivery channels,
   * so naming either IS presenting the gated capability. A customer's own "ERP" in the abstract
   * (`api-order-schema-reference`: "when an ERP, procurement system…") is not, and must not be —
   * over-reaching here is what gets a guard weakened until it catches nothing.
   */
  const ERP_CHANNEL = /\b(?:erply|directo)\b|\berp\s+(?:connector|connectors|adapter|adapters)\b/i;

  /**
   * …except when the ERP is named as the SOURCE of a file rather than a destination.
   * `/help/mapping-basics` offers a starter mapping template "for common ERP exports (Erply and
   * Directo)" — a column layout you might receive, nothing to do with the delivery adapter, and
   * on every plan. Flagging it would push a later reader to weaken the matcher itself; excusing
   * exactly this shape, with a control quoting the line, keeps the matcher sharp.
   */
  const ERP_AS_FILE_SOURCE = /\b(?:export|exports|template|templates|starter)\b/i;

  const ERP_CONNECTOR_CLAIM = (line: string): boolean =>
    ERP_CHANNEL.test(line) && !ERP_AS_FILE_SOURCE.test(line);

  /** `requiresPlan("cxml")` and friends — a disclosure DERIVED from the gate table. */
  const derivedDisclosure = (capability: string) =>
    new RegExp(
      `\\b(?:requiresPlan|minimumPlanName|minimumPlanId|includedFromPlan)\\(\\s*["'\`]${capability}["'\`]\\s*\\)`,
    );

  /**
   * A tier named in words, at or above the real minimum, beside something that marks it as a PLAN
   * NAME. Taken from the mirrored row rather than typed, so re-tiering a capability moves this
   * with it.
   *
   * The qualifier is load-bearing in both directions. Without it, "Enterprise Resource Planning"
   * would read as a disclosure and "**Operations → Log**" — a sidebar label on nine help pages —
   * would excuse the very claims the block above exists to catch. With only `plan|tier`, it missed
   * `/help/billing-faq`'s plan ladder, which names each tier against its price and never uses the
   * word: "`Enterprise` — custom pricing from €2,500/month; … ERP connectors, and SLA." A price is
   * as unambiguous a plan marker as the word "plan", so `€` is in the qualifier set.
   */
  const literalDisclosure = (minimumPlan: string) => {
    const dearEnough = PLAN_NAMES.slice(rank(minimumPlan)).join("|");
    // `\b` inside, so "Planning" in "Enterprise Resource Planning" is not a plan marker.
    const planMarker = String.raw`(?:\b(?:plan|plans|tier|and up|or above|and above)\b|€)`;
    return new RegExp(
      `\\b(?:${dearEnough})\\b[^\\n]{0,40}?${planMarker}` + `|${planMarker}[^\\n]{0,40}?\\b(?:${dearEnough})\\b`,
      "i",
    );
  };

  const CLAIMS = [
    {
      capability: "cxml" as const,
      label: "cXML output",
      presents: presentsCxmlOutput,
    },
    {
      capability: "erpConnectors" as const,
      label: "the Erply / Directo ERP connectors",
      presents: (lines: string[], i: number) => ERP_CONNECTOR_CLAIM(lines[i]),
    },
  ];

  it.each(CLAIMS)("$label: every file presenting it names the tier somewhere", ({ capability, label, presents }) => {
    const minimumPlan = BACKEND_MINIMUM_PLAN[capability];
    const discloses = [derivedDisclosure(capability), literalDisclosure(minimumPlan)];

    const files = buyerFacingFiles().filter(({ file }) => !EXEMPT.some((e) => e.endsWith(file)));
    expect(files.length, "the corpus must really be reading files").toBeGreaterThan(40);

    const presenting = files.filter(({ lines }) => lines.some((_, i) => presents(lines, i)));
    expect(
      presenting.length,
      `no file presents ${label} — either the corpus emptied or the matcher went blind, and ` +
        "either way this test proves nothing",
    ).toBeGreaterThan(3);

    const offenders = presenting
      .filter(({ lines }) => !lines.some((line) => discloses.some((d) => d.test(line))))
      .map(({ file, lines }) => {
        const i = lines.findIndex((_, n) => presents(lines, n));
        return `${file}:${i + 1}: ${lines[i].trim()}`;
      });

    expect(
      offenders,
      `these files present ${label} and never say it starts at ${minimumPlan}. On pages that name ` +
        "the tier for IMAP, SFTP and S3, saying nothing reads as included on every plan. Import " +
        `requiresPlan("${capability}") from @/lib/gatedCapabilities and state it once:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("flags the claims that shipped, verbatim, so a green result means absence and not blindness", () => {
    // `/help/output-templates` at 68ed5f2 — the table, exactly as it stood. The direction is in the
    // header and the cell says only "Supported", which is why this needed the table rule.
    const outputTemplates = ["| Format | Output support |", "|---|---|", "| CSV | Supported |", "| cXML 1.2 | Supported |"];
    expect(presentsCxmlOutput(outputTemplates, 3), "the /help/output-templates row").toBe(true);

    // `/help/guides/set-up-supplier-delivery` at the same commit — same shape, header says only
    // "Status", so a rule keyed on the word "output" alone would have missed it.
    const deliveryGuide = ["| Format | Status |", "|---|---|", "| cXML | Supported |"];
    expect(presentsCxmlOutput(deliveryGuide, 2), "the set-up-supplier-delivery row").toBe(true);

    // The prose forms, verbatim.
    for (const shipped of [
      "On the same tab you set the **output format** the supplier requires (CSV, XML, cXML, UBL 2.1, X12, JSON) — sending auto-transforms into it.",
      "XLSX is an **input format only** — ProcuLink reads it in, but delivers to your supplier in CSV, XML, cXML, UBL, X12, or JSON, whichever they require.",
      "ProcuLink parses inbound cXML orders and emits cXML output.",
      '          { n: "2", t: "Map + transform", d: "Per-supplier field + item-code mapping with AI suggestions. Output to CSV, XML, cXML, JSON." },',
    ]) {
      expect(presentsCxmlOutput([shipped], 0), `must flag: ${shipped.slice(0, 60)}…`).toBe(true);
    }

    // And the ERP lines, verbatim.
    for (const shipped of [
      '    desc: "HTTP webhook, SFTP, email or ERP connector — or download the artifact. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.",',
      '  Delivery: "HTTP webhook, SFTP/FTPS, email, and ERP connectors (Erply, Directo).",',
      '          { n: "3", t: "Deliver", d: "HTTP webhook, SFTP/FTPS, email, Erply, Directo, or download. Full audit trail and delivery status." },',
      "- **Erply / Directo** — purpose-built ERP adapters for those tenants.",
      '  { name: "Erply (ERP connector)", status: "configurable", note: "We switch it on with you against your Erply account before go-live." },',
    ]) {
      expect(ERP_CONNECTOR_CLAIM(shipped), `must flag: ${shipped.slice(0, 60)}…`).toBe(true);
    }
  });

  it("leaves inbound cXML and a customer's own ERP alone", () => {
    // Parsing cXML is ungated on every plan and is discussed on a dozen pages. If these ever start
    // flagging, the only obvious repair is to weaken the direction test until it catches nothing.
    for (const honest of [
      "- A real purchase order file. CSV, XLSX, and text-based PDF are the everyday formats; XML, cXML, UBL, EDIFACT, X12, and SAP IDoc are read too.",
      "Common PO formats include CSV, XLSX, text-based PDF, XML/cXML, UBL/Peppol-style XML, SAP IDoc (ORDERS05), EDIFACT, and X12.",
      "Each rule shows the standards references for its field (UBL, EDIFACT, X12, cXML), so you can point at the exact element when a supplier asks which one you mean.",
      "choices are CSV, XLSX, JSON, XML (cXML Index or vendor XML), and CIF (Ariba 3.0).",
      '    desc: "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode. Built for 30-year procurement veterans.",',
    ]) {
      expect(presentsCxmlOutput([honest], 0), `must allow: ${honest.slice(0, 60)}…`).toBe(false);
    }

    // "ERP" as the customer's own system, and the EDIFACT article's "Directory mismatch", which a
    // careless \bdirecto\b would swallow.
    for (const honest of [
      "Use the inbound order API when an ERP, procurement system, or automation tool already holds the order as structured data",
      "Treat the supplier's confirmation (order confirmation, ERP booking) as the real finish line.",
      "- **Directory mismatch.** `D96A` and `D01B` differ in some composite structures.",
      // /help/mapping-basics:31 verbatim — the ERP named as a FILE SOURCE, not a destination.
      // This is an ungated mapping template for a CSV layout you might receive.
      '- **Starter templates** — the PO mapping editor has a one-click "Apply starter template" for common ERP exports (Erply and Directo). Apply one, then adjust the column names to match your real export.',
    ]) {
      expect(ERP_CONNECTOR_CLAIM(honest), `must allow: ${honest.slice(0, 60)}…`).toBe(false);
    }
  });

  it("accepts a derived disclosure and a written one, and refuses a tier below the gate", () => {
    const discloses = (line: string, capability: "cxml" | "erpConnectors") =>
      derivedDisclosure(capability).test(line) ||
      literalDisclosure(BACKEND_MINIMUM_PLAN[capability]).test(line);

    expect(discloses('  Supported — {requiresPlan("cxml")}', "cxml"), "the derived form").toBe(true);
    expect(discloses("cXML output is included from the Operations plan up.", "cxml"), "written out").toBe(true);
    expect(discloses("cXML output is on the Growth plan and up.", "cxml"), "growth is below the cXML gate").toBe(false);
    expect(discloses('note: `… ${requiresPlan("erpConnectors")}.`', "erpConnectors")).toBe(true);
    expect(discloses("The ERP connectors need the Operations plan.", "erpConnectors"), "below the ERP gate").toBe(false);
    // A nav label is not a disclosure — the word "Operations" is a sidebar group on nine pages.
    expect(discloses("- **Operations → Log** — a date-grouped audit trail.", "cxml"), "nav label only").toBe(false);
  });

  it("exempts exactly two files, and says why in code rather than in a comment", () => {
    expect(EXEMPT.map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"))).toEqual([
      "/src/lib/plans.ts",
      "/src/app/(marketing)/changelog/page.tsx",
    ]);
    // Both must really exist; an exemption for a moved file is an exemption for nothing.
    for (const file of EXEMPT) expect(() => readFileSync(file, "utf8")).not.toThrow();
  });
});
