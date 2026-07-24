"use client";

// CatalogHintCard — review-screen hint for the catalog cliff (onboarding
// overhaul task 7; design: 2026-06-12-onboarding-overhaul-design.md). Mounted in
// the Order Workshop's Issues tab and in the mobile triage view.
//
// PER-SUPPLIER probe through useCatalogCodeSearch's empty-query entry — the SAME
// ["supplier-catalog-codes", supplierId] cache entry the review screen's catalog
// picker and the upload-preview typeahead use, so this costs zero extra
// requests. NOT the org-level hasCatalog flag, so the hint re-teaches on every
// NEW supplier, not just the first.
//
// Shows only when the order has unresolved lines, no item mapping resolved
// anything, and the supplier's catalog is KNOWN empty (shouldShowCatalogHint).
// Renders NOTHING while loading or on error, and self-resolves (disappears)
// once a catalog exists or lines resolve. Additive-only: no resolve/send
// behaviour is touched.

import Link from "next/link";
import { useCatalogCodeSearch } from "@/hooks/useCatalogCodeSearch";
import { hasAssignedSupplier } from "@/lib/catalogCodes";
import { shouldShowCatalogHint, type CatalogProbeState } from "./catalogHint";

export function CatalogHintCard({
  supplierId,
  supplierName,
  hasUnresolvedLines,
  anyLineResolved,
}: {
  supplierId: string;
  /** Display name — direction-aware party copy uses the actual name. */
  supplierName: string;
  /** Server truth: lines still needing a code (exceptionCount > 0). */
  hasUnresolvedLines: boolean;
  /** At least one line already carries a supplier code. */
  anyLineResolved: boolean;
}) {
  // An unrouted order carries Guid.Empty — there is no supplier, so the card must
  // neither probe nor speak.
  const routed = hasAssignedSupplier(supplierId);

  // The shared empty-query probe (same cache entry as the code pickers).
  const catalog = useCatalogCodeSearch({ supplierId, query: "", enabled: routed });

  const catalogState: CatalogProbeState =
    catalog.claim.kind === "unknown"
      ? "unknown"
      : catalog.claim.kind === "no-catalog"
        ? "known-empty"
        : "has-rows";

  if (!routed || !shouldShowCatalogHint({ hasUnresolvedLines, anyLineResolved, catalogState })) {
    return null;
  }

  const name = supplierName?.trim() || "this supplier";

  return (
    <div
      role="note"
      aria-label="Catalog hint"
      data-testid="catalog-hint-card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        margin: "10px 16px 0",
        padding: "10px 12px",
        borderRadius: 10,
        background: "#FFFFFF",
        border: "1px solid #E5E8EE",
        borderLeft: "3px solid #2E8E3A",
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "#0B1A2F" }}>
          No item codes for {name} yet.
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#5E6779", lineHeight: 1.45 }}>
          Upload their catalog once and ProcuLink auto-matches future orders.
        </p>
      </div>
      <Link
        href={`/library/suppliers/${supplierId}?tab=catalog`}
        style={{
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: "var(--tap-min)",
          height: 30,
          padding: "0 12px",
          borderRadius: 7,
          background: "#FFFFFF",
          border: "1px solid #BfE6CB",
          color: "#1E6D29",
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Upload catalog →
      </Link>
    </div>
  );
}
