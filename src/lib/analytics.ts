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

function loadPosthog(): Promise<PostHogClient | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  // No key (dev / mock / CI) → never fetch the SDK chunk at all.
  if (!key || typeof window === "undefined") return Promise.resolve(null);

  if (!phPromise) {
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
      });

      // If consent isn't given yet, opt out of capturing until it is.
      if (consent !== "analytics-allowed") {
        posthog.opt_out_capturing();
      }
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
    } else {
      posthog.opt_out_capturing();
    }
  });
}
