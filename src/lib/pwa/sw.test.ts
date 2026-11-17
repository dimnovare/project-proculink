import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cssToken } from "@/lib/cssTokens";
import { HELD_DB, HELD_MAX_BYTES, type HeldRecord } from "./heldUploads";

type Listener = (event: never) => void;
type Req = { url: string; mode: string; method: string; formData?: () => Promise<FormData> };

/** Just enough IndexedDB for the worker: requests settle on a microtask, a transaction completes after them. */
function fakeIdb() {
  const idb = {
    opened: [] as unknown[],
    stores: [] as string[],
    records: [] as Pick<HeldRecord, "key" | "file">[],
    puts: [] as HeldRecord[],
    open(name: string, version: number) {
      idb.opened = [name, version];
      const db = {
        createObjectStore: (s: string) => void idb.stores.push(s),
        close: () => {},
        transaction: (store: string) => {
          const tx: { oncomplete?: () => void; objectStore: (s: string) => unknown } = {
            objectStore: (s: string) => {
              idb.stores.push(s);
              return {
                getAll: () => {
                  const r: { result?: unknown; onsuccess?: () => void } = {};
                  queueMicrotask(() => { r.result = idb.records; r.onsuccess?.(); });
                  return r;
                },
                put: (v: HeldRecord) => (idb.puts.push(v), {}),
              };
            },
          };
          idb.stores.push(store);
          setTimeout(() => tx.oncomplete?.(), 0);
          return tx;
        },
      };
      const req: { result: typeof db; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: db };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
  return idb;
}
let idb: ReturnType<typeof fakeIdb>;

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
  idb = fakeIdb();
  new Function("self", "fetch", "caches", "indexedDB", source)(self, fetchMock, caches, idb);
});

afterEach(() => {
  (globalThis as { caches?: unknown }).caches = savedCaches;
});

function fire(request: Req, preload?: Response) {
  const event = { request, preloadResponse: Promise.resolve(preload), respondWith: vi.fn(), waitUntil: vi.fn() };
  (listeners.fetch as (e: typeof event) => void)(event);
  return event;
}

async function post(files: File[]): Promise<Response> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return fire({ url: "https://app.example.test/upload", mode: "navigate", method: "POST", formData: async () => fd }).respondWith.mock.calls[0][0];
}

it("a share, or any form post that looks like one, is only kept on this phone with no owner: nothing is fetched or sent", async () => {
  const res = await post([new File(["%PDF"], "scan.pdf", { type: "application/pdf" }), new File(["x"], "1000123", { type: "image/jpeg" })]);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("https://app.example.test/upload?shared=kept");
  expect(idb.opened).toEqual([HELD_DB.name, HELD_DB.version]);
  expect(idb.stores).toEqual(expect.arrayContaining([HELD_DB.store]));
  expect(idb.puts.map((r) => [r.userId, r.orgId, r.flowId, r.file.name])).toEqual([["", "", "", "scan.pdf"], ["", "", "", "Shared file.jpg"]]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await post([])).headers.get("location")).toBe("https://app.example.test/upload");
  expect(fire({ url: "https://app.example.test/settings", mode: "navigate", method: "POST" }).respondWith).not.toHaveBeenCalled();
});

it("past the limit nothing is kept; offline, the follow-up page says which happened", async () => {
  idb.records = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, file: new File(["x"], "a.pdf") }));
  const res = await post([new File(["%PDF"], "more.pdf", { type: "application/pdf" })]);
  expect(res.headers.get("location")).toBe("https://app.example.test/upload?shared=none");
  expect(idb.puts).toEqual([]);
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  const page = async (q: string) => (await fire({ url: `https://app.example.test/upload?shared=${q}`, mode: "navigate", method: "GET" }).respondWith.mock.calls[0][0]).text();
  const kept = await page("kept");
  expect(kept).toContain("<title>Saved on this phone</title>");
  expect(kept).toContain("You're offline. Open ProcuLink when you're connected to add them.");
  expect(kept).toMatch(/<a href="\/upload">Open ProcuLink<\/a>/);
  expect(await page("none")).toContain("The shared files couldn't be kept on this phone. It keeps up to 10 files, 50 MB in all. Share fewer at a time, or add them from Add documents.");
  expect(source).toMatch(/HELD_MAX_FILES = 10\b/);
  expect(source).toContain(`HELD_MAX_BYTES = ${HELD_MAX_BYTES}`);
});

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
