/**
 * reloadPage — re-request the current document.
 *
 * Exists as a one-line module for one reason: `window.location.reload()` is
 * unmockable in jsdom (it throws "Not implemented: navigation"), so any code
 * path that ends in a reload is untestable while the call is inline. Behind
 * this indirection a test can `vi.mock("@/lib/reload")` and assert the wiring.
 *
 * Used by the degraded-state pattern (WP-32): when a hard external dependency's
 * script fails to load, there is no supported way to re-invoke it in place —
 * re-requesting the resource means re-requesting the document.
 */
export function reloadPage(): void {
  if (typeof window === "undefined") return;
  window.location.reload();
}
