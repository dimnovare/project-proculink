import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cssToken } from "@/lib/cssTokens";

type Listener = (event: never) => void;
type Req = { url: string; mode: string; method: string };

let source: string;
let listeners: Record<string, Listener>;
let fetchMock: ReturnType<typeof vi.fn>;
let self: {
  location: { origin: string };
  addEventListener: (type: string, fn: Listener) => void;
  skipWaiting: ReturnType<typeof vi.fn>;
  clients: { claim: ReturnType<typeof vi.fn> };
  registration: { navigationPreload: { enable: ReturnType<typeof vi.fn> } };
};
const savedCaches = (globalThis as { caches?: unknown }).caches;

beforeEach(() => {
  source = readFileSync("public/sw.js", "utf8");
  listeners = {};
  fetchMock = vi.fn();
  self = {
    location: { origin: "https://app.example.test" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
  };
  const caches = new Proxy({}, { get: () => { throw new Error("the worker must not touch Cache Storage"); } });
  (globalThis as { caches?: unknown }).caches = caches;
  new Function("self", "fetch", "caches", source)(self, fetchMock, caches);
});

afterEach(() => {
  (globalThis as { caches?: unknown }).caches = savedCaches;
});

function fire(request: Req, preload?: Response) {
  const event = { request, preloadResponse: Promise.resolve(preload), respondWith: vi.fn(), waitUntil: vi.fn() };
  (listeners.fetch as (e: typeof event) => void)(event);
  return event;
}

it("answers only same-origin GET navigations, and never opens Cache Storage", async () => {
  const pass = [
    { url: "https://app.example.test/api/documents", mode: "cors", method: "GET" },
    { url: "https://app.example.test/documents?_rsc=1x", mode: "cors", method: "GET" },
    { url: "https://app.example.test/api/flows/f1/documents", mode: "cors", method: "POST" },
    { url: "https://app.example.test/_next/static/chunks/main.js", mode: "no-cors", method: "GET" },
    { url: "https://clerk.example.test/v1/client", mode: "cors", method: "GET" },
    { url: "https://other.example.test/", mode: "navigate", method: "GET" },
  ];
  for (const r of pass) expect(fire(r).respondWith).not.toHaveBeenCalled();
  const network = new Response("fresh");
  fetchMock.mockResolvedValueOnce(network);
  const nav = fire({ url: "https://app.example.test/documents", mode: "navigate", method: "GET" });
  expect(nav.respondWith).toHaveBeenCalledTimes(1);
  expect(await nav.respondWith.mock.calls[0][0]).toBe(network);
  const preloaded = new Response("preloaded");
  const viaPreload = fire({ url: "https://app.example.test/settings", mode: "navigate", method: "GET" }, preloaded);
  expect(await viaPreload.respondWith.mock.calls[0][0]).toBe(preloaded);
  expect(source).not.toMatch(/\bcaches\b/);
});

it("offline, a navigation gets a script-free page with its own strict headers, in token colours; it takes over at once", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const ev = fire({ url: "https://app.example.test/pricing", mode: "navigate", method: "GET" });
  const res: Response = await ev.respondWith.mock.calls[0][0];
  expect(res.status).toBe(200);
  expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const html = await res.text();
  expect(html).toContain("<title>You're offline</title>");
  expect(html).toContain("This page needs a connection. Check yours, then try again.");
  expect(html).toMatch(/<a href="">Try again<\/a>/);
  expect(html).not.toMatch(/<script|\ssrc=|url\(/i);
  const css = readFileSync("src/app/globals.css", "utf8");
  const tokenValues = new Set(["bg", "ink", "ink-muted", "border-strong", "surface"].map((t) => cssToken(css, t).toUpperCase()));
  for (const hex of html.match(/#[0-9a-f]{6}\b/gi) ?? []) expect(tokenValues).toContain(hex.toUpperCase());
  const install = { waitUntil: vi.fn() };
  (listeners.install as (e: typeof install) => void)(install);
  await install.waitUntil.mock.calls[0][0];
  const activate = { waitUntil: vi.fn() };
  (listeners.activate as (e: typeof activate) => void)(activate);
  await activate.waitUntil.mock.calls[0][0];
  expect(self.skipWaiting).toHaveBeenCalled();
  expect(self.clients.claim).toHaveBeenCalled();
  expect(self.registration.navigationPreload.enable).toHaveBeenCalled();
});
