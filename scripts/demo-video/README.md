# Walkthrough video pipeline

> **Per-tool video library (2026-06-12):** the founder judged the card-based
> cut WORSE than v5's real-screen-recording walkthrough, and asked for one
> short REAL-UI video per tab/tool instead. That pipeline lives in
> **`tools/`** (specs + Playwright captures + per-tool assembler) — see
> `tools/PRODUCTION.md` (two pilots built: Upload, Review & resolve) and
> `HELP-INTEGRATION.md` (how videos plug into the help center — design only).
> The card pipeline below still works but is no longer the direction.

Produces the `/watch` walkthrough as a clean, **card-based** narrated video:
on-brand title cards (navy + the blue→green ProcuLink bridge mark), an
**ElevenLabs** voiceover per scene, an ElevenLabs music bed, assembled with
**ffmpeg**. Output: `out/walkthrough.mp4` (1080p H.264 + AAC) + `out/captions.srt`.

> **STATUS (2026-06-12): v7 — card-based recut, hosted + live.** The cut is now
> title-card-driven (no screen-recording — a live browser can't be driven in the
> build env). 8 scene cards between a branded intro/outro, each timed to its VO,
> over a quiet music bed. Narrated by ElevenLabs (voice **Daniel**). Built, verified
> frame-by-frame, and **uploaded to `assets.proculink.eu/marketing/walkthrough.mp4`**.
> Full production record: **`PRODUCTION.md`**.
>
> `out/` is gitignored; the mp3/mp4 binaries are not committed. Re-run
> `demo:assemble` (and `demo:vo` if the script changed) to regenerate.

---

## Run it

```bash
# 1. Voiceover — only needed if scenes.json `vo` text changed.
#    (key is read from C:\Users\Dmitri.MARKIT\.proculink-secrets\elevenlabs.key — never commit it)
ELEVENLABS_API_KEY=<key> ELEVENLABS_VOICE_ID=onwK4e9ZLuTAKqWW03F9 bun run demo:vo

# 2. Render cards + assemble the final mp4 (cards are rebuilt automatically).
bun run demo:assemble        # → out/walkthrough.mp4 + out/captions.srt
```

Requires **ffmpeg**, **ffprobe**, and **ImageMagick** (`magick`) on PATH. No
`sharp` / node image dependency (cards rasterise via ImageMagick).

Verify (this env can't play video):
`ffmpeg -ss 30 -i out/walkthrough.mp4 -frames:v 1 out/f.jpg` then view `f.jpg`.
Check audio: `ffmpeg -i out/walkthrough.mp4 -af volumedetect -f null NUL` (mean ≈ -21 dB).

## Ship it

```bash
wrangler r2 object put proculink-public/marketing/walkthrough.mp4 \
  --file scripts/demo-video/out/walkthrough.mp4 --content-type video/mp4 --remote
```

`/watch` reads `NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL=https://assets.proculink.eu/marketing/walkthrough.mp4`
(already in `.env`). To make it live in **production**, the operator sets the same
env var in **Vercel** and redeploys — see `PRODUCTION.md` § Hosting. **Never** make
the private `proculink` (order-data) bucket public.

---

## How the cut is structured

1. **Intro card** (~5s): the brand lockup (blue→green bridge mark + white
   "ProcuLink" wordmark) + tagline **"The missing link between buyers and suppliers."**
2. **8 scene cards** (~2 min), each shown for its own VO length + reading pad,
   with a green step kicker, a bold headline, a supporting line, a step-progress
   strip, and a subtle Ken-Burns zoom:
   problem → upload → review & resolve → AI item-code mapping → validate →
   transform & deliver → proof of delivery → start free.
3. **Outro card** (~6s): lockup + **"Connecting procurement."** + green
   **"Start free at proculink.eu"** CTA.
4. **Music bed** (ElevenLabs Music) under everything, low + subordinate to the VO.

Every claim is grounded in the shipped product and the `/formats` catalog
(offer⇔works). See `PRODUCTION.md` for the full scene table + voice/music details.

## Files

```
scripts/demo-video/
  scenes.json        narration + card copy (title/kicker/body/vo) — source of truth
  make-cards.mjs     SVG → ImageMagick → 1920x1080 PNG cards (intro/scenes/outro)
  generate-vo.mjs    ElevenLabs TTS → out/vo/*.mp3 + manifest.json (per-scene durations)
  make-music-eleven.mjs  ElevenLabs Music API → mp3 (copy the chosen one to assets/music.mp3)
  make-music.mjs     OFFLINE FALLBACK synth bed
  assemble.mjs       ffmpeg: cards + VO + music → walkthrough.mp4 + captions.srt
  assets/music.mp3   committed ElevenLabs music bed
  PRODUCTION.md      full production record (how it was built, voice id, hosting, regenerate)
  out/               GITIGNORED — cards, vo, frames, walkthrough.mp4, captions.srt
package.json scripts: demo:vo / demo:assemble

  # Legacy (screen-recording path, not used by the current card cut):
  capture.spec.ts            Playwright capture + markers.json
  make-logo.mjs              standalone logo rasteriser (needs sharp)
  playwright.demo.config.ts  isolated capture config
```
