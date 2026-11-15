"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { getBillingStatus } from "@/lib/api-client";
import { PLAN_BY_ID, TRIAL_DAYS, planName } from "@/lib/plans";
import type { BillingPlan, BillingStatus } from "@/types/procurement";

/* ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS REPLACES.
 *
 * Stripe's success_url is built by the backend as
 *   `{frontendUrl}/welcome?upgraded={plan}&interval={interval}&session_id={CHECKOUT_SESSION_ID}`
 * and this page used to render, unconditionally, from that URL alone:
 *
 *     You're on {upgraded.charAt(0).toUpperCase() + upgraded.slice(1)}.
 *     Your subscription is active. … Receipt was emailed to …
 *
 * Two separate falsehoods came out of that. Anyone at all — signed out, on Pilot,
 * on a workspace that never paid — could open `/welcome?upgraded=distributor` and
 * be told they were on Distributor. And a genuine customer whose payment later
 * failed, or whose checkout completed into a subscription the backend then marked
 * `past_due`, still got an unconditional "your subscription is active" on the one
 * page they land on straight from paying.
 *
 * The claim is now derived from `GET /api/billing/status`. The `upgraded` param is
 * demoted to a HINT — it decides only whether to look at all, and how long to wait
 * for the Stripe webhook before believing what the server currently says. It never
 * supplies the plan name and it never supplies the assertion.
 *
 * This is the same rule §11.5 of CLAUDE.md already imposes on BillingSection: an
 * asserting or blocking surface is gated on server-derived state, never on a plan
 * name and never on a client-supplied value.
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * How long after landing we are willing to say "confirming" rather than report the
 * plan the server currently holds.
 *
 * Checkout redirects the browser back here immediately; Stripe's
 * `checkout.session.completed` webhook reaches the backend independently and can
 * lose that race by a few seconds. During the race a genuine upgrade still reads
 * as its OLD plan — so reporting it instantly would be server-derived and still
 * unhelpful. After the window we report what the server says regardless, because a
 * webhook that has not landed in 20s is not going to be papered over by waiting
 * longer, and "confirming…" forever is its own kind of lie.
 */
export const CONFIRM_GRACE_MS = 20_000;

/** How often we re-ask the server while the answer is still "confirming". */
export const CONFIRM_POLL_MS = 3_000;

export type CheckoutReceiptState =
  /** No `upgraded` hint — this is an ordinary first-run visit, print no receipt. */
  | { kind: "none" }
  /** Nothing assertable yet: still loading, or the webhook race is still open. */
  | { kind: "confirming" }
  /** The status call failed (including 401 — `/welcome` is not a protected route). */
  | { kind: "unconfirmed" }
  /** Server answered, and it says this workspace cannot process orders. */
  | { kind: "paused"; plan: BillingPlan }
  /** Server answered, and it says this workspace is live. */
  | { kind: "active"; plan: BillingPlan };

/**
 * The whole decision, as a pure function, so it can be walked exhaustively in a
 * unit test without a render or a network stub.
 *
 * Order matters, and each arm is here for a reason:
 *  1. no hint            → render nothing at all.
 *  2. server answered     → the server decides, in every case. `canProcessOrders`
 *                           is checked BEFORE the plan comparison, so a paused
 *                           workspace can never reach the "active" arm no matter
 *                           what the URL asked for.
 *  3. server said no      → say we could not confirm; never assume success.
 *  4. otherwise           → still confirming.
 *
 * Note what is NOT here: `expectedPlan` never reaches the returned value. The plan
 * that gets printed always comes off `status.plan`.
 */
export function welcomeReceiptState(input: {
  expectedPlan: string | null | undefined;
  status: BillingStatus | undefined;
  isError: boolean;
  /** True once CONFIRM_GRACE_MS has elapsed — the webhook race is closed. */
  settled: boolean;
}): CheckoutReceiptState {
  const expected = (input.expectedPlan ?? "").trim().toLowerCase();
  if (!expected) return { kind: "none" };

  if (input.status) {
    // The server refused processing. Whatever the URL claimed, this is not an
    // active subscription and must not be described as one.
    if (!input.status.canProcessOrders) return { kind: "paused", plan: input.status.plan };
    // The server is live but not yet showing the tier checkout was for: the webhook
    // is probably still in flight. Wait, rather than report a stale tier as the
    // outcome of the purchase — but only until the grace window closes.
    if (input.status.plan !== expected && !input.settled) return { kind: "confirming" };
    return { kind: "active", plan: input.status.plan };
  }

  if (input.isError) return { kind: "unconfirmed" };
  return { kind: "confirming" };
}

/** Billing is the route back from every arm below, so the link is written once. Its
 *  words are the Settings tab's label. */
function BillingLink() {
  return (
    <Link href="/settings?tab=billing" className="font-semibold text-brand-blue-deep underline underline-offset-2">
      Plan &amp; billing
    </Link>
  );
}

const n = (x: number) => x.toLocaleString("en-GB");

/** The two lines of an `active` receipt. Every number is the server's (`orderLimit` is the
 *  effective limit) or the plan table's; nothing comes from the address. */
function receiptLines(status: BillingStatus): { title: string; note: string } {
  const plan = status.plan;
  if (plan === "pilot") {
    return {
      title: `You're on the free trial: ${n(status.orderLimit)} documents, ${PLAN_BY_ID.pilot.flowLimit} flows, ${TRIAL_DAYS} days.`,
      note: "Choose a plan any time under",
    };
  }
  const known = PLAN_BY_ID[plan];
  if (known?.isCheckout) {
    const flows = typeof known.flowLimit === "number" ? `, ${known.flowLimit} flows` : "";
    return {
      title: `You're on ${planName(plan)}: ${n(status.orderLimit)} documents a month${flows}.`,
      note: "Change or cancel any time under",
    };
  }
  // Enterprise, or a plan this build does not know: Stripe does not sell it, so no
  // change-or-cancel promise, and no number: Enterprise's default limit is a
  // sentinel (int.MaxValue), not what the agreement says.
  return { title: `You're on ${planName(plan)}.`, note: "See your plan under" };
}

const ICON = "mt-0.5 size-6 shrink-0";
const HEAD = "m-0 font-display text-[20px] font-semibold leading-[1.3] text-ink";
const BODY = "m-0 text-[16px] leading-[1.55] text-ink-muted";

/**
 * The receipt block on `/welcome`.
 *
 * Renders nothing without an `upgraded` hint, and never asserts an active
 * subscription without a server response that says so.
 */
export function CheckoutReceipt({ expectedPlan }: { expectedPlan: string | null }) {
  const enabled = Boolean((expectedPlan ?? "").trim());
  const [settled, setSettled] = useState(false);

  // A timer, not a fetch — the TanStack-only rule is about data, and this closes
  // the webhook race window. Without it the page would poll for ever.
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(true), CONFIRM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  const { data, isError } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled,
    // One retry, not the default three: on `/welcome` a 401 (signed out — this route
    // is public) should reach "we couldn't confirm" quickly rather than spin.
    retry: 1,
    // Re-ask only while the answer is genuinely still pending, and never past the
    // grace window.
    refetchInterval: (query) => {
      if (settled) return false;
      const next = welcomeReceiptState({
        expectedPlan,
        status: query.state.data,
        isError: query.state.status === "error",
        settled,
      });
      return next.kind === "confirming" ? CONFIRM_POLL_MS : false;
    },
  });

  const state = welcomeReceiptState({ expectedPlan, status: data, isError, settled });
  if (state.kind === "none") return null;

  // `active` is only reachable with a server answer, so `data` is defined there.
  const active = state.kind === "active" && data ? receiptLines(data) : null;

  return (
    <Card data-testid="checkout-receipt" data-receipt-state={state.kind} aria-live="polite" className="flex gap-4">
      {state.kind === "active" ? (
        <CheckCircle2 aria-hidden="true" className={`${ICON} text-brand-green-deep`} />
      ) : state.kind === "confirming" ? (
        <Clock aria-hidden="true" className={`${ICON} text-ink-faint`} />
      ) : (
        <AlertCircle aria-hidden="true" className={`${ICON} text-amber-text`} />
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        {state.kind === "confirming" && (
          <>
            <h2 className={HEAD}>Confirming your subscription…</h2>
            <p className={BODY}>
              We&apos;re checking your billing status with our servers. This can take a few seconds
              after checkout. Your plan and receipt are always in <BillingLink />.
            </p>
          </>
        )}

        {state.kind === "unconfirmed" && (
          <>
            <h2 className={HEAD}>We couldn&apos;t confirm your subscription here.</h2>
            <p className={BODY}>
              This page couldn&apos;t read your billing status, which on its own doesn&apos;t mean
              anything went wrong with the payment. Open <BillingLink /> to see the plan on your
              workspace, and contact support if it isn&apos;t what you expect.
            </p>
          </>
        )}

        {state.kind === "paused" && (
          <>
            <h2 className={HEAD}>Order processing is paused on your account.</h2>
            <p className={BODY}>
              Your workspace is on {planName(state.plan)}, but new orders aren&apos;t being accepted
              yet. Open <BillingLink /> to check your subscription.
            </p>
          </>
        )}

        {active && (
          <>
            <p className={HEAD}>Your workspace is ready.</p>
            <p className="m-0 text-[16px] leading-[1.55] text-ink">{active.title}</p>
            <p className={BODY}>
              {active.note} <BillingLink />.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
