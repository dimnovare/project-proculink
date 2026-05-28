import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AnalyticsBoot } from "@/components/analytics/AnalyticsBoot";
import { CookieConsentBanner } from "@/components/marketing/CookieConsentBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProcuLink — Procurement Hub",
  description: "Upload buyer orders, resolve mappings, transform and deliver to suppliers.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html lang="en">
      <body>
        {publishableKey ? (
          <ClerkProvider publishableKey={publishableKey}>
            {children}
            <AnalyticsBoot />
          </ClerkProvider>
        ) : (
          children
        )}
        <CookieConsentBanner />
      </body>
    </html>
  );
}
