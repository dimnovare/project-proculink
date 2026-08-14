import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectLayoutProblems, isEmittedFormat } from "@/components/bridge/outputTreeProblems";
import { CONFORMANCE_PROFILES } from "@/lib/api-client";
import { PREVIEW_FORMATS, type OutputNodeTemplate } from "@/lib/api/types";
import { MINIMUM_PLAN } from "@/lib/gatedCapabilities";
import {
  DELIVERY_METHODS,
  IMPORT_METHODS,
  OUTPUT_FORMATS,
  STANDARD_NAME_TOKENS,
  type FormatRow,
} from "@/lib/marketing/format-catalog";
import { PLANS, effectiveFeatures, inheritanceLine, type Plan } from "@/lib/plans";
import { STANDARDS } from "@/lib/standards/catalog";

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
 * Every `.ts`/`.tsx`/`.mdx` under `src/` — the IN-APP product as well as the marketing site.
 *
 * `buyerFacingLines()` is deliberately left as it is: its consumers ask about pricing and about
 * the delivery log, and widening their corpus would change what those guards mean. This is the
 * wider one, for the guards whose offence is a CLAIM rather than a tier.
 *
 * Memoised at module scope because two describes now need it — the conformance scan and the
 * outbound-format scan below. Walking and reading the whole source tree twice pushed the pair
 * past vitest's 5s default on a loaded machine, and re-reading the tree per describe is the same
 * two-strippers hazard `scripts/lib/sourceScan.mjs` exists to end.
 */
let productCorpus: Array<{ file: string; line: string; number: number }> | null = null;
const productLines = (): Array<{ file: string; line: string; number: number }> =>
  (productCorpus ??= walk(join(process.cwd(), "src")).flatMap((file) =>
    scannableLines(file).map(({ line, number }) => ({
      file: file.replace(process.cwd(), ""),
      line,
      number,
    })),
  ));

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

/**
 * The CONFIGURABLE per-supplier rule set — the versioned acceptance profile on a supplier's
 * Validation rules tab. `SupplierAcceptanceController.GateAsync`
 * (SupplierAcceptanceController.cs:37-46) refuses it below Enterprise on BOTH authoring (:70) and
 * activating (:99); only reading existing versions is left open, so a downgraded org can still see
 * what its suppliers enforce.
 *
 * This matcher used to be `/custom (transformation|supplier) rule/i`. Measured over the buyer-facing
 * corpus that phrasing matched exactly ONE line in the entire product — the Enterprise card's own
 * bullet — and nothing anybody else would ever type. So the €149 Growth card sold
 * `"Field mapping + validation"` and three help articles taught the feature with no tier at all,
 * and this row read past every one of them.
 *
 * The real boundary is the same shape as `SELLS_ORG_WIDE_AUDIT`'s: not an adjective, but WHICH of
 * two products is named. BUILT-IN checks are ungated on every plan including Pilot —
 * `InvariantValidator` and `OutputFieldValidator` run whether or not a profile exists
 * (SupplierAcceptanceService.cs:202-204; `EvaluateProfile` returns empty at :389), and every
 * transform calls `OutputFieldValidator.ValidateEntity` before emitting a byte. A CONFIGURABLE
 * per-supplier rule set is the gated one.
 *
 * ── The blind spot that was measured, and closed ────────────────────────────────
 *
 * The form above recognised the rule set by its NOUN PHRASE — "validation rules", "acceptance
 * profile", "acceptance checks", "custom transformation rules" — which requires the qualifier and
 * the noun to be ADJACENT. Four buyer-facing surfaces name exactly the same product without ever
 * putting those two words together, and every one of them read straight past this row:
 *
 *     /how-it-works    "Validate against your rules" · "Per-supplier rules catch …"
 *     /security        "Validation before delivery"  · "Per-supplier rules block …"
 *     /watch (+layout) "… validated against the supplier's rules, and sent."  ← also the SERP
 *                                                                              meta description
 *     /                "Per-supplier validation" · "Configurable rules per supplier — …"
 *
 * `rules` is there; `validation` is there; they are one to four words apart. So the second half
 * below recognises the rule set by WHOSE it is — per-supplier, configurable, custom, yours, the
 * supplier's — with the noun a word or two away, plus the bare qualifier on "validation" itself.
 *
 * ── Why not simply `/\bvalidat/i`, measured ────────────────────────────────────
 *
 * Over the buyer-facing corpus as it stood on 2026-08-14 — 82 files, 13,337 lines:
 *
 *     /\bvalidat/i                  59 lines · 26 files   almost all unrelated
 *     noun-phrase form only         16 lines ·  7 files   (the pre-widening state)
 *     noun-phrase + possessive      25 lines · 13 files   (this matcher)
 *
 * The bare verb's extra 34 lines are FTPS certificate validation, "No BIS business-rule validation
 * runs", the Parse · Normalize · Validate pipeline labels, "They are not validated against a live
 * ERP sandbox", and the ROI calculator's prose. A matcher that noisy gets narrowed by the next
 * reader until it catches nothing — which is the state this row was already found in once. Every
 * one of the 25 the shipped form matches is a real presentation of the gated surface, and the
 * `must flag` / `must allow` controls below pin both edges of that measurement.
 *
 * ── What is deliberately NOT excluded ──────────────────────────────────────────
 *
 * There is no `!built-in` escape here, even though the honest Growth bullet is about built-in
 * checks. It does not need one — "built-in order checks" names no rule set — and adding one would
 * open the hole a bullet reading "Built-in validation rules" could walk straight through. The
 * words "validation rules" name the Enterprise tab whatever adjective precedes them.
 *
 * Nor is there an escape for a rule set named as the CAUSE of a failure rather than as a feature
 * ("the supplier's own rules turning the order down", /help/exceptions-and-stuck-orders). A reader
 * on Growth meets that sentence and learns their orders can be held by rules they cannot author.
 * That is the same undisclosed capability wearing a different verb, and the file-scoped remedy —
 * one disclosure per page — costs a clause either way.
 */
const CONFIGURABLE_SUPPLIER_RULE_FORMS: ReadonlyArray<{ form: string; re: RegExp }> = [
  {
    // The rule set by its noun phrase: qualifier and noun adjacent. This was the whole matcher.
    form: "noun phrase — 'validation rules', 'acceptance profile', 'acceptance checks'",
    re: /\b(?:validation|acceptance)\s+(?:rule|rules|profile|profiles|check|checks)\b/i,
  },
  {
    // The rule set by WHOSE it is, with the noun up to two words away. `{0,2}` is what buys
    // "Configurable rules per supplier" and "Validate against your rules"; a wider window starts
    // joining two unrelated clauses on the same line.
    form: "qualifier, then 'rules' within two words — 'Configurable rules per supplier'",
    re: /\b(?:custom|customi[sz]ed|customi[sz]able|configurable|per[- ]supplier|supplier[- ]specific|your own|your)\s+(?:[a-z-]+\s+){0,2}rules?\b/i,
  },
  {
    form: "the same thing said the other way round — 'rules you set', 'rules per supplier'",
    re: /\brules?\s+(?:you\s+(?:set|write|author|configure|define)|per\s+supplier|for\s+(?:each|every)\s+supplier)\b/i,
  },
  {
    // `&apos;` and `&#39;` are in the class because JSX text escapes the apostrophe and this scan
    // reads SOURCE lines, not rendered output — /watch wrote `supplier&apos;s rules`.
    form: "the possessive — \"the supplier's rules\", \"a supplier's own rules\"",
    re: /\bsupplier(?:'|’|&apos;|&#39;)s\s+(?:own\s+)?(?:[a-z-]+\s+)?rules?\b/i,
  },
  {
    form: "qualified 'validation' with no noun at all — 'Per-supplier validation'",
    re: /\b(?:per[- ]supplier|supplier[- ]specific|configurable|customi[sz]able)\s+(?:validation|acceptance)\b/i,
  },
];

const SELLS_CONFIGURABLE_SUPPLIER_RULES = (text: string): boolean =>
  CONFIGURABLE_SUPPLIER_RULE_FORMS.some(({ re }) => re.test(text));

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
  customSupplierRules: { label: "per-supplier validation rules", sells: SELLS_CONFIGURABLE_SUPPLIER_RULES },
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

  /**
   * MUST-FLAG CONTROL for `customSupplierRules`, whose matcher was `/custom (transformation|
   * supplier) rule/i` and recognised exactly one string in the product: the Enterprise card's own
   * bullet. A row that can only see the copy already at the right tier polices nothing.
   */
  it("recognises the per-supplier rules surface by the names it actually ships under", () => {
    // The wordings that name the Enterprise-gated configurable rule set. These are not invented:
    // every one is a live line in the product, quoted from the corpus measurement.
    for (const text of [
      "Field mapping + validation rules",                        // the shape the Growth card would take
      "Custom transformation rules",                             // the Enterprise card, as it stands
      "| **Validation rules** | The acceptance checks that actually hold orders.",
      "- the **validation profile** (which acceptance rules check orders),",
      "which validation checks flip between pass and fail",
      "Built-in validation rules",                               // no `!built-in` escape — see the matcher note
    ]) {
      expect(claims(CAPABILITY_CLAIMS.customSupplierRules.sells, text), `must flag: ${text}`).toBe(true);
    }

    // And the BUILT-IN checks, which really are on every plan including Pilot. If these start
    // flagging, the guard has stopped distinguishing the two validation products and the only
    // obvious repair is to narrow it back to `/custom .* rule/i` — the blind version.
    for (const text of [
      "Field mapping + built-in order checks",
      "Built-in order checks",
      "FTPS certificate validation",
      "No BIS business-rule validation runs",
      "Parse · Normalize · Validate · Transform · Deliver",
      "They are not validated against a live ERP sandbox",
    ]) {
      expect(claims(CAPABILITY_CLAIMS.customSupplierRules.sells, text), `must allow: ${text}`).toBe(false);
    }
  });

  /**
   * MUST-FLAG CONTROL for the four surfaces the ADJACENCY requirement hid, quoted from
   * `git show d48907e` — the tree they were found on. Every one of these lines names the
   * Enterprise-gated rule set, none of them puts "validation" next to "rules", and the matcher
   * that shipped before this test read past all four for months.
   *
   * They are pinned here rather than left to the file walk on purpose: the walk can only see a
   * defect that is still in the tree, and these have been fixed. A control quoting the original
   * is what makes narrowing the matcher back out fail loudly instead of quietly.
   */
  it("catches the four undisclosed surfaces the adjacency requirement hid", () => {
    for (const [where, shipped] of [
      ["/how-it-works step 04 title", '    title: "Validate against your rules",'],
      [
        "/how-it-works step 04 body",
        '      "Per-supplier rules catch missing fields, wrong currency, or unresolved codes before anything leaves your system. Bad orders never reach the supplier.",',
      ],
      [
        "/security 'Validation before delivery'",
        '    body: "Per-supplier rules block malformed orders before they ever reach a supplier endpoint — wrong currency, missing fields, unresolved codes.",',
      ],
      [
        "/watch layout — also the SERP meta description",
        '    "See how a single upload becomes a delivered supplier order — parsed, mapped, validated against the supplier\'s rules, and sent.",',
      ],
      [
        "/watch page body (JSX-escaped apostrophe)",
        "        See how a single upload becomes a delivered supplier order — parsed, mapped, validated against the supplier&apos;s rules, and sent.",
      ],
      ["/ landing card title", '    title: "Per-supplier validation",'],
      ["/ landing card body", "        Block bad orders before they reach the supplier. Configurable rules per"],
      [
        "/help/exceptions-and-stuck-orders — the rule set named as a failure CAUSE",
        "- **Couldn't build output** — … a line still missing its supplier item code, the supplier's own rules turning the order down, or something going wrong at our end.",
      ],
    ] as const) {
      expect(
        claims(CAPABILITY_CLAIMS.customSupplierRules.sells, shipped),
        `must flag (${where}): ${shipped.trim().slice(0, 80)}…`,
      ).toBe(true);
    }
  });

  /**
   * ANTI-VACUITY FLOOR for the widening.
   *
   * `SELLS_CONFIGURABLE_SUPPLIER_RULES` is an OR over five named forms, and an OR hides a dead
   * limb perfectly: delete any one and the other four keep every existing assertion green. So each
   * form is required to match a line it was written for and to be the ONLY form that does, which
   * is what makes deleting or narrowing it go red by name rather than by accident.
   *
   * Two of the five (the possessive, and the qualified bare "validation") now have no live line in
   * the corpus, because the copy that carried them was the defect and it was fixed. That is stated
   * rather than papered over: a form whose only evidence is a fixed defect still earns its place —
   * it is what stops the wording coming back — but it can only be pinned by a control, never by
   * the walk.
   */
  it("every recognised form of the rule set is load-bearing, not one of five that overlap", () => {
    const uniquelyMatched: Record<string, string> = {
      "noun phrase — 'validation rules', 'acceptance profile', 'acceptance checks'":
        "Rules are grouped into a versioned acceptance profile.",
      "qualifier, then 'rules' within two words — 'Configurable rules per supplier'":
        "Configurable rules, tuned once and reused.",
      "the same thing said the other way round — 'rules you set', 'rules per supplier'":
        "The checks you set yourself are rules you write, once, and reuse.",
      "the possessive — \"the supplier's rules\", \"a supplier's own rules\"":
        "parsed, mapped, validated against the supplier's rules, and sent",
      "qualified 'validation' with no noun at all — 'Per-supplier validation'":
        "Per-supplier validation, before anything leaves.",
    };

    expect(
      Object.keys(uniquelyMatched).sort(),
      "a form was added or renamed without a control that pins it",
    ).toEqual(CONFIGURABLE_SUPPLIER_RULE_FORMS.map(({ form }) => form).sort());

    for (const { form, re } of CONFIGURABLE_SUPPLIER_RULE_FORMS) {
      const probe = uniquelyMatched[form];
      expect(re.test(probe), `the "${form}" form no longer matches its own probe: ${probe}`).toBe(true);

      const alsoMatched = CONFIGURABLE_SUPPLIER_RULE_FORMS.filter((f) => f.form !== form && f.re.test(probe));
      expect(
        alsoMatched.map((f) => f.form),
        `"${probe}" is meant to isolate the "${form}" form, but other forms match it too — ` +
          "delete that form and this control stays green, which is how a dead limb survives",
      ).toEqual([]);
    }
  });

  /**
   * And the floor under the WALK: the corpus scan for this capability must really be extracting
   * lines. `presenting.length > 3` inside the shared `it.each` is the generic version; this names
   * the files, so narrowing the matcher drops one out and fails here with the file that stopped
   * being seen — rather than sliding under a count that four other files still satisfy.
   */
  it("the per-supplier rules walk still reaches every page that presents the rule set", () => {
    const seen = new Set(
      buyerFacingLines()
        .filter(({ line }) => SELLS_CONFIGURABLE_SUPPLIER_RULES(line))
        .map(({ file }) => file.replace(/\\/g, "/")),
    );

    expect(seen.size, "zero extractions — the walk or the matcher has gone blind").toBeGreaterThan(0);

    for (const file of [
      "/src/app/(marketing)/help/validation-rules/page.mdx",
      "/src/app/(marketing)/help/connections/page.mdx",
      "/src/app/(marketing)/help/managing-suppliers/page.mdx",
      "/src/app/(marketing)/help/ai-suggestions/page.mdx",
      "/src/app/(marketing)/help/exceptions-and-stuck-orders/page.mdx",
      "/src/app/(marketing)/how-it-works/page.tsx",
      "/src/app/(marketing)/security/page.tsx",
      "/src/app/(home)/page.tsx",
      "/src/lib/help-articles.ts",
      "/src/lib/plans.ts",
    ]) {
      expect([...seen], `${file} presents the configurable rule set and the walk no longer sees it`).toContain(file);
    }
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
  // These two were ONE entry — `/^Field mapping \+ validation$/i`, excused by "the field mapper
  // and validation rules are ungated". Half of that reason contradicted the gate table outright:
  // `BillingFeature.CustomSupplierRules` is Enterprise (PlanConstants.cs:287). A stated reason is
  // worth LESS than no allowlist entry when it is wrong, because it reads as considered and stops
  // the next reader looking. Splitting the entry is not cosmetic — an entry may now only carry a
  // reason for one claim, so a wrong half cannot ride along with a right one.
  {
    matches: /^Field mapping$/i,
    why:
      "no BillingFeature gates the field mapper. MapperEnrichmentController, " +
      "MappingSuggestionsController and PoMappingTemplatesController carry no HasFeatureAsync " +
      "call at all; the only gate anywhere near mapping is BULK import/export " +
      "(SuppliersController.cs:472, BillingFeature.BulkMapping, Operations+), which Operations " +
      "sells as its own bullet",
  },
  {
    matches: /^Built-in order checks$/i,
    why:
      "InvariantValidator + OutputFieldValidator run on every plan including Pilot: every " +
      "transform calls OutputFieldValidator.ValidateEntity before writing a byte " +
      "(CsvTransformService.cs:46 and its five siblings), and SupplierAcceptanceService.cs:202-204 " +
      "runs the invariant and output-field passes whether or not a profile exists (EvaluateProfile " +
      "returns empty at :389). The CONFIGURABLE per-supplier rules are the gated product — " +
      "BillingFeature.CustomSupplierRules, Enterprise — and the Enterprise card sells those " +
      "separately as 'Custom transformation rules'",
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

  // An UNGATED_BULLETS entry matching the WHOLE bullet accounts for the whole bullet — but ONLY
  // when the bullet makes a single claim.
  //
  // This condition was not here, and the note in its place argued the whole-bullet escape was safe
  // because the entries are anchored, hand-written, carry a stated reason, and are deleted the
  // moment the bullet stops existing. Every one of those things was true and it was still the
  // hole. `/^Field mapping \+ validation$/i` matched a COMPOUND, so ONE hand-written reason —
  // "the field mapper and validation rules are ungated" — answered for TWO claims, and its second
  // half contradicted the gate table (CustomSupplierRules is Enterprise, PlanConstants.cs:287).
  // The clause split below never ran, so `customSupplierRules` never got to see the word
  // "validation" at all.
  //
  // So the bypass had a second form the earlier note missed. It is not only a CAPABILITY matcher
  // answering for text it had not read; it is ANY single verdict answering for more claims than it
  // read. A multi-clause bullet is now accounted for clause by clause no matter which mechanism
  // would excuse it, which is precisely where the capability matchers get their look.
  const clauses = splitClauses(bullet);
  if (clauses.length === 1) {
    const wholeBullet = UNGATED_BULLETS.find(({ matches }) => matches.test(bullet));
    if (wholeBullet) return { ok: true, because: `ungated: ${wholeBullet.why}` };
  }

  const because: string[] = [];
  const unaccounted: string[] = [];

  for (const clause of clauses) {
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
      "Field mapping + built-in order checks",
      "Email · SFTP · S3 ingestion",
    ]) {
      expect(accountFor(operations, honest).ok, `must allow: ${honest}`).toBe(true);
    }
  });

  /**
   * MUST-FLAG CONTROL for the SECOND form of the compound bypass, quoted exactly as it shipped.
   *
   * `plans.ts:191` read `"Field mapping + validation"` on the €149 Growth card while per-supplier
   * validation rules gate at Enterprise — from €2,500/month — refused on authoring AND on
   * activating (`SupplierAcceptanceController.cs:37-46`, `:70`, `:99`; `PlanConstants.cs:287`).
   *
   * It survived the control directly above because that control only closed the CAPABILITY half of
   * the bypass. This bullet was excused earlier than any capability matcher ran, by an
   * `UNGATED_BULLETS` entry that matched the whole compound and carried one reason for two claims —
   * a reason whose second half ("validation rules are ungated") contradicted the gate table. Both
   * halves are replayed here: the bullet on a COPY of `PLANS`, and the allowlist entry that excused
   * it put back verbatim.
   */
  it("catches the Growth 'Field mapping + validation' bullet that shipped, whole-bullet excuse and all", () => {
    const growth = PLANS.find((p) => p.id === "growth")!;

    // 0. The shipped strings, pinned directly. `/pricing` carries a committed visual baseline, but
    //    its threshold is `maxDiffPixelRatio: 0.002` — a reworded bullet does not move enough
    //    pixels to trip it, so the screenshot gate cannot be what holds this copy in place.
    expect(growth.features, "the honest bullet must be the one that ships").toContain(
      "Field mapping + built-in order checks",
    );
    expect(growth.features, "and the compound must not come back").not.toContain("Field mapping + validation");

    // 1. The bullet, verbatim. "validation" alone names no gated capability, is not a quota, and is
    //    not on the allowlist — so the clause split has to leave it unaccounted.
    const shipped = accountFor(growth, "Field mapping + validation");
    expect(shipped.ok, "the bullet that shipped on the €149 card must be refused").toBe(false);
    expect(
      "problem" in shipped && shipped.problem,
      "and refused for the RIGHT clause — naming the mapping half would mean the split ran backwards",
    ).toMatch(/"validation"/);

    // 2. The backed half on its own is still fine. The fix must not have been "ban the word mapping".
    expect(accountFor(growth, "Field mapping").ok).toBe(true);
    expect(accountFor(growth, "Built-in order checks").ok).toBe(true);

    // 3. The whole-bullet allowlist escape, restored exactly as it was. A single anchored entry
    //    carrying one reason may no longer answer for a two-claim bullet, so this must STILL fail —
    //    otherwise the repair is one deleted line away from undoing itself.
    const asItWas: typeof UNGATED_BULLETS = [
      { matches: /^Field mapping \+ validation$/i, why: "the field mapper and validation rules are ungated" },
    ];
    const excused = asItWas.find(({ matches }) => matches.test("Field mapping + validation"));
    expect(excused, "the old entry really did match the whole bullet").toBeDefined();
    expect(
      splitClauses("Field mapping + validation").length,
      "and the bullet really is a compound, which is what now denies it the whole-bullet escape",
    ).toBe(2);

    // 4. Once the clause names the gated surface outright, the tier scans take over and refuse it
    //    on the Growth card. Accounting for a clause and policing its tier are two different jobs.
    const cheapest = cheapestSeller(withBullet("growth", "Validation rules"), CAPABILITY_CLAIMS.customSupplierRules.sells);
    expect(cheapest?.id, "a Growth bullet naming the gated surface must be seen at all").toBe("growth");
    expect(
      rank(cheapest!.id),
      "and seen as BELOW Enterprise — a matcher that finds it but ranks it fine is decoration",
    ).toBeLessThan(rank(BACKEND_MINIMUM_PLAN.customSupplierRules));
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
 *   • `customSupplierRules` IS covered, by the same predicate the card scans use. Its reach is
 *     documented at that matcher rather than here, because the interesting limit is which
 *     WORDINGS it recognises, not which files it walks — and the wordings were measured.
 *   • It still says nothing about `webhookDelivery`, `emailIngestion` or `advancedAudit` in
 *     prose. Those are separate clusters with their own untiered surfaces still outstanding;
 *     extending this list is the follow-up, and the shape is already here.
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
    /**
     * Per-supplier validation rules. Added because `/help/validation-rules`, `/help/connections`
     * and `/help/managing-suppliers` each taught the Enterprise-gated feature end to end with no
     * tier anywhere on the page — one of them calling the supplier tab "the only place a check is
     * set, and the only place one runs" — and every scan in this file read past all three.
     *
     * `presents` is the same predicate the card scans use, deliberately. The two questions are
     * different ("sold below its gate" vs "presented with no gate named") but the thing being
     * recognised is one thing, and two matchers for one capability drift apart.
     */
    {
      capability: "customSupplierRules" as const,
      label: "per-supplier validation rules",
      presents: (lines: string[], i: number) => SELLS_CONFIGURABLE_SUPPLIER_RULES(lines[i]),
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

/**
 * "Pilot is enough for everything here."
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * That sentence opened the Prereqs of `/help/guides/first-order-end-to-end` — the flagship
 * guide, the one a new signup is pointed at. Step 5 of the same guide then asks the supplier
 * "An endpoint we post to, an SFTP folder, or an email address?" and "CSV, JSON, XML, cXML,
 * UBL/Peppol, or X12 850?", leading with the two answers Pilot cannot save: an HTTP endpoint is
 * `BillingFeature.WebhookDelivery` (Growth) and cXML output is `BillingFeature.Cxml`
 * (Operations). A Pilot workspace reaches **delivered** only over SFTP, FTPS or email, in any
 * format but cXML — which the guide never said.
 *
 * ── Why it is its own guard ─────────────────────────────────────────────────────
 *
 * Every other block here reasons about a capability and the tier beside it. This claim names no
 * capability at all: it makes a blanket statement about what the free tier covers, and it is
 * wrong because of capabilities mentioned ninety lines later. There is nothing for a
 * capability-first scan to compare.
 *
 * It is VOCABULARY-BOUND and says so. It bans the sufficiency claim in the phrasings a writer
 * reaches for; it cannot catch "you will not need to upgrade" or a reassurance spread over two
 * sentences. What it does guarantee is that the sentence which actually shipped, and its nearest
 * neighbours, cannot come back silently.
 */
describe("the free tier is never described as sufficient for a flow it cannot finish", () => {
  const FREE_TIER = PLANS[0].name; // "Pilot" — derived, so renaming the tier moves this with it.

  const SUFFICIENCY = String.raw`(?:is enough|is all you need|covers everything|enough for all|does everything)`;
  const CLAIMS_PILOT_SUFFICES = new RegExp(
    String.raw`\b${FREE_TIER}\b[^.\n]{0,60}?\b${SUFFICIENCY}\b` +
      String.raw`|\b(?:everything|the whole|all of) (?:here|this|of it)[^.\n]{0,40}?\bon ${FREE_TIER}\b`,
    "i",
  );

  it("no buyer-facing line says the free tier suffices", () => {
    const lines = buyerFacingLines();
    expect(lines.length, "the corpus must really be reading copy").toBeGreaterThan(1000);

    const offenders = lines
      .filter(({ line }) => CLAIMS_PILOT_SUFFICES.test(line))
      .map(({ file, number, line }) => `${file}:${number}: ${line.trim()}`);

    expect(
      offenders,
      `these lines tell the reader ${FREE_TIER} covers a flow it cannot finish. It can reach ` +
        "delivered over SFTP, FTPS or email in any format but cXML; an HTTP endpoint needs " +
        `${BACKEND_MINIMUM_PLAN.webhookDelivery} and cXML output needs ${BACKEND_MINIMUM_PLAN.cxml}. ` +
        "Say which paths work instead:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("flags the sentence that shipped, verbatim", () => {
    expect(
      CLAIMS_PILOT_SUFFICES.test("- A ProcuLink workspace you can sign in to. Pilot is enough for everything here."),
      "first-order-end-to-end:12, exactly as it stood at 68ed5f2",
    ).toBe(true);

    // The phrasings a writer reaches for once that one is gone.
    expect(CLAIMS_PILOT_SUFFICES.test("Pilot is all you need to follow this guide.")).toBe(true);
    expect(CLAIMS_PILOT_SUFFICES.test("The free Pilot covers everything in this article.")).toBe(true);
    expect(CLAIMS_PILOT_SUFFICES.test("You can do all of this on Pilot.")).toBe(true);
  });

  it("leaves the honest replacement — and every ordinary mention of Pilot — alone", () => {
    // What shipped in its place: specific about which paths finish on the free tier.
    expect(
      CLAIMS_PILOT_SUFFICES.test(
        "- A ProcuLink workspace you can sign in to. Pilot reaches **delivered** by SFTP, FTPS or email, in any",
      ),
    ).toBe(false);
    expect(CLAIMS_PILOT_SUFFICES.test("Pilot — free for 14 days; 20 orders total during trial; 1 supplier.")).toBe(false);
    expect(CLAIMS_PILOT_SUFFICES.test("Everything before step 5 — upload, review, item codes — is the same on Pilot.")).toBe(false);
    expect(CLAIMS_PILOT_SUFFICES.test("Start Pilot")).toBe(false);
  });
});

/**
 * Conformance to a named document standard — a claim that moved out of marketing and into the
 * product, where every guard above was blind to it.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * FE #91 withdrew "Peppol BIS 3" from the website. Three surfaces kept making it, and the worst of
 * them was not a page at all — it was the DOCUMENT:
 *
 *   1. `UblOrderTransformService.cs:73-74,114-115` wrote `cbc:CustomizationID` =
 *      `urn:fdc:peppol.eu:poacc:trns:order:3` and `cbc:ProfileID` =
 *      `urn:fdc:peppol.eu:poacc:bis:order_only:3` into every emitted UBL order. Those are not
 *      decoration: a receiving access point ROUTES AND VALIDATES on them, so the file itself
 *      declared BIS conformance to the counterparty's software.
 *   2. `UblProfileChecker.cs:18` named the profile "UBL 2.1 Order (Peppol BIS Order-only 3.0)" and
 *      its only two profile checks asserted the same two elements were NON-EMPTY — which the
 *      emitter had just guaranteed. The check could not fail. `api-client.ts` mirrored that name,
 *      and `ConformancePanel.tsx` rendered it under "Matches the standard" with a green badge.
 *   3. `ConformanceModels.cs:93` put `- **Profile:** {ProfileName}` into the downloadable Markdown,
 *      so a customer could forward a file asserting BIS conformance on ProcuLink's behalf.
 *
 * The product already knew: `src/lib/standards/catalog.ts` carries the Peppol BIS row as
 * `transform: "planned"` and says, in capitals, that BIS-conformant output "IS NOT OFFERED AND MUST
 * NOT BE ADVERTISED".
 *
 * ── Why the existing guards could not see it ────────────────────────────────────
 *
 * Both blind spots are the same shape as the ones this file already records:
 *
 *   • `buyerFacingLines()` walks `src/lib/marketing`, `src/app/(marketing)`, `src/app/(home)`,
 *     `src/components/marketing`, `plans.ts` and `help-articles.ts`. `src/components/bridge/` —
 *     the entire product — is not in it, and neither is `src/lib/`. A claim that stops being
 *     marketing copy and becomes a rendered profile name walks straight out of the corpus.
 *   • `STANDARD_NAME_TOKENS` (format-catalog.ts) does catch "Peppol BIS", but `standardRow()` only
 *     ever applies it to rows in that one file.
 *
 * So the corpus here is the whole of `src/`, and the offence is the claim rather than a tier.
 *
 * ── What this guard cannot do, stated rather than assumed ───────────────────────
 *
 * It is LINE-SCOPED, like the two blocks above: a claim split across two lines is invisible to it,
 * and `catalog.ts` writes `conformance:` on one line with its string on the next. It cannot read
 * the BACKEND at all — the emitted document and the real `ProfileName` live in a separate
 * checkout that is not present on CI — so the emitted-constant half is guarded there, by
 * `ProcuLink.Transform.Tests/Output/UblOrderDeclaresNoPeppolProfileTests.cs`. What it does cover
 * on this side is every string this app itself renders, and the mirror of the backend's profile
 * names in `api-client.ts`.
 */
describe("no surface claims conformance to a standard ProcuLink does not emit", () => {
  // The corpus is the module-scoped `productLines()` above — the whole of `src/`, memoised, and
  // now shared with the outbound-format scan at the end of this file.

  /**
   * The two Peppol BIS Order identifiers, verbatim as the backend emitted them.
   *
   * Unconditional: there is no honest reason for this app to carry the URN a receiving access point
   * validates on. Naming the standard in prose is a different question, handled below.
   */
  const PEPPOL_ORDER_URN = /urn:fdc:peppol\.eu:poacc:(?:bis:order_only|trns:order):3/i;

  /** Standards the catalog says ProcuLink really EMITS. Anything else may not be claimed as output. */
  const emittedStandards = new Set(STANDARDS.filter((s) => s.transform === "supported").map((s) => s.id));

  /**
   * Words that turn naming a standard into asserting we meet it. "Conformance" is included as a
   * noun because "Peppol BIS conformance" is the claim written without a verb.
   */
  const CONFORMANCE_WORD =
    /\b(?:conformant|conforming|conforms|conformance|compliant|complies|compliance|certified|certification|validated|validates|verified against|checked against)\b/i;

  /**
   * A denial is not a claim, and this repo's honest copy is written almost entirely as denials —
   * "is not offered", "does not check", "we have not run that test". A guard without this arm would
   * flag the very sentences that fixed the problem, and the obvious repair would be to delete them.
   */
  const NEGATED = /\b(?:not|no|never|cannot|can't|without|isn't|aren't|doesn't|don't|rather than|instead of)\b/i;

  /** Which catalog standard, if any, this line names. Reuses the registry, so it cannot drift from it. */
  const standardsNamed = (line: string): string[] =>
    STANDARD_NAME_TOKENS.filter(({ token }) => token.test(line)).map(({ catalogId }) => catalogId);

  /**
   * Does this line assert that ProcuLink's output conforms to a standard it does not emit?
   *
   * Derived, not typed: the verdict comes from `STANDARDS[].transform`, so the day a transformer
   * ships and the catalog says `supported`, the claim becomes sayable without editing this file.
   */
  const offends = (line: string): boolean => {
    if (PEPPOL_ORDER_URN.test(line)) return true;
    if (!CONFORMANCE_WORD.test(line) || NEGATED.test(line)) return false;
    return standardsNamed(line).some((id) => !emittedStandards.has(id));
  };

  it("scans the whole app, in-app components included", () => {
    // The anti-vacuity floor, and it names the exact directory whose absence was the defect. A
    // corpus that reverted to the marketing tree would pass every assertion below while blind.
    const lines = productLines();
    expect(lines.length, "the corpus must really be reading source").toBeGreaterThan(5000);
    for (const dir of ["/src/components/bridge/", "/src/lib/standards/", "/src/app/(marketing)/"]) {
      expect(
        lines.filter(({ file }) => file.replace(/\\/g, "/").includes(dir)).length,
        `${dir} must be inside the corpus — the claim this guard exists for lived in the product, ` +
          "not on the marketing site",
      ).toBeGreaterThan(0);
    }
    // And the registries it derives from must be populated, or every verdict is vacuously "fine".
    expect(STANDARD_NAME_TOKENS.length).toBeGreaterThan(0);
    expect(emittedStandards.size).toBeGreaterThan(0);
    expect(emittedStandards.has("peppol-bis-order-3"), "the Peppol BIS row is transform: 'planned'").toBe(false);
    expect(emittedStandards.has("ubl-2-1-order"), "UBL 2.1 really is emitted, and must stay sayable").toBe(true);
    // Reading the whole source tree takes seconds on a machine running other suites in parallel.
    // The 5s default turns that into a red build that says nothing about the claim being guarded.
  }, 30_000);

  it("no line anywhere in the app claims conformance to a standard the catalog says we do not emit", () => {
    const offenders = productLines()
      .filter(({ line }) => offends(line))
      .map(({ file, number, line }) => `${file}:${number}: ${line.trim()}`);

    expect(
      offenders,
      "these lines assert conformance to a standard whose `transform` level in " +
        "src/lib/standards/catalog.ts is not `supported`, or carry a Peppol BIS Order identifier " +
        "outright. Say what ProcuLink actually emits, or say plainly that the profile is not " +
        "offered:\n" + offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("every conformance profile name cites only a standard ProcuLink emits", () => {
    // `CONFORMANCE_PROFILES` is this app's mirror of the backend's ConformanceCheckBuilder names,
    // and a profile NAME is the most load-bearing standards claim in the product: it renders under
    // "Matches the standard" with a pass badge and goes into the downloadable report verbatim.
    const entries = Object.entries(CONFORMANCE_PROFILES);
    expect(entries.length, "anti-vacuity: there must be profiles to check").toBeGreaterThan(0);

    for (const [format, { name }] of entries) {
      expect(name, `the ${format} profile has no name`).not.toBe("");
      for (const id of standardsNamed(name)) {
        expect(
          emittedStandards.has(id),
          `the ${format} conformance profile is named "${name}", which cites the '${id}' standard — ` +
            `but src/lib/standards/catalog.ts records its \`transform\` level as ` +
            `'${STANDARDS.find((s) => s.id === id)?.transform}'. A profile name is what the panel ` +
            `prints beside a green "Matches the standard" badge and what the downloadable report ` +
            `puts on its Profile line, so it may only name a standard we really emit.`,
        ).toBe(true);
      }
    }
  });

  it("flags the claims that shipped, verbatim, so a green result means absence and not blindness", () => {
    // 1. The emitted-document constants — the backend line that put the URN into every order.
    expect(
      offends('            new XElement(Cbc + "ProfileID",           PeppolBisProfileId),'),
      "a bare reference is not the identifier itself",
    ).toBe(false);
    expect(
      offends('    private const string PeppolBisProfileId       = "urn:fdc:peppol.eu:poacc:bis:order_only:3";'),
      "the identifier a receiving access point validates on",
    ).toBe(true);
    expect(offends("urn:fdc:peppol.eu:poacc:trns:order:3")).toBe(true);

    // 2. The profile name, exactly as `api-client.ts:3000` carried it.
    expect(
      standardsNamed('ubl:  { profile: "Ubl21Order", name: "UBL 2.1 Order (Peppol BIS Order-only 3.0)", version: "2.1" },'),
      "the name cites BOTH standards; the Peppol one is the offence",
    ).toContain("peppol-bis-order-3");

    // 3. Affirmative prose, in the shapes a writer reaches for.
    expect(offends("ProcuLink emits Peppol BIS Order 3.0 conformant documents."), "conformant").toBe(true);
    expect(offends("Output is validated against Peppol BIS business rules."), "validated against").toBe(true);
    expect(offends("Peppol BIS 3 certified output for your access point."), "certified").toBe(true);
    expect(offends("EDIFACT ORDERS compliance out of the box."), "another planned standard, same rule").toBe(true);
  });

  it("leaves the honest copy alone — including the sentences that fixed this", () => {
    // Every one of these ships today. If the guard ever starts flagging them, the obvious repair is
    // to delete the disclosure, which would put the product back where it started.
    for (const honest of [
      "| Peppol BIS Order 3.0 | Not offered — a BIS Order file parses inbound (it is UBL 2.1), but ProcuLink does not produce BIS-conformant output and does not check output against BIS business rules |",
      "| UBL 2.1 Order | Supported. **Peppol BIS Order 3.0 output is not offered** — ProcuLink emits the OASIS UBL 2.1 Order document and does not check it against Peppol BIS business rules. |",
      "ProcuLink is not a Peppol conformance tool.",
      "It does not certify Peppol BIS Order 3 conformance — and we would rather tell you here than have you find out at an access point.",
      '  { id: "ubl", label: "UBL 2.1", blurb: "The OASIS UBL 2.1 Order document, common in EU e-procurement. Not checked against Peppol BIS business rules." },',
    ]) {
      expect(offends(honest), `must allow: ${honest.slice(0, 60)}…`).toBe(false);
    }

    // A standard we really do emit may be claimed in full — under-claiming gives away real value.
    expect(offends("Every order is validated against the cXML 1.2 OrderRequest profile."), "cXML is supported").toBe(
      false,
    );
    expect(offends("X12 850 conformance checks run on every transform."), "X12 850 is supported").toBe(false);
    // Naming Peppol without a conformance word is not a claim: the Peppol NETWORK is a real
    // transport reached through an access-point partner, and the element paths really are shared.
    expect(offends("Because Peppol BIS Order 3 constrains UBL rather than replacing it, those element paths are the Peppol paths too.")).toBe(
      false,
    );
    expect(offends("Delivery into the Peppol network runs through a certified access-point partner.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A standard offered as an OUTPUT format while nothing can produce it.
//
// ── The defect ──────────────────────────────────────────────────────────────────
//
// The v2 audit's Wave E asked for "a real outbound EDIFACT transformer or the claim's removal".
// The founder chose removal, the way the Peppol BIS conformance claim was withdrawn the week
// before. What was being removed:
//
//   1. `/formats` renders `OUTPUT_FORMATS` under the heading "Get data out — formats we produce",
//      subtitle "What we transform each order into. Set per supplier." The last row read:
//
//          standardRow("edifact-orders", "transform", "EDIFACT ORDERS", "Outbound EDIFACT transformer on request.")
//
//      Deriving the badge was not enough to make it honest. `transform: "planned"` maps through
//      TRANSFORM_LEVEL_STATUS to `onRequest`, and the legend at the top of that page renders
//      `onRequest` as "Not built yet, but straightforward — we'll add it for your rollout." On a
//      page whose intro says "Don't see yours? It's very likely Configurable or On request — just
//      ask", that is not a hedge. It is a quotation for work nobody has scoped.
//   2. `/library/standards` — the in-app matrix `/help/output-templates` calls "the always-current
//      version of this table" — listed EDIFACT in a "Not sure which format to use?" chooser that
//      ends "Ask your supplier which they accept". UBL in the same list carried its Peppol caveat;
//      EDIFACT carried none.
//   3. The output designer told an author, in as many words, `ProcuLink builds EDIFACT itself` and
//      `This order will be built by ProcuLink's own EDIFACT builder instead`, and offered
//      `Set up EDIFACT properly` — deep-linking to a Delivery tab whose picker has no EDIFACT option.
//
// None of it is true. `ProcuLink.Api/Program.cs:726-731` registers six `ITransformService`
// implementations — Xml, Csv, Cxml, Json, UblOrder, X12 — no class implements one for EDIFACT, and
// no `CanTransform` arm answers `OutputFormat.EdifactOrders`. An order reaching transform in that
// format dies with `No transform service registered for format 'EdifactOrders'.` and is parked in
// terminal `transform_failed`.
//
// ── What is NOT the defect, and must not become one ─────────────────────────────
//
// INBOUND EDIFACT ORDERS is real, ungated, and was fixed in BE #163: `EdifactOrderParser` is
// registered unconditionally at `Program.cs:719`, accepts `.edi` and `.txt`, and reads D96A with
// D01B tolerance. Deleting inbound claims to "be safe" would be the same error pointed the other
// way — under-claiming a shipped capability — which is why the controls below pin the honest
// inbound sentences as things this guard must LEAVE ALONE.
//
// ── How this differs from the conformance guard above ───────────────────────────
//
// That one asks "does this line claim we MEET a standard". This one asks "does this line offer a
// standard as something we PRODUCE". Different verb families, and the second shipped for months
// under the first: "Outbound EDIFACT transformer on request" contains no conformance word at all,
// so `offends()` read straight past it.
//
// ── What the line scan cannot do, stated rather than assumed ────────────────────
//
// It is line-scoped and it excuses a negated line, so a sentence that denies one thing while
// claiming another slips through — `"{X} can't be built from a layout … so ProcuLink builds {X}
// itself"` is exactly that shape, and it is written as a template literal whose `${label}` is not
// the word EDIFACT. Neither half is catchable by scanning text. So the surfaces where that shape
// lives are pinned BEHAVIOURALLY, by calling the function that composes the sentence, and the
// standards matrix is pinned by its mechanism. The scan, the mechanism pin and the behavioural pin
// are three different instruments; none of them is the whole guard.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("no surface offers a standard as an output format while nothing can produce it", () => {
  /**
   * Standards ProcuLink really emits, derived from the catalog rather than typed.
   *
   * `transform === "supported"` is the bar, and `!== "none"` is not. That distinction is the hole
   * the EDIFACT row went through: `"planned"` is neither "we do this" nor "we do not", and on a
   * table headed "formats we produce" it was read as the former.
   *
   * The catalog is in turn diffed against the real C# registrations by
   * `src/test/backendMirror.test.ts`, so nothing in this chain is a hand-typed list of six
   * transformer names — which is precisely how this drift would return when a seventh is added.
   */
  const emitted = new Set(STANDARDS.filter((s) => s.transform === "supported").map((s) => s.id));

  /**
   * Verbs and nouns that turn NAMING a standard into offering it as output.
   *
   * "transformer" is here as a noun because "Outbound EDIFACT transformer on request" is the claim
   * written without a verb — the same reason "conformance" is in the guard above. "reads",
   * "parses" and "ingests" are deliberately absent: that is the inbound half, which is true.
   *
   * A BARE "send" is deliberately absent too, and that is not an oversight — it is the one word
   * here that does not carry a direction. `/help/edifact-orders` opens "Use this when a trading
   * partner sends purchase orders as EDIFACT ORDERS files", which is the inbound case described
   * perfectly, and the first version of this pattern flagged it. No amount of tuning tells "they
   * send us EDIFACT" from "we send EDIFACT" by the verb alone, so only the form with an explicit
   * supplier object counts — the shape someone would actually write when re-introducing the claim.
   */
  const OFFERS_AS_OUTPUT =
    /\b(?:outbound|output|outputs|emit|emits|emitted|produce|produces|produced|generate|generates|generated|generation|transform|transforms|transformed|transformer|builds?|built|writes?)\b|\bsends?\b[^\n]{0,40}\bsupplier/i;

  /**
   * A denial is not an offer, and this repo's honest EDIFACT copy is written almost entirely as
   * denials — "no outbound transformer", "is not offered", "read, not emitted". Without this arm
   * the guard would flag the very sentences that fixed the problem, and the obvious repair would be
   * to delete them. The cost is stated in the header: a line that denies and claims at once
   * escapes, which is why this is not the only instrument here.
   */
  const NEGATED =
    /\b(?:not|no|never|cannot|can't|without|isn't|aren't|doesn't|don't|rather than|instead of)\b/i;

  /**
   * A line that is an IDENTIFIER LIST, not a sentence.
   *
   * `help-articles.ts` carries `keywords: [… "output format", … "edifact" …]` for the help search,
   * and `section-guides.ts` carries `articleSlugs: [… "edifact-orders" …]`. Both put a standard's
   * name next to the word "output" on one line, and neither is a claim — nobody reads a slug.
   *
   * Narrow on purpose: it matches only where the identifier list STARTS the line, so ordinary
   * prose in those same two files is still scanned (asserted below). Widening it to "any line
   * containing a quoted slug" would exempt most of the corpus.
   */
  const IDENTIFIER_LIST = /^\s*(?:keywords|articleSlugs|slug|catalogId|id|href|referenceUrl|url):/;

  /** Which catalog standard a line names. Reuses the registry, so it cannot drift from it. */
  const standardsNamed = (line: string): string[] =>
    STANDARD_NAME_TOKENS.filter(({ token }) => token.test(line)).map(({ catalogId }) => catalogId);

  const offers = (line: string): boolean => {
    if (IDENTIFIER_LIST.test(line)) return false;
    if (!OFFERS_AS_OUTPUT.test(line) || NEGATED.test(line)) return false;
    return standardsNamed(line).some((id) => !emitted.has(id));
  };

  it("scans a real corpus, and the registries it judges by are populated", () => {
    // The anti-vacuity floor. Every silent-green shape this file has met was a scan that ran over
    // nothing, or a derived verdict taken from an empty registry.
    const lines = productLines();
    expect(lines.length, "the corpus must really be reading source").toBeGreaterThan(5000);
    for (const dir of [
      "/src/app/(marketing)/", // /formats and the help tree
      "/src/app/(home)/", // `(home)` IS `/` and is a SIBLING of `(marketing)`, not a child
      "/src/app/(app)/", // the in-app standards matrix
      "/src/components/bridge/", // the output designer
      "/src/lib/", // the content registries, which render outside any route walk
    ]) {
      expect(
        lines.filter(({ file }) => file.replace(/\\/g, "/").includes(dir)).length,
        `${dir} must be inside the corpus — this claim lived in four of these five at once`,
      ).toBeGreaterThan(0);
    }

    expect(STANDARD_NAME_TOKENS.length).toBeGreaterThan(0);
    expect(emitted.size, "no emitted standards means every line is vacuously an offence").toBeGreaterThan(0);
    expect(emitted.has("edifact-orders"), "the catalog records EDIFACT as transform: 'planned'").toBe(false);
    expect(emitted.has("ubl-2-1-order"), "UBL really is emitted, and must stay sayable").toBe(true);
  }, 30_000);

  it("no line anywhere offers a standard the catalog says we cannot produce", () => {
    const offenders = productLines()
      .filter(({ line }) => offers(line))
      .map(({ file, number, line }) => `${file}:${number}: ${line.trim()}`);

    expect(
      offenders,
      "these lines offer a standard as an output/outbound format, but its `transform` level in " +
        "src/lib/standards/catalog.ts is not `supported` — nothing can produce that document. Say " +
        "what ProcuLink actually emits, or say plainly that the format is read and not emitted:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("flags the claims that shipped, verbatim, so a green result means absence and not blindness", () => {
    // The /formats row, exactly as it stood before this change. A pattern that misses its own
    // origin defect is decoration.
    expect(
      offers('  standardRow("edifact-orders", "transform", "EDIFACT ORDERS", "Outbound EDIFACT transformer on request."),'),
      "the row this whole block exists to prevent",
    ).toBe(true);
    // And with the note emptied, so the guard does not depend on one turn of phrase: the
    // `"transform"` direction argument beside the standard's name is itself the offer.
    expect(offers('  standardRow("edifact-orders", "transform", "EDIFACT ORDERS", ""),')).toBe(true);

    // The shapes a writer reaches for when re-introducing it in prose.
    expect(offers("We generate EDIFACT ORDERS for suppliers who need it.")).toBe(true);
    expect(offers("Outbound EDIFACT is available on request — talk to us about your rollout.")).toBe(true);
    expect(offers("ProcuLink emits EDIFACT D96A purchase orders.")).toBe(true);
    expect(offers("Output formats: cXML, UBL, X12, EDIFACT.")).toBe(true);
    // The same rule applied to the other two standards the catalog says we cannot emit, so this
    // block is about the RULE and not about one word. SAP IDoc parses beautifully and is emitted
    // by nothing; Peppol BIS is the claim withdrawn the week before.
    expect(offers("We generate SAP IDoc ORDERS05 back into your ERP."), "IDoc is transform: 'none'").toBe(true);
    expect(offers("Peppol BIS output is produced per supplier."), "transform: 'planned'").toBe(true);
    // "send" only counts with a supplier object, so the form that DOES carry a direction must
    // still be caught — otherwise dropping the bare verb quietly removed a whole shape.
    expect(offers("We send EDIFACT ORDERS straight to your supplier."), "send + supplier").toBe(true);
  });

  it("states, as an assertion, the one shape it knowingly cannot see", () => {
    // Dropping the bare "send" bought a real false negative, and a limitation recorded only in a
    // comment is a limitation nobody re-reads. This pins it: "we send X" with an object that is
    // not a supplier escapes. It is asserted rather than fixed because every fix considered —
    // first-person subject detection, a wider object list — cost more honest inbound sentences
    // than it caught claims, `/help/edifact-orders:15` first among them.
    //
    // If someone later widens OFFERS_AS_OUTPUT and this test goes red, that is the guard getting
    // BETTER. Delete this test then, and say so in the message.
    expect(
      offers("We can send SAP IDoc ORDERS05 back to your ERP."),
      "known gap: 'send' with a non-supplier object reads the same as a partner sending to us",
    ).toBe(false);
    // The compensating cover: the same claim written any other way is still caught, so the gap is
    // one phrasing rather than one capability.
    expect(offers("We produce SAP IDoc ORDERS05 for your ERP.")).toBe(true);
    expect(offers("Outbound SAP IDoc ORDERS05 is available.")).toBe(true);
  });

  it("exempts identifier lists without exempting the files they live in", () => {
    // The exemption is the sort of thing that quietly grows until it covers the corpus, so both
    // halves are pinned: the two real lines it was added for, and prose in those same two files.
    expect(
      offers('  keywords: ["templates", "output format", "csv", "xml", "cxml", "ubl", "x12", "json", "peppol", "edifact", "scriban"],'),
      "a help-search keyword array is not a sentence",
    ).toBe(false);
    expect(
      offers('  articleSlugs: ["output-templates", "ubl-and-peppol", "x12-850", "edifact-orders", "sap-idoc-orders05", "cxml-setup"],'),
      "a list of route slugs is not a sentence",
    ).toBe(false);

    // …but a real claim written in those files, or a slug list with prose appended, is still seen.
    expect(
      offers('  blurb: "ProcuLink produces EDIFACT ORDERS for your suppliers.",'),
      "prose in help-articles.ts is still scanned",
    ).toBe(true);
    expect(
      offers('  title: "Outbound EDIFACT ORDERS",'),
      "a title is copy, and `title:` is not on the exemption list",
    ).toBe(true);
  });

  it("leaves the honest copy alone — the inbound claims, and the sentences that fixed this", () => {
    // Every one of these ships today. If the guard starts flagging them the obvious repair is to
    // delete the disclosure or the inbound capability, and either is a worse product than the one
    // that had the bug.
    for (const honest of [
      // The denials.
      "- **EDIFACT is inbound only.** ProcuLink reads EDIFACT `ORDERS` messages at directories D96A and D01B, but",
      "  it does not generate them. There is no outbound EDIFACT transformer today.",
      "| EDIFACT ORDERS | Not yet — parsing exists, no outbound transformer |",
      "Outbound EDIFACT generation is not offered today; when a partner needs an EDIFACT order sent, that path is still in development.",
      "Read, not emitted: ProcuLink parses EDIFACT ORDERS but does not generate them, so it is not a format you can send a supplier.",
      // The inbound capability, stated plainly. None of this may become collateral damage.
      "ProcuLink reads **inbound EDIFACT ORDERS** messages at directories `D96A` and `D01B` and maps them into the canonical order for review.",
      "CSV, XLSX, PDF, XML (cXML/UBL/Peppol), EDI (EDIFACT/X12)",
      "Upload a CSV, Excel, PDF, XML, EDIFACT, or X12 file",
      // The field-path reference, which is true with or without a transformer.
      "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode.",
      "Each rule shows the standards references for its field (UBL, EDIFACT, X12, cXML), so you can point at the exact element when a supplier asks which one you mean.",
    ]) {
      expect(offers(honest), `must allow: ${honest.slice(0, 70)}…`).toBe(false);
    }

    // A standard we really DO emit may be offered in full — under-claiming gives away real value,
    // and is the failure mode a guard like this invites.
    expect(offers("ProcuLink produces the OASIS UBL 2.1 Order document."), "UBL is supported").toBe(false);
    expect(offers("Output formats: CSV, XML, cXML, UBL 2.1 Order, ANSI X12 850, JSON."), "all supported").toBe(false);
  });

  /**
   * The /formats output table, pinned structurally.
   *
   * `format-catalog.test.ts` already asked whether an OUTPUT_FORMATS row cites a standard whose
   * `transform` is `"none"`. That test was green throughout, because EDIFACT's level is
   * `"planned"` — the hole was the BAR, not the absence of a test. This asserts the tightened bar,
   * and the duplication is on purpose: those are the marketing catalog's own tests and this is the
   * cross-cutting claim guard, and this row is where the two met.
   */
  it("the /formats 'formats we produce' table lists only standards we produce", () => {
    const cited = OUTPUT_FORMATS.filter((r) => r.catalogId);
    expect(cited.length, "anti-vacuity: the table must really derive rows from the catalog").toBeGreaterThan(2);

    const offenders = cited
      .filter((r) => !emitted.has(r.catalogId!))
      .map((r) => `${r.name} (${r.catalogId}) — badge "${r.status}"`);

    expect(
      offenders,
      'these rows sit under "Get data out — formats we produce" for a standard the catalog says we ' +
        'cannot emit. An "On request" badge does not soften that: /formats renders it as "we\'ll ' +
        'add it for your rollout":\n' + offenders.join("\n"),
    ).toEqual([]);
  });

  /**
   * The in-app standards matrix, pinned by MECHANISM rather than by wording.
   *
   * A cross-format field table is honest reference material with no transformer behind it — "this
   * field is called BGM 1004 in EDIFACT" is true either way — so the fix there was a direction
   * marker, not a deletion. What has to hold is that the marker is DERIVED: the page splits its
   * columns on `STANDARDS[].transform` and renders the read-only ones. A hand-typed caveat would
   * rot the day a transformer ships, and this screen is the one `/help/output-templates` sends
   * readers to as "the always-current version" of the output-support table.
   *
   * Wording checks are the wrong instrument here: the sentence is assembled from
   * `asList(READ_ONLY_LABELS)` at render time and contains no standard's name in the source at
   * all. So this reads the source for the mechanism, and checks the column ids it feeds on.
   *
   * The same page had the COMMERCIAL half of this defect — it derived "ProcuLink produces cXML
   * 1.2, UBL 2.1 and X12" from `transform === "supported"` and named no tier, while cXML output
   * is gated at Operations. No guard in THIS file could have caught it at any corpus width: the
   * scans below match literal text in one source line, and that sentence has no format name in
   * the source. The fix is pinned by rendering the screen, in
   * `src/app/(app)/library/standards/planDisclosure.test.tsx`.
   */
  it("the standards matrix derives its direction marker from the catalog", () => {
    // The column table moved out of the page into a sibling module so a test could read it —
    // a Next.js page may not carry arbitrary named exports. The split is COMPUTED in
    // `refColumns.ts` and RENDERED by `page.tsx`, so each half is checked where it lives.
    const rel = "src/app/(app)/library/standards/page.tsx";
    const columnsRel = "src/app/(app)/library/standards/refColumns.ts";
    const source = readFileSync(join(process.cwd(), rel), "utf8");
    const columns = readFileSync(join(process.cwd(), columnsRel), "utf8");

    expect(columns, `${columnsRel} must read the catalog to decide direction`).toMatch(
      /import\s*\{[^}]*\bSTANDARDS\b[^}]*\}\s*from\s*"@\/lib\/standards\/catalog"/,
    );
    expect(columns, "it must split its columns on the emitted/read-only line").toMatch(
      /READ_ONLY_COLUMNS/,
    );
    expect(source, "and the page must render that split, not merely compute it").toMatch(
      /READ_ONLY_LABELS\.length\s*>\s*0/,
    );

    // Every column the matrix shows must cite a catalog id that exists, or the split silently
    // classifies a column on a lookup that returned undefined.
    const cited = [...columns.matchAll(/catalogId:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(cited.length, "the columns must really carry catalog ids").toBeGreaterThanOrEqual(5);
    for (const id of cited) {
      expect(
        STANDARDS.some((s) => s.id === id),
        `${columnsRel} maps a column to '${id}', which is not a standard in src/lib/standards/catalog.ts. ` +
          "An unresolved id makes the emitted/read-only split answer on a missing row.",
      ).toBe(true);
    }
    expect(cited, "EDIFACT is the column this pin exists for").toContain("edifact-orders");
  });

  /**
   * The output designer, pinned BEHAVIOURALLY.
   *
   * `collectLayoutProblems` composes its sentence from a template literal, so the source line
   * carries no standard's name and the scan above cannot see it. Worse, the shipped sentence
   * opened "EDIFACT can't be built from a layout" — a negation — so even the rendered string would
   * have been excused. Calling the function is the only way to ask the real question.
   *
   * Both directions are asserted. Removing the reassurance from cXML would be its own defect:
   * there the layout really is redundant and the order really does go out.
   */
  it("the designer promises a builder only for formats a transform can produce", () => {
    const layout = (format: string): OutputNodeTemplate =>
      ({ format, root: { name: "Order", nodeType: "object", children: [] } }) as unknown as OutputNodeTemplate;

    const messageFor = (format: string): string => {
      const problem = collectLayoutProblems(layout(format)).find((p) => p.kind === "format-not-renderable");
      expect(problem, `${format} must still raise the not-renderable problem at all`).toBeDefined();
      return problem!.message;
    };

    // The formats with a real transform keep the reassurance — it is true and it is useful.
    for (const format of ["cXml", "ubl", "x12"]) {
      expect(isEmittedFormat(format), `${format} has a registered transform`).toBe(true);
      expect(messageFor(format), `${format} really is built by its own transform`).toMatch(/ProcuLink builds/i);
    }

    // EDIFACT does not, and the sentence must not say otherwise.
    expect(isEmittedFormat("edifactorders"), "no EDIFACT ITransformService is registered").toBe(false);
    const edifact = messageFor("edifactorders");
    expect(
      edifact,
      "this told the author the order was in hand — 'ProcuLink builds EDIFACT itself' — while " +
        "nothing can produce the document and the order dies at transform",
    ).not.toMatch(/ProcuLink builds/i);
    expect(edifact, "and it has to say what really happens instead").toMatch(/no transform that produces/i);
    expect(edifact).toMatch(/fails at transform/i);
  });

  it("the emitted-format set is derived, so a seventh transform does not need this file edited", () => {
    // `isEmittedFormat` reads PREVIEW_FORMATS — this app's mirror of the registered
    // ITransformService implementations — plus the two backend enum SPELLINGS of formats already
    // in it. If it ever answers false for something PREVIEW_FORMATS offers, the designer starts
    // telling authors that a working format cannot be produced.
    expect(PREVIEW_FORMATS.length, "anti-vacuity: the mirror must be populated").toBeGreaterThan(0);
    for (const { value } of PREVIEW_FORMATS) {
      expect(isEmittedFormat(value), `PREVIEW_FORMATS offers ${value}, so it must count as emitted`).toBe(true);
    }
    // The aliases, and the one enum member that is not an alias for anything.
    expect(isEmittedFormat("ublorder"), "OutputFormat.UblOrder is the UBL transform").toBe(true);
    expect(isEmittedFormat("x12_850"), "OutputFormat.X12_850 is the X12 transform").toBe(true);
    expect(isEmittedFormat("edifactorders"), "OutputFormat.EdifactOrders has no transform behind it").toBe(false);
    expect(isEmittedFormat(null)).toBe(false);
  });
});
