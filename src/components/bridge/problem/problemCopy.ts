// problemCopy — ONE contract for every state an order can get stuck in.
//
// Eight statuses, five questions, one typed record. The questions are always
// answered in this order, in these words, wherever the state appears:
//
//   1  WHAT HAPPENED              headline
//   2  WHOSE IT IS                attribution   (never blames the operator)
//   3  WHAT HAPPENS AUTOMATICALLY automatic — or nothingAutomatic, said out loud,
//                                 because silence reads as "it's being handled"
//   4  WHAT YOU CAN DO NOW        actions
//   5  THE COST OF DOING NOTHING  consequence
//
// Three surfaces consume it: the order screen renders all five (OrderProblemPanel),
// the inbox row renders `tone` + `rowAction`, the health page groups by `tier`.
// They agree by construction instead of by review — which is how five hand-written
// panels drifted into three vocabularies and two of them ended up offering buttons
// the backend answers 400 to.
//
// The status is the ONLY input. There is deliberately no `title`/`message`/`tone`
// prop anywhere downstream.

import type { ProblemOp } from "./problemActions";

export const PROBLEM_STATUSES = [
  "failed", // couldn't read the file
  "unrouted", // no supplier known
  "transform_failed", // couldn't build the supplier's file
  "delivery_failed", // couldn't reach the supplier, retrying
  "delivery_dead_letter", // stopped retrying
  "rejected_by_supplier", // supplier refused it
  "delivery_unconfirmed", // sent, no confirmation
  "delivery_held", // paused by plan
] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** self = you can fix this · wait = we're on it · us = this needs support. */
export type Tier = "self" | "wait" | "us";

export type ProblemActionVariant = "primary" | "secondary" | "ghost";

export type ProblemAction =
  | {
      kind: "link";
      label: string;
      href: string;
      variant: ProblemActionVariant;
    }
  | {
      kind: "post";
      label: string;
      pendingLabel: string;
      op: ProblemOp;
      variant: ProblemActionVariant;
      /**
       * Non-null renders the control VISIBLE but disabled, with this sentence
       * beside it. Visible so the path stays discoverable; disabled so the click
       * cannot fire a request that is guaranteed to fail.
       */
      disabledReason?: string | null;
    }
  /** The §5 deliberate-friction strip. Never a one-click send. */
  | { kind: "resolver"; resolver: "unconfirmed" }
  /** An existing component owns this action (the supplier picker + its 409 handling). */
  | { kind: "slot"; slot: "assignSupplier" };

export interface ProblemCtx {
  /** order.supplierName, or "this supplier" when we don't know it yet. */
  supplier: string;
  /** poTitleFrom(order.poNumber). */
  po: string;
  supplierId: string | null;
  orderId: string;
  /** order.errorMessage — rendered verbatim in its own block, never interpolated. */
  serverMessage: string | null;
  /** Pilot ended / plan is read-only: every POST is refused server-side. */
  readOnly: boolean;
  atOrderLimit: boolean;
  /** The Hangfire Worker is down: nothing parses, transforms or delivers. */
  processingPaused: boolean;
}

export interface ProblemCopy {
  /** Amber = needs a person, nothing broke. Red = something broke. */
  tone: "warning" | "danger";
  /**
   * gate = replace the page (nothing underneath is worth reading).
   * banner = sit above the live workshop.
   * Only `failed` is a gate: for every other state the extracted order, its item
   * codes and (where it exists) the generated output ARE the evidence the operator
   * needs. Hiding them behind a full-screen panel is what left transform_failed
   * with a primary button that navigated to the page it was already on.
   */
  presentation: "gate" | "banner";
  /** The status pill's words. Mirrors UnifiedStatusBadge; never re-invented here. */
  badge: string;
  headline: string;
  attribution: (c: ProblemCtx) => string;
  /** What runs on its own. `null` means nothing does — see nothingAutomatic. */
  automatic: string | null;
  /** Printed when `automatic` is null. One of the two is always present. */
  nothingAutomatic: string | null;
  /** Appended when order processing is paused. Honest per state, never "it will start". */
  pausedNote: string;
  actions: (c: ProblemCtx) => ProblemAction[];
  consequence: (c: ProblemCtx) => string;
  helper?: (c: ProblemCtx) => string | null;
  tier: (c: ProblemCtx) => Tier;
  /** ≤22 chars. The inbox row's second line — the one line that says what to do. */
  rowAction: string;
  /** The rendered "what happens automatically" line, outage included. */
  automaticFor: (c: ProblemCtx) => string;
}

/**
 * True when a delivery failure is the "no delivery config" cliff, not a transient
 * one. Matches the backend DeliveryService message plus close variants. Retrying
 * can NEVER fix this, so the panel leads with setup and disables the retry.
 * (Moved verbatim from the retired FailedPanels.tsx.)
 */
export function isDeliveryConfigMissing(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return /delivery\s+config(uration)?\s+is\s+missing|missing\s+(supplier\s+)?delivery\s+config/i.test(errorMessage);
}

const HELP = (c: ProblemCtx, status: ProblemStatus): ProblemAction => ({
  kind: "link",
  variant: "ghost",
  label: "Get help with this order",
  href: `/support?order=${encodeURIComponent(c.po)}&problem=${status}`,
});

const READ_ONLY_REASON =
  "Your Pilot has ended. You can still view previous orders, but new processing is paused.";

/** Read-only plans refuse every POST server-side — say so instead of firing it. */
function postGuard(c: ProblemCtx): string | null {
  return c.readOnly ? READ_ONLY_REASON : null;
}

function withAutomaticFor(
  copy: Omit<ProblemCopy, "automaticFor">,
): ProblemCopy {
  return {
    ...copy,
    automaticFor: (c) => {
      const base = copy.automatic ?? copy.nothingAutomatic ?? "";
      return c.processingPaused ? `${base} ${copy.pausedNote}` : base;
    },
  };
}

// ─── The eight states ────────────────────────────────────────────────────────

export const PROBLEM_COPY: Record<ProblemStatus, ProblemCopy> = {
  // 3.1 — we could not read this file. The only state that is a GATE: parsing
  // produced no lines, no header and no output, so there is nothing underneath.
  failed: withAutomaticFor({
    tone: "danger",
    presentation: "gate",
    badge: "Couldn't read file",
    headline: "We couldn't read this file",
    attribution: () => "This is about the file, not your setup — nothing here is misconfigured.",
    automatic: null,
    nothingAutomatic: "Nothing more will happen to this order on its own.",
    pausedNote: "Order processing is paused right now — that doesn't change anything here.",
    consequence: (c) =>
      `${c.supplier} has not received this order, and won't until a file we can read replaces it.`,
    actions: (c) => [
      {
        kind: "link",
        variant: "primary",
        label: "Upload this order again",
        href: c.supplierId ? `/upload?supplierId=${c.supplierId}` : "/upload",
      },
      { kind: "link", variant: "secondary", label: "See which file types we can read", href: "/formats" },
      HELP(c, "failed"),
    ],
    helper: () => "Your original file is stored. If you send it to us we can tell you what we saw.",
    // `us` from the start for this state alone: a file the parser rejected is not
    // something a purchasing coordinator can debug.
    tier: () => "us",
    rowAction: "Upload it again",
  }),

  // 3.2 — we don't know which supplier this is for. The picker itself stays in
  // AssignSupplierBanner (it owns the ranked suggestions and the 409 race).
  unrouted: withAutomaticFor({
    tone: "warning",
    presentation: "banner",
    badge: "Needs supplier",
    headline: "We don't know which supplier this order is for",
    attribution: () =>
      "Nothing is wrong — we just need you to say who this is for before we can match item codes.",
    automatic: null,
    nothingAutomatic: "This order waits here until you choose a supplier. We won't guess.",
    pausedNote: "Order processing is paused right now, so anything you start here waits until it restarts.",
    consequence: () => "Nothing has been sent, and nothing will be, until this order has a supplier.",
    actions: () => [
      { kind: "slot", slot: "assignSupplier" },
      { kind: "link", variant: "secondary", label: "Add a new supplier", href: "/library/suppliers" },
    ],
    helper: () => "Once you choose, we read the file again and match the item codes automatically.",
    tier: () => "self",
    rowAction: "Assign a supplier",
  }),

  // 3.3 — D1's fix. The backend treats transform_failed as recoverable (it is an
  // accepted entry status for `transforming`) and it holds NO output, so nothing
  // stale can ship. The output setup is the primary because the failure is terminal
  // for the same inputs; building again is the honest secondary.
  //
  // The primary points at the supplier's Delivery tab, NOT /library/templates. The
  // spec named the templates page, but FE #47 retired it — and its stated reason is
  // exactly why this CTA must not go there: "the output format lives on each
  // supplier's delivery config, and the page's save posted a body the API never
  // read. It described a control that did not exist." The templates URL still
  // answers (a 308 to /library/suppliers, supplier id dropped), so a link crawl
  // cannot see the problem: it resolves, it just resolves to a list instead of the
  // one screen where `outputFormat` and the cXML credentials are actually editable.
  transform_failed: withAutomaticFor({
    tone: "danger",
    presentation: "banner",
    badge: "Couldn't build output",
    headline: "We couldn't build the file this supplier needs",
    attribution: (c) => `Your order is fine — the output we build for ${c.supplier} isn't.`,
    automatic: null,
    nothingAutomatic: "We won't try to build it again on our own.",
    pausedNote: "Order processing is paused right now, so anything you start here waits until it restarts.",
    consequence: (c) =>
      `${c.supplier} has not received this order — and every future order for them will stop in the same place until this is fixed.`,
    actions: (c) => [
      {
        kind: "link",
        variant: "primary",
        label: "Open the output settings",
        href: c.supplierId ? `/library/suppliers/${c.supplierId}?tab=delivery` : "/library/suppliers",
      },
      {
        kind: "post",
        variant: "secondary",
        label: "Try building it again",
        pendingLabel: "Building…",
        op: "transformOrder",
        disabledReason: postGuard(c),
      },
    ],
    helper: () =>
      "If nothing has changed in those settings, building it again won't help — send us the message above instead.",
    tier: () => "self",
    rowAction: "Check output settings",
  }),

  // 3.4 — the only `wait` state. NEVER renders "attempt N of M" or a countdown:
  // Order carries neither number, and an invented one is the difference between
  // an operator waiting and an operator escalating on the wrong schedule.
  delivery_failed: withAutomaticFor({
    tone: "danger",
    presentation: "banner",
    badge: "Couldn't send",
    headline: "We couldn't reach this supplier",
    attribution: (c) =>
      isDeliveryConfigMissing(c.serverMessage)
        ? "We built the file. We just don't know where to send it."
        : `${c.supplier}'s system didn't accept the connection. There's nothing wrong with the order itself.`,
    automatic: "We're trying again automatically. Each try waits a little longer than the last.",
    nothingAutomatic: null,
    pausedNote: "Order processing is paused right now, so the next try starts once it restarts.",
    consequence: (c) =>
      isDeliveryConfigMissing(c.serverMessage)
        ? `This order — and every other order for ${c.supplier} — stays here until delivery is set up. It takes about a minute.`
        : "If the automatic tries run out, this order stops and waits for you.",
    actions: (c) => {
      const configMissing = isDeliveryConfigMissing(c.serverMessage);
      const retry: ProblemAction = {
        kind: "post",
        // Retry is allowed at the plan's order limit: the meter counts at creation,
        // so retrying an existing order consumes nothing new.
        variant: configMissing ? "secondary" : "primary",
        label: "Try sending now",
        pendingLabel: "Queued…",
        op: "retryDelivery",
        disabledReason: configMissing
          ? "This will work once delivery is set up."
          : postGuard(c),
      };
      if (configMissing) {
        return [
          {
            kind: "link",
            variant: "primary",
            label: "Set up delivery",
            href: c.supplierId ? `/library/suppliers/${c.supplierId}?tab=delivery` : "/library/suppliers",
          },
          retry,
        ];
      }
      return [
        retry,
        {
          kind: "link",
          variant: "secondary",
          label: "See every attempt",
          href: `/operations/log?orderId=${c.orderId}`,
        },
      ];
    },
    helper: (c) =>
      isDeliveryConfigMissing(c.serverMessage)
        ? null
        : "You don't have to do anything — this is only if you want it to go sooner.",
    tier: (c) => (isDeliveryConfigMissing(c.serverMessage) ? "self" : "wait"),
    rowAction: "Retrying automatically",
  }),

  // 3.5 — D2's fix. Two changes from the shipped screen: the endpoint is the ops
  // requeue (redeliver answers 400 from here), and the settings check is promoted
  // ahead of a blind retry.
  delivery_dead_letter: withAutomaticFor({
    tone: "danger",
    presentation: "banner",
    badge: "Out of retries",
    headline: "We stopped trying to reach this supplier",
    attribution: () =>
      "We tried several times over a longer and longer wait. Every try was refused, so we stopped rather than keep hammering their system.",
    automatic: null,
    nothingAutomatic: "We won't try again by ourselves. This order needs you now.",
    pausedNote: "Order processing is paused right now, so anything you start here waits until it restarts.",
    consequence: (c) =>
      `${c.supplier} does not have this order. It will sit here until someone sends it — nothing else is queued.`,
    actions: (c) => [
      {
        kind: "post",
        variant: "primary",
        label: "Start sending again",
        pendingLabel: "Queued…",
        op: "requeueDelivery",
        disabledReason: postGuard(c),
      },
      {
        kind: "link",
        variant: "secondary",
        label: "Check the delivery settings",
        href: c.supplierId ? `/library/suppliers/${c.supplierId}?tab=delivery` : "/library/suppliers",
      },
    ],
    helper: () =>
      "If nothing has changed at the supplier's end, this will probably fail the same way — check their settings first.",
    tier: () => "self",
    rowAction: "Needs you to send it",
  }),

  // 3.6 — D4's fix. rejected_by_supplier has NO outgoing transitions: it is
  // terminal. So there is no post action here at all, and the "send again" the
  // mapper used to offer is replaced by starting a corrected order.
  rejected_by_supplier: withAutomaticFor({
    tone: "danger",
    presentation: "banner",
    badge: "Supplier rejected",
    headline: "This supplier refused this order",
    attribution: () => "They received it and turned it down. Their reason is below.",
    automatic: null,
    nothingAutomatic: "Nothing is queued. Sending the same file again would be refused the same way.",
    pausedNote: "Order processing is paused right now — that doesn't change anything here.",
    consequence: (c) =>
      `${c.supplier} is not fulfilling this order. If you need it, fix what they flagged and send a corrected order.`,
    actions: (c) => [
      {
        kind: "link",
        variant: "primary",
        label: "See their reply",
        href: `/inbox/${c.orderId}?details=response`,
      },
      {
        kind: "link",
        variant: "secondary",
        label: "Start a corrected order",
        href: c.supplierId
          ? `/upload?supplierId=${c.supplierId}&from=${c.orderId}`
          : `/upload?from=${c.orderId}`,
      },
    ],
    helper: () => "We'll keep this one as the record of what they refused.",
    tier: () => "self",
    rowAction: "See their reply",
  }),

  // 3.7 — the park. §5 owns the interaction: an explicit statement of fact, then
  // exactly one action, then the shipped confirm. No one-click re-send exists.
  delivery_unconfirmed: withAutomaticFor({
    tone: "warning",
    presentation: "banner",
    badge: "Delivery unknown",
    headline: "We may have sent this — we can't tell",
    attribution: (c) =>
      `Neither side is at fault. The connection dropped between sending and ${c.supplier} confirming, and this channel can't tell us after the fact whether it arrived.`,
    automatic:
      "We will not send this again by ourselves. That is deliberate — an automatic re-send could give the supplier the same order twice.",
    nothingAutomatic: null,
    pausedNote: "Order processing is paused right now, so anything you start here waits until it restarts.",
    consequence: (c) =>
      `Left alone, this stays unresolved: ${c.supplier} may be working on it, or may never have seen it.`,
    actions: () => [{ kind: "resolver", resolver: "unconfirmed" }],
    helper: () => "The safe first step is a phone call.",
    tier: () => "self",
    rowAction: "Check with supplier",
  }),

  // 3.8 — a pause, not a failure. The release is automatic, so offering anything
  // besides billing would be theatre (redeliver answers 400 from here).
  delivery_held: withAutomaticFor({
    tone: "warning",
    presentation: "banner",
    badge: "Delivery paused",
    headline: "Sending is paused on your plan",
    attribution: () => "This is about your plan, not the order. Nothing failed and nothing is lost.",
    automatic:
      "Sending starts again by itself as soon as your billing is up to date. You don't need to come back here.",
    nothingAutomatic: null,
    pausedNote: "Order processing is paused right now as well, so sending resumes once both are clear.",
    consequence: (c) =>
      `Until then ${c.supplier} hasn't received this order. Everything we built for it is waiting exactly as it is.`,
    actions: () => [
      { kind: "link", variant: "primary", label: "Go to billing", href: "/settings?tab=billing" },
    ],
    helper: (c) => `You don't need to upload ${c.po} again or redo any item codes.`,
    tier: () => "self",
    rowAction: "Waiting on billing",
  }),
};

/** The ProblemCopy for a raw order status, or null when the order is healthy. */
export function problemFor(status: string | null | undefined): ProblemCopy | null {
  if (!status) return null;
  return (PROBLEM_COPY as Record<string, ProblemCopy | undefined>)[status] ?? null;
}

export function isProblemStatus(status: string | null | undefined): status is ProblemStatus {
  return problemFor(status) !== null;
}
