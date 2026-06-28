"use client";

// SetupProgressChip — ambient topbar pill ("Setup 3/6") linking to the
// dashboard checklist (onboarding overhaul task 9).
//
// Honesty rules (mirrors OnboardingChecklist):
//   • visible ONLY while the status query has LOADED and the derivable steps
//     are incomplete — loading/error/unknown renders NOTHING (never a
//     fabricated 0/6);
//   • completion hides it (the checklist's one-time completion card handles
//     the celebration — no lingering chrome);
//   • counts come from the same buildChecklistSteps model the checklist uses,
//     so the chip and the hero can never disagree.

import Link from "next/link";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { buildChecklistSteps } from "./buildChecklistSteps";

export function SetupProgressChip() {
  const status = useOnboardingStatus();
  const { labels } = useOrderDirection();

  if (!status.isSuccess || !status.data) return null;

  const model = buildChecklistSteps(
    status.data,
    labels.counterpartyNoun.toLowerCase(),
  );
  if (model.totalSteps === 0 || model.complete) return null;

  return (
    <Link
      href="/bridge"
      aria-label={`Setup: ${model.totalDone} of ${model.totalSteps} steps done — open the checklist`}
      title="Finish setting up — open the checklist"
      data-testid="setup-progress-chip"
      // ≥44px tap target: the LINK is the hit area; the visible pill inside is
      // compact so the 56px topbar keeps its rhythm.
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        minWidth: 44,
        flexShrink: 0,
        textDecoration: "none",
      }}
    >
      <span
        className="inline-flex items-center"
        style={{
          gap: 6,
          height: 24,
          padding: "0 10px",
          borderRadius: 99,
          background: "#14253D",
          border: "1px solid #294063",
          color: "#C8D1E0",
          fontSize: 11.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: "50%", background: "#2E8E3A", flexShrink: 0 }}
        />
        {/* Hide the word on narrow screens; the count alone still reads. */}
        <span className="hidden sm:inline">Setup</span>
        <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {model.totalDone}/{model.totalSteps}
        </span>
      </span>
    </Link>
  );
}
