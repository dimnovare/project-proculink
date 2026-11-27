import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AnalyticsBoot } from "@/components/analytics/AnalyticsBoot";
import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import { JsonLd } from "@/components/marketing/JsonLd";
import { PwaBoot } from "@/components/pwa/PwaBoot";
import { ORGANIZATION_STRUCTURED_DATA } from "@/lib/legal-entity";
import { SITE_DESCRIPTION, SITE_TITLE, WEBSITE_STRUCTURED_DATA, socialMetadata } from "@/lib/seo";
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
  // The installed window has no browser chrome: draw under the notch and let the
  // env(safe-area-inset-*) paddings keep content clear of it.
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://proculink.eu"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
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
  appleWebApp: { capable: true, title: "ProcuLink", statusBarStyle: "default" },
  other: {
    "msapplication-TileColor": "#0B1A2F",
    "msapplication-config": "/browserconfig.xml",
  },
  ...socialMetadata({ title: SITE_TITLE, description: SITE_DESCRIPTION }),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The cookie, then Accept-Language, then English (src/i18n/request.ts).
  const locale = await getLocale();
  // The browser gets only what client components read; the page copy (home, pricing) renders on the server.
  const { home: _home, pricing: _pricing, ...clientMessages } = await getMessages();
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
    <html lang={locale}>
      <head>
        {/* Fonts are self-hosted via @fontsource (imported at the top of this
            file) — same families and weights, font-display: swap, served from
            same-origin /_next/static. No cross-origin Google Fonts round-trip
            on the critical FCP path. */}
        <JsonLd data={ORGANIZATION_STRUCTURED_DATA} />
        <JsonLd data={WEBSITE_STRUCTURED_DATA} />
        {/* The dev-server overlay is a fixed-position element, and there is no
            corner where it is harmless.

            It sat over the cookie banner's Reject button at 390 and 768 — the
            banner's buttons are `flex-1` below `sm`, so Reject spans the whole
            width and reaches into the badge's corner — which meant the first-run
            journey could not even dismiss the banner at those widths. Moving it
            to top-right fixed that and immediately broke `a11y-overlay-open`,
            where it landed on the marketing mobile-menu trigger. `devIndicators:
            false` was tried too, and Next 15.5 ignores it silently.

            So it is hidden outright, and ONLY under NEXT_PUBLIC_QA_BYPASS_AUTH —
            the flag that already means "this build is a Playwright run". It is
            build-time false in every real build, dev included, so a developer
            running `bun run dev` still gets the overlay where they expect it. */}
        {isQaBypass && (
          <style dangerouslySetInnerHTML={{ __html: "nextjs-portal{display:none !important}" }} />
        )}
      </head>
      <body>
        <NextIntlClientProvider messages={clientMessages}>
          <ClerkProvider publishableKey={publishableKey}>
            {children}
            <AnalyticsBoot />
          </ClerkProvider>
          <CookieConsentBanner />
          <PwaBoot />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
