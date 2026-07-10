import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AnalyticsBoot } from "@/components/analytics/AnalyticsBoot";
import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import { ORGANIZATION_STRUCTURED_DATA } from "@/lib/legal-entity";
// Self-hosted fonts (OFL, via @fontsource) — replaces the render-blocking
// cross-origin Google Fonts stylesheet. Each package's @font-face registers
// under the exact literal family name ('Inter', 'JetBrains Mono',
// 'Bricolage Grotesque') with font-display: swap, so every literal
// `fontFamily: "'Bricolage Grotesque'…"` reference keeps resolving to the real
// face. Only the weights in use are imported. Files load from same-origin
// /_next/static — no cross-origin round-trip on the FCP path.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/bricolage-grotesque/500.css";
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0B1A2F",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://proculink.eu"),
  title: "ProcuLink — Connecting Procurement",
  description:
    "Stop reformatting purchase orders by hand. ProcuLink turns any incoming order into the exact format and channel each supplier needs — with a full audit trail behind every order.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
  manifest: "/site.webmanifest",
  appleWebApp: { title: "ProcuLink" },
  other: {
    "msapplication-TileColor": "#0B1A2F",
    "msapplication-config": "/browserconfig.xml",
  },
  openGraph: {
    type: "website",
    title: "ProcuLink — Connecting Procurement",
    description:
      "Stop reformatting purchase orders by hand. ProcuLink turns any incoming order into the exact format and channel each supplier needs — with a full audit trail.",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProcuLink — Connecting Procurement",
    description:
      "Stop reformatting purchase orders by hand. Any incoming order, delivered in the exact format and channel each supplier needs — with a full audit trail.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const rawPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK === "true";
  const isQaBypass = process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true";

  // ClerkProvider is ALWAYS mounted so every Clerk hook (useUser / useAuth /
  // useOrganization) has a provider in the tree — including during the production
  // build's static prerender, where a missing provider throws
  // "useX can only be used within <ClerkProvider>" and fails `next build`.
  //
  // In mock / QA-bypass mode we feed it an EMPTY publishable key so it renders
  // children in a degraded no-session state (hooks return safe defaults).
  //
  // CRITICAL: an empty key alone is NOT enough. In `next dev` (development),
  // @clerk/nextjs's KEYLESS mode auto-provisions a throwaway Clerk app and
  // redirects to its "claim your application" page on any navigation to a
  // protected route — which hijacks router.push and breaks every e2e nav test.
  // Keyless is disabled via NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true (set in
  // playwright.config.ts webServer.env and the CI workflow env). With keyless
  // off + an empty key, Clerk stays fully dormant: no hosted JS, no router patch.
  const publishableKey = (isMockMode || isQaBypass) ? "" : rawPublishableKey;

  return (
    <html lang="en">
      <head>
        {/* Fonts are self-hosted via @fontsource (imported at the top of this
            file) — same families and weights, font-display: swap, served from
            same-origin /_next/static. No cross-origin Google Fonts round-trip
            on the critical FCP path. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(ORGANIZATION_STRUCTURED_DATA).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body>
        <ClerkProvider publishableKey={publishableKey}>
          {children}
          <AnalyticsBoot />
        </ClerkProvider>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
