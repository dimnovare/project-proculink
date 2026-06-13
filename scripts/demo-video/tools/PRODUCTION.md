# Per-tool walkthrough videos — production record

> **FULL WALKTHROUGH v10 (2026-06-13, DRAFT — founder review pending):** a
> FROM-SCRATCH EXPLAINER after v7, v8 AND v9 were all rejected. The founder
> diagnosed the issue as STORY & STRUCTURE — not the AI voice, not the
> auto-capture pipeline, not pacing-as-speed. v10's desired feeling is CALM &
> EXPLANATORY — teacherly, patient, easy to follow. It TEACHES how the product
> works: it gives the viewer the mental MAP first, then walks it calmly, each
> step with its purpose explained. NOT a feature tour, NOT a sales race.
>
> The narration is the founder-APPROVED 8-beat script, implemented VERBATIM
> (`walkthrough-v10.json`); the capture only TIMES the visuals to it. Beats:
> (1) PROBLEM — open on the live Inbox; the reformatting problem · (2) THE MAP —
> **the NEW thing**: a clean on-brand 5-step pipeline graphic (Read → Check →
> Resolve → Convert → Deliver) built as an HTML/CSS motion card
> (`map-card.html`, navy backdrop + blue→green bridge line, steps reveal one at
> a time) served via `page.setContent` and captured IN-TAKE · (3) READ —
> `/upload`, CSV dropped, format auto-detected, PO + lines found · (4) CHECK &
> RESOLVE — `/inbox/ord-002`, the heart: accept the catalog-grounded AI
> suggestion (confidence + reason), then type one supplier code manually + save ·
> (5) CONVERT — Full document triptych (source / canonical / supplier XML) ·
> (6) DELIVER — Send → confirm → Generating → Sent → Delivered + audit banner ·
> (7) PAYOFF — it learns; less work next time · (8) CLOSE — brand outro card.
>
> CALM delivery: the ElevenLabs Daniel VO is generated with raised stability
> (`ELEVENLABS_STABILITY=0.72`, new env knob in `generate-tool-vo.mjs`) for a
> measured, less-jittery read; music bed stays at the low 0.14 tutorial level.
> The map card + the unhurried map-then-walk structure are the NEW things vs the
> prior drafts. Output **2:53 (173.3s)**, 1080p30 H.264+AAC, **11.4 MB**, mean
> **−23.1 dB** / max −3.7 dB, **0 decode errors**; every beat frame-checked
> (stills in `out/walkthrough-v10/check/`), the 5-step map verified, no
> "Loading…" spinner at any cut, A/V in sync. Staged at
> `scripts/demo-video/tools/out/walkthrough-v10.mp4` (+ poster) — **NOT uploaded
> to R2, no env/registry change**; review copy at
> `C:\Users\Dmitri.MARKIT\Videos\ProcuLink\walkthrough-v10-DRAFT.mp4`.
> Produce: `ELEVENLABS_STABILITY=0.72 node tools/generate-tool-vo.mjs walkthrough-v10` →
> `bun run demo:tools:capture capture-walkthrough-v10` →
> `DEMO_INTRO_SEC=3.2 DEMO_OUTRO_SEC=4.5 node tools/assemble-tool.mjs walkthrough-v10`.
>
> **Mock-mode notes:** same Inbox-list gap as v9 — the list renders the 50-row
> MSW seed (no ord-002), so the inbox is used only as the opening PROBLEM hook
> (generic, no claim any row IS our order) and the take CUTS to `/inbox/ord-002`
> for the order we follow. The map card is a self-contained brand graphic
> (`setContent`), so it has no demo cursor (intentional) and no dev-server
> dependency (instant paint, never a spinner). The readiness card still shows
> Acceptance "Not validated yet" / Conformance "No named profile for XML" in
> mock — the VO says the steps happen, it doesn't claim those checks passed.

> **FULL WALKTHROUGH v9 (2026-06-13, DRAFT — founder review pending):** a
> FROM-SCRATCH rewrite after v7 + v8 were both rejected ("rewrite the whole
> video, start from scratch, much better"). v9 DROPS the feature-tour structure
> and tells ONE concrete story: **follow a single purchase order
> (PO-2024-005678, Nordic Electronics → ElectroSupply Co) from arrival to
> delivered**, the way a coordinator works it. Catalog-grounded AI, manual
> override + learning, the readiness check, the audit trail, and the
> exceptions/health safety net appear as natural BEATS INSIDE that one order's
> journey — not as separate "and also…" screens. Fresh script + fresh VO (no v7/
> v8 lines reused) + a fresh full re-record (`capture-walkthrough-v9.spec.ts`,
> spec `walkthrough-v9.json`, tool id `walkthrough-v9`). Reuses ONLY: the BRAND
> intro/outro card style, the `assets/music.mp3` bed, and the Daniel ElevenLabs
> voice. Opens IN the product on the Inbox (1-line hook over the live queue),
> then cuts to the order in review. Output 2:39 (159.5s), 1080p30 H.264+AAC,
> 9.9 MB, mean −22.6 dB / max −1.9 dB, 0 decode errors; every beat frame-checked
> (stills in `out/walkthrough-v9/check/`), no "Loading…" spinner at any cut.
> Staged at `scripts/demo-video/tools/out/walkthrough-v9.mp4` (+ poster) — **NOT
> uploaded to R2, no env/registry change**; review copy at
> `C:\Users\Dmitri.MARKIT\Videos\ProcuLink\walkthrough-v9-DRAFT.mp4`.
> Produce: `node tools/generate-tool-vo.mjs walkthrough-v9` →
> `bun run demo:tools:capture capture-walkthrough-v9` →
> `DEMO_INTRO_SEC=3.2 DEMO_OUTRO_SEC=4.5 node tools/assemble-tool.mjs walkthrough-v9`.
>
> **Mock-mode gap that shaped the cut:** the Inbox LIST renders the 50-row MSW
> seed dataset (`src/mocks/data.ts` `ORDERS`), which does NOT contain ord-002,
> and its rows route to ids the 3-order detail store (`api-client.ts`
> `mockOrders`) returns null for. So a list-row click would land on a
> blank/altered order. v9 therefore uses the inbox only as the opening hook
> (generic VO over the queue, no claim that any row IS our order) and CUTS to
> `/inbox/ord-002` via a page load. One honesty fix vs the first draft: the
> readiness card shows Acceptance "Not validated yet" / Conformance "No named
> profile for XML" in mock, so the s6 VO says the checks are "all in one place
> before anything goes out" rather than claiming they already passed.

> **FULL WALKTHROUGH v7 (2026-06-13, DRAFT — founder review pending):** the
> refreshed ~3-minute successor to v5 is produced with THIS per-tool pipeline
> (not the card pipeline) as tool id **`walkthrough`** — real-UI footage of the
> CURRENT product (section guides, help center, catalog HTTP sources, line-card
> polish, breadcrumbs all merged). Spec `walkthrough.json` +
> `capture-walkthrough.spec.ts`; `make-tool-cards.mjs` gained a BRAND card
> variant (spec keys `introTagline` / `outroHeadline` / `outroCta`) that
> renders the v5 founder-locked intro ("The missing link between buyers and
> suppliers.") and outro ("Connecting procurement." + "Start free at
> proculink.eu") instead of the tool-guide cards. Assemble with
> `DEMO_INTRO_SEC=3.2 DEMO_OUTRO_SEC=4.5`. One take, four page loads
> (how-it-works → upload → inbox/ord-002 → supplier?tab=catalog), everything
> else client-side; beats: problem (animated how-it-works pipeline) → upload
> (detect + route) → review (accept AI / manual code / readiness) → send →
> Delivered → catalog import + automatic sources (HTTP push) → versioned
> connection (run tests → publish → rollback affordance) → exceptions + health
> → "?" help slideover → dashboard close. Output staged as
> `scripts/demo-video/out/walkthrough-v7.mp4` (+ poster) — **NOT uploaded to
> R2, no env/registry change**; review copy at
> `C:\Users\Dmitri.MARKIT\Videos\ProcuLink\walkthrough-v7-DRAFT.mp4`.

One short video per tab/tool, **real screen recordings** (the founder judged
the card-based cut worse than v5's real-UI footage). Quality bar = v5: real UI
on screen, professional ElevenLabs voiceover, low music bed, brand intro card.

> **FULL LIBRARY SHIPPED + PUBLISHED 2026-06-12.** The two pilots (upload,
> review) were founder-approved, then the remaining 8 were produced with the
> same pipeline and ALL TEN published to the public R2 bucket
> (`proculink-public`) at `marketing/tools/<id>.mp4` + `<id>-poster.jpg` —
> every URL verified 200 `video/mp4` via https://assets.proculink.eu.
>
> | Video | Duration | Size | R2 URL (assets.proculink.eu) |
> |---|---|---|---|
> | Upload an order (pilot) | 1:33 (92.8s) | 5.5 MB | `/marketing/tools/upload.mp4` |
> | Review & resolve (pilot) | 1:55 (115.4s) | 8.0 MB | `/marketing/tools/review.mp4` |
> | Dashboard | 1:24 (83.7s) | 6.9 MB | `/marketing/tools/dashboard.mp4` |
> | The Inbox | 1:29 (89.4s) | 7.6 MB | `/marketing/tools/inbox.mp4` |
> | Supplier profiles | 1:54 (114.2s) | 6.8 MB | `/marketing/tools/suppliers.mp4` |
> | PO field mapping | 1:34 (94.1s) | 6.3 MB | `/marketing/tools/po-mapping.mp4` |
> | Delivery setup | 1:41 (101.0s) | 5.7 MB | `/marketing/tools/delivery.mp4` |
> | Versioned connections | 2:02 (122.0s) | 7.8 MB | `/marketing/tools/connections.mp4` |
> | Exceptions & health | 1:49 (109.3s) | 6.4 MB | `/marketing/tools/exceptions.mp4` |
> | Settings & integrations | 1:43 (102.7s) | 5.6 MB | `/marketing/tools/settings-integrations.mp4` |
>
> Review copies live in `C:\Users\Dmitri.MARKIT\Videos\ProcuLink\` as
> `tool-<id>.mp4`. All ten verified: 1080p30 H.264+AAC, zero decode errors,
> mean volume −22.0…−22.7 dB (v5 reference loudness), and a frame-by-frame
> eyeball of every beat (per-beat stills under `out/<id>/check/`, gitignored).

## Mock-mode gaps found while filming (and how each was handled)

These are capture-time decisions, not product claims. "Hidden" always means
the capture-scoped `hideTexts` hider in `demo-helpers.ts` (visibility-only,
layout-stable, documented per capture spec):

- **Inbox header summary + filter-chip count badges HIDDEN** — the counts come
  from the 3-order base mock store while the table shows ~25 staged demo rows;
  the numbers contradict the rows in the same frame. Chips + filtering remain.
- **Inbox bulk-send success text is UNREACHABLE UI** (real bug, not just mock):
  on success the selection is cleared, which unmounts the whole bulk bar —
  including the "N orders sent" message inside it. The VO claims the action,
  not the feedback.
- **Delivery tab "Failed to fetch" HIDDEN** — `getDeliveryConfig`/`upsert`/
  `test-fire` have no mock twins, so the initial GET error banner would sit in
  frame. Test-fire and Save are RESTED ON, never clicked (both would error).
- **PO Mapping "Accept all" is a no-op in mock** (suggestions auto-seed as
  accepted → "Nothing new to accept"), so the beat shows the per-field
  `change` controls instead. "Save mapping" is rested on, not clicked
  (`upsertPoMapping` has no mock twin). The starter-template menu is opened
  and hovered but NOT applied (applying would visibly break the auto-detected
  demo mapping).
- **Suppliers video never shows the list → detail transition** — in mock mode
  the detail always renders the staged "Acme Components" profile regardless of
  the routed id, so navigating from a row named "ElectroSupply Co" would flip
  the name on camera. The video opens directly on the profile. (Add-supplier
  is also untestable in mock: the pilot-plan limit renders the button as
  "Supplier limit reached".)
- **Settings "Loading members…" HIDDEN** — the members query has no mock twin
  and spins forever.
- **Ops-health requeue notice fixed IN THE PRODUCT** (small win, not a hide):
  it used to print the truncated internal order id ("mock-dl-…" on camera,
  equally unhelpful for real users); it now names the PO number
  (`src/app/(app)/operations/health/page.tsx`).
- Mock ingress/push URLs show `http://localhost:5223/...` (the dev API base)
  in the API-keys and catalog-push shots — left as-is; it is honestly the
  demo environment.

---

## How a video is made (the pipeline)

```
tools/<tool>.json      one spec per tool: beats (shot list) + VO lines — SOURCE OF TRUTH
        │
        ├─ 1. bun run demo:tools:vo <tool>          ElevenLabs TTS → out/<tool>/vo/*.mp3 + manifest
        ├─ 2. bun run demo:tools:capture capture-<tool>
        │       Playwright drives the REAL frontend in MOCK mode (port 8090),
        │       1080p recordVideo; per-beat hold = measured VO duration + pad;
        │       writes out/<tool>/capture.webm + markers.json
        └─ 3. bun run demo:tools:assemble <tool>
                intro card (logo + tool name) → footage with VO synced to the
                beat markers + music bed → outro card
                → out/<tool>.mp4 + <tool>-poster.jpg + <tool>.srt
```

**VO first, then capture.** The capture spec reads `vo/manifest.json` and holds
each beat exactly as long as its narration (+1.1 s pad + per-beat `extraMs`),
so narration and footage line up by construction. Markers absorb any drift.

### Mock-mode recording environment

- `playwright.tools.config.ts` (repo root) — port **8090** (never 8082; a dev
  server usually owns it), `NEXT_PUBLIC_USE_MOCK=true`,
  `PROCULINK_QA_BYPASS_AUTH=true` + **placeholder Clerk keys**
  (`pk_test_ci_placeholder_not_real` — same trick as CI). Without ANY key,
  @clerk/nextjs v7 boots "keyless" mode and paints popups over the UI
  ("Configure your application" / "Organizations feature required") — fatal
  for footage. Delete any `.clerk/` dir keyless mode left behind.
- `tools/demo-helpers.ts` — visible **demo cursor** (green dot, navy ring,
  shrinks on click; Playwright recordings have no OS cursor), eased human-like
  glides, cookie-consent pre-seeded, mock badge + Next dev overlays + the
  mock-only "(Demo: …)" dropzone hint hidden, beat/marker clock.
- ONE page load per take — mock state is in-memory and resets on reload; all
  navigation after the first `goto` is client-side (same rule as the v5
  capture).
- Footage, not verification: every action is fail-soft; a missed selector
  logs and the take continues.

### Reused from v5 vs new

| Reused from v5 / main pipeline | New for per-tool videos |
|---|---|
| Capture approach (`capture.spec.ts` pattern: mock mode, fail-soft, markers, one-load rule) | Per-tool spec JSONs (beats + VO as one file) |
| `playwright.demo.config.ts` shape (port 8090, 1080p recordVideo) | `playwright.tools.config.ts` (tools dir, deterministic per-tool webm via `video().saveAs`) |
| Assembler logic (git `8888453:scripts/demo-video/assemble.mjs`): marker-synced VO `adelay` mix, lead trim, frozen tail, concat, music loop | `assemble-tool.mjs` — per-tool intro/outro cards, poster, srt, output gain to v5 loudness |
| Brand card SVG language (`make-cards.mjs`: navy, blue→green mark, Segoe UI) | `make-tool-cards.mjs` — intro names the TOOL ("TOOL GUIDE / Upload an order"), outro = next-step line + proculink.eu pill |
| ElevenLabs voice **Daniel — Steady Broadcaster** (`onwK4e9ZLuTAKqWW03F9`), model `eleven_multilingual_v2`, same voice settings | `generate-tool-vo.mjs` (per-tool manifests; reads the key from `~/.proculink-secrets/elevenlabs.key` itself) |
| `assets/music.mp3` (committed ElevenLabs Music bed) at a LOW tutorial level (0.14) | Visible demo cursor + eased glide helpers |

## Pilot 1 — "Upload an order" (`upload.json`)

Route `/upload`. Shot list (beat → what's on camera):

| Beat | Shot |
|---|---|
| b1-open | Land on the Upload workbench; cursor settles by the title. |
| b2-formats | Cursor traces the dropzone format line (CSV/XLSX/PDF/XML/EDI), rests on Browse files. |
| b3-sample | Hover the "Try with a sample order" chip (never clicked). |
| b4-file | Click Browse → `orders_june.csv` arrives → "Detected: CSV · 92%", PO + line count, "We've seen this layout 3 times before". |
| b5-supplier | Supplier select switched to ElectroSupply Co; the "routes to" line updates live. |
| b6-upload | Click "Upload & review" → Parse / Normalize / Validate animation. |
| b7-after | The mapping preview lands (parsed lines + AI suggestions) — "nothing is sent without review". |

Voiceover (full text — also in `out/upload/voiceover-script.txt`):

> **b1** This is the Upload workbench, where every order enters ProcuLink.
> **b2** You can drop a purchase order here in whatever format it already lives in. A CSV, a spreadsheet, a PDF, or structured formats like cXML, UBL, EDIFACT and X12. ProcuLink detects the format for you.
> **b3** No order handy yet? The sample order runs a safe example through the whole flow, and it never counts toward your monthly quota.
> **b4** Let's add a real file. The moment it lands, ProcuLink identifies the format, the purchase order number, and the line count. And if it has seen this layout before, it tells you.
> **b5** Every upload routes to one supplier. Pick the one this order is for. Their format and delivery settings are what ProcuLink will use later, when the order is sent.
> **b6** Then upload. ProcuLink parses the file, normalizes it into one canonical order, and runs the first validation checks.
> **b7** And this is what happens next. The parsed order opens for review, line by line. Nothing is ever sent to a supplier without passing through review first. That's the next guide.

## Pilot 2 — "Review & resolve" (`review.json`)

Route `/inbox/ord-002` (mock order PO-2024-005678, Nordic Electronics →
ElectroSupply Co, 2 of 4 lines unresolved with AI suggestions → opens in
Triage). Shot list:

| Beat | Shot |
|---|---|
| b1-open | Header sweep: PO, buyer → supplier, total, Parse→Deliver progress. |
| b2-triage | The Fix Queue rail — only the 2 lines needing a decision. |
| b3-accept | Line 2 (Resistor): AI suggestion ES-RES-220R · 84% + reason → click ✓ Accept → queue advances. |
| b4-manual | Line 4 (Wire): "Enter manually" → type `ES-WIRE-22BK-100` → Save ("not in saved mappings — remembered for next time" hint on camera). |
| b5-fulldoc | Toggle "Full document" — source / canonical / supplier-output triptych with wires. |
| b6-readiness | Back to Triage — Send-readiness card: lines 4/4, acceptance, conformance, delivery. |
| b7-send | "Send to supplier" → confirm dialog (total, lines, format) → checkbox → final send. |
| b8-delivered | Status runs Generating → Sent → **Delivered**; green "audit trail updated" banner + accepted toast. |

Voiceover (full text — also in `out/review/voiceover-script.txt`):

> **b1** This is order review, the screen where you make an order supplier-ready. At the top: the purchase order, the buyer, the supplier it routes to, and how far it has progressed.
> **b2** ProcuLink opens in Triage: a fix queue with only the lines that actually need a decision. Here, two of the four lines need attention. The rest are already resolved.
> **b3** The first line has an AI suggestion: the supplier's item code, with a confidence score and the reason behind it. If it's right, accept it. The line resolves, and the queue moves on to the next decision.
> **b4** When you'd rather decide yourself, enter the code manually. ProcuLink checks it against what it knows about this supplier, and remembers your answer for next time.
> **b5** Need the whole picture? Switch to Full document: your source file, the normalized order, and the supplier's output, side by side.
> **b6** Back in Triage, the readiness card is the honest pre-send check: every line resolved, the supplier's acceptance rules, conformance, and how the order will be delivered.
> **b7** When everything is green, send. You confirm once, and ProcuLink generates the exact format this supplier requires and delivers it.
> **b8** The order tracks through generating, sent, and delivered. And every step lands in the audit trail, so there is proof for every single order.

Every claim is on screen when it is spoken (offer⇔works); mock data is the
same staged demo data the product ships in mock mode.

## Regenerate / produce the next tool video

From the frontend repo root, with ffmpeg + ffprobe + ImageMagick (`magick`) on
PATH and Playwright browsers installed:

```bash
# 0. once: author tools/<tool>.json (beats + VO) and a capture-<tool>.spec.ts
# 1. voiceover (key read from ~/.proculink-secrets/elevenlabs.key — NEVER commit/print)
bun run demo:tools:vo <tool>
# 2. record (starts the mock dev server on :8090 itself if none is running)
bun run demo:tools:capture capture-<tool>
# 3. assemble
bun run demo:tools:assemble <tool>    # → tools/out/<tool>.mp4 + poster + srt
```

Verify (this environment can't play video) — one command does all four checks
and writes a per-beat still to `out/<tool>/check/<beat>.jpg` for the eyeball:

```bash
node scripts/demo-video/tools/verify-tool.mjs <tool> [<tool> …]
# = ffprobe stream/format check (1080p30 h264+aac), decode-error count,
#   volumedetect (target mean ≈ -22 dB), and a frame per beat.
```

Note when eyeballing: the per-beat still is taken ~60% into the beat — clicks
that happen late in a beat (after a long `actionLeadMs`) land AFTER the still,
so pull an extra frame near the NEXT marker before concluding a click failed.

## Hosting (DONE 2026-06-12 — all ten live)

Public R2 bucket `proculink-public` (assets.proculink.eu), keys
`marketing/tools/<tool>.mp4` + `marketing/tools/<tool>-poster.jpg`:

```bash
wrangler r2 object put proculink-public/marketing/tools/upload.mp4 \
  --file scripts/demo-video/tools/out/upload.mp4 --content-type video/mp4 --remote
```

All ten videos + posters are uploaded and each URL HEAD-checks 200 with the
right content type. Next step: wire into Help per `../HELP-INTEGRATION.md`
(registry-driven `videoUrl` on the mapped article — NOT yet done).
**Never** make the private `proculink` order-data bucket public.

## Known production notes

- The first ~23 s of every take is dev-server warmup/navigation — the
  assembler trims to the first beat marker minus 0.4 s, so it never ships.
- Native `<select>` dropdowns don't render their popup in headless recordings;
  the supplier-picker beat uses `selectOption` (the value + "routes to" line
  change on camera) instead of an open dropdown.
- `out/` is gitignored: mp3/webm/mp4 binaries and the Playwright artifacts are
  never committed. The ElevenLabs key lives only in `~/.proculink-secrets/`.
- ElevenLabs durations vary per regeneration; always re-capture after
  regenerating VO so holds match (the spec reads the manifest at run time).
