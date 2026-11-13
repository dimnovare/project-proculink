"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { MarketingNav } from "@/components/marketing/MarketingNav";
// Static imports on purpose (reverted from next/dynamic): with dynamic ssr:true
// the real hero SVG + ROI calculator shipped inside hidden streaming segments
// swapped in by inline scripts — so a no-JS/script-blocked visitor permanently
// saw an empty hero box and blank grey ROI skeleton. Their weight is modest;
// the meaningful bundle win (the ~140 kB Clerk UI chunk) lives in
// MarketingNav's split and is unaffected.
import { BridgeIllustration } from "@/components/marketing/BridgeIllustration";
import { ROICalculator } from "@/components/marketing/ROICalculator";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";
import {
  INBOUND_FORMAT_COUNT,
  OUTBOUND_FORMAT_COUNT,
  DELIVERY_CHANNEL_COUNT,
  partitionByDirection,
} from "@/lib/marketing/format-catalog";
import { requiresPlan } from "@/lib/gatedCapabilities";
import { PLAN_BY_ID } from "@/lib/plans";

// ─── Brand tokens (Bridge Layer design system) ───────────────────────────────
// Primary accent is BUYER-BLUE; supplier side is forest green. These are ALIASES
// for the CSS custom properties in globals.css — never copies of their values.
//
// They used to be hex copies, and they had silently drifted: BLUE_SOFT,
// GREEN_SOFT, AMBER, AMBER_SOFT, AI_SOFT, NAVY_SURFACE, NAVY_BORDER, NAVY_TEXT,
// INK_MUTED, BORDER and SURFACE_2 were all a generation behind globals.css, and
// the stale amber pair shipped an accent tile at 2.93:1 — under the 3:1 floor
// for non-text. Pointing every alias at var(--token) is what makes that class of
// drift impossible. Enforced by scripts/check-tokens.mjs.
const BLUE = "var(--brand-blue)"; // buyer / primary / active
const BLUE_DEEP = "var(--brand-blue-deep)";
const BLUE_SOFT = "var(--brand-blue-soft)";
const GREEN = "var(--brand-green)"; // supplier
const GREEN_DEEP = "var(--brand-green-deep)";
const GREEN_SOFT = "var(--brand-green-soft)";
// --amber is the DOT/BORDER/STROKE value; --amber-text is the AA-safe text and
// icon value on a soft-amber fill (5.62:1 vs 3.65:1). AMBER_BRIGHT is the same
// accent for the NAVY hero panes: --amber-text is tuned for light surfaces and
// collapses to 2.93:1 on --navy-inset, where --amber-bright is 9.26:1.
const AMBER = "var(--amber-text)";
const AMBER_BRIGHT = "var(--amber-bright)";
const AMBER_SOFT = "var(--amber-soft)";
const AI = "var(--ai)";
const AI_SOFT = "var(--ai-soft)";
const NAVY = "var(--navy)";
const NAVY_SURFACE = "var(--navy-surface)";
const NAVY_BORDER = "var(--navy-border)";
const NAVY_TEXT = "var(--navy-text)";
const NAVY_MUTED = "var(--navy-muted)";
const NAVY_FAINT = "var(--navy-faint)";
const INK = "var(--ink)";
const INK_MUTED = "var(--ink-muted)";
const INK_FAINT = "var(--ink-faint)";
const BORDER = "var(--border)";
const SURFACE = "var(--surface)";
const SURFACE_2 = "var(--surface-2)";
const BG = "var(--bg)";
// Bright tints used on the navy chrome (hero/CTA) for accent words + dots.
const BLUE_BRIGHT = "var(--brand-blue-bright)";
const GREEN_BRIGHT = "var(--brand-green-bright)";

// ─── Line-icon set (stroke = currentColor) ────────────────────────────────────
function Icon({ name, color }: { name: string; color: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    // stroke goes through `style`, not the presentation attribute: callers now
    // pass `var(--token)`, and var() substitution inside an SVG presentation
    // attribute is not reliable across browsers. As a CSS declaration it is.
    style: { stroke: color },
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="m2 17 10 5 10-5" />
          <path d="m2 12 10 5 10-5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M13 2 4.5 12.5a.5.5 0 0 0 .4.8H11l-1 8.7L18.5 11a.5.5 0 0 0-.4-.8H12l1-8.2Z" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "shield-check":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.4" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.4" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" />
          <polyline points="12 7 12 12 16 14" />
        </svg>
      );
    case "repeat":
      return (
        <svg {...common}>
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11V9a3 3 0 0 1 3-3h15" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v2a3 3 0 0 1-3 3H3" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    default:
      return null;
  }
}

// ─── Static data ──────────────────────────────────────────────────────────────

const FEATURES: Array<{
  icon: string;
  title: string;
  desc: ReactNode;
  color: string;
  bg: string;
  /** When set, the card's top edge is the blue→green gradient deck. */
  topGradient?: boolean;
}> = [
  {
    icon: "layers",
    title: "Universal ingestion",
    desc: "CSV, XLSX, PDF, cXML, UBL or X12 — drop a file straight in. JSON arrives via the REST API; EDIFACT and SAP IDoc we switch on with you. ProcuLink parses all of it into one consistent order.",
    color: BLUE_DEEP,
    bg: BLUE_SOFT,
  },
  {
    icon: "spark",
    title: "AI-assisted mapping",
    desc: (
      <>
        When a buyer item code doesn&apos;t match the catalog, an LLM proposes the
        supplier code with confidence, reasoning and source. Your team confirms
        or rejects.
      </>
    ),
    color: AI,
    bg: AI_SOFT,
  },
  {
    icon: "code",
    title: "Order review workbench",
    desc: "Side by side: source document, cleaned-up order and the exact outbound file. Resolve every exception before anything leaves your system.",
    color: AMBER,
    bg: AMBER_SOFT,
  },
  {
    icon: "shield-check",
    // Was "Per-supplier validation" / "Configurable rules per supplier — missing
    // fields, wrong currency, item codes that won't resolve." The configurable
    // per-supplier rule set is the Enterprise-gated product
    // (BillingFeature.CustomSupplierRules, PlanConstants.cs:287;
    // SupplierAcceptanceController.cs:70,99 refuses authoring and activating), so
    // a card headed with it and naming no tier read as included on every plan.
    // Two of the three examples were not even the gated product: unresolved item
    // codes and a missing PO number or currency are built-in and run on Pilot.
    title: "Validation before send",
    desc: (
      <>
        Bad orders are held before they reach the supplier. Built-in checks run
        on every plan — no PO number, no currency, a quantity of zero, a negative
        price, an item code that won&apos;t resolve. Your own rules for a
        supplier, such as an accepted currency list, are{" "}
        {requiresPlan("customSupplierRules")}.
      </>
    ),
    color: GREEN_DEEP,
    bg: GREEN_SOFT,
  },
  {
    icon: "send",
    title: "One-click delivery",
    // The ERP connectors are not an ordinary channel alongside SFTP and email: they gate at
    // Enterprise (BillingFeature.ErpConnectors, from €2,500/mo), while HTTP webhook gates at
    // Growth and SFTP/email are ungated. Listing all four in one breath read as "pick any".
    //
    // The webhook half of that sentence was then left undisclosed for months, next to an ERP
    // clause that DID name its tier — which is what taught a reader that an unqualified channel
    // on this card is included. Naming Enterprise beside it made the silence louder, not safer.
    desc: `HTTP webhook, SFTP or email — or download the artifact. Webhook delivery is ${requiresPlan("webhookDelivery")}; SFTP and email delivery are on every plan. ERP connectors (Erply, Directo) on ${requiresPlan("erpConnectors")}. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.`,
    color: BLUE_DEEP,
    bg: BLUE_SOFT,
    topGradient: true,
  },
  {
    icon: "layers",
    title: "Standards, on demand",
    // "Every order field maps to…" was false by a factor of five. FIELD_STANDARDS carries
    // references for the core of a purchase order; the canonical model an output may bind is
    // 53 fields wide (BINDABLE_HEADER_FIELDS + BINDABLE_LINE_FIELDS), and 43 of them have no
    // standards path recorded — SupplierItemCode among them. The claim is now about what the
    // reference IS (core fields, always visible, never behind a mode), and /library/standards
    // prints its own derived coverage. No universal quantifier may come back here while the
    // gap exists — pinned by standardsCoverage.test.tsx.
    //
    // "Built for 30-year procurement veterans." used to close this card. It sold to the wrong
    // reader: the person this page is written for is whoever sits closest to repeat order
    // preparation — often a buyer, a purchasing or operations lead, or the owner of a smaller
    // business — not a procurement career. The audience is named once, in the "Who it is for" section.
    desc: "Core order fields map to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode.",
    color: BLUE_DEEP,
    bg: BLUE_SOFT,
  },
];

// The format strip below the features. The LABELS are still written here — they are short
// marketing names, not catalog rows — but which of them ProcuLink actually EMITS is decided by
// the catalog, not by this file.
//
// It used to be decided here, and it was wrong: the strip was headed "Speaks the formats your
// suppliers already use" (outbound) and listed "EDIFACT", whose `transform` level resolves to
// `onRequest` — no outbound transformer today. /help/guides/set-up-supplier-delivery says so in
// as many words. `partitionByDirection` also throws at build time on a label matching no
// catalog row at all, so this list cannot outlive the formats it names.
const FORMAT_STRIP = partitionByDirection(["PDF", "CSV", "Excel", "cXML", "UBL", "EDIFACT", "X12"]);

// Counts are DERIVED from @/lib/marketing/format-catalog (the same rows the
// /formats page renders), so the hero numbers can never drift from the table:
//   Inbound  = import formats available today (live + configurable)
//   Outbound = output formats that are LIVE (EDIFACT onRequest is excluded)
//   Channels = delivery methods available today (live + configurable)
// "Data residency" is a claim, not a count, so it carries a link to the page
// that qualifies it: order storage is EU-region, but named US subprocessors
// handle sign-in, AI extraction, payments, and email IN BOTH DIRECTIONS under
// SCCs — including the purchase orders we email out to suppliers, which is the
// half this comment used to omit by saying "inbound email". That is the exact
// defect src/lib/subprocessors.ts warns about, and a stale comment is where the
// next author gets their framing. The stat may only stay on the page while that
// explanation is one click away.
const STATS: Array<{ value: string; label: string; href?: string }> = [
  { value: String(INBOUND_FORMAT_COUNT),   label: "Inbound formats"    },
  { value: String(OUTBOUND_FORMAT_COUNT),  label: "Outbound formats"   },
  { value: String(DELIVERY_CHANNEL_COUNT), label: "Delivery channels"  },
  { value: "EU", label: "Data residency", href: "/security" },
];

// ─── One flow, worked examples ────────────────────────────────────────────────
// The page leads with the one flow — read, check, transform, send — and keeps the item-code
// match as its worked example. Purchase orders work today; invoices are early access ONLY.
//
// TRUTH NOTES for whoever edits the copy below. Each line is something the product does
// today, and the nearby phrasing it replaced was not:
//   • Saved code pairs are PER SUPPLIER and are applied automatically to later orders from
//     that supplier. The review screen does NOT mark which codes came from an earlier order
//     and does NOT print an "N of M recognised" count — so no copy here may promise either.
//   • Nothing is sent automatically by default: auto-delivery is off until a person turns it
//     on for a supplier, and an order with an unresolved item code or a failed built-in check
//     cannot be transformed, so it never reaches automatic delivery. There is NO per-order
//     override that holds one order back while the supplier's automatic delivery is on, so
//     the copy must not offer one.
//   • ProcuLink cannot produce PDF or Excel OUTPUT. "Download the supplier-ready file" is
//     true; "download a PDF" is not.
//   • The supplier receives an ordinary file or email. It does not sign up for anything.

const TRUST_STRIP = [
  "No ERP integration needed to start",
  "Your supplier doesn't need an account or new software",
  "Start with a test or anonymised document",
  "Review first, automate later",
];

/** Invented codes, shown as an example of the pairing — not taken from any real catalogue. */
const MAPPING_EXAMPLE: Array<{ yours: string; theirs: string; item: string }> = [
  { yours: "INT-10442", theirs: "4471-208", item: "Hex bolt M8 × 40, zinc" },
  { yours: "PKG-BOX-40", theirs: "CB-4030-DW", item: "Shipping carton 40 × 30" },
  { yours: "VLV-015-BR", theirs: "BV-12-B", item: "Ball valve ½\", brass" },
];

const HOME_STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Choose a repeat supplier",
    body: "Start with one you order from regularly, especially where item codes differ.",
  },
  {
    title: "Upload the PO you already create",
    body: "PDF, Excel, CSV or another supported input.",
  },
  {
    title: "Confirm anything ProcuLink does not already know",
    body: "Supplier code mappings are remembered for next time.",
  },
  {
    title: "Review the finished order",
    body: "Download it and send it yourself, or use ProcuLink delivery when you are ready.",
  },
];

// EXAMPLES, not a target list. Who it is for is defined by the workflow — anyone who handles
// the same kind of document by hand, in any trade — and the section heading says so. These rows
// only illustrate it, under an explicit "For example" label. Do not add sector rows to narrow the
// audience. The invoice row says "early access": invoice reading is not live yet (offer ⇔ works).
const WHO_IT_IS_FOR_EXAMPLES: Array<{ who: string; problem: string }> = [
  {
    who: "A buyer with repeat suppliers",
    problem: "Your item numbers don't match your supplier's. Confirm a match once, and ProcuLink reuses it on the next order to that supplier.",
  },
  {
    who: "A team sending orders in many formats",
    problem: "Each supplier wants the order in its own file layout or by its own channel. ProcuLink writes each supplier's format, from the ones it supports, and sends it.",
  },
  {
    who: "A bookkeeper — early access",
    problem: "You retype supplier invoices from PDFs into your system, and a new vendor has no template yet. Invoice reading is being built now: apply for the pilot below.",
  },
];

// The Pilot's allowance is read off the ladder, never typed: this line is the last promise
// on the page and a re-sized Pilot in plans.ts must move it. `priceLabel` is "Free" and
// `priceCadence` IS the trial window ("14 days") on the trial tier.
const PILOT = PLAN_BY_ID.pilot;
const PILOT_SUPPLIERS = PILOT.supplierLimit ?? 0;
const PILOT_OFFER_LINE =
  `${PILOT.priceLabel} for ${PILOT.priceCadence} · ${PILOT.orderLimit} documents · ` +
  `${PILOT_SUPPLIERS} ${PILOT_SUPPLIERS === 1 ? "supplier" : "suppliers"} · no credit card.`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RootPage() {
  const [heroView, setHeroView] = useState<"topology" | "canonical">("topology");

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: SURFACE,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <MarketingNav />

      {/* The home page renders through the ROOT layout (not the marketing
          layout), so it must supply its own <main> landmark (WCAG 1.3.1). Wraps
          the content sections only — nav + footer stay outside. */}
      <main id="main-content" tabIndex={-1} className="outline-none">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background:
            "radial-gradient(800px 420px at 50% -8%, rgba(30,102,201,0.22), transparent 60%), radial-gradient(620px 380px at 84% 18%, rgba(46,142,58,0.16), transparent 60%), var(--navy)",
          paddingTop: "64px",
          paddingBottom: "76px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(30,102,201,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(30,102,201,0.045) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            pointerEvents: "none",
          }}
        />

        <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
          {/* Eyebrow */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 28,
              borderRadius: 14,
              padding: "0 13px",
              background: NAVY_SURFACE,
              border: `1px solid ${NAVY_BORDER}`,
              marginBottom: 22,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: BLUE,
                boxShadow: "0 0 0 3px rgba(30,102,201,0.25)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: NAVY_TEXT,
              }}
            >
              Document processing
            </span>
          </div>

          {/* Headline — the one flow. Blue = what comes in, green = what goes out. */}
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(36px, 6vw, 64px)",
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.06,
              color: SURFACE,
              maxWidth: 800,
              margin: "0 0 22px",
              textWrap: "balance",
            }}
          >
            <span style={{ color: BLUE_BRIGHT }}>Your documents</span>, read, checked and sent{" "}
            <span style={{ color: GREEN_BRIGHT }}>in the format you need</span>.
          </h1>

          {/* Sub */}
          <p
            style={{
              fontSize: "clamp(15px, 1.6vw, 18px)",
              lineHeight: 1.6,
              color: NAVY_TEXT,
              maxWidth: 600,
              margin: "0 0 14px",
            }}
          >
            A document comes in. ProcuLink reads all of its data, checks it,
            turns it into the format you need and sends it on the channel you
            choose.
          </p>
          <p
            style={{
              fontSize: "clamp(14px, 1.4vw, 16px)",
              lineHeight: 1.6,
              color: NAVY_TEXT,
              maxWidth: 600,
              margin: "0 0 30px",
            }}
          >
            Purchase orders work today: start with the PDF, Excel or CSV order
            you already use and review the result before anything is sent.
            Invoices are in early access —{" "}
            <Link href="/pilot" style={{ color: SURFACE, textDecoration: "underline" }}>apply for the pilot</Link>.
          </p>

          {/* CTAs */}
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/sign-up"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                padding: "13px 26px",
                fontSize: 14,
                fontWeight: 600,
                background: BLUE,
                color: SURFACE,
                textDecoration: "none",
                boxShadow: "0 8px 24px rgba(30,102,201,0.32)",
              }}
            >
              Start your FREE Pilot →
            </Link>
            <Link
              href="/how-it-works"
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 8,
                padding: "13px 26px",
                fontSize: 14,
                fontWeight: 600,
                background: NAVY_SURFACE,
                color: SURFACE,
                textDecoration: "none",
                border: `1px solid ${NAVY_BORDER}`,
              }}
            >
              See how it works →
            </Link>
          </div>

          {/* Trust strip — the four things that make a first try low-risk. */}
          <ul
            className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 sm:max-w-[720px] xl:flex xl:max-w-none xl:flex-wrap"
            style={{ listStyle: "none", padding: 0, margin: "26px 0 0" }}
          >
            {TRUST_STRIP.map((item) => (
              <li
                key={item}
                className="flex items-start"
                style={{ gap: 8, fontSize: 13, lineHeight: 1.45, color: NAVY_TEXT }}
              >
                <span aria-hidden style={{ display: "inline-flex", color: GREEN_BRIGHT, marginTop: 1, flexShrink: 0 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>

          {/* Illustration — framed window panel */}
          <div
            style={{
              marginTop: 46,
              background: "linear-gradient(180deg, var(--navy-deep), var(--navy-deeper))",
              border: `1px solid ${NAVY_BORDER}`,
              borderRadius: 12,
              boxShadow: "0 40px 90px rgba(0,0,0,0.40)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Window chrome header */}
            <div
              className="flex items-center gap-2"
              style={{
                padding: "11px 14px",
                borderBottom: `1px solid ${NAVY_BORDER}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                {["var(--dot-red)", "var(--dot-amber)", "var(--dot-green)"].map((c) => (
                  <span
                    key={c}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: c,
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
              <span
                className="hidden sm:inline"
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11.5,
                  color: NAVY_MUTED,
                  marginLeft: 8,
                }}
              >
                live order flow
              </span>
              {/* Segmented view toggle */}
              <div
                className="ml-auto flex items-center"
                style={{
                  gap: 3,
                  padding: 3,
                  borderRadius: 6,
                  background: "var(--navy-well)",
                  border: `1px solid ${NAVY_BORDER}`,
                }}
              >
                {/* Segmented control, not a page action — so it is styled with
                    token CLASSES rather than an inline background. Active state
                    is white on --brand-blue (5.53:1); inactive is --navy-muted
                    on --navy-well (5.38:1). Both AA at 11px/600.

                    TAP TARGET (WP-31). WP-30 left these as "a layout decision,
                    not a token one" and recorded them at 22px. That number does
                    NOT reproduce: measured in Chromium they were 24.5px, because
                    `text-[11px]` sets font-size only and the inherited
                    line-height resolves to 16.5px, not the ~13.3px a hand
                    calculation from `line-height: normal` gives. So they already
                    cleared WCAG 2.2 SC 2.5.8's 24px floor — by half a pixel, which
                    any line-height change would erase. py-1 → py-[7px] takes them
                    to a measured 30.5px, real headroom over the floor, and costs
                    the hero chrome bar 6px. On touch the globals.css floor
                    (`@media (pointer: coarse)`) takes it the rest of the way to
                    44px — which is why there is deliberately NO `min-h-*` utility
                    here: a Tailwind class (specificity 0,1,0) would OUT-SPECIFY the
                    element-selector floor (0,0,1) and silently cap the mobile hit
                    area at the desktop size. Nothing in the hero chain declares a
                    height, so both sizes reflow rather than clip. */}
                <button
                  type="button"
                  aria-pressed={heroView === "topology"}
                  onClick={() => setHeroView("topology")}
                  className={[
                    "rounded-sm border-0 px-[11px] py-[7px] text-[11px] font-semibold",
                    heroView === "topology"
                      ? "bg-brand-blue text-surface"
                      : "bg-transparent text-navy-muted",
                  ].join(" ")}
                >
                  Order flow
                </button>
                <button
                  type="button"
                  aria-pressed={heroView === "canonical"}
                  onClick={() => setHeroView("canonical")}
                  className={[
                    "rounded-sm border-0 px-[11px] py-[7px] text-[11px] font-semibold",
                    heroView === "canonical"
                      ? "bg-brand-blue text-surface"
                      : "bg-transparent text-navy-muted",
                  ].join(" ")}
                >
                  Clean order
                </button>
              </div>
            </div>

            {/* Topology / canonical preview */}
            <div style={{ padding: "16px 14px 14px" }}>
              {heroView === "topology" ? <BridgeIllustration /> : <CanonicalPreview />}
            </div>
          </div>
        </div>
      </section>

      {/* ── Map once · Review first ─────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: BG, paddingTop: 76, paddingBottom: 76 }}>
        <div
          className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.15fr_1fr]"
          style={{ maxWidth: 1180, margin: "0 auto" }}
        >
          {/* The pairing of a buyer code with a supplier code IS the relationship
              between the two sides, so this card takes the bridge edge. */}
          <Card edge="bridge" as="article" aria-labelledby="map-once-title">
            <div className="p-2 sm:p-4">
              <Eyebrow>Example: purchase orders</Eyebrow>
              <h2 id="map-once-title" style={sectionTitle}>
                Map once. Reuse next time.
              </h2>
              <p style={bodyCopy}>
                The first order teaches ProcuLink how your codes relate to your
                supplier&apos;s. Confirm the matches that need your attention and
                those mappings can be reused the next time you order from the
                same supplier.
              </p>
              <p style={bodyCopy}>
                That is where repeated orders become easier: less code lookup,
                fewer manual touches and more orders that can reach
                supplier-ready output without intervention.
              </p>
              <MappingExample />
            </div>
          </Card>

          <Card as="article" aria-labelledby="review-first-title">
            <div className="p-2 sm:p-4">
              <Eyebrow>Safe start</Eyebrow>
              <h2 id="review-first-title" style={sectionTitle}>
                Review first. Automate later.
              </h2>
              <p style={bodyCopy}>
                You do not have to let ProcuLink send anything while you are
                testing it. Upload a real, test or anonymised order, review the
                mapped result, download the supplier-ready output and send it
                yourself as you do today.
              </p>
              <p style={bodyCopy}>
                When you trust the workflow, you can choose to let ProcuLink
                deliver routine orders to that supplier automatically. An order
                with an unresolved item code or a failed check is still held for
                you to review.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "grid", gap: 12 }}>
                {[
                  { icon: "eye", text: "Every order waits for you until you choose otherwise" },
                  { icon: "check-circle", text: "Built-in checks run before anything can be sent" },
                  { icon: "repeat", text: "Confirmed matches carry over to your next order from that supplier" },
                ].map((row) => (
                  <li key={row.text} className="flex items-start" style={{ gap: 12, fontSize: 13.5, lineHeight: 1.5, color: INK }}>
                    <span
                      aria-hidden
                      className="inline-flex shrink-0 items-center justify-center"
                      style={{ width: 32, height: 32, borderRadius: 8, background: SURFACE_2 }}
                    >
                      <Icon name={row.icon} color={BLUE_DEEP} />
                    </span>
                    <span style={{ paddingTop: 6 }}>{row.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </section>

      {/* ── How it works — homepage version ────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: SURFACE, paddingTop: 80, paddingBottom: 80 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
            <Eyebrow>How it works</Eyebrow>
            <h2 style={{ ...sectionTitle, textAlign: "center" }}>Purchase orders: one supplier is enough to start</h2>
          </div>
          <ol
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            style={{ gap: 18, listStyle: "none", padding: 0, margin: 0 }}
          >
            {HOME_STEPS.map((step, i) => (
              <li key={step.title} style={{ display: "flex" }}>
                <Card style={{ width: "100%" }}>
                  <div className="p-1 sm:p-2">
                    <span
                      aria-hidden
                      className="inline-flex items-center justify-center"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: BLUE_SOFT,
                        color: BLUE_DEEP,
                        fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                        fontSize: 15,
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </span>
                    <h3
                      style={{
                        fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                        fontSize: 17,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.25,
                        color: INK,
                        margin: "14px 0 8px",
                      }}
                    >
                      <span className="sr-only">Step {i + 1}: </span>
                      {step.title}
                    </h3>
                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: INK_MUTED, margin: 0 }}>{step.body}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
          <div style={{ textAlign: "center", marginTop: 26 }}>
            <Link
              href="/how-it-works"
              className="inline-flex min-h-[44px] items-center"
              style={{ fontSize: 14, fontWeight: 600, color: BLUE_DEEP, textDecoration: "none" }}
            >
              See the full workflow →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Who it is for ──────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: BG, paddingTop: 80, paddingBottom: 80 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 44px" }}>
            <Eyebrow>Who it is for</Eyebrow>
            <h2 style={{ ...sectionTitle, textAlign: "center" }}>
              Anyone who handles the same kind of document by hand, again and again
            </h2>
            <p style={{ ...bodyCopy, fontSize: 16, textAlign: "center" }}>
              It fits whatever the document and whatever trade you are in. It is
              built for the person who retypes or reformats those documents today: a
              buyer, someone in purchasing or logistics, a bookkeeper, an
              operations lead, or the owner of a smaller business.
            </p>
          </div>
          <p
            id="who-examples-label"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: INK_MUTED,
              textAlign: "center",
              margin: "0 0 16px",
            }}
          >
            For example
          </p>
          <ul
            aria-labelledby="who-examples-label"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            style={{ gap: 18, listStyle: "none", padding: 0, margin: 0 }}
          >
            {WHO_IT_IS_FOR_EXAMPLES.map((row) => (
              <li key={row.who} style={{ display: "flex" }}>
                <Card style={{ width: "100%" }}>
                  <div className="p-1 sm:p-2">
                    <h3
                      style={{
                        fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                        fontSize: 16.5,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.3,
                        color: INK,
                        margin: "0 0 8px",
                      }}
                    >
                      {row.who}
                    </h3>
                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: INK_MUTED, margin: 0 }}>{row.problem}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Supported pilot invitation ─────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: SURFACE, paddingTop: 80, paddingBottom: 80 }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <Card as="article" aria-labelledby="supported-pilot-title">
            <div className="p-2 sm:p-6">
              <Eyebrow>Supported pilot</Eyebrow>
              <h2 id="supported-pilot-title" style={sectionTitle}>
                Could one of your repeat suppliers be a good test case?
              </h2>
              <p style={bodyCopy}>
                A small number of companies can take part in a FREE supported
                pilot before wider rollout.
              </p>
              <p style={bodyCopy}>
                If your team repeatedly looks up supplier item codes, changes the
                same type of order or corrects the same supplier-specific
                details, one repeat supplier may be enough to test whether
                ProcuLink helps.
              </p>
              <p style={bodyCopy}>
                The supported pilot can run for roughly 60–90 days so there is
                enough repeat usage to measure the difference. Start in
                review-first mode and compare the same workflow against your
                current process.
              </p>
              <p style={bodyCopy}>
                If the pilot works and you are comfortable becoming a named
                client reference, we can discuss heavily discounted ongoing
                access. Any published wording and figures remain subject to your
                approval.
              </p>
              <p style={bodyCopy}>
                Invoices are in early access. If your team retypes supplier
                invoices, you can apply for an invoice pilot too.
              </p>
              <div style={{ marginTop: 24 }}>
                <Link
                  href="/pilot"
                  className="inline-flex min-h-[44px] items-center"
                  style={{
                    gap: 8,
                    borderRadius: 8,
                    padding: "12px 24px",
                    fontSize: 14,
                    fontWeight: 600,
                    background: BLUE,
                    color: SURFACE,
                    textDecoration: "none",
                  }}
                >
                  Apply for a FREE supported pilot →
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: BG, paddingTop: "84px", paddingBottom: "84px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 48px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 26,
              padding: "0 12px",
              borderRadius: 13,
              background: BLUE_SOFT,
              fontSize: 11,
              fontWeight: 700,
              color: BLUE_DEEP,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            Under the hood
          </div>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(28px, 3.6vw, 40px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              color: INK,
              margin: 0,
              textWrap: "balance",
            }}
          >
            Formats, checks and delivery, when you need them
          </h2>
          <p style={{ fontSize: 16, color: INK_MUTED, lineHeight: 1.6, marginTop: 14 }}>
            Every document goes through the same flow: read, check, transform, send. For purchase
            orders today, that means many input file types, checks before anything goes, and the
            channel each supplier uses — without an integration project.
          </p>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ gap: 18 }}
        >
          {FEATURES.map((f, i) => (
            <Card key={i} pad={24} radius={10}>
              {/* Top accent edge — gradient deck for the delivery card, solid otherwise */}
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: f.topGradient
                    ? "var(--gradient-link-spine)"
                    : f.color,
                }}
              />
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: f.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Icon name={f.icon} color={f.color} />
              </div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 17,
                  fontWeight: 600,
                  color: INK,
                  margin: "0 0 8px",
                  letterSpacing: "-0.01em",
                }}
              >
                {f.title}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: INK_MUTED, margin: 0 }}>
                {f.desc}
              </p>
            </Card>
          ))}
        </div>
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <section
        style={{
          background: SURFACE_2,
          borderTop: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          className="grid w-full grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0"
          style={{ maxWidth: 1180, textAlign: "center" }}
        >
          {STATS.map((s, i) => {
            const inner = (
              <>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 30,
                    fontWeight: 600,
                    letterSpacing: "-0.03em",
                    color: INK,
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                </div>
                <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>
                  {s.label}
                </div>
              </>
            );
            return s.href ? (
              <Link
                key={i}
                href={s.href}
                style={{ display: "block", padding: "26px 24px", textDecoration: "none" }}
              >
                {inner}
              </Link>
            ) : (
              <div key={i} style={{ padding: "26px 24px" }}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Logo strip ─────────────────────────────────────────────── */}
      <section className="px-4 sm:px-8" style={{ background: SURFACE, paddingTop: 48, paddingBottom: 48 }}>
        <p style={{ textAlign: "center", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: INK_MUTED, marginBottom: 26 }}>
          Reads the order files you already have, and writes the formats suppliers use
        </p>
        {/* No opacity:0.8 — it blended the --ink-faint mono labels down to ~3.3:1
            (WCAG fail). At full opacity the darkened --ink-faint token passes AA;
            the labels are still visually "faint" via the token itself. */}
        <div className="flex flex-wrap items-center justify-center gap-x-[38px] gap-y-4" style={{ maxWidth: 1180, margin: "0 auto" }}>
          {[...FORMAT_STRIP.emitted, ...FORMAT_STRIP.inboundOnly].map((name) => (
            <span key={name} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600, color: INK_FAINT, letterSpacing: "0.02em" }}>
              {name}
            </span>
          ))}
        </div>
        {FORMAT_STRIP.inboundOnly.length > 0 && (
          <p style={{ textAlign: "center", fontSize: 12.5, color: INK_MUTED, marginTop: 16, maxWidth: 640, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
            {FORMAT_STRIP.inboundOnly.join(", ")} are read, not emitted — ProcuLink parses them
            inbound and delivers to your supplier in one of the formats it produces.
          </p>
        )}
        <div style={{ textAlign: "center", marginTop: 22 }}>
          <Link
            href="/formats"
            className="inline-flex min-h-[44px] items-center"
            style={{ fontSize: 13, fontWeight: 600, color: BLUE_DEEP, textDecoration: "none" }}
          >
            See every format and method, honestly tagged →
          </Link>
        </div>
      </section>

      {/* ── Testimonial (dark band) ─────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: NAVY,
          paddingTop: 72,
          paddingBottom: 72,
          textAlign: "center",
        }}
      >
        <figure style={{ maxWidth: 920, margin: "0 auto" }}>
          {/* Brand mark above the quote (green tint on navy) */}
          <span
            style={{ display: "inline-flex", color: GREEN_BRIGHT, marginBottom: 22 }}
          >
            <ProcuLinkMark size={34} mono />
          </span>
          <blockquote
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 500,
              lineHeight: 1.32,
              letterSpacing: "-0.02em",
              color: SURFACE,
              margin: 0,
              textWrap: "balance",
            }}
          >
            Stop retyping documents.{" "}
            <span style={{ color: GREEN_BRIGHT }}>
              ProcuLink reads them, checks them and sends them on
            </span>{" "}
            in the format you need.
          </blockquote>

          {/* No fabricated customer attribution — the value statement stands on its own
              until we have a real, consented quote. */}

          {/* Stat chips */}
          <div
            className="mx-auto mt-11 grid grid-cols-1 sm:grid-cols-3 overflow-hidden"
            style={{
              maxWidth: 680,
              gap: 1,
              borderRadius: 10,
              border: `1px solid ${NAVY_BORDER}`,
              background: NAVY_BORDER,
            }}
          >
            {[
              { value: "Any format", label: "PDF · CSV · Excel · XML · cXML · EDI, in", green: false },
              // "out" makes this an OUTPUT claim, and cXML output is the one gated format.
              { value: "Supplier-ready", label: `CSV · XML · UBL · X12 · JSON, out — cXML on ${requiresPlan("cxml")}`, green: true },
              { value: "Fully audited", label: "every step logged, proof of delivery", green: false },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  background: NAVY_SURFACE,
                  padding: "22px 16px",
                }}
              >
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 19,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: m.green ? GREEN_BRIGHT : SURFACE,
                    lineHeight: 1.15,
                  }}
                >
                  {m.value}
                </div>
                <div style={{ fontSize: 12, color: NAVY_MUTED, marginTop: 4 }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </figure>
      </section>

      {/* ── ROI calculator ──────────────────────────────────────────── */}
      <ROICalculator />

      {/* ── CTA band ───────────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{
          background: NAVY,
          paddingTop: "84px",
          paddingBottom: "84px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(28px, 3.6vw, 40px)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            color: SURFACE,
            margin: 0,
          }}
        >
          Start with one document.
        </h2>
        <p style={{ fontSize: 16, color: NAVY_TEXT, margin: "14px auto 0", maxWidth: 520, lineHeight: 1.6 }}>
          {PILOT_OFFER_LINE} Review the result before anything is sent.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
          <Link
            href="/sign-up"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 8,
              padding: "13px 26px",
              fontSize: 14,
              fontWeight: 600,
              background: BLUE,
              color: SURFACE,
              textDecoration: "none",
              boxShadow: "0 8px 24px rgba(30,102,201,0.32)",
            }}
          >
            Start your FREE Pilot →
          </Link>
          <Link
            href="/pricing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 8,
              padding: "13px 26px",
              fontSize: 14,
              fontWeight: 600,
              background: "transparent",
              color: SURFACE,
              textDecoration: "none",
              border: `1px solid ${NAVY_BORDER}`,
            }}
          >
            See pricing
          </Link>
        </div>
      </section>

      </main>

      {/* Multi-column navy footer */}
      <footer style={{ background: NAVY, color: NAVY_FAINT }}>
        <div className="mx-auto max-w-[1100px] px-6 sm:px-8" style={{ padding: "48px 24px 0" }}>
          <div className="grid gap-10 grid-cols-2 sm:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5" style={{ textDecoration: "none" }}>
                <ProcuLinkMark size={24} mono />
                <span style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: SURFACE, fontWeight: 700, fontSize: 17 }}>ProcuLink</span>
              </Link>
              <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 300, marginTop: 14 }}>
                The missing link between buyers and suppliers. ProcuLink reads your documents, checks
                them and sends them on in the format you need — with a full audit trail on every order.
              </p>
            </div>
            {[
              { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["Open the dashboard", "/documents"]] },
              // "Customers" → "Pilot programme": /customers is being replaced by /pilot, which
              // carries the supported-pilot offer this page now links to twice.
              { h: "Company", links: [["Pilot programme", "/pilot"], ["Changelog", "/changelog"], ["Support", "/support"]] },
              { h: "Legal",   links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["AUP", "/aup"], ["DPA", "/dpa"], ["Subprocessors", "/subprocessors"]] },
            ].map((col) => (
              <div key={col.h}>
                <h3 style={{ color: SURFACE, fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</h3>
                {/* ≥44px-tall flex rows so each footer link is a full touch target
                    (WCAG 2.5.8); row height replaces the container gap. */}
                <div className="flex flex-col">
                  {col.links.map(([label, href]) => (
                    <a key={label} href={href} className="flex items-center min-h-[44px]" style={{ color: NAVY_FAINT, fontSize: 13, textDecoration: "none" }}>{label}</a>
                  ))}
                  {col.h === "Company" && process.env.NEXT_PUBLIC_STATUS_URL && (
                    <a href={process.env.NEXT_PUBLIC_STATUS_URL} target="_blank" rel="noopener noreferrer" className="flex items-center min-h-[44px]" style={{ color: NAVY_FAINT, fontSize: 13, textDecoration: "none" }}>Status</a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-12" style={{ borderTop: "1px solid var(--navy-line)", padding: "18px 0 28px", fontSize: 12 }}>
            <span>{COPYRIGHT_NOTICE}</span>
            <span className="flex items-center gap-3"><Link href="/security" style={{ color: "inherit", textDecoration: "none" }}>EU-region order storage</Link><span>·</span><span>AES-GCM at rest</span></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CanonicalPreview() {
  const rows = [
    ["PO number", "PO-2026-008412", "OrderRequest/OrderID"],
    ["Buyer", "Northwind Trading", "BillTo/Contact"],
    ["Supplier", "ElectroSupply Co", "ShipFrom/Contact"],
    ["Currency", "EUR", "Total/Currency"],
    ["Lines", "14 items", "ItemOut[]"],
  ];

  return (
    <div
      className="grid gap-3 md:grid-cols-[1fr_1.08fr_1fr]"
      style={{ minHeight: 300, color: NAVY_TEXT }}
    >
      <HeroPane title="Source · what arrived" accent={BLUE_BRIGHT}>
        <div style={{ border: `1px solid ${NAVY_BORDER}`, borderRadius: 8, overflow: "hidden", background: "var(--navy-inset)" }}>
          {["HEADER ZONE", "PARTIES ZONE", "LINES ZONE", "TOTALS ZONE"].map((zone, idx) => (
            <div key={zone} style={{ padding: "12px 14px", borderTop: idx ? `1px solid ${NAVY_BORDER}` : "none" }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: idx === 2 ? AMBER_BRIGHT : BLUE_BRIGHT, fontWeight: 700 }}>
                {zone}
              </div>
              <div style={{ marginTop: 5, height: idx === 2 ? 58 : 22, borderRadius: 5, background: "rgba(255,255,255,0.06)" }} />
            </div>
          ))}
        </div>
      </HeroPane>
      <HeroPane title="Clean order" accent={SURFACE}>
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 12px", borderRadius: 7, background: "var(--navy-raised)", border: `1px solid ${NAVY_BORDER}` }}>
              <span style={{ fontSize: 11, color: NAVY_MUTED }}>{label}</span>
              <span style={{ fontSize: 12.5, color: SURFACE, fontWeight: 600, textAlign: "right" }}>{value}</span>
            </div>
          ))}
        </div>
      </HeroPane>
      <HeroPane title="Output · what we send" accent={GREEN_BRIGHT}>
        <pre
          style={{
            margin: 0,
            minHeight: 244,
            whiteSpace: "pre-wrap",
            borderRadius: 8,
            border: `1px solid ${NAVY_BORDER}`,
            background: "var(--navy-code)",
            color: "var(--brand-green-pale)",
            padding: 14,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            lineHeight: 1.55,
          }}
        >{`<OrderRequest>
  <OrderID>PO-2026-008412</OrderID>
  <Currency>EUR</Currency>
  <ItemOut quantity="24">
    <SupplierPartID>ACM-PLT-200</SupplierPartID>
  </ItemOut>
</OrderRequest>`}</pre>
      </HeroPane>
    </div>
  );
}

// ─── Section primitives (item-code wedge sections) ────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
  fontSize: "clamp(26px, 3.4vw, 36px)",
  fontWeight: 600,
  letterSpacing: "-0.03em",
  lineHeight: 1.12,
  color: INK,
  margin: "14px 0 0",
  textWrap: "balance",
};

const bodyCopy: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  color: INK_MUTED,
  margin: "14px 0 0",
};

/** Small uppercase label above a section title. A pill fill with no border, so it is a
 *  label and not a card surface. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 26,
        padding: "0 12px",
        borderRadius: 13,
        background: BLUE_SOFT,
        fontSize: 11,
        fontWeight: 700,
        color: BLUE_DEEP,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/**
 * The pairing the whole page is about, drawn as a diagram rather than a screenshot: it
 * shows WHAT ProcuLink keeps (your code ↔ the supplier's code, per supplier) and WHEN it is
 * used. It deliberately does not mimic the review screen, which does not label a code as
 * carried over from an earlier order.
 */
function MappingExample() {
  return (
    <figure style={{ margin: "24px 0 0" }}>
      <div
        role="table"
        aria-label="Example item-code matches saved for one supplier"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        <div
          role="row"
          className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center"
          style={{ gap: 10, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}
        >
          <span role="columnheader" className="flex items-center" style={{ gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: BLUE_DEEP }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: BLUE, display: "inline-block", flexShrink: 0 }} />
            Your item code
          </span>
          <span aria-hidden />
          <span role="columnheader" className="flex items-center" style={{ gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: GREEN_DEEP }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block", flexShrink: 0 }} />
            Supplier&apos;s code
          </span>
        </div>
        {MAPPING_EXAMPLE.map((row) => (
          <div
            key={row.yours}
            role="row"
            className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center"
            style={{ gap: 10, padding: "11px 0", borderBottom: `1px solid ${BORDER}` }}
          >
            <span role="cell" style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, fontWeight: 600, color: INK, overflowWrap: "anywhere" }}>
                {row.yours}
              </span>
              <span style={{ display: "block", fontSize: 12, color: INK_MUTED, marginTop: 2 }}>{row.item}</span>
            </span>
            <span aria-hidden style={{ color: INK_FAINT, fontSize: 15, textAlign: "center" }}>→</span>
            <span role="cell" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, fontWeight: 600, color: GREEN_DEEP, overflowWrap: "anywhere" }}>
              {row.theirs}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12, marginTop: 16 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: INK_MUTED }}>
          <strong style={{ display: "block", color: INK, fontWeight: 600 }}>First order to this supplier</strong>
          You confirm any match ProcuLink does not already know.
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: INK_MUTED }}>
          <strong style={{ display: "block", color: INK, fontWeight: 600 }}>Next order to the same supplier</strong>
          Saved matches are applied automatically. You review the result as before.
        </div>
      </div>
      <figcaption style={{ fontSize: 11.5, color: INK_FAINT, marginTop: 12 }}>
        Illustrative codes. Matches are saved per supplier.
      </figcaption>
    </figure>
  );
}

function HeroPane({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          marginBottom: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
