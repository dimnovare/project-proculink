import { expect, test, type Page, type APIRequestContext, type ConsoleMessage } from "@playwright/test";

/* =============================================================================
 * ProcuLink LIVE full end-to-end "click everything" suite
 * -----------------------------------------------------------------------------
 * Walks EVERY (app) screen + the marketing pages and asserts each renders
 * without a console error or a tripped React error boundary, then HAMMERS the
 * order-review heart-piece (the #1 screen) with every interaction the founder
 * cares about: expand/collapse the reconstructed doc, edit header fields, resolve
 * a line, save mappings, the Edit-mapping slideover + all-format preview selector,
 * the Conformance tab + format selector, and the Supplier-response tab.
 *
 * WHY a single big spec: the founder wants ONE command they can run repeatedly
 * against prod/staging with their own Clerk session to confirm nothing is broken
 * across the whole product surface. Per-screen test() cases keep failures legible.
 *
 * ── RUN COMMANDS ────────────────────────────────────────────────────────────
 * The orchestrator (you) cannot run these against prod — they need a real Clerk
 * session OR the dev QA-bypass. Two supported ways:
 *
 *   1) LOCAL, against a running backend stack (Postgres + Api + Worker per
 *      ProcuLink/README.md) using the dev QA auth bypass — no Clerk session:
 *
 *        bun run test:e2e:full
 *        # which is: cross-env PLAYWRIGHT_LIVE=1 PLAYWRIGHT_FULL=1 \
 *        #           playwright test live-full-e2e.spec.ts
 *
 *      It boots `next dev` on :8082 with PROCULINK_QA_BYPASS_AUTH=true and points
 *      NEXT_PUBLIC_API_BASE_URL at PLAYWRIGHT_API_URL (default http://localhost:5223).
 *      Override the API:
 *        PLAYWRIGHT_API_URL=http://localhost:5223 bun run test:e2e:full
 *
 *   2) AGAINST A DEPLOYED ENV (staging/prod) using a REAL signed-in session.
 *      Reuse an authenticated storage state (recommended — Clerk JWTs are short
 *      lived, but the session cookie refreshes them):
 *
 *        # a) one-time: sign in with a headed browser and save storage state
 *        bunx playwright open --save-storage=tests/.auth/state.json https://app.proculink.eu
 *        # (sign in, then close the window)
 *
 *        # b) run the suite against that env with the saved session
 *        PLAYWRIGHT_LIVE=1 PLAYWRIGHT_FULL=1 \
 *          PLAYWRIGHT_BASE_URL=https://app.proculink.eu \
 *          PLAYWRIGHT_API_URL=https://api.proculink.eu \
 *          PLAYWRIGHT_STORAGE_STATE=tests/.auth/state.json \
 *          bunx playwright test live-full-e2e.spec.ts
 *
 *      When PLAYWRIGHT_STORAGE_STATE is set, this spec loads it so all requests
 *      (page + APIRequestContext) carry the real session. The QA-bypass webServer
 *      in playwright.config.ts is ignored because PLAYWRIGHT_BASE_URL points at the
 *      remote env (set reuseExistingServer / a no-op server as needed, or run with
 *      `--config` pointing at a server-less config).
 *
 * Gated by BOTH PLAYWRIGHT_LIVE=1 AND PLAYWRIGHT_FULL=1 so it never runs in the
 * default mock CI sweep (it needs a backend + auth).
 * ========================================================================== */

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:5223";
const RUN = process.env.PLAYWRIGHT_LIVE === "1" && process.env.PLAYWRIGHT_FULL === "1";

// Use a saved authenticated storage state when provided (deployed-env mode).
if (process.env.PLAYWRIGHT_STORAGE_STATE) {
  test.use({ storageState: process.env.PLAYWRIGHT_STORAGE_STATE });
}

// ─── Console / error-boundary capture ────────────────────────────────────────

/**
 * Attaches console + pageerror listeners to a page and returns a getter for the
 * collected hard errors. We deliberately allow-list a few benign console.error
 * sources that are known-noisy in this app and unrelated to render health
 * (third-party SDKs, expected 4xx surfaced by TanStack Query, favicon, etc.).
 */
function watchConsole(page: Page) {
  const errors: string[] = [];
  const ALLOW = [
    /favicon/i,
    /Failed to load resource/i,            // 401/404 on optional endpoints
    /net::ERR_/i,                          // transient network blips
    /clerk/i,                              // Clerk dev-instance warnings
    /sentry/i,                             // Sentry init noise in non-prod
    /Download the React DevTools/i,
    /\[Fast Refresh\]/i,
    /hydrat/i,                             // dev-only hydration nags vary by env
    /posthog/i,
    /ResizeObserver loop/i,
  ];
  const keep = (text: string) => !ALLOW.some((re) => re.test(text));

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (keep(text)) errors.push(`console.error: ${text}`);
    }
  };
  const onPageError = (err: Error) => {
    if (keep(err.message)) errors.push(`pageerror: ${err.message}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    detach() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * Asserts the screen did not trip the Bridge ErrorBoundary fallback. The fallback
 * renders "{context} failed to load" / "Something went wrong" / "An unexpected
 * error occurred while rendering this screen." (see ErrorBoundary.tsx).
 */
async function assertNoErrorBoundary(page: Page) {
  await expect(
    page.getByText(/an unexpected error occurred while rendering this screen/i),
  ).toHaveCount(0);
  await expect(page.getByText(/^something went wrong$/i)).toHaveCount(0);
  await expect(page.getByText(/failed to load$/i)).toHaveCount(0);
}

/**
 * Visit a route, wait for network to settle, assert it rendered an h1 (or a known
 * landmark), no error boundary, and no hard console errors. The single reusable
 * "this screen is healthy" check used for every (app) screen.
 */
async function visitAndAssertHealthy(
  page: Page,
  path: string,
  opts: { expectHeading?: RegExp; landmark?: RegExp } = {},
) {
  const watch = watchConsole(page);
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // Give client components + TanStack queries a beat to render.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    await assertNoErrorBoundary(page);

    if (opts.expectHeading) {
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
        opts.expectHeading,
        { timeout: 20_000 },
      );
    } else if (opts.landmark) {
      await expect(page.getByText(opts.landmark).first()).toBeVisible({ timeout: 20_000 });
    } else {
      // Fallback: any h1 OR a main landmark is present (tolerates empty states).
      const h1 = page.getByRole("heading", { level: 1 }).first();
      const main = page.getByRole("main");
      await expect(h1.or(main).first()).toBeVisible({ timeout: 20_000 });
    }

    expect(watch.errors, `Console/page errors on ${path}:\n${watch.errors.join("\n")}`).toEqual([]);
  } finally {
    watch.detach();
  }
}

// ─── Backend helpers (mirror the existing live specs) ─────────────────────────

async function ensureSupplier(request: APIRequestContext, name = "E2E Full-Suite Supplier"): Promise<{ id: string; name: string }> {
  const list = await request.get(`${API_BASE_URL}/api/suppliers`);
  expect(list.ok(), `GET /api/suppliers failed (${list.status()})`).toBeTruthy();
  const suppliers = (await list.json()) as Array<{ id: string; name: string }>;
  const existing = suppliers.find((s) => s.name === name) ?? suppliers[0];
  if (existing) return existing;

  const created = await request.post(`${API_BASE_URL}/api/suppliers`, { data: { name } });
  // 429 = supplier-limit reached on the plan; reuse whatever exists.
  if (created.status() === 429 && suppliers.length > 0) return suppliers[0];
  expect(created.status(), `POST /api/suppliers returned ${created.status()}`).toBe(201);
  return (await created.json()) as { id: string; name: string };
}

/**
 * Upload a 3-line CSV PO, navigate the mapping preview, manually resolve every
 * unresolved line, commit, and return the created order id sitting on /inbox/{id}.
 * Reuses the exact UI contract the existing live-po-loop spec verifies.
 */
async function createReviewableOrder(page: Page, request: APIRequestContext): Promise<{ orderId: string; supplierId: string }> {
  const supplier = await ensureSupplier(request);
  const stamp = Date.now();
  const csv = [
    "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency",
    `E2E-FULL-${stamp},E2E Full Buyer,1,EF-${stamp}-A,Blue terminal block,2,10.00,EUR`,
    `E2E-FULL-${stamp},E2E Full Buyer,2,EF-${stamp}-B,Green relay module,3,15.50,EUR`,
    `E2E-FULL-${stamp},E2E Full Buyer,3,EF-${stamp}-C,Panel cable set,1,28.20,EUR`,
  ].join("\n");

  await page.goto(`/upload?supplierId=${supplier.id}`);
  await expect(page.getByRole("heading", { level: 1, name: /upload/i }).first()).toBeVisible({ timeout: 15_000 });
  await page.setInputFiles('input[type="file"]', {
    name: `e2e-full-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  const uploadButton = page.getByRole("button", { name: /upload.*(review|send)/i });
  await expect(uploadButton).toBeEnabled({ timeout: 15_000 });
  await uploadButton.click();

  await page.waitForURL(/\/upload\/preview\//i, { timeout: 30_000 });
  const orderId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: /review mapping/i })).toBeVisible({ timeout: 20_000 });

  // Resolve every unresolved line by hand (works whether or not AI suggestions exist).
  const manualEntryButtons = page.getByRole("button", { name: /\+ enter supplier code/i });
  const count = await manualEntryButtons.count();
  for (let i = 0; i < count; i++) {
    await manualEntryButtons.first().click();
    const input = page.getByPlaceholder(/supplier item code/i);
    await input.fill(`E2E-SUP-${stamp}-${i + 1}`);
    await page.getByRole("button", { name: /^confirm$/i }).click();
  }

  const commitButton = page.getByRole("button", { name: /confirm mapping|continue to review/i });
  await expect(commitButton).toBeEnabled({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/inbox\//i, { timeout: 30_000 }),
    commitButton.click(),
  ]);

  return { orderId, supplierId: supplier.id };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe("Live full E2E — every screen renders + heart-piece interactions", () => {
  test.skip(!RUN, "Full live E2E requires PLAYWRIGHT_LIVE=1 AND PLAYWRIGHT_FULL=1 (see file header for run commands).");
  test.setTimeout(120_000);

  // ── 1. Core flow screens ────────────────────────────────────────────────────

  test("Dashboard (/bridge) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/bridge");
  });

  test("Upload (/upload) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/upload", { expectHeading: /upload/i });
  });

  test("Inbox list (/inbox) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/inbox", { expectHeading: /inbox/i });
  });

  test("Drafts (/drafts) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/drafts");
  });

  // ── 2. The heart-piece: order review (/inbox/[orderId]) — HAMMER IT ──────────

  test("Order review heart-piece — full interaction sweep", async ({ page, request }) => {
    const watch = watchConsole(page);
    try {
      const { orderId } = await createReviewableOrder(page, request);

      // Land on the review screen for the order we just built.
      await page.goto(`/inbox/${orderId}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 25_000 });
      await assertNoErrorBoundary(page);

      // (a) Wires exist: the SpineConnectors svg draws <path> elements between
      //     source → canonical → output. Assert at least one wire path is in the DOM.
      const wirePaths = page.locator("svg path");
      await expect(wirePaths.first()).toBeAttached({ timeout: 15_000 });
      expect(await wirePaths.count()).toBeGreaterThan(0);

      // (b) Expand AND collapse the "Reconstructed from parsed fields" doc.
      //     This is the just-fixed jump/anchor regression — toggling must not throw
      //     and the wires must survive the re-measure.
      const reconstructedToggle = page
        .getByRole("button")
        .filter({ hasText: /reconstructed from parsed fields/i })
        .first();
      if (await reconstructedToggle.count()) {
        // Toggle twice (collapse → expand) and confirm wires still render each time.
        await reconstructedToggle.click();
        await page.waitForTimeout(400); // allow the re-measure animation to settle
        expect(await page.locator("svg path").count()).toBeGreaterThan(0);
        await reconstructedToggle.click();
        await page.waitForTimeout(400);
        expect(await page.locator("svg path").count()).toBeGreaterThan(0);
      }
      await assertNoErrorBoundary(page);

      // (c) Edit the PO NUMBER header field and save (resolve endpoint, header-only edit).
      const poEdit = page.getByRole("button", { name: /edit po number/i }).first();
      if (await poEdit.count()) {
        await poEdit.click();
        // The inline input replaces the button; type a new value + commit via Enter.
        const poInput = page.locator("input").first();
        await poInput.fill(`E2E-EDITED-${Date.now()}`);
        await poInput.press("Enter");
      }

      // (d) Edit the ORDER DATE header field and save.
      const dateEdit = page.getByRole("button", { name: /edit order date/i }).first();
      if (await dateEdit.count()) {
        await dateEdit.click();
        const dateInput = page.locator("input").first();
        await dateInput.fill("2026-06-10");
        await dateInput.press("Enter");
      }
      await assertNoErrorBoundary(page);

      // (e) Open "Edit mapping" (the OutputMappingEditor slideover), switch the
      //     all-format preview selector across csv/json/xml/cxml/ubl/x12, and see
      //     the live preview update for each. Then close.
      const editMapping = page.getByRole("button", { name: /^edit mapping$/i }).first();
      if (await editMapping.count()) {
        await editMapping.click();
        const dialog = page.getByRole("dialog", { name: /edit output mapping/i });
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        const formatSelect = dialog.getByLabel(/^preview format$/i);
        await expect(formatSelect).toBeVisible({ timeout: 10_000 });
        for (const fmt of ["csv", "json", "xml", "cxml", "ubl", "x12"]) {
          await formatSelect.selectOption(fmt).catch(() => {
            // Some formats may not be selectable depending on the option list; tolerate.
          });
          // Live preview header reflects the selected format; just confirm it stays mounted.
          await expect(dialog.getByText(/live preview/i)).toBeVisible({ timeout: 10_000 });
          await page.waitForTimeout(250); // let the debounced dry-run preview fetch settle
        }

        // Close the slideover.
        await dialog.getByRole("button", { name: /^close$/i }).click();
        await expect(dialog).toBeHidden({ timeout: 10_000 });
      }
      await assertNoErrorBoundary(page);

      // (f) Save mappings: promote the per-order mapping to the supplier (xl-only
      //     button; click if present).
      const saveMappings = page.getByRole("button", { name: /save (these )?mappings/i }).first();
      if (await saveMappings.count() && (await saveMappings.isVisible())) {
        await saveMappings.click();
        await page.waitForTimeout(500);
      }
      await assertNoErrorBoundary(page);

      // (g) Conformance tab — open, exercise the format selector (role=tablist),
      //     and confirm the checks/empty-state render without throwing.
      const conformanceTab = page.getByRole("button", { name: /^conformance$/i }).first();
      if (await conformanceTab.count()) {
        await conformanceTab.click();
        const fmtTablist = page.getByRole("tablist", { name: /conformance format/i });
        if (await fmtTablist.count()) {
          const fmtTabs = fmtTablist.getByRole("tab");
          const tabCount = Math.min(await fmtTabs.count(), 6);
          for (let i = 0; i < tabCount; i++) {
            await fmtTabs.nth(i).click();
            await page.waitForTimeout(300);
            await assertNoErrorBoundary(page);
          }
        }
      }

      // (h) Supplier response tab — open and confirm it renders (likely empty: not
      //     yet delivered). "{counterparty} response" label varies (Supplier/Customer).
      const responseTab = page.getByRole("button", { name: /response$/i }).first();
      if (await responseTab.count()) {
        await responseTab.click();
        await page.waitForTimeout(300);
        await assertNoErrorBoundary(page);
      }

      // (i) Passport tab — open it too (it's a first-class tab).
      const passportTab = page.getByRole("button", { name: /^passport$/i }).first();
      if (await passportTab.count()) {
        await passportTab.click();
        await page.waitForTimeout(300);
        await assertNoErrorBoundary(page);
      }

      expect(watch.errors, `Console/page errors on heart-piece:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  // ── 3. Suppliers list + supplier detail tabs ─────────────────────────────────

  test("Suppliers list (/library/suppliers) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/suppliers");
  });

  test("Supplier detail tabs — Overview, Mappings, Catalog, PO Mapping, Delivery, Validation", async ({ page, request }) => {
    const watch = watchConsole(page);
    try {
      const supplier = await ensureSupplier(request);
      await page.goto(`/library/suppliers/${supplier.id}`);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);

      const tabLabels = ["Overview", "Mappings", "Catalog", "PO Mapping", "Delivery", "Validation rules"];
      for (const label of tabLabels) {
        const tab = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(400);
          await assertNoErrorBoundary(page);
        }
      }

      // Delivery tab: expand the ConnectorRequirementsPanel + click "Check configuration".
      const deliveryTab = page.getByRole("button", { name: /^delivery$/i }).first();
      if (await deliveryTab.count()) {
        await deliveryTab.click();
        await page.waitForTimeout(400);
        // ConnectorRequirementsPanel header is a button with aria-expanded.
        const reqToggle = page.locator("button[aria-controls='connector-requirements-body']").first();
        if (await reqToggle.count()) {
          await reqToggle.click();
          await page.waitForTimeout(300);
          const checkBtn = page.getByRole("button", { name: /check configuration/i }).first();
          if (await checkBtn.count()) {
            await checkBtn.click();
            await page.waitForTimeout(800); // advisory check round-trip
            await assertNoErrorBoundary(page);
          }
        }
      }

      // Validation rules tab: confirm the rule bindings panel area renders.
      const validationTab = page.getByRole("button", { name: /^validation rules$/i }).first();
      if (await validationTab.count()) {
        await validationTab.click();
        await page.waitForTimeout(400);
        await assertNoErrorBoundary(page);
      }

      expect(watch.errors, `Console/page errors on supplier detail:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  // ── 4. Connections list + detail (+ ReplayPanel) ─────────────────────────────

  test("Connections list (/connections) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/connections");
  });

  test("Connection detail (+ ReplayPanel) renders cleanly when a connection exists", async ({ page, request }) => {
    const watch = watchConsole(page);
    try {
      // Find a connection id via the API; skip gracefully if none exist yet.
      const res = await request.get(`${API_BASE_URL}/api/connections`);
      if (!res.ok()) {
        test.skip(true, `GET /api/connections returned ${res.status()} — no connections to drill into.`);
        return;
      }
      const body = await res.json().catch(() => null);
      const list: Array<{ id?: string; Id?: string }> = Array.isArray(body)
        ? body
        : (body?.items ?? body?.connections ?? []);
      const first = list.find((c) => c.id || c.Id);
      if (!first) {
        test.skip(true, "No connections exist for this org — connection detail not exercised.");
        return;
      }
      const id = (first.id ?? first.Id)!;
      await page.goto(`/connections/${id}`);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
      expect(watch.errors, `Console/page errors on connection detail:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  // ── 5. Library ───────────────────────────────────────────────────────────────

  test("Buyers (/library/buyers) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/buyers");
  });

  test("Mappings (/library/mappings) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/mappings");
  });

  test("Rules (/library/rules) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/rules");
  });

  test("Rule definitions (/library/rule-definitions) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/rule-definitions");
  });

  test("Output templates (/library/templates) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/templates");
  });

  test("Standards (/library/standards) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/library/standards");
  });

  // ── 6. Operations ──────────────────────────────────────────────────────────

  test("Exceptions (/operations/exceptions) renders + expands a row", async ({ page }) => {
    const watch = watchConsole(page);
    try {
      await page.goto("/operations/exceptions");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });

      // Try to expand the first exception row if any exist (tolerate empty state).
      const expandable = page.getByRole("button").filter({ hasText: /detail|expand|view|▾|›/i }).first();
      if (await expandable.count() && (await expandable.isVisible())) {
        await expandable.click().catch(() => {});
        await page.waitForTimeout(300);
        await assertNoErrorBoundary(page);
      }
      expect(watch.errors, `Console/page errors on exceptions:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  test("System health (/operations/health) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/operations/health");
  });

  test("Delivery log (/operations/log) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/operations/log");
  });

  test("Connectors (/operations/connectors) renders + manifest requirements panel", async ({ page }) => {
    const watch = watchConsole(page);
    try {
      await page.goto("/operations/connectors");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });

      // Expand a connector manifest requirements panel if present.
      const reqToggle = page.locator("button[aria-controls='connector-requirements-body']").first();
      if (await reqToggle.count() && (await reqToggle.isVisible())) {
        await reqToggle.click();
        await page.waitForTimeout(300);
        await assertNoErrorBoundary(page);
      }
      expect(watch.errors, `Console/page errors on connectors:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  test("Webhooks (/operations/webhooks) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/operations/webhooks");
  });

  // ── 7. Inbound (invoice / ASN) ───────────────────────────────────────────────

  test("Invoices (/inbound/invoices) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/inbound/invoices");
  });

  test("ASNs (/inbound/asns) renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/inbound/asns");
  });

  // ── 8. Settings tabs ─────────────────────────────────────────────────────────

  test("Settings tabs — Organization, Billing, Email, SFTP, S3, API keys, Connectors", async ({ page }) => {
    const watch = watchConsole(page);
    try {
      await page.goto("/settings");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);

      const tabLabels = [
        "Organization",
        "Billing & plan",
        "Email intake",
        "SFTP pull",
        "S3 / R2 pull",
        "API keys",
        "Connectors",
      ];
      for (const label of tabLabels) {
        const tab = page.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "i") }).first();
        if (await tab.count() && (await tab.isVisible())) {
          await tab.click();
          await page.waitForTimeout(400);
          await assertNoErrorBoundary(page);
        }
      }
      expect(watch.errors, `Console/page errors on settings:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  // ── 9. Admin (operator-only — tolerate a 403/empty state) ────────────────────

  test("Admin (/admin) renders without throwing", async ({ page }) => {
    const watch = watchConsole(page);
    try {
      await page.goto("/admin");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await assertNoErrorBoundary(page);
      // Admin may gate non-operators; assert SOMETHING rendered (heading or main).
      await expect(page.getByRole("main").or(page.getByRole("heading", { level: 1 })).first()).toBeVisible({ timeout: 20_000 });
      expect(watch.errors, `Console/page errors on admin:\n${watch.errors.join("\n")}`).toEqual([]);
    } finally {
      watch.detach();
    }
  });

  // ── 10. Marketing (public — no auth needed, but verified in the same sweep) ──

  test("Marketing /pricing renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/pricing", { expectHeading: /pricing|plans|stop reformatting/i });
  });

  test("Marketing /how-it-works renders cleanly", async ({ page }) => {
    await visitAndAssertHealthy(page, "/how-it-works");
  });
});
