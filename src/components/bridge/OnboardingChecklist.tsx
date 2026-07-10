"use client";

// OnboardingChecklist — the first-run "Get your first order automated" card (v2).
//
// Six server-verified steps (supplier → catalog → upload → resolve → delivery →
// send) derived by the pure buildChecklistSteps() model from the extended
// GET /api/onboarding/status payload. Self-fetches via useOnboardingStatus —
// no prop threading from BridgeDashboard.
//
// Honesty rules:
//   • status loading or errored → renders NOTHING (never a fabricated 0/6);
//   • a legacy backend payload (4 booleans) yields the 4 derivable steps —
//     unknown signals are omitted, not shown as "not done";
//   • step 5 has an intermediate state: config saved but no test-fire →
//     "Configured — send a test to finish" (a real delivery counts it done);
//   • at full completion the card shows a ONE-TIME completion card (only when
//     this browser session actually saw the checklist incomplete — a fresh
//     session on a long-finished org never re-celebrates), then graduates away.
//
// Used by BridgeDashboard in two slots (same component, different placement):
//   • as the hero, centered, when the org has no data yet (empty topology)
//   • as a full-width band below the live topology while setup finishes

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import { buildChecklistSteps, type ChecklistStep } from "./buildChecklistSteps";

// Locked Bridge Layer tokens (see CLAUDE.md §3). Do not substitute slate values.
const T = {
  navy:      "#0B1A2F",
  blue:      "#1E66C9",
  blueDeep:  "#0F4FA8",
  blueSoft:  "#EAF0F8",
  green:     "#2E8E3A",
  greenBtn:  "#297F34", // solid fill under white text — ≈4.6:1 AA (green is 4.16:1)
  greenDeep: "#1E6D29",
  surface:   "#FFFFFF",
  surface2:  "#F1F3F7",
  border:    "#E5E8EE",
  ink:       "#0B1A2F",
  muted:     "#5E6779",
  faint:     "var(--ink-faint)",
  amber:     "#B36D14",
  amberSoft: "#FFF8EA",
};

// Session-scoped completion bookkeeping. WAS_INCOMPLETE marks that this browser
// session actually rendered the checklist in an incomplete state, so completion
// can be celebrated exactly once — and a fresh session on an org that finished
// onboarding long ago renders nothing instead of re-celebrating.
const WAS_INCOMPLETE_KEY = "plk-checklist-was-incomplete";
const CELEBRATED_KEY = "plk-checklist-celebrated";

function sessionGet(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

interface OnboardingChecklistProps {
  /** Re-opens the guided setup wizard. Only surfaced before the first supplier. */
  onResumeSetup?: () => void;
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

// ─── Card frame (shared by checklist + completion card) ─────────────────────

function CardFrame({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  return (
    <section
      aria-label={ariaLabel}
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
      {children}
    </section>
  );
}

// ─── Completion card — shown ONCE at full completion ─────────────────────────

function CompletionCard({ nounLower, onDismiss }: { nounLower: string; onDismiss: () => void }) {
  const nextLinks = [
    { href: "/settings?tab=email", label: "Set up email intake", sub: "Orders arrive by email — no manual upload." },
    { href: "/settings?tab=api",   label: "Create an API key",   sub: "Push orders in from your own systems." },
    { href: "/library/suppliers",  label: `Add another ${nounLower}`, sub: "Repeat the setup for the next connection." },
  ];
  return (
    <CardFrame ariaLabel="Onboarding complete">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[10.5px] font-bold uppercase"
              style={{ color: T.greenDeep, letterSpacing: "0.09em" }}
            >
              Setup complete
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
              Your first order is delivered
            </h2>
            <p className="mt-1 text-[12.5px]" style={{ color: T.muted }}>
              The full path works end to end: upload → review → deliver. Here&apos;s where teams usually go next.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[44px] items-center rounded-[6px] px-4 text-[13px] font-semibold transition-colors"
            style={{ border: `1px solid ${T.border}`, background: T.surface, color: T.ink, cursor: "pointer" }}
          >
            Done
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {nextLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex min-h-[44px] flex-col justify-center rounded-[8px] p-3 no-underline transition-colors hover:bg-[#F6F7FA]"
              style={{ border: `1px solid ${T.border}` }}
            >
              <span className="text-[13px] font-semibold" style={{ color: T.blueDeep }}>
                {l.label} →
              </span>
              <span className="mt-0.5 text-[11.5px] leading-snug" style={{ color: T.muted }}>
                {l.sub}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </CardFrame>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingChecklist({ onResumeSetup }: OnboardingChecklistProps) {
  // Direction-aware step copy: "supplier" → "customer" in inbound mode (display only).
  const { labels } = useOrderDirection();
  const nounLower = labels.counterpartyNoun.toLowerCase();
  const pathname = usePathname();

  const { data: status, isError } = useOnboardingStatus();
  const { runSample, isPending: samplePending, error: sampleError } = useSampleOrder(pathname ?? "/bridge");

  const model = React.useMemo(
    () => (status ? buildChecklistSteps(status, nounLower) : null),
    [status, nounLower],
  );

  // Track "this session saw the checklist incomplete" so completion is
  // celebrated exactly once, and only when it happened in front of the user.
  const incomplete = model != null && !model.complete;
  React.useEffect(() => {
    if (incomplete) sessionSet(WAS_INCOMPLETE_KEY, "1");
  }, [incomplete]);

  const [celebrationDismissed, setCelebrationDismissed] = React.useState(false);

  // Honest empty states: nothing while loading, nothing on error — a fetch
  // failure must never paint a fabricated 0/N.
  if (isError || !status || !model) return null;

  // ── Completion: one-time celebration card, then graduate away ─────────────
  if (model.complete) {
    const sawIncomplete = sessionGet(WAS_INCOMPLETE_KEY) === "1";
    const alreadyCelebrated = sessionGet(CELEBRATED_KEY) === "1";
    if (!sawIncomplete || alreadyCelebrated || celebrationDismissed) return null;
    return (
      <CompletionCard
        nounLower={nounLower}
        onDismiss={() => {
          sessionSet(CELEBRATED_KEY, "1");
          setCelebrationDismissed(true);
        }}
      />
    );
  }

  const { steps, totalDone, totalSteps, activeStep } = model;
  const progress = (totalDone / totalSteps) * 100;
  const remaining = totalSteps - totalDone;

  // Sample CTA: helps before the first real upload; once a sample exists, link
  // to it instead of minting another.
  const showSample = !steps.find((s) => s.id === "upload")?.done;
  const existingSampleHref =
    status.hasSampleOrder && status.sampleOrderId
      ? `/inbox/${encodeURIComponent(status.sampleOrderId)}?sample=1`
      : null;
  const showGuided = !steps[0].done && typeof onResumeSetup === "function";

  return (
    <CardFrame ariaLabel="Onboarding progress">
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
              ? `${totalSteps} quick steps · about 10 minutes`
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
              aria-valuemax={totalSteps}
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
              {totalDone}/{totalSteps}
            </span>
          </div>

          {/* Primary next step — green primary, 44px tap target */}
          {activeStep && (
            <Link
              href={activeStep.href}
              className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] px-4 text-[13px] font-semibold transition-colors"
              style={{
                background: `linear-gradient(90deg, ${T.greenBtn} 0%, ${T.greenDeep} 100%)`,
                color: "#fff",
                letterSpacing: "0.01em",
                boxShadow: "0 2px 8px rgba(46,142,58,0.25)",
              }}
            >
              {activeStep.cta}
              <span aria-hidden>→</span>
            </Link>
          )}

          {/* Secondary affordances */}
          <div className="mt-3 flex flex-col items-start gap-2">
            {showGuided && (
              <button
                type="button"
                onClick={onResumeSetup}
                className="min-h-[44px] text-[12px] font-semibold transition-colors"
                style={{ color: T.blueDeep, background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                Use guided setup
              </button>
            )}
            {showSample && (
              <div className="min-w-0">
                {existingSampleHref ? (
                  <Link
                    href={existingSampleHref}
                    className="inline-flex min-h-[44px] items-center text-[12px] font-semibold"
                    style={{ color: T.blueDeep }}
                  >
                    Open your practice order →
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={runSample}
                    disabled={samplePending}
                    className="inline-flex min-h-[44px] items-center text-[12px] font-semibold"
                    style={{
                      color: samplePending ? T.muted : T.blueDeep,
                      background: "none", border: "none", padding: 0,
                      cursor: samplePending ? "default" : "pointer",
                    }}
                  >
                    {samplePending ? "Starting practice order…" : "Try a practice order →"}
                  </button>
                )}
                {/* Honesty line — pre-frames the sample's intentional ending. */}
                <p className="mt-0.5 max-w-[340px] text-[11px] leading-snug" style={{ color: T.faint }}>
                  Free practice order — doesn&apos;t count against your plan. Sending stops at
                  &quot;delivery not set up&quot;, which is expected for the practice {nounLower}.
                </p>
                {sampleError && (
                  <p className="mt-1 text-[11.5px]" style={{ color: "#B43838" }}>
                    {sampleError.message || "Could not start the practice order."}
                  </p>
                )}
              </div>
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
          {steps.map((step: ChecklistStep, i: number) => {
            const { done, locked, intermediate } = step;
            const active = !done && !locked && activeStep?.id === step.id;
            const showDescription = active || done || intermediate;

            return (
              <li
                key={step.id}
                className="flex items-start gap-3 rounded-[8px] p-3"
                style={{
                  background: active ? T.blueSoft : done ? "#F3FAF4" : intermediate ? T.amberSoft : "transparent",
                  border: active
                    ? `1px solid ${T.blue}`
                    : done
                    ? "1px solid #D6EEDB"
                    : intermediate
                    ? "1px solid #F0D39A"
                    : `1px solid ${T.border}`,
                  opacity: locked ? 0.72 : 1,
                }}
              >
                {done ? <DoneMark /> : locked ? <LockMark /> : <NumberMark n={i + 1} active={active} />}
                <div className="min-w-0 flex-1" style={{ marginTop: 1 }}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className="text-[13px]"
                      style={{
                        color: done ? T.muted : locked ? T.faint : T.ink,
                        fontWeight: active ? 600 : 500,
                        textDecoration: done ? "line-through" : "none",
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {step.label}
                    </span>
                    {intermediate && (
                      <span
                        className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                        style={{ background: "#FAF1DD", color: T.amber, letterSpacing: "0.05em" }}
                      >
                        Almost there
                      </span>
                    )}
                  </div>
                  {showDescription && (
                    <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: T.muted }}>
                      {done ? "Ready for the next step." : step.description}
                    </p>
                  )}
                  {/* Intermediate step 5 keeps its own CTA visible even when a
                      different step is active — the nudge is the point. */}
                  {intermediate && !active && (
                    <Link
                      href={step.href}
                      className="mt-1 inline-flex min-h-[32px] items-center text-[12px] font-semibold"
                      style={{ color: T.blueDeep }}
                    >
                      Send a test →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </CardFrame>
  );
}
