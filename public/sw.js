/*
 * ProcuLink service worker.
 *
 * What it does: it answers only same-origin GET navigations. It hands back the
 * network's answer (through navigation preload when the browser has one), and only
 * when the network cannot be reached at all does it answer with the small offline
 * page below. Every other request (API calls, RSC fetches, uploads, build assets,
 * other origins) gets no answer from here, so the browser handles it exactly as it
 * would without a worker.
 *
 * Why it stores nothing: it never opens Cache Storage and keeps no page, file,
 * document or response. With nothing stored, signing out, switching workspace or a
 * new deploy cannot leave anything stale behind. Build assets stay in the browser's
 * ordinary HTTP cache, where they are already marked immutable.
 *
 * Kill switch: the page-side switch (src/lib/pwa/worker.ts, syncWorker) removes this
 * worker on every non-production build and when NEXT_PUBLIC_PWA_WORKER=off at build
 * time. Set that variable and redeploy, and every client that loads any page
 * unregisters it. Its one limit: a client that never loads a page again keeps this
 * worker, which only passes navigations through. Removing it without a page load
 * would need new bytes in this file, which means a code deploy.
 */

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>You're offline</title><style>" +
  "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F7FA;color:#0B1A2F;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
  "main{max-width:420px;padding:24px 16px}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#5E6779;margin:0 0 20px}" +
  "a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #CBD0DA;border-radius:8px;background:#FFFFFF;color:#0B1A2F;font-weight:600;text-decoration:none}" +
  "</style></head><body><main><h1>You're offline</h1>" +
  "<p>This page needs a connection. Check yours, then try again.</p>" +
  '<a href="">Try again</a></main></body></html>';

const OFFLINE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));

self.addEventListener("activate", (e) =>
  e.waitUntil(Promise.all([self.registration.navigationPreload?.enable(), self.clients.claim()])),
);

self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      try {
        return (await e.preloadResponse) || (await fetch(request));
      } catch {
        return new Response(OFFLINE_HTML, { status: 200, headers: OFFLINE_HEADERS });
      }
    })(),
  );
});
