import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "Inbound order API" (/settings?tab=api + code overlays).
 *
 * Real UI: the ingress-endpoint row, the on-screen X-ProcuLink-Key auth line,
 * and a plk_ key created on camera (the mock returns a real-shaped one-time
 * key). Schema beats (ping / body / response / idempotency) ride on branded
 * code overlays — the sanctioned technique for content the mock UI can't
 * show; every payload mirrors the REAL controller behavior (IngressController:
 * ping OK payload; supplierId GUID-or-exact-name + ≥1 line required; response
 * id/status/linesCount with status pending_review|ready — NOT needs_review;
 * Idempotency-Key 24h replay returns the original with idempotentReplay).
 *
 * Cosmetic prod-ify (documented precedent from v13): the dev host
 * http://localhost:5223 in the on-screen ingress URL is rewritten to
 * https://api.proculink.eu — path + capability are real.
 *
 *   bun run demo:tools:capture capture-api-order-schema-reference
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("api-order-schema-reference");
const holds = holdBudgets(spec);

const OVERLAYS: Record<string, string> = {
  ping:
    '<div style="color:#7E93B8;">— before the first order —</div>\n' +
    '<b style="color:#3DBE6B;">GET</b> https://api.proculink.eu/api/ingress/<b style="color:#3DBE6B;">demo-workspace</b>/ping\n' +
    'X-ProcuLink-Key: plk_&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;\n' +
    '\n<b style="color:#3DBE6B;">200 OK</b>\n' +
    '{\n  "message": "ProcuLink inbound API OK",\n  "slug": "demo-workspace",\n  "timestamp": "2026-07-09T12:00:00Z"\n}',
  body:
    '<b style="color:#3DBE6B;">POST</b> https://api.proculink.eu/api/ingress/demo-workspace/orders\n' +
    'X-ProcuLink-Key: plk_&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;\n' +
    'Content-Type: application/json\n\n' +
    '{\n' +
    '  "orderNumber": "PO-2026-00871",\n' +
    '  "orderDate":   "2026-07-09",\n' +
    '  "currency":    "EUR",\n' +
    '  "supplierId":  "ElectroSupply Co",   <b style="color:#3DBE6B;">&#8592; GUID or exact name &#183; required</b>\n' +
    '  "lines": [                           <b style="color:#3DBE6B;">&#8592; at least one line &#183; required</b>\n' +
    '    {\n' +
    '      "buyerItemCode": "TB-CAP-100",\n' +
    '      "description":   "Capacitor 100uF",\n' +
    '      "quantity":      200,             <b style="color:#3DBE6B;">&#8592; a number, not a string</b>\n' +
    '      "unit":          "pcs",\n' +
    '      "unitPrice":     0.35\n' +
    '    }\n  ]\n}',
  response:
    '<div style="color:#7E93B8;">— success —</div>\n' +
    '<b style="color:#3DBE6B;">200 OK</b>\n' +
    '{\n' +
    '  "id":         "4f6b1c2e-&#8230;-order-guid",\n' +
    '  "status":     "pending_review",   <b style="color:#3DBE6B;">&#8592; or "ready" when every line resolved</b>\n' +
    '  "linesCount": 1\n' +
    '}',
  dedupe:
    '<b style="color:#3DBE6B;">POST</b> /api/ingress/demo-workspace/orders\n' +
    'X-ProcuLink-Key: plk_&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;\n' +
    '<b style="color:#3DBE6B;">Idempotency-Key: po-2026-00871</b>\n\n' +
    '<div style="color:#7E93B8;">same key again within 24 h &#8594; the original order, no duplicate:</div>\n' +
    '{ "id": "4f6b1c2e-&#8230;", "status": "pending_review",\n  "linesCount": 1, <b style="color:#3DBE6B;">"idempotentReplay": true</b> }',
};

// Branded code overlay (static, author-controlled content only).
async function showOverlay(page: Page, title: string, key: string) {
  await page.evaluate(([t, html]) => {
    let el = document.getElementById("plk-code-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "plk-code-overlay";
      Object.assign(el.style, {
        position: "fixed", right: "70px", top: "50%", transform: "translateY(-50%)",
        width: "860px", background: "#0B1A2F", border: "1px solid #24406B",
        borderRadius: "12px", padding: "24px 28px", zIndex: "2147483000",
        fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: "16.5px",
        lineHeight: "1.62", color: "#DDE7F7", whiteSpace: "pre-wrap",
        boxShadow: "0 18px 60px rgba(11,26,47,0.45)",
        opacity: "0", transition: "opacity .35s ease",
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(el);
    }
    el.innerHTML =
      `<div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#3DBE6B;margin-bottom:14px;white-space:normal;">${t}</div>` + html;
    requestAnimationFrame(() => { (el as HTMLElement).style.opacity = "1"; });
  }, [title, OVERLAYS[key]]);
}

async function hideOverlay(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById("plk-code-overlay");
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  });
  await page.waitForTimeout(450);
}

test("tool capture: api-order-schema-reference", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Loading members"] });

  // Cosmetic prod-ify of the dev API host in on-screen text (v13 precedent).
  await page.addInitScript(() => {
    const fix = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (n.nodeValue?.includes("http://localhost:5223")) {
          n.nodeValue = n.nodeValue.replaceAll("http://localhost:5223", "https://api.proculink.eu");
        }
      }
    };
    const start = () => {
      fix();
      new MutationObserver(fix).observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  });

  const beat = async (id: string, actions?: () => Promise<void>) => {
    const b = spec.beats.find((x) => x.id === id)!;
    clock.mark(id);
    if (actions) {
      if (b.actionLeadMs) await page.waitForTimeout(b.actionLeadMs);
      await soft(id, actions);
    }
    const left = holds[id] - clock.since(id);
    if (left > 0) await page.waitForTimeout(left);
  };

  // ── open — deep-link straight onto the API-keys tab ────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/your ingress endpoint/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — endpoint row + create a one-time plk_ key on camera ───────────────
  await beat("b1-keys", async () => {
    await cursor.glideTo(page.getByText(/your ingress endpoint/i).first(), 900);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/api\/ingress\/demo-workspace\/orders/i).first(), 800);
    await page.waitForTimeout(900);
    await cursor.click(page.getByRole("button", { name: /create key/i }).first(), 900);
    await page.waitForTimeout(500);
    await page.keyboard.type("ERP push", { delay: 70 });
    await page.waitForTimeout(400);
    await cursor.click(page.getByRole("button", { name: /create key/i }).first(), 700);
    await page.getByText(/api key created/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/cannot be retrieved again/i).first(), 900);
  });

  // ── b2 — the on-screen auth-header line ────────────────────────────────────
  await beat("b2-header", async () => {
    // Close the one-time key reveal first (a real user action) so the page —
    // and the X-ProcuLink-Key auth line — is fully legible for this beat.
    await cursor.click(page.getByRole("button", { name: /i've saved it/i }).first(), 800);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByText(/x-proculink-key/i).first(), 1100);
  });

  // ── b3 — ping (overlay) ────────────────────────────────────────────────────
  await beat("b3-ping", async () => {
    await showOverlay(page, "CHECK THE CONNECTION", "ping");
    await cursor.glideToPoint(1180, 420, 900);
  });

  // ── b4 — the order body (overlay) ──────────────────────────────────────────
  await beat("b4-body", async () => {
    await showOverlay(page, "THE ORDER BODY", "body");
    await cursor.glideToPoint(1160, 500, 900);
    await page.waitForTimeout(2500);
    await cursor.glideToPoint(1200, 640, 1200);
  });

  // ── b5 — the response (overlay) ────────────────────────────────────────────
  await beat("b5-response", async () => {
    await showOverlay(page, "THE RESPONSE", "response");
    await cursor.glideToPoint(1180, 520, 900);
  });

  // ── b6 — idempotency (overlay) ─────────────────────────────────────────────
  await beat("b6-dedupe", async () => {
    await showOverlay(page, "SAFE RETRIES", "dedupe");
    await cursor.glideToPoint(1180, 480, 900);
    await page.waitForTimeout(Math.max(0, holds["b6-dedupe"] - 2600));
    await hideOverlay(page);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
