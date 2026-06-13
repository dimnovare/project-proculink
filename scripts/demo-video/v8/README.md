# Walkthrough v8 — hero walkthrough (DRAFT pipeline)

v8 = a **new premium motion cold open** + the **v7 real-UI body footage reused**,
under **one cohesive ElevenLabs narration** and a continuous music bed. It replaces
the rejected v7 opening (a slow cursor-drift over the static `/how-it-works` page)
without re-recording the product footage — the body is the same founder-approved
take, started from the `u1-upload` beat onward.

```
[ animated cold open ~12s ]  →  [ v7 real-UI body, reused ]  →  [ outro card ~3.4s ]
        v8/cold-open.html          tools/out/walkthrough/         make-outro-card.mjs
        (Playwright capture)        capture.webm (from u1)
```

## The cold open (the part that had to get much better)

`cold-open.html` is an all-CSS-keyframe motion scene (no rAF, no `Math.random`, so
the capture is frame-stable), 3 acts over ~12s:

1. **0–3s** — navy void; the brand MARK draws itself in (the "link" arc), nodes
   pop + pulse, an energy ring fires on close. Line: *"Your suppliers don't agree
   on anything."*
2. **3–7.4s** — format chips (PDF · CSV · EDIFACT D96A · X12 850 · cXML · UBL 2.1 ·
   custom XML · XLSX) fly in from their own angles, jitter, and clash into overload
   around the mark. Line: *"Every supplier wants purchase orders a different way."*
3. **7.4–12s** — the clutter funnels to center and collapses; the mark docks left
   and the wordmark resolves beside it into the full lockup + *"The missing link
   between buyers and suppliers."* → hard cut into the live product.

Why it beats v7: it reads as **designed motion with intent** (draw-on, clash,
funnel, resolve) instead of a static card followed by someone scrolling a webpage.
The brand mark is the literal hero — it holds the center while the formats clash,
then becomes the lockup, paying off the "one bridge" idea visually before the VO
even says it.

## Build (synchronous, deterministic)

```bash
# 1. capture the cold-open motion scene (no dev server needed)
node scripts/demo-video/v8/capture-cold-open.mjs

# 2. synth the 3 NEW opening VO lines (body VO is reused as-is)
node scripts/demo-video/v8/generate-coldopen-vo.mjs

# 3. assemble cold open + reused body + outro + music
node scripts/demo-video/v8/assemble-v8.mjs
```

Output → `scripts/demo-video/tools/out/walkthrough-v8.mp4` (+ `-poster.jpg`, `.srt`).
1080p30 H.264 + AAC, faststart, ~2:53, <12 MB.

## Inputs reused (not re-recorded)

- `tools/out/walkthrough/capture.webm` — the v7 full-UI take (founder-approved).
- `tools/out/walkthrough/markers.json` — per-beat second offsets into that take.
- `tools/out/walkthrough/vo/*.mp3` — the 15 founder-approved body VO clips.
- `assets/music.mp3` — the committed ElevenLabs music bed.

## Notes

- VO voice: Daniel — Steady Broadcaster (`onwK4e9ZLuTAKqWW03F9`),
  `eleven_multilingual_v2` — identical to the body, so opening + body are one
  narrator. Key is read at runtime from
  `%USERPROFILE%\.proculink-secrets\elevenlabs.key` and never printed/committed.
- Everything under `v8/out/` is generated and git-ignored (the repo `out` rule).
  Only the pipeline source (this dir's `.html` / `.mjs` / `.json` / `.md`) is tracked.
- Verified: 0 decode errors; mean ≈ -22.9 dB / max -2.0 dB (no clip) / -20.5 LUFS;
  every beat frame-eyeballed incl. the cold open and the hard cut.
