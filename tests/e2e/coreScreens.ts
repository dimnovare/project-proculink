import { listAppRoutes } from "../../src/test/appRoutes";

/**
 * The ten core screens, and the guard that stops this list from rotting.
 *
 * WHY A LIST AT ALL. Axe and screenshot baselines are per-screen artifacts; they
 * cannot be produced by a blind walk of all 89 routes (44 `page.tsx` + 45
 * `page.mdx`) without turning a 40-second job into a 20-minute one and 89 PNGs
 * into a merge-conflict machine. So a curated list is the right shape.
 *
 * WHY IT IS NOT JUST A LIST. A hard-coded route array inside a test is, in this
 * repo, usually the reason a drift survived: rename `/operations/log` and the
 * array keeps pointing at a 404, the page renders an error boundary, axe finds
 * nothing wrong with an error boundary, and the gate goes green over a screen it
 * never scanned. So every `pattern` below is checked against the real App Router
 * tree via `listAppRoutes()` — the same registry `link-crawl`, `retired-routes`
 * and `routeQueryParams` already use — and `assertCoreScreenRegistry()` fails if
 * any of them has stopped existing.
 *
 * `pattern` is the App Router pattern (`/inbox/[orderId]`), which is what
 * `listAppRoutes()` emits and therefore what can be verified. `path` is the
 * concrete URL a browser visits. They are separate fields on purpose: the
 * verifiable thing and the navigable thing are not the same string.
 */

export interface CoreScreen {
  /** Stable slug. Used as the snapshot filename stem — changing it orphans baselines. */
  id: string;
  label: string;
  /** App Router pattern, as `listAppRoutes()` emits it. Verified to exist. */
  pattern: string;
  /** Concrete URL to navigate to. Dynamic segments filled with a mock-mode id. */
  path: string;
  /** `app` routes are reached through PROCULINK_QA_BYPASS_AUTH; `public` need nothing. */
  auth: "public" | "app";
  /** Why this screen is core. Stated so a future reader can argue with the choice. */
  why: string;
}

/**
 * Ten screens. The selection rule was "one per distinct surface a user has to get
 * through to go from landing to a delivered order", not "the ten biggest files".
 *
 * DELIBERATELY NOT HERE:
 *  • `/sign-in` — the obvious candidate, and it was in this list until it was
 *    measured. In mock/QA mode `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is empty and
 *    `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true`, so the route renders a
 *    placeholder — an `<h1>Sign-in is not configured</h1>` panel beside the
 *    marketing rail, with five focusable controls and no form at all. Every gate
 *    here would have been scanning that placeholder and reporting it as coverage
 *    of the sign-in screen. The Clerk widget cannot be rendered without live
 *    keys, so this needs an authenticated-QA harness, not a curated list entry.
 *  • `/library/suppliers/[id]` — a detail view of a list already covered, and it
 *    still renders a hardcoded MOCK supplier for real users (a known, separately
 *    tracked defect). Baselining it would freeze that.
 *  • The output-structure designer surface — it is a dialog, not a route, and it
 *    is under active change in another work packet. Nothing here opens it.
 */
export const CORE_SCREENS: readonly CoreScreen[] = [
  {
    id: "landing",
    label: "Marketing landing",
    pattern: "/",
    path: "/",
    auth: "public",
    why: "First contact. Only screen with the animated hero and the marketing type scale.",
  },
  {
    id: "pricing",
    label: "Pricing",
    pattern: "/pricing",
    path: "/pricing",
    auth: "public",
    why: "Where the plan ladder is stated. Six plan cards, the densest comparison surface.",
  },
  {
    id: "bridge",
    label: "Orders dashboard",
    pattern: "/bridge",
    path: "/bridge",
    auth: "app",
    why: "The signature screen: wire topology, KPI strip, in-transit list.",
  },
  {
    id: "inbox",
    label: "Order queue",
    pattern: "/inbox",
    path: "/inbox",
    auth: "app",
    why: "The operator's home. Densest data table in the product.",
  },
  {
    id: "order-review",
    label: "Order review",
    pattern: "/inbox/[orderId]",
    path: "/inbox/ord-002",
    auth: "app",
    why: "The three-column review workbench — the screen the whole product exists for.",
  },
  {
    id: "upload",
    label: "Upload workbench",
    pattern: "/upload",
    path: "/upload",
    auth: "app",
    why: "First action a new customer takes. Drop zone, file states, plan-limit banners.",
  },
  {
    id: "suppliers",
    label: "Supplier list",
    pattern: "/library/suppliers",
    path: "/library/suppliers",
    auth: "app",
    why: "Library list surface, and the supplier-limit / billing-gate copy lives here.",
  },
  {
    id: "mappings",
    label: "Mapping editor",
    pattern: "/library/mappings",
    path: "/library/mappings",
    auth: "app",
    why: "The editor surface — form controls, inline edit, import/export panels.",
  },
  {
    id: "delivery-log",
    label: "Delivery log",
    pattern: "/operations/log",
    path: "/operations/log",
    auth: "app",
    why: "The audit trail. Distinct event-list surface with status pills and grouping.",
  },
  {
    id: "settings",
    label: "Settings",
    pattern: "/settings",
    path: "/settings",
    auth: "app",
    why: "Tabs, forms, and the billing panel. The most control-dense screen in the app.",
  },
];

/** Pinned so a silent deletion from the array above fails instead of shrinking the sweep. */
export const EXPECTED_CORE_SCREEN_COUNT = 10;

/**
 * Floor on the route walk itself. `listAppRoutes()` reads the filesystem from
 * `process.cwd()`; run it from the wrong directory and it returns `[]`, at which
 * point "every pattern exists" would be false for all ten and the failure would at
 * least be loud. This makes the *cause* legible instead: a walk that finds almost
 * nothing is a broken walk, not a deleted app.
 */
const MIN_PLAUSIBLE_APP_ROUTES = 40;

export interface RegistryProblem {
  kind: "count" | "walk" | "missing" | "duplicate";
  detail: string;
}

/**
 * Everything wrong with the registry, as a list. Returns `[]` when it is sound.
 *
 * Returned rather than thrown so the caller can assert on the whole list at once
 * and the failure message names every problem, not just the first.
 */
export function checkCoreScreenRegistry(): RegistryProblem[] {
  const problems: RegistryProblem[] = [];

  if (CORE_SCREENS.length !== EXPECTED_CORE_SCREEN_COUNT) {
    problems.push({
      kind: "count",
      detail:
        `CORE_SCREENS has ${CORE_SCREENS.length} entries, expected ${EXPECTED_CORE_SCREEN_COUNT}. ` +
        `If the change is deliberate, update EXPECTED_CORE_SCREEN_COUNT in the same commit ` +
        `and say why in the PR — silently shrinking the sweep is how coverage evaporates.`,
    });
  }

  const seen = new Set<string>();
  for (const screen of CORE_SCREENS) {
    if (seen.has(screen.id)) {
      problems.push({ kind: "duplicate", detail: `duplicate screen id "${screen.id}"` });
    }
    seen.add(screen.id);
  }

  const routes = listAppRoutes();
  if (routes.length < MIN_PLAUSIBLE_APP_ROUTES) {
    problems.push({
      kind: "walk",
      detail:
        `listAppRoutes() returned only ${routes.length} routes (expected at least ` +
        `${MIN_PLAUSIBLE_APP_ROUTES}). The walk is reading the wrong directory — it resolves ` +
        `src/app from process.cwd(), so this usually means the runner was not started from ` +
        `the repo root. Every "route exists" check below is meaningless until this is fixed.`,
    });
    return problems;
  }

  const known = new Set(routes);
  for (const screen of CORE_SCREENS) {
    if (!known.has(screen.pattern)) {
      problems.push({
        kind: "missing",
        detail:
          `"${screen.id}" points at ${screen.pattern}, which the App Router no longer serves. ` +
          `Nothing would have failed: the browser gets a 404, axe finds no violations on a 404, ` +
          `and this screen would have silently stopped being checked.`,
      });
    }
  }

  return problems;
}

/** The subset a viewport-scoped run should cover. Kept as a function so callers read intent. */
export function screensForAuth(auth: CoreScreen["auth"]): readonly CoreScreen[] {
  return CORE_SCREENS.filter((s) => s.auth === auth);
}
