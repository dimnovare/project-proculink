import { test, expect, type Page } from "@playwright/test";
import { MOCK_ENGINE_IDS, mockEngineFetch } from "../../src/lib/api/mockEngine";
import type { Flow } from "../../src/lib/api/documents";
import { COPY } from "../../src/lib/documentRefusals";
import { flowAddress } from "../../src/lib/flowSteps";
import { preparePage, settle } from "./a11yHarness";

/**
 * Everything on the screen a person could see, measured in the page: boxes AND text line edges
 * (a box-only check has passed with a real overflow before), against the viewport and against the
 * card each one sits in; stand-alone links and buttons under 44px tall; text under 12.5px; and the
 * filled buttons (white words on a solid colour). Scoped to <main>, which holds the phone action bar.
 */
const audit = (page: Page) =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const main = document.getElementById("main-content")!;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const cardOf = (el: Element | null) => el?.closest<HTMLElement>('[style*="background: var(--surface)"]') ?? null;
    const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`;
    const out: string[] = [];
    const past = (what: string, r: DOMRect, card: HTMLElement | null) => {
      if (r.right > vw + 0.5 || r.left < -0.5) out.push(`${what} runs to ${r.left.toFixed(1)}..${r.right.toFixed(1)} in a ${vw}px screen`);
      const c = card?.getBoundingClientRect();
      if (c && (r.right > c.right + 0.5 || r.left < c.left - 0.5)) out.push(`${what} runs to ${r.right.toFixed(1)} past its card's ${c.right.toFixed(1)}`);
    };
    let right = 0;
    const els = [...main.querySelectorAll("*")].filter(shown);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      right = Math.max(right, r.right);
      past(name(el), r, cardOf(el.parentElement));
    }
    const small: string[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const parent = t.parentElement!;
      if (!t.textContent!.trim() || !shown(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const line of range.getClientRects()) {
        right = Math.max(right, line.right);
        past(`text "${t.textContent!.trim().slice(0, 40)}"`, line, cardOf(parent));
      }
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 12.5 && !parent.closest(".sr-only")) small.push(`"${t.textContent!.trim().slice(0, 40)}" at ${size}px`);
    }
    for (const el of els.filter((e) => e.matches("input:not([type=file])")))
      if (parseFloat(getComputedStyle(el).fontSize) < 12.5) small.push(`${name(el)} at ${getComputedStyle(el).fontSize}`);
    const controls = els.filter((e) => e.matches("a[href], button") && !e.closest("p"));
    const short = controls.filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => `${name(e)} is ${e.getBoundingClientRect().height}px tall`);
    const filled = controls.filter((e) => {
      const s = getComputedStyle(e);
      return s.color === "rgb(255, 255, 255)" && /^rgb\(/.test(s.backgroundColor);
    }).map(name);
    return { overflow: out, small, short, filled, right };
  });

test.describe("lookups", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a table imported from a file is saved at once, and Undo takes it back", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/lookups");
    await expect(page.getByText("Choose a lookup to see its rows.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import a table" })).toBeVisible();         // the header waits for the engine switch
    // Import a table is outlined: the one filled button is the top bar's Upload, outside the content.
    expect((await audit(page)).filled, "no filled button in the content of the list").toEqual([]);
    await expect(page.getByRole("link", { name: "Upload a document" })).toBeVisible();
    await page.getByTestId("import-table-input").setInputFiles({
      name: "supplier-codes.csv", mimeType: "text/csv", buffer: Buffer.from("Code,Ours\nKS-100,NT-GASKET-10\nKS-214,NT-VALVE-B\n"),
    });
    await expect(page).toHaveURL(/\/lookups\/lookup-new-\d+$/);
    await expect(page.getByText("supplier-codes.csv imported. 2 rows saved as a new lookup, named after the file.")).toBeVisible();
    const list = page.getByRole("navigation", { name: "All lookups" });
    await expect(list.getByRole("link", { name: /supplier-codes/ })).toContainText("New");
    await expect(page.getByRole("heading", { name: "supplier-codes" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page).toHaveURL(/\/lookups$/);
    await expect(page.getByText("Import undone. supplier-codes was deleted.")).toBeVisible();
    await expect(list.getByRole("link", { name: /supplier-codes/ })).toHaveCount(0);
  });

  test("a change saves by itself and is still there after opening another lookup; a lookup in use cannot be deleted", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/lookups/${MOCK_ENGINE_IDS.lookup}`);
    await expect(page.getByText("Used by Supplier invoices.", { exact: true })).toBeVisible();   // the list's line says it too
    await expect(page.getByText("Rows 1 to 50 of 120")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import a table" })).toBeVisible();
    expect((await audit(page)).filled, "no filled button in the content of a lookup").toEqual([]);
    await expect(page.getByRole("link", { name: "Upload a document" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Rows 51 to 100 of 120")).toBeVisible();
    await page.getByLabel("Search rows").fill("SKU-77");
    const to = page.getByLabel("To value for ITEM-1077");
    await to.fill("SKU-77-NEW");
    await to.press("Tab");
    await expect(page.getByText("Saved, edits save as you type")).toBeVisible();
    const list = page.getByRole("navigation", { name: "All lookups" });
    await list.getByRole("link", { name: /Country codes/ }).click();
    await expect(page.getByRole("heading", { name: "Country codes" })).toBeVisible();
    await list.getByRole("link", { name: /Item codes/ }).click();
    await expect(page.getByRole("heading", { name: "Item codes" })).toBeVisible();          // else the search lands in the screen being left
    await page.getByLabel("Search rows").fill("SKU-77-NEW");
    await expect(page.getByLabel("To value for ITEM-1077")).toHaveValue("SKU-77-NEW");
    await page.getByRole("button", { name: "Delete lookup" }).click();
    await page.getByRole("button", { name: "Delete lookup" }).click();
    await expect(page.getByText(COPY.lookup_in_use)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/lookups/${MOCK_ENGINE_IDS.lookup}$`));
  });

  test("a lookup no file uses says how to use it, with a link to each flow's We send step", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/lookups/lookup-4");
    await expect(page.getByText(
      "Not used yet. To use it, open a flow, go to We send, open a file, choose More options and pick this lookup for a column.", { exact: true },
    )).toBeVisible();
    const flows = await mockEngineFetch<Flow[]>("/flows");
    const links = page.getByRole("list", { name: "Your flows" }).getByRole("link");
    await expect(links).toHaveCount(flows.length);
    for (const f of flows) await expect(links.and(page.getByRole("link", { name: f.name, exact: true }))).toHaveAttribute("href", flowAddress(f.id, "send"));
  });

  test("on a phone the list and a lookup are separate screens, Import sits above the tab bar, nothing runs off the side", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lookups");
    await settle(page);
    const bar = page.getByTestId("action-bar");
    await expect(bar.getByRole("button", { name: "Import a table" })).toBeVisible();
    const [a, t] = [(await bar.boundingBox())!, (await page.getByTestId("tab-bar").boundingBox())!];
    console.log(`action bar ${a.y}..${a.y + a.height}, tab bar top ${t.y}`);
    expect(Math.abs(a.y + a.height - t.y)).toBeLessThanOrEqual(1);
    await expect(page.getByText("Choose a lookup to see its rows.")).toBeHidden();
    await page.getByRole("navigation", { name: "All lookups" }).getByRole("link", { name: /Pallet types/ }).click();
    await expect(page).toHaveURL(/\/lookups\/lookup-4$/);
    await expect(page.getByRole("navigation", { name: "All lookups" })).toBeHidden();
    await expect(page.getByRole("link", { name: "All lookups" })).toBeVisible();
    await expect(page.getByText("No rows yet. Add a row, or replace from a file.")).toBeVisible();
    const search = (await page.getByLabel("Search rows").evaluate((el) => [el.getBoundingClientRect().height, getComputedStyle(el).fontSize]));
    console.log(`search ${search[0]}px tall, ${search[1]}`);
    expect(search[0]).toBeGreaterThanOrEqual(44);
    expect(search[1]).toBe("16px");
    const right = await page.locator("main").evaluate((m) => Math.max(...[...m.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right)));
    console.log(`largest right edge in main ${right}`);
    expect(right).toBeLessThanOrEqual(391);

    // A lookup with rows: a row's input is a phone-sized field.
    await page.getByRole("link", { name: "All lookups" }).click();
    await page.getByRole("navigation", { name: "All lookups" }).getByRole("link", { name: /Item codes/ }).click();
    const cell = page.getByLabel("To value for A-100");
    const row = await cell.evaluate((el) => [el.getBoundingClientRect().height, getComputedStyle(el).fontSize]);
    console.log(`row input ${row[0]}px tall, ${row[1]}`);
    expect(row[0]).toBeGreaterThanOrEqual(44);
    expect(row[1]).toBe("16px");

    // Each screen at 390 and 360, reloaded after the resize (Chromium keeps the shell's h-dvh otherwise).
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of ["/lookups", "/lookups/lookup-4", `/lookups/${MOCK_ENGINE_IDS.lookup}`]) {
        await page.goto(path);
        await settle(page, 300);
        await expect(bar.getByRole("button", { name: "Import a table" })).toBeVisible();
        await expect(path === "/lookups" ? page.getByText("4 lookups") : page.getByLabel("Search rows")).toBeVisible();
        const seen = await audit(page);
        console.log(`${path} at ${width}: right edge ${seen.right.toFixed(1)}, filled ${seen.filled.length}`);
        expect(seen.overflow, `nothing past the screen or its card on ${path} at ${width}`).toEqual([]);
        expect(seen.short, `stand-alone controls 44px tall on ${path} at ${width}`).toEqual([]);
        expect(seen.small, `no text under 12.5px on ${path} at ${width}`).toEqual([]);
        expect(seen.filled, `Import a table is outlined on ${path} at ${width}`).toEqual([]);
      }
    }
  });
});
