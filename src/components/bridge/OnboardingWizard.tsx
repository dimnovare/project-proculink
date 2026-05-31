"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { captureException } from "@/lib/sentry-context";
import type { Supplier } from "@/types/procurement";

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  navy:    "#0B1A2F",
  blue:    "#1E66C9",
  green:   "#2E8E3A",
  surface: "#FFFFFF",
  bg:      "#F6F7FA",
  border:  "#E2E6EE",
  text:    "#0B1A2F",
  muted:   "#56627A",
  red:     "#C53A3A",
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

// ─── Step 1 — Add first supplier ─────────────────────────────────────────────

interface Step1Props {
  onSuccess: (supplier: Supplier) => void;
}

function Step1AddSupplier({ onSuccess }: Step1Props) {
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
    return raw || "Failed to create supplier. Please try again.";
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
          Add your first supplier
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Give this supplier a display name. You can add delivery formats later.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor="wizard-supplier-name"
          style={{ fontSize: 12.5, fontWeight: 600, color: T.text, letterSpacing: "0.01em" }}
        >
          Supplier name
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
            outline: "none",
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
          height: 40,
          background: loading || !name.trim() ? "#C6CDDA" : T.navy,
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
        {loading ? "Adding supplier…" : "Add supplier →"}
      </button>
    </form>
  );
}

// ─── Step 2 — Upload first purchase order ────────────────────────────────────

interface Step2Props {
  defaultSupplier: Supplier;
  onSuccess: (orderId: string) => void;
}

function Step2UploadOrder({ defaultSupplier, onSuccess }: Step2Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.uploadPurchaseOrder(file, defaultSupplier.id);
      onSuccess(result.order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
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
          Upload your first purchase order
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Upload a purchase order (CSV, XLSX, PDF, XML/cXML, or EDI) for{" "}
          <strong style={{ color: T.text }}>{defaultSupplier.name}</strong>. ProcuLink will parse the lines.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.xml,.cxml,.pdf,.edi,.txt"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={loading}
        style={{ fontSize: 13 }}
      />

      {error && <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>}

      <button
        type="submit"
        disabled={loading || !file}
        style={{
          height: 40,
          background: loading || !file ? "#C6CDDA" : T.navy,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: loading || !file ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Uploading…" : "Upload and parse"}
      </button>
    </form>
  );
}

// ─── Step 3 — Resolve mapping ────────────────────────────────────────────────

interface Step3Props {
  orderId: string | null;
  onSuccess: () => void;
}

function Step3ResolveMapping({ orderId, onSuccess }: Step3Props) {
  const router = useRouter();

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
          Review and resolve
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          We&apos;ll take you to the order review screen. Confirm field mappings and any line items that need supplier codes, then click &quot;Resolve all&quot;.
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          onSuccess();
          router.push(orderId ? `/inbox/${orderId}` : "/inbox");
        }}
        style={{
          height: 40,
          background: T.navy,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Open order review
      </button>
    </div>
  );
}

// ─── Step 4 — Configure delivery ─────────────────────────────────────────────

interface Step4Props {
  supplier: Supplier | null;
  onSuccess: () => void;
}

function Step4ConfigureDelivery({ supplier, onSuccess }: Step4Props) {
  const router = useRouter();

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
          Configure delivery
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Tell ProcuLink how to deliver finished orders{supplier ? <> to <strong style={{ color: T.text }}>{supplier.name}</strong></> : null}. HTTP webhook is the simplest option for first delivery.
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          onSuccess();
          router.push(supplier ? `/library/suppliers/${supplier.id}?tab=delivery` : "/library/suppliers");
        }}
        style={{
          height: 40,
          background: T.navy,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Open delivery config
      </button>
    </div>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  onDismiss: () => void;
}

type WizardStep = 1 | 2 | 3 | 4;

export function OnboardingWizard({ onDismiss }: OnboardingWizardProps) {
  const { data: status } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => apiClient.getOnboardingStatus(),
    retry: false,
    staleTime: 30 * 1000,
  });

  const entryStep: WizardStep = useMemo(() => {
    if (!status) return 1;
    if (!status.hasSupplier) return 1;
    if (!status.hasUpload) return 2;
    if (!status.hasResolvedMapping) return 3;
    if (!status.hasDelivery) return 4;
    return 4;
  }, [status]);

  const [step, setStep] = useState<WizardStep>(1);
  const [firstSupplier, setFirstSupplier] = useState<Supplier | null>(null);
  const [firstOrderId, setFirstOrderId] = useState<string | null>(null);
  const initialisedRef = useRef(false);

  // Initialise step from server status on first successful query and emit wizard_opened.
  useEffect(() => {
    if (initialisedRef.current) return;
    if (!status) return;
    initialisedRef.current = true;
    setStep(entryStep);
    capture("wizard_opened", { step: entryStep });
  }, [status, entryStep]);

  function handleDismiss() {
    capture("wizard_dismissed", { at_step: step });
    onDismiss();
  }

  function handleStep1Success(s: Supplier) {
    setFirstSupplier(s);
    capture("wizard_step_completed", { step: 1, step_name: "add_supplier" });
    setStep(2);
  }

  function handleStep2Success(orderId: string) {
    setFirstOrderId(orderId);
    capture("wizard_step_completed", { step: 2, step_name: "upload_order" });
    setStep(3);
  }

  function handleStep3Success() {
    capture("wizard_step_completed", { step: 3, step_name: "resolve_mapping_started" });
    setStep(4);
  }

  function handleStep4Success() {
    capture("wizard_step_completed", { step: 4, step_name: "delivery_config_opened" });
    onDismiss();
  }

  // For Step 2, we need a supplier. If user resumes at step 2+ without local
  // firstSupplier, we fall back to a placeholder — the actual supplier was set
  // earlier in a previous session.
  const step2Supplier: Supplier | null =
    firstSupplier ?? (status?.hasSupplier ? { id: "", name: "your supplier" } : null);

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

        <StepIndicator current={step} total={4} />

        {step === 1 && <Step1AddSupplier onSuccess={handleStep1Success} />}
        {step === 2 && step2Supplier && (
          <Step2UploadOrder defaultSupplier={step2Supplier} onSuccess={handleStep2Success} />
        )}
        {step === 3 && (
          <Step3ResolveMapping orderId={firstOrderId} onSuccess={handleStep3Success} />
        )}
        {step === 4 && (
          <Step4ConfigureDelivery supplier={firstSupplier} onSuccess={handleStep4Success} />
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
          Step {step} of 4 · You can dismiss this and come back any time
        </p>
      </div>
    </div>
  );
}
