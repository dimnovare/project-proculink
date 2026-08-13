"use client";

// Supplier response — renders the supplier's confirmation(s) for an order:
// the headline status (Sent / Accepted / Accepted with changes / Rejected /
// No response / Needs review) plus, when present, the lines the supplier
// changed (ordered vs confirmed quantity, price, delivery date).

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { Card } from "@/components/bridge/layout/Card";
import type { SupplierConfirmation, SupplierConfirmationLine } from "@/types/procurement";

// ─── Status badge ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  sent:                  { label: "Sent",                  bg: "#EAF0F8", color: "#0F4FA8", border: "#BBD3F4" },
  accepted:              { label: "Accepted",              bg: "#E9F1EA", color: "#1E6D29", border: "#BDE0C1" },
  accepted_with_changes: { label: "Accepted with changes", bg: "#FAF1DD", color: "#9A5F0A", border: "#F0D39A" },
  needs_review:          { label: "Needs review",          bg: "#FAF1DD", color: "#9A5F0A", border: "#F0D39A" },
  rejected:              { label: "Rejected",              bg: "#FBE3E3", color: "#B43838", border: "var(--danger-soft)" },
  no_response:           { label: "No response",           bg: "#F1F3F7", color: "#5E6779", border: "#E5E8EE" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_BADGE[status] ?? { label: status, bg: "#F1F3F7", color: "#5E6779", border: "#E5E8EE" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
      {meta.label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(at: string | null | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(at: string | null | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleDateString("en-IE", { dateStyle: "medium" });
}

function money(currency: string | undefined, n: number | null): string {
  if (n == null) return "—";
  const prefix = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : (currency ? `${currency} ` : "");
  return `${prefix}${n.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
}

/** A "ordered → confirmed" pair; highlights the confirmed value when it changed. */
function Delta({ ordered, confirmed, changed }: { ordered: string; confirmed: string; changed: boolean }) {
  if (!changed) return <span style={{ color: "#0B1A2F" }}>{confirmed}</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: "var(--ink-faint)", textDecoration: "line-through" }}>{ordered}</span>
      <span style={{ color: "var(--ink-faint)" }}>→</span>
      <span style={{ color: "#9A5F0A", fontWeight: 700 }}>{confirmed}</span>
    </span>
  );
}

function ChangedLineRow({ line, currency }: { line: SupplierConfirmationLine; currency: string | undefined }) {
  const rejected = line.state === "rejected";
  const qtyChanged = line.confirmedQuantity != null && line.confirmedQuantity !== line.orderedQuantity;
  const priceChanged = line.confirmedUnitPrice != null && line.confirmedUnitPrice !== line.orderedUnitPrice;
  const dateChanged = !!line.confirmedDeliveryDate && line.confirmedDeliveryDate !== line.orderedDeliveryDate;

  return (
    <tr style={{ borderTop: "1px solid #F0F2F6", background: rejected ? "#FDF1F1" : "transparent" }}>
      <td style={{ padding: "8px 8px", fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)" }}>{line.lineNumber}</td>
      <td style={{ padding: "8px 8px", fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F" }}>
        {line.supplierItemCode || line.buyerItemCode || "—"}
      </td>
      <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
        {rejected ? <span style={{ color: "#B43838" }}>—</span> : <Delta ordered={String(line.orderedQuantity ?? "—")} confirmed={String(line.confirmedQuantity ?? "—")} changed={qtyChanged} />}
      </td>
      <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
        {rejected ? <span style={{ color: "#B43838" }}>—</span> : <Delta ordered={money(currency, line.orderedUnitPrice)} confirmed={money(currency, line.confirmedUnitPrice)} changed={priceChanged} />}
      </td>
      <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
        {rejected ? <span style={{ color: "#B43838" }}>—</span> : <Delta ordered={fmtDate(line.orderedDeliveryDate)} confirmed={fmtDate(line.confirmedDeliveryDate)} changed={dateChanged} />}
      </td>
      <td style={{ padding: "8px 8px", textAlign: "right" }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: rejected ? "#B43838" : "#9A5F0A" }}>
          {rejected ? "Rejected" : "Changed"}
        </span>
      </td>
    </tr>
  );
}

function ConfirmationCard({ confirmation, currency }: { confirmation: SupplierConfirmation; currency: string | undefined }) {
  const lines = confirmation.lines ?? [];
  const changed = lines.filter((l) => l.state === "changed" || l.state === "rejected");
  const confirmedCount = lines.filter((l) => l.state === "confirmed").length;

  return (
    <Card edge="green" flush radius={8}>
      {/* Header */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #E5E8EE", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <StatusBadge status={confirmation.status} />
        {confirmation.supplierReference && (
          <span style={{ fontSize: 11.5, color: "#5E6779" }}>
            Ref <span className="font-mono" style={{ color: "#0B1A2F" }}>{confirmation.supplierReference}</span>
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-faint)" }}>{fmtDateTime(confirmation.receivedAt)}</span>
      </div>

      <div style={{ padding: 14 }}>
        {confirmation.notes && (
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#5E6779", lineHeight: 1.5 }}>{confirmation.notes}</p>
        )}

        <div style={{ fontSize: 11.5, color: "#5E6779", marginBottom: changed.length > 0 ? 10 : 0 }}>
          {confirmedCount > 0 && <span>{confirmedCount} line{confirmedCount !== 1 ? "s" : ""} confirmed as ordered</span>}
          {confirmedCount > 0 && changed.length > 0 && <span> · </span>}
          {changed.length > 0 && <span style={{ color: "#9A5F0A", fontWeight: 600 }}>{changed.length} changed or rejected</span>}
          {lines.length === 0 && <span>No line-level detail provided.</span>}
        </div>

        {changed.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid #E5E8EE", borderRadius: 6 }}>
            <table style={{ width: "100%", minWidth: 540, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F6F7FA" }}>
                  {["Line", "Item", "Qty", "Unit price", "Delivery", ""].map((h, i) => (
                    <th key={h || i} style={{ padding: "7px 8px", textAlign: i >= 2 ? "right" : "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changed.map((l) => <ChangedLineRow key={l.lineNumber} line={l} currency={currency} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SupplierResponsePanel({ orderId, currency }: { orderId: string; currency?: string }) {
  // In mock mode (and live QA-bypass e2e) there is no Clerk session, so don't
  // fire before the auth gate is ready — otherwise the request 401s and the
  // panel flashes the error state on first paint (known clerkReady gotcha).
  const queryEnabled = useQueriesEnabled();

  const { data: confirmations, isLoading, isError, refetch } = useQuery({
    queryKey: ["order-confirmation", orderId],
    queryFn: () => apiClient.getOrderConfirmation(orderId),
    enabled: queryEnabled,
    retry: 1,
    staleTime: 30_000,
  });

  // A disabled query reports undefined data with isLoading=true; treat the
  // not-yet-ready state as loading, never as an error (known repo gotcha).
  const showLoading = !queryEnabled || (isLoading && confirmations === undefined);

  if (showLoading) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ height: 16, width: 160, background: "#E5E8EE", borderRadius: 4 }} />
        <div style={{ height: 64, background: "#F1F3F7", borderRadius: 8 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", borderRadius: 8, background: "#FFFFFF", padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>Couldn&apos;t load the supplier response</div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#5E6779", lineHeight: 1.5 }}>The confirmation feed is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => refetch()}
          aria-label="Retry loading the supplier response"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
        >
          {/* Visible chip stays 30px; the button above provides the ≥44px hit area. */}
          <span style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F", fontSize: 12, fontWeight: 600 }}>
            ↻ Retry
          </span>
        </button>
      </div>
    );
  }

  if (!confirmations || confirmations.length === 0) {
    return (
      <div style={{ border: "1px dashed #CBD0DA", borderRadius: 8, background: "#FFFFFF", padding: "20px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <StatusBadge status="no_response" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>No response yet</div>
          <div style={{ fontSize: 12, color: "#5E6779", marginTop: 1 }}>
            The supplier hasn&apos;t confirmed this order. Acknowledgements and changes will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmations.map((c) => <ConfirmationCard key={c.id} confirmation={c} currency={currency} />)}
    </div>
  );
}
