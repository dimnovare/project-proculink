"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useCookieConsent } from "@/lib/cookie-consent";
import { capture, identifyUser, onConsentChanged, rememberLanding, setGroup } from "@/lib/analytics";

/** The calls to action whose clicks we count, by where the link goes. */
const CTA_TARGETS: [prefix: string, cta: string][] = [
  ["/sign-up", "start_trial"],
  ["/book-demo", "book_call"],
  ["mailto:sales@", "contact_sales"],
];

export function AnalyticsBoot() {
  const { user, isLoaded } = useUser();
  const [consent] = useCookieConsent();
  const pathname = usePathname();
  // Path of the last $pageview we actually emitted under consent — guards
  // against double-counting a view when consent flips (or is already granted)
  // for a path we've already captured.
  const capturedPath = useRef<string | null>(null);

  // First, before any other effect can load the SDK: remember where this visit began.
  useEffect(() => rememberLanding(), []);

  // One listener for every call to action on every page. Records which one (our own words on the
  // link) and where it sat; never anything a visitor typed.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      const href = link?.getAttribute("href") ?? "";
      const cta = CTA_TARGETS.find(([prefix]) => href.startsWith(prefix))?.[1];
      if (!link || !cta) return;
      capture("marketing_cta_clicked", {
        cta,
        label: (link.textContent ?? "").trim().slice(0, 60),
        placement: link.closest("header") ? "header" : link.closest("footer") ? "footer" : "page",
        path: window.location.pathname,
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

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
