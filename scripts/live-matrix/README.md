# Live test harnesses

This folder holds the founder-runnable LIVE harnesses + a browser-console matrix runner.
All of them talk to a deployed ProcuLink (`https://api.proculink.eu` by default) and are
**resumable / bounded** so they can be re-run repeatedly.

| File | Channel | Auth | Run with |
|---|---|---|---|
| `ingest-harness.mjs` | API ingress (structured orders) | API key `plk_…` | `node`/`bun` |
| `format-upload-harness.mjs` | File-upload PARSERS (CSV/UBL/cXML/IDoc/EDIFACT/X12 + opt. XLSX/PDF) | Clerk JWT (~60 s) | `node`/`bun` |
| `inbound-email-harness.mjs` | Hosted inbound email (Postmark webhook) | Postmark webhook token | `node`/`bun` |
| `delivery-testfire-harness.mjs` | Outbound delivery (HTTP test-fire) | Clerk JWT (~60 s) | `node`/`bun` |
| `runner.js` | Full inbound × outbound matrix | Browser Clerk session | DevTools console |

For a full "click every screen + hammer the heart-piece" UI sweep, see the Playwright spec
`tests/e2e/live-full-e2e.spec.ts` (`bun run test:e2e:full`) — its header documents both the
local QA-bypass run and the deployed-env saved-session run.

### Quick start — the headless harnesses

```bash
# 1) File-format parser coverage (text formats synthesized; binaries optional)
PLK_API=https://api.proculink.eu \
PLK_CLERK_TOKEN="$(: paste await window.Clerk.session.getToken())" \
PLK_SUPPLIER_ID="<supplier uuid>" \
  bun scripts/live-matrix/format-upload-harness.mjs
#   add binaries:  PLK_XLSX_B64="$(base64 -w0 order.xlsx)" PLK_PDF_B64="$(base64 -w0 order.pdf)"

# 2) Hosted inbound email (Postmark webhook). Token = Railway Inbound__Postmark__WebhookToken
PLK_API=https://api.proculink.eu \
PLK_POSTMARK_TOKEN="<Inbound__Postmark__WebhookToken>" \
PLK_INBOUND_TO="orders@<org-slug>.proculink.eu" \
PLK_COUNT=3 \
  bun scripts/live-matrix/inbound-email-harness.mjs

# 3) Outbound delivery test-fire against a catcher URL (e.g. https://webhook.site/<uuid>)
PLK_API=https://api.proculink.eu \
PLK_CLERK_TOKEN="<fresh Clerk JWT>" \
PLK_SUPPLIER_ID="<supplier uuid>" \
PLK_CATCHER_URL="https://webhook.site/<your-uuid>" \
  bun scripts/live-matrix/delivery-testfire-harness.mjs
#   (sftp/ftps/smtp/erp_erply/erp_directo config templates are commented at the bottom of the file)
```

> **Clerk JWTs expire in ~60 s.** Grab a fresh one right before running from a signed-in tab's
> console: `await window.Clerk.session.getToken()`. The Postmark token does NOT expire — it's the
> shared webhook secret on Railway (set on both the API and Worker services).

---

# Live format-matrix runner (browser console)

A **self-contained, browser-console** runner that exercises the full inbound × outbound
format matrix LIVE against `https://api.proculink.eu`, using the authenticated tab's own
Clerk session. No token is ever hardcoded — it calls `window.Clerk.session.getToken()`
fresh on every request.

`runner.js` is the whole thing. Paste it into the DevTools console of a signed-in
`proculink.eu` (or `app.proculink.eu`) tab and drive it with `window.__matrixRun()`.

## What it does

1. **Generates fixtures in-page** for each text inbound format, parameterized by line count,
   values, and (for CSV) locale (`en` comma-decimal vs `eu` semicolon-delimited comma-decimal):
   - CSV, UBL Order XML, cXML `OrderRequest`, SAP IDoc `ORDERS05` XML, EDIFACT `ORDERS`, X12 `850`.
   - Plus one **adversarial** variant per format (malformed/unparseable) to confirm the
     error path is honest (records `parseOk:false` and keeps going).
   - **XLSX and PDF are binary** — never fabricated. Pass base64 via
     `__matrixRun({ xlsxB64, pdfB64 })` and only then are they uploaded.
2. **Uploads** each fixture via `POST /api/orders/upload` (multipart `file` + `supplierId`),
   then **polls** `GET /api/orders/{id}` until the order leaves a parsing state.
3. **Parse-once / transform-to-many**: for every parsed order it transforms into **every**
   outbound format (`csv json xml cxml ubl x12`). `csv`/`json` go through the cheap,
   non-mutating **preview** endpoint (`POST /api/orders/{id}/mapping-override/preview?format=`);
   the rest go through `POST /api/orders/{id}/transform?format=`.
4. **Records** each combo on `window.__matrix.combos` with: `inboundFormat`, `outboundFormat`,
   `parseOk`, `parseLines`, `transformOk`, `transformStatus`, `outLen`, `validOut`, `via`, `error`.
   A rollup lands on `window.__matrix.summary`.

## How to run (browser console / Claude-in-Chrome)

1. Open an **authenticated** tab on `https://proculink.eu`. Confirm `window.Clerk.session` exists.
2. Open DevTools → Console. Paste the entire contents of `runner.js`. You'll see
   `[matrix] runner loaded.`
3. Run one bounded batch:
   ```js
   await window.__matrixRun();
   ```
   Each call returns in **under 40 s**, does **at most 6 uploads**, and prints progress.
4. **Repeat** the call. It's resumable — combos already in `window.__matrix` are skipped and
   orders already uploaded are reused, so re-runs don't burn the upload budget. Keep calling
   until `summary.notes` no longer says the upload window is full and `newCombosThisCall` is 0.
5. With binary formats:
   ```js
   await window.__matrixRun({
     xlsxB64: "<base64 of a real .xlsx>",
     pdfB64:  "<base64 of a real .pdf>"
   });
   ```
6. Inspect results: `window.__matrix.summary`, `window.__matrix.combos`,
   `window.__matrix.orders`. To start clean: `window.__matrixReset()`.

Via Claude-in-Chrome, paste `runner.js` with `javascript_tool`/`preview_eval`, then call
`await window.__matrixRun()` repeatedly with a short wait between calls to let the upload
window drain.

## Pacing (rate limits)

- The per-user upload window is **20 uploads / 60 s**. The runner self-throttles to
  **≤ 18 / 60 s** (headroom) and **≤ 6 uploads per `__matrixRun()` call**, tracking real
  timestamps on `window.__matrix.uploadTimestamps`. If the window is full it records a note
  and returns — just call again ~1 min later.
- **Transforms/previews are not in the upload window**, so the fan-out is free and only
  bounded by the per-call ~38 s time budget.

## Combos-per-upload math (how we reach 2000+)

- **1 upload → 1 parsed order → 6 outbound combos** (one per outbound format).
- Text inbound formats = 6 (CSV, UBL, cXML, IDoc, EDIFACT, X12). With `perFormat:2` valid
  variants + 1 adversarial each = **3 fixtures × 6 = 18 text uploads**.
  Add XLSX + PDF (1 caller-supplied each) = **20 uploads** total in a default full run.
- Combos = uploads × outbound formats = **20 × 6 = 120 combos per full pass**.

To reach **2000+ combos**, scale fixtures (the matrix is uploads × 6):

| Want | uploads needed | how |
|---|---|---|
| 120 | 20 | default (`perFormat:2`, no binaries) |
| ~360 | 60 | `perFormat:9` (≈10 fixtures/text format) |
| **2040** | **340** | `perFormat:55` → ≈56 fixtures × 6 formats ≈ 336 text uploads + binaries, **× 6 outbound = 2040+** |

`uploads = (perFormat + 1) × 6 (+ binaries)`, and `combos = uploads × 6`.
So **`combos ≈ ((perFormat + 1) × 6) × 6`**. For 2000+: `perFormat ≈ 55`.

At ≤18 uploads/60 s, 340 uploads ≈ **19 windows ≈ ~19 minutes** of wall-clock, spread across
~57 calls to `__matrixRun()` (6 uploads/call). Each call is bounded and resumable, so this is
"call it on a loop until done," not one long-running invocation. Example:
```js
await window.__matrixRun({ perFormat: 55, xlsxB64, pdfB64 });
```

## Endpoints used (from the verified inventory)

- `POST /api/orders/upload` (multipart `file`, `supplierId`)
- `GET /api/orders/{id}` (poll for parse state + line count)
- `POST /api/orders/{id}/mapping-override/preview?format=csv|json` (cheap, non-mutating)
- `POST /api/orders/{id}/transform?format=xml|cxml|ubl|x12` (real transform)

## Caveats / could-not-confirm

- **Preview only supports `csv`/`json`** (per inventory: `MappedTransformService.SupportsOverride`
  returns true only for CSV/JSON; others 400 at `OrdersController:573`). So `xml/cxml/ubl/x12`
  are routed to the **mutating** `/transform` endpoint instead. That endpoint changes order
  state, so back-to-back transforms on the same order can return **409 while a prior transform
  is in flight** — the runner records the 409 as `transformOk:false` and continues. It does
  **not** re-poll between transforms, so for the four transform-only formats some combos may
  legitimately come back 409 rather than 200; re-running `__matrixRun()` re-attempts only
  combos not already recorded (it will not retry a recorded 409). If you need clean 200s for
  all four, transform formats serially with a parse/ready re-check between them — a follow-up
  enhancement, not wired here.
- **Response field names** for the order id (`id`/`orderId`) and status/line shapes are handled
  defensively (multiple casings), but the exact JSON contract of `GET /api/orders/{id}` was
  **not** confirmed against a live response in this task — verify `parseLines`/`status`
  mapping on first run and adjust `lineCountOf`/`statusOf` if your payload differs.
- **IDoc upload acceptance**: the inventory marks IDoc `acceptedByUpload:false`, but also says
  the upload whitelist accepts `.xml` and the factory content-sniffs IDoc from `.xml`. The
  runner uploads IDoc as `.xml`; if the upload whitelist rejects it, the combo records the
  upload error honestly.
- **Supplier id** `688a51ab-8125-4c00-be7d-a00807ce640b` is assumed valid for this org; not
  re-verified here.
- The EDIFACT `UNT` segment count is approximate (parsers are tolerant of the trailer count);
  not a strict envelope validator.
