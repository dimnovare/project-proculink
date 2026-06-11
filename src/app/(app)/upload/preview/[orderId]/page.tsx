"use client";

/**
 * Upload preview route — /upload/preview/[orderId]
 *
 * Renders the MagicMappingPreview for the order that was just uploaded.
 * The user reviews AI suggestions, accepts/edits/rejects, then commits.
 * After commit, they land on the canonical order-detail page.
 */

import { useParams, useRouter } from "next/navigation";
import { MagicMappingPreview } from "@/components/bridge/MagicMappingPreview";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import Link from "next/link";

export default function MappingPreviewPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();

  function handleCommitted(id: string) {
    router.push(`/inbox/${encodeURIComponent(id)}`);
  }

  function handleParseFailed(id: string) {
    router.push(`/inbox/${encodeURIComponent(id)}`);
  }

  return (
    <PageShell>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 pb-1 text-[12px]" style={{ color: "var(--ink-faint)" }}>
        <Link
          href="/upload"
          className="hover:underline"
          style={{ color: "#2E8E3A", textDecoration: "none" }}
        >
          Upload
        </Link>
        <span aria-hidden>›</span>
        <span style={{ color: "#56627A" }}>Review mapping</span>
      </nav>

      {/* Page header — canonical PageHeader */}
      <PageHeader
        title="Review mapping"
        sub="Confirm how your order lines map to supplier codes before processing."
      />

      {/* Body */}
      <MagicMappingPreview
        orderId={orderId}
        onCommitted={handleCommitted}
        onParseFailed={handleParseFailed}
      />
    </PageShell>
  );
}
