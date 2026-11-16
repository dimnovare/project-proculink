import { test, expect, type Locator, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";
import { MOCK_ENGINE_IDS, mockEngineFetch } from "../../src/lib/api/mockEngine";
import type { Flow } from "../../src/lib/api/documents";
import { FLOW_STEPS, flowAddress, type FlowStep, type FlowView } from "../../src/lib/flowSteps";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "../../src/lib/deliveryMode";
import { fromSimple } from "../../src/lib/flowOutputModel";
import type { FlowOutput } from "../../src/lib/api/documents";

/**
 * The flow page in a browser: the four steps in the address, changes and the bar that puts them in use, and nothing
 * put in use (or sent) that was not saved and pressed for.
 *
 * The mock engine answers inside the page, so there is no request to intercept. Its browser-spec hook
 * (`window.__mockEngine`, see mockEngineFetch) logs every call with its body and lets a test give the server's
 * answer for one "METHOD /path": a refusal, or the flow as the server would hold it.
 */

const ID = MOCK_ENGINE_IDS.flow;
const title = (id: FlowStep) => FLOW_STEPS.find((s) => s.id === id)!.title;
const at = (view: FlowView | null, output?: string) => flowAddress(ID, view, output ? { output } : undefined);
/** flow-1 as the mock server holds it: in use at version 1, with changes waiting. */
const fixture = () => mockEngineFetch<Flow>(`/flows/${ID}`);

/** The mock's out-1 is an Advanced-built template (not a column list), so We send shows no columns for it. The
 *  column steps need the same output as the column editor saves it: two columns, one with a lookup. */
const simpleOutputs = async (): Promise<Answers> => {
  const [o] = await mockEngineFetch<FlowOutput[]>(`/flows/${ID}/outputs`);
  const template = fromSimple({
    fields: [{ name: "Invoice", source: { field: "invoice_no" } }],
    table: { key: "lines", columns: [{ name: "Item", source: { field: "item_code" }, lookup: { id: MOCK_ENGINE_IDS.lookup, ifMissing: "keep" } }] },
  }, "csv");
  return { [`GET /flows/${ID}/outputs`]: [{ ...o, template }] };
};

type Answers = Record<string, unknown>;
/** Before the first page script: the call log, the given answers (kept across a reload in sessionStorage) and a
 *  test-only stretch of the mock's 120 ms answer delay, switched on with `window.__slowMock = true`. */
async function open(page: Page, width: number, url: string, answer: Answers = {}, height = 900) {
  await preparePage(page, { dismissCookieBanner: true });
  await page.addInitScript((given) => {
    const w = window as unknown as { __mockEngine: unknown; __slowMock?: boolean };
    let kept: Answers = {};
    try { kept = JSON.parse(sessionStorage.getItem("flow-spec-answer") ?? "{}"); } catch { /* none */ }
    w.__mockEngine = { calls: [], answer: { ...given, ...kept } };
    const st = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => st(fn, ms === 120 && w.__slowMock ? 1500 : ms, ...a)) as typeof window.setTimeout;
  }, answer);
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Flow");
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __mockEngine: { calls: string[] } }).__mockEngine.calls);
/** Calls that send something somewhere, or make a version live: none may happen without a labelled press. */
const SENDING = /^POST \/(documents\/[^/ ]+\/send|documents\/[^/ ]+\/outputs\/test|destinations\/[^/ ]+\/test|flows\/[^/ ]+\/intakes\/[^/ ]+\/test|flows\/[^/ ]+\/publish)\b/;
const sends = async (page: Page) => (await calls(page)).filter((c) => SENDING.test(c)).map((c) => c.split(" ").slice(0, 2).join(" "));
const PUBLISH = `POST /flows/${ID}/publish`;

/** The bar, by what it says: changes waiting, a setup never saved, or (after a press) its result. */
const bar = (page: Page) => page.getByRole("region", { name: /^(Changes not in use yet|Save this setup|Your changes)$/ });
const USE = "Use these changes";
/** The change reached the server: the last save of the values carries it (no line on the screen says "saved"). */
const savedFields = (page: Page, text: string) =>
  expect.poll(async () => (await calls(page)).filter((c) => c.startsWith(`PUT /flows/${ID}/fields`)).at(-1) ?? "").toContain(text);
const stepLink = (page: Page, step: FlowStep) => page.getByRole("navigation", { name: "Flow sections" }).getByRole("link", { name: title(step), exact: true });
const stay = (page: Page) => page.getByText(/^A change couldn't be saved, so you are still on this step\./);
const box = async (l: Locator) => (await l.boundingBox())!;

/** Buttons and links in the page's content with a dark fill. The AI style ("Suggest matches") is the one accepted
 *  exception: it is reported, and allowed, by name. */
const filledButtons = (page: Page) =>
  page.locator("#main-content").evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("a, button")]
      .filter((n) => n.getClientRects().length && !n.closest("[data-testid='tab-bar']"))
      .filter((n) => {
        const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const [r, g, b, a = 1] = m;
        return m.length >= 3 && a > 0.5 && (r + g + b) / 3 < 150;
      })
      .map((n) => (n.getAttribute("aria-label") ?? n.textContent ?? "").trim()));
const AI_EXCEPTION = "Suggest matches";
const filledOtherThanAi = async (page: Page) => (await filledButtons(page)).filter((t) => t !== AI_EXCEPTION);

test.describe("flow page", () => {
  test.describe.configure({ timeout: 120_000 });

  test("use: an edit on We read is saved as a change, Use these changes puts it in use once, and the page shows the server's state", async ({ page }) => {
    await open(page, 1440, at("read"));
    await expect(page.getByText("In use", { exact: true })).toBeVisible();
    await expect(bar(page)).toHaveAccessibleName("Changes not in use yet");
    await expect(bar(page)).toContainText("Your changes aren't in use yet.");
    await expect(bar(page)).toContainText("New documents still follow the last saved setup.");
    await expect(bar(page).getByRole("button", { name: "Undo my changes" })).toBeVisible();
    await page.getByRole("textbox", { name: "Name for Invoice number" }).fill("Invoice no.");
    await savedFields(page, '"label":"Invoice no."');
    expect(await sends(page), "an autosave sends nothing and puts nothing in use").toEqual([]);

    await bar(page).getByRole("button", { name: USE }).dblclick();
    await expect(bar(page)).toHaveAccessibleName("Your changes");
    await expect(bar(page)).toContainText("Your changes are in use.");
    await expect(page.getByText("In use", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: USE })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo my changes" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name for Invoice number" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name for Invoice no." })).toHaveValue("Invoice no.");
    const log = await calls(page);
    expect(await sends(page), "one press, one use").toEqual([PUBLISH]);
    expect(log.findLastIndex((c) => c.startsWith(`PUT /flows/${ID}/fields`)), "the change was saved before it was put in use").toBeLessThan(log.findIndex((c) => c.startsWith(PUBLISH)));
  });

  test("a blocked edit keeps the person on the step with its reason, and nothing is put in use", async ({ page }) => {
    await open(page, 1440, at("read"), await simpleOutputs());
    const name = page.getByRole("textbox", { name: "Name for Invoice number" });
    await name.fill("");
    await expect(page.getByRole("alert").filter({ hasText: "Give every value a name." })).toBeVisible();

    await bar(page).getByRole("button", { name: USE }).click();
    await expect(bar(page)).toContainText(`A change on ${title("read")} couldn't be saved, so nothing was put in use. Give every value a name.`);
    await expect(bar(page).getByRole("link", { name: `Go to ${title("read")}` })).toBeVisible();

    await stepLink(page, "send").click();
    await expect(stay(page)).toContainText("Give every value a name.");
    await expect(page).toHaveURL(new RegExp(`\\?tab=read$`));
    await page.getByRole("link", { name: "Back to Flows" }).click();
    await expect(page).toHaveURL(new RegExp(`/flows/${ID}\\?tab=read$`));
    await expect(stay(page)).toBeVisible();

    // The next save clears the notice.
    await page.getByRole("textbox", { name: "Name for", exact: true }).fill("Invoice number");
    await savedFields(page, '"label":"Invoice number"');
    await expect(stay(page)).toHaveCount(0);

    // Every value unticked.
    const ticks = page.locator("tbody").first().getByRole("checkbox", { name: /^Read / });
    for (const t of await ticks.all()) await t.uncheck();
    await page.getByRole("checkbox", { name: "Read the table Lines" }).uncheck();
    await expect(page.getByRole("alert").filter({ hasText: "Keep at least one value." })).toBeVisible();
    await bar(page).getByRole("button", { name: USE }).click();
    await expect(bar(page)).toContainText("Keep at least one value.");
    await stepLink(page, "check").click();
    await expect(stay(page)).toContainText("Keep at least one value.");
    await expect(page).toHaveURL(/\?tab=read$/);
    await page.getByRole("checkbox", { name: "Read Invoice number" }).check();
    await expect(stay(page)).toHaveCount(0);

    // We send: a column with no name, then "Make another file".
    await stepLink(page, "send").click();
    await expect(page).toHaveURL(/\?tab=send$/);
    await page.getByRole("button", { name: "Change the columns" }).click();
    const column = page.getByRole("textbox", { name: "Column name, Invoice" });
    await column.fill("");
    await expect(page.getByText("Give every column a name.").first()).toBeVisible();
    // The problem holds the column editor open, so there is no Done to press.
    await expect(page.getByRole("button", { name: "Done with the columns" })).toHaveCount(0);
    await page.getByRole("button", { name: "Make another file" }).click();
    await expect(stay(page)).toContainText("Give every column a name.");
    await expect(page).toHaveURL(/\?tab=send$/);
    await expect(page.getByRole("button", { name: "Make another file" })).toHaveAttribute("aria-expanded", "false");
    await bar(page).getByRole("button", { name: USE }).click();
    await expect(bar(page)).toContainText(`A change on ${title("send")} couldn't be saved, so nothing was put in use. Give every column a name.`);
    await page.getByLabel(/^Column name, /).first().fill("Invoice");
    await expect(stay(page)).toHaveCount(0);
    expect(await sends(page), "nothing was put in use").toEqual([]);
  });

  test("Undo my changes asks, greys the step while it runs, and brings the values in use back", async ({ page }) => {
    await open(page, 1440, at("read"));
    await page.getByRole("textbox", { name: "Name for Invoice number" }).fill("Number typed");
    await savedFields(page, '"label":"Number typed"');
    await bar(page).getByRole("button", { name: "Undo my changes" }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog).toContainText("The flow goes back to the setup in use. This can't be undone.");
    // The mock does not remember a restore; from here the server holds version 1 with nothing waiting.
    const restored = { ...(await fixture()), hasChanges: false };
    await page.evaluate((f) => {
      const w = window as unknown as { __slowMock: boolean; __mockEngine: { answer: Record<string, unknown> } };
      w.__mockEngine.answer[`GET /flows/${f.id}`] = f;
      w.__slowMock = true;
    }, restored);
    await dialog.getByRole("button", { name: "Undo my changes" }).click();
    await expect(page.locator("fieldset[disabled]")).toHaveCount(1);
    await expect(bar(page)).toContainText("Your changes are undone.", { timeout: 20_000 });
    await expect(bar(page)).toHaveAccessibleName("Your changes");
    await page.evaluate(() => { (window as unknown as { __slowMock: boolean }).__slowMock = false; });
    await expect(page.locator("fieldset[disabled]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name for Invoice number" })).toHaveValue("Invoice number");
    await expect(page.getByRole("textbox", { name: "Name for Number typed" })).toHaveCount(0);
    expect(await calls(page)).toContainEqual(expect.stringMatching(new RegExp(`^POST /flows/${ID}/versions/1/restore`)));
    expect(await sends(page)).toEqual([]);
  });

  test("Send it now is not offered after a passed test while the flow has changes not in use, and is with none", async ({ page }) => {
    await open(page, 1440, at("send"));
    const test1 = page.getByRole("button", { name: "Send a test" });
    await expect(test1).toBeEnabled();
    await test1.click();
    await expect(page.getByText(/^Test file arrived at /)).toBeVisible();
    await page.waitForTimeout(1000);   // the waiting-documents question would have been asked and answered by now
    await expect(page.getByTestId("destination-waiting")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send it now" })).toHaveCount(0);
    expect(await sends(page), "one press, one test").toEqual([expect.stringMatching(/^POST \/documents\/[^/]+\/outputs\/test$/)]);

    const published = { ...(await fixture()), hasChanges: false };
    await page.close();
    const p2 = await page.context().newPage();
    await open(p2, 1440, at("send"), { [`GET /flows/${ID}`]: published });
    await expect(bar(p2)).toHaveCount(0);
    await p2.getByRole("button", { name: "Send a test" }).click();
    const band = p2.getByTestId("destination-waiting");
    await expect(band.getByRole("button", { name: "Send it now" })).toBeVisible();
    expect((await sends(p2)).filter((c) => c.endsWith("/send")), "offered, not sent").toEqual([]);
    await band.getByRole("button", { name: "Send it now" }).click();
    await expect(band.getByRole("button", { name: "Send it now" })).toHaveCount(0);
    expect((await sends(p2)).filter((c) => c.endsWith("/send")), "one press, one send").toHaveLength(1);
  });

  test("a flow whose setup was never saved offers Save this setup only, and its edits are in use straight away", async ({ page }) => {
    const never = { ...(await fixture()), publishedVersion: null, hasChanges: false };
    await open(page, 1440, at("read"), { [`GET /flows/${ID}`]: never, ...(await simpleOutputs()) });
    await expect(bar(page)).toHaveAccessibleName("Save this setup");
    await expect(bar(page)).toContainText("Changes to this flow are in use straight away until you save this setup.");
    await expect(bar(page).getByRole("button", { name: "Save this setup", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: USE })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo my changes" })).toHaveCount(0);
    await expect(page.getByText("In use", { exact: true }), "never saved: the header does not claim it is in use").toHaveCount(0);
    await page.getByRole("textbox", { name: "Name for Invoice number" }).fill("Invoice no.");
    await savedFields(page, '"label":"Invoice no."');
    await expect(page.getByText("aren't in use yet", { exact: false })).toHaveCount(0);
    await stepLink(page, "send").click();
    await page.getByRole("button", { name: "Change the columns" }).click();
    await page.getByLabel("Column name, Invoice").fill("Invoice no.");
    await expect.poll(async () => (await calls(page)).filter((c) => c.startsWith(`PUT /flows/${ID}/outputs/`)).at(-1) ?? "").toContain('"Invoice no."');
    await expect(page.getByText("not in use yet", { exact: false })).toHaveCount(0);
    expect(await sends(page)).toEqual([]);
  });

  test("every old tab name lands on its step, an unknown output opens the first, and reload, Back and Forward keep the step", async ({ page }) => {
    const OLD: [string, string][] = [["fields", title("read")], ["outputs", title("send")], ["intake", title("arrives")], ["versions", "History"], ["documents", "Documents"]];
    await open(page, 1440, at(null));
    for (const [tab, lands] of OLD) {
      await page.goto(`/flows/${ID}?tab=${tab}`);
      await expect(page.getByRole("navigation", { name: "Flow sections" }).locator("[aria-current='page']"), `?tab=${tab}`).toHaveAccessibleName(new RegExp(`^${lands}`));
    }
    await page.goto(at("send", "no-such-output"));
    await expect(page.getByRole("region", { name: "Edit the file Invoice CSV" }).or(page.locator("section[aria-label='Edit the file Invoice CSV']"))).toBeVisible();

    // The brief's walk: step switches replace the address; the back link leaves for /flows.
    await page.goto(at(null));
    const before = await page.evaluate(() => history.length);
    await stepLink(page, "read").click();
    await expect(page).toHaveURL(/\?tab=read$/);
    await stepLink(page, "send").click();
    await expect(page).toHaveURL(/\?tab=send$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
    await page.reload();
    await expect(stepLink(page, "send")).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Back to Flows" }).click();
    await expect(page).toHaveURL(/\/flows$/);
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=send$/);
    await expect(stepLink(page, "send")).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(/\/flows$/);
    await page.goBack();
    await expect(stepLink(page, "send")).toHaveAttribute("aria-current", "page");
    expect(await sends(page)).toEqual([]);
  });

  test("the delivery choice on You check saves at once, survives a reload, and a refusal puts it back", async ({ page }) => {
    await open(page, 1440, at("check"));
    const auto = page.getByRole("radio", { name: AUTOMATIC_DELIVERY_LABEL });
    await auto.click();
    await expect(auto).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    const patch = (await calls(page)).filter((c) => c.startsWith(`PATCH /flows/${ID} `));
    expect(patch).toEqual([`PATCH /flows/${ID} {"automation":"auto"}`]);
    await stepLink(page, "arrives").click();
    await stepLink(page, "check").click();
    await expect(page.getByRole("radio", { name: AUTOMATIC_DELIVERY_LABEL })).toBeChecked();
    // The mock forgets on reload; the server would not. Give the reloaded page what the server holds after that PATCH.
    const held = { ...(await fixture()), ...JSON.parse(patch[0].slice(patch[0].indexOf(" {") + 1)) };
    await page.evaluate((a) => sessionStorage.setItem("flow-spec-answer", JSON.stringify(a)), { [`GET /flows/${ID}`]: held });
    await page.reload();
    await expect(page.getByRole("radio", { name: AUTOMATIC_DELIVERY_LABEL })).toBeChecked();
    await expect(page.getByRole("link", { name: new RegExp(`^${title("check")}`) }).first()).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem("flow-spec-answer"));

    // A refusal (403) says why under the radios and shows the choice the server still holds.
    const p2 = await page.context().newPage();
    await open(p2, 1440, at("check"), { [`PATCH /flows/${ID}`]: { refuse: [403, "forbidden"] } });
    await p2.getByRole("radio", { name: AUTOMATIC_DELIVERY_LABEL }).click();   // click, not check(): the refusal puts it back
    await expect(p2.getByRole("alert").first()).toBeVisible();
    await expect(p2.getByRole("radio", { name: REVIEW_BEFORE_DELIVERY_LABEL })).toBeChecked();
    expect(await sends(p2)).toEqual([]);
  });

  test("at 390 the changes bar sits above the tab bar, clear of the Add button, and Add a document is a button", async ({ page }) => {
    await open(page, 390, at("read"), {}, 844);
    await expect(bar(page)).toBeVisible();
    const tab = page.getByTestId("tab-bar");
    const add = tab.getByRole("button", { name: "Add a document" });
    await expect(add).toBeVisible();
    const [b, t, a, p] = [await box(bar(page)), await box(tab), await box(add), await box(page.getByRole("button", { name: USE }))];
    expect(b.y + b.height).toBeLessThanOrEqual(t.y + 0.5);
    // The round button's ring (4px) is drawn outside its box, and is what a person sees.
    const ring = 4;
    const overlap = !(p.x + p.width <= a.x - ring || a.x + a.width + ring <= p.x || p.y + p.height <= a.y - ring || a.y + a.height + ring <= p.y);
    expect(b.y + b.height, "the whole bar clears the raised Add button").toBeLessThanOrEqual(a.y - ring + 0.5);
    expect(overlap, `Use these changes overlaps the Add button: ${JSON.stringify({ bar: b, tabBar: t, add: a, publish: p })}`).toBe(false);
  });

  const WIDTHS = [1440, 1024, 768, 390, 360] as const;
  const VIEWS = ["arrives", "read", "check", "send", "documents"] as const;

  test("at every width, on the four steps and Documents: one filled button, text 12.5px or more, nothing wider than the screen, 44px targets on a phone, and nothing sent", async ({ page }) => {
    test.setTimeout(400_000);
    await open(page, 1440, at(null), await simpleOutputs());
    const report: string[] = [];
    for (const width of WIDTHS) {
      for (const view of VIEWS) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        // Reloaded per width: Chromium does not recompute the shell's `h-dvh` on an emulated resize.
        await page.goto(at(view));
        await settle(page, 400);
        if (view === "send") await expect(page.getByRole("button", { name: "Send a test" })).toBeVisible();
        if (view === "arrives") await page.getByText("For developers").click();
        if (view === "send") await page.getByText("More options: file type, when to send, separator, lookups").click();
        const where = `${view} at ${width}`;
        const m = await page.evaluate(() => {
          const main = document.querySelector("#main-content")!;
          const sizes: [number, string][] = [];
          const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const p = n.parentElement!;
            if (!n.textContent?.trim() || !p.getClientRects().length || p.closest("[aria-hidden='true'], .sr-only")) continue;
            sizes.push([parseFloat(getComputedStyle(p).fontSize), n.textContent.trim().slice(0, 40)]);
          }
          sizes.sort((x, y) => x[0] - y[0]);
          const table = main.querySelector("table")?.parentElement;
          // Element boxes, not the document's scrollWidth (the shell clips): a box past the screen that no scroller holds.
          const held = (e: Element) => { for (let p = e.parentElement; p && p !== main; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true; return false; };
          const wide = [...main.querySelectorAll("*")].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5) && !held(e);
          }).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
          return {
            wide,
            pageScroll: document.documentElement.scrollWidth - window.innerWidth,
            mainScroll: main.scrollWidth - main.clientWidth,
            smallest: sizes[0],
            tableScroll: table ? table.scrollWidth - table.clientWidth : null,
          };
        });
        expect(m.wide, `boxes past the screen: ${where}`).toEqual([]);
        expect(m.pageScroll, `page wider than the screen: ${where}`).toBeLessThanOrEqual(0);
        expect(m.mainScroll, `content wider than the screen: ${where}`).toBeLessThanOrEqual(0);
        expect(m.smallest[0], `smallest text "${m.smallest[1]}": ${where}`).toBeGreaterThanOrEqual(12.5);
        const filled = await filledOtherThanAi(page);
        expect(filled, `filled buttons: ${where}`).toEqual(view === "documents" ? [expect.stringMatching(/^Review next/)] : [USE]);   // Documents has no bar: its own main action
        let barLine = "no bar";
        if (view !== "documents") {
          const b = await box(bar(page));
          barLine = `bar y ${b.y.toFixed(0)}..${(b.y + b.height).toFixed(0)} x ${b.x.toFixed(0)}..${(b.x + b.width).toFixed(0)} of ${width}`;
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
          const vh = page.viewportSize()!.height;
          if (width < 768) {
            const t = await box(page.getByTestId("tab-bar"));
            barLine += `, tab bar top ${t.y.toFixed(0)}`;
            expect(b.y + b.height, `the bar sits above the tab bar: ${where}`).toBeLessThanOrEqual(t.y + 0.5);
          } else expect(b.y + b.height).toBeLessThanOrEqual(vh + 0.5);
          // Hides nothing: scrolled to the end, the step's last box ends above the bar.
          const end = await page.evaluate(async () => {
            const main = document.querySelector("#main-content")!;
            const fs0 = main.querySelector("fieldset")!;
            for (let s: Element | null = fs0; s; s = s.parentElement) if (s.scrollHeight > s.clientHeight + 1) s.scrollTop = s.scrollHeight;
            document.scrollingElement!.scrollTop = document.scrollingElement!.scrollHeight;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const fs = main.querySelector("fieldset")!;
            const last = [...fs.querySelectorAll("*")].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom);
            return Math.max(...last);
          });
          const b2 = await box(bar(page));
          barLine += `, step ends ${end.toFixed(0)} bar top ${b2.y.toFixed(0)}`;
          expect(end, `the bar covers the end of the step: ${where}`).toBeLessThanOrEqual(b2.y + 0.5);
        }
        if (width <= 390) {
          const targets: Locator[] = [page.getByRole("button", { name: "Rename this flow" })];
          if (view === "arrives") targets.push(page.locator("summary", { hasText: "For developers" }));
          if (view === "send") targets.push(page.locator("summary", { hasText: "More options" }));
          if (view === "read") targets.push(page.getByRole("checkbox", { name: "Read Invoice number" }).locator(".."));
          for (const t of targets) {
            const h = await box(t);
            expect(Math.min(h.height, h.width), `tap target ${await t.textContent()} ${where}`).toBeGreaterThanOrEqual(44);
          }
        }
        report.push(`${where}: smallest ${m.smallest[0]}px "${m.smallest[1]}"; page overflow ${m.pageScroll}; table scrolls ${m.tableScroll}; ${barLine}; filled ${JSON.stringify(await filledButtons(page))}`);
      }
      // The phone's step cards (no step chosen).
      if (width <= 390) {
        await page.goto(at(null));
        const cards = page.getByRole("navigation", { name: "The four steps of this flow" }).getByRole("link");
        await expect(cards).toHaveCount(4);
        for (const c of await cards.all()) expect((await box(c)).height, `step card at ${width}`).toBeGreaterThanOrEqual(44);
        report.push(`step cards at ${width}: ${(await Promise.all((await cards.all()).map(async (c) => (await box(c)).height.toFixed(0)))).join(" ")}`);
      }
    }
    test.info().annotations.push({ type: "measurements", description: report.join("\n") });
    console.log(report.join("\n"));
    expect(await sends(page), "nothing was sent on the walk").toEqual([]);
  });

  test("We send: with a Google destination open, Disconnect is outlined and the changes bar stays the one filled button", async ({ page }) => {
    const google = { available: true, accounts: [{ id: "account-1", provider: "google", email: "sheets@example.test", status: "reconnect", createdAt: "2026-05-20T09:00:00Z" }] };
    await open(page, 1440, at("send"), { "GET /linked-accounts": google });
    await expect(page.getByRole("combobox", { name: "Send to" })).toHaveCount(0);
    await page.getByRole("button", { name: "Change where it goes" }).click();
    await page.getByRole("combobox", { name: "Send to" }).selectOption({ label: "New destination…" });
    await page.getByRole("combobox", { name: "Send by" }).selectOption({ label: "Google Sheets" });
    await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText(/^Disconnect this Google account\?/)).toBeVisible();
    expect(await filledOtherThanAi(page)).toEqual([USE]);
    expect(await sends(page)).toEqual([]);
  });

  test("We send at 1440: Send to and Send a test are in the first screenful, the columns wait behind Change the columns, and the list counts the changes", async ({ page }) => {
    await open(page, 1440, at("send", MOCK_ENGINE_IDS.output), await simpleOutputs(), 900);
    const editor = page.getByRole("region", { name: "Edit the file Invoice CSV" });
    const sendTo = editor.getByRole("heading", { name: "Send to", exact: true });
    const test1 = editor.getByRole("button", { name: "Send a test" });
    for (const l of [sendTo, test1]) {
      const b = await box(l);
      expect(b.y, `${await l.textContent()} starts in the first screenful`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${await l.textContent()} ends in the first screenful`).toBeLessThanOrEqual(900);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop), "nothing was scrolled to get there").toBe(0);
    await expect(page.getByRole("textbox", { name: /^Column name, / })).toHaveCount(0);
    await editor.getByRole("button", { name: "Change the columns" }).click();
    await expect(page.getByRole("textbox", { name: "Column name, Invoice" })).toBeVisible();
    await editor.getByRole("button", { name: "Done with the columns" }).click();
    await expect(page.getByRole("textbox", { name: /^Column name, / })).toHaveCount(0);
    await expect(editor.getByText("More options: file type, when to send, separator, lookups")).toBeVisible();
    expect(await sends(page)).toEqual([]);
  });

  test("the mock's first file says it has changes not in use yet", async ({ page }) => {
    await open(page, 1440, at("send"));
    await expect(page.getByRole("link", { name: /^Invoice CSV/ })).toContainText("2 changes not in use yet");
  });

  test("Make another file opens a ready panel, and Create shows the new file with its heading focused and the list marking it", async ({ page }) => {
    await open(page, 1440, at("send"));
    await page.getByRole("button", { name: "Make another file" }).click();
    await expect(page.getByRole("heading", { name: "Make another file", level: 2 })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    for (const way of ["Match a sample file", "A standard format"]) await expect(page.getByRole("button", { name: way, exact: true })).toBeVisible();
    // Outlined while the bar is drawn: the bar keeps the one filled button.
    expect(await filledOtherThanAi(page)).toEqual([USE]);
    const name = await page.getByLabel("Name", { exact: true }).inputValue();
    // The mock echoes its first file for a create; the server answers the new one, and lists it after.
    const [first] = await mockEngineFetch<FlowOutput[]>(`/flows/${ID}/outputs`);
    const made = { ...first, id: "out-new", name, destinationId: null };
    await page.evaluate(([id, m, list]) => {
      const answer = (window as unknown as { __mockEngine: { answer: Record<string, unknown> } }).__mockEngine.answer;
      answer[`POST /flows/${id}/outputs`] = m;
      answer[`GET /flows/${id}/outputs`] = list;
    }, [ID, made, [first, made]] as const);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/[?&]output=out-new\b/);
    const editor = page.getByRole("region", { name: `Edit the file ${name}` });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("heading", { name, level: 2 })).toBeFocused();
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /^Invoice CSV/ })).not.toHaveAttribute("aria-current", "page");
    expect((await calls(page)).filter((c) => c.startsWith(`POST /flows/${ID}/outputs `)), "one press, one file").toHaveLength(1);
  });

  test("Create is the one filled button when the flow has no bar", async ({ page }) => {
    const inUse = { ...(await fixture()), hasChanges: false };
    await open(page, 1440, at("send"), { [`GET /flows/${ID}`]: inUse });
    await expect(bar(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Make another file" }).click();
    await expect(page.getByRole("button", { name: "Create", exact: true })).toBeVisible();
    expect(await filledOtherThanAi(page)).toEqual(["Create"]);
  });
});

test.describe("flow page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.describe.configure({ timeout: 120_000 });

  test("We send at 390: Send to and Send a test come before the preview, and no control is under 44px", async ({ page }) => {
    await open(page, 390, at("send", MOCK_ENGINE_IDS.output), await simpleOutputs(), 844);
    const editor = page.getByRole("region", { name: "Edit the file Invoice CSV" });
    await expect(editor.getByRole("button", { name: "Send a test" })).toBeVisible();
    const order = await editor.evaluate((el) => {
      const find = (sel: string, text: string) => [...el.querySelectorAll<HTMLElement>(sel)].find((n) => n.textContent?.trim() === text)!;
      const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const preview = find("h3", "What the file looks like");
      return { sendTo: before(find("h3", "Send to"), preview), test: before(find("button", "Send a test"), preview) };
    });
    expect(order, "Send to and Send a test come before the preview").toEqual({ sendTo: true, test: true });
    const small = await editor.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("a, button, input, select, textarea, summary")]
        .filter((n) => n.getClientRects().length && !(n instanceof HTMLInputElement && n.type === "hidden"))
        // A checkbox or radio is measured by the label it sits in: that is what a finger presses.
        .map((n) => (n instanceof HTMLInputElement && /checkbox|radio/.test(n.type) && n.closest("label") ? n.closest("label")! : n))
        .map((n) => ({ r: n.getBoundingClientRect(), what: `${n.tagName.toLowerCase()} "${(n.getAttribute("aria-label") ?? n.textContent ?? "").trim().slice(0, 30)}"` }))
        .filter(({ r }) => Math.min(r.width, r.height) < 44)
        .map(({ r, what }) => `${what} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`));
    expect(small, "controls under 44px on a phone").toEqual([]);
  });
});
