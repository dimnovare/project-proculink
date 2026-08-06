"use client";

// Catastrophic root error boundary. Next renders this in place of the ENTIRE
// root layout when the root layout / template itself throws, so it MUST supply
// its own <html> and <body>. Kept dependency-light (no shell, no providers, an
// inline brand mark) so it renders even when everything else is broken.
//
// Sentry auto-captures from the boundary; the explicit helper adds the digest +
// a boundary tag (no-op outside production).

import { useEffect } from "react";

import { captureException } from "@/lib/sentry-context";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: "global" },
      extra: { digest: error.digest ?? "" },
    });
  }, [error]);

  return (
    <html lang="en">
      {/* See (app)/error.tsx for why this marker exists. */}
      <body style={{ margin: 0 }} data-plk-error-boundary="global">
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "72px 24px",
            background: "#FFFFFF",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {/* Inline ProcuLink "link" mark (green) — no imports, so this renders
              even if the component tree is what failed. */}
          <span style={{ display: "inline-flex", color: "#2E8E3A", marginBottom: 22 }} aria-hidden>
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.4" />
              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.4" />
            </svg>
          </span>

          <p
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#2E8E3A",
              margin: "0 0 12px",
            }}
          >
            Error
          </p>

          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#0B1A2F",
              margin: "0 0 12px",
              maxWidth: "18ch",
            }}
          >
            Something went wrong.
          </h1>

          <p style={{ fontSize: 16, color: "#56627A", lineHeight: 1.6, maxWidth: 460, margin: "0 0 32px" }}>
            An unexpected error interrupted ProcuLink. The problem has been logged. Try again,
            and if it keeps happening, contact support.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: "#0B1A2F",
                color: "#FFFFFF",
                border: "none",
                padding: "12px 22px",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              Try again
            </button>
            <a
              href="/support"
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "transparent",
                color: "#0B1A2F",
                textDecoration: "none",
                padding: "12px 22px",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                border: "1px solid #E2E6EE",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              Contact support
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
