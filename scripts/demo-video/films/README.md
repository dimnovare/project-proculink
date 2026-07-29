# ProcuLink film toolchain

This directory contains the strict, shared production engine for the three
ProcuLink films. Film specifications and Task 1 capture helpers remain the
source of timing and shot truth. The toolchain renders branded 1920x1080 cards,
generates one narration clip per beat, assembles H.264/AAC film masters, and
performs hard media QA.

The pipeline does not create subtitles, timed-text files, subtitle streams, or
burned-in narration text. Intro and outro cards use only the approved card copy
from the film specification. Publication and R2 upload are separate,
approval-gated work.

## Commands

```powershell
# Review narration without API calls
bun run film:vo -- walkthrough-2026-07 --dry-run

# Generate narration
bun run film:vo -- walkthrough-2026-07

# Capture current UI
bun run film:capture -- capture-walkthrough-2026-07

# Assemble and verify
bun run film:assemble -- walkthrough-2026-07
bun run film:verify -- walkthrough-2026-07
```

`film:vo --dry-run` writes only `voiceover-script.txt`; it does not read a key,
call ElevenLabs, create audio, or launch FFmpeg. A paid narration run reads
`ELEVENLABS_API_KEY`, falling back to
`%USERPROFILE%\.proculink-secrets\elevenlabs.key`, and never prints the key.

The assembler requires `ffmpeg`, `ffprobe`, and ImageMagick's `magick` command.
It fails when capture footage, markers, narration manifest/clips, generated
abstract clips, or the committed music bed are missing. The music input is
looped and trimmed to the deterministic final timeline, so a film longer than
the 100-second source bed retains music through the outro.

Every external process and ElevenLabs request has a hard 20-minute ceiling.
Set `FILM_PROCESS_TIMEOUT_MS` to a positive integer to use a different bound;
timeouts terminate the direct child and fail the command.

Only `scripts/demo-video/films/out/` is generated:

- `out/<film-id>.mp4`
- `out/<film-id>-poster.jpg`
- `out/<film-id>/qa/report.json`
- `out/<film-id>/qa/contact-sheet.jpg`
- per-beat QA JPEGs and local assembly intermediates

The verifier requires H.264 video, AAC stereo audio, 1920x1080 at 30 fps,
`yuv420p`, no subtitle streams, no decode errors, target-range duration, and a
peak no higher than `-0.5 dB`. It also rejects `.srt`, `.vtt`, or `.ass` files
anywhere under the film output directory.
