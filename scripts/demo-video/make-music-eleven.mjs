#!/usr/bin/env node
/**
 * Generate the walkthrough music bed with the ElevenLabs Music API.
 *
 *   ELEVENLABS_API_KEY=… node scripts/demo-video/make-music-eleven.mjs <out.mp3> <length_ms> "<prompt>"
 *
 * Writes an mp3 to <out.mp3> and prints its measured duration. On API error it
 * prints the status + body (no key is ever logged). Requires ffprobe on PATH.
 *
 * To make this the video's bed, write/copy the chosen track to assets/music.mp3
 * and re-run `bun run demo:assemble`.
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }

const [, , outPath, lenMsArg, ...promptParts] = process.argv;
if (!outPath || !lenMsArg || promptParts.length === 0) {
  console.error('Usage: make-music-eleven.mjs <out.mp3> <length_ms> "<prompt>"');
  process.exit(1);
}
const music_length_ms = parseInt(lenMsArg, 10);
const prompt = promptParts.join(" ");

const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
  method: "POST",
  headers: { "xi-api-key": API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
  body: JSON.stringify({ prompt, music_length_ms }),
});

if (!res.ok) {
  console.error(`ElevenLabs Music failed: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(outPath, buf);
const dur = parseFloat(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", outPath])
    .toString().trim(),
);
console.log(`✅ ${outPath} — ${(buf.length / 1024).toFixed(0)} KB, ${dur.toFixed(1)}s`);
