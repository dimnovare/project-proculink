import { CORE_SCREENS, checkCoreScreenRegistry, type CoreScreen } from "../e2e/coreScreens";
import { appPageTitle } from "../../src/lib/pageTitles";

/**
 * The signed-in screens the production smoke test walks.
 *
 * DERIVED, NOT TYPED OUT. A second hand-written route array is, in this repo,
 * usually the reason a drift survived: rename a route and the array keeps
 * pointing at a 404, the 404 renders, the assertion "the page rendered" passes,
 * and the gate goes green over a screen it never visited. So this list is the
 * `auth: "app"` half of tests/e2e/coreScreens.ts — the same registry the axe and
 * visual gates walk, and the one already verified against the real App Router
 * tree by `checkCoreScreenRegistry()`.
 *
 * TWO SUBTRACTIONS, both deliberate:
 *
 *  • Dynamic routes (`/inbox/[orderId]`). Its concrete path in CORE_SCREENS is
 *    `/inbox/ord-002`, a MOCK-mode fixture id. Production has no such order, so
 *    visiting it would assert against a not-found screen. Reviewing a real order
 *    needs an order to exist first, which is Job 2's territory, not this one's.
 *  • Nothing else. If a screen is core enough for the axe baseline it is core
 *    enough to be verified in the environment customers use.
 */

export interface ProdScreen extends CoreScreen {
  /** The exact `<title>` the route must serve, from src/lib/pageTitles.ts. */
  title: string;
  /** The page's own name — the `<h1>` text, title minus the product suffix. */
  heading: string;
}

/**
 * Anti-vacuity floor.
 *
 * A filter that silently matches nothing produces an empty list, an empty list
 * produces zero tests, and zero failing tests is indistinguishable from a pass.
 * This number is the smallest count that still means "the sweep happened".
 * CORE_SCREENS has 8 `app` entries today, one of them dynamic, so 7 screens
 * survive the filter; 6 leaves room for one deliberate removal without leaving
 * room for the filter breaking outright.
 */
export const MIN_PROD_SCREENS = 6;

export function listProdScreens(): ProdScreen[] {
  // If the shared registry is unsound, every "this screen rendered" assertion
  // below is meaningless — fail here, where the cause is legible, rather than
  // 40 lines into a browser trace.
  const problems = checkCoreScreenRegistry();
  if (problems.length > 0) {
    throw new Error(
      `tests/e2e/coreScreens.ts is not sound, so the production sweep cannot be trusted:\n` +
        problems.map((p) => `  [${p.kind}] ${p.detail}`).join("\n"),
    );
  }

  const screens = CORE_SCREENS.filter(
    (screen) => screen.auth === "app" && !screen.pattern.includes("["),
  ).map((screen) => {
    // appPageTitle THROWS on a route with no entry. That throw is the desired
    // behaviour: a screen the product cannot name is a screen this test cannot
    // verify rendered, and silently skipping it would shrink the sweep.
    const title = appPageTitle(screen.pattern);
    return { ...screen, title, heading: title.replace(/ — ProcuLink$/, "") };
  });

  if (screens.length < MIN_PROD_SCREENS) {
    throw new Error(
      `Only ${screens.length} signed-in screen(s) survived the filter, expected at least ` +
        `${MIN_PROD_SCREENS}. Either CORE_SCREENS lost its "app" entries or the filter stopped ` +
        `matching — both mean this suite would report green having checked almost nothing.`,
    );
  }

  return screens;
}
