import { request } from "@playwright/test";

/**
 * Warm the heavy routes once, before the suite runs.
 *
 * In mock CI the webServer is `next dev`, which cold-compiles each route on its
 * first request. Whichever test navigates to /upload (etc.) first eats that
 * compile and can flake on a tight visibility timeout under single-worker load.
 * Hitting each route over HTTP here triggers server-side compilation up-front,
 * so the actual tests navigate to already-compiled routes.
 */
async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8082";
  const ctx = await request.newContext({ baseURL });
  const routes = [
    "/",
    "/upload",
    "/inbox/ord-002",
    "/upload/preview/ord-002",
    "/watch",
    "/how-it-works",
    "/help",
    "/pricing",
  ];
  await Promise.all(routes.map((p) => ctx.get(p, { timeout: 90_000 }).catch(() => {})));
  await ctx.dispose();
}

export default globalSetup;
