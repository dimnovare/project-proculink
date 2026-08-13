"use client";

// PdfDocumentView — the received PDF, rasterised by pdf.js.
//
// WHY A JS RENDERER AND NOT AN IFRAME. The frontend CSP (`src/lib/security/csp.ts`) allows
// `blob:` in `connect-src`, `worker-src` and `img-src`, but `frame-src` is `'self'` plus two
// named hosts — no `blob:`, no API origin. So `<iframe src={blobUrl}>` is blocked today, and an
// iframe pointed straight at the API could not carry the bearer token anyway. Authenticated
// fetch → Blob → pdf.js is the path that works with the policy exactly as it stands, and
// widening `frame-src` to avoid writing this file was considered and rejected.
//
// The worker is resolved through `new URL(..., import.meta.url)`, so the bundler emits it as a
// same-origin asset and `worker-src 'self'` covers it without a CDN entry.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Rendered at this CSS width times the device pixel ratio, capped so a phone stays responsive. */
const MAX_CANVAS_SCALE = 2;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

export interface PdfDocumentViewProps {
  /** Stable identity for the cache — the order this blob belongs to. */
  cacheKey: string;
  blob: Blob;
  /**
   * Desktop pane: the body owns a bounded scroll area. Mobile card: it must NOT, or a clipping
   * ancestor with no `lg:` prefix re-creates the mobile scroll trap. One page at a time is shown
   * when unbounded so the column cannot grow without limit.
   */
  bounded: boolean;
}

export function PdfDocumentView({ cacheKey, blob, bounded }: PdfDocumentViewProps) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["source-document-pdf", cacheKey],
    queryFn: async (): Promise<PDFDocumentProxy> => {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return pdfjs.getDocument({ data: bytes }).promise;
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });

  const pageCount = data?.numPages ?? 0;
  const current = Math.min(Math.max(page, 1), Math.max(pageCount, 1));

  if (isLoading) {
    return <DocumentMessage>Opening the document…</DocumentMessage>;
  }
  if (isError || !data) {
    return (
      <DocumentMessage>
        We couldn&rsquo;t open this PDF in the browser. Download it to check the values against
        your own reader.
      </DocumentMessage>
    );
  }

  return (
    <div className={bounded ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
      {pageCount > 1 && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <PagerButton disabled={current <= 1} onClick={() => setPage(current - 1)} label="Previous page">
            ‹
          </PagerButton>
          <span className="font-mono text-[11px] text-ink-muted" aria-live="polite">
            Page {current} of {pageCount}
          </span>
          <PagerButton
            disabled={current >= pageCount}
            onClick={() => setPage(current + 1)}
            label="Next page"
          >
            ›
          </PagerButton>
        </div>
      )}
      <div className={bounded ? "min-h-0 flex-1 overflow-auto bg-surface-2 p-3" : "overflow-x-auto bg-surface-2 p-3"}>
        <PdfPageCanvas doc={data} pageNumber={current} />
      </div>
    </div>
  );
}

/**
 * Draw one page onto a canvas.
 *
 * This is the one effect in the packet, and it is not data fetching — the document already came
 * from TanStack Query above. Rasterising to a canvas is imperative DOM work with a cancellation
 * handle, which is exactly what an effect is for.
 */
function PdfPageCanvas({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    (async () => {
      try {
        const pdfPage = await doc.getPage(pageNumber);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        const parentWidth = canvas.parentElement?.clientWidth ?? 620;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.max(parentWidth, 240) / base.width;
        const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        const scale = fit * Math.min(dpr, MAX_CANVAS_SCALE);
        const viewport = pdfPage.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // CSS size stays at the fitted width so the bitmap is crisp without overflowing.
        canvas.style.width = `${Math.floor(base.width * fit)}px`;
        canvas.style.height = `${Math.floor(base.height * fit)}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
        await (task as unknown as { promise: Promise<void> }).promise;
        if (!cancelled) setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* cancelling an already-settled render task is not an error worth surfacing */
      }
    };
  }, [doc, pageNumber]);

  return (
    <div className="flex justify-center">
      {failed ? (
        <p className="px-3 py-4 text-[11.5px] leading-relaxed text-ink-faint">
          This page couldn&rsquo;t be drawn. Download the file to read it.
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          data-testid="source-document-pdf-canvas"
          aria-label={`Page ${pageNumber} of the received document`}
          className="max-w-full border border-border bg-surface"
        />
      )}
    </div>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-ink-muted disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function DocumentMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-4 text-[11.5px] leading-relaxed text-ink-faint">{children}</p>;
}
