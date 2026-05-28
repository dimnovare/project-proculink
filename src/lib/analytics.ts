"use client";

import posthog from "posthog-js";
import { getCookieConsentSnapshot } from "@/lib/cookie-consent";

let initialised = false;

function maybeInit() {
  if (initialised) return;
  const key  = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com";
  if (!key) return;

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
  initialised = true;
}

export function capture(event: string, properties: Record<string, unknown> = {}) {
  maybeInit();
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(event, {
    environment: process.env.NODE_ENV,
    ...properties,
  });
}

export function identifyUser(userId: string, traits: Record<string, unknown> = {}) {
  maybeInit();
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.identify(userId, traits);
}

export function setGroup(orgId: string, traits: Record<string, unknown> = {}) {
  maybeInit();
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.group("organisation", orgId, traits);
}

export function onConsentChanged(value: "functional-only" | "analytics-allowed") {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  if (!initialised) maybeInit();
  if (value === "analytics-allowed") {
    posthog.set_config({ persistence: "localStorage+cookie" });
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}
