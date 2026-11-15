import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import PricingPage from "@/app/(marketing)/pricing/page";

import { MINIMUM_PLAN, planIncludesCapability } from "@/lib/gatedCapabilities";
import {
  DELIVERY_METHODS,
  IMPORT_METHODS,
  OUTPUT_FORMATS,
  STANDARD_NAME_TOKENS,
  type FormatRow,
} from "@/lib/marketing/format-catalog";
import { PLANS, PUBLIC_LADDER, inheritanceLine, type Plan, type PlanId } from "@/lib/plans";
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

/** The plan names a row's name+note mention, cheapest-first. */
const plansNamedIn = (row: FormatRow): string[] =>
  PLAN_NAMES.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(`${row.name} ${row.note ?? ""}`));

describe("advertised tier matches the enforced tier", () => {
  it("names no plan on any /formats row — no BillingFeature gates a channel or a format", () => {
    // The backend gate table is Sso only, so a tier on an intake channel, a
    // delivery channel or an output format would sell an upgrade nobody needs.
    const rows = [...IMPORT_METHODS, ...DELIVERY_METHODS, ...OUTPUT_FORMATS];
    expect(rows.length, "the corpus must really contain rows").toBeGreaterThan(5);

    const offenders = rows
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
    const retiredClaims = [
      /custom output template/i,
      /mapping library/i,
      /template library/i,
      // Plan 14 opened the workspace-wide log to every plan.
      /advanced audit/i,
    ];

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
    expect(source).toMatch(/file api/i);
    expect(source, "must say existing data survives, or it reads as data loss").toMatch(
      /stays readable|remain|still/i,
    );
    expect(source, "must tell them to warn their senders — nothing is queued for later").toMatch(
      /tell your senders/i,
    );
  });

  it("the billing help article says what cancelling does, not only how to do it", () => {
    const article = read("src/app/(marketing)/help/billing-faq/page.mdx");

    const howTo = article.search(/## How to cancel/i);
    expect(howTo).toBeGreaterThan(-1);
    const section = article.slice(howTo);

    expect(section, "the section must state the consequence").toMatch(/stops accepting new documents/i);
    expect(section).toMatch(/tell your senders/i);
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

/** A matcher may be a pattern or a predicate. */
type ClaimMatcher = RegExp | ((text: string) => boolean);

const claims = (sells: ClaimMatcher, text: string): boolean =>
  typeof sells === "function" ? sells(text) : sells.test(text);

const CAPABILITY_CLAIMS: Record<keyof typeof BACKEND_MINIMUM_PLAN, { label: string; sells: ClaimMatcher }> = {
  sso: { label: "SSO", sells: SELLS_SSO },
};

/** The cheapest tier whose card sells this capability, or null when no card sells it. */
const cheapestSeller = (plans: Plan[], sells: ClaimMatcher): Plan | null => {
  const selling = plans.filter((p) => p.features.some((f) => claims(sells, f)));
  if (selling.length === 0) return null;
  return selling.reduce((a, b) => (rank(a.id) <= rank(b.id) ? a : b));
};

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
    why: "downloading the transform artifact is ungated, as is every delivery channel",
  },
  {
    matches: /^Email delivery to your supplier$/i,
    why: "no BillingFeature gates a delivery channel (the gate table is Sso only), so Pilot really can send by email",
  },
  {
    matches: /^Field mapping$/i,
    why: "no BillingFeature gates the field mapper or mapping import/export",
  },
  {
    matches: /^Built-in order checks$/i,
    why: "the built-in document checks (DocumentChecks) run on every plan including Pilot",
  },
  {
    matches: /^Per-order audit trail$/i,
    why:
      "DocumentsController.History has no gate and is pinned as the IL scanner's negative control " +
      "(Scanner_Control_DoesNotInventAGateWhereThereIsNone in BillingGateEnforcementIsRealTests). " +
      "Every plan including Pilot really has this",
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

/** Parsed shape of a quota bullet — "150 documents/month", "5 suppliers", "Custom volume". Documents ARE the order allowance. */
const parseQuotaBullet = (
  bullet: string,
): { kind: "orders" | "suppliers"; value: number | null; saysMonthly: boolean } | null => {
  const numeric = /^([\d,]+)\s+(orders?|documents?|suppliers?)\b/i.exec(bullet);
  if (numeric) {
    return {
      kind: /^(orders?|documents?)$/i.test(numeric[2]) ? "orders" : "suppliers",
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
 * the advanced-audit matcher hit "Advanced audit trail", the whole bullet was marked explained,
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
  // half contradicted the gate table (CustomSupplierRules was Enterprise; plan 13b deleted it).
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
    expect(PLANS.length, "the ladder itself").toBeGreaterThanOrEqual(1);
    // Derived from the ladder, not a round number. It was a hand-typed 30, which is a floor that
    // has to be re-typed every time the cards change shape — and when `inheritsFrom` let the
    // dearer tiers stop restating inherited bullets, a correct total of 29 read as a regression.
    // Every card owes two quota bullets (asserted below), so two per card is the same floor
    // expressed as the rule it was standing in for. Not three: since plan 14 opened the workspace
    // log to every plan, Operations differs from Growth by volume only.
    for (const plan of PLANS) {
      expect(plan.features.length, `the ${plan.id} card must state both allowances`).toBeGreaterThanOrEqual(2);
    }
    expect(everyBullet.length, "bullets across all cards").toBeGreaterThanOrEqual(PLANS.length * 2);
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

    // 1. The origin defect. Every plan has the workspace log, so no card may sell it.
    expect(accountFor(growth, "Audit log").ok).toBe(false);

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
   * MUST-FLAG CONTROL for the compound-bullet bypass.
   *
   * `plans.ts:210` read `"Advanced audit trail + priority support"` on the €399 Operations card.
   * Plan 14 removed that gate, so the replay now hides the same unbacked claim behind the one
   * capability matcher left, SSO, on the Enterprise card.
   *
   * Priority support is not a `BillingFeature`; `BillingFeature.cs:20-21` records that
   * `SlaOnboarding` was deleted for exactly this reason — an SLA and named support are fulfilled
   * by people and no code path can check them — and the published commitment is undifferentiated
   * anyway: `/support` offers every plan, free Pilot included, the same "within one business day".
   *
   * It survived because the advanced-audit matcher hit "Advanced audit trail" and the whole bullet
   * was then declared accounted for.
   */
  it("catches an unbacked claim hiding in a compound bullet behind a backed one", () => {
    const enterprise = PLANS.find((p) => p.id === "enterprise")!;

    const shipped = accountFor(enterprise, "SSO + priority support");
    expect(shipped.ok, "the compound must be refused").toBe(false);
    // `in` rather than `!shipped.ok &&`: this repo compiles with `strictNullChecks: false`, under
    // which the boolean discriminant does not narrow the union.
    expect(
      "problem" in shipped && shipped.problem,
      "and refused for the RIGHT clause: a message naming the SSO half would mean the split ran backwards",
    ).toMatch(/priority support/i);

    // The backed half on its own is still fine — the fix must not have been "ban the word SSO".
    expect(accountFor(enterprise, "SSO").ok).toBe(true);

    // The same laundering with other conjunctions, and with the unbacked claim FIRST, so the fix
    // cannot be an ordering accident.
    for (const compound of [
      "Priority support + SSO",
      "24/7 phone support and SAML SSO",
      "SSO & quarterly business reviews",
    ]) {
      expect(accountFor(enterprise, compound).ok, `must flag: ${compound}`).toBe(false);
    }

    // Genuine multi-capability bullets must still pass, or the only obvious repair is to stop
    // splitting — which restores the bypass. Both halves of this one are really accounted for.
    expect(accountFor(enterprise, "Field mapping + built-in order checks").ok).toBe(true);
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
  });
});

/**
 * Reading the price list left to right.
 *
 * ── The defect ──────────────────────────────────────────────────────────────────
 *
 * Gates are MINIMUM-plan, so Integration and Distributor both included `Cxml`, `BulkMapping` and
 * advanced audit (plan 13b deleted the first two gates, plan 14 the third). Their cards listed none of them. Integration named neither cXML nor bulk
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
 * capability set of every tier above it collapses, so the chain is what is asserted.
 */
describe("a dearer tier never appears to include less than a cheaper one", () => {
  /** The ladder as the pricing page renders it, cheapest first. */
  const ladder = PLANS; // pilot + legacy + enterprise: the cards these guards were written against

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
 * 2026-11-14, plan 13b: `DeliveryService` and `OpsController` went with the order pipeline. The ban
 * still stands on the engine: a `FlowDelivery` row is updated in place on every attempt, and
 * `DataErasureService` still hard-deletes `AuditEvents` via `RemoveRange`.
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
        "a FlowDelivery row is updated in place on every attempt, and DataErasureService " +
        "hard-deletes AuditEvents via RemoveRange. Say what is recorded instead:\n" +
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
    // What shipped before plan 13b. Every clause was checkable then: the fields were on
    // DeliveryAttempt.cs, which plan 13b deleted with the order pipeline. It stays as a control
    // because describing what is stored is still not a durability promise.
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
    // "Supersedes rather than erases" was the accurate description of OpsController.cs:251 and must
    // stay sayable — it is a statement about what requeue does, not a promise about forever.
    expect(offends("Requeueing supersedes earlier attempts rather than erasing them.")).toBe(false);
    // A tier claim is not a durability promise, so this block leaves it alone.
    expect(offends("The workspace-wide delivery log is included from the Operations plan up.")).toBe(false);
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
 * `BillingFeature.WebhookDelivery` (Growth) and cXML output was `BillingFeature.Cxml`
 * (Operations); plan 13b deleted both gates. A Pilot workspace reaches **delivered** only over SFTP, FTPS or email, in any
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
  const FREE_TIER = PLANS[0].name; // derived, so renaming the tier moves this with it.
  // Help pages still say "Pilot" until the relaunch rewrites them; keyed to the new name alone the guard
  // would go blind to the old one, so both are matched.
  const FREE_TIER_RE = `(?:${FREE_TIER}|Pilot)`;

  const SUFFICIENCY = String.raw`(?:is enough|is all you need|covers everything|enough for all|does everything)`;
  const CLAIMS_PILOT_SUFFICES = new RegExp(
    String.raw`\b${FREE_TIER_RE}\b[^.\n]{0,60}?\b${SUFFICIENCY}\b` +
      String.raw`|\b(?:everything|the whole|all of) (?:here|this|of it)[^.\n]{0,40}?\bon ${FREE_TIER_RE}\b`,
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
      `these lines tell the reader ${FREE_TIER} covers everything. It is a trial limited by ` +
        "quota, so a blanket sufficiency claim misleads. Say what works instead:\n" + offenders.join("\n"),
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
// 2026-11-14, plan 13b: the order pipeline this section cites (the `ITransformService`
// registrations and `EdifactOrderParser` in `Program.cs`) was deleted, so the line numbers here and
// below are history. The guard reads the catalog's `transform` column, not those registrations.
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
      "/src/components/bridge/", // shared app components, the flow mapper among them
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
});

describe("the /pricing cards, as rendered from PUBLIC_LADDER", () => {
  it("every bullet a card sells is a capability the backend grants that plan", () => {
    const { container } = render(createElement(PricingPage));
    // Each plan block names, in data-plans, every plan its text is sold on; a bullet shared by the
    // four paid plans is written once and checked against all four.
    const blocks = Array.from(container.querySelectorAll("[data-plans]"));
    // Anti-vacuity: every public plan is named by some block, and the bullets really render.
    expect(new Set(blocks.flatMap((b) => b.getAttribute("data-plans")!.split(" ")))).toEqual(new Set(PUBLIC_LADDER.map((p) => p.id)));
    expect(blocks.some((b) => b.querySelector("li"))).toBe(true);

    for (const block of blocks) {
      for (const id of block.getAttribute("data-plans")!.split(" ")) {
        for (const li of Array.from(block.querySelectorAll("li"))) {
          for (const [key, { label, sells }] of Object.entries(CAPABILITY_CLAIMS)) {
            if (!claims(sells, li.textContent ?? "")) continue;
            expect(
              planIncludesCapability(id as PlanId, key as keyof typeof BACKEND_MINIMUM_PLAN),
              `the ${id} plan is sold ${label} ("${li.textContent}") but the backend does not grant it there`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
