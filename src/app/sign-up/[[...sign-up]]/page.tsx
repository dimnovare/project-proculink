import { SignUp } from "@clerk/nextjs";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

/* ── Local helpers (auth pages only) ──────────────────────────────────────────
   Pixel-ported from the design source AuthScreen (mkt-components.jsx) — exact
   tokens, colours, and spacing. Clerk drives the real form; the surrounding
   split layout + brand panel match the design.
   ──────────────────────────────────────────────────────────────────────────── */

const FEATURES: { kind: "zap" | "check" | "clock"; label: string }[] = [
  { kind: "zap", label: "AI-assisted mapping with visible confidence" },
  { kind: "check", label: "Validate before anything reaches the supplier" },
  { kind: "clock", label: "Orders out in minutes, fully audited" },
];

/** Lucide-style line icons, matching the design's Icon set (zap / checkCircle / clock). */
function FeatureIcon({ kind }: { kind: "zap" | "check" | "clock" }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#6BA5F0",
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

/** Left navy panel — value prop + trust line. Hidden below lg (design @media). */
function AuthBrandPanel() {
  return (
    <aside
      className="relative hidden flex-col overflow-hidden lg:flex"
      style={{ background: "var(--navy)", color: "#fff", padding: 48 }}
    >
      {/* Dual radial accent glow (blue top-left, green bottom-right) — design ::before */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 30% 20%, rgba(30,102,201,0.20), transparent 60%), radial-gradient(500px 360px at 80% 80%, rgba(46,142,58,0.16), transparent 60%)",
        }}
      />

      {/* Wordmark */}
      <a
        href="/"
        className="relative inline-flex items-center"
        style={{
          gap: 9,
          color: "#fff",
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
            color: "#fff",
            maxWidth: "14ch",
            margin: 0,
          }}
        >
          The missing link between{" "}
          <span style={{ color: "#6BA5F0" }}>buyers</span> and{" "}
          <span style={{ color: "#5FC06B" }}>suppliers</span>.
        </h2>

        <div
          style={{
            marginTop: 28,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex items-center"
              style={{ gap: 12, color: "var(--navy-text)", fontSize: 13.5 }}
            >
              <span
                aria-hidden
                className="flex shrink-0 items-center justify-center"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "var(--navy-surface)",
                }}
              >
                <FeatureIcon kind={f.kind} />
              </span>
              {f.label}
            </div>
          ))}
        </div>

        <div
          className="relative"
          style={{ marginTop: 32, color: "var(--navy-muted)", fontSize: 12 }}
        >
          EU data residency · AES-GCM at rest · Full audit trail
        </div>
      </div>
    </aside>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
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
      </section>
    </main>
  );
}

/** Shared Clerk appearance — borderless form styled to the design tokens. */
const clerkAppearance = {
  layout: {
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: true,
  },
  variables: {
    colorPrimary: "#1E66C9",
    colorText: "#0B1A2F",
    colorTextSecondary: "#56627A",
    colorBackground: "#FFFFFF",
    colorInputText: "#0B1A2F",
    colorDanger: "#C53A3A",
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
      "h-[42px] border border-[#C6CDDA] bg-white text-[#0B1A2F] font-medium rounded-[6px] hover:bg-[#EFF2F7] transition-colors shadow-none",
    socialButtonsBlockButtonText: "text-[14px] font-medium text-[#0B1A2F]",
    socialButtonsBlockButtonArrow: "hidden",
    // Divider → "or with email"
    dividerRow: "my-5",
    dividerLine: "bg-[#E2E6EE]",
    dividerText: "text-[11.5px] text-[color:var(--ink-faint)]",
    // Fields → .field-label + .input
    formFieldRow: "mb-3.5",
    formFieldLabel: "text-[11.5px] font-semibold text-[#56627A] mb-1.5",
    formFieldInput:
      "h-[42px] rounded-[6px] border border-[#C6CDDA] bg-white px-3 text-[14px] text-[#0B1A2F] placeholder:text-[color:var(--ink-faint)] focus:border-[#1E66C9] focus:ring-[3px] focus:ring-[rgba(30,102,201,0.12)] shadow-none transition-colors",
    // Primary CTA → .btn-blue
    formButtonPrimary:
      "h-11 rounded-[6px] bg-[#1E66C9] text-white text-[14px] font-medium hover:bg-[#0F4FA8] active:translate-y-[0.5px] shadow-none normal-case transition-colors mt-3",
    // "Forgot?" action link → a.link (brand-blue-deep)
    formFieldAction:
      "text-[11.5px] font-medium text-[#0F4FA8] hover:underline",
    identityPreviewEditButton: "text-[#0F4FA8]",
    footer: "mt-5",
    footerAction: "justify-center",
    footerActionText: "text-[13px] text-[#56627A]",
    footerActionLink: "text-[13px] font-medium text-[#0F4FA8] hover:underline",
    formResendCodeLink: "text-[#0F4FA8]",
    otpCodeFieldInput: "border-[#C6CDDA] focus:border-[#1E66C9]",
    formFieldInputShowPasswordButton: "text-[color:var(--ink-faint)] hover:text-[#56627A]",
  },
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Sign-up is not configured</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add the Clerk environment variables in Vercel to enable authentication.
        </p>
      </AuthShell>
    );
  }

  if (!process.env.CLERK_SECRET_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Server auth is not configured</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Add CLERK_SECRET_KEY in Vercel for Production and Preview, then redeploy.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
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
          Start for free
        </h1>
        <p
          style={{
            fontSize: 13.5,
            marginTop: 6,
            color: "var(--ink-muted)",
          }}
        >
          No credit card. 20 orders free for 14 days.
        </p>
      </div>

      <SignUp
        appearance={clerkAppearance}
        fallbackRedirectUrl="/onboarding/select-organization"
        signInFallbackRedirectUrl="/onboarding/select-organization"
      />
    </AuthShell>
  );
}
