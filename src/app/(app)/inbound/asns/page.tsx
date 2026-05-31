"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAsns,
  uploadAsn,
  isApiMockMode,
  type AsnDto,
} from "@/lib/api-client";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isReceived = status === "received";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0"
      style={{ background: isReceived ? "#DCFCE7" : "#FEF3C7", color: isReceived ? "#15803D" : "#B45309" }}
    >
      <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: isReceived ? "#15803D" : "#D97706", flexShrink: 0 }} />
      {isReceived ? "Received" : "Pending"}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid #F0F2F6" }}>
      {[120, 140, 80, 60, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 animate-pulse rounded" style={{ width: w, background: "#E2E6EE" }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[8px] bg-white p-4 animate-pulse" style={{ border: "1px solid #E2E6EE" }}>
      <div className="flex justify-between mb-2">
        <div className="h-4 w-28 rounded" style={{ background: "#E2E6EE" }} />
        <div className="h-4 w-16 rounded" style={{ background: "#E2E6EE" }} />
      </div>
      <div className="h-3 w-36 rounded" style={{ background: "#E2E6EE" }} />
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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex flex-col gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Advance Shipping Notices
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {isLoading && !isApiMockMode ? "Loading…" : `${asns.length} notice${asns.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="sm:ml-auto flex items-center gap-3 flex-shrink-0">
          {uploadMut.isPending && <span className="text-[12px]" style={{ color: "#56627A" }}>Uploading…</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".edi,.xml,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setNotice(null); uploadMut.mutate(f); } }}
            disabled={uploadMut.isPending}
          />
          {/* Single Upload action: the header button shows only when notices exist;
              the empty state below carries the sole CTA when the list is empty. */}
          {asns.length > 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
              className="w-full sm:w-auto rounded-[6px] px-3 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0, opacity: uploadMut.isPending ? 0.7 : 1 }}
              title="Upload an ASN file (EDI DESADV, XML, or CSV)"
            >
              Upload ASN
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {/* Notice */}
        {notice && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={{
              border: notice.includes("failed") || notice.includes("Failed") ? "1px solid #F5B8B8" : "1px solid #BDE0C1",
              borderLeft: notice.includes("failed") || notice.includes("Failed") ? "3px solid #C53A3A" : "3px solid #2E8E3A",
              background: notice.includes("failed") || notice.includes("Failed") ? "#FBF0F0" : "#F0F7F1",
              color: notice.includes("failed") || notice.includes("Failed") ? "#7B1C1C" : "#1E6D29",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} style={{ color: "inherit", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && !isApiMockMode ? (
          <>
            <div className="hidden sm:block rounded-[8px] overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["ASN #","Supplier","Ship date","Packages","Status"].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody><SkeletonRow /><SkeletonRow /><SkeletonRow /></tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 sm:hidden"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          </>
        ) : isError && !isApiMockMode ? (
          /* Error */
          <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] p-10 text-center" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
            <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Failed to load advance shipping notices</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["asns"] })}
              className="rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            >
              Retry
            </button>
          </div>
        ) : asns.length === 0 ? (
          /* Empty */
          <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] p-10 text-center" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
            <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>No advance shipping notices yet</p>
            <p className="text-[13px] max-w-[340px]" style={{ color: "#56627A" }}>
              ASNs are sent by suppliers to confirm upcoming deliveries. Upload an EDI DESADV, XML, or CSV file to get started.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            >
              Upload ASN
            </button>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {asns.map((asn) => (
                <div key={asn.id} className="rounded-[8px] bg-white p-4" style={{ border: "1px solid #E2E6EE", borderLeft: "3px solid #28C55E" }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold font-mono truncate" style={{ color: "#0B1A2F" }}>{asn.asnNumber ?? "—"}</p>
                      <p className="text-[12px] mt-0.5" style={{ color: "#56627A" }}>{asn.supplierName ?? "—"}</p>
                    </div>
                    <StatusBadge status={asn.status} />
                  </div>
                  <div className="flex items-center gap-4 text-[12px]" style={{ color: "#8A93A5" }}>
                    <span>Ship: {asn.shipDate ?? "—"}</span>
                    <span className="font-medium" style={{ color: "#0B1A2F" }}>{asn.packageCount} pkg{asn.packageCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block rounded-[8px] overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
              <table className="w-full border-collapse text-left" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["ASN #","Supplier","Ship date","Packages","Status"].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {asns.map((asn, i) => (
                    <tr key={asn.id} style={{ borderBottom: i < asns.length - 1 ? "1px solid #F0F2F6" : "none" }}>
                      <td className="px-4 py-3 font-mono font-semibold" style={{ color: "#0B1A2F" }}>{asn.asnNumber ?? "—"}</td>
                      <td className="px-4 py-3" style={{ color: "#56627A" }}>{asn.supplierName ?? "—"}</td>
                      <td className="px-4 py-3" style={{ color: "#56627A" }}>{asn.shipDate ?? "—"}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: "#0B1A2F" }}>{asn.packageCount}</td>
                      <td className="px-4 py-3"><StatusBadge status={asn.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
