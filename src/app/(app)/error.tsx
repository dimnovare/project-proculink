"use client";

// Next.js route error boundary for the (app) segment. Catches errors the nested
// component <ErrorBoundary> can't — Server Component render, data fetching, and
// the route tree — and shows the SAME branded recovery panel instead of Next's
// unstyled default screen. It renders INSIDE (app)/layout.tsx, so the topbar and
// shell stay put; only the content region is replaced.
//
// Sentry auto-captures from the error boundary; we also call our explicit helper
// so the digest reaches Sentry with a boundary tag (no-op outside production).

import { useEffect } from "react";
import Link from "next/link";

import { captureException } from "@/lib/sentry-context";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: "app-route" },
      extra: { digest: error.digest ?? "" },
    });
  }, [error]);

  return (
    <div
      // Machine-readable marker that this route is showing an error, not content.
      // It exists because the comment at the top of this file is load-bearing: this
      // boundary renders INSIDE (app)/layout.tsx, so the sidebar, topbar and
      // breadcrumb are all still there and the response is still HTTP 200. A test
      // that checks "did the page return 2xx and render some text and some
      // controls" is satisfied by the shell alone — verified, /upload passed an axe
      // scan while its page component threw. src/test/errorBoundaryMarker.test.ts
      // keeps this attribute from being removed by accident.
      data-plk-error-boundary="app-route"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 420,
        padding: "48px 32px",
        textAlign: "center",
        background: "#F6F7FA",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          background: "#FBE3E3",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          marginBottom: 16,
        }}
        aria-hidden
      >
        ⚠
      </div>

      <h1
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "#0B1A2F",
          margin: "0 0 6px",
        }}
      >
        Something went wrong on this screen
      </h1>

      <p style={{ fontSize: 13, color: "#5E6779", maxWidth: 380, margin: "0 0 24px", lineHeight: 1.55 }}>
        An unexpected error stopped this page from loading. The error has been logged and
        our team can see it. Try again, or reach out if it keeps happening.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            borderRadius: 7,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            background: "#0B1A2F",
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/support"
          style={{
            borderRadius: 7,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            background: "#FFFFFF",
            color: "#0B1A2F",
            border: "1px solid #E5E8EE",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Contact support
        </Link>
      </div>
    </div>
  );
}
