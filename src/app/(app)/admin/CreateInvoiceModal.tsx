"use client";

// Create-invoice modal for the owner/admin area.
//
// Picks an org, collects 1+ line items (description, amount in EUR, quantity),
// and POSTs to /api/admin/invoices. Stripe handles the PDF / VAT / payment —
// we just create the invoice and surface the resulting hosted URL.
//
// EUR → amountCents mapping: the user types a human EUR amount (e.g. "49.90");
// we Math.round(eur * 100) so 49.90 → 4990 cents. amountCents is PER-UNIT;
// the backend multiplies by quantity. amountCents must be > 0.

import { useMemo, useRef, useState } from "react";
import { X, Check, Plus, ExternalLink } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import {
  createAdminInvoice,
  type AdminOrganisation,
  type CreateAdminInvoiceResult,
} from "@/lib/api-client";

const NAVY = "#0B1A2F";
const BLUE = "#1E66C9";
const BLUE_DEEP = "#0F4FA8";

interface DraftLine {
  description: string;
  /** Raw EUR string as typed (e.g. "49.90"). Converted to cents on submit. */
  amountEur: string;
  /** Raw quantity string as typed. */
  quantity: string;
}

/** "49.90" / "49,90" → 4990 cents. Returns null when not a positive amount. */
function eurToCents(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const eur = Number(normalized);
  if (!Number.isFinite(eur) || eur <= 0) return null;
  return Math.round(eur * 100);
}

function parseQty(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 1; // backend default
  const q = Number(trimmed);
  if (!Number.isInteger(q) || q < 1) return null;
  return q;
}

export function CreateInvoiceModal({
  organisations,
  defaultOrganisationId,
  onClose,
}: {
  organisations: AdminOrganisation[];
  defaultOrganisationId?: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [organisationId, setOrganisationId] = useState(
    defaultOrganisationId ?? organisations[0]?.id ?? "",
  );
  const [currency, setCurrency] = useState("eur");
  const [lines, setLines] = useState<DraftLine[]>([
    { description: "", amountEur: "", quantity: "1" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateAdminInvoiceResult | null>(null);

  const selectedOrg = useMemo(
    () => organisations.find((o) => o.id === organisationId) ?? null,
    [organisations, organisationId],
  );

  // Escape-to-close + body-scroll lock + focus-in + focus-trap + focus-restore.
  // Was a local copy that did the first three and neither of the last two.
  // Mounted only while open, so `open` is constant true.
  useDialogA11y({ open: true, onClose, panelRef: dialogRef });

  // Live preview total, in cents, so the user sees what Stripe will charge.
  const totalCents = lines.reduce((sum, l) => {
    const cents = eurToCents(l.amountEur);
    const qty = parseQty(l.quantity);
    if (cents == null || qty == null) return sum;
    return sum + cents * qty;
  }, 0);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: "", amountEur: "", quantity: "1" }]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  // Validate everything before enabling submit so the modal never sends a body
  // the backend will 400. Mirrors the backend's >0 / non-empty-lines rules.
  const validation = useMemo(() => {
    if (!organisationId) return "Pick an organisation.";
    if (selectedOrg && !selectedOrg.stripeCustomerId) {
      return "This organisation has no Stripe customer — create one in Stripe first.";
    }
    const filled = lines.filter(
      (l) => l.description.trim() || l.amountEur.trim() || l.quantity.trim() !== "1",
    );
    const effective = filled.length > 0 ? filled : lines;
    for (const [i, l] of effective.entries()) {
      if (!l.description.trim()) return `Line ${i + 1}: description is required.`;
      if (eurToCents(l.amountEur) == null) return `Line ${i + 1}: amount must be greater than €0.`;
      if (parseQty(l.quantity) == null) return `Line ${i + 1}: quantity must be a whole number ≥ 1.`;
    }
    return null;
  }, [organisationId, selectedOrg, lines]);

  async function handleSubmit() {
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    const lineItems = lines
      .map((l) => ({
        description: l.description.trim(),
        amountCents: eurToCents(l.amountEur)!, // validated above
        quantity: parseQty(l.quantity)!,
      }))
      .filter((l) => l.description && l.amountCents > 0);

    setSubmitting(true);
    try {
      const res = await createAdminInvoice({
        organisationId,
        lineItems,
        currency: currency.trim().toLowerCase() || "eur",
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invoice.");
    } finally {
      setSubmitting(false);
    }
  }

  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format(cents / 100);

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
        aria-label="Create invoice"
        className="w-full max-w-[560px] rounded-[14px]"
        style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 24px 60px rgba(11,26,47,0.28)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #EEF0F4" }}>
          <h2 className="text-[17px] font-semibold" style={{ fontFamily: "var(--font-display)", color: NAVY }}>
            Create invoice
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[6px]"
            style={{ color: "var(--ink-faint)", border: "1px solid transparent", cursor: "pointer" }}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {result ? (
            <div>
              <div
                className="mb-3 flex items-center gap-2 rounded-[10px] px-4 py-3 text-[13px]"
                style={{ background: "#E2F1E2", border: "1px solid #BFE3BF", color: "#1E6D29" }}
              >
                <Check size={15} strokeWidth={2.25} aria-hidden className="flex-shrink-0" />
                <span>Invoice created — status <strong>{result.status}</strong>.</span>
              </div>
              <dl className="text-[13px]" style={{ color: NAVY }}>
                <div className="flex gap-2 py-1">
                  <dt style={{ color: "#56627A", minWidth: 96 }}>Invoice ID</dt>
                  <dd className="font-mono break-all">{result.invoiceId}</dd>
                </div>
              </dl>
              {result.hostedInvoiceUrl ? (
                <a
                  href={result.hostedInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[7px] px-4 py-2 text-[13px] font-semibold"
                  style={{ background: BLUE, color: "#FFFFFF", textDecoration: "none" }}
                >
                  Open hosted invoice
                  <ExternalLink size={14} strokeWidth={2} aria-hidden />
                </a>
              ) : (
                <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
                  No hosted invoice URL was returned (the invoice may be a draft in Stripe).
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Organisation */}
              <label className="mb-1 block text-[12px] font-semibold" style={{ color: "#56627A" }}>
                Organisation
              </label>
              <select
                value={organisationId}
                onChange={(e) => setOrganisationId(e.target.value)}
                className="mb-1 w-full rounded-[8px] px-3 py-2 text-[13px]"
                style={{ border: "1px solid #D9DEE8", background: "#FFFFFF", color: NAVY }}
              >
                {organisations.length === 0 && <option value="">No organisations</option>}
                {organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.plan}){o.stripeCustomerId ? "" : " — no Stripe customer"}
                  </option>
                ))}
              </select>
              {selectedOrg && !selectedOrg.stripeCustomerId && (
                <p className="mb-2 text-[11.5px]" style={{ color: "#C53A3A" }}>
                  This org has no Stripe customer, so an invoice can&apos;t be created for it yet.
                </p>
              )}

              {/* Line items */}
              <div className="mt-3 mb-1 flex items-center justify-between">
                <span className="text-[12px] font-semibold" style={{ color: "#56627A" }}>Line items</span>
                <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>Amounts in EUR, per unit</span>
              </div>
              <div className="flex flex-col gap-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <input
                      value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      placeholder="Description"
                      aria-label={`Line ${i + 1} description`}
                      className="flex-1 rounded-[8px] px-3 py-2 text-[13px]"
                      style={{ border: "1px solid #D9DEE8", color: NAVY }}
                    />
                    <input
                      value={l.amountEur}
                      onChange={(e) => setLine(i, { amountEur: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Line ${i + 1} amount in EUR`}
                      className="rounded-[8px] px-3 py-2 text-[13px] sm:w-[96px]"
                      style={{ border: "1px solid #D9DEE8", color: NAVY }}
                    />
                    <input
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                      inputMode="numeric"
                      placeholder="1"
                      aria-label={`Line ${i + 1} quantity`}
                      className="rounded-[8px] px-3 py-2 text-[13px] sm:w-[64px]"
                      style={{ border: "1px solid #D9DEE8", color: NAVY }}
                    />
                    <button
                      onClick={() => removeLine(i)}
                      disabled={lines.length === 1}
                      aria-label={`Remove line ${i + 1}`}
                      className="inline-flex items-center justify-center rounded-[8px] px-2 py-2 text-[13px] sm:w-[40px]"
                      style={{
                        border: "1px solid #E2E6EE",
                        background: "#FFFFFF",
                        // Disabled glyph was #C5CBD6 (1.6:1 on white) — ink-faint keeps it
                        // visibly muted while staying legible (5.6:1).
                        color: lines.length === 1 ? "var(--ink-faint)" : "#C53A3A",
                        cursor: lines.length === 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      <X size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addLine}
                className="mt-2 inline-flex items-center gap-1 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium"
                style={{ border: "1px dashed #C5D2E4", background: "#FFFFFF", color: BLUE_DEEP, cursor: "pointer" }}
              >
                <Plus size={13} strokeWidth={2.25} aria-hidden />
                Add line item
              </button>

              {/* Currency + total */}
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-semibold" style={{ color: "#56627A" }}>
                    Currency
                  </label>
                  <input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    aria-label="Currency"
                    className="w-[88px] rounded-[8px] px-3 py-2 text-[13px] uppercase"
                    style={{ border: "1px solid #D9DEE8", color: NAVY }}
                  />
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)" }}>
                    Total
                  </div>
                  <div className="text-[20px] font-bold" style={{ color: NAVY, fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoney(totalCents)}
                  </div>
                </div>
              </div>

              {error && (
                <div
                  className="mt-3 rounded-[8px] px-3 py-2 text-[12.5px]"
                  // Tokens, not the stale CLAUDE.md §3 danger values: the stale
                  // red on the stale soft-red fill is 4.2567:1 at 12.5px, under
                  // the 4.5:1 AA floor. --danger on --danger-soft is 4.9183:1.
                  // Raw-hex drift was DIRECTLY causing the contrast failure here.
                  // (Hex values omitted — check-tokens.mjs scans comments.)
                  style={{ background: "var(--danger-soft)", border: "1px solid #F0B4B4", color: "var(--danger)" }}
                >
                  {error}
                </div>
              )}
            </>
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
                disabled={submitting || validation != null}
                className="rounded-[8px] px-4 py-2 text-[13px] font-semibold"
                style={{
                  background: submitting || validation != null ? "#9FB6DC" : BLUE,
                  color: "#FFFFFF",
                  border: 0,
                  cursor: submitting || validation != null ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Creating…" : "Create invoice"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
