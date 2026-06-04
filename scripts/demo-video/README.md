# Walkthrough video pipeline — HANDOFF

Produces the `/watch` walkthrough from the **real ProcuLink frontend** (mock mode),
narrated by **ElevenLabs TTS**, assembled with **ffmpeg**. No Lovable, no fake
rebuild. Output: `out/walkthrough.mp4` (1080p) + `out/captions.srt`.

> **STATUS (2026-06-04): v5 rendered, but the founder says "it's still not the
> one I want."** Get specifics from them before re-cutting — the most likely gap
> is the **music** (see below). The full file is at `out/walkthrough.mp4` (out/
> is gitignored, so re-run `demo:assemble` to regenerate it).

---

## Run it (3 steps)

```bash
# 1. Capture footage — mock mode, 1080p, port 8090. WARM the routes first so the
#    capture doesn't eat cold-compile (else /upload etc. render slowly on camera):
#    start a server,  hit /, /how-it-works, /upload, /upload/preview/ord-002,
#    /inbox/ord-002,  THEN run the capture against it (reuseExistingServer=true).
#      $env:NEXT_PUBLIC_USE_MOCK='true'; $env:PROCULINK_QA_BYPASS_AUTH='true'; bun run dev:demo   # bg
#      (curl those routes once)
bun run demo:capture        # → out/capture/**/video.webm + out/markers.json

# 2. Voiceover (only needed if scenes.json `vo` text changed):
ELEVENLABS_API_KEY=sk_… ELEVENLABS_VOICE_ID=onwK4e9ZLuTAKqWW03F9 bun run demo:vo

# 3. Assemble (intro card → footage+VO → outro card, music bed under all):
bun run demo:assemble       # → out/walkthrough.mp4 + out/captions.srt
```

Verify by extracting frames with ffmpeg (this env can't play video):
`ffmpeg -ss <t> -i out/walkthrough.mp4 -frames:v 1 out/f.jpg` then Read the jpg.
Check audio with `ffmpeg -ss 0 -t 4 -i out/walkthrough.mp4 -af volumedetect -f null NUL`.

## Ship it
Upload `out/walkthrough.mp4` to the **public** R2 bucket `proculink-public` as
`marketing/walkthrough.mp4` (custom domain `assets.proculink.eu`). `/watch` reads
`NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL=https://assets.proculink.eu/marketing/walkthrough.mp4`
(already set in Vercel) and updates automatically. **Never** make the private
`proculink` (order-data) bucket public — see memory `project-r2-bucket-separation`.

---

## Current cut (v5) — structure
1. **Intro card** (4s): "ProcuLink" + "From any purchase order to supplier-ready delivery".
2. **s1–s2 (hook+promise)**: the **animated `/how-it-works` "order pipeline"** (Receive→…→Deliver
   cycling + format chips PDF/XLSX/cXML/EDI/CSV) — replaced the static landing hero so the
   first ~30s isn't dead.
3. **s3–s8 (product flow)**: `/upload` (drop file) → `/upload/preview/ord-002` (AI mapping,
   accept) → `/inbox/ord-002` (validate "Passed") → **Send** ("Generating…"→"Sent") →
   **Delivered** → **Passport** (all-green, delivery 200, supplier Acknowledged). All client-side,
   one order, no reloads.
4. **Outro card** (5s): "ProcuLink" + green "Start free at proculink.eu".
5. **Music bed** under everything, audible (~-21 dB; VO ~-8 dB on top).

## Iteration history (what's already been fixed — don't redo)
- v1–v2: built pipeline; marker-based VO sync; lead-in trim + fades.
- v3: pitch-perfect single-order flow that reaches **Delivered** (root cause of "stuck/
  no sending" was a `page.goto` reload resetting mock state — keep it all client-side).
- v4: hid the mock "Demo data" badge + Next.js dev overlay; fixed the sidebar avatar to
  derive initials from the org name ("YW"); send-confirm modal dwell.
- v5 (this session): **branded intro/outro cards**, **animated how-it-works opening**
  (fixed "dead first 30s"), **audible music** (was inaudible at 0.06 → now 0.22).

## OPEN — what the founder still wants (get specifics!)
- **Music**: wants it **enterprise**. ElevenLabs **Music API is paid-plan only** (free
  account → HTTP 402 `paid_plan_required`; TTS works on free, Music doesn't). Current
  `assets/music.mp3` is a **synthesized ffmpeg pad** (Cmaj7 + vibrato/tremolo/lowpass/echo) —
  audible but not a produced corporate track. To upgrade: (a) founder upgrades ElevenLabs →
  generate via `POST /v1/music {prompt, music_length_ms}`; or (b) drop any **licensed** track at
  `assets/music.mp3` and re-run `demo:assemble`. Tune level with `DEMO_MUSIC_VOL` (default 0.22).
- The founder said "still not the one I want" without further detail — **ask** what specifically
  feels off (pacing? more product motion? different opening? voice? length?).

---

## Technical notes (so you don't re-learn the hard way)
- **Mock mode is deliberate**: deterministic data + timing, no backend needed. The footage is
  the real UI driven by the seeded sample order `ord-002` (PO-2024-005678, Nordic Electronics →
  ElectroSupply Co, the 84%/72% AI suggestions). Captures via `playwright.demo.config.ts`
  (port 8090, `video: on`, 1080p). `demo:capture` runs `capture.spec.ts` (a fail-soft script,
  not a test — every step `soft()`-wrapped so a missing selector never aborts the take).
- **Sync = markers**: `capture.spec.ts` writes `out/markers.json` (scene id → seconds). The
  assembler places each VO clip at its marker, so narration tracks the on-screen scene
  regardless of compile variance. Holds in `scenes.json` (`holdMs`) must be ≥ each scene's VO.
- **VO**: 8 clips, voice **Daniel** (`onwK4e9ZLuTAKqWW03F9`, British broadcaster). `scenes.json`
  is the single source of truth for narration text + timing. Don't regen VO unless text changes.
- **assemble.mjs** is multi-pass: voiceover.m4a → core.mp4 (footage+VO, lead-trim + fade) →
  intro/outro cards (ffmpeg `drawtext`, fonts `C:/Windows/Fonts/arialbd.ttf` & `arial.ttf`,
  colon escaped as `C\:/…`) → final concat(intro,core,outro) + music. All audio normalised to
  44100/stereo so `concat` works.
- **ElevenLabs key** was pasted in chat earlier (`sk_c3e8…`) — founder said they'll rotate; do
  NOT assume it still works. If TTS 401s, ask for the current key.

## Files
```
scripts/demo-video/
  scenes.json        narration text + per-scene holdMs (source of truth)
  capture.spec.ts    Playwright capture (mock) — writes footage + markers.json
  generate-vo.mjs    ElevenLabs TTS → out/vo/*.mp3 + manifest.json
  assemble.mjs       ffmpeg: intro/outro + footage + VO + music → walkthrough.mp4
  assets/music.mp3   music bed (synth placeholder — swap for licensed/ElevenLabs)
  out/               GITIGNORED — captures, vo, frames, walkthrough.mp4, captions.srt
playwright.demo.config.ts   isolated capture config (port 8090, mock, 1080p)
package.json scripts: demo:capture / demo:vo / demo:assemble / dev:demo
```
Narrative/brand brief: `../../../ProcuLink/docs/launch/walkthrough-video-brief.md`.
