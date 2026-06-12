# Walkthrough video — production record

How the current `/watch` walkthrough was built, and how to regenerate it.

> **Built:** 2026-06-12. **Cut:** card-based (no screen-recording).
> **Duration:** 2:24 (144.4s). **Output:** 1080p H.264 + AAC, ~15.5 MB.
> **Hosted:** `https://assets.proculink.eu/marketing/walkthrough.mp4` (live, HTTP 200).

---

## What this video is

A ~2.5-minute narrated walkthrough of the real ProcuLink outbound-PO flow, told
with clean, on-brand **title cards** (not a screen-recording — a live browser
can't be driven in the build environment). Eight scene cards between a branded
intro and outro, each timed to its own voiceover line, over a quiet music bed.

Every claim is grounded in the shipped product and the conservative
`/formats` catalog (the offer⇔works source of truth): input formats
PDF / CSV / XLSX / cXML / UBL / EDIFACT / X12 / IDoc; delivery over
HTTP / SFTP / email / ERP (Erply, Directo); AI item-code suggestions with
confidence + reason; supplier acceptance-rule validation; full audit trail.
No invented features.

## Scenes (script)

The narration + card copy live in `scenes.json` (single source of truth):

| # | Card | Narration gist |
|---|------|----------------|
| intro | logo + "The missing link between buyers and suppliers." | — |
| s0 | The problem | Every supplier wants POs their own way; teams reformat by hand. |
| s1 | Upload an order | Drop any format; ProcuLink detects it and reads every line. |
| s2 | Review & resolve | Surfaces only the lines that need a decision, side by side. |
| s3 | AI item-code mapping | Suggests the mapping with confidence + reason; learns corrections. |
| s4 | Validate | Checked against the supplier's acceptance rules first. |
| s5 | Transform & deliver | Their exact format; HTTP / SFTP / email / ERP. |
| s6 | Proof of delivery | Every step logged; proof of delivery per order. |
| s7 | Start free | "The missing link…"; try free with a sample order. |
| outro | logo + "Connecting procurement." + CTA | — |

## Voice

- **ElevenLabs TTS**, voice **Daniel — Steady Broadcaster**
  (`onwK4e9ZLuTAKqWW03F9`, British, clear/professional), model
  `eleven_multilingual_v2`. One MP3 per scene → `out/vo/`.
- The video's pacing is **driven by the measured VO duration** of each clip
  (+ a small reading pad), so narration and on-screen card always line up.

## Music

- **ElevenLabs Music** track at `assets/music.mp3` (warm felt-piano + pad,
  enterprise; generated earlier via `make-music-eleven.mjs`, already committed).
  Looped under the whole timeline at a low level (~-19 dB under the VO).
- The ElevenLabs **Music API is available on the current (starter) plan**
  (HTTP 200), so the bed can be regenerated:
  `ELEVENLABS_API_KEY=… node make-music-eleven.mjs out/x.mp3 100000 "<prompt>"`
  then copy the chosen file to `assets/music.mp3`. `make-music.mjs` (synth pad)
  remains an offline fallback.

## Visuals (cards)

- `make-cards.mjs` composes each card as an **SVG** (brand tokens mirrored from
  `src/app/globals.css`: navy `#0B1A2F`, blue `#1E66C9` → green `#2E8E3A`
  bridge mark, white wordmark) and rasterises to 1920×1080 PNG with
  **ImageMagick** (`magick`) — no `sharp` / node image dependency.
- `assemble.mjs` turns each PNG into a clip with a gentle Ken-Burns zoom +
  fade, muxes the scene's VO, concatenates intro → scenes → outro, lays the
  music bed under everything, writes `out/captions.srt`, and exports the mp4.

## Regenerate

From `project-proculink/` (frontend repo root), with ffmpeg, ImageMagick
(`magick`), and Node on PATH:

```bash
# 1. (only if scenes.json narration changed) — regenerate the voiceover:
ELEVENLABS_API_KEY=<key> ELEVENLABS_VOICE_ID=onwK4e9ZLuTAKqWW03F9 bun run demo:vo

# 2. render cards + assemble the mp4 (cards are rebuilt automatically):
bun run demo:assemble        # → scripts/demo-video/out/walkthrough.mp4 + captions.srt
```

The ElevenLabs key is read at runtime from
`C:\Users\Dmitri.MARKIT\.proculink-secrets\elevenlabs.key` — **never** commit or
print it. `out/` is gitignored; the mp3/mp4 binaries are not committed.

Verify (this environment can't play video):

```bash
ffprobe -v error -show_entries format=duration,size -of default=nw=1 out/walkthrough.mp4
ffmpeg -ss 30 -i out/walkthrough.mp4 -frames:v 1 out/f.jpg   # then view f.jpg
ffmpeg -i out/walkthrough.mp4 -af volumedetect -f null NUL    # mean ≈ -21 dB
```

## Hosting

The mp4 + poster are uploaded to the **public** R2 bucket `proculink-public`
(custom domain `assets.proculink.eu`), keys:

- `marketing/walkthrough.mp4`        → `https://assets.proculink.eu/marketing/walkthrough.mp4`
- `marketing/walkthrough-poster.jpg` → `https://assets.proculink.eu/marketing/walkthrough-poster.jpg`

Re-upload after a regenerate:

```bash
wrangler r2 object put proculink-public/marketing/walkthrough.mp4 \
  --file scripts/demo-video/out/walkthrough.mp4 --content-type video/mp4 --remote
wrangler r2 object put proculink-public/marketing/walkthrough-poster.jpg \
  --file scripts/demo-video/out/walkthrough-poster.jpg --content-type image/jpeg --remote
```

The public bucket has a 4h CDN cache (`Cache-Control: max-age=14400`); a fresh
upload propagates within that window. **Never** make the private `proculink`
(order-data) bucket public — see memory `project-r2-bucket-separation`.

## Making the "Watch" claim live (operator step)

The video URL is already in the committed `.env`:
`NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL=https://assets.proculink.eu/marketing/walkthrough.mp4`
(+ `…_VIDEO_POSTER`). Every surface that links to `/watch` is gated by
`walkthroughConfigured()` (`src/lib/walkthrough.ts`), which reads that env var,
so the help "Watch the 3-minute walkthrough" row and the `/watch` player render
only where it is set.

**To go live in production, the operator must set the same env var in Vercel**
(this was intentionally NOT done from the pipeline):

```
NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL=https://assets.proculink.eu/marketing/walkthrough.mp4
NEXT_PUBLIC_WALKTHROUGH_VIDEO_POSTER=https://assets.proculink.eu/marketing/walkthrough-poster.jpg
```

Then redeploy. The video is real and hosted, so the claim is honest once set.
