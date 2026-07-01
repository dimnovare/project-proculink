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
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency ?? "EUR", minimumFractionDigits: 2 }).format(amount);
}

// ── Status badge ──────────────────────────────────────────────────────────────
// Invoice statuses (pending/approved/rejected) are NOT order lifecycle statuses —
// keep local badge, tokenized to design-system CSS vars.

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending:  { bg: "var(--amber-soft)",        color: "var(--amber)",       label: "Pending"  },
    approved: { bg: "var(--brand-green-soft)",  color: "var(--brand-green-deep)", label: "Approved" },
    rejected: { bg: "var(--danger-soft)",       color: "var(--danger)",      label: "Rejected" },
  };
  const s = map[status] ?? { bg: "var(--surface-2)", color: "var(--ink-muted)", label: status };
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
    <tr style={{ borderBottom: "1px solid var(--surface-2)" }}>
      {[120, 140, 80, 80, 60, 60, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 animate-pulse rounded" style={{ width: w, background: "var(--border)" }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[8px] p-4 animate-pulse" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex justify-between mb-3">
        <div className="h-4 w-28 rounded" style={{ background: "var(--border)" }} />
        <div className="h-4 w-16 rounded" style={{ background: "var(--border)" }} />
      </div>
      <div className="h-3 w-36 rounded" style={{ background: "var(--border)" }} />
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onApprove(inv.id)}
          disabled={approving === inv.id}
          title="Approve this invoice"
          style={{ borderColor: "var(--brand-green-soft)", color: approving === inv.id ? "var(--ink-faint)" : "var(--brand-green-deep)" }}
        >
          {approving === inv.id ? "…" : "Approve"}
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onDownload(inv.id)}
        disabled={downloading === inv.id}
        title="Download as CSV"
        style={{ borderColor: "var(--brand-blue-soft)", color: downloading === inv.id ? "var(--ink-faint)" : "var(--brand-blue-deep)" }}
      >
        {downloading === inv.id ? "…" : "↓ CSV"}
      </Button>
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

  const { data, isLoading, isError, error, refetch } = useQuery({
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

  // Download handler — downloadInvoice returns a blob object URL (binary file).
  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const data = await downloadInvoice(id, "csv");
      // Mock / empty state: the client returns a sentinel "#..." URL (no real
      // blob exists). Never hand that to the browser — it would produce a
      // broken download. Tell the user plainly instead.
      if (!data.url || data.url.startsWith("#")) {
        setNotice("Download isn't available in this preview (no file to export yet).");
        return;
      }
      // Trigger a real file save via a download anchor rather than
      // window.open(blobUrl): an object URL opened in a new tab is unreliable
      // (popup-blocked → blank tab, or rendered inline instead of downloaded).
      // An <a download> click downloads consistently across browsers.
      const inv = invoices.find((x) => x.id === id);
      const safeName = (inv?.invoiceNumber ?? id).replace(/[^a-zA-Z0-9._-]+/g, "-");
      const a = document.createElement("a");
      a.href = data.url;
      a.download = `invoice-${safeName}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Release the object URL once the browser has started the download.
      setTimeout(() => URL.revokeObjectURL(data.url), 60_000);
    } catch (err) {
      setNotice(`Download failed — ${(err as Error).message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const subText = isLoading && !isApiMockMode
    ? "Loading…"
    : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`;

  const uploadAction = (
    <div className="flex items-center gap-3 flex-shrink-0">
      {uploadMut.isPending && (
        <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Uploading…</span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Upload invoice file (XML or EDI)"
        accept=".xml,.edi"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { setNotice(null); uploadMut.mutate(f); } }}
        disabled={uploadMut.isPending}
      />
      {invoices.length > 0 && (
        <Button
          variant="primary"
          size="md"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMut.isPending}
          title="Upload an XML or EDI invoice"
        >
          Upload invoice
        </Button>
      )}
    </div>
  );

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Invoices"
        sub={subText}
        actions={uploadAction}
      />

      {/* Notice */}
      {notice && (
        <div
          className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
          style={{
            border: notice.includes("failed") || notice.includes("Failed")
              ? "1px solid var(--danger-soft)"
              : "1px solid var(--brand-green-soft)",
            borderLeft: notice.includes("failed") || notice.includes("Failed")
              ? "3px solid var(--danger)"
              : "3px solid var(--brand-green)",
            background: notice.includes("failed") || notice.includes("Failed")
              ? "var(--danger-soft)"
              : "var(--brand-green-soft)",
            color: notice.includes("failed") || notice.includes("Failed")
              ? "var(--danger)"
              : "var(--brand-green-deep)",
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
          <Card className="hidden sm:block" dense>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["Invoice #","Supplier","Date","Amount","Lines","Status",""].map((h, i) => (
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
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Failed to load invoices</p>
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
      ) : invoices.length === 0 ? (
        /* Empty */
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>No invoices yet</p>
            <p className="text-[13px] max-w-[320px]" style={{ color: "var(--ink-muted)" }}>
              Upload supplier invoices to review, approve, and reconcile them against your purchase orders.
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-1"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload invoice
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {invoices.map((inv) => (
              /* Wrapper supplies the Bridge-Layer green left-accent strip (3 px) that the
                 HEAD card had. MobileListRow renders the card surface; the wrapper clips
                 the card to its own radius so the strip aligns with the card edge. */
              <div
                key={inv.id}
                style={{
                  position: "relative",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                {/* left accent strip */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: "var(--brand-green)",
                    zIndex: 1,
                  }}
                />
                <MobileListRow>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold font-mono truncate" style={{ color: "var(--ink)" }}>{inv.invoiceNumber ?? "—"}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-muted)" }}>{inv.supplierName ?? "—"}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
                <div className="flex items-center gap-4 mt-2 mb-3 text-[12px]" style={{ color: "var(--ink-faint)" }}>
                  <span>{inv.invoiceDate ?? "—"}</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{fmt(inv.totalAmount, inv.currency)}</span>
                  <span>{inv.lineCount} line{inv.lineCount !== 1 ? "s" : ""}</span>
                </div>
                <InvoiceActions
                  inv={inv}
                  onApprove={(id) => approveMut.mutate(id)}
                  onDownload={handleDownload}
                  approving={approvingId}
                  downloading={downloadingId}
                />
                </MobileListRow>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden sm:block" dense>
            <table className="w-full border-collapse text-left" style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["Invoice #","Supplier","Date","Amount","Lines","Status","Actions"].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-faint)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={inv.id} style={{ borderBottom: i < invoices.length - 1 ? "1px solid var(--surface-2)" : "none" }}>
                    <td className="px-4 py-3 font-mono font-semibold" style={{ color: "var(--ink)" }}>{inv.invoiceNumber ?? "—"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ink-muted)" }}>{inv.supplierName ?? "—"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ink-muted)" }}>{inv.invoiceDate ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: "var(--ink)" }}>{fmt(inv.totalAmount, inv.currency)}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ink-faint)" }}>{inv.lineCount}</td>
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
          </Card>
        </>
      )}
    </PageShell>
  );
}
