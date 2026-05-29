# Legacy Route Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Vite-era `/orders`, `/suppliers`, `/mappings` shim routes and the `src/views/` + orphaned `layout`/`admin` components they depend on, without breaking the upload→preview→review→deliver happy path.

**Architecture:** Add HTTP permanent redirects for `/orders(/:id)` → `/inbox(/:id)` in `next.config.ts` first (safety net), then repoint two client-side `router.push` calls that hardcode `/orders/{id}` for non-mock mode, then delete the four shim route files and all seven view files they re-export, then delete three orphaned component files whose only consumers were those views.

**Tech Stack:** Next.js 15 App Router, TypeScript, Playwright (e2e tests in `tests/e2e/`), bun

---

## File map

| Action | Path | Reason |
|---|---|---|
| Modify | `next.config.ts` | Add permanent redirects `/orders→/inbox`, `/orders/:id→/inbox/:id` |
| Modify | `src/components/bridge/UploadWorkbench.tsx` | Fix `handleSample()` — remove `isApiMockMode` branch, always use `/inbox/{id}` |
| Modify | `src/app/(app)/upload/preview/[orderId]/page.tsx` | Fix `handleCommitted()` — always route to `/inbox/{id}` |
| Modify | `src/components/bridge/BridgeSidebar.tsx` | Remove stale `{ label: "Orders", href: "/orders" }` nav item from Workbench group |
| Modify | `src/middleware.ts` | Remove `"/orders(.*)"`, `"/suppliers(.*)"`, `"/mappings(.*)"` from protected-route matcher |
| Modify | `src/components/bridge/BridgeTopbar.tsx` | Remove `orders: "Orders"` from LABELS map |
| Modify | `tests/e2e/sample-order-happy-path.spec.ts` | Fix URL pattern — `/orders` branch is gone, always `/inbox` |
| Modify | `tests/e2e/no-mock-residue.spec.ts` | Remove `"/orders"` from ROUTES — now just redirects to `/inbox` |
| Modify | `tests/e2e/error-recovery.spec.ts` | Update routes + copy to match SpineReview error UI (not OrderDetailPage) |
| Delete | `src/app/(app)/orders/page.tsx` | Shim re-exporting OrdersPage — redirect in next.config.ts replaces it |
| Delete | `src/app/(app)/orders/[id]/page.tsx` | Shim re-exporting OrderDetailPage — redirect replaces it |
| Delete | `src/app/(app)/suppliers/page.tsx` | Shim re-exporting SuppliersPage — existing `/suppliers→/library/suppliers` redirect covers it |
| Delete | `src/app/(app)/mappings/page.tsx` | Shim re-exporting MappingsPage — existing `/mappings→/library/mappings` redirect covers it |
| Delete | `src/views/OrderDetailPage.tsx` | Old view, now unreachable (only consumer was `orders/[id]/page.tsx`) |
| Delete | `src/views/OrdersPage.tsx` | Old view, now unreachable |
| Delete | `src/views/SuppliersPage.tsx` | Old view, now unreachable |
| Delete | `src/views/MappingsPage.tsx` | Old view, now unreachable |
| Delete | `src/views/SupplierProfilesPage.tsx` | Already orphaned — no app route imports it |
| Delete | `src/views/UploadPage.tsx` | Already orphaned — superseded by `src/app/(app)/upload/page.tsx` |
| Delete | `src/views/NotFound.tsx` | Already orphaned |
| Delete | `src/components/layout/AppLayout.tsx` | Only imported by `AppSidebar.tsx`; neither used by the Bridge shell |
| Delete | `src/components/layout/AppSidebar.tsx` | Only imported by `AppLayout.tsx`; replaced by `BridgeSidebar` |
| Delete | `src/components/admin/SupplierProfileModal.tsx` | Only imported by `SupplierProfilesPage.tsx` (deleted above) |

---

## Task 1: Add permanent redirects for /orders routes

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Open next.config.ts and locate the redirects array**

  Current state (lines 10–19):
  ```ts
  async redirects() {
    return [
      { source: "/dashboard", destination: "/bridge",            permanent: true },
      { source: "/mappings",  destination: "/library/mappings",  permanent: true },
      { source: "/suppliers", destination: "/library/suppliers", permanent: true },
    ];
  },
  ```

- [ ] **Step 2: Add `/orders` and `/orders/:id` redirects**

  Replace the redirects array with:
  ```ts
  async redirects() {
    return [
      { source: "/dashboard",        destination: "/bridge",            permanent: true },
      { source: "/mappings",         destination: "/library/mappings",  permanent: true },
      { source: "/suppliers",        destination: "/library/suppliers", permanent: true },
      { source: "/orders",           destination: "/inbox",             permanent: true },
      { source: "/orders/:id",       destination: "/inbox/:id",         permanent: true },
    ];
  },
  ```

- [ ] **Step 3: Verify TypeScript still compiles**

  Run: `cd C:\Users\Dmitri.MARKIT\source\repos\project-proculink && bunx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```
  git add next.config.ts
  git commit -m "feat(routing): add permanent redirects /orders→/inbox, /orders/:id→/inbox/:id"
  ```

---

## Task 2: Repoint client-side upload routing away from /orders

**Files:**
- Modify: `src/components/bridge/UploadWorkbench.tsx` (line 224–227)
- Modify: `src/app/(app)/upload/preview/[orderId]/page.tsx` (lines 20–25)

Both files currently check `isApiMockMode` and send non-mock users to `/orders/{id}`. SpineReview at `/inbox/[orderId]` already calls `apiClient.getOrderById()` so it works with the live backend. Remove the conditional entirely and always route to `/inbox/{id}`.

- [ ] **Step 1: Fix UploadWorkbench.handleSample()**

  In `src/components/bridge/UploadWorkbench.tsx`, find the block at lines 223–227:
  ```ts
      const target = isApiMockMode
        ? `/inbox/${encodeURIComponent(orderId)}?sample=1`
        : `/orders/${encodeURIComponent(orderId)}?sample=1`;
      router.push(target);
  ```
  Replace with:
  ```ts
      router.push(`/inbox/${encodeURIComponent(orderId)}?sample=1`);
  ```
  After this change `isApiMockMode` may no longer be imported in this file — confirm by searching for other uses of `isApiMockMode` in UploadWorkbench.tsx. If the only use was this line, remove the import from the `import { ..., isApiMockMode, ... }` destructure on line 11.

- [ ] **Step 2: Fix upload/preview handleCommitted()**

  In `src/app/(app)/upload/preview/[orderId]/page.tsx`, find the block at lines 20–25:
  ```ts
    function handleCommitted(id: string) {
      const dest = isApiMockMode
        ? `/inbox/${encodeURIComponent(id)}`
        : `/orders/${encodeURIComponent(id)}`;
      router.push(dest);
    }
  ```
  Replace with:
  ```ts
    function handleCommitted(id: string) {
      router.push(`/inbox/${encodeURIComponent(id)}`);
    }
  ```
  Remove the `isApiMockMode` import from the `import { isApiMockMode } from "@/lib/api-client";` line (line 13) since it is no longer used.

- [ ] **Step 3: Verify TypeScript still compiles**

  Run: `bunx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```
  git add src/components/bridge/UploadWorkbench.tsx
  git add "src/app/(app)/upload/preview/[orderId]/page.tsx"
  git commit -m "fix(routing): always route post-upload to /inbox/{id}, remove isApiMockMode order routing branch"
  ```

---

## Task 3: Clean up stale /orders references in shell components and middleware

**Files:**
- Modify: `src/components/bridge/BridgeSidebar.tsx` (line 31)
- Modify: `src/middleware.ts` (lines 13–16)
- Modify: `src/components/bridge/BridgeTopbar.tsx` (line 55)

- [ ] **Step 1: Remove stale Orders nav item from BridgeSidebar**

  In `src/components/bridge/BridgeSidebar.tsx`, the Workbench nav group at lines 28–33 reads:
  ```ts
    {
      group: "Workbench",
      items: [
        { label: "Upload",  href: "/upload" },
        { label: "Orders",  href: "/orders" },
      ],
    },
  ```
  Remove the `{ label: "Orders", href: "/orders" }` item — the Inbox group already has "All orders" at `/inbox`:
  ```ts
    {
      group: "Workbench",
      items: [
        { label: "Upload",  href: "/upload" },
      ],
    },
  ```

- [ ] **Step 2: Remove legacy protected-route matchers from middleware**

  In `src/middleware.ts`, the `isProtectedRoute` array at lines 12–16 contains:
  ```ts
    // Legacy routes still protected during transition
    "/dashboard(.*)",
    "/orders(.*)",
    "/suppliers(.*)",
    "/mappings(.*)",
  ```
  Remove those four lines (the comment + three route patterns). `/dashboard` is kept because it still might appear as a bookmarked URL in some users' browsers and the redirect itself needs to be served. Actually — all four of these are now handled as permanent 301 redirects in `next.config.ts`, which runs before middleware, so middleware never sees them. Remove all four:
  ```ts
  const isProtectedRoute = createRouteMatcher([
    "/bridge(.*)",
    "/inbox(.*)",
    "/upload(.*)",
    "/drafts(.*)",
    "/library(.*)",
    "/operations(.*)",
    "/settings(.*)",
  ]);
  ```

- [ ] **Step 3: Remove stale orders label from BridgeTopbar**

  In `src/components/bridge/BridgeTopbar.tsx`, the `LABELS` map at lines 50–67 contains:
  ```ts
    orders:    "Orders",
  ```
  Remove that entry. The breadcrumb for `/inbox/[id]` will show `Inbox / <id-slug>` which is correct.

- [ ] **Step 4: Verify TypeScript still compiles**

  Run: `bunx tsc --noEmit`
  Expected: no errors

- [ ] **Step 5: Commit**

  ```
  git add src/components/bridge/BridgeSidebar.tsx src/middleware.ts src/components/bridge/BridgeTopbar.tsx
  git commit -m "chore(cleanup): remove stale /orders nav item, topbar label, and middleware matchers"
  ```

---

## Task 4: Delete the four shim app routes

**Files:**
- Delete: `src/app/(app)/orders/page.tsx`
- Delete: `src/app/(app)/orders/[id]/page.tsx`
- Delete: `src/app/(app)/suppliers/page.tsx`
- Delete: `src/app/(app)/mappings/page.tsx`

These files each re-export a view that will be deleted in Task 5. Deleting them now will cause TypeScript errors until Task 5 is done — do Tasks 4 and 5 together in one commit.

- [ ] **Step 1: Confirm no other file imports from these shim routes**

  Run: `grep -rn "from.*app.*orders" src/ --include="*.ts" --include="*.tsx"`
  and: `grep -rn "from.*app.*suppliers" src/ --include="*.ts" --include="*.tsx"`
  and: `grep -rn "from.*app.*mappings" src/ --include="*.ts" --include="*.tsx"`
  Expected: no results (app routes are not imported by other app routes in Next.js)

- [ ] **Step 2: Delete the shim route files**

  ```
  rm src/app/(app)/orders/page.tsx
  rm "src/app/(app)/orders/[id]/page.tsx"
  rm src/app/(app)/suppliers/page.tsx
  rm src/app/(app)/mappings/page.tsx
  ```
  Also remove the now-empty `src/app/(app)/orders/` and `src/app/(app)/orders/[id]/` directories.

- [ ] **Step 3: Delete all src/views/ files**

  ```
  rm src/views/OrderDetailPage.tsx
  rm src/views/OrdersPage.tsx
  rm src/views/SuppliersPage.tsx
  rm src/views/MappingsPage.tsx
  rm src/views/SupplierProfilesPage.tsx
  rm src/views/UploadPage.tsx
  rm src/views/NotFound.tsx
  ```
  Then remove the empty `src/views/` directory.

- [ ] **Step 4: Verify TypeScript still compiles (no dangling imports)**

  Run: `bunx tsc --noEmit`
  Expected: no errors. If you see errors of the form `Cannot find module '@/views/...'` that means a shim route file was not deleted — check for any remaining files in `src/app/(app)/orders/`, `suppliers/`, or `mappings/`.

- [ ] **Step 5: Commit**

  ```
  git add -A
  git commit -m "chore(cleanup): delete shim routes and src/views — /orders redirects via next.config.ts"
  ```

---

## Task 5: Delete orphaned layout and admin components

**Files:**
- Delete: `src/components/layout/AppLayout.tsx`
- Delete: `src/components/layout/AppSidebar.tsx`
- Delete: `src/components/admin/SupplierProfileModal.tsx`

- [ ] **Step 1: Confirm no remaining imports of these three files**

  Run: `grep -rn "AppLayout\|AppSidebar\|SupplierProfileModal" src/ --include="*.ts" --include="*.tsx"`
  Expected: the only hits should be the definition lines inside the three files themselves. If any other file still imports them, investigate before deleting.

- [ ] **Step 2: Delete the three orphaned files**

  ```
  rm src/components/layout/AppLayout.tsx
  rm src/components/layout/AppSidebar.tsx
  rm src/components/admin/SupplierProfileModal.tsx
  ```
  Remove the now-empty `src/components/layout/` and `src/components/admin/` directories if they have no other files.

- [ ] **Step 3: Verify TypeScript still compiles**

  Run: `bunx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```
  git add -A
  git commit -m "chore(cleanup): delete orphaned AppLayout, AppSidebar, SupplierProfileModal"
  ```

---

## Task 6: Update Playwright e2e tests

**Files:**
- Modify: `tests/e2e/sample-order-happy-path.spec.ts` (line 40)
- Modify: `tests/e2e/no-mock-residue.spec.ts` (line 42)
- Modify: `tests/e2e/error-recovery.spec.ts` (lines 12–47)

- [ ] **Step 1: Fix sample-order-happy-path.spec.ts**

  Line 40 currently waits for either `/inbox/<id>` or `/orders/<id>`:
  ```ts
    page.waitForURL(/\/(inbox|orders)\/[^/?]+\?.*sample=1/i, { timeout: 15_000 }),
  ```
  Change to only `/inbox`:
  ```ts
    page.waitForURL(/\/inbox\/[^/?]+\?.*sample=1/i, { timeout: 15_000 }),
  ```
  Also update the comment on line 9 from:
  ```
   *   3. Navigate to /inbox/{id}?sample=1 (mock) or /orders/{id}?sample=1 (live)
  ```
  to:
  ```
   *   3. Navigate to /inbox/{id}?sample=1
  ```

- [ ] **Step 2: Fix no-mock-residue.spec.ts**

  In the `ROUTES` array (lines 38–47), remove `"/orders"`:
  ```ts
  const ROUTES = [
    "/bridge",
    "/upload",
    "/inbox",
    "/library/suppliers",
    "/library/mappings",
    "/operations/log",
    "/settings",
  ];
  ```

- [ ] **Step 3: Update error-recovery.spec.ts to match SpineReview error UI**

  The `"OrderDetailPage error handling"` describe block tests error states that were on the old `OrderDetailPage` component. After this cleanup, navigating to `/orders/does-not-exist-1234` permanently redirects to `/inbox/does-not-exist-1234`, which renders `SpineReview`. SpineReview error state (lines 895–914 of SpineReview.tsx) shows:
  - `order === null`: text "Order not found" (lowercase n) and a button "← Back to inbox"
  - `isError`: text "Failed to load order" and a button "← Back to inbox"

  Rewrite the describe block:
  ```ts
  test.describe("SpineReview error handling", () => {
    test("real 404 shows 'Order not found' with Back to inbox only (no Retry)", async ({ page }) => {
      // The mock returns null for unknown ids, surfacing the 404 path.
      await page.goto("/inbox/does-not-exist-1234");

      await expect(page.getByText(/order not found/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /back to inbox/i })).toBeVisible();
      // No Retry button on a true 404.
      await expect(page.getByRole("button", { name: /^retry$/i })).toHaveCount(0);
    });

    test("network failure shows 'Failed to load order' with Back to inbox", async ({ page }) => {
      if (!process.env.PLAYWRIGHT_LIVE) {
        test.skip(true, "network-interception test requires PLAYWRIGHT_LIVE=1 (mock api-client bypasses fetch)");
        return;
      }

      // Force /api/orders/:id to fail with a network-shaped error.
      await page.route(/\/api\/orders\/[^/]+$/i, async (route) => {
        await route.abort("failed");
      });

      await page.goto("/inbox/some-id-that-would-otherwise-resolve");

      await expect(page.getByText(/failed to load order/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/check your connection and try again/i)).toBeVisible();

      const back = page.getByRole("button", { name: /back to inbox/i });
      await expect(back).toBeVisible();
      await expect(back).toBeEnabled();
    });
  });
  ```

- [ ] **Step 4: Run the Playwright tests in mock mode to verify they pass**

  Run: `PROCULINK_QA_BYPASS_AUTH=true bunx playwright test tests/e2e/sample-order-happy-path.spec.ts tests/e2e/no-mock-residue.spec.ts tests/e2e/error-recovery.spec.ts --reporter=list`
  Expected: all tests pass or the live-only test is skipped with the correct skip message

- [ ] **Step 5: Commit**

  ```
  git add tests/e2e/sample-order-happy-path.spec.ts tests/e2e/no-mock-residue.spec.ts tests/e2e/error-recovery.spec.ts
  git commit -m "test(e2e): update Playwright tests for /orders→/inbox cleanup"
  ```

---

## Task 7: Final build and type verification

- [ ] **Step 1: Full TypeScript check**

  Run: `bunx tsc --noEmit`
  Expected: zero errors

- [ ] **Step 2: Production build**

  Run: `bun run build`
  Expected: build completes without errors. Check specifically that no `Module not found` errors appear for `@/views/...`, `@/components/layout/...`, or `@/components/admin/...`.

- [ ] **Step 3: Smoke-test the redirect chain in dev**

  Start dev: `PROCULINK_QA_BYPASS_AUTH=true bun run dev -- --hostname 127.0.0.1 --port 8082`

  Verify these URLs redirect correctly (use `curl -I` or browser):
  - `http://localhost:8082/orders` → 308 → `/inbox`
  - `http://localhost:8082/orders/abc123` → 308 → `/inbox/abc123`
  - `http://localhost:8082/suppliers` → 308 → `/library/suppliers` (existing redirect, confirm still works)
  - `http://localhost:8082/mappings` → 308 → `/library/mappings` (existing redirect, confirm still works)

- [ ] **Step 4: Smoke-test the upload happy path**

  In the running dev server:
  1. Go to `http://localhost:8082/upload`
  2. Select a file and upload (or click "Try with sample order")
  3. Confirm you land on `/upload/preview/{id}` (magic mapping preview), not `/orders/{id}`
  4. Confirm that after committing the mapping, you land on `/inbox/{id}` (SpineReview), not `/orders/{id}`

- [ ] **Step 5: Commit if any minor fixes were needed during smoke-testing**

  ```
  git add -A
  git commit -m "chore: post-cleanup fixups from smoke-testing"
  ```
