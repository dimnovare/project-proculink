# Per-tool walkthrough videos — production record

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
