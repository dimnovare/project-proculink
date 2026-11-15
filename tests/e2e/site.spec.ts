import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { SITE_TITLE, SITE_URL } from "../../src/lib/seo";
import { preparePage } from "./a11yHarness";

/**
 * The public site in a real browser: the Home example's motion (both ways), the
 * one header at every width, the share image, and every public route still
 * wearing one header and one footer. Everything here is MEASURED; jsdom has no
 * Tailwind and no layout, so none of it can live in vitest.
 */

const WIDTHS = [1440, 1024, 900, 899, 768, 390, 360, 320] as const;

const smallestFont = (page: Page, scope = "body") =>
  page.evaluate((sel) => {
    let min = Infinity;
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      const box = (el as HTMLElement).getBoundingClientRect();
      if (hasText && box.width > 0 && box.height > 0) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    }
    return min;
  }, scope);

/**
 * Every element box and every rendered text line that runs past the viewport's
 * left or right edge. Content inside a clipping ancestor (overflow other than
 * visible, below <body>) cannot reach the viewport by itself; the ancestor is
 * measured instead. Hidden and visually-hidden nodes are skipped.
 */
const pastTheEdges = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const clipped = (el: Element | null) => {
      for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.clipPath !== "none") return true;
      }
      return false;
    };
    const hidden = (el: Element) => {
      const s = getComputedStyle(el);
      return s.visibility === "hidden" || (s.position === "absolute" && s.clip !== "auto" && s.clip !== "");
    };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : ""}`;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest("nextjs-portal,[data-next-badge-root],script,style")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || hidden(el) || clipped(el)) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`box ${name(el)} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent!.trim() || el.closest("script,style,nextjs-portal") || hidden(el) || clipped(n as unknown as Element)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        if (r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5))
          out.push(`text "${n.textContent!.trim().slice(0, 30)}" ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
    }
    return out;
  });

/** Visible links and buttons shorter than 44px. */
const shortControls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button")]
      .filter((el) => !el.closest("nextjs-portal,[data-next-badge-root]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && r.height < 44)
      .map(({ el, r }) => `${el.textContent!.trim().slice(0, 30) || el.getAttribute("aria-label")} ${r.height.toFixed(1)}px`),
  );

/** The header's one row: its height, and any text in it that broke onto a second line. */
const headerRow = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector("header")!;
    const row = header.firstElementChild as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    const broken: string[] = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent!.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0);
      if (lines.length > 1) broken.push(n.textContent!.trim());
      for (const r of lines) if (r.top < rowBox.top - 0.5 || r.bottom > rowBox.bottom + 0.5) broken.push(`${n.textContent!.trim()} outside the row`);
    }
    return { header: header.getBoundingClientRect().height, row: rowBox.height, broken };
  });

test.describe("public site", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the home example plays once, moves nothing, and is already finished for reduced motion", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });            // reduced motion
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const ex = page.getByTestId("home-example");
    const names = await ex.evaluate((root) => [root, ...root.querySelectorAll("*")].map((el) => getComputedStyle(el).animationName));
    expect(names.every((n) => n === "none"), "nothing in the example animates under reduced motion").toBe(true);
    await expect(ex.getByText("Sent", { exact: true })).toHaveCount(2);
    for (const sent of await ex.getByText("Sent", { exact: true }).all()) expect(await sent.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const look = ex.getByText("Check this one. We are 72% sure of it.", { exact: true });
    await expect(look, "the Total is marked to check under reduced motion").toBeVisible();
    expect(await look.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    // What a reduced-motion visitor sees, element by element: the picture the animation must end on.
    const picture = () => ex.evaluate((root) => [root, ...root.querySelectorAll("*")].map((el) => {
      const s = getComputedStyle(el);
      // A finished `both` animation holds its end value as an identity matrix, which draws exactly like `none`.
      const t = s.transform === "none" || new DOMMatrix(s.transform).isIdentity ? "none" : s.transform;
      return `${s.opacity}|${t}`;
    }));
    const still = await picture();

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __exStart: number; __h1Paint: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
          if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      // The H1 is painted before the example starts: the example's first animation
      // starts no earlier than the H1's first render (its element-timing paint).
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { identifier: string; renderTime: number; loadTime: number })[])
          if (e.identifier === "plk-h1") w.__h1Paint = e.renderTime || e.loadTime;
      }).observe({ type: "element", buffered: true });
      new MutationObserver(() => {
        const h1 = document.querySelector("h1");
        if (h1 && !h1.hasAttribute("elementtiming")) h1.setAttribute("elementtiming", "plk-h1");
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    const timings = await ex.evaluate((root) => root.getAnimations({ subtree: true }).map((a) => {
      const t = a.effect!.getComputedTiming();
      // When this animation starts to move: its start time plus its delay (until then it holds its first frame).
      return { iterations: t.iterations, end: Number(t.endTime), start: Number(a.startTime) + Number(a.effect!.getTiming().delay) };
    }));
    expect(timings.length).toBeGreaterThan(0);
    const moved = await ex.evaluate((root) => [...new Set(root.getAnimations({ subtree: true }).flatMap((a) =>
      (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k))))]
      .filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)));
    expect(moved.length, "the keyframes were read").toBeGreaterThan(0);
    expect(moved.filter((p) => p !== "opacity" && p !== "transform"), "the example animates only opacity and transform").toEqual([]);
    for (const t of timings) { expect(t.iterations).toBe(1); expect(t.end).toBeLessThanOrEqual(5000); }
    console.log(`[site] example animations: ${timings.length}, longest ends at ${Math.max(...timings.map((t) => t.end))}ms`);
    expect(await page.getByRole("heading", { level: 1 }).evaluate((h) => h.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const h1Paint = await page.evaluate(() => (window as unknown as { __h1Paint?: number }).__h1Paint);
    const firstStart = Math.min(...timings.map((t) => t.start));
    console.log(`[site] h1 painted at ${h1Paint}ms, example's first movement at ${firstStart}ms`);
    expect(h1Paint, "the H1 was painted").toBeGreaterThan(0);
    expect(h1Paint!, "the H1 is painted before the example starts").toBeLessThanOrEqual(firstStart);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="home-example"]')!.getAnimations({ subtree: true }).every((a) => a.playState === "finished"),
      null, { timeout: 8000 });
    // The observer window is the first 6 seconds after the reload.
    await page.waitForFunction(() => performance.now() >= 6000, null, { timeout: 10_000 });
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    console.log(`[site] layout shift over the first 6s with motion on: ${cls}`);
    expect(cls, "no layout shift").toBe(0);
    for (const sent of await ex.getByText("Sent", { exact: true }).all()) expect(await sent.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await expect(look, "the Total is still marked to check in the final frame").toBeVisible();
    expect(await look.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await picture(), "the final frame is the reduced-motion picture").toEqual(still);
  });

  test("the header: links from 900px, a sheet below it, and nothing under 12.5px or 44px on a phone", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const header = page.getByRole("banner");
    const menu = header.getByRole("button", { name: "Menu", exact: true });
    const main = header.getByRole("navigation", { name: "Main" });
    await page.setViewportSize({ width: 899, height: 800 });
    await page.goto("/help/flows");
    await expect(menu).toBeVisible();
    await expect(main).toBeHidden();
    await menu.click();
    const sheet = page.locator("#marketing-mobile-menu");
    await expect(sheet.getByRole("link", { name: "Help" })).toHaveAttribute("aria-current", "page");
    await page.setViewportSize({ width: 1000, height: 800 });                // widening closes the sheet
    // Closed, not just hidden by its own min-[900px]:hidden (which toBeHidden alone would accept).
    await expect(sheet, "widening past 900px closes the sheet").toHaveCount(0);
    await expect(main).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(main.getByRole("link", { name: "Help" })).toHaveAttribute("aria-current", "page");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const start = header.getByRole("link", { name: "Start free" });
      const startBox = (await start.boundingBox())!;
      await start.evaluate((a) => { a.textContent = "Open ProcuLink"; });     // the signed-in label in the same box
      const openBox = (await header.getByRole("link", { name: "Open ProcuLink" }).boundingBox())!;
      console.log(`[site] filled link at ${width}: ${startBox.width}px with "Start free", ${openBox.width}px with "Open ProcuLink"`);
      expect(Math.abs(openBox.width - startBox.width), `the label swap moves nothing at ${width}`).toBeLessThanOrEqual(0.5);
      await page.reload();
    }

    for (const path of ["/", "/how-it-works"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      const [logo, button, burger] = [header.getByRole("link").first(), header.getByRole("link", { name: "Start free" }), menu];
      const boxes = await Promise.all([logo, button, burger].map(async (l) => (await l.boundingBox())!));
      expect(boxes[0].x + boxes[0].width, `logo clears the button on ${path}`).toBeLessThanOrEqual(boxes[1].x);
      expect(boxes[1].x + boxes[1].width, `button clears the menu on ${path}`).toBeLessThanOrEqual(boxes[2].x);
      expect(boxes[2].x + boxes[2].width, `the menu stays inside the window on ${path}`).toBeLessThanOrEqual(390);
      for (const b of boxes.slice(1)) expect(b.height).toBeGreaterThanOrEqual(44);
      const min = await smallestFont(page);
      console.log(`[site] smallest text on ${path} at 390: ${min}px`);
      expect(min, `smallest text on ${path}`).toBeGreaterThanOrEqual(12.5);
      for (const link of await page.getByRole("contentinfo").getByRole("link").all())
        expect((await link.boundingBox())!.height, `footer link on ${path}`).toBeGreaterThanOrEqual(44);
    }
    await menu.click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#marketing-mobile-menu")).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("at every width nothing runs past the edge, nothing is under 12.5px, and the header stays one row", async ({ page }) => {
    test.setTimeout(240_000);
    await preparePage(page, { dismissCookieBanner: true });
    const header = page.getByRole("banner");
    const menu = header.getByRole("button", { name: "Menu", exact: true });
    const main = header.getByRole("navigation", { name: "Main" });
    for (const path of ["/", "/how-it-works"]) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        const at = `${path} at ${width}`;
        expect(await pastTheEdges(page), `past the viewport edge on ${at}`).toEqual([]);
        expect(await smallestFont(page), `smallest text on ${at}`).toBeGreaterThanOrEqual(12.5);
        if (width < 640) expect(await shortControls(page), `links and buttons under 44px on ${at}`).toEqual([]);
        const row = await headerRow(page);
        if (width === 390 || width === 1440) console.log(`[site] header on ${at}: ${row.header}px (row ${row.row}px)`);
        expect(row.broken, `header text off its one row on ${at}`).toEqual([]);
        expect(row.header, `header height on ${at}`).toBe(width < 900 ? 62 : 66);

        // The sheet's button exists exactly below 900px; the links exactly from 900px.
        if (width < 900) {
          await expect(menu, `menu button on ${at}`).toBeVisible();
          await expect(main, `main links on ${at}`).toBeHidden();
        } else {
          await expect(menu, `menu button on ${at}`).toBeHidden();
          await expect(main, `main links on ${at}`).toBeVisible();
          const how = expect(main.getByRole("link", { name: "How it works" }), `current page on ${at}`);
          await (path === "/how-it-works" ? how.toHaveAttribute("aria-current", "page") : how.not.toHaveAttribute("aria-current", "page"));
        }
      }
    }
  });

  test("at 320px the header fits one row: Menu and the filled link inside, whole and 44px tall", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const header = page.getByRole("banner");
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of ["/", "/how-it-works", "/pricing"]) {
      await page.goto(path);
      const at = `${path} at 320`;
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        `the page scrolls sideways on ${at}`).toBeLessThanOrEqual(0);
      expect(await pastTheEdges(page), `past the viewport edge on ${at}`).toEqual([]);
      const row = await headerRow(page);
      expect(row.broken, `header text off its one row on ${at}`).toEqual([]);
      expect(row.header, `header height on ${at}`).toBe(62);
      const filled = header.getByRole("link", { name: "Start free" });
      const menu = header.getByRole("button", { name: "Menu", exact: true });
      const [f, m] = [(await filled.boundingBox())!, (await menu.boundingBox())!];
      for (const [name, b] of [["filled link", f], ["Menu", m]] as const) {
        expect(b.x, `${name} left edge on ${at}`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${name} right edge on ${at}`).toBeLessThanOrEqual(320);
        expect(b.height, `${name} height on ${at}`).toBeGreaterThanOrEqual(44);
      }
      expect(f.x + f.width, `the filled link clears Menu on ${at}`).toBeLessThanOrEqual(m.x);
      // The label is whole: one line, and inside its own box (not clipped by it).
      const label = await filled.evaluate((a) => {
        const range = document.createRange();
        range.selectNodeContents(a);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0);
        const box = a.getBoundingClientRect();
        return { lines: lines.length, left: Math.min(...lines.map((r) => r.left)) - box.left, right: box.right - Math.max(...lines.map((r) => r.right)), overflow: a.scrollWidth - a.clientWidth };
      });
      console.log(`[site] ${at}: header ${row.header}px, filled link ${f.x}..${f.x + f.width} (${f.width}x${f.height}), Menu ${m.x}..${m.x + m.width} (${m.height}), label lines ${label.lines}, label inset ${label.left.toFixed(1)}/${label.right.toFixed(1)}`);
      expect(label.lines, `the filled link's label wraps on ${at}`).toBe(1);
      expect(Math.min(label.left, label.right), `the filled link's label is cut on ${at}`).toBeGreaterThanOrEqual(0);
      expect(label.overflow, `the filled link's label overflows on ${at}`).toBeLessThanOrEqual(0);
      // The wordmark is for screen readers only here; the logo link keeps its name.
      await expect(header.getByRole("link", { name: /ProcuLink/ }).first(), `logo link named on ${at}`).toBeVisible();
    }
  });

  test("the sheet traps focus, closes with Escape, gives focus back, and marks the current page", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/how-it-works");
    const menu = page.getByRole("banner").getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "How it works" })).toHaveAttribute("aria-current", "page");
    await expect(sheet.getByRole("link", { name: "Pricing" })).not.toHaveAttribute("aria-current", "page");
    const inSheet = () => page.evaluate(() => !!document.activeElement?.closest("#marketing-mobile-menu"));
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press(key);
        expect(await inSheet(), `${key} #${i + 1} left the sheet`).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeFocused();
  });

  test("the share image is a 1200 by 630 PNG at the same address, and How it works passes axe", async ({ page, request }) => {
    const res = await request.get("/og-image.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    const png = await res.body();
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

    await preparePage(page, { dismissCookieBanner: true });
    await page.goto("/");
    await expect(page).toHaveTitle(SITE_TITLE);
    expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBe(SITE_TITLE);
    for (const path of ["/", "/how-it-works"]) {
      await page.goto(path);
      for (const tag of ['meta[property="og:image"]', 'meta[name="twitter:image"]'])
        expect(await page.locator(tag).getAttribute("content"), `${tag} on ${path}`).toBe(`${SITE_URL}/og-image.png`);
    }

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/how-it-works");
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.length}`), `axe on /how-it-works at ${width}`).toEqual([]);
    }
  });

  test("every public route renders with one header, one footer, one h1 and no console error", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url()}: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
    for (const path of ["/pricing", "/formats", "/security", "/help", "/help/flows", "/privacy"]) {
      await page.goto(path);
      await expect(page.getByRole("banner"), `header on ${path}`).toHaveCount(1);
      await expect(page.getByRole("contentinfo"), `footer on ${path}`).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 }), `h1 on ${path}`).toHaveCount(1);
    }
    // /sign-in sits outside the site layout (its own auth shell): it must not pick
    // up the site header or footer, and still has one h1.
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1 }), "h1 on /sign-in").toHaveCount(1);
    await expect(page.getByRole("banner"), "no site header on /sign-in").toHaveCount(0);
    await expect(page.getByRole("contentinfo"), "no site footer on /sign-in").toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
});
