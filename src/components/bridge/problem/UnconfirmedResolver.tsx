"use client";

/* =============================================================================
   UnconfirmedResolver — the deliberate-friction interaction for an order parked
   in `delivery_unconfirmed`.

   HARD CONSTRAINT: this state must never offer a one-click re-send. A crash lost
   the delivery outcome on a channel that cannot tell us after the fact whether
   the PO arrived, so re-sending may hand the supplier a second copy of the same
   order — and marking it delivered may leave them without it forever. The two
   resolutions are irreversible in OPPOSITE directions, and only the supplier
   knows which one is right.

   So the friction is not a speed bump; it is a statement of fact. Step 2 asks
   what the supplier said, and that question cannot be answered without
   contacting them. Type-to-confirm was considered and rejected: at 390px,
   typing a PO number to escape a stuck order just trains people to copy-paste
   past the gate.

   Step 3 renders NOTHING until step 2 is answered — absent, not disabled. A
   disabled button is an invitation; an absent one is a question. Each answer
   reveals exactly ONE action, and switching answers withdraws the previous one.
   The shipped confirm dialog (Radix AlertDialog, focus-trapped, Esc-closing)
   remains the second gate, with its risk copy kept verbatim.
   ============================================================================= */

import { useState } from "react";
import { useConfirm } from "@/components/ui/confirm";
import type { Order } from "@/types/procurement";
import { orderGrandTotalLabel } from "../review/orderDisplay";
import { poTitleFrom } from "../workshop/WorkshopGateChrome";
import type { ProblemOp } from "./problemActions";

type Answer = "not_arrived" | "already_have" | "unreachable";

const ANSWERS: Array<{ id: Answer; label: string }> = [
  { id: "not_arrived", label: "They don't have it — nothing arrived" },
  { id: "already_have", label: "They have it — it's already in their system" },
  { id: "unreachable", label: "I haven't been able to reach them yet" },
];

/** What each answer unlocks. `null` = the honest "no resolution yet". */
const RESOLUTION: Record<
  Answer,
  | {
      op: Extract<ProblemOp, "redeliverOrder" | "markDelivered">;
      label: string;
      pendingLabel: string;
      variant: "primary" | "secondary";
      consequence: (supplier: string) => string;
      confirm: { title: string; description: string; confirmLabel: string; danger?: boolean };
    }
  | null
> = {
  not_arrived: {
    op: "redeliverOrder",
    label: "Send it to them again",
    pendingLabel: "Sending…",
    variant: "primary",
    consequence: (s) => `${s} will receive this order for the first time.`,
    confirm: {
      title: "Send this order again?",
      description: "If the supplier already received this order, sending again may give them a duplicate.",
      confirmLabel: "Send again",
    },
  },
  already_have: {
    op: "markDelivered",
    label: "Mark it as delivered",
    pendingLabel: "Recording…",
    variant: "secondary",
    consequence: () => "We'll record it as delivered and stop asking. Nothing will be sent.",
    confirm: {
      title: "Mark this order as delivered?",
      description: "If the supplier never received this order, marking it delivered means it will not be sent.",
      confirmLabel: "Mark delivered",
      danger: true,
    },
  },
  unreachable: null,
};

/** sessionStorage key for the operator's recorded assertion. */
export function assertionKey(orderId: string): string {
  return `problemAssertion:${orderId}`;
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]";

export function UnconfirmedResolver({
  order,
  supplier,
  busy,
  disabledReason,
  onRun,
}: {
  order: Order;
  supplier: string;
  busy: boolean;
  disabledReason?: string | null;
  onRun: (op: ProblemOp) => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  // Defensive: the total sums the order's lines, and this panel renders on a
  // status the operator can reach from a list view whose payload may carry none.
  // A missing total hides itself (never "€ 0.00"); it must never take the panel
  // that is asking for a decision down with it.
  const total = order.lines ? orderGrandTotalLabel(order) : "";
  const lineCount = order.lines?.length ?? 0;
  const orderedOn = order.orderDate ? new Date(order.orderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const details = [
    poTitleFrom(order.poNumber),
    orderedOn ? `ordered ${orderedOn}` : null,
    lineCount > 0 ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : null,
    total || null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const resolution = answer ? RESOLUTION[answer] : null;
  const answerLabel = answer ? ANSWERS.find((a) => a.id === answer)!.label : "";

  async function act() {
    if (!resolution || busy) return;
    const ok = await confirm(resolution.confirm);
    if (!ok) return;
    // The assertion is the load-bearing part of this interaction, and neither
    // endpoint accepts a body today (POST /redeliver and POST /mark-delivered take
    // none). So it is recorded client-side and shown back, rather than silently
    // dropped — the operator's reason must not vanish on the most consequential
    // decision in the product. When the backend accepts `{ reason }`, this is the
    // string to send.
    try {
      sessionStorage.setItem(assertionKey(order.id), answerLabel);
    } catch {
      /* private mode — the in-view record below still holds for this session */
    }
    setRecorded(answerLabel);
    await onRun(resolution.op);
  }

  function copyDetails() {
    try {
      void navigator.clipboard?.writeText(`${details}\n${window.location.href}`);
    } catch {
      /* clipboard unavailable — the details are selectable text right above */
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Step 1 — what we know, in a form that can be read down a phone line. */}
      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "10px 12px",
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-muted)" }}>
          Ask {supplier} whether they have this order:
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
            color: "var(--ink)",
            userSelect: "all",
            overflowWrap: "anywhere",
          }}
        >
          {details}
        </p>
        <button
          type="button"
          onClick={copyDetails}
          className={FOCUS}
          style={{
            marginTop: 8,
            minHeight: 40,
            padding: "0 12px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Copy details
        </button>
      </div>

      {/* Step 2 — a real radio group, so arrow keys work and it is announced as
          ONE control with its question. This is the gate. */}
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", padding: 0, marginBottom: 6 }}>
          What did {supplier} say?
        </legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {ANSWERS.map((a) => (
            <label
              key={a.id}
              className={FOCUS}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 44,
                padding: "0 10px",
                borderRadius: 7,
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 13,
                color: "var(--ink)",
                background: answer === a.id ? "var(--surface-2)" : "transparent",
                border: `1px solid ${answer === a.id ? "var(--border-strong)" : "transparent"}`,
              }}
            >
              <input
                type="radio"
                name={`unconfirmed-${order.id}`}
                value={a.id}
                checked={answer === a.id}
                disabled={busy}
                onChange={() => {
                  setAnswer(a.id);
                  setRecorded(null);
                }}
                style={{ width: 18, height: 18, accentColor: "var(--brand-blue)" }}
              />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Step 3 — exactly one action, and only once the question is answered.
          The consequence line sits directly above its button so it cannot be
          scrolled past on a phone. */}
      {answer !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-muted)" }}>
            {resolution
              ? resolution.consequence(supplier)
              : "This order stays here. We won't send anything until you know."}
          </p>
          {resolution ? (
            <>
              <button
                type="button"
                onClick={() => void act()}
                disabled={busy || Boolean(disabledReason)}
                className={FOCUS}
                style={{
                  alignSelf: "flex-start",
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: busy || disabledReason ? "not-allowed" : "pointer",
                  background: resolution.variant === "primary" ? "var(--navy)" : "var(--surface)",
                  color: resolution.variant === "primary" ? "#FFFFFF" : "var(--ink)",
                  border: `1px solid ${resolution.variant === "primary" ? "var(--navy)" : "var(--border)"}`,
                  opacity: busy || disabledReason ? 0.6 : 1,
                }}
              >
                {busy ? resolution.pendingLabel : resolution.label}
              </button>
              {disabledReason && (
                <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-muted)" }}>{disabledReason}</p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAnswer(null)}
              className={FOCUS}
              style={{
                alignSelf: "flex-start",
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--ink-muted)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Leave it as it is
            </button>
          )}
        </div>
      )}

      {recorded && (
        <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink-muted)" }}>
          You recorded: &ldquo;{recorded}&rdquo;
        </p>
      )}
    </div>
  );
}

export default UnconfirmedResolver;
