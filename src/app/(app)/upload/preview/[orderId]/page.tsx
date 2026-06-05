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
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background: "#F6F7FA" }}
    >
      {/* Page header */}
      <div
        className="flex flex-col gap-1 px-4 py-4 sm:px-6 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[12px]" style={{ color: "#8A93A5" }}>
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

        <h1
          className="text-[22px] font-semibold tracking-[-0.02em]"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            color: "#0B1A2F",
          }}
        >
          Review mapping
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: "#56627A" }}>
          Confirm how your order lines map to supplier codes before processing.
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="mx-auto max-w-5xl">
          <MagicMappingPreview
            orderId={orderId}
            onCommitted={handleCommitted}
            onParseFailed={handleParseFailed}
          />
        </div>
      </div>
    </div>
  );
}
