import { test } from "@playwright/test";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Redesign-handoff capture: screenshots EVERY app page at 4 viewports
 * (mobile 390 / tablet 768 / desktop 1440 / HD 1920) PLUS every overlay /
 * tab / modal state described in capture-plans.json (produced by the
 * proculink-redesign-spec workflow). Mock mode + auth bypass via
 * playwright.tools.config.ts (dev:demo on 8090). Clean prep: hides the
 * mock badge + Next dev overlays, NO demo cursor (this is design reference,
 * not footage). Fail-soft per step so a bad selector never aborts a route.
 *
 *   bun run demo:tools:capture capture-redesign
 *
 * Output: ProcuLink/docs/design-system/redesign-handoff-2026-06-29/screenshots
 */

test.use({ video: "off" });

const HANDOFF =
  "C:/Users/Dmitri.MARKIT/source/repos/ProcuLink/docs/design-system/redesign-handoff-2026-06-29";
const OUT = resolve(HANDOFF, "screenshots");
const PLANS_FILE = resolve(HANDOFF, "capture-plans.json");
mkdirSync(OUT, { recursive: true });

const SUP = "22222222-2222-2222-2222-222222222222"; // canonical mock supplier id

const VP: Record<string, { width: number; height: number }> = {
  "mobile-390": { width: 390, height: 844 },
  "tablet-768": { width: 768, height: 1024 },
  "desktop-1440": { width: 1440, height: 900 },
  "hd-1920": { width: 1920, height: 1080 },
};
const BASE_VPS = ["mobile-390", "tablet-768", "desktop-1440", "hd-1920"] as const;

// [order, slug, base mock url]
const ROUTES: Array<[string, string, string]> = [
  ["00", "global-shell", "/bridge"], // shell overlays (cmd palette, help, mobile nav)
  ["01", "dashboard-bridge", "/bridge"],
  ["02", "inbox-list", "/inbox"],
  ["03", "order-review-mapper", "/inbox/ord-001"],
  ["04", "upload", "/upload"],
  ["05", "suppliers-list", "/library/suppliers"],
  ["06", "supplier-detail", `/library/suppliers/${SUP}`],
  ["07", "connections-list", "/connections"],
  ["08", "connection-detail", `/connections/conn-${SUP}`],
  ["10", "inbound-invoices", "/inbound/invoices"],
  ["11", "inbound-asns", "/inbound/asns"],
  ["12", "library-mappings", "/library/mappings"],
  ["16", "library-buyers", "/library/buyers"],
  ["17", "library-standards", "/library/standards"],
  ["18", "operations-exceptions", "/operations/exceptions"],
  ["19", "operations-health", "/operations/health"],
  ["20", "operations-log", "/operations/log"],
  ["23", "settings", "/settings"],
  ["24", "admin", "/admin"],
];

interface Step { do: string; target?: string; value?: string }
interface Plan { label: string; viewport: string; url: string; steps: Step[] }
interface PlanGroup { order: string; slug: string; route: string; plans: Plan[] }

const PLANS: PlanGroup[] = existsSync(PLANS_FILE)
  ? (JSON.parse(readFileSync(PLANS_FILE, "utf8")) as PlanGroup[])
  : [];

async function prep(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
    } catch {
      /* ignore */
    }
    const css =
      'span[title^="You are viewing mock data"]{display:none!important;}' +
      "nextjs-portal,[data-next-badge-root],[data-nextjs-toast]," +
      "[data-nextjs-dev-tools-button],#__next-build-watcher," +
      "[data-nextjs-dialog-overlay]{display:none!important;}";
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
}

async function settle(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2600); // mock data + BridgeLoader + Next dev first-compile settle
}

function fixUrl(u: string): string {
  // Agents guessed some detail ids; normalize to the canonical mock ids so the
  // pages actually render. Supplier "s1" -> the UUID; mock connection id is
  // always `conn-<supplierUUID>`.
  let r = u.replace(/\/library\/suppliers\/s1(?=[/?]|$)/, `/library/suppliers/${SUP}`);
  r = r.replace(/\/connections\/conn-[^/?#]+/, `/connections/conn-${SUP}`);
  return r;
}

async function runStep(page: import("@playwright/test").Page, s: Step) {
  const t = s.target;
  const v = s.value;
  try {
    if (s.do === "click" && t) await page.locator(t).first().click({ timeout: 6000 });
    else if (s.do === "fill" && t) await page.locator(t).first().fill(v ?? "", { timeout: 6000 });
    else if (s.do === "hover" && t) await page.locator(t).first().hover({ timeout: 6000 });
    else if (s.do === "press") await page.keyboard.press(v ?? "Enter");
    else if (s.do === "scroll") {
      if (t) await page.locator(t).first().scrollIntoViewIfNeeded({ timeout: 6000 });
      else await page.mouse.wheel(0, 800);
    } else if (s.do === "wait") {
      if (v) await page.waitForTimeout(Number(v));
      else if (t) await page.waitForSelector(t, { timeout: 6000 });
      else await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log(`[redesign] soft-skip ${s.do} ${t ?? ""}: ${(e as Error).message}`);
  }
}

test.describe("redesign capture", () => {
  for (const [order, slug, url] of ROUTES) {
    test(`${order}-${slug}`, async ({ page }) => {
      await prep(page);

      // Base page at every viewport (full page).
      for (const vp of BASE_VPS) {
        await page.setViewportSize(VP[vp]);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.screenshot({
          path: resolve(OUT, `${order}-base-${vp}-${slug}.png`),
          fullPage: true,
        });
        console.log(`[redesign] shot ${order}-base-${vp}-${slug}`);
      }

      // Overlay / tab / special states for this route (viewport screenshot so
      // centered modals are framed; fail-soft).
      const group = PLANS.find((p) => p.order === order);
      for (const pl of group?.plans ?? []) {
        const vp = VP[pl.viewport] ?? VP["desktop-1440"];
        await page.setViewportSize(vp);
        await page.goto(fixUrl(pl.url || url), { waitUntil: "domcontentloaded" });
        await settle(page);
        for (const s of pl.steps ?? []) await runStep(page, s);
        await page.waitForTimeout(700);
        await page.screenshot({
          path: resolve(OUT, `${order}-${pl.label}-${pl.viewport}-${slug}.png`),
          fullPage: false,
        });
        console.log(`[redesign] shot ${order}-${pl.label}-${pl.viewport}-${slug}`);
      }
    });
  }
});
