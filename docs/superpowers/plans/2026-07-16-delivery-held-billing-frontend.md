# Delivery Held (billing hold) — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the live `delivery_held` order status a truthful home in the UI: a label, a place in the "needs attention" surfaces, and an explanation that says the delivery is *paused because of a billing issue* and *resumes automatically* — never that it failed, and never that it is still processing.

**Architecture:** The status is a new member of the `OrderStatus` union; everything else keys off that. The Inbox's collapsed `CrossingStatus` gains a matching `held` member (there is no honest existing bucket — see Task 1). The explanation lives in a dedicated `OrderWorkshop` panel added to the existing failure-gate chain (the workshop's 3-column layout is LOCKED — add to the chain, do not restructure). **No backend work is required** and none should be invented: the status, the hold, and the auto-release all shipped already.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, TanStack Query v5, **bun** (never npm/yarn).

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`
**Sibling plan (same class of gap, different status):** `ProcuLink/docs/superpowers/plans/2026-07-16-delivery-unconfirmed-park-frontend.md` — this plan is that plan's "Findings that are NOT this plan's job" item #1.

## What the backend actually does (verified against `origin/main` of `ProcuLink`, not assumed)

Read before writing any copy — every honesty claim below is load-bearing:

- `OrderStatusConstants.DeliveryHeld = "delivery_held"`. Doc comment: *"Delivery paused because the org cannot currently process orders (billing: past_due / read_only / trial_expired / cancelled) at the moment its transform-ready order reached the delivery job. NOT a failure and NOT lost: the transformed artifact is intact."*
- `DeliveryService.HoldForBillingAsync` holds **only** from `ready_to_deliver` or `delivery_failed`; sets `Status = delivery_held`, nulls `DeliveryDueAt` and clears `SlaBreached` (the SLA clock is paused, so a held order is *not* overdue), and writes an `AuditEvent` with `Action = "DeliveryHeldForBilling"`.
- `DeliveryService.ReleaseBillingHeldOrdersAsync` moves every held order back to `ready_to_deliver` and re-drives delivery when the org returns to good standing. **The release is automatic.** `StripeSubscriptionReconciliationService` calls it on the reconciliation path too, precisely so held orders can't strand.
- **`HoldForBillingAsync` does NOT set `order.ErrorMessage`.** The reason lives only in the audit payload. So — unlike the sibling plan — there is **no backend `errorMessage` to prefer**. The frontend copy is the only copy. Do not write `errorMessage ?? "…"` for this status.
- **`OrderStatusMachine.RedeliverableFrom = { delivery_failed, ready_to_deliver }` — `delivery_held` is NOT in it.** `POST /api/orders/{id}/redeliver` returns 400 for a held order. This is deliberate: releasing is billing's job, not a button's.
- `OrderStatusMachine.Transitions[DeliveryHeld] = { ready_to_deliver, ready, rejected_by_supplier }`.

## Global Constraints

- **Work in an isolated git worktree**, not the shared checkout — parallel agents collide on `.next`. Audit/fix against `origin/main`, not a possibly-stale local `main`.
- **bun only.** `bun install`, `bun run dev`, `bun run build`, `bun test`.
- App Router + `next/navigation`. No `react-router-dom`, no `VITE_*`, no `@clerk/clerk-react`.
- TanStack Query for server state, in Client Components only. No `useEffect` fetching.
- **The 3-column Order Workshop layout is LOCKED.** Add to the existing failure-gate chain; do not restructure.
- **Plain-language copy.** No internal jargon — never "delivery_held", "A5", "billing gate", "hold", "park", "org". CLAUDE.md §9: the user-facing word is *supplier* / *order* / *plan*, and the billing vocabulary is already pinned in CLAUDE.md §11.5 ("Processing paused", "Upgrade to Growth to continue").
- **Never render `delivery_held` as a failure.** No red, no "Failed" pill, no dead-letter bucket. The artifact is intact; the claim "this failed" is one we cannot support and the operator would act on it wrongly (they'd chase the supplier, not the invoice).
- **Never offer "Send again" for a held order.** The backend returns 400 (`RedeliverableFrom` excludes it) — a button that always errors is worse than no button. The honest action is "resolve billing"; the release is automatic.
- Verify in the browser before claiming done — render at **390px** as well; a static read of the JSX is not verification.

---

### Task 1: The status exists in the type system and reads honestly

**Files:**
- Modify: `src/types/procurement.ts:59-70` (the `OrderStatus` union)
- Modify: `src/components/bridge/UnifiedStatusBadge.tsx:71-119` (`STATUS_META`)
- Modify: `src/components/bridge/StatusJourney.tsx:144-175` (`CrossingStatus`, `STATUS_PILL`, `STATUS_STAGE`)
- Modify: `src/app/globals.css:513-526` (the `.pill-*` block)
- Modify: `src/components/bridge/InboxView.tsx:78-90` (`STATUS_PRESENTATION`) and `:232-239` (`mapStatus`)

**Interfaces:**
- Produces: `"delivery_held"` as a member of `OrderStatus`, and `"held"` as a member of `CrossingStatus`. Every later task depends on both.

- [ ] **Step 1: Add the union member**

`src/types/procurement.ts` — add to the `OrderStatus` union, next to the other delivery states:

```ts
  | "delivery_held"
```

- [ ] **Step 2: Add the badge label**

`src/components/bridge/UnifiedStatusBadge.tsx` — add to `STATUS_META`, in its own section between "Delivery" and "Failures" (it belongs to neither):

```ts
  // Billing hold: the supplier file exists and is intact; we simply didn't send it
  // because the plan can't process orders right now. It auto-releases on reactivation.
  // "Delivery paused" is the honest label — never "failed" (nothing failed) and never
  // a `pulse` (nothing is in flight; it is waiting on a human's invoice, not on us).
  delivery_held: { label: "Delivery paused", tone: "warning" },
```

**Note for the implementer:** `tone: "warning"` is the amber attention-needed tone the file already defines (`review` / `pending_review` use it). Do not invent a tone and do not reuse `danger`.

- [ ] **Step 3: Add the collapsed Inbox bucket**

`src/components/bridge/StatusJourney.tsx` — `CrossingStatus` has seven members and **not one of them is honest for a held order**: `review` says "Needs review" (it doesn't — the order is clean), `delivering` pulses blue "Ready to send" (it isn't — it's blocked), `failed` is red (it didn't). Add a member:

```ts
export type CrossingStatus = "new" | "extracting" | "review" | "ready" | "sent" | "delivering" | "failed" | "held";
```

`STATUS_PILL` and `STATUS_STAGE` are `Record<CrossingStatus, …>`, so the compiler will name both holes. Fill them with the amber tokens (`--amber-soft` / `--amber-text` / `--amber`, matching `review`'s row) and **no pulse**, at stage `4` (Deliver — the order reached delivery and stopped there).

`src/app/globals.css` — add `.pill-held` / `.pill-held .dot` next to `.pill-review`, mirroring its amber values and omitting the `pulse-dot` animation `.pill-delivering` has.

- [ ] **Step 4: Map it in the Inbox's collapsed view**

`src/components/bridge/InboxView.tsx` — `mapStatus` falls through to `return "new"` for unmapped statuses, which shows a held order at stage 0 of the pipeline rail ("New") — the exact opposite of the truth (it got all the way to Deliver). Add the explicit mapping and the matching `STATUS_PRESENTATION` entry (`key: "held"`, `label: "Delivery paused"`, `stage: 4`).

**Note for the implementer:** `delivery_dead_letter` and `rejected_by_supplier` ALSO fall through to `"new"` today — that is a pre-existing bug. **Do not fix it here.** Note it in your report; it is a separate change with its own review.

- [ ] **Step 5: Verify**

Run: `bun run build`
Expected: compiles with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/procurement.ts src/components/bridge/UnifiedStatusBadge.tsx src/components/bridge/StatusJourney.tsx src/app/globals.css src/components/bridge/InboxView.tsx
git commit -m "feat(orders): add delivery_held status with an honest paused label"
```

---

### Task 2: Fix the surface that actively misleads

**Files:**
- Modify: `src/components/bridge/review/hooks/useOrderReview.ts:22-42` (`finalDeliveryMessage`)
- Modify: `src/components/bridge/ExceptionDetail.tsx:42-53` (`deliveryStatusCopy`)

**Interfaces:**
- Consumes: the `OrderStatus` member (Task 1).

**Why this is its own task:** `finalDeliveryMessage` falls back to **"Delivery is still processing. Refresh the order or check the Delivery Log for the latest attempt."** For a held order every clause of that is false: nothing is processing, refreshing changes nothing, and the Delivery Log has no attempt to show. It tells the operator to wait for a system that is, in fact, waiting for them. `deliveryStatusCopy`'s fallback ("This order has not been sent yet.") is *technically* true but gives no reason and pairs with a humanized `Delivery held` label — uninformative rather than false, so it's the lesser of the two.

- [ ] **Step 1: Fix the review-hook message**

`src/components/bridge/review/hooks/useOrderReview.ts` — add an explicit branch before the fallback:

```ts
  if (status === "delivery_held") {
    return "Delivery is paused because your plan can't process orders right now. The supplier file is generated and waiting — nothing has been lost. Sending resumes automatically once your billing is up to date.";
  }
```

**Note for the implementer:** do **not** write `errorMessage ?? "…"` here the way the neighbouring branches do. `HoldForBillingAsync` never sets `ErrorMessage`, so the `errorMessage` on a held order is whatever the *previous* `delivery_failed` attempt left behind — surfacing it would explain the wrong problem.

- [ ] **Step 2: Fix the exceptions-queue copy**

`src/components/bridge/ExceptionDetail.tsx` — add an explicit branch to `deliveryStatusCopy` before the fallback. Note the guard ordering: the existing first line matches `s.includes("deliver")`, so place the branch where it actually runs. `tone: "warn"`, label `"Delivery paused — billing"`.

- [ ] **Step 3: Verify**

Render an order in `delivery_held` in both the exceptions queue and the review screen. Confirm neither says "still processing" nor shows a red failure tone.

- [ ] **Step 4: Commit**

```bash
git add src/components/bridge/review/hooks/useOrderReview.ts src/components/bridge/ExceptionDetail.tsx
git commit -m "fix(orders): a billing-held order no longer claims delivery is still processing"
```

---

### Task 3: A held order counts as needing attention — but never as failed

**Files:**
- Modify: `src/components/bridge/BridgeDashboard.tsx:60-88` (`EXCEPTION_STATUSES`)
- Modify: `src/components/bridge/BridgeTopbar.tsx:247-251` (`NOTIF_META`) and `:271-291` (classifier + `unread`)
- Modify: `src/components/bridge/LaneDrawer.tsx:53-68` (`liveStatusDot`)
- Modify: `src/components/bridge/inboxSend.ts:16-24` + `inboxSend.test.ts` (lock the exclusion)

**Interfaces:**
- Consumes: the `OrderStatus` member (Task 1).
- Produces: `isRedeliverable("delivery_held") === false`, locked by a test.

- [ ] **Step 1: Dashboard**

`BridgeDashboard.tsx` — add `"delivery_held"` to `EXCEPTION_STATUSES` (it needs a human; that is the bucket's definition). Do **not** add it to `FAILED_STATUSES` (it didn't fail) and do **not** add it to `ACTIVE_STATUSES` (it isn't moving — that's the point).

- [ ] **Step 2: Notification bell**

`BridgeTopbar.tsx` — the classifier's three `kind`s are `review | failed | delivered`; a held order is none of them, so it is dropped and never notifies. Add a fourth `kind: "held"` with its own `NOTIF_META` row (amber dot, label `"Delivery paused"`), give it a `rank` between `failed` and `review`, and add `delivery_held` to the `unread` summary sum.

**Note for the implementer:** `NOTIF_META` is typed `Record<"review" | "failed" | "delivered", …>` and the `kind` union is repeated in three places in this file (the local `let kind`, the `.filter()` type predicate, and the `NOTIF_META` type). Update all of them or it won't compile.

- [ ] **Step 3: Lane drawer dot**

`LaneDrawer.tsx` — `liveStatusDot`'s `default` returns the blue "in progress" dot. Add an explicit amber (`#B36D14`) case; a held order is not progressing.

- [ ] **Step 4: Lock the redeliver exclusion with a test**

`inboxSend.ts` — do **not** add `delivery_held` to `REDELIVERABLE_STATUSES`. Instead extend the file's existing WHY comment to record that the exclusion is deliberate and mirrors the backend, then add a test asserting `isRedeliverable("delivery_held") === false`. Without it, the next person "completing the set" ships a bulk-send button that 400s.

- [ ] **Step 5: Verify**

Run: `bun test && bun run build`
Expected: green. Then render the dashboard with a held order and confirm it appears in "Needs attention" and in the bell, and that the Inbox row's bulk-select checkbox stays disabled.

- [ ] **Step 6: Commit**

```bash
git add src/components/bridge/BridgeDashboard.tsx src/components/bridge/BridgeTopbar.tsx src/components/bridge/LaneDrawer.tsx src/components/bridge/inboxSend.ts src/components/bridge/inboxSend.test.ts
git commit -m "feat(orders): a billing-held order needs attention, and is not redeliverable"
```

---

### Task 4: The workshop explains the pause and points at the fix

**Files:**
- Modify: `src/components/bridge/workshop/OrderWorkshop.tsx:438-446` (failure-gate chain)
- Modify: `src/components/bridge/review/hooks/useSendFlow.ts:176-183` (poll predicate)
- Create: `src/components/bridge/workshop/BillingHeldPanel.tsx`

**Why the workshop needs a panel:** the gate chain catches `failed` / `transform_failed` / `delivery_failed`. `delivery_held` matches none, so it falls through to the normal mapper with a live **Send** button — which calls `redeliverOrder` and gets a 400. The operator gets an opaque error and no idea their invoice is the cause.

- [ ] **Step 1: Fix the send-flow poll predicate**

`useSendFlow.ts` — the terminal set is `delivered | delivery_failed | rejected_by_supplier | delivery_dead_letter`. A Send from `ready_to_deliver` for a lapsed org lands in `delivery_held`, so the poll burns its full 45s and paints a false red "Send failed" for an order that was deliberately paused. Add `delivery_held` to the predicate; `finalDeliveryMessage` (Task 2) already renders the honest sentence for it.

- [ ] **Step 2: Build the panel**

Mirror `FailedPanels.tsx`'s structure (its `T` token object, card shape, and back-link), but amber not red. Content:

- Title: `Delivery paused`
- Body: the Task 2 sentence (single source of copy — import `finalDeliveryMessage` or lift the string to one exported const; do not retype it).
- A reassurance line that the supplier file is ready and nothing needs redoing.
- Primary action: **Go to billing** → `/settings?tab=billing` (a `next/link`; the settings page already honours `?tab=`).
- **No Send button.** State plainly that sending resumes on its own.

- [ ] **Step 3: Add it to the gate chain**

```tsx
  if (order.status === "delivery_held") {
    return <BillingHeldPanel order={order} />;
  }
```

- [ ] **Step 4: Verify in the browser**

Open a held order's workshop. Confirm the panel renders, the billing link navigates, and no Send button is present. Render at 390px. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/components/bridge/workshop/ src/components/bridge/review/hooks/useSendFlow.ts
git commit -m "feat(orders): billing-held workshop panel + stop the false 'Send failed'"
```

---

### Task 5: Documentation (offer ⇔ works)

**Files:**
- Modify: `src/app/(marketing)/help/dashboard-and-statuses/page.mdx:24-32`

- [ ] **Step 1:** Add **Delivery paused** to the status glossary. Put it in the *normal* statuses table, **not** the failure table — the page's framing ("Each failure state also opens an entry in the exceptions queue, so nothing fails silently") would be wrong for it. One row: paused for billing, file intact, resumes automatically.
- [ ] **Step 2:** `bun run build` — MDX compiles.
- [ ] **Step 3:** Commit.

---

### Task 6: Full verification

- [ ] **Step 1:** `bun test` — report real counts.
- [ ] **Step 2:** `bun run build` — no type errors, no new warnings.
- [ ] **Step 3:** Render the held flow: Inbox badge → dashboard "Needs attention" → bell → workshop panel. Screenshot, incl. 390px.
- [ ] **Step 4:** Push, then `gh run list` — local green ≠ CI green.

---

## Blocked / out of scope — report, do not fix

1. **`/operations/health` will show a green "All clear" while orders are held.** The `allClear` gate is a fixed list of zero-checks and a held order is invisible to every one of them. The honest fix needs `OpsHealthSummary` (`ProcuLink.Core/Services/IOpsHealthService.cs:54-85`) to gain a `DeliveryHeld` count — **it does not have one** (verified against `origin/main`). Per the sibling plan's rule: do not fake it and do not derive it client-side from a list endpoint; a wrong "All clear" is worse than a missing tile. **This is a backend task and a real live truthfulness bug.**
2. **`mapStatus` drops `delivery_dead_letter` and `rejected_by_supplier` to `"new"`** (`InboxView.tsx:232-239`), showing terminal orders at stage 0. Pre-existing; inherited from the sibling plan's finding list.
3. **`InboxView.tsx` has a second label source** (`STATUS_PRESENTATION`) that its own comment (lines 65-69) flags as needing consolidation with `STATUS_META`.
