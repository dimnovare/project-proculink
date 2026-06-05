#!/usr/bin/env node
/**
 * Regenerate the walkthrough music bed → assets/music.mp3.
 *
 * A calm, warm corporate pad: a sustained Cadd9 voicing (root/fifth/octave/
 * third + a soft 9th for colour), a GENTLE ~8-second breathing swell (not the
 * fast vibrato/tremolo of the earlier placeholder), a warm low-pass, a little
 * room, peak-limited so the downstream mix level (DEMO_MUSIC_VOL) is
 * predictable. Rendered 130s — longer than the whole video — so assemble's
 * aloop never has to splice (no loop-seam click).
 *
 * This is a synthesised PLACEHOLDER. To use a produced/licensed track instead,
 * just drop it at assets/music.mp3 (any mp3) and re-run `bun run demo:assemble`.
 *
 *   node scripts/demo-video/make-music.mjs
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "assets", "music.mp3");
mkdirSync(resolve(here, "assets"), { recursive: true });

// Cadd9 voicing (Hz) + per-voice level (lower notes carry, upper notes whisper).
const voices = [
  [130.81, 0.42], // C3  root / body
  [196.0, 0.30],  // G3  fifth
  [261.63, 0.30], // C4  octave
  [329.63, 0.24], // E4  major third
  [392.0, 0.20],  // G4  fifth
  [587.33, 0.10], // D5  add9 colour
];

const inputs = voices.flatMap(([hz]) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100`]);
const gains = voices.map(([, v], i) => `[${i}]volume=${v}[v${i}]`).join(";");
const mixIns = voices.map((_, i) => `[v${i}]`).join("");
const chain = [
  `amix=inputs=${voices.length}:normalize=0`,
  "tremolo=f=0.12:d=0.28", // ~8s gentle breathing swell
  "lowpass=f=1500",         // warm — roll off brightness
  "aecho=0.8:0.7:90:0.25",  // a little room
  "highpass=f=70",          // clean sub rumble
  "volume=15dB",            // bring the sine pad up to a usable level…
  "alimiter=limit=0.9",     // …then peak-limit → predictable mix level
  "aformat=channel_layouts=stereo:sample_rates=44100",
].join(",");

execFileSync(
  FFMPEG,
  ["-y", ...inputs, "-filter_complex", `${gains};${mixIns}${chain}[out]`,
    "-map", "[out]", "-t", "130", "-c:a", "libmp3lame", "-q:a", "3", outFile],
  { stdio: "inherit" },
);
console.log(`✅ music bed → ${outFile}`);
