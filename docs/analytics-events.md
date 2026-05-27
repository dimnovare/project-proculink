# ProcuLink Analytics Event Plan

## Overview

Events are structured for PostHog (or equivalent product analytics). Implementation
is deferred to the Group J live QA pass — this document is a planning reference.

**Rules:**
- All events must be no-ops if PostHog is not initialised (key not configured)
- Never log PII in event payloads (no email addresses, names, or PO line content)
- Wrap every `analytics.track()` call in a `try/catch` — analytics must never block UI
- Use a thin `analytics.ts` wrapper so the underlying provider can be swapped

---

## Events

### `signup`
**Trigger:** User completes Clerk sign-up and reaches `/bridge` for the first time.
**Component:** Clerk `afterSignUp` redirect handler or backend Clerk webhook.
**Payload:**
```json
{
  "plan": "pilot",
  "source": "organic | utm_campaign=... | <referrer domain>"
}
```

---

### `first_upload`
**Trigger:** First successful order upload — API responds 200 with a new order ID.
**Component:** `UploadWorkbench` — inside the `handleUpload` success callback.
**Payload:**
```json
{
  "file_format": "csv | xlsx | pdf | cxml | edi",
  "supplier_id": "<uuid>"
}
```

---

### `first_transform_success`
**Trigger:** First time an order artifact is generated — status transitions to `ready_to_deliver`.
**Component:** `OrderDetailPage` — detect first `ready_to_deliver` via polling useQuery.
**Payload:**
```json
{
  "output_format": "csv | xml | cxml",
  "order_id": "<uuid>"
}
```
**Note:** Track only once per account using a localStorage flag `pl_first_transform_fired`.

---

### `first_delivery`
**Trigger:** First order status transitions to `delivered`.
**Component:** `OrderDetailPage` polling — detect `delivered` for the first time.
**Payload:**
```json
{
  "delivery_protocol": "http | sftp | erp_erply | erp_directo",
  "order_id": "<uuid>"
}
```
**Note:** Track only once per account using a localStorage flag `pl_first_delivery_fired`.

---

### `billing_upgrade_click`
**Trigger:** User clicks any billing upgrade / "Choose plan" CTA.
**Component:** `BillingSection` (settings), upload 429 banners, pricing page CTAs.
**Payload:**
```json
{
  "from_plan": "pilot | growth | operations | integration",
  "target_plan": "growth | operations | integration | enterprise",
  "source": "settings | upload_limit | supplier_limit | pricing_page"
}
```

---

### `mapping_accepted`
**Trigger:** User accepts an AI-suggested supplier item code.
**Component:** `OrderDetailPage` line resolution — "Use suggestion" action.
**Payload:**
```json
{
  "order_id": "<uuid>",
  "line_number": 1,
  "confidence": 0.84,
  "provenance": "Buyer code/description evidence plus nearby supplier mapping pattern"
}
```

---

### `mapping_rejected`
**Trigger:** User clears an AI suggestion and enters their own code manually.
**Component:** `OrderDetailPage` line resolution — clear suggestion action.
**Payload:**
```json
{
  "order_id": "<uuid>",
  "line_number": 1
}
```

---

## Implementation Notes

### Analytics wrapper (for Group J implementation)

```typescript
// src/lib/analytics.ts
declare global {
  interface Window { posthog?: { capture: (event: string, props?: object) => void } }
}

export function track(event: string, props?: Record<string, unknown>) {
  try {
    if (typeof window !== "undefined" && window.posthog) {
      window.posthog.capture(event, props);
    }
  } catch {
    // analytics must never throw
  }
}
```

### PostHog setup (when ready for Group J)

1. `bun add posthog-js`
2. Initialise in `src/app/layout.tsx` via a client-side `PostHogProvider` wrapper
3. Set `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` in Vercel env vars
4. Replace placeholder `track()` calls with PostHog calls via the wrapper
5. Verify no PII is captured in the PostHog session recordings — configure
   `person_profiles: "identified_only"` to avoid anonymous profile creation

### Session recording

If PostHog session recording is enabled, apply input masking to:
- Order file upload inputs
- Supplier code fields
- Credential fields (IMAP password, webhook auth token)
