"use client";

// OnboardingChecklist — the first-run "Get your first order automated" card.
//
// A confident, self-contained card that reads as the primary next step while
// onboarding is incomplete and graduates away (renders nothing) once every
// milestone is done. Four milestones, each backed by a real OnboardingStatus
// flag — never a fabricated "done" state:
//   supplier → upload → resolve mapping → deliver first order
//
// Used by BridgeDashboard in two slots (same component, different placement):
//   • as the hero, centered, when the org has no data yet (empty topology)
//   • as a full-width band below the live topology while setup finishes

import React from "react";
import Link from "next/link";
import type { OnboardingStatus } from "@/types/procurement";
import { useOrderDirection } from "@/hooks/useOrderDirection";

// Locked Bridge Layer tokens (see CLAUDE.md §3). Do not substitute slate values.
const T = {
  navy:      "#0B1A2F",
  blue:      "#1E66C9",
  blueDeep:  "#0F4FA8",
  blueSoft:  "#E3EDFB",
  green:     "#2E8E3A",
  greenDeep: "#1E6D29",
  surface:   "#FFFFFF",
  surface2:  "#EFF2F7",
  border:    "#E2E6EE",
  ink:       "#0B1A2F",
  muted:     "#56627A",
  faint:     "var(--ink-faint)",
};

interface OnboardingChecklistProps {
  status: OnboardingStatus;
  supplierCount: number;
  orderCount: number;
  /** Count of orders that actually reached `delivered`. Drives the final step. */
  deliveredCount?: number;
  /** Re-opens the guided setup wizard. Only surfaced before the first supplier. */
  onResumeSetup?: () => void;
}

interface Step {
  id: string;
  label: string;
  description: string;
  href: string;
  /** Imperative label for the primary CTA when this is the active step. */
  cta: string;
  /** Steps that must be done before this one unlocks. */
  requires: string[];
}

// Steps depend on the org's direction labels ("supplier" → "customer" in inbound
// mode), so they're built per-render from the counterparty noun rather than at
// module scope. Step `id`s and `href`s are UNCHANGED (routes/state untouched).
function buildSteps(noun: string, nounLower: string): Step[] {
  return [
    {
      id: "supplier",
      label: `Add your first ${nounLower}`,
      description: `Create a ${nounLower} to hold its delivery config and item mappings.`,
      href: "/library/suppliers",
      cta: `Add a ${nounLower}`,
      requires: [],
    },
    {
      id: "upload",
      label: "Upload a purchase order",
      description: "Drop a CSV, XLSX, PDF, or cXML order to get started.",
      href: "/upload",
      cta: "Upload an order",
      requires: ["supplier"],
    },
    {
      id: "map",
      label: "Resolve item mapping",
      description: `Connect buyer item codes to each ${nounLower}'s own SKUs.`,
      href: "/library/mappings",
      cta: "Resolve mapping",
      requires: ["supplier", "upload"],
    },
    {
      id: "deliver",
      label: "Deliver your first order",
      description: `Set up delivery, then send to your ${nounLower}.`,
      href: "/inbox",
      cta: "Deliver an order",
      requires: ["supplier", "upload", "map"],
    },
  ];
}

// ─── Status markers ─────────────────────────────────────────────────────────

function DoneMark() {
  return (
    <span
      style={{
        width: 20, height: 20, borderRadius: "50%", background: T.green,
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <svg width="10" height="8" viewBox="0 0 9 7" fill="none" aria-hidden>
        <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function NumberMark({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      style={{
        width: 20, height: 20, borderRadius: "50%",
        border: `1.8px solid ${active ? T.blue : T.border}`,
        background: active ? T.blueSoft : "transparent",
        color: active ? T.blueDeep : T.faint,
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {n}
    </span>
  );
}

function LockMark() {
  return (
    <span
      style={{
        width: 20, height: 20, borderRadius: "50%", border: `1.8px solid ${T.border}`,
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <svg width="9" height="10" viewBox="0 0 8 9" fill="none" aria-hidden>
        <rect x="0.9" y="3.8" width="6.2" height="4.5" rx="1" stroke={T.faint} strokeWidth="1.3" />
        <path d="M2.2 3.8V3a1.8 1.8 0 0 1 3.6 0v.8" stroke={T.faint} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingChecklist({
  status,
  supplierCount,
  orderCount,
  deliveredCount,
  onResumeSetup,
}: OnboardingChecklistProps) {
  // Direction-aware step copy: "supplier" → "customer" in inbound mode (display only).
  const { labels } = useOrderDirection();
  const STEPS = React.useMemo(
    () => buildSteps(labels.counterpartyNoun, labels.counterpartyNoun.toLowerCase()),
    [labels.counterpartyNoun],
  );

  // Each step's done-ness maps to a real signal — no fabricated completion.
  const doneById: Record<string, boolean> = {
    supplier: status.hasSupplier || supplierCount > 0,
    upload:   status.hasUpload   || orderCount > 0,
    map:      status.hasResolvedMapping,
    deliver:  deliveredCount != null ? deliveredCount > 0 : status.hasDelivery,
  };

  const totalDone = STEPS.filter((s) => doneById[s.id]).length;

  // Graduate away cleanly once everything is done — the dashboard reclaims the space.
  if (totalDone >= STEPS.length) return null;

  const progress = (totalDone / STEPS.length) * 100;
  const remaining = STEPS.length - totalDone;

  // Active step = first not-done step whose prerequisites are all met.
  const isLocked = (s: Step) => s.requires.some((r) => !doneById[r]);
  const activeStep =
    STEPS.find((s) => !doneById[s.id] && !isLocked(s)) ??
    STEPS.find((s) => !doneById[s.id]) ??
    null;

  const showSample = !doneById.upload; // sample PO shortcut helps before the first upload
  const showGuided = !doneById.supplier && typeof onResumeSetup === "function";

  return (
    <section
      aria-label="Onboarding progress"
      style={{
        position: "relative",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
        width: "100%",
      }}
    >
      {/* Cross-section edge — the bridge seen end-on: blue (buyer) → green (supplier). */}
      <div
        aria-hidden
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
          background: "linear-gradient(180deg, #1E66C9 0%, #2E8E3A 100%)",
        }}
      />

      <div className="grid gap-x-10 gap-y-5 p-5 sm:p-6 lg:grid-cols-[minmax(280px,0.85fr)_minmax(430px,1.15fr)]">
        {/* ── Intro · progress · primary action ───────────────────────── */}
        <div className="min-w-0">
          <div
            className="text-[10.5px] font-bold uppercase"
            style={{ color: T.blueDeep, letterSpacing: "0.09em" }}
          >
            First delivery
          </div>
          <h2
            className="mt-1 text-[19px] leading-tight"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: T.ink,
            }}
          >
            Get your first order automated
          </h2>
          <p className="mt-1 text-[12.5px]" style={{ color: T.muted }}>
            {totalDone === 0
              ? "Four quick steps · about 5 minutes"
              : `${remaining} step${remaining === 1 ? "" : "s"} left · almost there`}
          </p>

          {/* Progress meter — blue→green, the link-spine in miniature */}
          <div className="mt-4 flex items-center gap-2.5">
            <div
              className="flex-1 overflow-hidden"
              style={{ height: 6, background: T.surface2, borderRadius: 3 }}
              role="progressbar"
              aria-valuenow={totalDone}
              aria-valuemin={0}
              aria-valuemax={STEPS.length}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #1E66C9, #2E8E3A)",
                  borderRadius: 3,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <span
              className="text-[11px] font-bold tabular-nums"
              style={{ color: T.muted, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {totalDone}/{STEPS.length}
            </span>
          </div>

          {/* Primary next step */}
          {activeStep && (
            <Link
              href={activeStep.href}
              className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[6px] px-4 text-[13px] font-semibold transition-colors"
              style={{ background: T.navy, color: "#fff", letterSpacing: "0.01em" }}
            >
              {activeStep.cta}
              <span aria-hidden>→</span>
            </Link>
          )}

          {/* Secondary affordances */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {showGuided && (
              <button
                type="button"
                onClick={onResumeSetup}
                className="text-[12px] font-semibold transition-colors"
                style={{ color: T.blueDeep, background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                Use guided setup
              </button>
            )}
            {showSample && (
              <a
                href="/demo-purchase-order.csv"
                download
                className="text-[12px] font-medium"
                style={{ color: T.muted }}
              >
                Download sample CSV ↓
              </a>
            )}
          </div>
        </div>

        {/* ── Step list ───────────────────────────────────────────────── */}
        <ol
          className="flex flex-col gap-2 lg:border-l lg:pl-8"
          style={{ listStyle: "none", margin: 0, borderColor: T.border }}
          aria-label="First delivery setup steps"
        >
          <li
            className="mb-1 text-[10.5px] font-bold uppercase"
            style={{ color: T.faint, letterSpacing: "0.09em" }}
          >
            Setup path
          </li>
          {STEPS.map((step, i) => {
            const done = doneById[step.id];
            const locked = !done && isLocked(step);
            const active = !done && !locked && activeStep?.id === step.id;

            return (
              <li
                key={step.id}
                className="flex items-start gap-3 rounded-[8px] p-3"
                style={{
                  background: active ? T.blueSoft : done ? "#F3FAF4" : "transparent",
                  border: active ? `1px solid ${T.blue}` : done ? "1px solid #D6EEDB" : `1px solid ${T.border}`,
                  opacity: locked ? 0.72 : 1,
                }}
              >
                {done ? <DoneMark /> : locked ? <LockMark /> : <NumberMark n={i + 1} active={active} />}
                <div className="min-w-0 flex-1" style={{ marginTop: 1 }}>
                  <div
                    className="text-[13px]"
                    style={{
                      color: done ? T.muted : locked ? T.faint : T.ink,
                      fontWeight: active ? 600 : 500,
                      textDecoration: done ? "line-through" : "none",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {step.label}
                  </div>
                  {(active || done) && (
                    <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: T.muted }}>
                      {done ? "Ready for the next step." : step.description}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
