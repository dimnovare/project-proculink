import type { Metadata } from "next";
import Link from "next/link";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

// Global branded 404. App Router renders this for any unmatched route (marketing
// or app). Kept as a Server Component with no data fetching so it renders even
// when the API is down.
export const metadata: Metadata = {
  title: "Page not found — ProcuLink",
  description: "The page you were looking for doesn't exist or has moved.",
  robots: { index: false, follow: false },
};

const INK = "#0B1A2F";
const MUTED = "#56627A";
const GREEN = "#2E8E3A";

export default function NotFound() {
  return (
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
      <span style={{ display: "inline-flex", color: GREEN, marginBottom: 22 }}>
        <ProcuLinkMark size={40} />
      </span>

      <p
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: GREEN,
          margin: "0 0 12px",
        }}
      >
        404
      </p>

      <h1
        style={{
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          fontSize: "clamp(28px, 4vw, 40px)",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: INK,
          margin: "0 0 12px",
          maxWidth: "18ch",
        }}
      >
        This page took a wrong turn.
      </h1>

      <p style={{ fontSize: 16, color: MUTED, lineHeight: 1.6, maxWidth: 460, margin: "0 0 32px" }}>
        The page you were looking for doesn&apos;t exist or has moved. Let&apos;s get you back on
        route.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: INK,
            color: "#FFFFFF",
            textDecoration: "none",
            padding: "12px 22px",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Back to home <span aria-hidden>→</span>
        </Link>
        <Link
          href="/help"
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: "transparent",
            color: INK,
            textDecoration: "none",
            padding: "12px 22px",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            border: "1px solid #E2E6EE",
          }}
        >
          Visit the help center
        </Link>
      </div>
    </main>
  );
}
