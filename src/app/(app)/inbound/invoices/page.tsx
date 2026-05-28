"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInvoices,
  uploadInvoice,
  approveInvoice,
  downloadInvoice,
  isApiMockMode,
  type InvoiceDto,
} from "@/lib/api-client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency ?? "EUR", minimumFractionDigits: 2 }).format(amount);
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending:  { bg: "#FEF3C7", color: "#B45309", label: "Pending"  },
    approved: { bg: "#DCFCE7", color: "#15803D", label: "Approved" },
    rejected: { bg: "#FEE2E2", color: "#B91C1C", label: "Rejected" },
  };
  const s = map[status] ?? { bg: "#EFF2F7", color: "#56627A", label: status };
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid #F0F2F6" }}>
      {[120, 140, 80, 80, 60, 60, 80].map((w, i) => (
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
      <div className="flex justify-between mb-3">
        <div className="h-4 w-28 rounded" style={{ background: "#E2E6EE" }} />
        <div className="h-4 w-16 rounded" style={{ background: "#E2E6EE" }} />
      </div>
      <div className="h-3 w-36 rounded" style={{ background: "#E2E6EE" }} />
    </div>
  );
}

// ── Row actions ───────────────────────────────────────────────────────────────

function InvoiceActions({
  inv,
  onApprove,
  onDownload,
  approving,
  downloading,
}: {
  inv: InvoiceDto;
  onApprove: (id: string) => void;
  onDownload: (id: string) => void;
  approving: string | null;
  downloading: string | null;
}) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {inv.status === "pending" && (
        <button
          onClick={() => onApprove(inv.id)}
          disabled={approving === inv.id}
          className="rounded px-2 py-1 text-[11.5px] font-medium"
          style={{ border: "1px solid #BDE0C1", background: "#FFFFFF", color: approving === inv.id ? "#8A93A5" : "#15803D" }}
          title="Approve this invoice"
        >
          {approving === inv.id ? "…" : "Approve"}
        </button>
      )}
      <button
        onClick={() => onDownload(inv.id)}
        disabled={downloading === inv.id}
        className="rounded px-2 py-1 text-[11.5px] font-medium"
        style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: downloading === inv.id ? "#8A93A5" : "#0F4FA8" }}
        title="Download as CSV"
      >
        {downloading === inv.id ? "…" : "↓ CSV"}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoices"],
    queryFn: getInvoices,
    staleTime: 30_000,
  });

  const invoices: InvoiceDto[] = data ?? [];

  // Upload mutation
  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadInvoice(file),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setNotice(`Invoice ${inv.invoiceNumber ?? inv.id} uploaded successfully.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: Error) => setNotice(`Upload failed — ${err.message}`),
  });

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: (id: string) => approveInvoice(id),
    onMutate: (id) => setApprovingId(id),
    onSettled: () => setApprovingId(null),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setNotice(`Invoice ${inv.invoiceNumber ?? inv.id} approved.`);
    },
    onError: (err: Error) => setNotice(`Approve failed — ${err.message}`),
  });

  // Download handler
  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const data = await downloadInvoice(id, "csv");
      if (data.url.startsWith("#")) {
        setNotice("Download ready (mock mode — no real file).");
      } else {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      setNotice(`Download failed — ${(err as Error).message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Invoices</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {isLoading && !isApiMockMode ? "Loading…" : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="sm:ml-auto flex items-center gap-3 flex-shrink-0">
          {uploadMut.isPending && <span className="text-[12px]" style={{ color: "#56627A" }}>Uploading…</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setNotice(null); uploadMut.mutate(f); } }}
            disabled={uploadMut.isPending}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMut.isPending}
            className="w-full sm:w-auto rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0, opacity: uploadMut.isPending ? 0.7 : 1 }}
            title="Upload a supplier invoice (CSV, XLSX, or PDF)"
          >
            Upload invoice
          </button>
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
                    {["Invoice #","Supplier","Date","Amount","Lines","Status",""].map((h, i) => (
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
            <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Failed to load invoices</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["invoices"] })}
              className="rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            >
              Retry
            </button>
          </div>
        ) : invoices.length === 0 ? (
          /* Empty */
          <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] p-10 text-center" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
            <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>No invoices yet</p>
            <p className="text-[13px] max-w-[320px]" style={{ color: "#56627A" }}>
              Upload supplier invoices to review, approve, and reconcile them against your purchase orders.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            >
              Upload invoice
            </button>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {invoices.map((inv) => (
                <div key={inv.id} className="rounded-[8px] bg-white p-4" style={{ border: "1px solid #E2E6EE", borderLeft: "3px solid #1E66C9" }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold font-mono truncate" style={{ color: "#0B1A2F" }}>{inv.invoiceNumber ?? "—"}</p>
                      <p className="text-[12px] mt-0.5" style={{ color: "#56627A" }}>{inv.supplierName ?? "—"}</p>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="flex items-center gap-4 mt-2 mb-3 text-[12px]" style={{ color: "#8A93A5" }}>
                    <span>{inv.invoiceDate ?? "—"}</span>
                    <span className="font-semibold" style={{ color: "#0B1A2F" }}>{fmt(inv.totalAmount, inv.currency)}</span>
                    <span>{inv.lineCount} line{inv.lineCount !== 1 ? "s" : ""}</span>
                  </div>
                  <InvoiceActions
                    inv={inv}
                    onApprove={(id) => approveMut.mutate(id)}
                    onDownload={handleDownload}
                    approving={approvingId}
                    downloading={downloadingId}
                  />
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block rounded-[8px] overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}>
              <table className="w-full border-collapse text-left" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["Invoice #","Supplier","Date","Amount","Lines","Status","Actions"].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => (
                    <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? "1px solid #F0F2F6" : "none" }}>
                      <td className="px-4 py-3 font-mono font-semibold" style={{ color: "#0B1A2F" }}>{inv.invoiceNumber ?? "—"}</td>
                      <td className="px-4 py-3" style={{ color: "#56627A" }}>{inv.supplierName ?? "—"}</td>
                      <td className="px-4 py-3" style={{ color: "#56627A" }}>{inv.invoiceDate ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold" style={{ color: "#0B1A2F" }}>{fmt(inv.totalAmount, inv.currency)}</td>
                      <td className="px-4 py-3" style={{ color: "#8A93A5" }}>{inv.lineCount}</td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3">
                        <InvoiceActions
                          inv={inv}
                          onApprove={(id) => approveMut.mutate(id)}
                          onDownload={handleDownload}
                          approving={approvingId}
                          downloading={downloadingId}
                        />
                      </td>
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
