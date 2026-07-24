// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the subprocessor list (GDPR Art. 28).
// /security, /subprocessors, and /privacy all render from this array so the
// three lists can never diverge again. Follows the src/lib/legal-entity.ts
// pattern: one constant, imported everywhere it is displayed.
//
// TRUTH RULES for this file:
//   • Only vendors that are actually in the deployed stack belong here.
//     (Resend was removed 2026-06-11 — zero references in code or env.
//      AWS was removed — not in the stack; hosting is Railway, storage is
//      Cloudflare R2, database is Neon.)
//   • Locations must be checkable. Railway's region is europe-west4
//     (Netherlands) — write the real region, never a guessed city.
//   • Do not claim certifications or contract terms we do not have.
// ─────────────────────────────────────────────────────────────────────────────

export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
  contract: string;
}

/** Human-readable date this list last changed. Bump on every edit. */
export const SUBPROCESSORS_UPDATED = "11 June 2026";

/**
 * A subprocessor addition or replacement that has been decided but has not
 * started processing customer data yet.
 *
 * This array IS the 30-day advance-notice mechanism promised on /subprocessors
 * and in the DPA. There is no notification mailing list, so the commitment is
 * kept by publishing here first: add the entry with an `effective` date at
 * least 30 days out, ship it, and only then move the vendor into
 * SUBPROCESSORS (bumping SUBPROCESSORS_UPDATED) on or after that date.
 *
 * Empty is the normal state and renders as an explicit "nothing pending" line —
 * silence would be indistinguishable from a forgotten notice.
 */
export interface PlannedSubprocessorChange {
  name: string;
  purpose: string;
  /** What is happening: an addition, or which vendor it replaces. */
  change: string;
  /** Human-readable date it starts processing customer data. */
  effective: string;
  /** Human-readable date this notice was first published here. */
  noticePublished: string;
}

export const SUBPROCESSOR_PLANNED_CHANGES: PlannedSubprocessorChange[] = [];

export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Railway",
    purpose: "API and background-worker hosting",
    location: "EU (europe-west4, Netherlands)",
    contract: "Railway DPA",
  },
  {
    name: "Neon",
    purpose: "PostgreSQL database hosting",
    location: "EU region",
    contract: "Neon DPA",
  },
  {
    name: "Cloudflare",
    purpose: "R2 object storage (order files and generated artifacts) and DNS",
    location: "EU-region bucket",
    contract: "Cloudflare DPA",
  },
  {
    name: "Vercel",
    purpose: "Frontend hosting and CDN",
    location: "Global CDN, source data EU",
    contract: "Vercel DPA + SCCs",
  },
  {
    name: "Clerk",
    purpose: "Authentication and session management",
    location: "US, EU data residency available",
    contract: "Clerk DPA + SCCs",
  },
  {
    name: "OpenAI",
    purpose:
      "AI document extraction and mapping suggestions (API data is not used for model training under OpenAI's API terms)",
    location: "US",
    contract: "OpenAI DPA + SCCs",
  },
  {
    name: "Stripe",
    purpose: "Payment processing and subscription management",
    location: "US, EU establishment",
    contract: "Stripe DPA + SCCs",
  },
  {
    name: "Postmark",
    purpose: "Inbound email ingestion (orders emailed to your ProcuLink address)",
    location: "US",
    contract: "Postmark DPA + SCCs",
  },
  {
    name: "PostHog",
    purpose: "Pseudonymous product analytics",
    location: "EU (eu.posthog.com)",
    contract: "PostHog DPA",
  },
  {
    name: "Sentry",
    purpose: "Error monitoring and diagnostics",
    location: "EU region",
    contract: "Sentry DPA",
  },
];
