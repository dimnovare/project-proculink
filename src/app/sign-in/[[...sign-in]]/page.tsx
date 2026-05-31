import { SignIn } from "@clerk/nextjs";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

/* ── Local helpers (auth pages only) ─────────────────────────────────────── */

function AuthBrandPanel() {
  return (
    <aside
      className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:p-12"
      style={{
        background:
          "radial-gradient(120% 120% at 0% 0%, #13294A 0%, #0B1A2F 55%, #081427 100%)",
        color: "#C5D2E4",
      }}
    >
      {/* faint accent glow, top-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "radial-gradient(circle, #28C55E 0%, transparent 70%)" }}
      />

      {/* Wordmark */}
      <div className="relative flex items-center gap-2.5 text-white">
        <ProcuLinkMark size={26} mono />
        <span className="text-[17px] font-semibold tracking-tight">ProcuLink</span>
      </div>

      {/* Bottom content */}
      <div className="relative">
        <h2
          className="max-w-[18ch] text-[34px] font-semibold leading-[1.12] tracking-tight text-white"
          style={{ fontFamily: '"Bricolage Grotesque", "Inter", system-ui, sans-serif' }}
        >
          The missing link between{" "}
          <span style={{ color: "#28C55E" }}>buyers</span> and{" "}
          <span style={{ color: "#28C55E" }}>suppliers</span>
          <span style={{ color: "#28C55E" }}>.</span>
        </h2>

        <ul className="mt-8 space-y-4">
          {[
            "AI-assisted mapping with visible confidence",
            "Validate before anything reaches the supplier",
            "Orders out in minutes, fully audited",
          ].map((line) => (
            <li key={line} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgba(40,197,94,0.14)",
                  border: "1px solid rgba(40,197,94,0.35)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2.5 6.2l2.2 2.3 4.8-5"
                    stroke="#28C55E"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="text-[14px] leading-snug text-[#C5D2E4]">{line}</span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[11.5px] tracking-wide text-[#7C8DA6]">
          EU data residency · AES-GCM at rest · SOC 2 Type II in progress
        </p>
      </div>
    </aside>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2" style={{ background: "#F6F7FA" }}>
      <AuthBrandPanel />
      <section
        className="flex items-center justify-center px-6 py-12 sm:px-10"
        style={{ background: "#F6F7FA" }}
      >
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
    colorPrimary: "#28C55E",
    colorText: "#0B1A2F",
    colorTextSecondary: "#56627A",
    colorBackground: "#FFFFFF",
    colorInputText: "#0B1A2F",
    colorDanger: "#C53A3A",
    borderRadius: "8px",
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
    main: "gap-5",
    socialButtonsBlockButton:
      "h-11 border border-[#D8DEE9] bg-white text-[#0B1A2F] font-semibold rounded-lg hover:bg-[#EEF1F5] transition-colors shadow-none",
    socialButtonsBlockButtonText: "text-[14px] font-semibold",
    dividerRow: "my-1",
    dividerLine: "bg-[#D8DEE9]",
    dividerText: "text-[12px] text-[#8A93A5]",
    formFieldLabel: "text-[13px] font-medium text-[#0B1A2F]",
    formFieldInput:
      "h-11 rounded-lg border border-[#D8DEE9] bg-white px-3 text-[14px] text-[#0B1A2F] focus:border-[#28C55E] focus:ring-2 focus:ring-[#DCFCE7] shadow-none",
    formButtonPrimary:
      "h-11 rounded-lg bg-[#28C55E] text-white text-[14px] font-semibold hover:bg-[#1DAF50] active:bg-[#1DAF50] shadow-none normal-case transition-colors",
    formFieldAction: "text-[12px] font-medium text-[#1DAF50] hover:text-[#1DAF50]",
    identityPreviewEditButton: "text-[#1DAF50]",
    footer: "mt-2",
    footerAction: "justify-center",
    footerActionText: "text-[13px] text-[#56627A]",
    footerActionLink: "text-[13px] font-semibold text-[#1DAF50] hover:text-[#1DAF50]",
    formResendCodeLink: "text-[#1DAF50]",
    otpCodeFieldInput: "border-[#D8DEE9] focus:border-[#28C55E]",
    formFieldInputShowPasswordButton: "text-[#8A93A5]",
  },
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold text-foreground">Sign-in is not configured</h1>
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
      <div className="mb-7">
        <h1
          className="text-[30px] font-semibold leading-tight tracking-tight text-[#0B1A2F]"
          style={{ fontFamily: '"Bricolage Grotesque", "Inter", system-ui, sans-serif' }}
        >
          Welcome back
        </h1>
        <p className="mt-2 text-[14px] text-[#56627A]">
          Sign in to your ProcuLink workspace.
        </p>
      </div>

      <SignIn
        appearance={clerkAppearance}
        fallbackRedirectUrl="/bridge"
        signUpFallbackRedirectUrl="/bridge"
      />
    </AuthShell>
  );
}
