"use client";

// WorkshopGateChrome — the compact order-context header shared by EVERY gate
// state of the Order Workshop (loading, not-found/error, parse-failed,
// transform-failed, delivery-failed, delivery-held, delivery-unconfirmed,
// parsing). BridgeTopbar suppresses its breadcrumb row on /inbox/[orderId]
// ROUTE-WIDE, relying on the workshop's own header to carry the "← Inbox ·
// PO …" context — which used to be true only of the healthy mapper return.
// The gate panels are first-class exception-review surfaces, so each one now
// wraps itself in this shell instead of rendering a bare panel with no way
// back and no order identity.

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";

/**
 * Visible order title = the PO number itself ("PO 4091678643"), without
 * doubling an existing prefix. "Already prefixed" = the number starts with
 * "po" followed by a word boundary ("PO-12345", "po 12345", bare "PO") OR
 * directly by a digit ("PO12345" — there is no word boundary between "O" and
 * "1", which is exactly the case the old `/^\s*po\b/i` missed, rendering
 * "PO PO12345"). "P0123" (P-zero) and "PORTLAND-7" are NOT prefixes: neither
 * has "po" followed by a boundary or a digit. Empty/blank → "Order".
 */
export function poTitleFrom(poNumber: string | null | undefined): string {
  const trimmed = (poNumber ?? "").trim();
  if (!trimmed) return "Order";
  return /^po(?:\b|\d)/i.test(trimmed) ? trimmed : `PO ${trimmed}`;
}

/**
 * The "← Inbox" back chip — extracted verbatim from the healthy workshop
 * header (Row 1) so the gate states and the mapper share ONE control: same
 * /inbox target, same aria-label, ≥44px hit area around the compact chip.
 */
export function InboxBackChip() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/inbox")}
      aria-label="Back to inbox"
      className="plk-back"
      style={{ minWidth: 44, minHeight: 44, padding: 0, marginInline: -6, border: 0, background: "transparent", color: "#5E6779", cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      <span
        aria-hidden
        className="plk-back-box"
        style={{ height: 30, padding: "0 10px", border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", transition: "border-color .12s, background .12s" }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.background = "#EAF0F8"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E5E8EE"; e.currentTarget.style.background = "#FFFFFF"; }}
      >
        ← Inbox
      </span>
    </button>
  );
}

/**
 * The compact context row for a gate state: ← Inbox chip + the PO number +
 * the status badge (when a status is known). The PO title is the h1 — a gate
 * state replaces the whole page, and it has no other heading (the healthy
 * return carries its own sr-only h1 instead), so this keeps exactly one h1
 * per page. Same truncation contract as the healthy title: nowrap +
 * ellipsis + min-width 0 so a long PO number clips gracefully at 390px.
 */
export function WorkshopGateHeader({
  poNumber,
  status,
}: {
  poNumber?: string | null;
  status?: string | null;
}) {
  return (
    <div className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E8EE" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 lg:px-6" style={{ minHeight: 54, paddingTop: 5, paddingBottom: 5 }}>
        <InboxBackChip />
        <h1
          title={poNumber ?? undefined}
          style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.15, whiteSpace: "nowrap", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", margin: 0 }}
        >
          {poTitleFrom(poNumber)}
        </h1>
        {status ? <UnifiedStatusBadge size="md" status={status} /> : null}
      </div>
    </div>
  );
}

/**
 * Full-height wrapper for a gate panel: the context header on top, the panel
 * itself in a scrollable flex-1 body (the panels center themselves within it
 * via their own minHeight).
 */
export function WorkshopGateShell({
  poNumber,
  status,
  children,
}: {
  poNumber?: string | null;
  status?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "#F6F7FA" }} data-testid="workshop-gate-shell">
      <WorkshopGateHeader poNumber={poNumber} status={status} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
    </div>
  );
}
