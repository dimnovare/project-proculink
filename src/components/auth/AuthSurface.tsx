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

import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

const FEATURES: { kind: "zap" | "check" | "clock"; label: string }[] = [
  { kind: "zap", label: "AI-assisted mapping with visible confidence" },
  { kind: "check", label: "Validate before anything reaches the supplier" },
  { kind: "clock", label: "Orders out in minutes, fully audited" },
];

/** The qualified storage line, shown on both the desktop panel and the mobile stack. */
function TrustLine({ tone }: { tone: "onNavy" | "onLight" }) {
  return (
    <div
      className="relative"
      style={{ color: tone === "onNavy" ? "var(--navy-muted)" : "var(--ink-faint)", fontSize: 12 }}
    >
      {/* Same qualified line as the marketing footers, and linked for the same
          reason: "EU data residency" on its own promises more than the stack
          delivers (sign-in, AI extraction, payments and email all run on named US
          subprocessors). Storage is the part that is true, and /security carries
          the rest of the answer. */}
      <a href="/security" style={{ color: "inherit", textDecoration: "none" }}>
        EU-region order storage
      </a>
      {" · AES-GCM at rest · Full audit trail"}
    </div>
  );
}

/** Lucide-style line icons, matching the design's Icon set (zap / checkCircle / clock). */
function FeatureIcon({ kind }: { kind: "zap" | "check" | "clock" }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    // `currentColor` rather than a literal: the tint is set by the parent, which
    // reads --brand-blue-bright. The value used to be inlined here, which is how
    // a token that already existed for this exact job went unused.
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "zap") {
    return (
      <svg {...common}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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

function FeatureRow({
  kind,
  label,
  tone,
}: {
  kind: "zap" | "check" | "clock";
  label: string;
  tone: "onNavy" | "onLight";
}) {
  return (
    <div
      className="flex items-center"
      style={{ gap: 12, color: tone === "onNavy" ? "var(--navy-text)" : "var(--ink-muted)", fontSize: 13.5 }}
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: tone === "onNavy" ? "var(--navy-surface)" : "var(--surface-2)",
          color: "var(--brand-blue-bright)",
        }}
      >
        <FeatureIcon kind={kind} />
      </span>
      {label}
    </div>
  );
}

/** Left navy panel — value prop + trust line. Desktop only; the same content is
 *  re-expressed under the form below lg by <AuthValueStack>. */
function AuthBrandPanel() {
  return (
    <aside
      className="relative hidden flex-col overflow-hidden lg:flex"
      style={{ background: "var(--navy)", color: "var(--surface)", padding: 48 }}
    >
      {/* Dual radial accent glow — the navy-family tokens the marketing hero
          already draws its glow from. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 30% 20%, var(--navy-glow), transparent 60%), radial-gradient(500px 360px at 80% 80%, var(--navy-raised), transparent 60%)",
        }}
      />

      {/* Wordmark */}
      <a
        href="/"
        className="relative inline-flex items-center"
        style={{
          gap: 9,
          color: "var(--surface)",
          fontWeight: 700,
          fontSize: 17,
          textDecoration: "none",
        }}
      >
        <ProcuLinkMark size={24} mono />
        ProcuLink
      </a>

      {/* Bottom content */}
      <div className="relative" style={{ marginTop: "auto" }}>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            color: "var(--surface)",
            maxWidth: "14ch",
            margin: 0,
          }}
        >
          The missing link between{" "}
          <span style={{ color: "var(--brand-blue-bright)" }}>buyers</span> and{" "}
          <span style={{ color: "var(--brand-green-bright)" }}>suppliers</span>.
        </h2>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          {FEATURES.map((f) => (
            <FeatureRow key={f.label} kind={f.kind} label={f.label} tone="onNavy" />
          ))}
        </div>

        <div style={{ marginTop: 32 }}>
          <TrustLine tone="onNavy" />
        </div>
      </div>
    </aside>
  );
}

/* The same three claims and the same trust line, for viewports where the navy
   panel does not render.

   Below lg the panel is `hidden`, and it used to take the headline, all three
   feature rows and the storage/audit line with it — so a buyer signing up on a
   phone got a bare form and no statement of what the product does or where their
   orders are held. That is the device most first taps arrive on.

   It sits BELOW the form on purpose. Moving it above would push the thing the
   user came to do off the first screen, which trades one defect for a worse one. */
function AuthValueStack() {
  return (
    <div className="mt-10 w-full max-w-[380px] lg:hidden">
      <div
        style={{ borderTop: "1px solid var(--border)", paddingTop: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        {FEATURES.map((f) => (
          <FeatureRow key={f.label} kind={f.kind} label={f.label} tone="onLight" />
        ))}
        <div style={{ marginTop: 6 }}>
          <TrustLine tone="onLight" />
        </div>
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="grid min-h-screen grid-cols-1 lg:grid-cols-2"
      style={{ background: "var(--bg)" }}
    >
      <AuthBrandPanel />
      {/* .auth-main — center the form vertically + horizontally, 48px pad on desktop */}
      <section className="flex min-h-screen flex-col items-center justify-center px-6 py-12 sm:px-8 lg:p-12">
        {/* Mobile-only wordmark — the brand panel is hidden below lg */}
        <div className="mb-8 flex w-full max-w-[380px] items-center gap-2.5 lg:hidden">
          <ProcuLinkMark size={24} />
          <span
            className="text-[16px] font-semibold tracking-tight"
            style={{ color: "var(--ink)" }}
          >
            ProcuLink
          </span>
        </div>
        {/* .auth-form — max-width 380 */}
        <div className="w-full max-w-[380px]">{children}</div>
        <AuthValueStack />
      </section>
    </main>
  );
}

/** The page heading + sub-line. The only copy that legitimately differs per route. */
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
      <p style={{ fontSize: 13.5, marginTop: 6, color: "var(--ink-muted)" }}>{sub}</p>
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
    cardBox: "w-full shadow-none",
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
    // Primary CTA → .btn-blue
    formButtonPrimary:
      "h-11 rounded-[6px] bg-[color:var(--brand-blue)] text-[color:var(--surface)] text-[14px] font-medium hover:bg-[color:var(--brand-blue-deep)] active:translate-y-[0.5px] shadow-none normal-case transition-colors mt-3",
    // "Forgot?" action link → a.link (brand-blue-deep)
    formFieldAction: "text-[11.5px] font-medium text-[color:var(--brand-blue-deep)] hover:underline",
    identityPreviewEditButton: "text-[color:var(--brand-blue-deep)]",
    footer: "mt-5",
    footerAction: "justify-center",
    footerActionText: "text-[13px] text-[color:var(--ink-muted)]",
    footerActionLink: "text-[13px] font-medium text-[color:var(--brand-blue-deep)] hover:underline",
    formResendCodeLink: "text-[color:var(--brand-blue-deep)]",
    otpCodeFieldInput: "border-[color:var(--border-strong)] focus:border-[color:var(--brand-blue)]",
    formFieldInputShowPasswordButton:
      "text-[color:var(--ink-faint)] hover:text-[color:var(--ink-muted)]",
  },
};
