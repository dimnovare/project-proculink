# Walkthrough video pipeline

Produces the `/watch` walkthrough video from the **real ProcuLink frontend** —
no Lovable, no fake rebuild. Three steps: capture footage → generate voiceover →
assemble. Output is `out/walkthrough.mp4` + `out/captions.srt`.

Narrative + brand spec live in
[`../../../ProcuLink/docs/launch/walkthrough-video-brief.md`](../../../ProcuLink/docs/launch/walkthrough-video-brief.md).
Scene text + timing live in [`scenes.json`](./scenes.json) — the single source
of truth shared by the capture spec and the assembler.

## Prerequisites

- **ffmpeg + ffprobe** on PATH — `winget install Gyan.FFmpeg` (Windows) / `brew install ffmpeg`.
- **ElevenLabs** API key + a chosen Voice ID (copy it from the ElevenLabs app).
- Node 18+ (for `fetch` in the scripts). `bun` runs everything.

## Run it

```bash
# 1. Capture footage (mock mode, 1080p, dedicated port 8090 — no backend needed).
#    Playwright starts its own dev server; just have deps installed (`bun install`).
bun run demo:capture
#    → scripts/demo-video/out/capture/**/*.webm

# 2. Generate the voiceover (one clip per scene + durations).
ELEVENLABS_API_KEY=sk_... ELEVENLABS_VOICE_ID=<voiceId> bun run demo:vo
#    → out/vo/*.mp3 + out/vo/manifest.json
#    (or `bun run demo:vo -- --dry-run` to only emit out/voiceover-script.txt)

# 3. Assemble final MP4 (+ optional music bed at assets/music.mp3).
bun run demo:assemble
#    → out/walkthrough.mp4 + out/captions.srt
```

## Tuning

- **Pacing off?** Edit `holdMs` per scene in `scenes.json` and re-run `demo:capture`
  (footage) — the dwell on each screen should be ≈ that scene's narration length.
- **Selectors changed?** Edit the `soft(...)` blocks in `capture.spec.ts`. Steps are
  forgiving — a missing element is skipped, not fatal, so a take never aborts.
- **Different voice/tone?** Set `ELEVENLABS_MODEL` / voice settings in `generate-vo.mjs`.
- **No music?** Omit `assets/music.mp3` — the assembler just uses voiceover.

## Publish to R2 and wire `/watch`

1. Upload `out/walkthrough.mp4` to the R2 `proculink` bucket
   (e.g. `marketing/walkthrough-v1.mp4`) and expose a public/CDN URL.
2. Set `NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL` (the MP4 URL) in Vercel.
3. `src/app/(marketing)/watch/page.tsx` renders an HTML5 `<video>` when that var
   is set (this is part of Phase-1 fix **F**); until then `/watch` stays hidden.

## Notes

- **Why mock mode?** Deterministic data + timing, zero backend/Worker/R2
  dependency that could stall mid-recording. It's the real UI driven by the
  product's seeded sample order. To record fully-live data instead, run a real
  backend stack and adapt the spec to a live order id (the selectors are shared
  with `tests/e2e/live-po-loop.spec.ts`).
- `out/` is generated — add `scripts/demo-video/out/` to `.gitignore` if you
  don't want takes committed.
