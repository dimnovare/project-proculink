import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AnalyticsBoot } from "@/components/analytics/AnalyticsBoot";
import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0B1A2F",
};

export const metadata: Metadata = {
  title: "ProcuLink — Connecting Procurement",
  description: "The missing link between buyers and suppliers.",
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
    description: "The missing link between buyers and suppliers.",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProcuLink — Connecting Procurement",
    description: "The missing link between buyers and suppliers.",
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
