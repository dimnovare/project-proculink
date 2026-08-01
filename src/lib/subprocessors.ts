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
//   • Locations must be checkable, and a WRONG-but-specific location is worse
//     than a vague one, because it is harder to defend. "europe-west4" sat
//     here as Railway's region for months; it is not a Railway region
//     identifier at all, and the only thing citing it was this comment — so
//     the pages were quoting themselves. Removed 2026-07-30. Do not write a
//     region id or a city back in until someone has read it off the vendor's
//     own dashboard.
//   • A vendor's purpose must name everything it actually receives, in every
//     direction. Postmark was listed as inbound-only while the email delivery
//     channel was sending complete purchase orders out through it.
//   • Do not claim certifications or contract terms we do not have.
//
// WHICH LOCATIONS ARE SOURCED, AND WHICH ARE NOT (checked 2026-07-31).
// The backend's docs/qa/2026-07-30-residency-ground-truth.md marked six of these
// locations UNSOURCED. Two of the six can now be closed from a PUBLIC, repeatable
// source — the production CSP response header, which src/lib/security/csp.ts
// derives from the live NEXT_PUBLIC_SENTRY_DSN and NEXT_PUBLIC_POSTHOG_HOST:
//
//     curl -sI https://proculink.eu/ | grep -i content-security-policy
//     → connect-src … https://eu.posthog.com https://eu-assets.i.posthog.com
//                     https://o4511461459558400.ingest.de.sentry.io
//
//   ✔ Sentry  "EU region"          — `.ingest.de.` IS Sentry's EU region, and this
//                                    is the PRODUCTION frontend DSN (csp.ts parses
//                                    it with NO fallback: no DSN would mean no
//                                    report-uri at all), not the csp.test.ts fixture
//                                    the ground truth rightly refused as evidence.
//   ✔ PostHog "EU (eu.posthog.com)" — the browser leg is EU on live production.
//
// BUT NEITHER U6 NOR U8 IS FULLY CLOSED, and the copy this licenses is mostly about
// the BACKEND. A frontend response header cannot observe the API's or the Worker's
// `Sentry:Dsn`, nor Railway's `Analytics__PostHog__Host`. Sentry regions are
// per-organisation, so if the backend DSN belongs to the same org as the one above
// then it is EU too — that is an INFERENCE, not a measurement, and the ground truth's
// rule is that inferences are never presented as measurements. PostHog's origin also
// has a hardcoded `?? "https://eu.posthog.com"` default in csp.ts, so the header is
// equally consistent with the variable being unset — the conclusion survives (the
// same default is in analytics.ts, so the browser goes to EU either way) but it is
// weaker than "an override is ruled out". Read the two dashboards to finish these.
//
// STILL UNSOURCED — do not strengthen, and do not soften into a different guess:
//   ✗ Railway "EU region"       (U1) — no region is pinned in ANY committed file in
//                                      either repo; it is a dashboard-only setting.
//                                      `x-railway-edge: ams1` on api.proculink.eu is
//                                      NOT evidence: that header names the edge PoP
//                                      nearest the CLIENT, not the deploy region.
//   ✗ Neon    "EU region"       (U5) — no Neon hostname exists in either repo.
//   ✗ Cloudflare "EU-region bucket" (U3) — R2Endpoint is "" in committed config, the
//                                      app never creates a bucket, and zero hits for
//                                      jurisdiction/locationHint. Note that even a
//                                      confirmed LOCATION HINT would not license this
//                                      wording: Cloudflare's own docs call hints
//                                      "best effort and not a guarantee" and only a
//                                      jurisdictional restriction is a residency
//                                      control.
// These three are left as they are ON PURPOSE. They are unsourced, not established
// false — unlike the claims corrected in this pass, which code contradicts outright.
// Retracting a probably-true residency claim across the whole site is a commercial
// decision, and each is settled by ONE dashboard read: Cloudflare → R2 → bucket
// `proculink` → Jurisdiction; Railway → service → Settings → Region (BOTH services);
// Neon → Project → region label. Do those three, then write what they say.
// ─────────────────────────────────────────────────────────────────────────────

export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
  contract: string;
}

/**
 * Human-readable date the subprocessor SET last changed — a vendor added,
 * removed or replaced. /subprocessors renders it as "list last changed", so it
 * must not move for a wording correction: bumping it would signal a
 * subprocessor change that did not happen, and the 30-day notice below is
 * checked against it. Fixing a wrong purpose or location line leaves it alone.
 */
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
    location: "EU region",
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
    purpose: "R2 object storage (order files and the output files we generate) and DNS",
    location: "EU-region bucket",
    contract: "Cloudflare DPA",
  },
  {
    name: "Vercel",
    // Vercel serves the website and the app shell only. There are no route
    // handlers, no server actions and no src/app/api routes, so uploads and
    // every order request go from the browser straight to our API. It holds no
    // order data, which also means it is no evidence about where order data
    // lives — the old "source data EU" implied otherwise.
    purpose: "Website and app hosting (order files do not pass through it)",
    location: "Global CDN",
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
    // Both directions, and the outbound one carries the purchase order itself
    // as an email attachment. Railway blocks outbound SMTP, so the email
    // delivery channel posts to Postmark's US API — there is no EU option to
    // switch on; the vendor states it has no plans to add EU servers.
    purpose:
      "Email in and out: orders emailed to your ProcuLink address, and the purchase orders we email to your suppliers",
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
