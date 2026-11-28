/* ── The shared sign-in / sign-up surface ─────────────────────────────────────
 *
 * WHY THIS FILE EXISTS.
 *
 * /sign-in and /sign-up were two files holding 290 byte-identical lines with no
 * shared module between them. That is not a tidiness problem — it is why the two
 * pages had already drifted apart in a way a buyer could see:
 *
 *   /sign-in carried  `lastAuthenticationStrategyBadge: "hidden"`, with a comment
 *   recording that Clerk's unstyled "Last used" badge overhangs the button's
 *   top-right corner as a clipped notch and "reads as a glitch".
 *
 *   /sign-up did not. So the fix landed on the page a returning user sees and
 *   missed the page a brand-new buyer lands on from every marketing call to
 *   action — the first screen of the product, showing the defect.
 *
 * Copying the one key across would have fixed the instance and left the cause.
 * The appearance object, the brand panel and the shell now have exactly one
 * definition, so the next appearance fix cannot land on one page only.
 *
 * WHAT LEGITIMATELY DIFFERS between the two routes, and therefore stays as props
 * on the pages rather than moving here: the Clerk component itself, the heading
 * and its sub-line, the redirect targets, and the not-configured copy. Nothing
 * else did differ, and nothing else should.
 *
 * COLOUR. Everything here reads a design token except `clerkAppearance.variables`
 * — see the note on that object.
 * ──────────────────────────────────────────────────────────────────────────── */

import Link from "next/link";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { CsvFile } from "@/components/marketing/sitePictures";
import { SITE_TAGLINE } from "@/lib/seo";

type FeatureKind = "file" | "check" | "clock";
type Tone = "onNavy" | "onLight";

/* The three value claims, shown on the desktop brand panel AND the mobile stack.
   Exported so a test can read them off this module instead of retyping them.

   The first sign-up a buyer makes is a decision about risk, not throughput, so the
   claims answer the three questions that decide it: will my own files work, will
   anything be sent without me, and will I have a record. Each one is true on every
   plan, the trial included. */
export const AUTH_VALUE_CLAIMS: { kind: FeatureKind; label: string }[] = [
  { kind: "file", label: "Use the documents you already get" },
  { kind: "check", label: "Check anything we're unsure of before it's sent" },
  { kind: "clock", label: "Keep a complete history of every document" },
];

/** The qualified storage line, shown on both the desktop panel and the mobile stack. */
function TrustLine({ tone }: { tone: Tone }) {
  return (
    <p className={`m-0 text-[13px] ${tone === "onNavy" ? "text-navy-muted" : "text-ink-faint"}`}>
      {/* Same qualified line as the marketing footers, and linked for the same
          reason: "EU data residency" on its own promises more than the stack
          delivers (sign-in, AI extraction, payments and email all run on named US
          subprocessors). Storage is the part that is true, and /security carries
          the rest of the answer. */}
      <Link href="/security" className="text-inherit underline underline-offset-2">
        EU-region document storage
      </Link>
      , AES-GCM at rest.
    </p>
  );
}

/** Lucide-style line icons (file / checkCircle / clock), tinted by the parent. */
function FeatureIcon({ kind }: { kind: FeatureKind }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "file") {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg {...common}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function Claims({ tone }: { tone: Tone }) {
  return (
    <ul className={`m-0 flex list-none flex-col gap-3.5 p-0 text-[15px] ${tone === "onNavy" ? "text-navy-text" : "text-ink-muted"}`}>
      {AUTH_VALUE_CLAIMS.map((f) => (
        <li key={f.label} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex size-[30px] shrink-0 items-center justify-center rounded-lg text-brand-blue-bright ${tone === "onNavy" ? "bg-navy-surface" : "bg-surface-2"}`}
          >
            <FeatureIcon kind={f.kind} />
          </span>
          {f.label}
        </li>
      ))}
    </ul>
  );
}

/** Left navy panel: tagline, claims, an example of what comes out, the trust line.
 *  Desktop only; the claims and trust line are re-expressed under the form below lg
 *  by <AuthValueStack>. */
function AuthBrandPanel() {
  return (
    <aside className="hidden flex-col gap-10 bg-navy p-12 text-surface lg:flex">
      <Link href="/" className="inline-flex items-center gap-2.5 text-[17px] font-bold text-surface no-underline">
        <ProcuLinkMark size={24} mono />
        ProcuLink
      </Link>
      <div className="mt-auto flex max-w-[440px] flex-col gap-8">
        <h2 className="m-0 max-w-[14ch] font-display text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] text-surface">
          {SITE_TAGLINE}
        </h2>
        <Claims tone="onNavy" />
        <div aria-hidden="true" className="text-ink">
          <CsvFile />
        </div>
        <TrustLine tone="onNavy" />
      </div>
    </aside>
  );
}

/* The same three claims and the same trust line, for viewports where the navy
   panel does not render. It sits BELOW the form on purpose: above it, it would push
   the thing the user came to do off the first screen. */
function AuthValueStack() {
  return (
    <div className="mt-10 flex w-full max-w-[380px] flex-col gap-4 border-t border-border pt-6 lg:hidden">
      <Claims tone="onLight" />
      <TrustLine tone="onLight" />
    </div>
  );
}

/** The small lines under the Clerk form, and their links. */
export const AUTH_FOOT = "mt-5 text-[14px] leading-[1.5] text-ink-muted";
export const AUTH_LINK = "font-semibold text-brand-blue-deep underline underline-offset-2";

/** `variant` marks which page this is, so the shared Clerk appearance can colour the
 *  primary button per page (navy to sign in, green to start a trial) from ONE object. */
export function AuthShell({
  children,
  variant = "sign-in",
}: {
  children: React.ReactNode;
  variant?: "sign-in" | "sign-up";
}) {
  return (
    <main data-auth={variant} className="group min-h-screen bg-bg lg:grid lg:grid-cols-2">
      <AuthBrandPanel />
      <div className="flex min-h-screen flex-col">
        {/* Below lg the panel is hidden, so the brand rides a navy bar instead. */}
        <div className="lg:hidden">
          <div className="flex h-16 items-center gap-2.5 bg-navy px-6 text-[16px] font-semibold text-surface">
            <ProcuLinkMark size={24} mono />
            ProcuLink
          </div>
          <div aria-hidden="true" className="h-0.5 bg-link-spine" />
        </div>
        <section className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-8 lg:p-12">
          <div className="w-full max-w-[380px]">{children}</div>
          <AuthValueStack />
        </section>
      </div>
    </main>
  );
}

/** The page heading + sub-line. The only copy that
 *  legitimately differs per route. */
export function AuthHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p className="text-balance" style={{ fontSize: 13.5, marginTop: 6, color: "var(--ink-muted)" }}>{sub}</p>
    </div>
  );
}

/**
 * Shared Clerk appearance — borderless form styled to the design tokens.
 *
 * `variables` is the one place here that holds literal colour values, and it has
 * to: Clerk derives a whole scale from each one (hover, disabled, alpha overlays)
 * by parsing the string, so a `var(--token)` reference reaches it unresolved and
 * the derivation falls back to Clerk defaults. Everything Clerk lets us address
 * by class — every element below — reads a token instead.
 */
export const clerkAppearance = {
  layout: {
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: true,
  },
  variables: {
    colorPrimary: "#1E66C9",
    colorText: "#0B1A2F",
    colorTextSecondary: "#5E6779",
    colorBackground: "#FFFFFF",
    colorInputText: "#0B1A2F",
    colorDanger: "#B43838",
    borderRadius: "6px",
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: "14px",
  },
  elements: {
    rootBox: "w-full",
    // Clerk clips the card box (overflow: hidden). With the header hidden and no card
    // padding, that cut the focus ring off whatever touches its edge: the top of the
    // code boxes, the sides of every full-width field. The box draws nothing of its own.
    cardBox: "w-full shadow-none overflow-visible",
    card: "w-full bg-transparent shadow-none p-0 gap-0",
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    main: "gap-2",
    // Social buttons → .btn-secondary (white, border-strong, ink text)
    socialButtonsBlockButton:
      "h-[42px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--ink)] font-medium rounded-[6px] hover:bg-[color:var(--surface-2)] transition-colors shadow-none",
    socialButtonsBlockButtonText: "text-[14px] font-medium text-[color:var(--ink)]",
    socialButtonsBlockButtonArrow: "hidden",
    // Hide Clerk's unstyled "Last used" badge — it overhangs the button's top-right
    // corner as a clipped notch (no appearance styling), which reads as a glitch.
    // Defined ONCE, for both routes: it was the key that had already gone missing
    // from /sign-up while /sign-in carried it.
    lastAuthenticationStrategyBadge: "hidden",
    // Divider → "or with email"
    dividerRow: "my-5",
    dividerLine: "bg-[color:var(--border)]",
    dividerText: "text-[11.5px] text-[color:var(--ink-faint)]",
    // Fields → .field-label + .input
    formFieldRow: "mb-3.5",
    formFieldLabel: "text-[11.5px] font-semibold text-[color:var(--ink-muted)] mb-1.5",
    formFieldInput:
      "h-[42px] rounded-[6px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-[14px] text-[color:var(--ink)] placeholder:text-[color:var(--ink-faint)] focus:border-[color:var(--brand-blue)] focus:ring-[3px] focus:ring-[color:var(--brand-blue-soft)] shadow-none transition-colors",
    // Primary CTA: navy to sign in, green to start a trial. One object for both
    // pages; the page is told apart by the `data-auth` mark AuthShell sets.
    // Clerk's own ring and shadow sit at a higher specificity, so `!shadow-none`; no arrow glyph. The form's
    // 32px gap plus the last field's margin left a 58px band above the button: 10px gap + 14px margin = the
    // same 24px as between fields.
    form: "!gap-[10px]",
    formButtonPrimary:
      "h-12 rounded-[6px] bg-navy text-surface text-[16px] font-semibold hover:bg-navy-surface active:translate-y-[0.5px] !shadow-none normal-case transition-colors",
    buttonArrowIcon: "!hidden",
    // "Forgot?" action link → a.link (brand-blue-deep)
    formFieldAction: "text-[11.5px] font-medium text-[color:var(--brand-blue-deep)] hover:underline",
    identityPreviewEditButton: "text-[color:var(--brand-blue-deep)]",
    footer: "mt-5",
    // On phones the link is a 44px tap box; centring the row keeps "Sign up" on the question's line, not below it.
    footerAction: "flex items-center justify-center gap-1",
    footerActionText: "text-[13px] text-[color:var(--ink-muted)]",
    footerActionLink: "text-[13px] font-medium text-[color:var(--brand-blue-deep)] hover:underline",
    formResendCodeLink: "text-[color:var(--brand-blue-deep)]",
    otpCodeFieldInput: "border-[color:var(--border-strong)] focus:border-[color:var(--brand-blue)]",
    formFieldInputShowPasswordButton:
      "text-[color:var(--ink-faint)] hover:text-[color:var(--ink-muted)]",
  },
};
