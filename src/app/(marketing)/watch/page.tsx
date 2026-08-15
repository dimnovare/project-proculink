"use client";

import { useEffect } from "react";
import Link from "next/link";
import { capture } from "@/lib/analytics";
import { BOOK_DEMO_URL, BOOK_DEMO_IS_EXTERNAL } from "@/lib/book-demo";

export default function WatchPage() {
  // Priority: a self-hosted MP4 (e.g. in R2) → a Loom embed → a quiet fallback.
  const videoUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL ?? "";
  const posterUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_POSTER ?? "";
  const loomUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_LOOM_URL ?? "";
  // Booking link: defaults to our own /book-demo request page (honest — a form,
  // not an instant calendar). NEXT_PUBLIC_BOOK_DEMO_URL stays as an escape hatch
  // to point at an external scheduler; only external links open in a new tab.

  useEffect(() => {
    if (videoUrl) capture("watch_demo_started", { source: "r2" });
    else if (loomUrl) capture("watch_demo_started", { loom_url_hash: hashUrl(loomUrl) });
  }, [videoUrl, loomUrl]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "72px 32px 80px" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 26,
          padding: "0 12px",
          borderRadius: 13,
          background: "var(--brand-blue-soft)",
          color: "var(--brand-blue-deep)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 16,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand-blue)", display: "inline-block" }} />
        Walkthrough
      </span>
      <h1 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 700, color: "#0B1A2F", marginBottom: 12, letterSpacing: "-0.025em" }}>
        Watch the walkthrough
      </h1>
      {/*
        This read "validated against the supplier's rules" and matched the page's
        SERP description word for word. "A supplier's own rules" names the
        CONFIGURABLE acceptance profile, which is gated at Enterprise
        (BillingFeature.CustomSupplierRules; SupplierAcceptanceController refuses
        both authoring and activating below it), so the sentence promised a
        capability most readers' plans would refuse. The bare verb is true on
        every plan — the built-in checks run with no profile configured — and it
        is also what the walkthrough actually shows.
      */}
      <p style={{ fontSize: 16, color: "#56627A", lineHeight: 1.6, marginBottom: 32, maxWidth: 600 }}>
        See how a single upload becomes a delivered supplier order — parsed, mapped, validated, and sent.
      </p>

      {videoUrl ? (
        <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 6px 22px rgba(11,26,47,0.1)", background: "#0B1A2F" }}>
          <video
            controls
            playsInline
            preload="metadata"
            poster={posterUrl || undefined}
            style={{ display: "block", width: "100%", height: "auto" }}
          >
            <source src={videoUrl} type="video/mp4" />
            Your browser can&apos;t play embedded video.{" "}
            <a href={videoUrl} style={{ color: "#1E6D29", textDecoration: "underline" }}>Download the walkthrough</a>.
          </video>
        </div>
      ) : loomUrl ? (
        <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: 12, overflow: "hidden", boxShadow: "0 6px 22px rgba(11,26,47,0.1)" }}>
          <iframe
            src={loomUrl}
            title="ProcuLink walkthrough"
            allow="autoplay; fullscreen"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "0" }}
          />
        </div>
      ) : (
        <div style={{ background: "#F6F7FA", border: "1px dashed #C6CDDA", borderRadius: 12, padding: 48, textAlign: "center", color: "var(--ink-faint)", fontSize: 14 }}>
          The walkthrough is coming shortly. In the meantime, email <a href="mailto:hello@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>hello@proculink.eu</a> for a guided demo.
        </div>
      )}

      <p style={{ marginTop: 36, fontSize: 14, color: "#56627A" }}>
        Prefer a live walkthrough? <Link href="/pricing" style={{ color: "#1E6D29", textDecoration: "underline" }}>See pricing</Link>
        {" "}or{" "}
        {BOOK_DEMO_IS_EXTERNAL ? (
          <a href={BOOK_DEMO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#1E6D29", textDecoration: "underline" }}>
            book a demo
          </a>
        ) : (
          <Link href={BOOK_DEMO_URL} style={{ color: "#1E6D29", textDecoration: "underline" }}>
            book a demo
          </Link>
        )}.
      </p>
    </div>
  );
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}
