import type { QueryClient } from "@tanstack/react-query";

/**
 * The cache key for a supplier's saved delivery configuration, and the one way to
 * invalidate it.
 *
 * Why this exists as a named export rather than four hand-typed array literals:
 * every surface that ASKS for a delivery config typed the key itself, and every
 * mutation that CHANGES one invalidated something else. The read was warm and
 * long-lived (`staleTime`), so after a save or a delete the screen kept answering
 * from a cache nothing had told to forget — and the answer it kept giving was a
 * claim about the supplier's delivery setup.
 *
 * Two things went wrong with that, and the second is the dangerous one:
 *
 *   1. A deleted config still rendered as configured (channel, format, "Auto-process
 *      · On"), and a freshly saved one still rendered as "Not set".
 *
 *   2. `FirstTimeDeliveryOffer` gates on a definite `data === null`. Reading a stale
 *      `null` made it offer the guided wizard directly above an editor that had just
 *      confirmed a save — and that wizard builds a config FROM SCRATCH. Accepting the
 *      offer overwrote the credential just stored (HTTP with auth "none" posts
 *      `{"type":"none"}`) and dropped exactly the keys
 *      `DeliveryConfigEditor.carriedOverConfigKeys()` exists to preserve.
 *
 * So: mutate a delivery config, invalidate it here. Both are in one file precisely so
 * a new call site cannot invent its own spelling of the key and re-open the gap.
 */
export function deliveryConfigQueryKey(supplierId: string): [string, string] {
  return ["supplier-delivery-config", supplierId];
}

/**
 * Drop the cached delivery config for one supplier.
 *
 * Call after ANY write that can change what `GET /suppliers/{id}/delivery-config`
 * returns — save, delete, or a create that writes a channel alongside the supplier.
 * A test fire is not such a write: it returns a `DeliveryTestResult` and changes no
 * field on `DeliveryConfig`, so it deliberately does not invalidate this key.
 */
export function invalidateDeliveryConfig(
  queryClient: QueryClient,
  supplierId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: deliveryConfigQueryKey(supplierId) });
}
