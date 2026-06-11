"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAsns,
  uploadAsn,
  isApiMockMode,
  type AsnDto,
} from "@/lib/api-client";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";

// ── Status badge (domain-specific: received/pending — not the order lifecycle)
// Kept local; colors tokenized.

function StatusBadge({ status }: { status: string }) {
  const isReceived = status === "received";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0"
      style={{
        background: isReceived ? "var(--brand-green-soft)" : "var(--amber-soft)",
        color: isReceived ? "var(--brand-green-deep)" : "var(--amber)",
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["asns"],
    queryFn: getAsns,
    staleTime: 30_000,
  });

  const asns: AsnDto[] = data ?? [];

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadAsn(file),
    onSuccess: (asn) => {
      queryClient.invalidateQueries({ queryKey: ["asns"] });
      setNotice(`ASN ${asn.asnNumber ?? asn.id} uploaded successfully.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: Error) => setNotice(`Upload failed — ${err.message}`),
  });

  const isError_ = notice?.includes("failed") || notice?.includes("Failed");

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Advance Shipping Notices"
        sub={isLoading && !isApiMockMode ? "Loading…" : `${asns.length} notice${asns.length !== 1 ? "s" : ""}`}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setNotice(null); uploadMut.mutate(f); } }}
              disabled={uploadMut.isPending}
            />
            {uploadMut.isPending && (
              <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Uploading…</span>
            )}
            {/* Header Upload button only when list is non-empty; empty state carries its own CTA */}
            {asns.length > 0 && (
              <Button
                variant="primary"
                size="md"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMut.isPending}
                title="Upload an ASN file (XML or CSV). EDIFACT DESADV on request."
              >
                Upload ASN
              </Button>
            )}
          </>
        }
      />

      {/* Notice */}
      {notice && (
        <div
          className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
          style={{
            border: isError_ ? "1px solid var(--danger-soft)" : "1px solid var(--brand-green-soft)",
            borderLeft: isError_ ? "3px solid var(--danger)" : "3px solid var(--brand-green)",
            background: isError_ ? "var(--danger-soft)" : "var(--brand-green-soft)",
            color: isError_ ? "var(--danger)" : "var(--brand-green-deep)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss notice" style={{ color: "inherit", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        </div>
      )}

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
            <Button
              variant="primary"
              size="md"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["asns"] })}
            >
              Retry
            </Button>
          </div>
        </Card>
      ) : asns.length === 0 ? (
        /* Empty */
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>No advance shipping notices yet</p>
            <p className="text-[13px] max-w-[340px]" style={{ color: "var(--ink-muted)" }}>
              ASNs are sent by suppliers to confirm upcoming deliveries. Upload an XML or CSV file to get started — EDIFACT DESADV is available on request.
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
            >
              Upload ASN
            </Button>
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

          {/* Desktop table */}
          <Card className="hidden sm:block overflow-hidden" dense>
            <table className="w-full border-collapse text-left" style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["ASN #", "Supplier", "Ship date", "Packages", "Status"].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-faint)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {asns.map((asn, i) => (
                  <tr key={asn.id} style={{ borderBottom: i < asns.length - 1 ? "1px solid var(--surface-2)" : "none" }}>
                    <td className="px-4 py-3 font-mono font-semibold" style={{ color: "var(--ink)" }}>{asn.asnNumber ?? "—"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ink-muted)" }}>{asn.supplierName ?? "—"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ink-muted)" }}>{asn.shipDate ?? "—"}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--ink)" }}>{asn.packageCount}</td>
                    <td className="px-4 py-3"><StatusBadge status={asn.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </PageShell>
  );
}
