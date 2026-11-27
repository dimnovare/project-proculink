"use client";

import { useMemo } from "react";
import { PdfDocumentView } from "@/components/bridge/document/PdfDocumentView";
import type { OutputPreview } from "@/lib/api/documents";

/** A made file as the person will get it: a PDF drawn page by page, anything else as its text. Nothing until it arrives.
 *  A workbook is binary, so the server previews its grid as CSV text (FlowOutputsController); `format` "xlsx" says so. */
export function FilePreview({ preview, cacheKey, format }: { preview: OutputPreview | undefined; cacheKey: string; format?: string }) {
  const pdf = preview?.contentType === "application/pdf" && preview.base64 ? preview.base64 : null;
  const blob = useMemo(() => pdf && new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: "application/pdf" }), [pdf]);
  if (blob) return <PdfDocumentView cacheKey={cacheKey} blob={blob} bounded regionLabel="Preview" />;
  return preview ? (
    <>
      {format === "xlsx" && <p className="m-0 text-[13px] text-ink-muted">Shown here as text. The file itself is an Excel workbook.</p>}
      <pre className="max-h-72 overflow-auto rounded border border-border bg-surface-2 p-2.5 font-mono text-[12.5px] text-ink">
        {preview.content}
      </pre>
    </>
  ) : null;
}
