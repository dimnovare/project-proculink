"use client";

// OnboardingWizard — the slim first-run modal: choose the org's order
// direction, create the first supplier/customer, done.
//
// Everything after that (catalog, upload, resolve, delivery, send) is owned by
// the OnboardingChecklist on the dashboard — the wizard's closing notice points
// there. The old steps 2–4 and their resume logic (which could hand the upload
// step a placeholder supplier with an empty id) were deleted with the shrink.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, updateOrgSettings, isApiMockMode } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { captureException } from "@/lib/sentry-context";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSampleOrder } from "@/hooks/useSampleOrder";
import type { Supplier, OrderDirection } from "@/types/procurement";

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  navy:    "#0B1A2F",
  blue:    "#1E66C9",
  green:   "#2E8E3A",
  greenBtn:"#297F34", // solid fill under white text — ≈4.6:1 AA (green is 4.16:1)
  surface: "#FFFFFF",
  bg:      "#F6F7FA",
  border:  "#E5E8EE",
  text:    "#0B1A2F",
  muted:   "#5E6779",
  red:     "#B43838",
};

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        marginBottom: 28,
      }}
    >
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;

        return (
          <div key={stepNum} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: isActive ? T.blue : isDone ? T.green : "transparent",
                border: isActive || isDone ? "none" : `1.8px solid ${T.border}`,
                transition: "background 0.2s, border 0.2s",
              }}
            >
              {isDone ? (
                <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                  <path
                    d="M1 4.5L4 7.5L10 1"
                    stroke="#fff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: isActive ? "#fff" : T.muted,
                    lineHeight: 1,
                  }}
                >
                  {stepNum}
                </span>
              )}
            </div>

            {i < total - 1 && (
              <div
                style={{
                  width: 36,
                  height: 2,
                  background: isDone ? T.green : T.border,
                  transition: "background 0.3s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 0 — Choose order direction (forced first step for new orgs) ─────────

interface Step0Props {
  onSuccess: (direction: OrderDirection) => void;
}

const DIRECTION_CHOICES: Array<{ value: OrderDirection; title: string }> = [
  { value: "outbound", title: "We send purchase orders to our suppliers" },
  { value: "inbound", title: "We receive purchase orders from our customers" },
];

function Step0Direction({ onSuccess }: Step0Props) {
  const [selected, setSelected] = useState<OrderDirection | null>(null);
  const [saving, setSaving] = useState<OrderDirection | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(direction: OrderDirection) {
    if (saving) return;
    // Render the chosen state immediately so screen readers announce the
    // selection and the radio dot fills before we fire-and-advance.
    setSelected(direction);
    setSaving(direction);
    setError(null);
    try {
      await updateOrgSettings(direction);
      onSuccess(direction);
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "onboarding_wizard", wizard_step: "0_direction" },
      });
      setError(err instanceof Error ? err.message : "Couldn't save your choice. Please try again.");
      setSaving(null);
      setSelected(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.text,
            margin: "0 0 6px",
            letterSpacing: "-0.02em",
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          }}
        >
          How do you use ProcuLink?
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          This sets how parties are labelled across your inbox, dashboard, and suppliers. You can change it later in Settings.
        </p>
      </div>

      <div role="radiogroup" aria-label="How do you use ProcuLink?" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {DIRECTION_CHOICES.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={saving != null}
              onClick={() => choose(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                padding: "14px 15px",
                borderRadius: 8,
                border: `1.5px solid ${isSelected ? T.blue : T.border}`,
                background: T.surface,
                cursor: saving != null ? "default" : "pointer",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: `2px solid ${isSelected ? T.blue : "#CBD0DA"}`,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "border-color 0.15s",
                }}
              >
                {isSelected && (
                  <span
                    style={{ width: 8, height: 8, borderRadius: "50%", background: T.blue }}
                  />
                )}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: T.text }}>{opt.title}</span>
              {saving === opt.value && <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>Saving…</span>}
            </button>
          );
        })}
      </div>

      {error && <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>}
    </div>
  );
}

// ─── Step 1 — Add first supplier ─────────────────────────────────────────────

interface Step1Props {
  onSuccess: (supplier: Supplier) => void;
}

function Step1AddSupplier({ onSuccess }: Step1Props) {
  // Direction-aware labels — Step 0 has already set the org direction, so this
  // reflects the user's choice ("Supplier" outbound / "Customer" inbound).
  const { labels } = useOrderDirection();
  const partyNoun = labels.counterpartyNoun;
  const partyNounLower = partyNoun.toLowerCase();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const supplier = await apiClient.createSupplier({ name: trimmed });
      onSuccess(supplier);
    } catch (err) {
      // Report to Sentry with explicit context so future "Failed to fetch"
      // reports include the user's intent + the API URL we were targeting.
      captureException(err, {
        tags: {
          ui_surface: "onboarding_wizard",
          wizard_step: "1_add_supplier",
        },
        extra: {
          api_base_url: process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)",
          supplier_name_length: trimmed.length,
        },
      });
      setError(humaniseSupplierError(err));
    } finally {
      setLoading(false);
    }
  }

  function humaniseSupplierError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    // Browser fetch network errors ("Failed to fetch", "Load failed", "NetworkError")
    // happen BEFORE any HTTP response — usually CORS preflight blocked, backend
    // unreachable, or self-signed cert untrusted. Give the user something to act on.
    if (/failed to fetch|load failed|networkerror/i.test(raw)) {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "(NEXT_PUBLIC_API_BASE_URL not set)";
      return `Couldn't reach the ProcuLink API at ${apiUrl}. ` +
        `If you're on production, set the Railway 'Frontend:Url' env var so the API CORS allow-list includes this site. ` +
        `If you're running locally, run 'dotnet dev-certs https --trust' and confirm the API is up.`;
    }
    return raw || `Failed to create ${partyNounLower}. Please try again.`;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.text,
            margin: "0 0 6px",
            letterSpacing: "-0.02em",
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          }}
        >
          Add your first {partyNounLower}
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Give this {partyNounLower} a display name. You can add delivery formats later.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor="wizard-supplier-name"
          style={{ fontSize: 12.5, fontWeight: 600, color: T.text, letterSpacing: "0.01em" }}
        >
          {partyNoun} name
        </label>
        <input
          id="wizard-supplier-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Components"
          autoFocus
          disabled={loading}
          style={{
            height: 40,
            padding: "0 12px",
            fontSize: 14,
            color: T.text,
            background: T.surface,
            border: `1px solid ${error ? T.red : T.border}`,
            borderRadius: 6,
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "Inter, sans-serif",
          }}
        />
        {error && (
          <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>
        )}
      </div>

      {isApiMockMode && (
        <p style={{ fontSize: 11.5, color: T.muted, margin: 0, padding: "8px 10px", background: T.bg, borderRadius: 5, lineHeight: 1.5 }}>
          Running in demo mode — API calls use local mock data.
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        style={{
          height: 44,
          background: loading || !name.trim() ? "#CBD0DA" : T.greenBtn,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: loading || !name.trim() ? "not-allowed" : "pointer",
          transition: "background 0.15s",
          letterSpacing: "0.01em",
        }}
      >
        {loading ? `Adding ${partyNounLower}…` : `Add ${partyNounLower} →`}
      </button>
    </form>
  );
}

// ─── Step 2 — see it work now (the step that closes the loop) ────────────────
//
// This slot used to be a dead "Open my setup guide" notice: the wizard handed the
// user back to a six-step checklist whose fifth step needed a supplier's endpoint
// and credentials, so a brand-new account could not finish in one sitting and never
// saw the product work. Now the wizard ENDS by running a whole order.
//
// The address is prefilled from the signed-in user, so the default interaction is
// "read it, press the button". It is editable because a shared purchasing inbox is a
// normal answer, and visible because sending mail on someone's behalf to an address
// they never read is not a first-run experience.

function StepSeeItWork({
  supplier,
  defaultEmail,
  running,
  error,
  onRun,
  onSkip,
}: {
  supplier: Supplier;
  defaultEmail: string;
  running: boolean;
  error: string | null;
  onRun: (deliverTo: string) => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const trimmed = email.trim();
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !running) onRun(trimmed);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.text,
            margin: "0 0 6px",
            letterSpacing: "-0.02em",
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
          }}
        >
          <strong>{supplier.name}</strong> is in. Now see it work.
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          We&apos;ll run one practice order all the way through and email you the finished
          file — the same file a real order produces. Nothing is sent to anyone else, and it
          doesn&apos;t count against your plan.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor="wizard-deliver-to"
          style={{ fontSize: 12.5, fontWeight: 600, color: T.text, letterSpacing: "0.01em" }}
        >
          Send the finished file to
        </label>
        <input
          id="wizard-deliver-to"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@your-company.example"
          disabled={running}
          style={{
            height: 44,
            padding: "0 12px",
            // 16px is the iOS zoom floor — anything smaller zooms the viewport on focus.
            fontSize: 16,
            color: T.text,
            background: T.surface,
            border: `1px solid ${error ? T.red : T.border}`,
            borderRadius: 6,
            width: "100%",
            boxSizing: "border-box",
            fontFamily: "Inter, sans-serif",
          }}
        />
        {error && <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>}
      </div>

      <button
        type="submit"
        disabled={!ready || running}
        style={{
          height: 44,
          background: !ready || running ? "#CBD0DA" : T.greenBtn,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: !ready || running ? "not-allowed" : "pointer",
          letterSpacing: "0.01em",
        }}
      >
        {running ? "Starting your practice order…" : "Run a practice order →"}
      </button>

      <button
        type="button"
        onClick={onSkip}
        disabled={running}
        style={{
          minHeight: 44,
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color: T.blue,
          cursor: running ? "default" : "pointer",
        }}
      >
        Skip — I&apos;ll upload my own order
      </button>
    </form>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  onDismiss: () => void;
}

// 0 = choose order direction · 1 = add first supplier · "done" = run a practice order.
type WizardStep = 0 | 1 | "done";

const TOTAL_STEPS = 2;

export function OnboardingWizard({ onDismiss }: OnboardingWizardProps) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { user } = useUser();
  const { runSample, isPending: samplePending, error: sampleError } = useSampleOrder(pathname ?? "/bridge");
  const [step, setStep] = useState<WizardStep>(0);
  const [firstSupplier, setFirstSupplier] = useState<Supplier | null>(null);

  // Emit wizard_opened once per mount (ref-guarded against StrictMode re-runs).
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    capture("wizard_opened", { step: 0 });
  }, []);

  function handleDismiss() {
    capture("wizard_dismissed", { at_step: step });
    onDismiss();
  }

  function handleStep0Success(direction: OrderDirection) {
    // Relabel the whole app immediately once the direction is chosen.
    queryClient.setQueryData(["org-settings"], { direction });
    void queryClient.invalidateQueries({ queryKey: ["org-settings"] });
    capture("wizard_step_completed", { step: 0, step_name: "order_direction", direction });
    setStep(1);
  }

  function handleRunPractice(deliverTo: string) {
    capture("wizard_step_completed", { step: 2, step_name: "practice_order" });
    // useSampleOrder owns the POST, the cache invalidation, and the route to the order.
    // The wizard is unmounted by that navigation, so there is nothing to close here.
    runSample(deliverTo);
  }

  function handleStep1Success(s: Supplier) {
    setFirstSupplier(s);
    // The checklist's step 1 (and the supplier-dependent surfaces) must see the
    // new supplier without waiting out a staleTime.
    void invalidateOnboardingStatus(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    capture("wizard_step_completed", { step: 1, step_name: "add_supplier" });
    setStep("done");
  }

  const indicatorCurrent = step === "done" ? TOTAL_STEPS + 1 : step + 1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(11, 26, 47, 0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Onboarding wizard"
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "28px 28px 24px",
          width: "100%",
          maxWidth: 480,
          boxSizing: "border-box",
          boxShadow: "0 8px 32px rgba(11,26,47,0.14)",
          position: "relative",
          fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleDismiss}
          aria-label="Dismiss wizard"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 28,
            height: 28,
            border: `1px solid ${T.border}`,
            borderRadius: "50%",
            background: T.surface,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke={T.muted}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <StepIndicator current={indicatorCurrent} total={TOTAL_STEPS} />

        {step === 0 && <Step0Direction onSuccess={handleStep0Success} />}
        {step === 1 && <Step1AddSupplier onSuccess={handleStep1Success} />}
        {step === "done" && firstSupplier && (
          <StepSeeItWork
            supplier={firstSupplier}
            defaultEmail={user?.primaryEmailAddress?.emailAddress ?? ""}
            running={samplePending}
            error={sampleError ? (sampleError.message || "Could not start the practice order.") : null}
            onRun={handleRunPractice}
            onSkip={onDismiss}
          />
        )}

        <p
          style={{
            fontSize: 11.5,
            color: T.muted,
            margin: "16px 0 0",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {step === "done"
            ? "Your setup guide is on the dashboard whenever you want it"
            : `Step ${step + 1} of ${TOTAL_STEPS} · You can dismiss this and come back any time`}
        </p>
      </div>
    </div>
  );
}
