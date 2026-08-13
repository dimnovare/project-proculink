import { test, expect, type Page } from "@playwright/test";

/**
 * The order screen must be SCROLLABLE at phone width.
 *
 * THE DEFECT, verbatim from the report that produced this file: "when i click on
 * an order where the ordering process is stopped, the page is stuck and i cannot
 * scroll". On mobile. A blocked order is the one screen the operator opens in
 * order to act, and the actions were below a fold that refused to move.
 *
 * THE MECHANISM it guards. `OrderWorkshop`'s root was `h-full … overflow-hidden`
 * — a pane pinned to exactly `<main>`'s height, so `<main>` never had anything to
 * scroll — and every row above the body (identity header, problem banner, flow
 * notices) is `flex-shrink-0`. Its body div carried `min-h-0`, which switches OFF
 * the flexbox automatic minimum size. So once the non-shrinkable rows passed the
 * pane height, the body flexed to `height: 0`, MobileTriage collapsed with it, and
 * the surplus was clipped by `overflow-hidden` with no scrollable ancestor
 * anywhere. Measured pre-fix at 390×844 on `unrouted`: workshop `scrollHeight`
 * 862 vs `clientHeight` 792 with `overflow-y: hidden`, MobileTriage height 0px at
 * top 914, send bar bottom 979 — 135px below a viewport that would not move.
 *
 * WHY PLAYWRIGHT. "The page scrolls" is a layout fact. jsdom has no layout engine,
 * so every `getBoundingClientRect()` there returns zeros and a jsdom version of
 * this file would pass against the broken build. A source lint is no better: the
 * clip that trapped the content and the box that collapsed are two different
 * elements two levels apart, and whether they trap anything depends on the
 * rendered height of a banner whose copy varies per status.
 *
 * ⚠️ WHAT THIS DOES AND DOES NOT CATCH.
 *   catches — any regression that leaves the mobile order screen with content
 *     below the fold and no user-scrollable ancestor to reach it, whatever the
 *     mechanism (re-added clip, a fixed-height ancestor, a body scroll lock).
 *   does NOT catch — a lock that only appears under real touch-drag scrolling
 *     (`touch-action: none` is checked below, but a JS gesture handler that
 *     swallows touchmove is not), a lock on a status mock mode cannot produce
 *     (see ORDERS), or one that needs a real backend's longer error strings to
 *     push the banner over the fold. It measures user-scrollability, and it
 *     deliberately never writes `scrollTop` on a clipped box to prove
 *     reachability: `overflow: hidden` accepts a programmatic scroll that no
 *     gesture can reproduce, which would turn the bug itself into a pass.
 */

/**
 * Orders exercised, and why these.
 *
 * `ord-004` is mock mode's only genuinely blocked order — parked `unrouted`, so it
 * renders the problem banner over the workshop, which is the founder's case. It is
 * also the WORST case measured: its banner is the tallest, and it overflowed by
 * 70px at 390×844 pre-fix.
 *
 * `ord-002` is the control: `pending_review`, no problem banner, and it did NOT
 * lock at 390×844 pre-fix. It is here so the suite states the difference rather
 * than implying every order was broken — and because at the shorter viewports
 * below it overflows too, which is the same trap arriving by a different route.
 */
const ORDERS = ["ord-004", "ord-002"] as const;

/**
 * Viewport heights, all at 390px wide (iPhone 12/13/14 logical width, the same
 * number tests/e2e/tap-targets.spec.ts measures at).
 *
 * 844 is the full logical height. 664 is that height minus Safari's visible
 * toolbars — the height a phone actually renders at most of the time, and where
 * EVERY problem status measured pre-fix locked rather than just the two tallest.
 * 520 is the deliberate squeeze: short enough that even an order with no problem
 * banner overflows, so the mechanism is exercised without depending on how long a
 * particular error string happens to be.
 */
const HEIGHTS = [844, 664, 520] as const;

const CASES = ORDERS.flatMap((order) => HEIGHTS.map((height) => ({ order, height })));

test.describe("mobile order screen scrolls", () => {
  /**
   * ANTI-VACUITY FLOOR — and it runs FIRST, deliberately.
   *
   * Every assertion below is of the form "if content overflows, something must be
   * able to scroll it". A sweep that silently exercised nothing would satisfy all
   * of them. So the size of the matrix is pinned before anything measures, and the
   * per-case body additionally refuses to pass unless the workshop and the mobile
   * triage actually rendered.
   */
  test("the matrix is not empty", async () => {
    expect(CASES.length).toBe(6);
    expect(ORDERS.length).toBe(2);
    expect(HEIGHTS.length).toBe(3);
  });

  for (const { order, height } of CASES) {
    test(`/inbox/${order} at 390x${height} scrolls to its actions`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height });
      await page.goto(`/inbox/${order}`);

      // Load-time device gates re-run after a reload at the mobile size.
      await page.reload();

      const workshop = page.getByTestId("order-workshop");
      await expect(workshop).toBeVisible({ timeout: 30_000 });
      const triage = page.getByTestId("mobile-triage");
      // ATTACHED, not visible — deliberately. Playwright reports a zero-height
      // element as `hidden`, so `toBeVisible()` here fires on the collapse with
      // "Expected: visible / Received: hidden", which names neither the element's
      // height nor the defect. It was in fact the assertion that caught the
      // mutation on the blocked order, and it explained nothing. Waiting only for
      // attachment lets the two floors below do the reporting.
      await expect(triage).toBeAttached();

      // ── Floor: the screen under test really rendered, at the mobile layout. ──
      // MobileTriage collapsing to zero height IS the defect, so a zero-height
      // triage must never be mistaken for "nothing to check". `boundingBox()`
      // returns null for a `display: none` element, which is the other way this
      // screen could go quiet.
      const triageBox = await triage.boundingBox();
      expect(triageBox, "MobileTriage is not laid out at all (display:none?)").not.toBeNull();
      expect(
        triageBox!.height,
        "MobileTriage collapsed to zero height — the body flexed to 0 and the order is unreachable",
      ).toBeGreaterThan(0);

      const geometry = await measureGeometry(page);
      assertReachable(geometry);

      // ── The operator's own test: can I get to the button. ─────────────────────
      // `scrollIntoViewIfNeeded` moves real scrollers only; it cannot fake its way
      // out of an `overflow: hidden` box, which is exactly the pre-fix state.
      const sendBar = page.getByTestId("mobile-send-bar");
      if (await sendBar.count()) {
        expect(geometry.sendBarReachable, "the send bar has no scrollable ancestor").toBe(true);
        await sendBar.scrollIntoViewIfNeeded();
        await expect(sendBar).toBeInViewport();
      }
    });
  }
});

/**
 * The measurement, shared by every case above and by the document-card cases below.
 *
 * It measures user-scrollability via computed `overflow-y` + `scrollHeight − clientHeight` and
 * walks ancestors for reachability. It never writes `scrollTop`: a programmatic scroll can move
 * a box that a finger cannot.
 */
async function measureGeometry(page: Page) {
  return page.evaluate(() => {
        const scrollable = (el: Element) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight - el.clientHeight > 1;

        const workshopEl = document.querySelector('[data-testid="order-workshop"]')!;
        const main = document.querySelector("main#main-content");

        // Content that sits outside the viewport, and whether ANY ancestor of it can
        // be scrolled by a person. Walking up from the deepest content is the only
        // way to answer "is this reachable" without assuming which box is the
        // scroller — the answer moved from MobileTriage to <main> in this very fix.
        const reachable = (el: Element) => {
          for (let p: Element | null = el; p; p = p.parentElement) if (scrollable(p)) return true;
          return document.documentElement.scrollHeight > window.innerHeight;
        };

        // Boxes that clip content they cannot scroll — the trap itself.
        const traps: { testid: string | null; cls: string; over: number; overflowY: string }[] = [];
        document.querySelectorAll("*").forEach((el) => {
          const over = el.scrollHeight - el.clientHeight;
          const oy = getComputedStyle(el).overflowY;
          // `sr-only` is a 1px clip by construction; it holds no reachable content.
          const srOnly = typeof el.className === "string" && el.className.includes("sr-only");
          // Two populations, and the second was a hole.
          //
          // ANCESTORS of the workshop's first child are how the original lock was spelled — a
          // fixed-height column above everything. But that predicate can only ever see boxes
          // OUTSIDE the triage, so a clipping box added INSIDE it (a document viewer with its
          // own `overflow: hidden`, say) was invisible to this sweep by construction. Content
          // stranded inside MobileTriage is exactly as unreachable as content stranded above
          // it, so both now count.
          const triageEl = document.querySelector('[data-testid="mobile-triage"]');
          const inScope =
            el.contains(workshopEl.firstElementChild) || (!!triageEl && triageEl.contains(el));
          if (over > 4 && !/(auto|scroll)/.test(oy) && !srOnly && inScope)
            traps.push({
              testid: el.getAttribute("data-testid"),
              cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
              over,
              overflowY: oy,
            });
        });

        const sendBar = document.querySelector('[data-testid="mobile-send-bar"]');
        const contentBottom = Math.max(
          ...[...workshopEl.children].map((c) => c.getBoundingClientRect().bottom),
        );

        return {
          innerHeight: window.innerHeight,
          contentBottom: Math.round(contentBottom),
          overflows: contentBottom > window.innerHeight + 1,
          mainScrollable: main ? scrollable(main) : false,
          mainOverflowY: main ? getComputedStyle(main).overflowY : null,
          workshopOverflowY: getComputedStyle(workshopEl).overflowY,
          // A lock can also be spelled `touch-action: none` on the scroll surface.
          workshopTouchAction: getComputedStyle(workshopEl).touchAction,
          bodyOverflow: getComputedStyle(document.body).overflow,
          sendBarReachable: sendBar ? reachable(sendBar) : null,
          traps,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
  });
}

type Geometry = Awaited<ReturnType<typeof measureGeometry>>;

/** The defect, asserted directly: nothing may clip content that no ancestor can scroll. */
function assertReachable(geometry: Geometry) {
  expect(geometry.traps, "content is clipped with no scrollable ancestor").toEqual([]);

  // When the column is taller than the viewport, the page scroller must exist.
  if (geometry.overflows) {
    expect(
      geometry.mainScrollable,
      `content reaches ${geometry.contentBottom}px in a ${geometry.innerHeight}px viewport, but <main> cannot scroll (overflow-y: ${geometry.mainOverflowY})`,
    ).toBe(true);
  }

  // Neither a touch-action lock nor a stranded body scroll lock.
  expect(geometry.workshopTouchAction).not.toBe("none");
  expect(geometry.bodyOverflow).not.toBe("hidden");

  // And no sideways scroll was traded for the vertical one.
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(0);
}

/**
 * The desktop model must survive the mobile fix.
 *
 * At lg+ the three-column mapper needs a definite height to size its own internal
 * scrollers against, so the workshop stays a fixed-height, non-scrolling pane.
 * Without this, "make it scroll" quietly becomes "make it scroll everywhere" and
 * the mapper grows an outer scrollbar it was designed not to have.
 */
test("desktop keeps the fixed-height pane", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/inbox/ord-002");
  const workshop = page.getByTestId("order-workshop");
  await expect(workshop).toBeVisible({ timeout: 30_000 });

  const desktop = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="order-workshop"]')!;
    const main = document.querySelector("main#main-content")!;
    const triage = document.querySelector('[data-testid="mobile-triage"]');
    return {
      workshopOverflowY: getComputedStyle(el).overflowY,
      mainOverflow: main.scrollHeight - main.clientHeight,
      workshopFillsMain: Math.abs(el.getBoundingClientRect().height - main.clientHeight) < 2,
      triageShown: triage ? getComputedStyle(triage).display !== "none" : false,
    };
  });

  expect(desktop.workshopOverflowY).toBe("hidden");
  expect(desktop.mainOverflow).toBe(0);
  expect(desktop.workshopFillsMain).toBe(true);
  expect(desktop.triageShown).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// The document view, on the surface with the least room for it.
//
// MobileTriage is deliberately review-and-send only, and says so. The document is not
// "advanced editing" though — it is the thing the operator is being asked to agree with — so it
// ships here too, as a card that is collapsed by default. Collapsed is load-bearing twice: the
// landing screen keeps its height, and the body is only MOUNTED when open, so no file is
// downloaded over cellular until someone asks for it.
//
// The risk this adds is precisely the one the suite above exists to catch: a viewer wants a
// bounded, scrollable box, and any fixed-height or clipping ancestor here that is not `lg:`-only
// re-creates the lock. So the card is opened and the SAME geometry is re-measured — the trap
// sweep now covers boxes inside the triage, which it could not see before.
test.describe("the received document on a phone", () => {
  const HEIGHT = 664;

  test("ord-002 renders its PDF without trapping the page", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: HEIGHT });
    await page.goto("/inbox/ord-002");
    await page.reload();
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });

    const card = page.getByTestId("mobile-card-document");
    await expect(card).toBeAttached();
    // Floor: nothing is fetched or rendered before the operator asks for it.
    await expect(page.getByTestId("mobile-source-document")).toHaveCount(0);

    await card.locator("button").first().click();
    const body = page.getByTestId("mobile-source-document");
    await expect(body).toBeVisible({ timeout: 30_000 });
    // The whole path: authenticated fetch → Blob → pdf.js → a rasterised page.
    await expect(body.getByTestId("source-document-pdf-canvas")).toBeVisible({ timeout: 30_000 });

    assertReachable(await measureGeometry(page));

    const sendBar = page.getByTestId("mobile-send-bar");
    if (await sendBar.count()) {
      await sendBar.scrollIntoViewIfNeeded();
      await expect(sendBar).toBeInViewport();
    }
  });

  test("ord-004 says why there is no document, and stays reachable", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: HEIGHT });
    await page.goto("/inbox/ord-004");
    await page.reload();
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("mobile-card-document").locator("button").first().click();

    const body = page.getByTestId("mobile-source-document");
    await expect(body).toBeVisible({ timeout: 30_000 });
    // A purged blob is an ordinary state with its own sentence — not an error, not a blank box.
    await expect(body).toContainText(/data-retention policy/i);
    await expect(body.getByTestId("source-document-pdf-canvas")).toHaveCount(0);

    // ord-004 is the blocked order whose tall problem banner caused the original lock, so this
    // is the case where one more expanded panel matters most.
    assertReachable(await measureGeometry(page));
  });
});

test.describe("the received document on the desktop workshop", () => {
  test("the left column shows the document, with the field list one click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/inbox/ord-003");
    await expect(page.getByTestId("order-workshop")).toBeVisible({ timeout: 30_000 });

    // MobileTriage stays in the DOM (CSS-hidden) and carries its own copy of this card, so
    // every locator here is scoped to the mapper canvas — the desktop pane under test.
    const canvas = page.locator("[data-mapper-canvas]");

    // ord-003 is the CSV fixture: the sheet viewer, with row numbers to point at.
    await expect(canvas.getByTestId("source-document-sheet")).toBeVisible({ timeout: 30_000 });
    await expect(canvas.getByText("Original document")).toBeVisible();

    // The field list is the drag-source for the connector wires and must always be reachable.
    await page.getByTestId("incoming-view-fields").click();
    await expect(canvas.getByText("What we received")).toBeVisible();
    await expect(canvas.getByTestId("source-document-sheet")).toHaveCount(0);
  });
});
