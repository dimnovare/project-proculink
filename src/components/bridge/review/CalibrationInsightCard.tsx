"use client";

// CalibrationInsightCard — V9. A compact, honest read of GET /api/ai/calibration:
// "ProcuLink has learned from N of your decisions; at 85–95% confidence you
// accept M%." Explains WHY the AI confidences on this screen are trustworthy.
//
// HONESTY: renders ONLY when calibration is active (isActive === true). During
// cold-start the endpoint returns isActive=false and mostly-empty buckets — we
// render NOTHING rather than a misleading empty curve. The numbers come straight
// from the backend; nothing is computed here.

import { useQuery } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useAuth } from "@clerk/nextjs";
import type { CalibrationBucket } from "@/types/procurement";

/**
 * Pick the most useful trusted bucket to headline — the highest-confidence
 * TRUSTED bucket with samples, which is what the operator's high-confidence
 * suggestions land in. Returns null when no trusted bucket carries data.
 */
function headlineBucket(buckets: CalibrationBucket[]): CalibrationBucket | null {
  const trusted = buckets.filter(b => b.isTrusted && b.total > 0);
  if (trusted.length === 0) return null;
  return trusted[trusted.length - 1]; // buckets are lowest-first
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function CalibrationInsightCard() {
  const { isLoaded: clerkReady } = useAuth();
  const { data } = useQuery({
    queryKey: ["ai-calibration"],
    queryFn: () => apiClient.getAiCalibration(),
    enabled: isApiMockMode || clerkReady,
    staleTime: 5 * 60_000,
    // A failed/unavailable insight must never break the review screen — it is a
    // purely additive surface. React Query keeps `data` undefined on error.
    retry: 1,
  });

  // Only render the active, populated state — never a cold-start placeholder.
  if (!data || !data.isActive) return null;
  const headline = headlineBucket(data.buckets);
  if (!headline) return null;

  return (
    <div
      style={{
        marginTop: 12, borderRadius: 10, background: "#FAF7FE",
        border: "1px solid #E4D9F6", overflow: "hidden",
      }}
    >
      <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", color: "#5E3DB0" }}>
          CALIBRATION
        </span>
        <span style={{ fontSize: 10.5, color: "#8E7CB8" }}>
          learned from {data.totalDecisions} of your decision{data.totalDecisions === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ padding: "0 12px 10px", fontSize: 11.5, color: "#4A3A72", lineHeight: 1.5 }}>
        At <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{headline.label}</span> model
        confidence, you have accepted{" "}
        <span style={{ fontWeight: 700, color: "#5E3DB0" }}>{pct(headline.smoothedAcceptRate)}</span>{" "}
        of suggestions ({headline.accepted} of {headline.total}). ProcuLink uses this to calibrate the
        confidence shown on each suggestion.
      </div>
      {/* Compact per-bucket reliability bars — trusted buckets only carry the
          calibrated signal; thin buckets are de-emphasised but still shown. */}
      <div style={{ padding: "0 12px 11px", display: "flex", flexDirection: "column", gap: 4 }}>
        {data.buckets.filter(b => b.total > 0).map(b => (
          <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 78, fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", color: "#8E7CB8", flexShrink: 0 }}>
              {b.label}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#ECE3FA", overflow: "hidden", minWidth: 0 }}>
              <div
                style={{
                  width: `${Math.round(b.smoothedAcceptRate * 100)}%`, height: "100%",
                  background: b.isTrusted ? "#7B5BD4" : "#C9B6EC", transition: "width 250ms",
                }}
              />
            </div>
            <span style={{ width: 34, textAlign: "right", fontSize: 9.5, fontWeight: 700, color: b.isTrusted ? "#5E3DB0" : "#A593CE", flexShrink: 0 }}>
              {pct(b.smoothedAcceptRate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
