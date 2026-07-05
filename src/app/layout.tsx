import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AnalyticsBoot } from "@/components/analytics/AnalyticsBoot";
import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import { ORGANIZATION_STRUCTURED_DATA } from "@/lib/legal-entity";
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
        {/* Fonts as a preconnected <head> stylesheet instead of a CSS @import.
            @import was render-blocking + serial (download globals.css → discover
            the import → fetch Google CSS → fetch font files), a big FCP/LCP cost.
            preconnect warms the connection and the <link> is discovered
            immediately + loads in parallel. Same families, display=swap. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Bricolage+Grotesque:wght@500;600;700;800&display=swap"
        />
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
