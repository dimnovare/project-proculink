"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "proculink_cookie_consent_v1";

export type CookieConsent = "unknown" | "functional-only" | "analytics-allowed";

function readConsent(): CookieConsent {
  if (typeof window === "undefined") return "unknown";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "functional-only" || raw === "analytics-allowed") return raw;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function getCookieConsentSnapshot(): CookieConsent {
  return readConsent();
}

export function setCookieConsent(value: Exclude<CookieConsent, "unknown">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent("proculink:cookie-consent", { detail: value }));
  } catch {
    // localStorage may be unavailable in private modes — fail silently
  }
}

export function useCookieConsent(): [CookieConsent, (v: Exclude<CookieConsent, "unknown">) => void] {
  const [consent, setConsent] = useState<CookieConsent>("unknown");

  useEffect(() => {
    setConsent(readConsent());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<CookieConsent>).detail;
      if (detail === "functional-only" || detail === "analytics-allowed") {
        setConsent(detail);
      }
    };
    window.addEventListener("proculink:cookie-consent", onChange);
    return () => window.removeEventListener("proculink:cookie-consent", onChange);
  }, []);

  return [consent, setCookieConsent];
}
