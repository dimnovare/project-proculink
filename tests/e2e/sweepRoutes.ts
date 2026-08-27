/**
 * Every route the sweep visits — ALL of them, not the curated ten.
 *
 * WHY THIS EXISTS ALONGSIDE coreScreens.ts. `CORE_SCREENS` is a deliberately
 * curated list of ten: "one per distinct surface a user has to get through to go
 * from landing to a delivered order". That is the right shape for visual
 * baselines and for the production sweep, where every extra screen costs a real
 * Clerk session and a baseline to maintain.
 *
 * It is the wrong shape for "click every button". The app serves 40+ routes, and
 * the thirty that are not core are exactly the ones nobody looks at — admin
 * guides, legal pages, `/connections`, `/inbound/*`, `/welcome`. A control that
 * is broken on `/library/buyers` is broken for a real user whether or not the
 * route made a curated list.
 *
 * DERIVED, NOT TYPED. The list is read off the App Router tree at run time, the
 * same way `src/test/appRoutes.ts` does it, so adding a route adds it to the
 * sweep. A second hand-written route array is, in this repo, usually the reason a
 * drift survived (see the header of tests/prod/prodScreens.ts).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "src", "app");

/** Route-group segments — `(app)`, `(marketing)` — contribute no URL segment. */
const isGroup = (name: string) => name.startsWith("(") && name.endsWith(")");

function listRoutes(dir: string = APP_DIR, route = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") out.push(route === "" ? "/" : route);
      continue;
    }
    if (entry.startsWith("_") || entry === "api") continue;
    out.push(...listRoutes(full, isGroup(entry) ? route : `${route}/${entry}`));
  }
  return out;
}

/**
 * Concrete ids for dynamic segments, from the in-memory mock fixture set in
 * `src/lib/api-client.ts`. A pattern with no entry here is SKIPPED and named in
 * the report — silently dropping it would shrink the sweep without saying so.
 */
const DYNAMIC_FILL: Record<string, string | null> = {
  "/inbox/[orderId]": "/inbox/ord-002",
  "/library/suppliers/[id]": "/library/suppliers/s1",
  // The mock client exposes no connection fixture, so there is no id that
  // renders anything. Listed as null rather than omitted so the report says the
  // route was skipped and why, rather than the route quietly not existing.
  "/connections/[connectionId]": null,
};

/**
 * Routes the sweep cannot meaningfully exercise. Each carries its reason — an
 * unexplained skip is how coverage quietly shrinks.
 */
export const SKIPPED: Record<string, string> = {
  "/sign-in/[[...sign-in]]":
    "Clerk publishable key is empty in mock mode, so this renders an 'Sign-in is not configured' placeholder, not the real widget. Sweeping it would report the placeholder as coverage.",
  "/sign-up/[[...sign-up]]": "Same as /sign-in — placeholder, not the real widget.",
  "/onboarding/select-organization":
    "The organisation gate. Its real screen — including its <h1> — lives behind " +
    "`useOrganizationList`, and Clerk is dormant in mock mode (empty publishable key, " +
    "NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true), so the route renders nothing but the cookie " +
    "banner. The sweep duly reported it as a screen with no <h1> and one control. Same " +
    "placeholder problem as /sign-in above: scanning it measures the placeholder and reports " +
    "it as coverage of the gate. Needs an authenticated harness, not a curated exclusion.",
};

export interface SweepRoute {
  /** The App Router pattern, as the tree emits it. */
  pattern: string;
  /** The concrete URL to navigate to. */
  path: string;
  /** Marketing/legal pages need no auth; app routes go through the QA bypass. */
  area: "public" | "app";
}

const APP_PREFIXES = [
  "/admin", "/bridge", "/connections", "/inbound", "/inbox", "/library",
  "/onboarding", "/operations", "/settings", "/upload", "/welcome",
];

export function sweepRoutes(): { routes: SweepRoute[]; skipped: { pattern: string; why: string }[] } {
  const routes: SweepRoute[] = [];
  const skipped: { pattern: string; why: string }[] = [];

  for (const pattern of listRoutes().sort()) {
    if (SKIPPED[pattern]) {
      skipped.push({ pattern, why: SKIPPED[pattern] });
      continue;
    }
    let path = pattern;
    if (pattern.includes("[")) {
      const fill = DYNAMIC_FILL[pattern];
      if (fill === undefined) {
        skipped.push({ pattern, why: "dynamic route with no fixture id in DYNAMIC_FILL — add one" });
        continue;
      }
      if (fill === null) {
        skipped.push({ pattern, why: "no mock fixture exists for this id, so the page has nothing to render" });
        continue;
      }
      path = fill;
    }
    const area = APP_PREFIXES.some((p) => pattern === p || pattern.startsWith(`${p}/`)) ? "app" : "public";
    routes.push({ pattern, path, area });
  }

  return { routes, skipped };
}

/** Viewports the sweep runs at, named to match playwright.config.ts projects. */
export const SWEEP_VIEWPORTS = {
  "sweep-mobile": { width: 390, height: 844 },
  "sweep-tablet": { width: 768, height: 1024 },
  "sweep-desktop": { width: 1440, height: 900 },
} as const;
