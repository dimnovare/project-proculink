# Walkthrough video pipeline — HANDOFF

Produces the `/watch` walkthrough from the **real ProcuLink frontend** (mock mode),
narrated by **ElevenLabs TTS**, assembled with **ffmpeg**. No Lovable, no fake
rebuild. Output: `out/walkthrough.mp4` (1080p) + `out/captions.srt`.

> **STATUS (2026-06-04): v6 — logo'd cards + product-loop-only recut.** Branded
> intro/outro (real logo lockup + "The missing link between buyers and
> suppliers." intro / "Connecting procurement." + CTA outro), NO scrolling, a
> real click-through product loop (upload → AI mapping → review → send →
> delivered → audit). Pipeline + a silent-narration preview are verified
> frame-by-frame. The final render just needs a current `ELEVENLABS_API_KEY` for
> `demo:vo`. `out/` is gitignored — re-run `demo:vo` + `demo:assemble` to
> regenerate `walkthrough.mp4`.

---

## Run it (3 steps)

```bash
# 1. Capture footage — mock mode, 1080p, port 8090. WARM the routes first so the
#    capture doesn't eat cold-compile (else /upload etc. render slowly on camera):
#    start a server,  hit /upload, /upload/preview/ord-002, /inbox/ord-002,
#    THEN run the capture against it (reuseExistingServer=true).
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

## Current cut (v6) — structure
1. **Intro card** (4.5s): the real **logo lockup** (gradient mark + white wordmark) + tagline
   **"The missing link between buyers and suppliers."** (ffmpeg overlay of `out/logo-lockup.png`,
   rasterised from the shipped SVG by `make-logo.mjs`).
2. **Product loop** (~90s, 6 scenes, all in-app, NO page-scrolling — element focus only):
   - **s1-intake** `/upload`: empty drop zone (PDF·XLSX·CSV·cXML·UBL·EDIFACT·X12) → file arrives + format detect.
   - **s2-parse** `/upload/preview/ord-002`: parsed lines, source→canonical→supplier mapping.
   - **s3-ai**: AI-suggested supplier codes (confidence + reason) → accept each → 4/4 mapped → commit.
   - **s4-validate** `/inbox/ord-002`: validate against the supplier's acceptance rules ("Passed").
   - **s5-deliver**: Send → "Generating…" → **Delivered** (status journey all-green).
   - **s6-audit**: Passport — full timeline, mapping decisions, delivery attempt 200, supplier Acknowledged.
   All client-side after the two initial loads (one order, no reloads).
3. **Outro card** (5s): logo lockup + **"Connecting procurement."** + green **"Start free at proculink.eu"**.
4. **Music bed** under everything (`make-music.mjs` → `assets/music.mp3`), audible (~-20 dB; VO ~-8 dB on top).

## Iteration history (what's already been fixed — don't redo)
- v1–v2: built pipeline; marker-based VO sync; lead-in trim + fades.
- v3: pitch-perfect single-order flow that reaches **Delivered** (root cause of "stuck/
  no sending" was a `page.goto` reload resetting mock state — keep it all client-side).
- v4: hid the mock "Demo data" badge + Next.js dev overlay; fixed the sidebar avatar to
  derive initials from the org name ("YW"); send-confirm modal dwell.
- v5: text-only "branded" intro/outro cards, animated `/how-it-works` opening, audible music (0.22).
- v6 (2026-06-04): **real logo lockup** composited onto both cards (`make-logo.mjs` rasterises the
  SVG → white-wordmark PNG; ffmpeg `overlay`) + new taglines; **dropped the marketing
  `/how-it-works` opening** → product-loop-only, opening in-app on `/upload`; **removed ALL
  `window.scrollTo`** (element-focus `scrollIntoViewIfNeeded` only); **s1 opens on the empty drop
  zone then the file arrives**, **s3 accepts each AI suggestion on-camera**; **VO recut** (6 scenes,
  dropped the "ProcuLink is the bridge" line per the purged metaphor, claims aligned to `/formats`);
  warmer (synth) music bed.
- v6.1 (2026-06-05): replaced the synth bed with a real **ElevenLabs Music** track
  (`make-music-eleven.mjs` — warm felt-piano + pad, enterprise) and dropped the mix level
  (`DEMO_MUSIC_VOL` 0.22 → 0.10) for a quiet, subordinate bed (~-19 dB under the VO).

## OPEN / notes
- **Music** = an **ElevenLabs Music** track (`make-music-eleven.mjs`, needs a paid plan; free → HTTP 402).
  Generate a candidate: `ELEVENLABS_API_KEY=… node scripts/demo-video/make-music-eleven.mjs out/x.mp3 100000 "<prompt>"`,
  then copy the chosen one to `assets/music.mp3` and re-run `demo:assemble` (no re-capture needed).
  Tracks master hot (~-1 dB), so `DEMO_MUSIC_VOL` default is **0.10** → a quiet, subordinate bed
  (~-19 dB, ~17 dB under the VO). `make-music.mjs` (synth pad) is kept only as an offline fallback.
  A licensed `.mp3` dropped at `assets/music.mp3` also works.
- **VO timing**: `scenes.json` `holdMs` were set with ~2–4s buffer over estimated VO length. After
  `demo:vo`, eyeball each clip's duration vs its hold; if a clip overruns, bump that scene's `holdMs`
  and re-capture so the on-screen dwell still covers the narration.

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
  make-logo.mjs      rasterise the SVG logo → out/logo-lockup.png (called by assemble.mjs)
  make-music-eleven.mjs  ElevenLabs Music API → mp3 (copy the chosen one to assets/music.mp3)
  make-music.mjs     OFFLINE FALLBACK synth bed (production bed is the ElevenLabs track above)
  generate-vo.mjs    ElevenLabs TTS → out/vo/*.mp3 + manifest.json
  assemble.mjs       ffmpeg: logo'd intro/outro + footage + VO + music → walkthrough.mp4
  assets/music.mp3   music bed (synth placeholder — swap for a licensed track)
  out/               GITIGNORED — captures, vo, frames, logo png, walkthrough.mp4, captions.srt
playwright.demo.config.ts   isolated capture config (port 8090, mock, 1080p)
package.json scripts: demo:capture / demo:vo / demo:assemble / dev:demo
```
Narrative/brand brief: `../../../ProcuLink/docs/launch/walkthrough-video-brief.md`.
