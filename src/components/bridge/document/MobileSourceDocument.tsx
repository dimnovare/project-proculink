"use client";

// MobileSourceDocument — the received file on a phone.
//
// MobileTriage is deliberately review-and-send only: it shows issues, and it says so ("For
// advanced editing … open this on a laptop or desktop"). The DOCUMENT is not advanced editing.
// It is the thing the operator is being asked to agree with, and a phone renders a page of a PO
// perfectly well — so leaving it out would mean the small screen keeps exactly the defect this
// packet exists to remove. It goes in, as a collapsed card.
//
// Collapsed matters twice over:
//   • It adds no height until tapped, so the screen the operator lands on is unchanged.
//   • Its body is only MOUNTED when open (MobileTriage's SummaryCard renders `{open && …}`),
//     so this component's query does not run — and no file is downloaded over cellular — until
//     someone asks for it.
//
// And nothing here is a fixed-height or clipping box. `bounded={false}` gives the viewer its
// natural height and lets <main> scroll it, which is the mobile scroll-lock contract: every clipper
// on this screen must be `lg:`-only, or a blocked order becomes unscrollable on a phone again.

import { useSourceDocument } from "./useSourceDocument";
import { SourceDocumentBody } from "./SourceDocumentBody";
import { sourceUnavailableMessage } from "@/lib/sourceDocument";

export function MobileSourceDocument({ orderId }: { orderId: string }) {
  const { state, isLoading } = useSourceDocument(orderId);

  if (isLoading) {
    return (
      <p className="m-0 text-[13px] leading-relaxed text-ink-faint" data-testid="mobile-source-document">
        Loading the document…
      </p>
    );
  }

  if (state.kind !== "document") {
    return (
      <p className="m-0 text-[13px] leading-relaxed text-ink-muted" data-testid="mobile-source-document">
        {sourceUnavailableMessage(state)}
      </p>
    );
  }

  return (
    <div data-testid="mobile-source-document" className="border border-border">
      <SourceDocumentBody cacheKey={orderId} document={state.document} bounded={false} />
    </div>
  );
}
