import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { IMPORT_METHODS } from "@/lib/marketing/format-catalog";
import { PLANS } from "@/lib/plans";

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
// a row cannot be declared without a real enforcement site). This is a hand-kept mirror because the
// frontend cannot import C#. That is exactly why it is small, in one place, and asserted: drift has
// to break a test rather than sit in prose. If you change a minimum plan in PlanConstants.cs, this
// table is the other half of the change.
const BACKEND_MINIMUM_PLAN = {
  webhookDelivery: "growth",
  emailIngestion: "growth",
  sftpIngestion: "growth",
  s3Ingestion: "growth",
  bulkMapping: "operations",
  cxml: "operations",
  advancedAudit: "operations",
  erpConnectors: "enterprise",
  customSupplierRules: "enterprise",
  sso: "enterprise",
} as const;

const PLAN_NAMES = [
  "pilot",
  "growth",
  "operations",
  "integration",
  "distributor",
  "enterprise",
] as const;

/** The four channels WP-11 moved down to Growth — the ones that were mis-advertised. */
const CHANNEL_CLAIM_PATTERNS: ReadonlyArray<{
  label: string;
  matches: RegExp;
  minimumPlan: string;
}> = [
  { label: "IMAP / email inbox polling", matches: /imap|email inbox/i, minimumPlan: BACKEND_MINIMUM_PLAN.emailIngestion },
  { label: "SFTP pull", matches: /sftp/i, minimumPlan: BACKEND_MINIMUM_PLAN.sftpIngestion },
  { label: "S3 / R2 pull", matches: /s3|r2 bucket/i, minimumPlan: BACKEND_MINIMUM_PLAN.s3Ingestion },
];

describe("advertised tier matches the enforced tier", () => {
  it.each(CHANNEL_CLAIM_PATTERNS)(
    "$label: the /formats catalog names no plan dearer than its real minimum",
    ({ matches, minimumPlan }) => {
      const rows = IMPORT_METHODS.filter((m) => matches.test(m.name));
      expect(rows.length).toBeGreaterThan(0); // the row must exist, or this test is vacuous

      for (const row of rows) {
        const named = PLAN_NAMES.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(row.note ?? ""));
        // Naming no plan at all is fine — vagueness is not a false claim. Naming the WRONG one is.
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
    const paidTiers = PLANS.filter((p) => p.id !== "pilot" && p.id !== "enterprise");
    expect(paidTiers.length).toBeGreaterThan(0);

    for (const plan of paidTiers) {
      const blob = [...plan.features, plan.billingSummary ?? ""].join(" ").toLowerCase();
      expect(
        /channel|webhook|sftp|s3|email/.test(blob),
        `the ${plan.id} card never mentions delivery or ingestion channels, yet the backend grants ` +
          `all four from Growth up. Silence here reads as "not included" on the tier comparison.`,
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
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|mdx)$/.test(entry)) out.push(full);
    }
    return out;
  };

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
    const files = [
      ...walk(join(process.cwd(), "src/lib/marketing")),
      ...walk(join(process.cwd(), "src/app/(marketing)")),
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
