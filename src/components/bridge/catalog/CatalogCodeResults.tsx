"use client";

// CatalogCodeResults — the results half of every supplier-code lookup: the
// option list plus the one status line the current page is allowed to state.
//
// Shared by the review-screen catalog picker (WorkshopLinesView) and the
// upload-preview manual entry (MagicMappingPreview) so the two can never word
// the same verdict differently — both take the claim straight from
// catalogPageClaim and render it here. The INPUT stays with each caller; only
// this region is shared, because only this region makes claims.

import type { ReactNode } from "react";
import type { CatalogPageClaim } from "@/lib/catalogCodes";
import type { SupplierProduct } from "@/lib/api/types";

const C = {
  ink: "#0B1A2F",
  muted: "#566982",
  faint: "#8A93A6",
  border: "#E5E8EE",
  red: "#B3362A",
  // Text-only in this file (the "+" add glyph, 12px/700, on #FFFFFF): --brand-green
  // is 4.1613:1 there, --brand-green-deep 6.4128:1. Nothing here strokes or fills.
  green: "#1E6D29",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

const note: React.CSSProperties = {
  fontSize: 11,
  color: C.faint,
  padding: "4px 2px",
  lineHeight: 1.5,
};

export interface CatalogCodeResultsProps {
  /** Matches for the settled query. */
  items: ReadonlyArray<Pick<SupplierProduct, "id" | "code" | "name">>;
  /** What the current page proves — `unknown` renders no verdict at all. */
  claim: CatalogPageClaim;
  /** The query the items answer (empty = the unfiltered first page). */
  settledQuery: string;
  /** A request is in flight. */
  isFetching: boolean;
  /** The lookup FAILED — never render this as "the catalog is empty". */
  isError: boolean;
  onRetry: () => void;
  /** Options are disabled while a commit for this line is in flight. */
  busy?: boolean;
  onPick: (code: string) => void;
  /** Rendered in place of the built-in "no catalog" line (callers add their own link). */
  noCatalogNote?: ReactNode;
  /** Accessible name for the option list. */
  listLabel: string;
}

export function CatalogCodeResults({
  items,
  claim,
  settledQuery,
  isFetching,
  isError,
  onRetry,
  busy,
  onPick,
  noCatalogNote,
  listLabel,
}: CatalogCodeResultsProps) {
  return (
    <>
      {isFetching && (
        <span style={note}>{settledQuery ? "Searching the catalog…" : "Loading catalog…"}</span>
      )}

      {/* A FAILED lookup says so — it never claims the catalog is empty. */}
      {isError && (
        <span
          style={{
            ...note,
            color: C.red,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          Couldn&rsquo;t load the catalog — try again.
          <button
            type="button"
            onClick={onRetry}
            style={{
              border: `1px solid ${C.border}`,
              background: "#FFFFFF",
              color: "#5E6779",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 9px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </span>
      )}

      {/* Only a settled page with zero catalog rows may say the catalog is empty. */}
      {claim.kind === "no-catalog" &&
        (noCatalogNote ?? (
          <span style={note}>
            No catalog for this supplier yet — import one on the supplier&rsquo;s Catalog tab, or
            type the code manually.
          </span>
        ))}

      {/* The server searched the WHOLE catalog, so a plain no-match is the truth. */}
      {claim.kind === "no-match" && (
        <span style={note}>No product matches &ldquo;{claim.query}&rdquo;.</span>
      )}

      {items.length > 0 && (
        <div role="listbox" aria-label={listLabel} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              disabled={busy}
              onClick={() => onPick(p.code)}
              title={`Use ${p.code} as this line's supplier code`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "none",
                cursor: busy ? "wait" : "pointer",
                padding: "5px 6px",
                borderRadius: 6,
              }}
            >
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: C.ink,
                  flexShrink: 0,
                }}
              >
                {p.code}
              </span>
              {p.name && (
                <span
                  style={{
                    fontSize: 11,
                    color: C.muted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {p.name}
                </span>
              )}
              <span
                aria-hidden
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: C.green, flexShrink: 0 }}
              >
                +
              </span>
            </button>
          ))}
        </div>
      )}

      {/* A full page means the server had more to give — say so rather than let
          the list read as the complete answer. */}
      {claim.kind === "matches" && claim.capped && (
        <span style={note}>
          {settledQuery
            ? `Showing the first ${claim.shown} matches — refine the search.`
            : `Showing the first ${claim.shown} products — type a code or name to search the whole catalog.`}
        </span>
      )}
    </>
  );
}
