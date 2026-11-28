import { test, expect, type Locator, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";
import { audit } from "./layoutAudit";

/**
 * One way in: documents are added with no flow to choose, the machine sorts each one, and a document still in the
 * workspace's inbox is answered on its review screen (Set it up / Excel, CSV / Move it) instead of being sent.
 *
 * The mock engine answers inside the page. Its browser-spec hook (`window.__mockEngine`, see mockEngineFetch) logs
 * every call, so "nothing was sent" is read from the log. The inbox states (doc-in-1 … doc-in-7) are seeded only when
 * sessionStorage "proculink.mock.inbox" is "on" before the first page script; the mock's state lives for one page
 * load, so a check after an action navigates inside the app, never with a fresh `goto`.
 */

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
const inboxDoc = (id: string) => `/flows/flow-inbox/documents/${id}`;
const box = async (l: Locator) => (await l.boundingBox())!;

async function open(page: Page, width: number, url: string, { inbox = true, height = 900 } = {}) {
  await preparePage(page, { dismissCookieBanner: true });
  await page.addInitScript((on) => {
    (window as unknown as { __mockEngine: unknown }).__mockEngine = { calls: [] };
    if (on) sessionStorage.setItem("proculink.mock.inbox", "on");
    sessionStorage.setItem("proculink.mock.plan", "growth"); // room for another flow, so Set it up is offered
  }, inbox);
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await settle(page);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __mockEngine: { calls: string[] } }).__mockEngine.calls);
const sends = async (page: Page) => (await calls(page)).filter((c) => /^POST \/documents\/[^/ ]+\/send\b/.test(c)).map((c) => c.split(" ").slice(0, 2).join(" "));
const answersOf = (page: Page) => page.getByRole("region", { name: "What to do with it" });
/** Nothing in the page shell scrolls sideways (the app shell is h-dvh overflow-hidden, so the page itself never does). */
const sideways = (page: Page) =>
  page.locator("#main-content").evaluate((el) => Math.max(...[el, ...el.children].map((e) => e.scrollWidth - e.clientWidth)));

test.describe("one way in", () => {
  test.describe.configure({ timeout: 120_000 });
  // The review screen and /flows/new are the heaviest dev compiles; under parallel local load a cold one outlasted the
  // whole-test timeout mid-click. Compile them once up front, and give single steps room of their own.
  test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });
  test.beforeAll(async ({ playwright }, info) => {
    test.setTimeout(300_000); // a hook gets the 30 s default, not the describe's 120 s
    const request = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
    for (const url of ["/documents", inboxDoc("doc-in-1"), "/flows/new"]) await request.get(url, { timeout: 90_000 });
    await request.dispose();
  });

  test("Add documents at 1440 and 390: no flow question, one filled button, and a new kind says so", async ({ page }) => {
    await preparePage(page, { dismissCookieBanner: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/upload");
      const zone = page.getByRole("region", { name: "Add files" });
      await expect(zone.getByRole("button", { name: "Choose files" })).toBeVisible();
      await expect(page.getByRole("radio"), `no flow to pick at ${width}`).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Which flow is this for?" })).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("They go to");
      const before = await audit(page.locator("main"));
      if (width < 768) expect(before, `Add documents at ${width}`).toEqual({ outside: [], small: [], short: [], filled: 1 });
      else expect(before.filled, `one filled button at ${width}`).toBe(1);
      await zone.evaluate((el) => {
        const dt = new DataTransfer();
        dt.items.add(new File(["%PDF-1.4"], "statement-0412.pdf", { type: "application/pdf" }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      const row = page.getByRole("region", { name: "Just added" }).getByRole("listitem").filter({ hasText: "statement-0412.pdf" });
      await expect(row).toContainText("First of its kind", { timeout: 15_000 });
      await expect(row).toContainText("A statement from Example Bank Ltd. The first of its kind here.");
      await expect(row).toContainText("Review");
      await expect(row.getByRole("button", { name: /^Send/ })).toHaveCount(0);
      await expect(row.getByRole("link", { name: "statement-0412.pdf" })).toHaveAttribute("href", /^\/flows\/flow-inbox\/documents\//);
    }
  });

  test("at 1440 and 1920, a new kind is answered on one screen, and a set-up flow continues where it goes", async ({ page }) => {
    await open(page, 1440, "/documents");
    await expect(page.getByTestId("topbar-nav").getByRole("link")).toHaveText(["Documents", "Flows", "Settings"]);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole("table").getByRole("link", { name: "statement-0412.pdf" }).click();
    await expect(page).toHaveURL(/\/flows\/flow-inbox\/documents\/doc-in-1$/, { timeout: 30_000 });
    const answers = answersOf(page);
    await expect(answers.getByRole("heading", { name: "This is the first statement here." })).toBeVisible({ timeout: 30_000 });
    const waiting = page.getByRole("complementary", { name: "Documents that need you" });
    const listed = waiting.getByRole("listitem").filter({ hasText: "statement-0412.pdf" });
    await expect(listed).toContainText("A statement from Example Bank Ltd");
    await expect(listed).toContainText("First of its kind");

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(waiting).toBeHidden();
    const [o, a] = [await box(page.getByRole("region", { name: "Original", exact: true })), await box(answers)];
    expect(a.x, "the answers sit right of the original").toBeGreaterThanOrEqual(o.x + o.width);
    // Dense desktop heights are the design from 640px up (BUTTON_SIZE), so only the phone test holds every control to 44px.
    const m = await audit(page.locator("main"));
    expect({ outside: m.outside, small: m.small, filled: m.filled }).toEqual({ outside: [], small: [], filled: 1 });

    await answers.getByRole("button", { name: "Set it up" }).click();
    await expect(page).toHaveURL(/\/flows\/new\?step=send&flow=flow-set-up-\d+&doc=doc-in-1$/, { timeout: 30_000 });
    await expect(page.getByText("Step 3 of 3. Choose where the file goes.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("radiogroup", { name: "Where should the file go?" })).toBeVisible();
    expect(await sends(page), "setting it up sends nothing").toEqual([]);
  });

  test("an inbox document has no Send, Skip or What we'll send, Ctrl Enter does nothing, and CSV downloads just this one", async ({ page }) => {
    await open(page, 1440, inboxDoc("doc-in-1"));
    const answers = answersOf(page);
    await expect(answers.getByRole("button", { name: "Set it up" })).toBeVisible();
    await expect(answers.getByRole("button", { name: "Download what we read as Excel" })).toBeVisible();
    await expect(answers.getByRole("button", { name: "Download what we read as CSV" })).toBeVisible();
    await expect(answers.getByRole("combobox", { name: "Handle it like" })).toBeVisible();
    await expect(answers.getByRole("button", { name: "Move it" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "What we'll send" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "What we'll send" })).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\/documents\/doc-in-1$/);
    expect(await sends(page), "Ctrl Enter sends nothing from the inbox").toEqual([]);

    const download = page.waitForEvent("download");
    await answers.getByRole("button", { name: "Download what we read as CSV" }).click();
    expect((await download).suggestedFilename()).toBe("statement-0412.csv");
    await expect(answers).toContainText("You downloaded what we read. Nothing was set up or sent.");
    await expect(answers.getByRole("button", { name: "Set it up" })).toHaveCount(0);
    expect(await sends(page)).toEqual([]);

    await page.getByRole("link", { name: "Back to Documents" }).click();               // inside the app: the mock keeps the download
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(page.getByRole("table").getByRole("row", { name: /statement-0412\.pdf/ })).toContainText("Downloaded");
  });

  test("on a phone at 390, the answers come before the values, every button is 44px or more, and Move it waits for a choice", async ({ page }) => {
    await open(page, 390, inboxDoc("doc-in-2"), { height: 844 });
    const answers = answersOf(page);
    await expect(answers.getByRole("heading", { name: "Which flow does this invoice belong with?" })).toBeVisible();
    const a = await box(answers);
    expect(a.y + a.height, "the answers are above the tabs").toBeLessThanOrEqual((await box(page.getByRole("tablist", { name: "Parts of this document" }))).y + 0.5);
    // Several flows fit: Move it is the first answer, and nothing is chosen for the person.
    const first = answers.getByRole("button").first();
    await expect(first).toHaveText("Move it");
    await expect(first).toBeDisabled();
    const list = answers.getByRole("combobox", { name: "Handle it like" });
    await expect(list).toHaveValue("");
    expect(await sideways(page), "nothing scrolls sideways at 390").toBeLessThanOrEqual(1);
    // Disabled, Move it is the quiet button (A-32): nothing is filled until a flow is chosen.
    expect(await audit(page.locator("main")), "the review at 390").toEqual({ outside: [], small: [], short: [], filled: 0 });
    await expect(page.getByTestId("action-bar").getByRole("button", { name: /Send/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);

    await list.selectOption({ label: "Supplier invoices" });
    await expect(first).toBeEnabled();
    // Polled: the button turns navy through a 150 ms transition-colors, so one read right after it enables can land mid-fade.
    await expect.poll(async () => (await audit(page.locator("main"))).filled, { message: "chosen, Move it is the one filled button" }).toBe(1);
    await first.click();
    await expect(page).toHaveURL(/\/flows\/flow-1\/documents\/doc-in-2$/);
    expect(await sends(page), "moving it sends nothing").toEqual([]);
  });

  test("a sort that is not certain is reviewed, not sent from its row, and the review screen up to 2240 keeps the notice on one line", async ({ page }) => {
    await open(page, 1440, "/upload", { inbox: false });
    await page.getByTestId("upload-files-input").setInputFiles(pdf("delivery-note-90.pdf"));
    const row = page.getByRole("region", { name: "Just added" }).getByRole("listitem").filter({ hasText: "delivery-note-90.pdf" });
    await expect(row).toContainText("Check where we put it", { timeout: 15_000 });
    await expect(row).toContainText("A delivery note from Example Freight Ltd");
    // Its way on is Review, never Send: the notice is on the review screen.
    await expect(row.getByText("Review", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Send/ })).toHaveCount(0);

    await page.setViewportSize({ width: 2240, height: 1200 });
    await row.getByRole("link", { name: "delivery-note-90.pdf" }).click();
    await expect(page).toHaveURL(/\/flows\/flow-2\/documents\/[^/]+$/);
    const words = page.getByText("We put this with Delivery notes. If that's right, carry on. If not, move it:");
    await expect(words).toBeVisible();
    const notice = words.locator("xpath=ancestor-or-self::*[@data-notice-tone][1]");
    await expect(notice.getByRole("combobox", { name: "Handle it like" })).toBeVisible();
    expect(await sends(page), "the notice shows before anything is pressed").toEqual([]);
    expect((await audit(notice)).outside, "the notice and its list fit in their card at 2240").toEqual([]);
    const lines = await words.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    });
    expect(lines, "the notice is one line at 2240").toBe(1);
    expect(await sends(page)).toEqual([]);
  });

  test("a sort that is not certain: Make the file is the filled button, and making it confirms it", async ({ page }) => {
    await open(page, 1440, "/flows/flow-2/documents/doc-in-3");
    await expect(page.getByText("We put this with Delivery notes. If that's right, carry on. If not, move it:")).toBeVisible();
    const header = page.getByTestId("review-header-actions");
    await expect(header).toContainText("Check where we put it");
    await expect(answersOf(page)).toHaveCount(0);
    // Another flow starts with nothing chosen, so Move it waits for a choice.
    await expect(page.getByRole("combobox", { name: "Handle it like" })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Move it" })).toBeDisabled();
    // Delivery notes has no destination, so its way on is Make the file, and the made file waits on this screen.
    const send = header.getByRole("button", { name: "Make the file" });
    await expect(send).toBeEnabled();
    await expect.poll(async () => (await audit(page.locator("main"))).filled, { message: "Make the file is the one filled button" }).toBe(1);
    await send.click();
    await expect(header.getByRole("button", { name: /^Download / })).toBeVisible();
    await expect(page).toHaveURL(/doc-in-3$/);
    expect(await sends(page)).toEqual(["POST /documents/doc-in-3/send"]);

    await page.getByTestId("topbar-nav").getByRole("link", { name: "Documents" }).click();
    await page.getByRole("tab", { name: /^All/ }).click();
    const sent = page.getByRole("table").getByRole("row", { name: /delivery-note-5521\.pdf/ });
    await expect(sent).toContainText("File ready");
    await expect(sent).not.toContainText("Check where we put it");
  });

  test("on a phone, a made file has one Download button, in a bar that is never empty", async ({ page }) => {
    await open(page, 390, "/flows/flow-2/documents/doc-in-3", { height: 844 });
    const bar = page.getByTestId("action-bar");
    await bar.getByRole("button", { name: "Make the file" }).click();
    await expect(page.getByRole("button", { name: /^Download / })).toHaveCount(1);
    await expect(bar.getByRole("button", { name: /^Download / })).toBeVisible();
    await expect(page).toHaveURL(/doc-in-3$/);
  });

  test("the answers keep to the values column from 1440 to 2240, the waiting list shows from 1700, and at 390 nothing is under 44px", async ({ page }) => {
    await open(page, 1440, inboxDoc("doc-in-1"));
    const answers = answersOf(page);
    await expect(answers.getByRole("button", { name: "Set it up" })).toBeVisible();
    const waiting = page.getByRole("complementary", { name: "Documents that need you" });
    for (const width of [1440, 1920, 2240]) {
      await page.setViewportSize({ width, height: 1000 });
      const [a, read] = [await box(answers), await box(page.getByRole("region", { name: "What we read" }))];
      expect(a.width, `the answers are no wider than the values at ${width}`).toBeLessThanOrEqual(read.width + 0.5);
      if (width >= 1700) await expect(waiting, `the waiting list at ${width}`).toBeVisible();
      else await expect(waiting, `no waiting list at ${width}`).toBeHidden();
      expect((await audit(answers)).outside, `the answers fit at ${width}`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(answers).toBeVisible();
    expect(await sideways(page), "nothing scrolls sideways at 390").toBeLessThanOrEqual(1);
    expect(await audit(answers), "the answers at 390").toEqual({ outside: [], small: [], short: [], filled: 1 });
  });
});
