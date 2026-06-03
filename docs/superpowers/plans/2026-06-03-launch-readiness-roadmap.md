# ProcuLink Launch Readiness Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the Claude tasks. Founder-ops tasks (marked 🧑‍💼) are manual and cannot be done by Claude — they are checklists. Steps use `- [ ]` for tracking.

**Goal:** Ship a narrow, truthful, boringly-reliable first launch of the outbound PO product, with payments live after company registration on 2026-06-09.

**Strategy (locked with founder):** Launch the *minimum trustworthy loop* — upload → parse → review → transform → deliver → audit — behind a 6-item shell. Hide everything not core. Activate Stripe after June 9.

**Decisions locked:**
- **6-item launch shell:** Dashboard · Upload · Inbox · Suppliers · Settings · Help. Everything else feature-flagged out of nav (code kept).
- **Distributor plan hidden** for launch (Pilot / Growth / Operations / Integration / Enterprise only).
- **Moat UI:** build the Acceptance tab under Suppliers; **fold** exception visibility into the Dashboard KPI + per-order display (no standalone Exceptions nav page for launch).

**Already shipped this session (do NOT redo):** Worker queue segregation, distributed webhook-replay cache, SSRF guard on all dispatchers, dashboard summary/topology endpoints + frontend wiring, exception ops backend, acceptance-profile backend, mapping-corrections, SQL-native order search, rotated secrets, revenue-controller tests.

---

## Phase 0 — Make the live loop run (P0, blocks everything)

### Task 0.A 🧑‍💼 Deploy ProcuLink.Worker to Railway

**This is the single launch blocker.** Orders stay `parsing` because no Hangfire executor runs in prod. Claude cannot do this (no Railway access). Founder/Codex action:

- [ ] In Railway, add a new service from the backend repo using `Dockerfile.worker`.
- [ ] Service name `ProcuLink.Worker`, no public domain.
- [ ] Set env vars (copy from API service):
  ```
  ConnectionStrings__DefaultConnection
  ASPNETCORE_ENVIRONMENT=Production
  Clerk__Authority
  Storage__R2AccountId  Storage__R2AccessKeyId  Storage__R2SecretAccessKey
  Storage__R2Endpoint   Storage__R2BucketName
  Delivery__EncryptionKey
  Ai__OpenAI__ApiKey
  DataProtection__EncryptionKey      ← now REQUIRED in prod (W1-T2 startup guard will fail-fast without it)
  ```
  Optional if features enabled: `Analytics__PostHog__ApiKey`, `Smtp__*`, `Stripe__*`, `Ocr__Azure__*`.
- [ ] Deploy. Confirm logs show Hangfire server started with queues `critical, delivery-retry, polling, background, default`.

**Note:** W1-T2 added a production startup guard requiring `DataProtection:EncryptionKey` and rejecting `Delivery:AllowPrivateNetworkTargets=true`. Ensure the Worker's env satisfies both or it will refuse to start (by design).

### Task 0.B — Worker health + stuck-order operator surfacing (Claude)

**Files:**
- Verify: `ProcuLink.Worker/Jobs/StuckOrderDetectionJob.cs`, `ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs`
- Modify (frontend): `src/components/bridge/SpineReview.tsx` (and/or the order status display component)

- [ ] **Step 1 — Pull both repos.**
- [ ] **Step 2 — Audit stuck detection.** Read `StuckOrderDetectionJob.cs` + `StuckOrderDetectionService.cs`. Confirm: what threshold flags an order stuck in `parsing`/`delivering`, and what it does (status flip? audit event? log only?). Report findings.
- [ ] **Step 3 — Operator-facing stuck message.** In the order review/status UI, when an order has been `parsing` longer than a threshold (e.g. 2 min) with no completion, show an explicit, honest banner: *"Still processing — if this persists, our team has been alerted. You can retry shortly."* Do NOT show a fake "done" state. Use the existing status-display pattern; do not redesign.
- [ ] **Step 4 — Verify build** (`bun run build`), commit, push.

### Task 0.C — Live golden-path verification (Claude writes; founder runs after 0.A)

- [ ] **Step 1** — Claude writes `docs/superpowers/launch/golden-path-checklist.md` with the exact 10-step live verification (sign in → create org → add supplier → upload CSV → leaves `parsing` → review → resolve mapping → transform → deliver/fail honestly → audit rows). Include a downloadable sample CSV path.
- [ ] **Step 2** 🧑‍💼 — Founder runs the checklist on `https://proculink.eu` after Worker is deployed. Any failure → file as a P0 bug before proceeding to Phase 1 sign-off.

**Phase 0 exit criteria:** a real CSV uploaded on the live domain leaves `parsing`, reaches review, transforms, and either delivers or shows an exact failure — with audit/delivery-attempt rows visible.

---

## Phase 1 — Narrow + truthful launch shell (Claude, frontend)

### Task 1.A — 6-item launch shell via feature flag

**File:** `src/components/bridge/BridgeSidebar.tsx` (NAV array, lines ~21-62)

- [ ] **Step 1 — Pull.**
- [ ] **Step 2 — Add a launch-core flag.** Create `src/lib/launch-flags.ts`:
  ```typescript
  // Single source of truth for first-launch nav scope. Flip LAUNCH_CORE_ONLY=false
  // (or set NEXT_PUBLIC_LAUNCH_FULL_NAV=true) to reveal the full product surface.
  export const LAUNCH_CORE_ONLY =
    process.env.NEXT_PUBLIC_LAUNCH_FULL_NAV !== "true";

  /** hrefs that remain in the sidebar during first launch. */
  export const LAUNCH_CORE_HREFS = new Set<string>([
    "/bridge", "/upload", "/inbox", "/library/suppliers", "/settings", "/help",
  ]);
  ```
- [ ] **Step 3 — Filter NAV.** In `BridgeSidebar.tsx`, when `LAUNCH_CORE_ONLY`, filter each section's `items` to those whose `href` is in `LAUNCH_CORE_HREFS`, and drop now-empty group sections. Keep all NAV entries in the source array — only the *render* is filtered. The result renders flat (Dashboard, Upload, Inbox, Suppliers, Settings, Help) — collapse empty group headers.
- [ ] **Step 4 — Empty-state link audit.** Grep launch-visible components for links into now-hidden routes (`/drafts`, `/library/buyers`, `/library/rules`, `/library/templates`, `/library/standards`, `/operations/*`, `/inbound/*`). Any CTA in a launch-visible screen that points to a hidden route must be removed or repointed. (Hidden routes still resolve if typed directly — that's fine; just no nav/CTA surface.)
- [ ] **Step 5 — Build, commit, push.** Commit msg: `feat(launch): 6-item launch shell behind LAUNCH_CORE flag`.

### Task 1.B — Fix supplier-profiles route mismatch

**Context:** `src/lib/api-client.ts:884-888` calls `/api/supplier-profiles` and `/api/supplier-profiles/{name}`, but `SuppliersController.cs` serves `/api/suppliers/profiles` and `/api/suppliers/{id}/profiles`. Real 404 bug.

**File:** `src/lib/api-client.ts`

- [ ] **Step 1 — Pull. Determine if these functions are reachable in the launch shell.** Grep for `getSupplierProfiles`, `getSupplierProfile`, `createSupplierProfile`, `updateSupplierProfile`, `deleteSupplierProfile` usages. These legacy "SupplierProfile" (output-format/destination) functions are likely only used by the hidden `/library/standards` or supplier-detail. Report where they're called.
- [ ] **Step 2 — Read backend contract.** Read `ProcuLink.Api/Controllers/SuppliersController.cs` routes for profiles (GET `/api/suppliers/profiles`, GET `/api/suppliers/profiles/{supplierName}`, POST `/api/suppliers/{id}/profiles`).
- [ ] **Step 3 — Fix the frontend paths** in `realGetSupplierProfiles` / `realGetSupplierProfile` / `realCreateSupplierProfile` / `realUpdateSupplierProfile` / `realDeleteSupplierProfile` to match the backend exactly. Note the create/update path is supplier-id-scoped (`/api/suppliers/{id}/profiles`), not name-scoped — adapt the function signatures/call sites accordingly. If a call site only has the name, confirm the backend has a name-based route or thread the id through.
- [ ] **Step 4 — If the functions are fully unreachable in the launch shell AND not used anywhere live,** the lighter fix is to leave them but add a `// TODO(post-launch): align with /api/suppliers/profiles` and confirm no launch screen calls them. Prefer fixing over deferring if a launch screen touches them.
- [ ] **Step 5 — Build, commit, push.**

### Task 1.C — Fix mobile marketing nav bug

**Context:** On mobile the marketing nav dropdown renders on top of the hero (hero text bleeds behind the open menu) instead of a proper full-width overlay/scrim or pushing content. See founder's screenshot.

**File:** `src/components/marketing/MarketingNav.tsx`

- [ ] **Step 1 — Pull. Read `MarketingNav.tsx`** — find the mobile menu open state + the dropdown panel markup/styles.
- [ ] **Step 2 — Reproduce + fix.** The open mobile menu must either (a) be a full-screen/full-width overlay with a solid background and a scrim that covers the hero, or (b) push page content down. It must NOT float as a semi-transparent panel over the hero. Ensure: solid `bg` (navy token), correct `z-index` above hero, body scroll lock optional, and an explicit close (X) that's already present. Match Bridge Layer tokens.
- [ ] **Step 3 — Verify** with a mobile-width check (e.g. `bun run build` + a Playwright mobile screenshot if available, or careful CSS review at 390px width).
- [ ] **Step 4 — Commit, push.** Commit msg: `fix(marketing): mobile nav overlay no longer bleeds over hero`.

### Task 1.D — Hide Distributor plan

**Files:** `src/lib/plans.ts`, `src/app/(marketing)/pricing/page.tsx`, `src/types/procurement.ts`

- [ ] **Step 1 — Pull. Read `src/lib/plans.ts`** (Distributor at ~line 179) and the pricing page.
- [ ] **Step 2 — Remove Distributor from the *displayed* ladder.** Keep the `distributor` entry in the type/constants (backend still knows it) but exclude it from the array the pricing page and any in-app plan picker iterate over. Simplest: add `hidden: true` to the Distributor plan object and filter `.filter(p => !p.hidden)` at every render/checkout site. Ensure no checkout CTA can reach Distributor.
- [ ] **Step 3 — Verify** the pricing page shows exactly Pilot / Growth / Operations / Integration / Enterprise, and the in-app upgrade flow offers only the Stripe-checkout plans (Growth/Operations/Integration).
- [ ] **Step 4 — Build, commit, push.**

### Task 1.E — Supplier screens truth pass

**Files:** `src/components/bridge/SupplierDockProfile.tsx`, `SupplierDockList.tsx`, `DeliveryConfigEditor.tsx`

- [ ] **Step 1 — Pull. Read the three components.** Catalogue every cell/metric that renders a placeholder (`—`, demo numbers) for real (non-mock) users.
- [ ] **Step 2 — For each placeholder metric:** either (a) wire it to real data if the backend exposes it, or (b) replace with an explicit *"Not configured yet"* / *"No data yet"* affordance, or (c) remove the field for launch. No metric may *look* operational while showing staged/empty values. Center the supplier detail on the three things that are real: **Mappings, PO Mapping, Delivery config** (+ the new Acceptance tab from 1.F).
- [ ] **Step 3 — Build, commit, push.** Commit msg: `fix(suppliers): truth pass — no placeholder metric reads as operational`.

### Task 1.F — Acceptance tab under Suppliers (M-T8, scoped to acceptance only)

**Context:** Backend live: `GET/POST /api/suppliers/{id}/acceptance-profile`, `POST .../{versionNo}/activate`, `POST /api/orders/{id}/validate`, and passport now surfaces validation results. Build the UI.

**Files:** `src/types/procurement.ts`, `src/lib/api-client.ts`, `src/components/bridge/SupplierDockProfile.tsx`, `src/components/bridge/SpineReview.tsx`

- [ ] **Step 1 — Pull. Add types** `AcceptanceRule`, `AcceptanceProfile`, `OrderValidationResultDto` to `procurement.ts` (shapes per the moat plan: rule = scope/fieldPath/operator/expectedValue/severity/blockOnFail).
- [ ] **Step 2 — Add api-client functions** (real + mock + wire into `apiClient`): `getAcceptanceProfile(supplierId)` (404→null), `saveAcceptanceProfile(supplierId, {protocol, outputFormat, rules})`, `activateAcceptanceVersion(supplierId, versionNo)`, `validateOrder(orderId)`. Use `fetchWithTimeout` + `authHeader`, `res.statusText` errors (match existing style).
- [ ] **Step 3 — Acceptance tab.** Add `"acceptance"` to the `Tab` type + `TABS` array in `SupplierDockProfile.tsx`. Tab body: `useQuery(["acceptance-profile", supplierId])`; show active version + status badge + a rule table (scope/field/operator/value/severity); a rule editor (add/remove rows) with **Save new version** (`useMutation` → `saveAcceptanceProfile`, invalidate the query) and **Activate** for draft versions. Honest empty state when null: *"No acceptance profile yet. Define what this supplier will accept."* Follow existing tab styling.
- [ ] **Step 4 — Validation panel in review.** In `SpineReview.tsx`, add a "Validation" panel with a **Validate against supplier profile** button (`useMutation` → `validateOrder(orderId)`) rendering pass/fail results grouped, fails shown with severity color + message + line number. Initial state: *"Run validation to check this order against the supplier's acceptance rules."* Tight scope — one panel, no redesign.
- [ ] **Step 5 — Build, commit, push.** Commit msg: `feat(acceptance): supplier Acceptance tab + order validation panel`.

### Task 1.G — Fold exceptions into dashboard/per-order; clean stale comment

**Context:** Per decision, NO standalone `/operations/exceptions` page for launch. Exception data surfaces via the existing Dashboard "urgent exceptions" KPI (already wired to `orders-summary`) + per-order display.

**Files:** `src/components/bridge/BridgeDashboard.tsx`, `src/components/bridge/SpineReview.tsx`

- [ ] **Step 1 — Pull. Remove the stale topology comment** at `BridgeDashboard.tsx:7-8` ("aggregation isn't live yet, so we derive it") — the endpoint IS live and consumed; the comment now misleads. Replace with an accurate one (endpoint-first, client-derived fallback).
- [ ] **Step 2 — Per-order exceptions.** In `SpineReview.tsx`, add `useQuery(["order-exceptions", orderId], () => apiClient.getOrderExceptions(orderId))` and render open exceptions inline near the issues area (severity dot + message). Add the `getOrderExceptions(orderId)` api-client function calling `GET /api/orders/{id}/exceptions` (real+mock). This gives operators the durable exception list without a separate ops console.
- [ ] **Step 3 — Confirm** the Dashboard "urgent exceptions" KPI already reflects the summary counts (it does, from this session). No change unless it links to the now-hidden `/operations/exceptions` — if so, repoint to `/inbox?status=failed` or remove the link.
- [ ] **Step 4 — Build, commit, push.**

**Phase 1 exit criteria:** sidebar shows 6 items; no launch-visible CTA points to a hidden/placeholder screen; mobile marketing nav is fixed; pricing shows 5 plans; supplier + acceptance + validation UX is truthful and functional.

---

## Phase 2 — Stripe readiness (Claude codes now; founder activates after 2026-06-09)

### Task 2.A — One authoritative plan ladder + price-ID validation

**Files:** backend `ProcuLink.Infrastructure/Services/StartupConfigurationValidator.cs`, `ProcuLink.Core/Constants/PlanConstants.cs`, `StripeBillingService.cs`; frontend `src/lib/plans.ts`

- [ ] **Step 1 — Pull. Produce one pricing matrix** (plan → monthly price, yearly price, order limit, supplier limit, Stripe checkout? ) as a short doc `docs/superpowers/launch/pricing-matrix.md`. Authoritative: Pilot (trial, no checkout), Growth/Operations/Integration (checkout), Enterprise (contact), Distributor (hidden, not sold at launch).
- [ ] **Step 2 — Reconcile code to the matrix.** Confirm `PlanConstants` limits match. Confirm `plans.ts` copy matches. If yearly prices are part of the matrix, ensure `StripeBillingService` resolves a yearly price ID per plan and those keys exist in `StartupConfigurationValidator.ApiRequiredKeys` (W1-T2 added `DistributorPriceId`; add `*YearlyPriceId` for any plan sold yearly, or document monthly-only for launch).
- [ ] **Step 3 — Build + full backend test suite + frontend build. Commit, push.**

### Task 2.B — Stripe webhook → org-plan integration test

**Context:** W2-T5 review flagged the happy-path Stripe handlers (`checkout.session.completed` → org plan upgraded; `customer.subscription.deleted` → revert to Pilot) as untested — the most consequential billing logic. Close it.

**File:** `ProcuLink.Api.Tests/Controllers/BillingControllerTests.cs` (or a new integration test)

- [ ] **Step 1 — Pull. Read** `BillingController.HandleStripeEventAsync` + `HandleCheckoutCompletedAsync` (private) and how it resolves price→plan and writes `Organisation.Plan`.
- [ ] **Step 2 — Make the handler testable** if it isn't: extract the plan-mutation logic (read session metadata → resolve plan → update org) into an internal method or `IBillingService` member that can be invoked without a valid Stripe signature. Keep the signature-verification at the controller edge.
- [ ] **Step 3 — Test** with in-memory EF: seed an org on Pilot → invoke the checkout-completed handler with a known price ID → assert `org.Plan` upgraded + limits updated. Test subscription-deleted → reverts to Pilot read-only. Test that Pilot expiry/cancel does NOT grant a fresh free trial.
- [ ] **Step 4 — Full suite, commit, push.**

### Task 2.C 🧑‍💼 Stripe activation (after company registration, on/after 2026-06-09)

- [ ] Register company in Stripe.
- [ ] Create live products + prices for Growth/Operations/Integration (monthly, + yearly if in matrix).
- [ ] Set `Stripe__*` price-ID env vars in Railway (API + Worker if needed) and any `NEXT_PUBLIC_*` price metadata in Vercel.
- [ ] Configure the Stripe webhook endpoint for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- [ ] Test in Stripe **test mode** first: Pilot → Growth checkout → confirm org plan/limits update via webhook → Portal → cancel → confirm read-only (no fresh trial). Then switch to live.

**Phase 2 exit criteria (post-Jun-9):** a real Pilot org can upgrade, the webhook updates the DB, limits change, and cancellation downgrades correctly without resetting the trial.

---

## Phase 3 — Trust + autonomy

### Task 3.A — Live E2E smoke (golden path + mobile marketing)

**Files:** `tests/e2e/` (existing live-mode specs as the pattern)

- [ ] **Step 1 — Pull. Read** the existing live specs (`tests/e2e/live-po-loop.spec.ts`, `live-po-failure-states.spec.ts`) for the auth + live-mode pattern.
- [ ] **Step 2 — Add a mobile-viewport marketing smoke** that opens the marketing nav at 390px and asserts the hero is NOT visible behind the open menu (the bug from the screenshot) — this is the regression guard.
- [ ] **Step 3 — Confirm the golden-path live spec** covers upload→parse→review→transform→deliver/fail against the deployed env (it largely does per CLAUDE.md). Note any gap; don't rebuild what exists.
- [ ] **Step 4 — Document** how to run them in CI / a browser-capable env (the founder's note: the current Codex desktop can't launch Chromium). Commit, push.

### Task 3.B — Support email honesty + 🧑‍💼 Resend verification

- [ ] **Step 1 (Claude)** — Read `Program.cs` `ConsoleEmailSender` wiring + the support endpoint. Ensure that in **production**, if no real SMTP/Resend sender is configured, the support form does NOT return a success state — it should surface a clear "email not yet configured" path or fall back to showing the support address directly. No fake "we got your message."
- [ ] **Step 2** 🧑‍💼 — Verify the Resend domain, add DNS records, set the support sender/from address, send a real test from the live contact form, confirm receipt.

### Task 3.C — Observability confirm

- [ ] **Step 1 (Claude)** — Verify Sentry is wired in both API and frontend (DSN env) and that an unhandled error reports. Verify the stuck-order detection (0.B) emits something operator/ops-visible (log + audit). List what alerting exists vs missing.
- [ ] **Step 2** 🧑‍💼 — Confirm Sentry receives events from prod; decide if a lightweight uptime/status check is wanted pre-launch.

**Phase 3 exit criteria:** the mobile bug has a regression test; support never fakes success; errors are observable.

---

## Sequencing & ownership summary

| When | Tasks | Owner |
|---|---|---|
| **Now → Worker live** | 0.A deploy | 🧑‍💼 Founder |
| Parallel to 0.A | 0.B stuck-surfacing, 1.A shell, 1.C mobile nav, 1.D Distributor | Claude |
| After 0.A | 0.C golden-path run | 🧑‍💼 + Claude |
| After shell | 1.B routes, 1.E truth pass, 1.F acceptance UI, 1.G fold exceptions | Claude |
| Code now | 2.A ladder, 2.B webhook test | Claude |
| **On/after Jun 9** | 2.C Stripe activation | 🧑‍💼 Founder |
| Pre/post launch | 3.A E2E, 3.B support, 3.C observability | Claude + 🧑‍💼 |

**Hard launch gate:** Phase 0 complete (live loop works) + Phase 1 complete (narrow truthful shell) = soft launch / pilot onboarding can begin. **Paid** launch gate adds Phase 2.C (Stripe live, after Jun 9).

---

## Self-Review

**Coverage vs deep-research "must happen before production":** Worker (0.A/0.B), golden-path smoke (0.C/3.A), prune UI (1.A), route mismatch (1.B), explicit states (0.B + 1.E + 1.G), unify pricing/Stripe (2.A/2.B/2.C), verify support (3.B), observability (3.C). The report's "supplier placeholder" → 1.E; "mobile" (founder image) → 1.C; "Distributor" → 1.D. All mapped.

**Deliberately deferred to post-launch (per deep research "can wait"):** Buyers/Invoices/ASNs/Standards as nav (hidden in 1.A), tsconfig strictness, api-client.ts split, broad rules/templates/webhooks admin UX, scanned-PDF OCR. Documented, not lost.

**Scope honesty:** Founder-ops tasks (🧑‍💼: Railway deploy, Stripe dashboard, Resend DNS, Sentry confirm) are explicitly NOT Claude work — they're checklists. Every Claude task names exact files and ends in build+commit+push.

**No placeholders in Claude tasks:** each names the file, the change, and the verification. UI tasks point to the established responsive components to match rather than embedding speculative JSX — consistent with how the moat frontend tasks were specified.
