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
import { PROBLEM_COPY, problemFor, type ProblemAction, type ProblemCtx, type ProblemStatus } from "./problemCopy";
import { useProblemAction } from "./useProblemAction";
import { UnconfirmedResolver } from "./UnconfirmedResolver";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]";

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

  // The rejection reason lives on the passport, three clicks away behind
  // Details → Supplier response. Fetch it for this ONE rare status so the reason
  // is in the panel that is asking the operator to act on it.
  const { data: passport } = useQuery({
    queryKey: ["passport", order.id],
    queryFn: () => apiClient.getOrderPassport(order.id),
    enabled: queryEnabled && status === "rejected_by_supplier",
    staleTime: 60_000,
    retry: 1,
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
  const rejectionReason =
    status === "rejected_by_supplier"
      ? (passport as { supplierResponse?: { rejectionReason?: string | null } } | null | undefined)
          ?.supplierResponse?.rejectionReason ?? null
      : null;

  const ctx: ProblemCtx = {
    supplier,
    po: poTitleFrom(order.poNumber),
    supplierId: order.supplierId ?? null,
    orderId: order.id,
    serverMessage: order.errorMessage?.trim() ? order.errorMessage : null,
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
  const detail = rejectionReason ?? ctx.serverMessage ?? detailFallback;
  const actions = copy.actions(ctx);

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

        {/* The server's own words, verbatim — never paraphrased, because it is the
            only thing an engineer can act on. Rendered only when it exists. */}
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

        {action.error && (
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
            {action.error}
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
