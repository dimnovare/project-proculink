import { request } from "@playwright/test";

/**
 * Warm the heavy routes once, before the suite runs.
 *
 * In mock CI the webServer is `next dev`, which cold-compiles each route on its
 * first request. Whichever test navigates to a route first eats that compile and
 * can flake on a tight visibility timeout under load. Hitting each route over
 * HTTP here triggers server-side compilation up-front, so the actual tests
 * navigate to already-compiled routes.
 *
 * Two things this file must keep right, or the flakes come back:
 *   1. COVERAGE — every route a spec `page.goto`s must be listed, INCLUDING the
 *      (app) routes behind the QA-bypass (their first compile is the slowest).
 *      When you add a spec that visits a new route, add it here. Client-side
 *      navigations (router.push / link clicks) reach a route WITHOUT a server GET,
 *      so warm the destination's own path explicitly (e.g. /flows/flow-1/documents/doc-1).
 *   2. CONCURRENCY — `next dev` compiles routes roughly serially, so firing all
 *      routes at once makes each request queue behind the others and can blow the
 *      per-request timeout. Warm in small batches instead of one Promise.all.
 */

// Every distinct compiled route the suite navigates to. Dynamic segments only
// need ONE representative (/flows/flow-1/documents/doc-1 also warms the route an
// unknown document id hits). Grep the specs for `page.goto(` when in
// doubt: `grep -rhoE 'page\.goto\("(/[^"?]*)' tests/e2e/*.spec.ts`.
const ROUTES = [
  // ── Marketing + legal (marketing.spec.ts, new-surfaces.spec.ts) ──
  "/",
  "/pricing",
  "/how-it-works",
  "/watch",
  "/book-demo",
  "/help",
  "/support",
  "/pilot",
  "/one-pager",
  "/privacy",
  "/terms",
  "/security",
  "/dpa",
  "/subprocessors",
  "/aup",
  // ── (app) routes behind the QA bypass — the slowest first compiles ──
  "/documents",
  "/archive/ord-002",
  "/flows",
  "/flows/new",
  "/flows/flow-1",
  "/flows/flow-1/documents/doc-1",
  "/flows/flow-1/outputs/out-1/advanced",
  "/lookups",
  "/lookups/lookup-1",
  "/upload",
  "/operations/log",
  "/settings",
  "/admin",
  // ── still on disk until 13b; compiled so the client-side redirect lands fast ──
  "/bridge",
  "/inbox",
  "/sign-in",
];

// `next dev` compiles roughly one route at a time; a batch this size keeps a few
// requests in flight without making each queue behind ~two dozen others.
const WARM_CONCURRENCY = 4;

async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "8082"}`;
  const ctx = await request.newContext({ baseURL });

  const queue = [...ROUTES];
  async function worker() {
    for (let route = queue.shift(); route; route = queue.shift()) {
      // Swallow failures: a 404/redirect/timeout on warm-up must never fail the
      // whole suite — the point is only to trigger compilation.
      await ctx.get(route, { timeout: 90_000 }).catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));

  await ctx.dispose();
}

export default globalSetup;
