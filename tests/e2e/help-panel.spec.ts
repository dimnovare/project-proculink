import { test, expect, type Locator, type Page } from "@playwright/test";
import { SECTION_GUIDES } from "../../src/lib/section-guides";
import { preparePage, settle } from "./a11yHarness";

/**
 * The help panel beside the page (plan 14.11 R1 to R3), the in-app page not found (R19, R20)
 * and the shared states (loading, couldn't load, confirm), measured in a real browser: jsdom
 * has no layout, so where the panel sits, what it covers and what spills past an edge can
 * only be read here.
 */

const PANEL = "#help-panel";
const MAIN = "main#main-content";
const box = async (l: Locator) => (await l.boundingBox())!;
const helpControl = (page: Page) => page.getByRole("button", { name: "Help", exact: true });

async function open(page: Page, path: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await preparePage(page, { dismissCookieBanner: true });
  await page.goto(path);
  await settle(page);
}

async function openHelp(page: Page) {
  await expect(helpControl(page)).toHaveAttribute("aria-expanded", "false");
  await helpControl(page).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(helpControl(page)).toHaveAttribute("aria-expanded", "true");
  // Focus lands in the search, so Escape (taken only from inside the panel) reaches it.
  await expect(page.locator(PANEL).getByLabel("Search help articles")).toBeFocused();
}

/** The element painted at a control's centre is that control (or inside it): nothing covers it. */
const isOnTop = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });

/**
 * Every visible box and every rendered text line under `root` that crosses the viewport or
 * the card it sits in. A box inside a scroller other than the page and the panel is that
 * scroller's to clip (a wide table), and a line inside an ellipsis box is clipped on purpose.
 */
function spills(page: Page, root: string) {
  return page.evaluate((rootSel) => {
    const vw = window.innerWidth;
    const out: string[] = [];
    const scrollRoots = new Set([document.querySelector("main#main-content"), document.querySelector("#help-panel")]);
    // A deliberate clip (hidden, an ellipsis) or a deliberate sideways scroller (overflow-x-*)
    // owns what it holds. A page or panel scroller (overflow-auto, overflow-y-auto) does not:
    // a box spilling sideways out of one of those is the defect.
    const clipper = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scrollRoots.has(p)) return null;
        const s = getComputedStyle(p);
        if (/(hidden|clip)/.test(s.overflowX) || /\boverflow-x-(auto|scroll)\b/.test(p.className.toString())) return p;
      }
      return null;
    };
    const cardOf = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.id === "help-panel") return p;
        const s = getComputedStyle(p);
        if (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderRightWidth) > 0 && s.borderTopLeftRadius !== "0px") return p;
      }
      return null;
    };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
    const check = (what: string, r: DOMRect, el: Element) => {
      if (r.width === 0 || r.height === 0) return;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${what} ${name(el)} x ${r.left.toFixed(1)}..${r.right.toFixed(1)} past viewport ${vw}`);
      const card = cardOf(el);
      if (card) {
        const c = card.getBoundingClientRect();
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`${what} ${name(el)} x ${r.left.toFixed(1)}..${r.right.toFixed(1)} past its card ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
      }
    };
    const rootEl = document.querySelector(rootSel);
    if (!rootEl) return [`no ${rootSel}`];
    for (const el of [rootEl, ...rootEl.querySelectorAll("*")]) {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || clipper(el)) continue;
      if (s.position === "absolute" && s.clip !== "auto") continue; // sr-only
      check("box", el.getBoundingClientRect(), el);
    }
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!(n.textContent ?? "").trim() || clipper(n as unknown as Element) || !el.checkVisibility?.()) continue;
      if (getComputedStyle(el).position === "absolute" && getComputedStyle(el).clip !== "auto") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) check("text line", r, el);
    }
    return out;
  }, root);
}

/** Text smaller than 12.5px under `root`, with its size. */
const smallText = (page: Page, root: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(`${sel}, ${sel} *`)) {
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? "").trim());
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (own && size < 12.5) out.push(`${size}px "${(el.textContent ?? "").trim().slice(0, 40)}"`);
    }
    return out;
  }, root);

/** Buttons and links with a dark (filled) background in the page and the panel. */
const filledButtons = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("main#main-content :is(a, button), #help-panel :is(a, button)")) {
      if (!(el as HTMLElement).checkVisibility?.()) continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const [r, g, b, a = 1] = m;
      if (m.length < 3 || a === 0) continue;
      if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5) out.push((el.getAttribute("aria-label") ?? el.textContent ?? "").trim());
    }
    return out;
  });

/** Controls under 44px tall (or, for a button, 44px wide), not counting links inside running text. */
const smallTargets = (page: Page, root: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(`${sel} :is(a, button, input, select, [role=tab])`)) {
      if (!(el as HTMLElement).checkVisibility?.() || getComputedStyle(el).display === "inline") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || (el.tagName === "BUTTON" && r.width < 44)) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    }
    return out;
  }, root);

test.describe("help panel", () => {
  test("from 1440 wide it sits beside the page, covers none of it, and the page stays usable", async ({ page }) => {
    await open(page, "/documents", 1440, 900);
    const review = page.locator(MAIN).getByRole("link", { name: /^Review next/ }).first();
    await openHelp(page);
    const panel = await box(page.locator(PANEL)), main = await box(page.locator(MAIN));
    console.log(`1440: panel x ${panel.x} w ${panel.width}; main x ${main.x} w ${main.width}`);
    expect(Math.round(panel.width)).toBe(420);
    expect(Math.round(panel.x + panel.width)).toBe(1440);
    expect(main.x + main.width).toBeLessThanOrEqual(panel.x + 1);
    expect(Math.round(main.width)).toBe(1020);
    expect(await isOnTop(review), "the page's primary control is under the panel").toBe(true);
    expect(await page.locator("[aria-modal='true']").count()).toBe(0);
    expect(await page.locator(`${PANEL} :is(iframe, frame, object, embed)`).count()).toBe(0);

    // Press something on the page while the panel is open: it works and the panel stays.
    const sent = page.getByRole("tab", { name: /^Finished/ });
    await sent.click();
    await expect(sent).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(helpControl(page)).toHaveAttribute("aria-expanded", "true");

    // The Help control toggles it closed.
    await helpControl(page).click();
    await expect(page.locator(PANEL)).toHaveCount(0);
    await expect(helpControl(page)).toHaveAttribute("aria-expanded", "false");
    expect(Math.round((await box(page.locator(MAIN))).width)).toBe(1440);
  });

  for (const [width, height] of [[1280, 800], [768, 1024]] as const) {
    test(`at ${width} it lies over the page's right edge without dimming it, and Escape closes it`, async ({ page }) => {
      await open(page, "/documents", width, height);
      await openHelp(page);
      const panel = await box(page.locator(PANEL)), main = await box(page.locator(MAIN));
      console.log(`${width}: panel x ${panel.x} w ${panel.width} h ${panel.height}; main w ${main.width}`);
      expect(Math.round(panel.x + panel.width)).toBe(width);
      expect(Math.round(panel.width)).toBe(420);
      expect(Math.round(main.width)).toBe(width);
      expect(await page.locator("[aria-modal='true']").count()).toBe(0);
      await page.keyboard.press("Escape");
      await expect(page.locator(PANEL)).toHaveCount(0);
      await expect(helpControl(page)).toHaveAttribute("aria-expanded", "false");
      await expect(helpControl(page)).toBeFocused();
    });
  }

  for (const [width, height] of [[390, 844], [360, 740]] as const) {
    test(`at ${width} it is a sheet above the tab bar that leaves the round Add uncovered`, async ({ page }) => {
      await open(page, "/documents", width, height);
      const add = page.getByTestId("tab-bar").getByRole("link", { name: "Add a document" })
        .or(page.getByTestId("tab-bar").getByRole("button", { name: "Add a document" }));
      expect(await isOnTop(add), "Add is covered before help opens").toBe(true);
      await openHelp(page);
      const sheet = await box(page.locator(PANEL)), bar = await box(page.getByTestId("tab-bar"));
      console.log(`${width}: sheet y ${sheet.y} h ${sheet.height} bottom ${sheet.y + sheet.height}; bar y ${bar.y}; add ${JSON.stringify(await box(add))}`);
      expect(Math.abs(sheet.y + sheet.height - bar.y)).toBeLessThanOrEqual(1);
      expect(sheet.height).toBeLessThanOrEqual(height * 0.75 + 1);
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(width);
      expect(await isOnTop(add), "the sheet covers the round Add").toBe(true);
      for (const link of await page.locator(`${PANEL} nav a`).all()) {
        expect((await box(link)).height).toBeGreaterThanOrEqual(44);
        expect(await isOnTop(link), `${await link.textContent()} is covered`).toBe(true);
      }
      expect(await smallTargets(page, PANEL)).toEqual([]);
      await page.getByRole("button", { name: "Close help" }).click();
      await expect(page.locator(PANEL)).toHaveCount(0);
      await expect(helpControl(page)).toHaveAttribute("aria-expanded", "false");
      await expect(helpControl(page)).toBeFocused();
    });
  }

  test("a task opens its article inside the panel; a link to another article opens in a new tab", async ({ page }) => {
    await open(page, "/documents", 1440, 900);
    await openHelp(page);
    const panel = page.locator(PANEL);
    await panel.getByRole("link", { name: /What "Needs you" means/ }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(panel.getByRole("heading", { name: "Documents and their statuses" })).toBeVisible();
    await expect(panel.getByText("Open Documents to see everything that has arrived.", { exact: false })).toBeVisible();
    const other = panel.getByRole("link", { name: "History and notifications" });
    await expect(other).toHaveAttribute("target", "_blank");
    await expect(other).toHaveAttribute("rel", /noopener/);
    expect(await panel.locator("iframe, frame, object, embed").count()).toBe(0);
    await panel.getByRole("button", { name: "Back to help" }).click();
    await expect(panel.getByRole("region", { name: "Help for this screen" })).toBeVisible();
  });

  /** For each screen: the controls its three tasks and Start here send a person to. */
  // "summary" is a fold's opening line (a <summary>, which has no button role): For developers on Settings holds the API keys.
  const NAMED_CONTROLS: Record<string, { role: "link" | "button" | "tab" | "radio" | "summary"; name: RegExp }[]> = {
    "/documents": [
      { role: "tab", name: /^Needs you/ }, { role: "link", name: /^Review next/ },
      { role: "tab", name: /^Finished/ }, { role: "tab", name: /^All/ },
    ],
    // The mock trial holds more flows than its plan allows, so the header offers See plans where New flow would be (B-06).
    "/flows": [{ role: "link", name: /^Supplier invoices$/ }, { role: "link", name: /^See plans$/ }],
    "/settings": [
      { role: "button", name: /^Plan & billing$/ }, { role: "summary", name: /^For developers/ }, { role: "button", name: /^Workspace$/ },
    ],
    "/upload": [
      // No flow to choose (plan 15b): drop in any document, or forward it to the workspace's address.
      { role: "button", name: /^Choose files$/ }, { role: "button", name: /^Copy address$/ },
    ],
  };

  for (const [path, controls] of Object.entries(NAMED_CONTROLS)) {
    test(`on ${path} the panel's three tasks are this screen's, and the controls they name are on it`, async ({ page }) => {
      await open(page, path, 1440, 900);
      await openHelp(page);
      const guide = SECTION_GUIDES.find((g) => g.route === path)!;
      const region = page.locator(PANEL).getByRole("region", { name: "Help for this screen" });
      await expect(region).toContainText(guide.screen);
      for (const t of guide.tasks) await expect(region.getByRole("link", { name: new RegExp(`^${t.title.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")}`) })).toBeVisible();
      const main = page.locator(MAIN);
      for (const c of controls) {
        const control = c.role === "summary" ? main.locator("summary").filter({ hasText: c.name }) : main.getByRole(c.role, { name: c.name });
        await expect(control.first(), `${path} has no ${c.role} ${c.name}`).toBeVisible();
      }
      // Settings opens on Workspace, which saves as you type and has no filled button (plan 14.7b); on Flows the header action is outlined (plan 16b).
      expect(await filledButtons(page), "the screen's filled buttons with the panel open").toHaveLength(path === "/settings" || path === "/flows" ? 0 : 1);
    });
  }

  for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [360, 740]] as const) {
    test(`at ${width} nothing spills past the viewport or its card, panel closed and open`, async ({ page }) => {
      await open(page, "/documents", width, height);
      expect(await spills(page, MAIN), "closed").toEqual([]);
      await openHelp(page);
      expect(await spills(page, MAIN), "open, the page").toEqual([]);
      expect(await spills(page, PANEL), "open, the panel").toEqual([]);
      expect(await smallText(page, PANEL)).toEqual([]);
      if (width < 640) expect(await smallTargets(page, PANEL)).toEqual([]);
    });
  }
});

test.describe("page not found inside the app", () => {
  for (const path of ["/flows/this/does/not/exist", "/documents/x/y", "/settings/x"]) {
    test(`${path} keeps the shell, says what happened and offers the way back`, async ({ page }) => {
      await open(page, path, 1440, 900);
      await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
      await expect(page.getByText("The address may be mistyped, or the page may have moved. Your documents and flows are safe.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Documents", exact: true })).toHaveAttribute("href", "/documents");
      expect(await smallText(page, MAIN)).toEqual([]);
      expect(await spills(page, MAIN)).toEqual([]);
      expect(await filledButtons(page)).toEqual(["Go to Documents"]);
      const getHelp = page.getByRole("button", { name: "Get help" });
      await getHelp.click();
      await expect(page.locator(PANEL)).toBeVisible();
      await expect(helpControl(page)).toHaveAttribute("aria-expanded", "true");
      expect(await filledButtons(page), "one filled button with the panel open").toEqual(["Go to Documents"]);
      // The panel takes Escape only from inside itself; opening it puts focus in its search.
      await expect(page.locator(PANEL).getByLabel("Search help articles")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator(PANEL)).toHaveCount(0);
      await expect(getHelp).toBeFocused();
    });
  }

  test("on a phone the not-found page fits, and its controls are 44px", async ({ page }) => {
    test.setTimeout(60_000);
    for (const width of [390, 360]) {
      await open(page, "/flows/this/does/not/exist", width, 800);
      expect(await spills(page, MAIN)).toEqual([]);
      expect(await smallTargets(page, MAIN)).toEqual([]);
      expect(await smallText(page, MAIN)).toEqual([]);
    }
  });

  test("the way back goes to Documents", async ({ page }) => {
    await open(page, "/documents/x/y", 1440, 900);
    await page.getByRole("link", { name: "Go to Documents", exact: true }).click();
    // A cold dev server compiles /documents on this click; the wait is for that, not the app.
    await expect(page).toHaveURL(/\/documents$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  });

  // The status code is not asserted: (app)/loading.tsx starts the response before the catch-all's
  // notFound() runs, so it streams as 200. Accepted (signed-in pages, not indexed); the person sees
  // the not-found page either way, which is what this pins.
  test("an unknown app address draws the not-found page and Get help", async ({ page }) => {
    await open(page, "/flows/this/does/not/exist", 1440, 900);
    await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get help" })).toBeVisible();
  });

  test("an id that does not exist reads exactly like any other unknown id", async ({ page }) => {
    test.setTimeout(90_000);
    const textOf = async (path: string) => {
      await open(page, path, 1440, 900);
      return (await page.locator(MAIN).innerText()).trim();
    };
    for (const [a, b] of [["/flows/does-not-exist", "/flows/zz-another-missing-id"], ["/lookups/does-not-exist", "/lookups/zz-another-missing-id"]]) {
      const first = await textOf(a);
      expect(first).not.toMatch(/workspace|permission|access|does-not-exist/i);
      expect(await textOf(b)).toBe(first);
    }
  });

  // A 404 for a flow or lookup id is the in-app not-found page: no "Try again", which cannot help.
  for (const path of ["/flows/does-not-exist", "/lookups/does-not-exist"]) {
    test(`${path} offers the way back and Get help like an unknown address`, async ({ page }) => {
      await open(page, path, 1440, 900);
      await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
      await expect(page.locator(MAIN).getByRole("button", { name: "Try again" })).toHaveCount(0);
      await page.getByRole("button", { name: "Get help" }).click();
      await expect(page.locator(PANEL)).toBeVisible();
    });
  }

  test("a retired address under a caught prefix is still redirected; a bare /operations is the website's 404", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.goto("/operations/webhooks");
    await expect(page).toHaveURL(/\/settings(\?|$)/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const bare = await page.goto("/operations");
    expect(bare?.status()).toBe(404);
    // The website's 404 now has the site frame and its own main, so it is told from the app's
    // not-found page by its words, not by a missing main.
    await expect(page.getByRole("heading", { level: 1, name: "This page took a wrong turn." })).toBeVisible();
    await expect(page.getByText("We can't find that page")).toHaveCount(0);
    console.log(`/operations: ${bare?.status()}, title "${await page.title()}", h1 "${await page.locator("h1").first().textContent()}"`);
  });

  test("the tab title of a not-found page is its nearest section's", async ({ page }) => {
    test.setTimeout(60_000);
    for (const [path, title] of [["/flows/a/b", "Flows — ProcuLink"], ["/settings/x", "Settings — ProcuLink"]]) {
      await open(page, path, 1440, 900);
      await expect(page).toHaveTitle(title);
    }
  });
});

test.describe("shared states", () => {
  test("a slow screen shows its loading state, then lands without a layout jump", async ({ page }) => {
    test.setTimeout(60_000);
    // The mock answers in the page after a 120ms timer (MOCK_LATENCY_MS in mockEngine.ts), so
    // there is no request to intercept: stretch that timer to two seconds instead.
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __held: number };
      w.__cls = 0;
      w.__held = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      const later = window.setTimeout.bind(window);
      window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
        if (ms === 120) { w.__held++; ms = 2_000; }
        return later(fn, ms, ...rest);
      }) as typeof setTimeout;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparePage(page, { dismissCookieBanner: true });
    await page.goto("/flows");
    const loading = page.locator(MAIN).getByText("Loading flows…");
    await expect(loading).toBeVisible();
    const before = await box(page.locator(MAIN).getByRole("heading", { level: 1, name: "Flows" }));
    await expect(page.locator(MAIN).getByRole("link", { name: "Supplier invoices" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(loading).toHaveCount(0);
    const after = await box(page.locator(MAIN).getByRole("heading", { level: 1, name: "Flows" }));
    await page.waitForTimeout(500);
    const { cls, held } = await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __held: number };
      return { cls: w.__cls, held: w.__held };
    });
    console.log(`held ${held} mock answer(s); layout shift ${cls}; heading y ${before.y} -> ${after.y}`);
    expect(held).toBeGreaterThan(0);
    expect(after.y).toBe(before.y);
    expect(cls).toBeLessThan(0.1);
  });

  test("a failed request shows the couldn't-load notice, and Try again loads the screen", async ({ page }) => {
    test.setTimeout(60_000);
    // The mock answers in the page, so there is no request to intercept: fail its copy of the
    // lookups list until the test lets it through.
    await page.addInitScript(() => {
      const w = window as unknown as { __failLookups: boolean };
      w.__failLookups = true;
      const clone = window.structuredClone.bind(window);
      window.structuredClone = ((v: unknown, o?: StructuredSerializeOptions) => {
        if (w.__failLookups && Array.isArray(v) && v[0] && typeof v[0] === "object" && "hasCandidates" in v[0]) throw new TypeError("Failed to fetch");
        return clone(v, o);
      }) as typeof structuredClone;
    });
    await open(page, "/lookups", 1440, 900);
    const again = page.locator(MAIN).getByRole("button", { name: "Try again" });
    await expect(again).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(MAIN)).toContainText("We couldn't load this");
    await page.evaluate(() => { (window as unknown as { __failLookups: boolean }).__failLookups = false; });
    await again.click();
    await expect(page.locator(MAIN).getByRole("link", { name: /^Item codes/ })).toBeVisible();
    await expect(again).toHaveCount(0);
  });

  test("on a phone a delete confirm sits centred above the tab bar, Cancel holds focus, Escape cancels", async ({ page }) => {
    await open(page, "/settings?tab=destinations&open=dest-3", 390, 844);
    const trigger = page.getByRole("button", { name: "Delete destination" });
    await trigger.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300); // the open transition
    const d = await box(dialog), bar = await box(page.getByTestId("tab-bar"));
    console.log(`confirm: x ${d.x} w ${d.width} y ${d.y} h ${d.height}; bar y ${bar.y}`);
    expect(Math.abs(d.x + d.width / 2 - 195)).toBeLessThanOrEqual(1);
    expect(Math.round(d.x), "a 16px gutter on the left").toBeGreaterThanOrEqual(16);
    expect(Math.round(d.x + d.width), "a 16px gutter on the right").toBeLessThanOrEqual(390 - 16);
    expect(Math.abs(d.y + d.height / 2 - bar.y / 2)).toBeLessThanOrEqual(1);
    expect(d.y + d.height).toBeLessThanOrEqual(bar.y);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    // Review M7: the buttons' classes and colours, and how many of them are filled.
    const buttons = await dialog.getByRole("button").evaluateAll((els) => els.map((el) => {
      const [r, g, b] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      const a = Number((getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [])[3] ?? 1);
      return { name: el.textContent?.trim(), bg: getComputedStyle(el).backgroundColor, filled: a > 0 && (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5, height: el.getBoundingClientRect().height, cls: el.className };
    }));
    console.log(`confirm buttons: ${JSON.stringify(buttons)}`);
    await page.screenshot({ path: ".qa-screenshots/plan14-11-confirm-delete-390.png" });
    expect(buttons.map((b) => b.name)).toEqual(["Cancel", "Delete"]);
    expect(buttons.filter((b) => b.filled).map((b) => b.name), "one filled button in the confirm").toEqual(["Delete"]);
    expect(buttons[1].bg, "Delete is red, not navy").not.toBe("rgb(11, 26, 47)");
    for (const b of buttons) expect(b.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Destinations" })).toContainText("Accounting server");
  });

  test("when a confirm closes, focus returns to the control that opened it", async ({ page }) => {
    test.setTimeout(60_000);
    for (const [width, height] of [[390, 844], [1440, 900]] as const) {
      await open(page, "/settings?tab=destinations&open=dest-3", width, height);
      const trigger = page.getByRole("button", { name: "Delete destination" });
      for (const close of ["Escape", "Cancel"] as const) {
        await trigger.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        if (close === "Escape") await page.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger, `${close} at ${width}`).toBeFocused();
      }
    }
  });
});
