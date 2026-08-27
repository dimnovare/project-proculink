"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAsns,
  isApiMockMode,
  type AsnDto,
} from "@/lib/api-client";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";
import {
  TV2,
  tv2CardStyle,
  tv2HeaderCell,
  tv2BodyCell,
  tv2RowDivider,
  tv2Num,
} from "@/components/bridge/layout/listTableV2";

// ── Status badge (domain-specific: received/pending — not the order lifecycle)
// Kept local; colors tokenized.

function StatusBadge({ status }: { status: string }) {
  const isReceived = status === "received";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0"
      style={{
        background: isReceived ? "var(--brand-green-soft)" : "var(--amber-soft)",
        color: isReceived ? "var(--brand-green-deep)" : "var(--amber-text)",
      }}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: 5,
          height: 5,
          background: isReceived ? "var(--brand-green-deep)" : "var(--amber)",
          flexShrink: 0,
        }}
      />
      {isReceived ? "Received" : "Pending"}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid var(--surface-2)" }}>
      {[120, 140, 80, 60, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 animate-pulse rounded" style={{ width: w, background: "var(--border)" }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[8px] animate-pulse" style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 16 }}>
      <div className="flex justify-between mb-2">
        <div className="h-4 w-28 rounded" style={{ background: "var(--border)" }} />
        <div className="h-4 w-16 rounded" style={{ background: "var(--border)" }} />
      </div>
      <div className="h-3 w-36 rounded" style={{ background: "var(--border)" }} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AsnsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["asns"],
    queryFn: getAsns,
    staleTime: 30_000,
  });

  const asns: AsnDto[] = data ?? [];

  return (
    <PageShell variant="wide">
      {/* titleHidden: the topbar hub tab "Shipping notices" already names this
          page ("Advance Shipping Notices" only re-announced it; sr-only h1 kept). */}
      <PageHeader
        titleHidden
        title="Shipping notices"
        sub={isLoading && !isApiMockMode ? "Loading…" : `${asns.length} notice${asns.length !== 1 ? "s" : ""}`}
      />

      {/* ASN / EDIFACT DESADV ingestion is not built (DESADV parsing requires a commercial
          EDI licence). This said the endpoint "returns 501"; backend PR 256 deleted
          `DesadvController.Upload` on 2026-08-26, so there is nothing there at all.
          We do NOT render an upload control that always fails. Any ASNs created by other
          means still render below; the notice carries the honest not-available message. */}
      <div
        className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
        style={{
          border: "1px solid var(--amber-soft, #FFF4D6)",
          borderLeft: "3px solid var(--amber, #D4900A)",
          background: "var(--amber-soft, #FFF4D6)",
          color: "var(--amber-deep, #7A5700)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber, #D4900A)", flexShrink: 0, display: "inline-block" }}
          />
          <span>
            <strong>Coming soon.</strong> ASN / EDIFACT DESADV ingestion isn't available
            yet. We'll let you know when you can upload advance shipping notices.
          </span>
        </div>
      </div>

      {/* Loading */}
      {isLoading && !isApiMockMode ? (
        <>
          <Card className="hidden sm:block overflow-hidden" dense>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["ASN #", "Supplier", "Ship date", "Packages", "Status"].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-faint)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody><SkeletonRow /><SkeletonRow /><SkeletonRow /></tbody>
            </table>
          </Card>
          <div className="flex flex-col gap-3 sm:hidden"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        </>
      ) : isError && !isApiMockMode ? (
        /* Error */
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Failed to load advance shipping notices</p>
            <p className="text-[12.5px] max-w-[360px]" style={{ color: "var(--ink-muted)" }}>
              {error?.message ?? "We couldn't reach the server. Check your connection and try again."}
            </p>
            <Button
              variant="primary"
              size="md"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        </Card>
      ) : asns.length === 0 ? (
        /* Empty — ASN ingestion is not built yet, so no upload CTA here. */
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>No advance shipping notices yet</p>
            <p className="text-[13px] max-w-[360px]" style={{ color: "var(--ink-muted)" }}>
              ASNs are sent by suppliers to confirm upcoming deliveries. Inbound ASN /
              EDIFACT DESADV ingestion is coming soon — there's nothing to upload here yet.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile rows */}
          <div className="flex flex-col gap-3 sm:hidden">
            {asns.map((asn) => (
              <MobileListRow key={asn.id}>
                <div style={{ borderLeft: "3px solid var(--brand-green)", paddingLeft: 10 }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold font-mono truncate" style={{ color: "var(--ink)" }}>{asn.asnNumber ?? "—"}</p>
                      <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-muted)" }}>{asn.supplierName ?? "—"}</p>
                    </div>
                    <StatusBadge status={asn.status} />
                  </div>
                  <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--ink-faint)" }}>
                    <span>Ship: {asn.shipDate ?? "—"}</span>
                    <span className="font-medium" style={{ color: "var(--ink)" }}>{asn.packageCount} pkg{asn.packageCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              </MobileListRow>
            ))}
          </div>

          {/* Desktop table — unified full-bleed listTableV2 treatment (tinted
              header band, 44px rows, leading status dot, border-faint dividers,
              tabular figures). */}
          <div className="hidden sm:block" style={{ ...tv2CardStyle, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={tv2HeaderCell("left", true)}>ASN #</th>
                  <th style={tv2HeaderCell()}>Supplier</th>
                  <th style={tv2HeaderCell()}>Ship date</th>
                  <th style={tv2HeaderCell("right")}>Packages</th>
                  <th style={tv2HeaderCell()}>Status</th>
                </tr>
              </thead>
              <tbody>
                {asns.map((asn, i) => (
                  <tr key={asn.id} style={{ borderTop: i === 0 ? "none" : tv2RowDivider }}>
                    <td style={tv2BodyCell("left", true)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span
                          aria-hidden
                          style={{ width: 7, height: 7, borderRadius: "50%", background: asn.status === "received" ? TV2.dot.success : TV2.dot.warning, flexShrink: 0 }}
                        />
                        <span className="font-mono tabular-nums" style={{ color: TV2.ink, fontWeight: 600 }}>{asn.asnNumber ?? "—"}</span>
                      </div>
                    </td>
                    <td style={{ ...tv2BodyCell(), color: TV2.inkMuted }}>{asn.supplierName ?? "—"}</td>
                    <td style={{ ...tv2BodyCell(), color: TV2.inkMuted }}>{asn.shipDate ?? "—"}</td>
                    <td style={{ ...tv2BodyCell("right"), ...tv2Num, color: TV2.ink, fontWeight: 500 }}>{asn.packageCount}</td>
                    <td style={tv2BodyCell()}><StatusBadge status={asn.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
