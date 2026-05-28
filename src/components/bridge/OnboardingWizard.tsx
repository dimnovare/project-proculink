"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient, isApiMockMode } from "@/lib/api-client";
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
            {/* Circle */}
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

            {/* Connector line between steps */}
            {i < total - 1 && (
              <div
                style={{
                  width: 48,
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
      setError(err instanceof Error ? err.message : "Failed to create supplier. Please try again.");
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

// ─── Step 2 — Upload test PO ──────────────────────────────────────────────────

interface Step2Props {
  supplier: Supplier;
  onSuccess: (orderId: string, poNumber: string) => void;
}

function Step2UploadPO({ supplier, onSuccess }: Step2Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(selected: File | null) {
    if (!selected) return;
    setFile(selected);
    setError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.uploadPurchaseOrder(file, supplier.id);
      onSuccess(result.order.id, result.order.poNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
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
          Upload a test purchase order
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Uploading for{" "}
          <span style={{ fontWeight: 600, color: T.text }}>{supplier.name}</span>.
          Drop a CSV, XLSX, or PDF purchase order to verify the pipeline.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!loading) handleFileChange(e.dataTransfer.files[0] ?? null);
        }}
        style={{
          border: `2px dashed ${dragging ? T.blue : file ? T.green : T.border}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          cursor: loading ? "default" : "pointer",
          background: dragging ? `${T.blue}08` : file ? `${T.green}08` : T.bg,
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.pdf"
          style={{ display: "none" }}
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          disabled={loading}
        />
        {file ? (
          <>
            <div style={{ fontSize: 20, marginBottom: 6 }}>
              {file.name.endsWith(".pdf") ? "📄" : file.name.endsWith(".pdf") ? "📑" : "📊"}
            </div>
            <p style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: "0 0 3px" }}>
              {file.name}
            </p>
            <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
              {(file.size / 1024).toFixed(1)} KB · click to change
            </p>
          </>
        ) : (
          <>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: T.border,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2v9M4 6l4-4 4 4M2 13h12"
                  stroke={T.muted}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: T.text, margin: "0 0 3px" }}>
              Drop a file or click to browse
            </p>
            <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
              CSV, XLSX, or PDF · max 10 MB
            </p>
          </>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12, color: T.red, margin: 0 }}>{error}</p>
      )}

      <button
        type="button"
        disabled={loading || !file}
        onClick={handleUpload}
        style={{
          height: 40,
          background: loading || !file ? "#C6CDDA" : T.navy,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: loading || !file ? "not-allowed" : "pointer",
          transition: "background 0.15s",
          letterSpacing: "0.01em",
        }}
      >
        {loading ? "Uploading…" : "Upload PO →"}
      </button>
    </div>
  );
}

// ─── Step 3 — Review ──────────────────────────────────────────────────────────

interface Step3Props {
  orderId: string;
  poNumber: string;
  supplierName: string;
}

function Step3Review({ orderId, poNumber, supplierName }: Step3Props) {
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
          Order uploaded successfully
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: 0, lineHeight: 1.55 }}>
          Your first purchase order is in the bridge pipeline. Review it, resolve
          any item code mappings, and trigger delivery from the inbox.
        </p>
      </div>

      {/* Summary card */}
      <div
        style={{
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.green}`,
          borderRadius: 6,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.5" stroke={T.green} strokeWidth="1.4" />
            <path
              d="M4 7l2.2 2.5L10 4.5"
              stroke={T.green}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.green }}>
            Uploaded
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 12, color: T.muted, minWidth: 90 }}>PO number</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "'JetBrains Mono', monospace" }}>
              {poNumber}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 12, color: T.muted, minWidth: 90 }}>Supplier</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{supplierName}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => router.push(`/inbox/${orderId}`)}
        style={{
          height: 40,
          background: T.navy,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
          letterSpacing: "0.01em",
        }}
      >
        Review in inbox →
      </button>
    </div>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  onDismiss: () => void;
}

export function OnboardingWizard({ onDismiss }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [poNumber, setPoNumber] = useState<string>("");

  function handleStep1Success(s: Supplier) {
    setSupplier(s);
    setStep(2);
  }

  function handleStep2Success(id: string, po: string) {
    setOrderId(id);
    setPoNumber(po);
    setStep(3);
  }

  return (
    // Backdrop
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
        // Dismiss when clicking the backdrop itself (not the card)
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      {/* Card */}
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
        {/* Dismiss button */}
        <button
          onClick={onDismiss}
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

        {/* Step indicator */}
        <StepIndicator current={step} total={3} />

        {/* Step content */}
        {step === 1 && (
          <Step1AddSupplier onSuccess={handleStep1Success} />
        )}
        {step === 2 && supplier && (
          <Step2UploadPO supplier={supplier} onSuccess={handleStep2Success} />
        )}
        {step === 3 && supplier && orderId && (
          <Step3Review
            orderId={orderId}
            poNumber={poNumber}
            supplierName={supplier.name}
          />
        )}

        {/* Footer hint */}
        {step < 3 && (
          <p
            style={{
              fontSize: 11.5,
              color: T.muted,
              margin: "16px 0 0",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Step {step} of 3 · You can dismiss this and come back any time
          </p>
        )}
      </div>
    </div>
  );
}
