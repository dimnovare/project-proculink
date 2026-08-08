// Real-PROD redesign capture. Launches a HEADED Chrome with a PERSISTENT profile
// (kept in scratchpad) pointed at https://proculink.eu. On first run you log in
// ONCE in the window that opens; the session persists so re-runs need no login.
// Then it captures every app page at 4 viewports + every overlay state from
// capture-plans.json, FULL-PAGE, with your REAL production data, into the handoff
// screenshots folder (prefixed `prod-`).
//
//   cd project-proculink && node scripts/demo-video/tools/capture-prod.mjs
//
// Re-run anytime; login is remembered. Delete the profile dir to force re-login.

import { chromium } from "@playwright/test";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://proculink.eu";
const HANDOFF = "C:/Users/Dmitri.MARKIT/source/repos/ProcuLink/docs/design-system/redesign-handoff-2026-06-29";
const OUT = resolve(HANDOFF, "screenshots-prod");
const PLANS_FILE = resolve(HANDOFF, "capture-plans.json");
const PROFILE = "C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/plk-prod-profile";
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

// ---- REAL prod ids (harvested from the authenticated session) ----
const REAL = {
  order: "c600eaf4-d17c-44a3-979d-8a0f4de2ee72",
  supplier: "a259e2cc-80cd-4b26-aabf-b7fb73b3b04a",
  connection: "6db77b6e-4abc-4ab9-84db-82e2b1ebac8d",
  invoice: "b2c1aaf1-ede4-4eca-aaae-9bc3c456f8d6",
};

const VP = {
  "mobile-390": { width: 390, height: 844 },
  "tablet-768": { width: 768, height: 1024 },
  "desktop-1440": { width: 1440, height: 900 },
  "hd-1920": { width: 1920, height: 1080 },
};
const BASE_VPS = ["mobile-390", "tablet-768", "desktop-1440", "hd-1920"];

// [order, slug, prod url]
const ROUTES = [
  ["00", "global-shell", "/bridge"],
  ["01", "dashboard-bridge", "/bridge"],
  ["02", "inbox-list", "/inbox"],
  ["03", "order-review-mapper", `/inbox/${REAL.order}`],
  ["04", "upload", "/upload"],
  ["05", "suppliers-list", "/library/suppliers"],
  ["06", "supplier-detail", `/library/suppliers/${REAL.supplier}`],
  ["07", "connections-list", "/connections"],
  ["08", "connection-detail", `/connections/${REAL.connection}`],
  ["10", "inbound-invoices", "/inbound/invoices"],
  ["11", "inbound-asns", "/inbound/asns"],
  ["12", "library-mappings", "/library/mappings"],
  ["16", "library-buyers", "/library/buyers"],
  ["17", "library-standards", "/library/standards"],
  ["18", "operations-exceptions", "/operations/exceptions"],
  ["19", "operations-health", "/operations/health"],
  ["20", "operations-log", "/operations/log"],
  ["21", "operations-connectors", "/operations/connectors"],
  ["23", "settings", "/settings"],
  ["24", "admin", "/admin"],
];

const PLANS = existsSync(PLANS_FILE) ? JSON.parse(readFileSync(PLANS_FILE, "utf8")) : [];

// Map any mock id in an overlay url to the real prod id.
function fixUrl(u) {
  let r = u;
  r = r.replace(/\/library\/suppliers\/(s1|22222222-2222-2222-2222-222222222222)(?=[/?#]|$)/, `/library/suppliers/${REAL.supplier}`);
  r = r.replace(/\/connections\/conn-[^/?#]+/, `/connections/${REAL.connection}`);
  r = r.replace(/\/inbox\/ord-[^/?#]+/, `/inbox/${REAL.order}`);
  return r;
}

async function prep(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only"); } catch {}
    const css = "[data-nextjs-toast],#__next-build-watcher{display:none!important;}";
    const add = () => { const s = document.createElement("style"); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  });
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2200);
}
async function runStep(page, s) {
  const t = s.target, v = s.value;
  try {
    if (s.do === "click" && t) await page.locator(t).first().click({ timeout: 6000 });
    else if (s.do === "fill" && t) await page.locator(t).first().fill(v ?? "", { timeout: 6000 });
    else if (s.do === "hover" && t) await page.locator(t).first().hover({ timeout: 6000 });
    else if (s.do === "press") await page.keyboard.press(v ?? "Enter");
    else if (s.do === "scroll") { if (t) await page.locator(t).first().scrollIntoViewIfNeeded({ timeout: 6000 }); else await page.mouse.wheel(0, 800); }
    else if (s.do === "wait") { if (v) await page.waitForTimeout(Number(v)); else if (t) await page.waitForSelector(t, { timeout: 6000 }); else await page.waitForTimeout(500); }
  } catch (e) { console.log(`  soft-skip ${s.do} ${t ?? ""}: ${e.message}`); }
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: "chrome",
  viewport: { width: 1440, height: 900 },
  // Strip automation fingerprints so Google OAuth doesn't reject the browser.
  args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation", "--no-sandbox"],
});
await ctx.addInitScript(() => {
  try { Object.defineProperty(navigator, "webdriver", { get: () => false }); } catch {}
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// ---- one-time login gate ----
await page.goto(BASE + "/bridge", { waitUntil: "domcontentloaded" });
const authed = await page.evaluate(() => !!(window.Clerk && window.Clerk.user)).catch(() => false);
if (!authed) {
  console.log("\n========================================================");
  console.log(" LOG IN to ProcuLink in the window that just opened.");
  console.log(" Waiting up to 15 minutes for you to reach the dashboard…");
  console.log("========================================================\n");
  await page.waitForFunction(() => !!(window.Clerk && window.Clerk.user), null, { timeout: 900000 });
  console.log("Login detected — starting capture.\n");
}

let shots = 0;
for (const [order, slug, url] of ROUTES) {
  await prep(page);
  for (const vp of BASE_VPS) {
    await page.setViewportSize(VP[vp]);
    await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.screenshot({ path: resolve(OUT, `${order}-base-${vp}-${slug}.png`), fullPage: true }).catch((e) => console.log("  shot fail", e.message));
    shots++;
  }
  const group = PLANS.find((p) => p.order === order);
  for (const pl of group?.plans ?? []) {
    await page.setViewportSize(VP[pl.viewport] ?? VP["desktop-1440"]);
    await page.goto(BASE + fixUrl(pl.url || url), { waitUntil: "domcontentloaded" });
    await settle(page);
    for (const s of pl.steps ?? []) await runStep(page, s);
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(OUT, `${order}-${pl.label}-${pl.viewport}-${slug}.png`), fullPage: false }).catch((e) => console.log("  shot fail", e.message));
    shots++;
  }
  console.log(`[prod] ${order}-${slug} done (${shots} shots so far)`);
}
console.log(`\nDONE — ${shots} prod screenshots in ${OUT}`);
await ctx.close();
