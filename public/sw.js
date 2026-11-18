/*
 * ProcuLink service worker.
 *
 * What it does: it answers same-origin GET navigations, and the share POST at
 * /upload (the manifest's share_target). A navigation gets the network's answer
 * (through navigation preload when the browser has one), and only when the network
 * cannot be reached at all does it answer with a small offline page. The share POST
 * gets its files kept on this phone and a 303 back to /upload. Every other request
 * (API calls, RSC fetches, uploads, build assets, other origins) gets no answer from
 * here, so the browser handles it exactly as it would without a worker.
 *
 * What it stores: files shared to ProcuLink, and only those, go into the device store
 * the upload queue uses (src/lib/pwa/heldUploads.ts, HELD_DB), with no owner, and wait
 * there until the person presses Add them or Discard. Any site can post a form to
 * /upload, so a share is never trusted to be the person's choice. It sends nothing
 * itself, keeps nothing in memory, and never opens Cache Storage. Build assets stay in
 * the browser's ordinary HTTP cache, where they are already marked immutable.
 *
 * What it shows: a phone alert the Worker pushes, which holds only a count and a fixed
 * sentence; pressing it opens a ProcuLink page. The kill switch removes the worker, and
 * with it this device's push subscription.
 *
 * Kill switch: the page-side switch (src/lib/pwa/worker.ts, syncWorker) removes this
 * worker on every non-production build and when NEXT_PUBLIC_PWA_WORKER=off at build
 * time. Set that variable and redeploy, and every client that loads any page
 * unregisters it. Its one limit: a client that never loads a page again keeps this
 * worker, which passes navigations through and keeps shared files on the phone for
 * the person to add or discard (it never sends them). Removing it without a page load
 * would need new bytes in this file, which means a code deploy.
 */

const SHARE_PATH = "/upload";
const SHARE_PARAM = "shared";
const SHARE_NAMES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
// The same limits and layout as src/lib/pwa/heldUploads.ts.
const HELD_MAX_FILES = 10;
const HELD_MAX_BYTES = 52428800;
const HELD_DB = "plk-device";
const HELD_STORE = "held-uploads";

const offlinePage = (title, line, href, link) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>${title}</title><style>` +
  "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F7FA;color:#0B1A2F;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
  "main{max-width:420px;padding:24px 16px}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#5E6779;margin:0 0 20px}" +
  "a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #CBD0DA;border-radius:8px;background:#FFFFFF;color:#0B1A2F;font-weight:600;text-decoration:none}" +
  `</style></head><body><main><h1>${title}</h1><p>${line}</p><a href="${href}">${link}</a></main></body></html>`;

const OFFLINE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

function pageFor(url) {
  const shared = url.pathname === SHARE_PATH && url.searchParams.get(SHARE_PARAM);
  if (shared === "kept")
    return offlinePage("Saved on this phone", "You're offline. Open ProcuLink when you're connected to add them.", "/upload", "Open ProcuLink");
  if (shared === "none")
    return offlinePage(
      "You're offline",
      "The shared files couldn't be kept on this phone. It keeps up to 10 files, 50 MB in all. Share fewer at a time, or add them from Add documents.",
      "",
      "Try again",
    );
  return offlinePage("You're offline", "This page needs a connection. Check yours, then try again.", "", "Try again");
}

/** A shared file with no extension gets one from its type, so the server reads it as what it is. */
function named(file) {
  const ext = SHARE_NAMES[file.type];
  return /\.[a-z0-9]+$/i.test(file.name) || !ext ? file : new File([file], `Shared file.${ext}`, { type: file.type });
}

/** Writes every file as an ownerless record in one transaction, or none of them. Never throws. */
function keepOnDevice(files) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(HELD_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(HELD_STORE, { keyPath: "key" });
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result;
        try {
          let kept = false;
          const tx = db.transaction(HELD_STORE, "readwrite");
          const store = tx.objectStore(HELD_STORE);
          tx.oncomplete = () => (db.close(), resolve(kept));
          tx.onerror = tx.onabort = () => (db.close(), resolve(false));
          const held = store.getAll();
          held.onsuccess = () => {
            const all = [...held.result.map((r) => r.file), ...files];
            if (all.length > HELD_MAX_FILES || all.reduce((n, f) => n + f.size, 0) > HELD_MAX_BYTES) return;
            // One millisecond apart, so the notice lists them in the order they were shared.
            const now = Date.now();
            files.forEach((file, i) =>
              store.put({ key: crypto.randomUUID(), userId: "", orgId: "", flowId: "", file, heldAt: new Date(now + i).toISOString() }),
            );
            kept = true;
          };
        } catch {
          db.close();
          resolve(false);
        }
      };
    } catch {
      resolve(false);
    }
  });
}

async function receiveShare(request) {
  let path = `${SHARE_PATH}?${SHARE_PARAM}=none`;
  try {
    // A post from another web page keeps nothing. An empty, same-origin, unparsable or non-web referrer (a share-sheet
    // launch may carry android-app://) is kept; Add them stays mandatory anyway, as a page can hide its referrer.
    let from = null;
    try {
      from = new URL(request.referrer);
    } catch {}
    if (from && /^https?:$/.test(from.protocol) && from.origin !== self.location.origin)
      return Response.redirect(new URL(SHARE_PATH, self.location.origin).href, 303);
    const files = (await request.formData()).getAll("files").filter((v) => v instanceof File).map(named);
    if (!files.length) path = SHARE_PATH;
    else if (await keepOnDevice(files)) path = `${SHARE_PATH}?${SHARE_PARAM}=kept`;
  } catch {}
  return Response.redirect(new URL(path, self.location.origin).href, 303);
}

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));

self.addEventListener("activate", (e) =>
  e.waitUntil(Promise.all([self.registration.navigationPreload?.enable(), self.clients.claim()])),
);

self.addEventListener("fetch", (e) => {
  const request = e.request;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") {
    // A share is a top-level document navigation. A form posted into a hidden iframe is destination "iframe": it passes through and keeps nothing.
    if (request.method === "POST" && request.destination === "document" && url.pathname === SHARE_PATH) e.respondWith(receiveShare(request));
    return;
  }
  e.respondWith(
    (async () => {
      try {
        return (await e.preloadResponse) || (await fetch(request));
      } catch {
        return new Response(pageFor(url), { status: 200, headers: OFFLINE_HEADERS });
      }
    })(),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data?.json() || {};
  } catch {}
  const path = typeof d.path === "string" && d.path.startsWith("/") && !d.path.startsWith("//") ? d.path : "/documents";
  const badge = () => (d.count > 0 ? self.navigator.setAppBadge?.(d.count) : d.count === 0 ? self.navigator.clearAppBadge?.() : undefined);
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || "ProcuLink", {
        body: d.body || "Open ProcuLink to see what needs you.",
        tag: d.tag || "needs-you",
        renotify: true,
        icon: "/android-chrome-192x192.png",
        data: { path },
      }),
      Promise.resolve().then(badge).catch(() => {}),
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let url = new URL(e.notification.data?.path || "/documents", self.location.origin);
  if (url.origin !== self.location.origin) url = new URL("/documents", self.location.origin);
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (!win) return self.clients.openWindow(url.href);
      await win.focus();
      if (win.navigate) await win.navigate(url.href);
    })(),
  );
});
