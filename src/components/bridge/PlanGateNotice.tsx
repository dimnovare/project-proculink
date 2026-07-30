"use client";

// PlanGateNotice — the one banner every plan-gated 403 renders (WP-11 follow-through).
//
// The backend refuses a capability the org's plan does not include with
// 403 `{ error: "<capability>_requires_<plan>", upgradeUrl }`. Without this, each surface
// fell through to its generic failure copy: the audit log said "check your connection"
// (nothing to do with the network), and the save paths printed the raw
// `webhook_delivery_requires_growth` token at the customer.
//
// The plan name is NEVER written here — planGateMessage derives it from the code, so a
// feature that is re-tiered on the server re-labels itself with no frontend change. The
// caller supplies only the capability noun ("Bulk mapping import"), which is a property of
// the SCREEN, not of the plan ladder.

import Link from "next/link";
import { isPlanGateError, planGateMessage, planGateUpgradeUrl } from "@/lib/planGate";

/** Pull the message text out of whatever the api layer threw. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

export interface PlanGateNoticeProps {
  /** The raw failure: a message string, an Error, or an ApiHttpError (whose `body` is preferred). */
  error: unknown;
  /** Plain noun for what was refused, e.g. "Bulk mapping import". Sentence-leading. */
  capability: string;
  className?: string;
}

/** True when this failure is a plan gate — call before choosing which banner to render. */
export function isPlanGate(error: unknown): boolean {
  return isPlanGateError(messageOf(error));
}

/**
 * Amber upsell banner. Renders NOTHING when the failure is not a plan gate, so a caller can
 * drop it in ahead of its normal error banner without duplicating the shape check.
 */
export function PlanGateNotice({ error, capability, className }: PlanGateNoticeProps) {
  const message = messageOf(error);
  if (!isPlanGateError(message)) return null;

  // ApiHttpError keeps the parsed body; everything else only has the message text.
  const body = error && typeof error === "object" ? (error as { body?: unknown }).body : undefined;
  const upgradeUrl = planGateUpgradeUrl(body ?? message);

  return (
    <div
      role="status"
      className={`rounded-[8px] px-3.5 py-3 text-[12.5px] ${className ?? ""}`}
      style={{
        border: "1px solid var(--amber-soft, #F0D39A)",
        borderLeft: "3px solid var(--amber, #C97A14)",
        background: "var(--amber-soft, #FFF8EA)",
        color: "var(--amber, #7A4D0B)",
        lineHeight: 1.5,
      }}
    >
      {capability} is not included in your plan. {planGateMessage(message)}{" "}
      <Link href={upgradeUrl} style={{ color: "inherit", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>
        See plans →
      </Link>
    </div>
  );
}
