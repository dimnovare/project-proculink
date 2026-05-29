import { test, expect } from "@playwright/test";

/**
 * Regression test for the P0 reported in STATUS.md (2026-05-28):
 *
 *   "/orders/[id] showed 'Order Not Found' on first navigation even for valid
 *    orders, while the SAME order loaded correctly at /inbox/[orderId]."
 *
 * Two things resolve this:
 *  1. Backend: the dev http→https redirect (ProcuLink.Api/Program.cs) was
 *     removed. A 307 from http://localhost:5223 → https://localhost:7230 broke
 *     the CORS preflight on the first cross-origin call, so getOrderById threw a
 *     network error the page rendered as "Order Not Found".
 *  2. Frontend: /orders and /orders/:id now permanently redirect to /inbox and
 *     /inbox/:id (next.config.ts), so the order-detail route is SpineReview at
 *     /inbox/[orderId] — the route that already worked in the original report.
 *     The legacy OrderDetailPage at /orders/[id] is now unreachable dead code.
 *
 * This test guards the user-facing contract that regressed: navigating to a
 * valid order via the /orders/[id] path resolves to a rendered order, not the
 * not-found gate.
 *
 * The upload → /upload/preview/<id> → commit → /inbox/<id> half of the journey
 * is already covered by tests/e2e/magic-mapping-preview.spec.ts (lines 98, 138),
 * so it is intentionally not duplicated here.
 *
 * Runs in MOCK mode (default / CI): the in-memory api-client serves the seeded
 * order, so no backend is required. Auth uses PROCULINK_QA_BYPASS_AUTH=true
 * (set by webServer in playwright.config.ts).
 */

test("navigating to /orders/[id] resolves to the order detail, not the not-found gate", async ({ page }) => {
  test.setTimeout(45_000); // first /inbox/[orderId] hit compiles SpineReview in dev

  // 'ord-002' is a seeded mock order (PO-2024-005678, pending_review). Hitting
  // the legacy /orders/:id path exercises the permanent redirect to /inbox/:id,
  // proving the exact route from the bug report resolves to a rendered order
  // rather than "Order Not Found".
  await page.goto("/orders/ord-002");

  // The /orders/:id → /inbox/:id redirect must land us on the canonical route.
  await expect(page).toHaveURL(/\/inbox\/ord-002/i, { timeout: 15_000 });

  // The order must render — not the not-found / load-error gate.
  await expect(page.getByText(/order not found/i)).toHaveCount(0);
  await expect(page.getByText(/failed to load order/i)).toHaveCount(0);
  await expect(page.getByText(/PO-2024-005678/).first()).toBeVisible({ timeout: 20_000 });
});
