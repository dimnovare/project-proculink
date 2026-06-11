"use client";

import { useEffect } from "react";
import Link from "next/link";
import { capture } from "@/lib/analytics";

export default function WatchPage() {
  // Priority: a self-hosted MP4 (e.g. in R2) → a Loom embed → a quiet fallback.
  const videoUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL ?? "";
  const posterUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_POSTER ?? "";
  const loomUrl = process.env.NEXT_PUBLIC_WALKTHROUGH_LOOM_URL ?? "";

  useEffect(() => {
    if (videoUrl) capture("watch_demo_started", { source: "r2" });
    else if (loomUrl) capture("watch_demo_started", { loom_url_hash: hashUrl(loomUrl) });
  }, [videoUrl, loomUrl]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "72px 32px 80px" }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 700, color: "#0B1A2F", marginBottom: 12, letterSpacing: "-0.025em" }}>
        Watch the walkthrough
      </h1>
      <p style={{ fontSize: 16, color: "#56627A", lineHeight: 1.6, marginBottom: 32, maxWidth: 600 }}>
        See how a single upload becomes a delivered supplier order — parsed, mapped, validated against the supplier&apos;s rules, and sent.
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
            <a href={videoUrl} style={{ color: "#2E8E3A" }}>Download the walkthrough</a>.
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
          The walkthrough is coming shortly. In the meantime, email <a href="mailto:hello@proculink.eu" style={{ color: "#2E8E3A" }}>hello@proculink.eu</a> for a guided demo.
        </div>
      )}

      <p style={{ marginTop: 36, fontSize: 14, color: "#56627A" }}>
        Prefer a live walkthrough? <Link href="/pricing" style={{ color: "#2E8E3A" }}>See pricing</Link> or book a 15-minute demo from inside the product.
      </p>
    </div>
  );
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}
