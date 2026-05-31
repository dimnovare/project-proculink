import { SignUp } from "@clerk/nextjs";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

/* ── Local helpers (auth pages only) ─────────────────────────────────────── */

const FEATURES = [
  "AI-assisted mapping with visible confidence",
  "Validate before anything reaches the supplier",
  "Orders out in minutes, fully audited",
];

function FeatureIcon({ kind }: { kind: "spark" | "check" | "clock" }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 14 14",
    fill: "none",
    stroke: "#9DB6E0",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "spark") {
    return (
      <svg {...common}>
        <path d="M7 1.5 8.6 5.4 12.5 7 8.6 8.6 7 12.5 5.4 8.6 1.5 7 5.4 5.4 7 1.5Z" />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="5.2" />
        <path d="M4.7 7.1 6.3 8.6 9.3 5.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M7 4.2V7l2 1.4" />
    </svg>
  );
}

function AuthBrandPanel() {
  const kinds: ("spark" | "check" | "clock")[] = ["spark", "check", "clock"];
  return (
    <aside
      className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:p-12"
      style={{ backgroundColor: "#0B1A2F", color: "#C5D2E4" }}
    >
      {/* faint blue accent glow, top-right — matches the near-flat navy of the design */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full opacity-[0.10] blur-3xl"
        style={{ background: "radial-gradient(circle, #2C5B9E 0%, transparent 70%)" }}
      />

      {/* Wordmark */}
      <div className="relative flex items-center gap-2.5 text-white">
        <ProcuLinkMark size={26} mono />
        <span className="text-[17px] font-semibold tracking-tight">ProcuLink</span>
      </div>

      {/* Bottom content */}
      <div className="relative">
        <h2
          className="max-w-[14ch] text-[34px] font-semibold leading-[1.16] tracking-tight text-white"
          style={{ fontFamily: '"Bricolage Grotesque", "Inter", system-ui, sans-serif' }}
        >
          The missing link between{" "}
          <span style={{ color: "#3E83E0" }}>buyers</span> and{" "}
          <span style={{ color: "#34CE6A" }}>suppliers</span>
          <span style={{ color: "#34CE6A" }}>.</span>
        </h2>

        <ul className="mt-9 space-y-[18px]">
          {FEATURES.map((line, i) => (
            <li key={line} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgba(110,140,190,0.10)",
                  border: "1px solid rgba(130,160,210,0.22)",
                }}
              >
                <FeatureIcon kind={kinds[i]} />
              </span>
              <span className="text-[14px] leading-snug text-[#AEBCD2]">{line}</span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[11.5px] tracking-wide text-[#6F809B]">
          EU data residency · AES-GCM at rest · SOC 2 Type II in progress
        </p>
      </div>
    </aside>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="grid min-h-screen grid-cols-1 lg:grid-cols-2"
      style={{ background: "#F6F7FA" }}
    >
      <AuthBrandPanel />
      <section
        className="flex min-h-screen flex-col items-center justify-center px-5 py-10 sm:px-8 lg:min-h-0 lg:px-10 lg:py-12"
        style={{ background: "#F6F7FA" }}
      >
        {/* Mobile-only wordmark — the brand panel is hidden below lg */}
        <div className="mb-8 flex w-full max-w-[380px] items-center gap-2.5 lg:hidden">
          <ProcuLinkMark size={24} />
          <span className="text-[16px] font-semibold tracking-tight text-[#0B1A2F]">
            ProcuLink
          </span>
        </div>
        <div className="w-full max-w-[380px]">{children}</div>
      </section>
    </main>
  );
}

/** Shared Clerk appearance — borderless form that blends into our panel. */
const clerkAppearance = {
  layout: {
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: true,
  },
  variables: {
    colorPrimary: "#1E66C9",
    colorText: "#0B1A2F",
    colorTextSecondary: "#5B6577",
    colorBackground: "#FFFFFF",
    colorInputText: "#0B1A2F",
    colorDanger: "#C53A3A",
    borderRadius: "10px",
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
    main: "gap-4",
    socialButtonsBlockButton:
      "h-11 border border-[#D8DEE9] bg-white text-[#0B1A2F] font-semibold rounded-[10px] hover:bg-[#F1F4F9] hover:border-[#C6CEDB] transition-colors shadow-none",
    socialButtonsBlockButtonText: "text-[14px] font-semibold text-[#0B1A2F]",
    socialButtonsBlockButtonArrow: "hidden",
    dividerRow: "my-1.5",
    dividerLine: "bg-[#E0E5EE]",
    dividerText: "text-[12px] text-[#8A93A5]",
    formFieldLabel: "text-[13px] font-medium text-[#374254]",
    formFieldInput:
      "h-11 rounded-[10px] border border-[#D8DEE9] bg-white px-3 text-[14px] text-[#0B1A2F] placeholder:text-[#9AA3B2] focus:border-[#1E66C9] focus:ring-2 focus:ring-[#DBE7FA] shadow-none transition-colors",
    formButtonPrimary:
      "h-11 rounded-[10px] bg-[#1E66C9] text-white text-[14px] font-semibold hover:bg-[#1A57AD] active:bg-[#174E9C] shadow-none normal-case transition-colors",
    formFieldAction: "text-[12px] font-medium text-[#1E66C9] hover:text-[#1A57AD]",
    identityPreviewEditButton: "text-[#1E66C9]",
    footer: "mt-3",
    footerAction: "justify-center",
    footerActionText: "text-[13px] text-[#5B6577]",
    footerActionLink: "text-[13px] font-semibold text-[#1E66C9] hover:text-[#1A57AD]",
    formResendCodeLink: "text-[#1E66C9]",
    otpCodeFieldInput: "border-[#D8DEE9] focus:border-[#1E66C9]",
    formFieldInputShowPasswordButton: "text-[#8A93A5] hover:text-[#5B6577]",
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
          className="text-[30px] font-semibold leading-tight tracking-tight text-[#0B1A2F]"
          style={{ fontFamily: '"Bricolage Grotesque", "Inter", system-ui, sans-serif' }}
        >
          Start for free
        </h1>
        <p className="mt-2 text-[14px] text-[#5B6577]">
          No credit card. 20 orders free for 14 days.
        </p>
      </div>

      <SignUp
        appearance={clerkAppearance}
        fallbackRedirectUrl="/bridge"
        signInFallbackRedirectUrl="/bridge"
      />
    </AuthShell>
  );
}
