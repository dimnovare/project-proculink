import { test, expect, type Locator, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";
import { SETTINGS_TABS } from "../../src/lib/settingsTabs";
import { DOCUMENT_PLANS, PLAN_BY_ID, nextPlanFor } from "../../src/lib/plans";
import { NUMBER_LOCALE } from "../../src/lib/format-number";

const box = async (l: Locator) => (await l.boundingBox())!;
const n = (x: number) => x.toLocaleString(NUMBER_LOCALE);
const tabs = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const main = (page: Page) => page.locator("#main-content");

/**
 * Every element box and every line of text under `root`, against the viewport and its card (as in
 * destinations.spec.ts). A line inside an element that clips is measured by the clipping box.
 */
const overflows = (root: Locator) =>
  root.evaluate((el) => {
    const vw = window.innerWidth;
    const out: string[] = [];
    const cardOf = (n: Element) => n.closest("[style*='--surface']") ?? el;
    const clipOf = (n: Element) => {
      for (let p: Element | null = n; p && p !== cardOf(n); p = p.parentElement)
        if (getComputedStyle(p).overflowX !== "visible") return p.getBoundingClientRect();
      return null;
    };
    const check = (what: string, r: { left: number; right: number }, n: Element) => {
      const c = cardOf(n).getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${what} runs past the screen: ${r.left.toFixed(1)}..${r.right.toFixed(1)} of ${vw}`);
      else if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`${what} runs past its card: ${r.left.toFixed(1)}..${r.right.toFixed(1)} in ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
    };
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const r = n.getBoundingClientRect();
      if (r.width && r.height) check(`<${n.tagName.toLowerCase()}> "${(n.textContent ?? "").trim().slice(0, 40)}"`, r, n);
    }
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const clip = clipOf(t.parentElement!);
      for (const line of range.getClientRects()) {
        const r = clip ? { left: Math.max(line.left, clip.left), right: Math.min(line.right, clip.right) } : line;
        check(`text line "${t.textContent.trim().slice(0, 40)}"`, r, t.parentElement!);
      }
    }
    return out;
  });

/** The page's measurements in one read: smallest text, short controls, text-field fonts, filled buttons. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("#main-content")!;
    const visible = (n: Element) => n.getClientRects().length > 0;
    const sizes: [number, string][] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const p = t.parentElement!;
      if (t.textContent?.trim() && visible(p)) sizes.push([parseFloat(getComputedStyle(p).fontSize), t.textContent.trim().slice(0, 40)]);
    }
    sizes.sort((a, b) => a[0] - b[0]);
    // A link inside a sentence is prose, not a stand-alone control: min-height does not apply to an inline box.
    const standalone = (n: HTMLElement) => !(n.tagName === "A" && getComputedStyle(n).display === "inline" && n.parentElement?.tagName === "P");
    const controls = [...root.querySelectorAll<HTMLElement>("a, button")].filter((c) => visible(c) && standalone(c));
    const fields = [...root.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select")].filter(visible);
    // Filled = a dark fill (navy, green, blue, red, violet), on the page and in any open dialog.
    const filled = [...document.querySelectorAll<HTMLElement>("#main-content a, #main-content button, [role=dialog] a, [role=dialog] button")]
      .filter(visible)
      .filter((c) => {
        const m = getComputedStyle(c).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const [r, g, b, a = 1] = m;
        return m.length >= 3 && a > 0.5 && (r + g + b) / 3 < 150;
      });
    return {
      smallest: sizes[0],
      short: controls.map((c) => [(c.getAttribute("aria-label") ?? c.textContent ?? "").trim().slice(0, 40), c.getBoundingClientRect().height] as const).filter(([, h]) => h < 44),
      fields: fields.map((f) => [f.id || f.getAttribute("name") || f.tagName, parseFloat(getComputedStyle(f).fontSize)] as const),
      filled: filled.map((c) => [(c.textContent ?? "").trim(), getComputedStyle(c).backgroundColor] as const),
    };
  });

/** The tab row: one line, every tab inside the row and the screen, no tab's text cut, the row itself not scrolling. */
const tabRow = (page: Page) =>
  tabs(page).evaluate((nav) => {
    const vw = window.innerWidth;
    const row = nav.getBoundingClientRect();
    const out: string[] = [];
    if (nav.scrollWidth > nav.clientWidth + 1) out.push(`the row scrolls: ${nav.scrollWidth} in ${nav.clientWidth}`);
    const bs = [...nav.querySelectorAll<HTMLElement>("button")];
    for (const b of bs) {
      const r = b.getBoundingClientRect();
      if (r.left < row.left - 0.5 || r.right > Math.min(row.right, vw) + 0.5) out.push(`${b.textContent} at ${r.left.toFixed(1)}..${r.right.toFixed(1)} in ${row.left.toFixed(1)}..${row.right.toFixed(1)}`);
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent} text cut: ${b.scrollWidth} in ${b.clientWidth}`);
      if (Math.abs(r.top - bs[0].getBoundingClientRect().top) > 0.5) out.push(`${b.textContent} on a second line`);
    }
    return { out, heights: bs.map((b) => b.getBoundingClientRect().height) };
  });

test.describe("settings", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the tab is the address: a press replaces it, a reload keeps it, Back leaves Settings, and old or unknown tabs open Workspace", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=connectors");
    await expect(tabs(page).getByRole("button")).toHaveText(SETTINGS_TABS.map((t) => t.label));
    const current = tabs(page).locator("[aria-current=page]");
    await expect(current).toHaveText("Workspace");
    const tell = page.getByRole("region", { name: "Tell me when" });
    await expect(tell.getByRole("group", { name: "By email" })).toBeVisible();
    await expect(tell).toContainText("Emails go to sam@example.test, at most one every 15 minutes.");

    for (const address of ["/settings?tab=nope", "/settings?tab=billing&tab=api", "/settings"]) {
      await page.goto(address);
      await expect(current, address).toHaveText("Workspace");
    }

    await page.goto("/documents");
    await page.goto("/settings");
    for (const t of SETTINGS_TABS) {
      await tabs(page).getByRole("button", { name: t.label }).click();
      await expect(page).toHaveURL(new RegExp(`/settings\\?tab=${t.id}$`));
      await expect(current).toHaveText(t.label);
      await expect(current).toHaveCount(1);
    }
    await page.reload();
    await expect(current).toHaveText(SETTINGS_TABS.at(-1)!.label);
    await page.goBack();
    await expect(page).toHaveURL(/\/documents$/);

    await page.goto("/settings?tab=destinations&open=dest-1");
    await expect(current).toHaveText("Destinations");
    await expect(page.getByRole("region", { name: "Edit Accounting inbox" })).toBeVisible();
    // The board's width for the tab at 1440: 1,230px, not the page's full width.
    const width = (await box(page.getByText("Every place your files can be sent.", { exact: false }).locator("xpath=../.."))).width;
    test.info().annotations.push({ type: "destinations width at 1440", description: width.toFixed(0) });
    expect(width).toBeLessThanOrEqual(1230);
  });

  test("Plan & billing says the mock's trial in the registry's words, lists its upgrades, and Annual changes the prices in place", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=billing");
    const trial = PLAN_BY_ID.pilot;
    const card = page.getByTestId("plan-card");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(trial.name);
    // The mock's status: a trial ending 9 days from now with 5 documents read; its allowance is the trial's.
    await expect(card).toContainText(`Free for ${trial.priceCadence}, 9 days left.`);
    await expect(card.getByRole("img", { name: `5 of ${n(trial.orderLimit!)} documents used in your trial` })).toBeVisible();
    await expect(card).toContainText(`${n(trial.orderLimit! - 5)} left in your trial.`);
    await expect(card.getByRole("img", { name: new RegExp(`^\\d+ of ${trial.flowLimit} flows used$`) })).toBeVisible();

    const change = page.getByRole("region", { name: "Change plan" });
    await expect(change.getByRole("button")).toHaveText(DOCUMENT_PLANS.map((p) => `Upgrade to ${p.name}`));
    const main_ = PLAN_BY_ID[nextPlanFor("pilot", true)!];
    expect((await measure(page)).filled.map(([t]) => t)).toEqual([`Upgrade to ${main_.name}`]);
    for (const p of DOCUMENT_PLANS) {
      await expect(change).toContainText(`€${n(p.priceMonthly!)} a month`);
      await expect(change).toContainText(`${n(p.orderLimit!)} documents a month`);
    }
    const top = DOCUMENT_PLANS.at(-1)!;
    await expect(change).toContainText(`Need more than ${n(top.orderLimit!)} documents a month? Contact us.`);
    await expect(change.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", /^mailto:/);
    // A trial has no Stripe customer: no portal, no cancelling.
    await expect(page.getByRole("region", { name: "Payment and invoices" })).toHaveCount(0);
    await expect(page.getByText("Manage in Stripe")).toHaveCount(0);

    const period = page.getByRole("radiogroup", { name: "Billing period" });
    await period.getByRole("radio", { name: "Annual" }).click();
    await expect(period.getByRole("radio", { name: "Annual" })).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/\/settings\?tab=billing$/);
    for (const p of DOCUMENT_PLANS) await expect(change).toContainText(`€${n(p.priceYearly!)} a year`);
    await expect(page.getByRole("region", { name: "Billing period" })).toContainText(
      `Annual gives you ${12 - main_.priceYearly! / main_.priceMonthly!} months free, billed once a year.`);
    expect((await measure(page)).filled.map(([t]) => t)).toEqual([`Upgrade to ${main_.name}`]);
  });

  test("a new API key is shown once: never in the address or browser storage, gone after closing and after a reload", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=api");
    await expect(page.getByText("No API keys yet.")).toBeVisible();
    const kept = (raw: string) =>
      page.evaluate((s) => [localStorage, sessionStorage].some((st) => Object.keys(st).some((k) => k.includes(s) || st.getItem(k)!.includes(s)))
        || document.documentElement.outerHTML.includes(s) || location.href.includes(s), raw);
    const create = async (name: string) => {
      await page.getByRole("button", { name: "Create key" }).click();
      await page.getByLabel("Name").fill(name);
      expect((await measure(page)).filled.map(([t]) => t)).toEqual(["Create key"]);
      await page.getByRole("button", { name: "Create key" }).click();
      const dialog = page.getByRole("dialog", { name: "Copy your new API key now" });
      const raw = (await dialog.getByTestId("new-api-key").textContent())!.trim();
      expect(raw).toMatch(/^example-not-a-real-key-\d+$/);
      expect(page.url()).not.toContain(raw);
      expect(await page.evaluate((s) => [localStorage, sessionStorage].some((st) => Object.keys(st).some((k) => st.getItem(k)!.includes(s))), raw)).toBe(false);
      return { dialog, raw };
    };

    const first = await create("Accounting system");
    await first.dialog.getByRole("button", { name: "I've saved it" }).click();
    await expect(first.dialog).toHaveCount(0);
    await expect(page.getByTestId("api-keys-table")).toContainText("Accounting system");
    expect(await kept(first.raw)).toBe(false);

    const second = await create("Warehouse system");
    await page.keyboard.press("Escape");
    await expect(second.dialog).toHaveCount(0);
    expect(await kept(second.raw)).toBe(false);
    await tabs(page).getByRole("button", { name: "Workspace" }).click();
    await tabs(page).getByRole("button", { name: "API keys" }).click();
    await expect(page.getByTestId("api-keys-table")).toContainText("Warehouse system");
    expect(await kept(first.raw) || await kept(second.raw)).toBe(false);

    await page.reload();
    await expect(page.getByRole("button", { name: "Create key" })).toBeVisible();
    expect(await kept(first.raw) || await kept(second.raw)).toBe(false);
  });

  test("revoking asks first, the red Revoke is the one filled button while it asks, and the row says Revoked", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/settings?tab=api");
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByLabel("Name").fill("Accounting system");
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByRole("button", { name: "I've saved it" }).click();
    const table = page.getByTestId("api-keys-table");
    await table.getByRole("button", { name: "Revoke" }).click();
    const confirm = table.getByRole("group", { name: "Anything that uses this key stops working." });
    await expect(confirm).toBeVisible();
    await settle(page, 300);
    const filled = (await measure(page)).filled;
    test.info().annotations.push({ type: "filled during the revoke confirm", description: JSON.stringify(filled) });
    await page.screenshot({ path: ".qa-screenshots/settings-revoke-confirm-1440.png" });
    expect(filled.map(([t]) => t)).toEqual(["Revoke"]);
    await confirm.getByRole("button", { name: "Revoke" }).click();
    await expect(table.getByText("Revoked")).toBeVisible();
    await expect(table.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    // Closed again, Create key is the filled one (after its colour transition).
    await settle(page, 300);
    expect((await measure(page)).filled.map(([t]) => t)).toEqual(["Create key"]);
  });

  // Each tab in the state with the most on screen, and the one filled button it may show.
  const STATES: { tab: string; address: string; filled: string[]; open?: (page: Page) => Promise<void> }[] = [
    { tab: "org", address: "/settings?tab=org", filled: [] },
    { tab: "destinations", address: "/settings?tab=destinations&open=dest-1", filled: ["Save and send a test"] },
    { tab: "billing", address: "/settings?tab=billing", filled: [`Upgrade to ${PLAN_BY_ID[nextPlanFor("pilot", true)!].name}`] },
    { tab: "api", address: "/settings?tab=api", filled: ["Create key"] },
    {
      tab: "api (form open)", address: "/settings?tab=api", filled: ["Create key"],
      open: async (page) => { await page.getByRole("button", { name: "Create key" }).click(); await page.getByLabel("Name").fill("Accounting system"); },
    },
  ];

  for (const width of [1440, 1024, 768, 390, 360]) {
    test(`at ${width}: nothing runs past the screen or its card, no text under 12.5px, a clean tab row, one filled button${width < 640 ? ", 44px controls and 16px fields" : ""}`, async ({ page }) => {
      await preparePage(page, { dismissCookieBanner: true });
      await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
      const notes: Record<string, unknown> = {};
      for (const s of STATES) {
        await page.goto(s.address);
        await expect(tabs(page).locator("[aria-current=page]")).toHaveCount(1);
        await settle(page);
        await s.open?.(page);
        const where = `${s.tab} at ${width}`;
        const row = await tabRow(page);
        expect(row.out, where).toEqual([]);
        expect(await overflows(main(page)), where).toEqual([]);
        const m = await measure(page);
        expect(m.smallest[0], `${where}: the smallest text is "${m.smallest[1]}"`).toBeGreaterThanOrEqual(12.5);
        expect(m.filled.map(([t]) => t), where).toEqual(s.filled);
        if (width < 640) {
          expect(Math.min(...row.heights), where).toBeGreaterThanOrEqual(44);
          expect(m.short, where).toEqual([]);
          expect(m.fields.filter(([, f]) => f < 16), where).toEqual([]);
        }
        notes[s.tab] = { smallest: m.smallest, fields: m.fields, tabHeights: row.heights };
        if (width === 1440) {
          notes[`${s.tab} widths`] = await main(page).evaluate((el) =>
            [...el.querySelectorAll("section[aria-labelledby], aside, [data-testid=plan-card]")]
              .map((p) => `${p.getAttribute("aria-labelledby") ?? p.getAttribute("data-testid") ?? p.tagName}: ${p.getBoundingClientRect().width.toFixed(0)}`));
        }
      }
      test.info().annotations.push({ type: `measured at ${width}`, description: JSON.stringify(notes) });
    });
  }
});
