import type { OpsHealth } from "@/lib/api-client";

/**
 * Is the org genuinely free of anything an operator should look at?
 *
 * Extracted from the page so the gate is testable on its own: it decides whether the
 * green "All clear" banner renders, which is the single most trusted assertion the
 * product makes. A wrong `true` here is a lie an operator acts on by walking away.
 *
 * Deliberately a list of DIRECT checks rather than a read of the backend's aggregated
 * `totalProblemOrders`: the aggregate is an optimization, and it has already been wrong
 * once (it had no notion of a billing hold at all). `totalProblemOrders` is still
 * consulted as a backstop so a category the frontend has never heard of can still
 * break green — but it is never the only thing consulted.
 */
export function isAllClear(h: OpsHealth): boolean {
  // A dead Worker is not "all clear" even over an empty queue: nothing parses,
  // transforms or delivers, so every order that arrives next is already waiting.
  // Without this the page rendered the red "Order processing is paused" band
  // directly above a green "✓ All clear" — two contradictory claims, one screen.
  return h.workerHealthy && isQueueClear(h);
}

/**
 * The same count checks WITHOUT the Worker heartbeat: "is the QUEUE clear?".
 * Kept separate so the page can tell "nothing to do" apart from "nothing to do,
 * but nothing is running either" and word each honestly.
 */
export function isQueueClear(h: OpsHealth): boolean {
  return (
    h.totalProblemOrders === 0 &&
    h.openExceptions === 0 &&
    h.deliveryDeadLetter === 0 &&
    h.deliveryFailed === 0 &&
    h.transformFailed === 0 &&
    h.rejectedBySupplier === 0 &&
    h.failed === 0 &&
    h.parsingStuck === 0 &&
    h.deliveringStuck === 0 &&
    h.slaBreached === 0 &&
    // A paused delivery is not a fault, but it IS an unsent PO — so it cannot read as
    // "All clear". Checked directly rather than via the aggregate because whether the
    // backend folds held into totalProblemOrders is its own call; this gate must hold
    // either way. `?? 0` because the backend field ships separately from this page —
    // an older API omits the key, and a missing count must not invent a paused order.
    (h.deliveryHeld ?? 0) === 0 &&
    // A parked order (delivery_unconfirmed) IS a fault — the backend already folds it
    // into totalProblemOrders, so the backstop above already catches it. Checked
    // directly anyway, for the same reason as deliveryHeld: once the frontend knows a
    // category by name, it verifies it itself rather than trusting the aggregate alone.
    (h.deliveryUnconfirmed ?? 0) === 0 &&
    // Orders with no supplier resolved yet. A backlog, not a fault — but it is
    // work waiting on a person, and the tile that shows it (D6) would otherwise
    // sit under a green "All clear".
    (h.pendingRouting ?? 0) === 0
  );
}
