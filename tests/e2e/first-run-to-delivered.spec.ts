import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * WP-27 — first run reaches a DELIVERED supplier-ready file.
 *
 * The packet's acceptance criterion: a brand-new account reaches a delivered file
 * without contacting a supplier. This journey drives exactly that:
 *
 *   /upload → "Try with a sample order" → give an address → practice order opens
 *           → match the one unresolved item code → Send → status: Delivered
 *
 * WHY THIS TEST IS NOT VACUOUS. Its final assertion used to be free:
 *
 *  1. `mockTransformOrder` wrote `delivered` directly after a 3s timer, skipping
 *     ready_to_deliver AND delivering — so ANY mock-mode assertion on "delivered"
 *     passed without a delivery ever being attempted. Transform now stops at
 *     ready_to_deliver, exactly where the real backend stops it, and only a dispatch
 *     (mockRedeliverOrder) can reach `delivered`.
 *  2. `mockRedeliverOrder` was an unconditional success. It now fails an order whose
 *     supplier has no delivery setup, with the backend's own wording. A practice
 *     order started WITHOUT an address gets no delivery setup — so if the CTA ever
 *     stopped passing the address through, this test goes red at the last assertion
 *     rather than sailing through a mock that hands out success.
 *
 * KNOWN MOCK CAVEATS (stated rather than papered over):
 *  • the mock store is per-page-load module state, so a practice order does not
 *    survive a reload. "The framing survives a bookmark / back button" is therefore
 *    pinned in the unit test (workshop/__tests__/practiceFraming.test.tsx), which can
 *    render the same order with and without the query parameter;
 *  • `mockUploadPurchaseOrder` still never returns `parsing` or `unrouted` and never
 *    throws 400/413/429. This journey does not touch the upload path, so it neither
 *    relies on nor claims anything about those.
 *
 * Runs in CI (mock mode) via `bun run test:e2e` — no backend required. Auth is the
 * PROCULINK_QA_BYPASS_AUTH bypass set by playwright.config.ts's webServer.
 */

const PRACTICE_ADDRESS = "coordinator@northgate.example";

/** The code the fixture's one unmapped line resolves to (it IS in the sample catalog). */
const SUPPLIER_CODE = "SMP-BRACKET-S";

/**
 * The first VISIBLE match, not the first match in document order.
 *
 * This app mounts both breakpoint trees at once — /inbox/[orderId] renders
 * `IssuesPanel` (desktop) and `MobileTriage` (mobile) together, and Tailwind hides
 * one with `lg:hidden` / `hidden lg:block`. Both carry a "supplier code" input.
 *
 * `.first()` therefore picks by DOM position, which means it picks the desktop
 * tree at every width. At 1280 that happens to be the visible one and the spec
 * passed; at 390 and 768 it resolved to an input that exists and is `hidden`, and
 * the journey timed out waiting for it to appear.
 *
 * This is the same trap the repo already documents for jsdom — both trees mount,
 * so an unscoped query silently reads the wrong one — rotated into Playwright,
 * where it is easier to miss because the run is "in a real browser" and feels
 * authoritative.
 */
function visible(locator: Locator): Locator {
  return locator.filter({ visible: true }).first();
}

/** The consent banner is fixed to the bottom and can intercept clicks on the review screen. */
async function dismissCookieBanner(page: Page) {
  const reject = page.getByRole("dialog", { name: /cookie consent/i }).getByRole("button", { name: /reject/i });
  // The `count()` guard already covers "no banner on this run". Beyond that, a click that
  // does not land is not a tolerable outcome: the banner stays fixed to the bottom and
  // intercepts the review-screen clicks below, so swallowing the failure here only moves it
  // somewhere less legible. Let it throw where it happened. (WP-02 — the empty `.catch` this
  // replaces was the one offender the vacuous-pass guard found in newly-merged code.)
  if (await reject.count()) await reject.click();
}

/** Opens the practice-order prompt on /upload. Retries the click through hydration. */
async function openPracticePrompt(page: Page) {
  await page.goto("/upload");
  await dismissCookieBanner(page);
  const cta = page.getByRole("button", { name: /try with a sample order/i });
  await expect(cta).toBeVisible({ timeout: 20_000 });

  // The click can land before `next dev` finishes hydrating the route, silently
  // dropping the React handler. Retry until the prompt actually opens.
  const addressField = page.getByLabel(/send the finished file to/i);
  await expect(async () => {
    await cta.click();
    await expect(addressField).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000, intervals: [500, 1000, 2000] });

  return addressField;
}

/** Starts a practice order with the given address and lands on its review screen. */
async function startPracticeOrder(page: Page, address: string) {
  const addressField = await openPracticePrompt(page);
  await addressField.fill(address);

  const run = page.getByRole("button", { name: /^run it$/i });
  await expect(run).toBeEnabled();
  await expect(async () => {
    await run.click();
    await page.waitForURL(/\/inbox\/[^/?]+/, { timeout: 8_000 });
  }).toPass({ timeout: 60_000, intervals: [500, 1000, 2000] });

  return page.url();
}

test("a brand-new account reaches a DELIVERED file without contacting a supplier", async ({ page }) => {
  // Cold `next dev` compiles /upload and /inbox/[orderId] on first navigation.
  test.setTimeout(240_000);

  // ── Screen 1 → the practice order ────────────────────────────────────────
  const url = await startPracticeOrder(page, PRACTICE_ADDRESS);

  // The practice framing is on, and it is NOT coming from the URL (WP-27).
  expect(url).not.toContain("sample=1");
  const banner = page.getByRole("note", { name: /practice order/i });
  await expect(banner).toBeVisible({ timeout: 60_000 });
  // Both apostrophes. WP-28's copy renders the typographic U+2019 (&rsquo;); the band
  // this note replaced used U+0027. `'?` makes the straight quote OPTIONAL, it does not
  // match a different codepoint — which is why this passed review twice and failed CI.
  await expect(banner).toContainText(/doesn['’]?t count against your plan/i);
  // The outcome is named BEFORE the send, so nothing about it is a surprise — and the
  // promise is conditional on the run actually having a delivery setup, which this one
  // does (an address was supplied). A deployment with no email provider gets the other
  // branch instead of a promise it cannot keep.
  await expect(banner).toContainText(/the finished file is emailed to you, never to a supplier/i);

  // ── The single manual rep the fixture exists to teach ─────────────────────
  // Exactly one line arrives unresolved (the fixture pre-maps the other two), so the
  // review screen offers exactly one "Enter code" action.
  await dismissCookieBanner(page);
  const enterCode = page.getByRole("button", { name: /^enter code$/i });
  await expect(visible(enterCode)).toBeVisible({ timeout: 60_000 });

  const codeInput = visible(page.getByPlaceholder(/supplier code/i));
  await expect(async () => {
    await visible(enterCode).click();
    await expect(codeInput).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000, intervals: [500, 1000] });

  await codeInput.fill(SUPPLIER_CODE);
  await codeInput.press("Enter");

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = visible(page.getByRole("button", { name: "Send to supplier" }));
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();

  // The send guard opens a confirm step before anything leaves, and its primary
  // button stays disabled until the operator ticks the acknowledgement. That gate is
  // deliberate — do not route around it.
  const dialog = page.getByRole("dialog", { name: /send order to/i });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /send to/i }).click();

  // ── A DISPATCH WAS ACTUALLY ATTEMPTED ────────────────────────────────────
  // Without this, the journey cannot tell "transform stopped at ready_to_deliver and
  // a dispatch delivered it" from "transform teleported straight to delivered and
  // nothing was ever sent": useSendFlow short-circuits on an already-delivered order,
  // so every assertion below is satisfied by a mock that never dispatches. Proven —
  // mutating mockTransformOrder to write `delivered` left this whole spec green.
  //
  // useSendFlow sets this notice ONLY on the dispatch path, immediately before
  // redeliverOrder, so it is exactly what the two worlds disagree about.
  // By testid, not by role: two elements carry role="status" here (the flow notice
  // and the issues panel), so a bare getByRole is a strict-mode violation.
  await expect(page.getByTestId("status-bar-notice")).toContainText(
    /sending the generated output|confirming the order/i,
    { timeout: 60_000 },
  );

  // ── THE acceptance criterion: the order really reaches `delivered` ────────
  // Not "an artifact exists" and not "the button changed" — the order's own status.
  await expect(banner).toContainText(/practice order delivered/i, { timeout: 90_000 });
  await expect(banner).toContainText(/emailed you the finished file/i);

  // …and the user is invited to do the real thing next.
  await expect(page.getByRole("link", { name: /upload your own order/i })).toBeVisible();
});

test("the practice CTA refuses to start a run it cannot deliver", async ({ page }) => {
  test.setTimeout(180_000);

  // The complement to the happy path — without it, the assertion above could pass on
  // a product that ignores the address entirely. With no usable address the backend
  // seeds no delivery setup and the run would dead-end at "no delivery is set up",
  // the exact failure WP-27 exists to remove. So the prompt will not start it.
  const addressField = await openPracticePrompt(page);
  await addressField.fill("");

  const run = page.getByRole("button", { name: /^run it$/i });
  await expect(run).toBeDisabled();

  // A malformed address is refused for the same reason.
  await addressField.fill("not-an-address");
  await expect(run).toBeDisabled();

  // And a real one arms it.
  await addressField.fill(PRACTICE_ADDRESS);
  await expect(run).toBeEnabled();
});
