import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFORMANCE_PROFILES } from "@/lib/api-client";
import { IMPORT_METHODS, STANDARD_NAME_TOKENS } from "@/lib/marketing/format-catalog";
import { PLANS, type Plan } from "@/lib/plans";
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

  const gated = Object.entries(CAPABILITY_CLAIMS).find(([, { sells }]) => claims(sells, bullet));
  if (gated) return { ok: true, because: `BillingFeature.${gated[0]} (its tier is policed above)` };

  const ungated = UNGATED_BULLETS.find(({ matches }) => matches.test(bullet));
  if (ungated) return { ok: true, because: `ungated: ${ungated.why}` };

  return {
    ok: false,
    problem:
      `the ${plan.id} card sells "${bullet}", and nothing accounts for it: no BillingFeature ` +
      `matcher recognises it, it is not one of the plan's own quotas, and it is not on ` +
      `UNGATED_BULLETS. Either it names something a gate really grants — in which case teach ` +
      `CAPABILITY_CLAIMS that wording, so the tier scans can police it — or nothing enforces it, ` +
      `in which case add it to UNGATED_BULLETS with the reason, or delete the bullet. This is the ` +
      `exact shape "Audit log" had on the Growth card.`,
  };
};

describe("every pricing-card bullet is accounted for by something real", () => {
  const everyBullet = PLANS.flatMap((plan) => plan.features.map((bullet) => ({ plan, bullet })));

  it("scans a real corpus — every plan, and bullets on all of them", () => {
    // The anti-vacuity floor. An empty or half-empty sweep passes every assertion below while
    // proving nothing, which is the failure mode this whole file keeps meeting.
    expect(PLANS.length, "the ladder itself").toBeGreaterThanOrEqual(6);
    expect(everyBullet.length, "bullets across all cards").toBeGreaterThanOrEqual(30);
    for (const plan of PLANS) {
      expect(plan.features.length, `the ${plan.id} card has no bullets to check`).toBeGreaterThan(0);
    }
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
    const orphans = UNGATED_BULLETS.filter(
      ({ matches }) => !everyBullet.some(({ bullet }) => matches.test(bullet)),
    ).map(({ matches }) => matches.source);

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
  /**
   * Every `.ts`/`.tsx`/`.mdx` under `src/` — the IN-APP product as well as the marketing site.
   * `buyerFacingLines()` is deliberately left as it is: its two consumers ask about pricing and
   * about the delivery log, and widening their corpus would change what those guards mean.
   *
   * Memoised. This walks and reads the whole source tree, and two tests below need it; doing that
   * twice pushed the pair past vitest's 5s default on a loaded machine.
   */
  let corpus: Array<{ file: string; line: string; number: number }> | null = null;
  const productLines = (): Array<{ file: string; line: string; number: number }> =>
    (corpus ??= walk(join(process.cwd(), "src")).flatMap((file) =>
      scannableLines(file).map(({ line, number }) => ({
        file: file.replace(process.cwd(), ""),
        line,
        number,
      })),
    ));

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
   *
   * KNOWN LIMIT, measured rather than guessed. This is line-wide on purpose. A tighter version was
   * written and tested — the negator had to sit within 60 characters BEFORE the conformance word —
   * and it flagged two lines that ship today and are among the most honest in the repo:
   *
   *   help/ubl-and-peppol/page.mdx:66  "If your counterparty requires certified Peppol BIS Order 3,
   *                                     treat ProcuLink's UBL output as the *input* to your access
   *                                     point's validator, not as a finished Peppol document…"
   *   standards/catalog.ts:121         the Peppol BIS row's own conformance note, whose negations
   *                                    ("declares no Peppol profile at all") sit further from
   *                                    "validates" than any fixed window can span.
   *
   * In both, the denial is real but arrives after the conformance word or far from it. A guard that
   * reddens the disclosure invites deleting the disclosure, which is how the product got here. So
   * the excuse stays line-wide, and the cost is stated instead of hidden: a line that denies in one
   * clause and claims in another — "Peppol BIS certified output, no setup required" — is NOT
   * caught by this arm. What is not soft is everything above it: the URN arm and the profile-name
   * arm are unconditional and derived, and those are the two shapes this defect actually took.
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

    // 4. The two arms that carry the real weight are unconditional, so no phrasing excuses them.
    //    The prose arm's line-wide negation has a documented soft edge (see NEGATED); these do not.
    expect(
      offends('  const PROFILE_URN = "urn:fdc:peppol.eu:poacc:bis:order_only:3"; // not emitted, kept for reference'),
      "the URN arm ignores negation entirely — there is no honest reason to carry the value",
    ).toBe(true);
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
