import { test, expect, type Browser, type Page } from "@playwright/test";
import { preparePage, settle } from "./a11yHarness";
import { MOCK_DELIVERY_ERROR, MOCK_SAMPLE_FILE } from "../../src/lib/api/mockWorkspace";
import { destinationNameFor, foundSummary, suggestFlowName } from "../../src/lib/firstRun";
import { documentStatus } from "../../src/lib/documentStatusManifest";
import { limitRefusalCopy, readLimitRefusal } from "../../src/lib/limitRefusal";
import { PLAN_BY_ID } from "../../src/lib/plans";
import { checkModeLine, checkModeTitle } from "../../src/lib/deliveryMode";

/**
 * The first run in a browser (plan 14.5): Welcome on Documents, then /flows/new as three steps, on a desk and on a
 * phone. The empty-workspace mock answers inside the page, so what was sent is read from its own stored state.
 */

const WIDTHS = [1440, 768, 390, 360] as const;
const PHONE = 640; // below this the global phone rule makes every control 44px tall
const STATE = "proculink.mock.state";
const SEND_BUTTON = /^Send .* now$/; // the button that sends to a destination (Finish with Download also sends, to Documents)
const FOLD = /^A server or another system/;
/** The server kinds sit behind one press: open the fold, then pick SFTP or FTPS. */
const pickServer = async (page: Page) => {
  await page.getByRole("button", { name: FOLD }).click();
  await page.getByTestId("send-tile-server").click();
};
/** At 1440: the common places as tiles, then the fold below them; one press shows the three server kinds, focus on the first. */
async function serverFold(page: Page) {
  const group = page.getByRole("radiogroup", { name: "Where should the file go?" });
  const ids = () => group.getByRole("radio").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-testid")));
  const common = ["send-tile-download", "send-tile-email", "send-tile-google_drive", "send-tile-google_sheets"];
  expect(await ids(), "the common places, in order, and no server kind yet").toEqual(common);
  const fold = page.getByRole("button", { name: FOLD });
  const [g, f] = [(await group.boundingBox())!, (await fold.boundingBox())!];
  expect(f.y, "the fold sits below the tiles").toBeGreaterThanOrEqual(g.y + g.height - 0.5);
  await fold.click();
  // Replaced in place by its three kinds, in one row.
  await expect(fold).toHaveCount(0);
  expect(await ids()).toEqual([...common, "send-tile-server", "send-tile-s3", "send-tile-http"]);
  await expect(page.getByTestId("send-tile-server")).toBeFocused();
  const tops = await Promise.all(["server", "s3", "http"].map(async (t) => Math.round((await page.getByTestId(`send-tile-${t}`).boundingBox())!.y)));
  expect(new Set(tops).size, "the three server kinds share one row").toBe(1);
}
const DOWNLOAD_LINE ="Press Finish and we make your first file. You will find it in Documents, ready to download.";
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% invented test file\n") });

type MockState = {
  flows: { id: string; name: string; publishedVersion: number | null; automation: string }[];
  docs: { id: string; flowId: string; fileName: string; status: string; read: { kindLabel: string | null; fields: { key: string; confidence: number }[]; tables: unknown[] } | null }[];
  outputs: { flowId: string; destinationId: string | null }[];
  destinations: { id: string; name: string }[];
  deliveries: Record<string, unknown[]>;
};

/** An empty workspace for this tab, with the mock's own switches, set before the first byte of page script. */
async function newWorkspace(page: Page, switches: Record<string, string> = {}) {
  await preparePage(page, { dismissCookieBanner: true });
  await page.addInitScript((s) => {
    sessionStorage.setItem("proculink.mock.workspace", "new");
    for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, v);
  }, switches);
}
const mockState = (page: Page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), STATE) as Promise<MockState | null>;
/** Every send the mock recorded (a test of a destination is not one). */
const sends = async (page: Page) => Object.values((await mockState(page))?.deliveries ?? {}).flat().length;
const flowIdOf = (page: Page) => new URL(page.url()).searchParams.get("flow")!;
const docIdOf = (page: Page) => new URL(page.url()).searchParams.get("doc")!;

/** What the house rules measure, inside main: filled buttons, text under 12.5px, boxes past the screen, short controls. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const main = document.querySelector("main")!;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
    };
    const scrolls = (el: Element) => {
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const name = (el: Element) => `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    const out = { filled: [] as string[], small: [] as string[], wide: [] as string[], short: [] as string[], smallest: 99 };
    for (const el of [main, ...main.querySelectorAll("*")].filter(shown)) {
      const r = el.getBoundingClientRect();
      if (!scrolls(el) && (r.left < -0.5 || r.right > W + 0.5)) out.wide.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`);
      const s = getComputedStyle(el);
      if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) {
        out.smallest = Math.min(out.smallest, parseFloat(s.fontSize));
        if (parseFloat(s.fontSize) < 12.5) out.small.push(`${name(el)} ${s.fontSize}`);
      }
      const tag = el.tagName.toLowerCase();
      // A "Keep" checkbox's target is its label, so the label is measured both ways.
      const keep = tag === "label" && !!el.querySelector("input[type=checkbox][aria-label^=Keep]");
      const target = tag === "button" || (tag === "a" && el.hasAttribute("href")) || el.getAttribute("role") === "tab" || keep;
      if (target && !(tag === "a" && s.display === "inline") && (r.height < 43.5 || (keep && r.width < 43.5)))
        out.short.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}px`);
      const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const opaque = bg.length === 3 || (bg.length === 4 && bg[3] === 1);
      if (tag === "button" && opaque && s.color === "rgb(255, 255, 255)" && bg.slice(0, 3).some((v) => v < 200)) out.filled.push((el.textContent ?? "").trim());
    }
    return out;
  });
}

/** At each width: exactly the filled buttons named, no text under 12.5px, nothing past the screen, 44px targets on a phone. */
async function atEveryWidth(page: Page, where: string, filled: string[]) {
  const seen: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < PHONE ? 844 : 900 });
    await page.waitForTimeout(250);
    const m = await measure(page);
    seen.push(`${width}: filled ${JSON.stringify(m.filled)}, smallest ${m.smallest}px, short ${m.short.length}${width < PHONE ? "" : ` (desk, not a rule: ${m.short.slice(0, 3).join(", ")})`}`);
    expect(m.filled, `${where} at ${width}: one filled button`).toEqual(filled);
    expect(m.small, `${where} at ${width}: no text under 12.5px`).toEqual([]);
    expect(m.wide, `${where} at ${width}: nothing wider than the screen`).toEqual([]);
    if (width < PHONE) expect(m.short, `${where} at ${width}: 44px targets`).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  test.info().annotations.push({ type: "measure", description: `${where} — ${seen.join("; ")}` });
}

/** The Finish bar's box, whether it says "Loading…", and where the content above it starts. */
async function finishBar(page: Page) {
  return page.getByRole("region", { name: "Finish", exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const mode = [...document.querySelectorAll("legend")].find((l) => l.textContent === "Which documents wait for you");
    const done = document.querySelector("section[aria-label='Finished steps']");
    return {
      loading: (el.textContent ?? "").includes("Loading…"), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      modeTop: mode ? Math.round(mode.getBoundingClientRect().top) : null, finishedHeight: done ? Math.round(done.getBoundingClientRect().height) : null,
      text: (el.textContent ?? "").slice(0, 60), viewport: window.innerHeight,
    };
  });
}

/** Catch the bar while it says "Loading…" (it is brief), then once it has settled: what moved. */
async function loadingShift(page: Page, where: string) {
  const bar = page.getByRole("region", { name: "Finish", exact: true });
  await bar.waitFor();
  const first = await finishBar(page);
  await expect(bar.getByText("Loading…")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
  const settled = await finishBar(page);
  // The bar is the last thing in the step: growing from its "Loading…" line never moves what is above it.
  if (first.loading) // rounded boxes: 1px either way is rounding, not a move
    expect(Math.abs(settled.modeTop! - settled.finishedHeight! - (first.modeTop! - first.finishedHeight!)), `${where}: only the finished-steps card above the Finish bar may grow`).toBeLessThanOrEqual(1);
  test.info().annotations.push({ type: "measure", description: `${where} Finish bar: first ${JSON.stringify(first)}, settled ${JSON.stringify(settled)}` });
  return settled;
}

/** Upload one file from Welcome and arrive on step 2 with what we read on screen. */
async function uploadAndCheck(page: Page, file: string) {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type=file][aria-label="Choose a file"]').setInputFiles(pdf(file));
  await expect(page).toHaveURL(/\/flows\/new\?step=check&flow=[^&]+&doc=[^&]+$/, { timeout: 30_000 });
}

test.describe("First run", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a desk walks from Documents to a downloaded file, and a reload keeps each step", async ({ page }) => {
    await newWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documents");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
    await page.getByRole("button", { name: "Use our sample invoice" }).click();
    await expect(page).toHaveURL(/\/flows\/new\?step=check&flow=[^&]+&doc=[^&]+$/, { timeout: 30_000 });
    await expect(page.getByText(`Reading ${MOCK_SAMPLE_FILE}… This usually takes under a minute.`)).toBeVisible();
    const read = page.locator("#review-pane-read");
    const doc = (await mockState(page))!.docs[0];
    await expect.poll(async () => (await mockState(page))!.docs[0].read?.fields.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    const summary = foundSummary((await mockState(page))!.docs[0].read! as never);
    await expect(read.getByText(summary, { exact: true })).toBeVisible({ timeout: 15_000 });
    // The original and what we read, side by side, both on screen.
    const [left, right] = [await page.locator("#review-pane-original").boundingBox(), await read.boundingBox()];
    expect(left!.x + left!.width, "the original sits left of the values").toBeLessThanOrEqual(right!.x + 1);
    expect(left!.y, "both start on screen").toBeLessThan(900);
    expect(right!.y).toBeLessThan(900);
    const url = page.url();
    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(read.getByText(summary, { exact: true })).toBeVisible({ timeout: 15_000 });
    const unsure = (await mockState(page))!.docs[0].read!.fields.find((f) => f.confidence < 0.75)!;
    await expect(page.getByTestId(`check-value-${unsure.key}`).getByText(`Check this one. We are ${Math.round(unsure.confidence * 100)}% sure of it.`)).toBeVisible();
    await atEveryWidth(page, "step 2, our sample", ["Looks right, next"]);
    expect(await sends(page), "nothing is sent on step 2").toBe(0);

    await page.getByRole("button", { name: "Looks right, next" }).click();
    await expect(page).toHaveURL(/step=send/);
    await page.reload();
    await expect(page).toHaveURL(/step=send/);
    await loadingShift(page, "1440, our sample, after a reload:");
    const finish = page.getByRole("region", { name: "Finish", exact: true });
    await expect(page.getByTestId("send-tile-download")).toHaveAttribute("aria-checked", "true");
    await expect(finish.getByText(/^This is our sample invoice, so we never send it\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: SEND_BUTTON })).toHaveCount(0);
    await atEveryWidth(page, "step 3, our sample", ["Finish"]);
    // With a destination form open, Finish is still the one filled button and nothing can send.
    await pickServer(page);
    await expect(page.getByText(`We'll save this destination as ${destinationNameFor("sftp", suggestFlowName("Invoice")!)}.`)).toBeVisible();
    await expect(page.getByRole("button", { name: SEND_BUTTON })).toHaveCount(0);
    await atEveryWidth(page, "step 3, our sample with a destination form open", ["Finish"]);
    await page.getByTestId("send-tile-download").click();

    const download = page.waitForEvent("download");
    await finish.getByRole("button", { name: "Download the sample's CSV file" }).click();
    expect((await download).suggestedFilename()).toBe(MOCK_SAMPLE_FILE.replace(/\.pdf$/, ".csv"));
    await expect(page).toHaveURL(/step=send/);
    expect(await sends(page), "downloading the sample's file sends nothing").toBe(0);

    const flowId = flowIdOf(page);
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/flows/${flowId}$`), { timeout: 30_000 });
    expect(await sends(page), "Finish on our sample sends nothing").toBe(0);
    // Back from the flow page: the flow is set up, and nothing offers to send.
    await page.goBack();
    await expect(page.getByText("This flow is set up.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Open the flow" })).toHaveAttribute("href", `/flows/${flowId}`);
    await expect(page.getByRole("button", { name: /^(Send|Finish)/ })).toHaveCount(0);
    expect(await sends(page)).toBe(0);
    expect((await mockState(page))!.docs.find((d) => d.id === doc.id)!.status, "our sample is never sent").not.toBe("sent");
  });

  test("Google appears only when the server offers it, and a new server must pass its test before sending", async ({ page, browser }) => {
    await newWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await uploadAndCheck(page, "delivery-note.pdf");
    const kind = await expect.poll(async () => (await mockState(page))!.docs[0].read?.kindLabel ?? null, { timeout: 15_000 }).not.toBeNull()
      .then(async () => (await mockState(page))!.docs[0].read!.kindLabel!);
    const flowName = suggestFlowName(kind)!;
    await expect(page.getByLabel("Flow name")).toHaveValue(flowName);
    // A phone's "Keep" checkbox and the step's actions are 44px targets; one filled button on step 2.
    await atEveryWidth(page, "step 2, an uploaded file", ["Looks right, next"]);
    await page.getByRole("button", { name: "Looks right, next" }).click();
    await expect(page).toHaveURL(/step=send/);
    const finish = page.getByRole("region", { name: "Finish", exact: true });
    await expect(finish.getByText(DOWNLOAD_LINE)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("radio", { name: /^Google Drive/ })).toHaveCount(0);
    await atEveryWidth(page, "step 3, Download", ["Finish"]);

    await pickServer(page);
    const server = destinationNameFor("sftp", flowName);
    await expect(page.getByText(`We'll save this destination as ${server}.`)).toBeVisible();
    const send = finish.getByRole("button", { name: "Send delivery-note.pdf now" });
    await expect(send).toBeDisabled();
    await atEveryWidth(page, "step 3, a new server not yet tested", ["Save and send a test"]);
    await page.getByLabel("Server", { exact: true }).fill("sftp.example.test");
    await page.getByLabel("Username").fill("robot");
    await page.getByLabel("Password", { exact: true }).fill("invented");
    await page.getByRole("button", { name: "Save and send a test" }).click();
    await expect(page.getByText(/^Test file arrived/)).toBeVisible({ timeout: 15_000 });
    await expect(send).toBeEnabled();
    await atEveryWidth(page, "step 3, a server that passed its test", [`Send delivery-note.pdf now`]);
    expect(await sends(page), "a destination test is not a send").toBe(0);
    // The sentence follows the delivery choice; changing it sends nothing.
    const later = (when: string) => finish.getByText(`From now on, documents in this flow go to ${server}. ${when}`);
    await expect(later(checkModeLine("marked", false))).toBeVisible();   // an admin's new flow starts here
    await page.getByRole("radio", { name: new RegExp(`^${checkModeTitle("auto")}`) }).click();
    await expect(later(checkModeLine("auto", false))).toBeVisible();
    await page.getByRole("radio", { name: new RegExp(`^${checkModeTitle("review")}`) }).click();
    await expect(later(checkModeLine("review", false))).toBeVisible();
    expect(await sends(page), "nothing is sent without a press").toBe(0);

    const flowId = flowIdOf(page);
    await send.click();
    await expect(page).toHaveURL(new RegExp(`/flows/${flowId}$`), { timeout: 30_000 });
    expect(await sends(page), "one press, one send").toBe(1);
    await page.goBack();
    await expect(page.getByText("This flow is set up.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: SEND_BUTTON })).toHaveCount(0);
    expect(await sends(page)).toBe(1);

    await googleAndAFailedTest(browser);
  });

  test("Download: Finish makes the file through the workspace mock and moves on; a delivery that fails keeps the step and says why", async ({ page, browser }) => {
    for (const fails of [false, true]) {
      const p = fails ? await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage() : page;
      await newWorkspace(p, fails ? { "proculink.mock.deliveryFails": "on" } : {});
      await p.setViewportSize({ width: 1440, height: 900 });
      await uploadAndCheck(p, "delivery-note.pdf");
      await expect(p.getByRole("button", { name: "Looks right, next" })).toBeVisible({ timeout: 15_000 });
      await p.getByRole("button", { name: "Looks right, next" }).click();
      await expect(p).toHaveURL(/step=send/);
      const finish = p.getByRole("region", { name: "Finish", exact: true });
      await expect(finish.getByText(DOWNLOAD_LINE)).toBeVisible({ timeout: 15_000 });
      await expect(p.getByTestId("send-tile-download")).toHaveAttribute("aria-checked", "true");
      const flowId = flowIdOf(p);
      const docId = docIdOf(p);
      await finish.getByRole("button", { name: "Finish", exact: true }).click();
      if (!fails) {
        await expect(p).toHaveURL(new RegExp(`/flows/new\\?step=ready&flow=${flowId}&doc=${docId}$`), { timeout: 30_000 });
        await expect(p.getByRole("heading", { level: 1, name: "Your first file is ready" })).toBeVisible();
        const after = (await mockState(p))!;
        expect(after.deliveries[docId], "one file, stored to download").toEqual([expect.objectContaining({ status: "stored" })]);
        expect(after.docs.find((d) => d.id === docId)!.status).toBe("sent");
      } else {
        await expect(finish.getByText(MOCK_DELIVERY_ERROR)).toBeVisible({ timeout: 15_000 });
        await expect(p).toHaveURL(/step=send/);
        expect((await mockState(p))!.deliveries[docId], "the one send was made, and failed").toEqual([expect.objectContaining({ status: "dead_letter" })]);
        await p.context().close();
      }
    }
  });

  test("on a phone: the welcome, a refusal with a way on, and nothing under the tab bar", async ({ page }) => {
    await newWorkspace(page, { "proculink.mock.refuse": "pilot_expired" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documents");
    await settle(page);
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(main.getByRole("button", { name: "Take a photo" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Choose a file" })).toBeVisible();
    const bar = page.getByTestId("tab-bar");
    // With no flow yet, the round Add is the link to Upload.
    await expect(bar.getByRole("link", { name: "Add a document" })).toBeVisible();
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      const line = (await page.getByTestId("welcome-sample").boundingBox())!;
      const tabTop = (await bar.boundingBox())!.y;
      const mainX = (await main.boundingBox())!.x;
      expect(line.y + line.height, `the sample line ends above the round Add at ${width}`).toBeLessThanOrEqual(tabTop - 15);
      expect(Math.abs(line.x - mainX), `the sample line is left-aligned at ${width}`).toBeLessThanOrEqual(24);
      const m = await measure(page);
      expect(m.short, `44px targets at ${width}`).toEqual([]);
      expect(m.wide, `nothing wider than the screen at ${width}`).toEqual([]);
      expect(m.small, `no text under 12.5px at ${width}`).toEqual([]);
      test.info().annotations.push({ type: "measure", description: `welcome ${width}: filled ${JSON.stringify(m.filled)}, smallest ${m.smallest}px, sample line bottom ${Math.round(line.y + line.height)} vs tab bar ${Math.round(tabTop)}` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const before = page.url();
    await main.getByRole("button", { name: "Use our sample invoice" }).click();
    const copy = limitRefusalCopy(readLimitRefusal({ error: "pilot_expired", plan: PLAN_BY_ID.pilot.id, limit: PLAN_BY_ID.pilot.orderLimit, upgradeUrl: "/settings" }));
    const sample = page.getByTestId("welcome-sample");
    await expect(sample.getByRole("alert").or(sample.getByRole("status")).first()).toContainText(copy.title);
    await expect(sample).toContainText(copy.message);
    await expect(sample.getByRole("link", { name: copy.cta })).toBeVisible();
    expect(page.url(), "a refusal stays where it was").toBe(before);
    // The refused start left a flow, so the round Add now opens the sheet.
    await expect(bar.getByRole("button", { name: "Add a document" })).toBeVisible({ timeout: 15_000 });
    await page.goto("/flows/new");
    await expect(page.getByRole("link", { name: "Back to Flows" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tab-bar")).toBeHidden();
    expect(await sends(page)).toBe(0);
  });

  test("a document that could not be read is only finished, never offered a send", async ({ page }) => {
    await newWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadAndCheck(page, "delivery-note.pdf");
    await expect(page.getByRole("button", { name: "Looks right, next" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Looks right, next" }).click();
    await expect(page).toHaveURL(/step=send/);
    const flowId = flowIdOf(page);
    // Another file in the same flow, which we cannot read.
    await page.getByRole("link", { name: "Use another file" }).click();
    await page.locator('input[type=file][aria-label="Choose a file"]').setInputFiles(pdf("unreadable-scan.pdf"));
    await expect(page).toHaveURL(new RegExp(`step=check&flow=${flowId}&doc=`), { timeout: 30_000 });
    const docId = docIdOf(page);
    await expect.poll(async () => (await mockState(page))!.docs.find((d) => d.id === docId)?.status, { timeout: 15_000 }).toBe("read_failed");
    expect((await mockState(page))!.flows, "another file stays in the run's flow").toHaveLength(1);
    await page.goto(`/flows/new?step=send&flow=${flowId}&doc=${docId}`);
    const settled = await loadingShift(page, "390, a document we could not read:");
    const finish = page.getByRole("region", { name: "Finish", exact: true });
    await expect(finish.getByText(`unreadable-scan.pdf: ${documentStatus("read_failed").label}.`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: SEND_BUTTON })).toHaveCount(0);
    // Nothing was read, so the finished steps claim no values.
    await expect(page.getByRole("region", { name: "Finished steps" })).not.toContainText(/was read:|0 values/);
    // No tab bar on /flows/new, so the sticky Finish bar is the bottom of the phone screen.
    await expect(page.getByTestId("tab-bar")).toBeHidden();
    expect(settled.bottom, "the Finish bar sits inside the screen").toBeLessThanOrEqual(844);
    await atEveryWidth(page, "step 3, a document we could not read", ["Finish"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await finish.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/flows/${flowId}$`), { timeout: 30_000 });
    expect(await sends(page), "nothing was sent").toBe(0);
  });
});

/** Second context: the server offers Google, and a new destination whose test fails is saved but left unattached. */
async function googleAndAFailedTest(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await newWorkspace(page, { "proculink.mock.google": "on" });
  // The mock's test always arrives; the way to make the server's test fail is for the destination to be gone when it
  // runs. Armed, this hides the destination just saved from the one read that follows its save (the test's).
  await page.addInitScript((key) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    let armed = -1;
    let hide = false;
    (window as unknown as { armTestFailure(): void }).armTestFailure = () => {
      armed = (JSON.parse(get.call(sessionStorage, key) ?? "{}").destinations ?? []).length;
    };
    Storage.prototype.setItem = function (k: string, v: string) {
      set.call(this, k, v);
      if (k === key && armed >= 0 && JSON.parse(v).destinations.length > armed) { armed = -1; hide = true; }
    };
    Storage.prototype.getItem = function (k: string) {
      const v = get.call(this, k);
      if (k !== key || !hide || v === null) return v;
      hide = false;
      return JSON.stringify({ ...JSON.parse(v), destinations: [] });
    };
  }, STATE);
  await uploadAndCheck(page, "delivery-note.pdf");
  await expect(page.getByRole("button", { name: "Looks right, next" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Looks right, next" }).click();
  await expect(page).toHaveURL(/step=send/);
  const finish = page.getByRole("region", { name: "Finish", exact: true });
  await expect(finish.getByText(DOWNLOAD_LINE)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("radio", { name: /^Google Drive/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Google Sheets/ })).toBeVisible();
  await serverFold(page);

  await pickServer(page);
  const flow = (await mockState(page))!.flows[0];
  const server = destinationNameFor("sftp", flow.name);
  await page.getByLabel("Server", { exact: true }).fill("sftp.example.test");
  await page.getByLabel("Username").fill("robot");
  await page.getByLabel("Password", { exact: true }).fill("invented");
  await page.evaluate(() => (window as unknown as { armTestFailure(): void }).armTestFailure());
  await page.getByRole("button", { name: "Save and send a test" }).click();
  await expect(finish.getByText(`${server} did not pass its test, so it is saved but not used yet. You can fix it on the flow page.`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^Test file arrived/)).toHaveCount(0);
  await expect(finish.getByText(/^From now on/)).toHaveCount(0);
  await expect(finish.getByRole("button", { name: "Send delivery-note.pdf now" })).toBeDisabled();
  await finish.getByRole("button", { name: "Finish without sending" }).click();
  await expect(page).toHaveURL(new RegExp(`/flows/${flow.id}$`), { timeout: 30_000 });
  const after = (await mockState(page))!;
  expect(after.destinations.map((d) => d.name), "the destination is saved").toEqual([server]);
  expect(after.outputs.filter((o) => o.flowId === flow.id).map((o) => o.destinationId), "but not attached").toEqual([null]);
  expect(after.flows[0].publishedVersion, "the flow is finished").not.toBeNull();
  expect(Object.values(after.deliveries).flat(), "nothing was sent").toHaveLength(0);
  await context.close();
}
