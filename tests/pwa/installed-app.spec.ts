import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Browser, type Page, type Response } from "@playwright/test";

// The service worker on a real production build (`bun run build` first). Only a production
// build registers it (src/lib/pwa/worker.ts), so this is the one place a browser meets it.
// The server is started here, not by a webServer block, because test 2 stops it mid-test.
//
// Not signed in: the build has no session, so every app address is the signed-out redirect.
// That is what a worker could get wrong (serve an old copy, change a redirect), and the
// signed-in case is checked once after deploy.

const PORT = process.env.PWA_PORT ?? "8085";
const ORIGIN = `http://localhost:${PORT}`;
/** Not a key: middleware needs a value to start, and a signed-out request never sends it anywhere. */
const CLERK_SECRET_PLACEHOLDER = "sk_live_ci_placeholder_not_real";
const SW_FILE = resolve("public/sw.js");

let server: ChildProcess | null = null;

const answers = async () => {
  try { return (await fetch(`${ORIGIN}/`, { redirect: "manual" })).status === 200; } catch { return false; }
};

async function startServer() {
  const env: NodeJS.ProcessEnv = { ...process.env, CLERK_SECRET_KEY: CLERK_SECRET_PLACEHOLDER };
  delete env.PROCULINK_QA_BYPASS_AUTH;
  delete env.NEXT_PUBLIC_QA_BYPASS_AUTH;
  // Node runs Next's own bin directly, so killing this process stops the server (a `bun run`
  // wrapper would leave the node child holding the port). `localhost`, not 127.0.0.1: the
  // middleware's rewrites are proxied to localhost, which can resolve to ::1, and a server bound
  // to 127.0.0.1 then answers `/` with a 500 (ECONNREFUSED).
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", PORT, "-H", "localhost"], { env, stdio: "ignore" });
  for (const end = Date.now() + 60_000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    if (await answers()) return;
  }
  throw new Error(`next start did not answer on ${ORIGIN} (run \`bun run build\` first)`);
}

async function stopServer() {
  const s = server;
  server = null;
  if (s && s.exitCode === null) await new Promise((done) => { s.once("exit", done); s.kill(); });
  for (const end = Date.now() + 10_000; Date.now() < end && await answers(); await new Promise((r) => setTimeout(r, 100)));
}

/** A fresh context whose page is controlled by the worker. */
async function controlled(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ serviceWorkers: "allow" })).newPage();
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
  });
  return page;
}

const path = (url: string) => url.replace(ORIGIN, "");
const ADDRESSES = ["/", "/pricing", "/sign-in", "/documents", "/upload", "/settings?tab=billing", "/documents?__clerk_handshake=x", "/no-such-page"];

/** Each address's redirect chain, final address and status; Cache Storage is read after every one. */
async function walk(page: Page) {
  const seen = [];
  for (const address of ADDRESSES) {
    const res = (await page.goto(address))!;
    const chain: string[] = [];
    for (let r = res.request().redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift(path(r.url()));
    seen.push({ address, chain, final: path(res.url()), status: res.status() });
    expect(await page.evaluate(() => caches.keys()), `Cache Storage after ${address}`).toEqual([]);
  }
  return seen;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  if (await answers()) throw new Error(`something already answers on ${ORIGIN}; stop it first`);
  await startServer();
});
test.afterEach(async () => { if (!server) await startServer(); });    // a test that stopped the server and then failed
test.afterAll(stopServer);

test("nothing but a navigation goes through the worker, Cache Storage stays empty, and redirects are the same with and without it", async ({ browser, request }) => {
  const blocked = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
  const without = await walk(blocked);

  const page = await controlled(browser);
  const messages: string[] = [];
  const responses: Response[] = [];
  page.on("console", (m) => messages.push(m.text()));
  page.context().on("response", (r) => responses.push(r));
  const registration = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, updateViaCache: r.updateViaCache, preload: await r.navigationPreload.getState() };
  });
  expect(registration).toEqual({ scope: `${ORIGIN}/`, updateViaCache: "none", preload: { enabled: true, headerValue: "true" } });

  const withWorker = await walk(page);
  expect(withWorker).toEqual(without);
  expect(withWorker.find((s) => s.address === "/upload")!.final).toMatch(/^\/sign-in\?redirect_url=/);
  expect(withWorker.find((s) => s.address === "/no-such-page")!.status, "the server's 404, not the offline page").toBe(404);

  const documents = responses.filter((r) => r.request().resourceType() === "document");
  expect(documents.length, "navigations were seen").toBeGreaterThan(0);
  expect(documents.some((r) => r.fromServiceWorker()), "the worker answered the navigations").toBe(true);
  const others = responses.filter((r) => r.request().resourceType() !== "document");
  expect(others.length, "subresources were seen").toBeGreaterThan(0);
  expect(others.filter((r) => r.fromServiceWorker()).map((r) => path(r.url()))).toEqual([]);

  const manifest = await request.get("/site.webmanifest", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  const { start_url, icons } = (await manifest.json()) as { start_url: string; icons: { src: string }[] };
  expect(start_url).toBe("/documents");
  for (const src of new Set([...icons.map((i) => i.src), "/apple-touch-icon.png"])) {
    const icon = await request.get(src, { maxRedirects: 0 });
    expect([icon.status(), icon.headers()["content-type"]], src).toEqual([200, "image/png"]);
  }
  const sw = await request.get("/sw.js", { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toMatch(/javascript/);
  expect(sw.headers()["cache-control"] ?? "").not.toMatch(/max-age=[1-9]/);

  expect(messages.filter((m) => /worker-src|manifest-src|preloadResponse/.test(m))).toEqual([]);
});

test("with the server gone, a navigation shows the offline page, never an older copy, and Try again brings the page back", async ({ browser }) => {
  const page = await controlled(browser);
  await page.goto("/pricing");
  const heading = (await page.locator("h1").first().textContent())!.trim();
  expect(heading.length).toBeGreaterThan(0);

  await stopServer();
  const body = page.locator("body");
  await page.goto("/documents");
  await expect(body).toContainText("You're offline");

  const requests: string[] = [];
  page.on("request", (r) => requests.push(path(r.url())));
  const res = (await page.goto("/pricing"))!;
  await expect(body).toContainText("You're offline");
  await expect(body).toContainText("This page needs a connection. Check yours, then try again.");
  await expect(body).not.toContainText(heading);
  expect([res.status(), res.fromServiceWorker()]).toEqual([200, true]);
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/^default-src 'none'/);
  expect([h["content-type"], h["x-frame-options"], h["cache-control"]]).toEqual(["text/html; charset=utf-8", "DENY", "no-store"]);
  expect(await page.evaluate(() => document.scripts.length), "the offline page runs no script").toBe(0);
  expect(requests, "and asks for nothing but itself").toEqual(["/pricing"]);

  await startServer();
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page.locator("h1").first()).toHaveText(heading);
});

test("a new deploy's worker takes over without a reload, and the switch off removes it", async ({ browser }) => {
  const page = await controlled(browser);
  const at = page.url();
  await page.evaluate(() => { (window as unknown as { __mark: number }).__mark = 1; });

  // A deploy is new bytes at /sw.js. page.route cannot answer the browser's own fetch of a
  // worker script (tried, also with PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS), so the
  // running server is given new bytes the way a deploy gives them: in public/sw.js, which
  // `next start` reads on every request. The file is put back whatever happens.
  const bytes = readFileSync(SW_FILE);
  let update;
  try {
    writeFileSync(SW_FILE, Buffer.concat([bytes, Buffer.from("\n// next\n")]));
    update = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const old = navigator.serviceWorker.controller;
      const changed = new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
      await reg.update();
      const swapped = await Promise.race([changed.then(() => true), new Promise((r) => setTimeout(() => r(false), 15_000))]);
      const now = reg.active!;
      if (now.state !== "activated") await new Promise((r) => now.addEventListener("statechange", () => now.state === "activated" && r(null)));
      return { swapped, replaced: navigator.serviceWorker.controller !== old, state: now.state };
    });
  } finally {
    writeFileSync(SW_FILE, bytes);
  }
  expect(update).toEqual({ swapped: true, replaced: true, state: "activated" });
  expect(page.url(), "no navigation").toBe(at);
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark), "the page was not reloaded").toBe(1);

  // The off path, as syncWorker(false, …) runs it. This build is a production one, so the
  // reloaded page registers the worker again once its script runs; what the off path decides is
  // whether the reload itself went through a worker, which is read at the first line of script.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (k.startsWith("plk-")) await caches.delete(k);
  });
  await page.addInitScript(() => { (window as unknown as { __controlledAtStart: boolean }).__controlledAtStart = !!navigator.serviceWorker.controller; });
  const reloaded = (await page.reload())!;
  expect(reloaded.fromServiceWorker(), "the reload did not go through a worker").toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __controlledAtStart: boolean }).__controlledAtStart)).toBe(false);
});