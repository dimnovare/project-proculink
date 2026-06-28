"use client";

// CatalogHintCard — review-screen hint for the catalog cliff (onboarding
// overhaul task 7; design: 2026-06-12-onboarding-overhaul-design.md).
//
// PER-SUPPLIER probe via the existing GET /api/suppliers/{id}/catalog (shares
// the ["supplier-catalog-codes", supplierId] cache entry SpineReview already
// uses for the typeahead — zero extra requests). NOT the org-level
// hasCatalog flag, so the hint re-teaches on every NEW supplier, not just the
// first.
//
// Shows only when the order has unresolved lines, no item mapping resolved
// anything, and the supplier's catalog is KNOWN empty (shouldShowCatalogHint).
// Renders NOTHING while loading or on error, and self-resolves (disappears)
// once a catalog exists or lines resolve. Additive-only: no resolve/send
// behaviour is touched.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getSupplierCatalog } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
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
  const queryEnabled = useQueriesEnabled();

  // Same query key + shape as SpineReview's typeahead probe → shared cache.
  const catalog = useQuery({
    queryKey: ["supplier-catalog-codes", supplierId],
    queryFn: () => getSupplierCatalog(supplierId, undefined, 1000),
    enabled: queryEnabled && !!supplierId,
    staleTime: 60_000,
    retry: 1,
  });

  const catalogState: CatalogProbeState = !catalog.isSuccess
    ? "unknown"
    : (catalog.data?.items?.length ?? 0) > 0 || (catalog.data?.total ?? 0) > 0
      ? "has-rows"
      : "known-empty";

  if (!shouldShowCatalogHint({ hasUnresolvedLines, anyLineResolved, catalogState })) {
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
