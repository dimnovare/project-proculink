"use client";

// PostHog is loaded LAZILY via dynamic import. A static `import posthog from
// "posthog-js"` put the entire SDK (~60 kB gz) into the root layout's client
// bundle — part of the first-load JS of EVERY route, including the marketing
// pages, where it delayed FCP/LCP. All call sites go through this facade with
// fire-and-forget semantics, so deferring the SDK fetch until the first
// capture/identify call (post-hydration, in a useEffect) changes nothing
// functionally: events are queued on the import promise and flushed in call
// order once the SDK arrives.
import type posthogType from "posthog-js";
import { getCookieConsentSnapshot } from "@/lib/cookie-consent";

type PostHogClient = typeof posthogType;

let phPromise: Promise<PostHogClient | null> | null = null;

// ── First touch ──────────────────────────────────────────────────────────────
// Where this visit came from, read once on the first page and held IN MEMORY only: nothing is
// stored on the device until the visitor allows analytics. Then it is registered once, so every
// later event on this device (sign-up and the first document included) carries the first touch.
// Campaign tags we set ourselves, the landing path and the referring site's domain: no query
// string, no full referrer URL.
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
let firstTouch: Record<string, string> | null = null;

export function rememberLanding() {
  if (firstTouch || typeof window === "undefined") return;
  const query = new URLSearchParams(window.location.search);
  firstTouch = { first_landing_page: window.location.pathname };
  for (const key of UTM_KEYS) {
    const value = query.get(key);
    if (value) firstTouch[`first_${key}`] = value.slice(0, 100);
  }
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    if (host && host !== window.location.hostname) firstTouch.first_referrer_domain = host;
  } catch {
    // an unparseable referrer is simply not recorded
  }
}

function registerFirstTouch(posthog: PostHogClient) {
  if (firstTouch && getCookieConsentSnapshot() === "analytics-allowed") posthog.register_once(firstTouch);
}

function loadPosthog(): Promise<PostHogClient | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  // No key (dev / mock / CI) → never fetch the SDK chunk at all.
  if (!key || typeof window === "undefined") return Promise.resolve(null);

  if (!phPromise) {
    // The first load can come from a page component's effect, which runs before AnalyticsBoot's.
    rememberLanding();
    phPromise = import("posthog-js").then(({ default: posthog }) => {
      const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
      const consent = getCookieConsentSnapshot();
      posthog.init(key, {
        api_host:          host,
        capture_pageview:  false,
        persistence:       consent === "analytics-allowed" ? "localStorage+cookie" : "memory",
        autocapture:       false,
        disable_session_recording: true,
        mask_personal_data_properties: true,
        // The SDK adds the full address to every event as $current_url. The option above masks only
        // ad click ids; these carry sign-in tokens (Clerk invitation links), the Google sign-in code
        // (/settings/google-callback) or an address.
        custom_personal_data_properties: ["__clerk_ticket", "__clerk_handshake", "__clerk_db_jwt", "code", "state", "token", "email", "session_id"],
      });

      // If consent isn't given yet, opt out of capturing until it is.
      if (consent !== "analytics-allowed") {
        posthog.opt_out_capturing();
      }
      registerFirstTouch(posthog);
      return posthog;
    });
  }
  return phPromise;
}

export function capture(event: string, properties: Record<string, unknown> = {}) {
  void loadPosthog().then((posthog) => {
    posthog?.capture(event, {
      environment: process.env.NODE_ENV,
      ...properties,
    });
  });
}

export function identifyUser(userId: string, traits: Record<string, unknown> = {}) {
  void loadPosthog().then((posthog) => {
    posthog?.identify(userId, traits);
  });
}

export function setGroup(orgId: string, traits: Record<string, unknown> = {}) {
  void loadPosthog().then((posthog) => {
    posthog?.group("organisation", orgId, traits);
  });
}

export function onConsentChanged(value: "functional-only" | "analytics-allowed") {
  void loadPosthog().then((posthog) => {
    if (!posthog) return;
    if (value === "analytics-allowed") {
      posthog.set_config({ persistence: "localStorage+cookie" });
      posthog.opt_in_capturing();
      registerFirstTouch(posthog);
    } else {
      posthog.opt_out_capturing();
    }
  });
}
