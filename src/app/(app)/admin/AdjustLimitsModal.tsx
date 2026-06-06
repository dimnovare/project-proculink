"use client";

// Adjust-limits / extend-pilot modal for the owner/admin area.
//
// Sets per-org overrides on POST /api/admin/organisations/{id}/limits:
//   • orderLimitOverride / supplierLimitOverride — replace the plan default caps.
//   • extendTrialDays (relative) OR trialEndsAtOverride (absolute date) — move the
//     pilot window. They are mutually exclusive in the UI to avoid an ambiguous
//     body; "extend by N days" is the common operator action.
//   • clearOrderLimit / clearSupplierLimit / clearTrialEnds — reset a field back
//     to its plan default.
//
// On success it shows the returned EFFECTIVE limits and tells the caller to
// refresh the customers table. Styling mirrors CreateInvoiceModal (same Bridge
// tokens, same a11y: Escape-to-close, body-scroll lock, focus-in, mobile-safe).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  setOrgLimits,
  type AdminOrganisation,
} from "@/lib/api-client";
import type { OrgLimitsResponse, SetOrgLimitsRequest } from "@/types/procurement";

const NAVY = "#0B1A2F";
const BLUE = "#1E66C9";

/** Parse a non-negative integer field; "" → undefined (untouched). null = invalid. */
function parseIntField(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IE", { year: "numeric", month: "short", day: "numeric" });
}

export function AdjustLimitsModal({
  org,
  onClose,
  onSaved,
}: {
  org: AdminOrganisation;
  onClose: () => void;
  /** Called after a successful save so the parent can refetch the table. */
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [orderLimit, setOrderLimit] = useState("");
  const [supplierLimit, setSupplierLimit] = useState("");
  // Trial control: "none" (leave as-is) | "extend" (add days) | "date" (absolute).
  const [trialMode, setTrialMode] = useState<"none" | "extend" | "date">("none");
  const [extendDays, setExtendDays] = useState("");
  const [trialDate, setTrialDate] = useState("");
  const [clearOrderLimit, setClearOrderLimit] = useState(false);
  const [clearSupplierLimit, setClearSupplierLimit] = useState(false);
  const [clearTrialEnds, setClearTrialEnds] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrgLimitsResponse | null>(null);

  // Escape-to-close + body-scroll lock + focus-in. Mirrors CreateInvoiceModal.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    }, 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const parsedOrder = useMemo(() => parseIntField(orderLimit), [orderLimit]);
  const parsedSupplier = useMemo(() => parseIntField(supplierLimit), [supplierLimit]);
  const parsedDays = useMemo(() => parseIntField(extendDays), [extendDays]);

  const validation = useMemo(() => {
    if (parsedOrder === null) return "Order limit must be a whole number ≥ 0.";
    if (parsedSupplier === null) return "Supplier limit must be a whole number ≥ 0.";
    if (clearOrderLimit && parsedOrder !== undefined)
      return "Either set an order limit or clear it — not both.";
    if (clearSupplierLimit && parsedSupplier !== undefined)
      return "Either set a supplier limit or clear it — not both.";
    if (trialMode === "extend") {
      if (parsedDays === null) return "Extend days must be a whole number ≥ 0.";
      if (parsedDays === undefined) return "Enter the number of days to extend the trial.";
    }
    if (trialMode === "date" && !trialDate.trim()) return "Pick a trial end date.";
    if (clearTrialEnds && trialMode !== "none")
      return "Either change the trial window or clear it — not both.";
    return null;
  }, [parsedOrder, parsedSupplier, parsedDays, clearOrderLimit, clearSupplierLimit, trialMode, trialDate, clearTrialEnds]);

  // Build the request body — only include fields the operator actually touched.
  const body = useMemo<SetOrgLimitsRequest>(() => {
    const b: SetOrgLimitsRequest = {};
    if (parsedOrder !== undefined && parsedOrder !== null) b.orderLimitOverride = parsedOrder;
    if (parsedSupplier !== undefined && parsedSupplier !== null) b.supplierLimitOverride = parsedSupplier;
    if (clearOrderLimit) b.clearOrderLimit = true;
    if (clearSupplierLimit) b.clearSupplierLimit = true;
    if (trialMode === "extend" && parsedDays != null) b.extendTrialDays = parsedDays;
    if (trialMode === "date" && trialDate.trim()) {
      // <input type=date> gives yyyy-MM-dd; send as ISO at end-of-day UTC.
      b.trialEndsAtOverride = new Date(`${trialDate}T23:59:59Z`).toISOString();
    }
    if (clearTrialEnds) b.clearTrialEnds = true;
    return b;
  }, [parsedOrder, parsedSupplier, parsedDays, clearOrderLimit, clearSupplierLimit, trialMode, trialDate, clearTrialEnds]);

  const hasChange = Object.keys(body).length > 0;

  async function handleSubmit() {
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    if (!hasChange) {
      setError("Nothing to change — set or clear at least one field.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await setOrgLimits(org.id, body);
      setResult(res);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update limits.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6"
      style={{ background: "rgba(11,26,47,0.55)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Adjust limits"
        className="w-full max-w-[520px] rounded-[14px]"
        style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 24px 60px rgba(11,26,47,0.28)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #EEF0F4" }}>
          <div>
            <h2 className="text-[17px] font-semibold" style={{ fontFamily: "var(--font-display)", color: NAVY }}>
              Adjust limits
            </h2>
            <div className="mt-0.5 text-[12px]" style={{ color: "#8A93A5" }}>
              {org.name} · {org.plan} · {org.accountStatus.replace(/_/g, " ")}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[6px]"
            style={{ color: "#8A93A5", border: "1px solid transparent", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {result ? (
            <div>
              <div
                className="mb-3 rounded-[10px] px-4 py-3 text-[13px]"
                style={{ background: "#E2F1E2", border: "1px solid #BFE3BF", color: "#1E6D29" }}
              >
                ✓ Limits updated for <strong>{result.name}</strong>.
              </div>
              <dl className="text-[13px]" style={{ color: NAVY }}>
                <Row label="Effective orders" value={result.effectiveOrderLimit.toLocaleString()} />
                <Row label="Effective suppliers" value={result.effectiveSupplierLimit.toLocaleString()} />
                <Row label="Trial ends" value={shortDate(result.effectiveTrialEndsAt)} />
                <Row
                  label="Order override"
                  value={result.orderLimitOverride != null ? result.orderLimitOverride.toLocaleString() : "plan default"}
                />
                <Row
                  label="Supplier override"
                  value={result.supplierLimitOverride != null ? result.supplierLimitOverride.toLocaleString() : "plan default"}
                />
              </dl>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Order + supplier limits */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumField
                  label="Order limit override"
                  hint={`Plan default applies if cleared`}
                  value={orderLimit}
                  onChange={setOrderLimit}
                  disabled={clearOrderLimit}
                  clearChecked={clearOrderLimit}
                  onClear={setClearOrderLimit}
                  placeholder="e.g. 1000"
                />
                <NumField
                  label="Supplier limit override"
                  hint={`Plan default applies if cleared`}
                  value={supplierLimit}
                  onChange={setSupplierLimit}
                  disabled={clearSupplierLimit}
                  clearChecked={clearSupplierLimit}
                  onClear={setClearSupplierLimit}
                  placeholder="e.g. 25"
                />
              </div>

              {/* Trial / pilot window */}
              <div>
                <label className="mb-1 block text-[12px] font-semibold" style={{ color: "#56627A" }}>
                  Pilot / trial window
                </label>
                <select
                  value={trialMode}
                  onChange={(e) => {
                    setTrialMode(e.target.value as "none" | "extend" | "date");
                    if (e.target.value !== "none") setClearTrialEnds(false);
                  }}
                  disabled={clearTrialEnds}
                  className="mb-2 w-full rounded-[8px] px-3 py-2 text-[13px]"
                  style={{ border: "1px solid #D9DEE8", background: clearTrialEnds ? "#F6F7FA" : "#FFFFFF", color: NAVY }}
                >
                  <option value="none">Leave trial window unchanged</option>
                  <option value="extend">Extend by N days</option>
                  <option value="date">Set an end date</option>
                </select>

                {trialMode === "extend" && (
                  <input
                    value={extendDays}
                    onChange={(e) => setExtendDays(e.target.value)}
                    inputMode="numeric"
                    placeholder="Days to add, e.g. 30"
                    aria-label="Days to extend trial"
                    className="w-full rounded-[8px] px-3 py-2 text-[13px]"
                    style={{ border: "1px solid #D9DEE8", color: NAVY }}
                  />
                )}
                {trialMode === "date" && (
                  <input
                    type="date"
                    value={trialDate}
                    onChange={(e) => setTrialDate(e.target.value)}
                    aria-label="Trial end date"
                    className="w-full rounded-[8px] px-3 py-2 text-[13px]"
                    style={{ border: "1px solid #D9DEE8", color: NAVY }}
                  />
                )}

                <label className="mt-2 flex items-center gap-2 text-[12.5px]" style={{ color: "#56627A" }}>
                  <input
                    type="checkbox"
                    checked={clearTrialEnds}
                    onChange={(e) => {
                      setClearTrialEnds(e.target.checked);
                      if (e.target.checked) setTrialMode("none");
                    }}
                  />
                  Clear trial end (reset to plan default)
                </label>
              </div>

              {error && (
                <div
                  className="rounded-[8px] px-3 py-2 text-[12.5px]"
                  style={{ background: "#FBE3E3", border: "1px solid #F0B4B4", color: "#C53A3A" }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: "1px solid #EEF0F4" }}>
          {result ? (
            <button
              onClick={onClose}
              className="rounded-[8px] px-4 py-2 text-[13px] font-semibold"
              style={{ background: BLUE, color: "#FFFFFF", border: 0, cursor: "pointer" }}
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-[8px] px-4 py-2 text-[13px] font-medium"
                style={{ background: "#FFFFFF", color: "#56627A", border: "1px solid #E2E6EE", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || validation != null || !hasChange}
                className="rounded-[8px] px-4 py-2 text-[13px] font-semibold"
                style={{
                  background: submitting || validation != null || !hasChange ? "#9FB6DC" : BLUE,
                  color: "#FFFFFF",
                  border: 0,
                  cursor: submitting || validation != null || !hasChange ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Saving…" : "Save limits"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small primitives ──────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1">
      <dt style={{ color: "#56627A", minWidth: 132 }}>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function NumField({
  label, hint, value, onChange, disabled, clearChecked, onClear, placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  clearChecked: boolean;
  onClear: (v: boolean) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold" style={{ color: "#56627A" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        className="w-full rounded-[8px] px-3 py-2 text-[13px]"
        style={{ border: "1px solid #D9DEE8", background: disabled ? "#F6F7FA" : "#FFFFFF", color: NAVY }}
      />
      <label className="mt-1.5 flex items-center gap-2 text-[11.5px]" style={{ color: "#8A93A5" }}>
        <input type="checkbox" checked={clearChecked} onChange={(e) => onClear(e.target.checked)} />
        Clear · {hint}
      </label>
    </div>
  );
}
