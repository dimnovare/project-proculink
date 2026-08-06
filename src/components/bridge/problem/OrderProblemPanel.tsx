"use client";

/* =============================================================================
   OrderProblemPanel — ONE component for all eight problem states.

   It replaces five hand-written panels (ParseFailedPanel, FailedPanel ×2 stages,
   BillingHeldPanel, DeliveryUnconfirmedPanel) plus a header chip, which between
   them had drifted into three vocabularies and two guaranteed-400 buttons.

   The status is the only input. There is no `title` / `message` / `tone` prop:
   passing copy in from the call site is exactly how the drift happened.

   Two presentations, one rule — GATE only when the page underneath is empty or
   would lie (that is `failed` alone); BANNER in every other case, because the
   extracted order, its item codes and the generated output ARE the evidence the
   operator needs. Hiding them behind a full-screen panel is what left
   transform_failed with a primary button pointing at the page it was already on.

   Bridge Layer: the 3px cross-section edge strip (XCard's language applied to a
   full-width band), tone-soft header, and `--amber-text` for amber text — never
   `--amber`, which is 3.65:1 on its own soft background and fails AA at 13px/700.
   ============================================================================= */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, HelpCircle, PauseCircle } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import type { Order } from "@/types/procurement";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { poTitleFrom } from "../workshop/WorkshopGateChrome";
import { AssignSupplierBanner } from "../workshop/AssignSupplierBanner";
import { shouldRetryApiFailure, apiRetryDelayMs } from "@/lib/apiFailure";
import { PROBLEM_COPY, problemFor, type ProblemAction, type ProblemCtx, type ProblemStatus } from "./problemCopy";
import { supplierReasonText } from "./supplierReasonText";
import { useProblemAction } from "./useProblemAction";
import { UnconfirmedResolver } from "./UnconfirmedResolver";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]";

/**
 * The statuses whose explanation can be sitting on the order passport.
 *
 * `rejected_by_supplier` was the original member — the supplier's own reason lives there and
 * nowhere else. The two delivery failures joined it because of what production showed on
 * 2026-08-06: a dead-lettered order rendered the raw dispatcher message (backend prose with the
 * supplier's HTML error page concatenated onto it) while its passport carried, on every attempt,
 * a sentence the backend had already written for a person. The panel had the worse string
 * because it never asked for the better one.
 *
 * Deliberately not "every problem status": `failed`, `transform_failed`, `delivery_held` and
 * `unrouted` have no delivery attempt to read, so fetching for them buys a request and nothing
 * else. `delivery_unconfirmed` is left out for the same reason in reverse — its order message IS
 * the park sentence, written by the same backend path, so the attempt adds no information.
 */
const READS_PASSPORT: ReadonlySet<ProblemStatus> = new Set([
  "rejected_by_supplier",
  "delivery_failed",
  "delivery_dead_letter",
]);

/** Only the passport fields this panel reads. The full shape is `PassportDto`. */
type PassportView = {
  supplierResponse?: { rejectionReason?: string | null } | null;
  deliveryAttempts?: readonly DeliveryAttemptView[] | null;
};
type DeliveryAttemptView = {
  attemptNumber?: number | null;
  attemptedAt?: string | null;
  errorMessage?: string | null;
};

/**
 * The message from the most recent delivery attempt that carried one.
 *
 * "Most recent" is DERIVED, never assumed. Nothing in this repo or the API contract states
 * whether `deliveryAttempts` arrives newest- or oldest-first — the passport screen simply reads
 * the last element and hopes. An unstated assumption here shows the operator the reason for an
 * attempt that is not the one that stopped their order, which is worse than showing none.
 *
 * So: rank by `attemptNumber` when every candidate has one, else by `attemptedAt` when every
 * candidate has a parseable one, else fall back to array order. Never mix the scales — a run
 * where half the rows have numbers and half have timestamps must pick one rule, not compare
 * a count against a millisecond.
 */
export function latestAttemptMessage(
  attempts: readonly DeliveryAttemptView[] | null | undefined,
): string | null {
  const withMessage = (attempts ?? []).filter(
    (a): a is DeliveryAttemptView & { errorMessage: string } =>
      Boolean(a) && typeof a?.errorMessage === "string" && a.errorMessage.trim().length > 0,
  );
  if (withMessage.length === 0) return null;

  const highestBy = (keys: readonly number[]): string => {
    let best = 0;
    keys.forEach((k, i) => {
      if (k >= keys[best]) best = i; // >= so a tie keeps the later row
    });
    return withMessage[best].errorMessage;
  };

  const numbers = withMessage.map((a) =>
    typeof a.attemptNumber === "number" && Number.isFinite(a.attemptNumber) ? a.attemptNumber : null,
  );
  if (numbers.every((n): n is number => n !== null)) return highestBy(numbers);

  const times = withMessage.map((a) => (a.attemptedAt ? Date.parse(a.attemptedAt) : Number.NaN));
  if (times.every((t) => Number.isFinite(t))) return highestBy(times);

  return withMessage[withMessage.length - 1].errorMessage;
}

const ICON: Record<ProblemStatus, typeof AlertTriangle> = {
  failed: AlertTriangle,
  unrouted: AlertCircle,
  transform_failed: AlertTriangle,
  delivery_failed: AlertTriangle,
  delivery_dead_letter: AlertTriangle,
  rejected_by_supplier: AlertTriangle,
  delivery_unconfirmed: HelpCircle,
  delivery_held: PauseCircle,
};

export function OrderProblemPanel({
  order,
  mode,
  readOnly = false,
  atOrderLimit = false,
  detailFallback = null,
}: {
  order: Order;
  mode?: "gate" | "banner";
  readOnly?: boolean;
  atOrderLimit?: boolean;
  /**
   * Server detail to show when the order row carries no errorMessage — the parse
   * failure writes its reason into the ParseFailed audit payload instead.
   */
  detailFallback?: string | null;
}) {
  const status = order.status as ProblemStatus;
  const copy = problemFor(status);
  const queryEnabled = useQueriesEnabled();
  const { paused } = useProcessingStatus();
  const action = useProblemAction(order.id, status);

  // The reason lives on the passport, three clicks away behind Details → Supplier response.
  // Fetch it for the few statuses that have one so it is in the panel that is asking the
  // operator to act on it, rather than behind a drawer they have no reason to open.
  const { data: passport } = useQuery({
    queryKey: ["passport", order.id],
    queryFn: () => apiClient.getOrderPassport(order.id),
    enabled: queryEnabled && READS_PASSPORT.has(status),
    staleTime: 60_000,
    // The supplier's reply is the whole point of this panel, so its fetch uses
    // the shared failure policy rather than a flat `retry: 1`: a 404 (no passport
    // recorded) stops immediately instead of buying a second identical answer,
    // and a cold-auth 401 gets the three quick polls it needs.
    retry: shouldRetryApiFailure,
    retryDelay: apiRetryDelayMs,
  });

  if (!copy) return null;

  // `unrouted` delegates its whole surface to the shipped banner. It already
  // answers the five questions in banner form, and it owns the picker, the ranked
  // suggestions and the 409 "someone else assigned it first" race — reimplementing
  // any of that inside this panel would be a second implementation of the one
  // control that matters. The PROBLEM_COPY entry still exists and still gates the
  // workshop's send, which is the part that was missing.
  if (status === "unrouted") return <AssignSupplierBanner order={order} />;

  const supplier = order.supplierName?.trim() ? order.supplierName : "this supplier";
  const passportView = passport as PassportView | null | undefined;
  const rejectionReason =
    status === "rejected_by_supplier"
      ? passportView?.supplierResponse?.rejectionReason ?? null
      : null;
  const attemptMessage = latestAttemptMessage(passportView?.deliveryAttempts);

  const ctx: ProblemCtx = {
    supplier,
    po: poTitleFrom(order.poNumber),
    supplierId: order.supplierId ?? null,
    orderId: order.id,
    serverMessage: order.errorMessage?.trim() ? order.errorMessage : null,
    failureCause: order.failureCause?.trim() ? order.failureCause : null,
    retryAfterSeconds: order.retryAfterSeconds ?? null,
    readOnly,
    atOrderLimit,
    processingPaused: paused,
  };

  const tone = copy.tone;
  const Icon = ICON[status];
  const isGate = (mode ?? copy.presentation) === "gate";
  // §4 promotion: one failed self-serve attempt adds the support route. It never
  // removes an action and never hides the explanation.
  const tier = action.promoted ? "us" : copy.tier(ctx);
  const helper = action.promoted
    ? "That didn't work. This one probably needs us — send it over and we'll look at the detail above."
    : copy.helper?.(ctx) ?? null;
  // ── The one sentence the operator reads as "why". ─────────────────────────────────────────
  //
  // Best explanation first, and EVERY candidate off the wire goes through supplierReasonText.
  // The previous version wrapped only the first operand and let the second through verbatim —
  // which is how a supplier's HTML error page reached a production screen on 2026-08-06, two
  // days after the fix that was supposed to make that impossible. One guarded door is not a
  // guarded room, so the sanitiser is applied once to a list rather than once to an operand.
  //
  //   1. the supplier's own stated reason. Only `rejected_by_supplier` has one, and that panel's
  //      copy promises it ("Their reason is below") — their words outrank ours about their words.
  //   2. the latest delivery attempt's message. Backend-authored operator copy: likely cause,
  //      the fix, and where the fix is made. It existed the whole time production was showing
  //      the raw blob below.
  //   3. the order row's own message. Still here, still ahead of the generic fallback, but no
  //      longer verbatim — it is the dispatcher's sentence with the supplier's body concatenated
  //      onto it, so it is exactly as untrusted as the body.
  //   4. the caller's fallback (a parse failure writes its reason into the audit payload, not
  //      onto the order row). Ours, already prose, so nothing to clean.
  //
  // Nothing is destroyed by any of this: the full response body stays on the passport, which is
  // where an integrator goes to read precisely what came back.
  const detail =
    [rejectionReason, attemptMessage, ctx.serverMessage]
      .map(supplierReasonText)
      .find((s): s is string => Boolean(s)) ?? detailFallback;
  const actions = copy.actions(ctx);
  const actionError = action.error
    ? supplierReasonText(action.error) ?? "That didn't go through. Try again, or send this order to us."
    : null;

  const toneText = tone === "danger" ? "var(--danger)" : "var(--amber-text)";
  const toneSoft = tone === "danger" ? "var(--danger-soft)" : "var(--amber-soft)";
  const toneEdge = tone === "danger" ? "var(--danger)" : "var(--amber)";

  return (
    <section
      aria-labelledby={`problem-headline-${order.id}`}
      data-testid="order-problem-panel"
      data-problem-status={status}
      data-problem-mode={isGate ? "gate" : "banner"}
      data-problem-tier={tier}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${toneEdge}`,
        borderRadius: 10,
        overflow: "hidden",
        width: "100%",
        maxWidth: isGate ? 560 : undefined,
        margin: isGate ? "48px auto 0" : undefined,
      }}
    >
      {/* Header band — icon + headline + the SAME status pill the inbox row shows,
          so the two surfaces cannot disagree about what this state is called. */}
      <div
        className="flex flex-wrap items-center gap-2"
        style={{
          padding: "12px 20px",
          minHeight: 44,
          background: toneSoft,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Icon size={16} strokeWidth={2} color={toneText} aria-hidden />
        <h2
          id={`problem-headline-${order.id}`}
          style={{ margin: 0, fontSize: 15, fontWeight: 700, color: toneText, minWidth: 0 }}
        >
          {copy.headline}
        </h2>
        <span style={{ marginLeft: "auto" }}>
          <UnifiedStatusBadge size="md" status={status} />
        </span>
      </div>

      <div style={{ padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: "var(--ink)", lineHeight: 1.55 }}>
          {copy.attribution(ctx)}
        </p>

        {/* The server's own words — never paraphrased, because they are the only thing an
            engineer can act on. Cleaned, though, not verbatim: see the `detail` derivation
            above for why "verbatim" was the bug rather than the promise. */}
        {detail && (
          <p
            style={{
              margin: 0,
              padding: "8px 12px",
              background: "var(--surface-2)",
              borderRadius: 6,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--ink-muted)",
              overflowWrap: "anywhere",
            }}
          >
            {detail}
          </p>
        )}

        {/* What happens on its own, then the cost of doing nothing. Both always
            print: an empty space where "we're retrying" would go reads as
            "someone is handling it". */}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {[copy.automaticFor(ctx), copy.consequence(ctx)].map((line, i) => (
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--border-strong)",
                  marginTop: 7,
                }}
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {paused && (
          <p style={{ margin: 0, fontSize: 12.5 }}>
            <Link href="/operations/health" className={FOCUS} style={{ color: "var(--brand-blue-deep)", fontWeight: 600 }}>
              Check system health →
            </Link>
          </p>
        )}

        {/* The recovery POST's own failure — the THIRD door, and the one that survives a
            careful reading of the two above. `api-client.ts` builds
            `error ?? \`${fallback}: ${responseText}\`` when the body is not JSON with an
            { error } field, so a gateway 502 (an HTML page) lands in ApiHttpError.message and
            useProblemAction puts it straight in this block. Same rule as the detail above:
            nothing off the wire reaches operator prose without being made fit to read. The
            fallback keeps the alert from ever going silent if nothing legible survives. */}
        {actionError && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "8px 12px",
              background: "var(--danger-soft)",
              border: "1px solid rgba(180,56,56,.25)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--danger)",
            }}
          >
            {actionError}
          </p>
        )}

        {action.phase === "queued" && (
          <p
            role="status"
            aria-live="polite"
            style={{
              margin: 0,
              padding: "8px 12px",
              background: "var(--brand-blue-soft)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--brand-blue-deep)",
            }}
          >
            Queued — waiting for it to start. This page updates on its own; you don&rsquo;t need to click again.
          </p>
        )}

        {/* The panel owns the ONLY action on the screen (the workshop's send is
            replaced by a disabled control while any problem state is live). */}
        <div className="flex flex-col sm:flex-row sm:items-center" style={{ gap: 10, flexWrap: "wrap" }}>
          {actions.map((a, i) => (
            <ActionControl
              key={i}
              action={a}
              order={order}
              supplier={supplier}
              busy={action.busy}
              activePendingLabel={action.activeOp}
              onRun={action.run}
            />
          ))}
          {tier === "us" && (
            <Link
              href={`/support?order=${encodeURIComponent(ctx.po)}&problem=${status}`}
              className={FOCUS}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--brand-blue-deep)",
                textDecoration: "underline",
              }}
            >
              Get help with this order
            </Link>
          )}
        </div>

        {tier === "wait" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-muted)" }}>
            You don&rsquo;t have to do anything — this is only if you want it to go sooner.
          </p>
        )}

        {helper && (
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>{helper}</p>
        )}
      </div>
    </section>
  );
}

/** One action row entry: a link, a real POST, a slot, or the §5 resolver. */
function ActionControl({
  action,
  order,
  supplier,
  busy,
  activePendingLabel,
  onRun,
}: {
  action: ProblemAction;
  order: Order;
  supplier: string;
  busy: boolean;
  activePendingLabel: string | null;
  onRun: (op: Parameters<ReturnType<typeof useProblemAction>["run"]>[0]) => Promise<void>;
}) {
  if (action.kind === "slot") {
    // The supplier picker keeps its own component: it owns the ranked
    // suggestions and the 409 "someone else assigned it first" race.
    return <AssignSupplierBanner order={order} />;
  }

  if (action.kind === "resolver") {
    return (
      <div style={{ width: "100%" }}>
        <UnconfirmedResolver order={order} supplier={supplier} busy={busy} onRun={onRun} />
      </div>
    );
  }

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    padding: "0 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
  };
  const styleFor = (variant: string, disabled: boolean) =>
    variant === "primary"
      ? {
          ...base,
          background: disabled ? "var(--surface-2)" : "var(--navy)",
          color: disabled ? "var(--ink-muted)" : "#FFFFFF",
          border: `1px solid ${disabled ? "var(--border)" : "var(--navy)"}`,
        }
      : {
          ...base,
          background: "transparent",
          color: disabled ? "var(--ink-muted)" : "var(--ink)",
          border: `1px solid var(--border)`,
        };

  if (action.kind === "link") {
    return (
      <Link href={action.href} className={FOCUS} style={styleFor(action.variant, false)}>
        {action.label}
      </Link>
    );
  }

  const disabled = busy || Boolean(action.disabledReason);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={() => void onRun(action.op)}
        disabled={disabled}
        className={FOCUS}
        style={{ ...styleFor(action.variant, disabled), cursor: disabled ? "not-allowed" : "pointer" }}
      >
        {busy && activePendingLabel === action.op ? action.pendingLabel : action.label}
      </button>
      {/* Disabled ≠ unexplained: the reason is visible text, not a title attribute
          (invisible to touch and to several screen-reader combinations). */}
      {action.disabledReason && (
        <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{action.disabledReason}</span>
      )}
    </span>
  );
}

export default OrderProblemPanel;
