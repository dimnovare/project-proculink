"use client";

// ParsingGate — what the order screen shows while the document is still being read server-side.
//
// Its own file (rather than inline in OrderWorkshop) so the escalation is renderable in a unit test
// without standing up a query client, a router and Clerk. The state it renders is the difference
// between a calm wait and a silent outage, so it needs to be testable on its own.

import Link from "next/link";
import { BridgeLoader } from "../BridgeLoader";

export function ParsingGate({ stalled }: { stalled: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center"
      style={{ background: "#F6F7FA" }}
      data-testid="order-parsing"
    >
      <BridgeLoader size={92} fullScreen={false} />
      <div style={{ maxWidth: 400 }}>
        <p className="text-[16px] font-semibold" style={{ color: "#0B1A2F", letterSpacing: "-0.01em" }}>
          We&rsquo;re reading your order&hellip;
        </p>

        {stalled ? (
          // Escalation, NOT a failure. The Worker may simply be catching up, and telling someone
          // their order failed while it is still in flight is how you get a duplicate PO. Polling
          // is unchanged underneath, so this screen still advances on its own if the parse lands.
          <div data-testid="order-parsing-stalled">
            <p className="text-[13px]" style={{ color: "#5E6779", marginTop: 7, lineHeight: 1.55 }}>
              This is taking longer than usual. Your order is still queued &mdash; nothing has been
              lost, and this page will update on its own if it completes.
            </p>
            <p className="text-[13px]" style={{ color: "#5E6779", marginTop: 7, lineHeight: 1.55 }}>
              Processing may be paused.{" "}
              <Link href="/operations/health" style={{ color: "#2F5BFF", fontWeight: 600 }}>
                Check system health
              </Link>
              .
            </p>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: "#5E6779", marginTop: 7, lineHeight: 1.55 }}>
            We&rsquo;re reading your file and preparing it for review. This usually takes a few
            seconds &mdash; the page updates on its own.
          </p>
        )}
        {/* The PO number that used to sit here in small mono now lives in the
            gate header above — one identity surface, not two. */}
      </div>
    </div>
  );
}
