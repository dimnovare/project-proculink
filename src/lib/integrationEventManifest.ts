// The webhook event catalogue, mirrored from the backend.
//
// Hand-typed copy of `IntegrationEventTypes.Subscribable`
// (`ProcuLink.Core/Constants/IntegrationEventTypes.cs`) — the allow-list
// `IntegrationController.Create` enforces, which the backend keeps in exact
// lockstep with every event it emits (enforced there by
// `IntegrationEventTypesAreSubscribableTests`).
//
// WHY A MIRROR EXISTS: the Settings ▸ Notifications event menu used to be a
// private three-entry map with nothing tying it to the backend list. The
// backend grew to five events (`order.rejected`, `order.dead_lettered`) and the
// menu never followed, so the two events could be delivered but never
// subscribed to from the UI. `order.dead_lettered` is the terminal "this order
// is NOT coming" signal — a subscriber cannot derive it from the per-attempt
// `order.failed`, because the retry cap is server-side configuration it cannot
// see. A customer wiring alerts could hear "this try failed" but never
// "we gave up".
//
// `src/lib/integrationEventManifest.test.ts` diffs this list against the real
// C# whenever a backend checkout is reachable (same pattern as
// `src/test/backendMirror.test.ts`), and asserts the label map below covers it
// exactly, both directions.
export const SUBSCRIBABLE_INTEGRATION_EVENTS = [
  "order.created",
  "order.delivered",
  "order.failed",
  "order.rejected",
  "order.dead_lettered",
] as const;

export type SubscribableIntegrationEvent = (typeof SUBSCRIBABLE_INTEGRATION_EVENTS)[number];

// Plain-procurement descriptions, rendered beside the literal code in the
// Settings event menu and on saved endpoint rows. Vocabulary matches what the
// rest of the product already calls these states:
//   • "Couldn't send" is the shipped label for delivery_failed
//     (src/lib/orderStatusManifest.ts) — the retired "Delivery failed" must not
//     come back in through this door.
//   • "Supplier rejected" is the shipped label for rejected_by_supplier
//     (src/lib/auditActionManifest.ts, order lifecycle labels).
//   • "Out of retries" is the shipped label for delivery_dead_letter
//     (src/lib/auditActionManifest.ts, /operations/health tiles). No
//     "dead letter" jargon in user-facing copy.
//
// `order.failed` fires once per failed ATTEMPT and is compatible with the order
// still arriving on a later retry; `order.dead_lettered` is the terminal one.
// The two descriptions must keep that distinction legible side by side in the
// menu.
export const INTEGRATION_EVENT_LABELS: Record<SubscribableIntegrationEvent, string> = {
  "order.created":       "New PO uploaded or received",
  "order.delivered":     "PO delivered to supplier",
  "order.failed":        "Couldn't send to the supplier",
  "order.rejected":      "Supplier rejected the PO",
  "order.dead_lettered": "Out of retries, the PO won't be sent",
};
