// Feature flags for in-progress UI surfaces. Kept separate from launch-flags.ts
// (which gates the launch *navigation* scope) so a feature toggle and a nav-scope
// toggle never get tangled.

/**
 * ORDER_WORKSHOP_V2 — the unified Order Workshop (IssuesPanel + the enhanced
 * MapperWorkbench) replacing the two-mode order-review screen. Off by default:
 * the existing review screen renders byte-identically until this is enabled.
 *
 * Enabled by EITHER:
 *   • env `NEXT_PUBLIC_ORDER_WORKSHOP_V2 === "true"` (prod/preview rollout), OR
 *   • a `?workshop=1` query override (per-session QA, no deploy needed).
 *
 * The env value is evaluated at build/module time; the query override is read at
 * call time (pass the current `URLSearchParams`/searchParams from the screen).
 */
export const ORDER_WORKSHOP_V2_ENV =
  process.env.NEXT_PUBLIC_ORDER_WORKSHOP_V2 === "true";

/**
 * Resolve whether the Order Workshop is on for this render. `params` is the
 * screen's searchParams (Next's `useSearchParams()` return, or a plain
 * URLSearchParams). The `?workshop=1` override wins so QA can flip it on a single
 * order without an env change; `?workshop=0` force-disables for a side-by-side.
 */
export function isOrderWorkshopEnabled(
  params?: Pick<URLSearchParams, "get"> | null,
): boolean {
  const override = params?.get("workshop");
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  return ORDER_WORKSHOP_V2_ENV;
}
