"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
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
    title: "Per-supplier validation",
    desc: (
      <>
        Block bad orders before they reach the supplier. Configurable rules per
        supplier — missing fields, wrong currency, item codes that won&apos;t
        resolve.
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
    desc: `HTTP webhook, SFTP or email — or download the artifact. ERP connectors (Erply, Directo) on ${requiresPlan("erpConnectors")}. Encrypted credentials, AES-GCM at rest, full audit trail per attempt.`,
    color: BLUE_DEEP,
    bg: BLUE_SOFT,
    topGradient: true,
  },
  {
    icon: "layers",
    title: "Standards, on demand",
    desc: "Every order field maps to UBL, EDIFACT, X12, cXML and Peppol BIS paths — always visible, never hidden behind a mode. Built for 30-year procurement veterans.",
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
              B2B order automation
            </span>
          </div>

          {/* Headline — left aligned, plain procurement copy */}
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(40px, 6vw, 68px)",
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              color: SURFACE,
              maxWidth: 760,
              margin: "0 0 22px",
              textWrap: "balance",
            }}
          >
            Send every purchase order to{" "}
            <span style={{ color: BLUE_BRIGHT }}>any supplier</span>,{" "}
            <span style={{ color: GREEN_BRIGHT }}>any format</span>.
          </h1>

          {/* Sub */}
          <p
            style={{
              fontSize: "clamp(15px, 1.6vw, 18px)",
              lineHeight: 1.6,
              color: NAVY_TEXT,
              maxWidth: 560,
              margin: "0 0 30px",
            }}
          >
            Stop reformatting purchase orders by hand. Drop in an order in any
            format, and ProcuLink delivers it in exactly the format and channel
            each supplier needs — with a full audit trail behind every order.
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
              Start free →
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
                live order topology
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
                  Topology
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

      {/* ── Stats strip ────────────────────────────────────────────── */}
      <section
        style={{
          background: SURFACE_2,
          borderTop: `1px solid ${NAVY_BORDER}`,
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
          Reads and sends the formats your buyers and suppliers already use
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
            style={{ fontSize: 13, fontWeight: 600, color: BLUE_DEEP, textDecoration: "none" }}
          >
            See every format and method, honestly tagged →
          </Link>
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
            The workflow
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
            Everything you need to receive, transform, and deliver
          </h2>
          <p style={{ fontSize: 16, color: INK_MUTED, lineHeight: 1.6, marginTop: 14 }}>
            One workflow from inbound purchase order to delivered supplier document — built for procurement teams that don&apos;t want an integration project.
          </p>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ gap: 18 }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={i}
              style={{
                position: "relative",
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: 24,
                overflow: "hidden",
              }}
            >
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
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* ── Why ProcuLink ─────────────────────────────────────────── */}
      <section
        className="px-4 sm:px-8"
        style={{ background: SURFACE, paddingTop: "84px", paddingBottom: "84px" }}
      >
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
              Why ProcuLink
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
              Why procurement teams choose ProcuLink
            </h2>
            <p style={{ fontSize: 16, color: INK_MUTED, lineHeight: 1.6, marginTop: 14 }}>
              What ProcuLink changes for teams moving from manual reformatting to automated order delivery.
            </p>
          </div>
          <div
            className="grid grid-cols-1 gap-[18px] sm:grid-cols-3"
          >
            {[
              {
                stat: "Skip the manual reformatting",
                body: "Teams stop hand-converting orders for each supplier. ProcuLink maps your buyer PO to exactly what each supplier needs — automatically.",
                color: BLUE,
                icon: "link",
              },
              {
                stat: "Stop orders getting bounced",
                body: "Rejections for wrong item codes, missing fields, or bad formats cost hours of back-and-forth. ProcuLink validates before you send.",
                color: GREEN,
                icon: "check-circle",
              },
              {
                stat: "Orders out in minutes",
                body: "From uploaded PO to delivered supplier order in one workflow. No email chains, no spreadsheet wrestling, no copy-paste errors.",
                color: AMBER,
                icon: "clock",
              },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  position: "relative",
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: 24,
                  overflow: "hidden",
                }}
              >
                {/* Colored left edge */}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: item.color,
                  }}
                />
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: SURFACE_2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={item.icon} color={item.color} />
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                    fontSize: 16,
                    fontWeight: 600,
                    color: INK,
                    margin: "14px 0 8px",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.stat}
                </h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: INK_MUTED, margin: 0 }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
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
            Stop reformatting purchase orders.{" "}
            <span style={{ color: GREEN_BRIGHT }}>Start delivering them.</span>{" "}
            Any incoming order, sent out in exactly the format and channel each
            supplier needs.
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
          Ready to put your orders on autopilot?
        </h2>
        <p style={{ fontSize: 16, color: NAVY_TEXT, margin: "14px auto 0", maxWidth: 480, lineHeight: 1.6 }}>
          Start free. No credit card required.
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
            Get started free →
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
                The missing link between buyers and suppliers. Turn any purchase order into the exact
                format your supplier needs — with a full audit trail.
              </p>
            </div>
            {[
              { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["Open the dashboard", "/bridge"]] },
              { h: "Company", links: [["Customers", "/customers"], ["Changelog", "/changelog"], ["Support", "/support"]] },
              { h: "Legal",   links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["AUP", "/aup"], ["DPA", "/dpa"], ["Subprocessors", "/subprocessors"]] },
            ].map((col) => (
              <div key={col.h}>
                <h4 style={{ color: SURFACE, fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</h4>
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
