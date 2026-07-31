// sendBarLabel — the ONE label ladder for the Order Workshop's send control
// (WP-28 / DB-4: "what it says when the order is clean, when it is blocked, and
// when the user has an override available").
//
// Pure, and shared by BOTH send surfaces — the desktop header bar in
// OrderWorkshop and the sticky bar in MobileTriage. They previously each
// hand-rolled a ladder, so the same state read "Send · 2 blockers" on one and
// "Fix 2 to send" on the other, and neither had a word for the third state:
// an order with only WARNING-level issues, which is sendable but not clean.
//
// Party nouns come from partyLabels(direction) — never hardcoded. Hardcoding
// "supplier" silently deletes the inbound mode (founder decision 2026-07-30).
//
// "Blocker" is deliberately gone from the label: it is not one of the nine
// nouns a customer may be taught. The count now reads "N to fix" / "N optional",
// both of which describe the operator's next action instead of the engine's
// internal severity.

import type { PartyLabels } from "@/hooks/useOrderDirection";

export interface SendBarInput {
  labels: PartyLabels;
  /** Client-side blocking issues (IssuesPanel severity === "blocking"). */
  blockingIssues: number;
  /** Server-truth unresolved exceptions — can block with an empty client list. */
  exceptionCount: number;
  /** Warning-severity issues: they never block, but the operator should know. */
  warningIssues: number;
  /** The order has already been delivered in this session. */
  crossed: boolean;
  sendState: "idle" | "transforming" | "delivering";
  /**
   * When the order sits in one of WP-24's eight problem states, the panel owns
   * the only real action. Pass `problemFor(status)?.rowAction` — the control is
   * disabled and renamed to what the order actually needs, so a screen reader
   * never reads "Send to supplier" on an order that cannot be sent.
   */
  problemAction?: string | null;
}

export interface SendBarCopy {
  /** The visible button text. */
  label: string;
  /** The accessible name — expands the count into a sentence. */
  ariaLabel: string;
  /** Whether the control may be pressed. */
  enabled: boolean;
  /**
   * True only in the "clean apart from warnings" case — the operator is
   * choosing to proceed past something non-blocking. Callers may use it to tone
   * the button; the ConfirmDialog remains the actual second gate.
   */
  override: boolean;
}

export function sendBarLabel(input: SendBarInput): SendBarCopy {
  const { labels, blockingIssues, exceptionCount, warningIssues, crossed, sendState, problemAction } = input;

  // Server truth can block with an empty client list, and the client list can
  // block before the server has caught up — take whichever is larger, the same
  // rule the blocked-send tooltip already uses.
  const toFix = Math.max(blockingIssues, exceptionCount);
  const blocked = toFix > 0;

  if (crossed) {
    return { label: labels.doneLabel, ariaLabel: labels.doneLabel, enabled: false, override: false };
  }
  if (sendState === "transforming") {
    return { label: "Preparing the file…", ariaLabel: "Preparing the file", enabled: false, override: false };
  }
  if (sendState === "delivering") {
    return {
      label: labels.primaryCtaProgress,
      ariaLabel: labels.primaryCtaProgress,
      enabled: false,
      override: false,
    };
  }
  if (problemAction) {
    // WP-24 owns this arm: the problem panel carries the recovery, so the send
    // control is inert and reads as the thing the order actually needs.
    return { label: labels.primaryCta, ariaLabel: problemAction, enabled: false, override: false };
  }
  if (blocked) {
    return {
      label: `${labels.primaryCta} · ${toFix} to fix`,
      ariaLabel: `${labels.primaryCta} — ${toFix} ${toFix === 1 ? "issue" : "issues"} to fix first`,
      enabled: false,
      override: false,
    };
  }
  if (warningIssues > 0) {
    return {
      label: `${labels.primaryCta} · ${warningIssues} optional`,
      ariaLabel:
        `${labels.primaryCta} — ${warningIssues} optional ` +
        `${warningIssues === 1 ? "issue" : "issues"} you can send past`,
      enabled: true,
      override: true,
    };
  }
  return { label: labels.primaryCta, ariaLabel: labels.primaryCta, enabled: true, override: false };
}
