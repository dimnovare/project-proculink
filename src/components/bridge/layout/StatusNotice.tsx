"use client";

// StatusNotice — the one way an operations screen tells you how an action went.
//
// WHY THIS EXISTS
//
// Every operations surface had hand-rolled its own outcome banner, and they
// disagreed on the two things a banner has to get right.
//
//   • COLOUR. /operations/health carried ONE `string | null` notice rendered in a
//     hard-coded informational blue, so a REFUSED requeue — the case an operator
//     most needs to notice — was painted in the same success-adjacent chrome as
//     "we're sending it again". That was fixed in place by giving its state a
//     `tone` field, and this component is that fix extracted so the next screen
//     cannot repeat it. /operations/exceptions had no banner at all: both list
//     mutations were `useMutation` with an `onSuccess` and no `onError`, so a 500
//     on Resolve cleared the pending id, re-enabled the button, changed nothing,
//     and said nothing.
//
//   • ANNOUNCEMENT. A silent `<div>` is invisible to a screen reader no matter
//     what colour it is. The delivery log's network-error card had no role at
//     all; the exceptions screen had no live region anywhere on the page.
//
// THE RULE THIS COMPONENT MAKES STRUCTURAL: the ARIA is DERIVED from the tone,
// never passed in. A caller cannot announce a failure politely or paint one
// green, because a caller does not get to choose either — it picks the tone and
// the semantics follow. `role` and `aria-live` are not part of the props type.
//
//   error   → role="alert"   — assertive. The action did not happen and nothing
//                              else on screen says so, so the reader is
//                              interrupted. `aria-live` is deliberately NOT set
//                              alongside it: `role="alert"` already implies
//                              aria-live="assertive", and setting both is how a
//                              double announcement gets shipped.
//   success → role="status" + aria-live="polite"
//   working → role="status" + aria-live="polite"
//   warning → role="status" + aria-live="polite"
//
// TONES ARE FOUR, NOT TWO. "Working" is its own tone rather than a shade of
// success: "Trying to send PO-4711 again" is not "PO-4711 was sent", and the
// screens this replaces had no way to say the first without borrowing the
// second's colour. Blue is the product's in-progress/informational colour
// everywhere else (the delivery log's order-filter strip, the review backlog
// card), so it carries that meaning here too.
//
// "Warning" (2026-08-25) is the advisory tone: the message is TRUE and the
// operator should read it before proceeding, but nothing failed and nothing is
// blocked. Its first consumer is the review screen's duplicate-PO notice, which
// must warn without claiming a failure (error) or something in flight (working)
// — and without wearing green, because "possible duplicate" is not an all-clear.
// Amber, per §12: tone belongs to this component. Announced politely, not as an
// alert: interrupting the reader is reserved for an action that did not happen.
//
// NO FRACTIONAL OPACITY ANYWHERE IN THIS FILE. `opacity` on a block composites
// the text and the background together rather than fading the text against it,
// and doing that to a soft-tinted panel collapsed an 11:1 contrast ratio to
// 2.66:1 elsewhere in this codebase. Every colour here is a token at full
// strength.

import type { ReactNode } from "react";

/**
 * How an action went.
 *
 * Deliberately not `"info"`: every use so far is the outcome of something the
 * operator just did, and a tone named for its colour rather than its meaning is
 * how "failure" ends up rendered as "info" by a caller in a hurry. `"warning"`
 * is a meaning, not a colour: true, non-blocking, read it before proceeding.
 */
export type NoticeTone = "success" | "error" | "working" | "warning";

interface TonePalette {
  bg: string;
  border: string;
  fg: string;
}

/**
 * One palette per tone. Success and error share no colour in any slot — that is
 * asserted by StatusNotice.test.tsx rather than left to review, because "the
 * failure looked like a success" is the exact defect this component replaces.
 *
 * Exported for that test. jsdom does not resolve `var()` inside a `background`
 * shorthand, so reading the rendered element's `style.background` yields an
 * empty string and a naive "these two differ" assertion would pass on two blanks
 * forever. The disjointness check therefore reads this table directly, and the
 * DOM test asserts separately that the element really carries the tone.
 */
export const TONE_PALETTE: Record<NoticeTone, TonePalette> = {
  success: {
    bg: "var(--brand-green-soft)",
    border: "var(--brand-green-soft-2)",
    fg: "var(--brand-green-deep)",
  },
  error: {
    bg: "var(--danger-soft)",
    border: "var(--danger-border)",
    fg: "var(--danger)",
  },
  working: {
    bg: "var(--brand-blue-soft)",
    border: "var(--brand-blue-soft-2)",
    fg: "var(--brand-blue-deep)",
  },
  // The amber TEXT token, never `--amber` itself: --amber is the non-text member
  // of the family (3.65:1 on --amber-soft) and token-contrast.test.ts bans it as
  // a text colour repo-wide. --amber-text on --amber-soft is the measured 5.62:1
  // pair that same file pins. --amber stays legal here as the 1px BORDER — a
  // non-text stroke with a 3:1 floor.
  warning: {
    bg: "var(--amber-soft)",
    border: "var(--amber)",
    fg: "var(--amber-text)",
  },
};

/**
 * The announcement semantics for a tone. Exported so a screen that must render
 * its own markup (a table cell, an inline row) can still get the pairing right
 * instead of guessing, and so the test can assert the mapping in one place.
 */
export function noticeAria(tone: NoticeTone): {
  role: "alert" | "status";
  "aria-live"?: "polite";
} {
  // role="alert" carries an implicit assertive live region. Adding aria-live
  // next to it is redundant at best and a double announcement at worst.
  return tone === "error"
    ? { role: "alert" }
    : { role: "status", "aria-live": "polite" };
}

export interface StatusNoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** Trailing control — a Retry button, a link to the thing that failed. */
  action?: ReactNode;
  className?: string;
}

/**
 * A one-line outcome banner. Wraps rather than truncates: no backend string this
 * renders is length-capped, and a cut-off explanation is the failure this whole
 * area was rebuilt to remove.
 */
export function StatusNotice({ tone, children, action, className }: StatusNoticeProps) {
  const palette = TONE_PALETTE[tone];
  return (
    <div
      {...noticeAria(tone)}
      data-notice-tone={tone}
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderLeft: `3px solid ${palette.fg}`,
        borderRadius: "var(--radius-md)",
        padding: "9px 12px",
        fontSize: 12.5,
        color: palette.fg,
      }}
    >
      {/* minWidth 0 + overflowWrap so a long server sentence wraps inside the
          flex row instead of forcing the notice wider than its column. */}
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
      {action && <span style={{ flexShrink: 0 }}>{action}</span>}
    </div>
  );
}
