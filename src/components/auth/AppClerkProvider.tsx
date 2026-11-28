import { ClerkProvider } from "@clerk/nextjs";
import { AnalyticsIdentify } from "@/components/analytics/AnalyticsIdentify";

// Sign-in code loads only where someone signs in or works: the app, sign-in, sign-up, the workspace gate and
// /welcome. The public pages carry none of it (src/test/publicPagesNoClerk.test.ts).
//
// In mock / QA-bypass mode the provider gets an EMPTY publishable key, so it renders children in a dormant
// no-session state (hooks return safe defaults). An empty key alone is not enough in `next dev`: Clerk's
// KEYLESS mode would provision a throwaway app and hijack navigation, so it is switched off with
// NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true (playwright.config.ts webServer.env and the CI workflow env).
export function AppClerkProvider({ children }: { children: React.ReactNode }) {
  const dormant = process.env.NEXT_PUBLIC_USE_MOCK === "true" || process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true";
  return (
    <ClerkProvider publishableKey={dormant ? "" : process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      {children}
      <AnalyticsIdentify />
    </ClerkProvider>
  );
}

/** The layout for a route that needs sign-in code and has no layout of its own. */
export function ClerkLayout({ children }: { children: React.ReactNode }) {
  return <AppClerkProvider>{children}</AppClerkProvider>;
}
