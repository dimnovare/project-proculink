"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useCookieConsent } from "@/lib/cookie-consent";
import { capture, identifyUser, onConsentChanged, setGroup } from "@/lib/analytics";

export function AnalyticsBoot() {
  const { user, isLoaded } = useUser();
  const [consent] = useCookieConsent();

  // React to consent changes.
  useEffect(() => {
    if (consent === "analytics-allowed" || consent === "functional-only") {
      onConsentChanged(consent);
    }
  }, [consent]);

  // Identify + group on sign-in.
  useEffect(() => {
    if (!isLoaded || !user) return;
    identifyUser(user.id, {
      email_domain: (user.primaryEmailAddress?.emailAddress ?? "").split("@")[1] ?? "",
    });
    const orgId = user.publicMetadata?.organisationId as string | undefined;
    if (orgId) setGroup(orgId, {});
  }, [isLoaded, user]);

  // Manual pageview capture so we don't leak query strings.
  useEffect(() => {
    capture("$pageview", { path: typeof window !== "undefined" ? window.location.pathname : "" });
  }, []);

  return null;
}
