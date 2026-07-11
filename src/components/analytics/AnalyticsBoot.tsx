"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useCookieConsent } from "@/lib/cookie-consent";
import { capture, identifyUser, onConsentChanged, setGroup } from "@/lib/analytics";

export function AnalyticsBoot() {
  const { user, isLoaded } = useUser();
  const [consent] = useCookieConsent();
  const pathname = usePathname();
  // Path of the last $pageview we actually emitted under consent — guards
  // against double-counting a view when consent flips (or is already granted)
  // for a path we've already captured.
  const capturedPath = useRef<string | null>(null);

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

  // Pageview on every App Router navigation (and the initial load). Gated on
  // consent so we never capture before consent is granted — and because this
  // effect also re-runs when `consent` changes, the pre-consent first view is
  // recovered the moment consent flips to "analytics-allowed". usePathname()
  // yields the path WITHOUT the query string, so we still don't leak query
  // params. The captured-path ref prevents double-counting the same view.
  useEffect(() => {
    if (consent !== "analytics-allowed") return;
    if (!pathname || capturedPath.current === pathname) return;
    capturedPath.current = pathname;
    capture("$pageview", { path: pathname });
  }, [pathname, consent]);

  return null;
}
