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
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // ClerkProvider is ALWAYS mounted so that components calling Clerk hooks
  // (useAuth/useUser/useOrganization/...) never run outside a provider —
  // including during static prerender at build time when no publishable key
  // is configured. @clerk/nextjs tolerates an absent publishableKey by
  // rendering children in a degraded, no-session state (sign-in/sign-out are
  // simply unavailable). When the key IS present, behaviour is unchanged.
  return (
    <html lang="en">
      <head>
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
