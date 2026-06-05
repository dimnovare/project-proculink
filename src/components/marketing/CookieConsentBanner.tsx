"use client";

import Link from "next/link";
import { useCookieConsent } from "@/lib/cookie-consent";

export function CookieConsentBanner() {
  const [consent, setConsent] = useCookieConsent();

  if (consent !== "unknown") return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 60,
        maxWidth: 720,
        margin: "0 auto",
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(11,26,47,0.12)",
        padding: "18px 20px",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "#3D4A5C",
          flex: "1 1 320px",
        }}
      >
        ProcuLink uses functional cookies to keep you signed in, and optional analytics
        cookies to improve the product. We don&apos;t use advertising or cross-site tracking.{" "}
        <Link href="/privacy" style={{ color: "#2E8E3A" }}>See our Privacy Policy</Link>.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setConsent("functional-only")}
          style={{
            background: "#FFFFFF",
            color: "#0B1A2F",
            border: "1px solid #C6CDDA",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => setConsent("analytics-allowed")}
          style={{
            background: "#0B1A2F",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Accept analytics
        </button>
      </div>
    </div>
  );
}
