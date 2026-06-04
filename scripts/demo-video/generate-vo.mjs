#!/usr/bin/env node
/**
 * Generate the walkthrough voiceover with ElevenLabs.
 *
 * Reads scenes.json and produces one MP3 per scene under out/vo/, plus a
 * manifest.json with measured durations (used by assemble.mjs to sync the
 * narration to the footage).
 *
 *   ELEVENLABS_API_KEY=...  ELEVENLABS_VOICE_ID=...  node scripts/demo-video/generate-vo.mjs
 *
 * Flags:
 *   --dry-run   Only write out/voiceover-script.txt (no API calls). Useful if
 *               you'd rather paste the script into the ElevenLabs web app, or
 *               into Descript / another TTS tool.
 *
 * Requires: ffprobe on PATH (for duration measurement) unless --dry-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const scenes = JSON.parse(readFileSync(resolve(here, "scenes.json"), "utf8"));
const outDir = resolve(here, "out");
const voDir = resolve(outDir, "vo");
mkdirSync(voDir, { recursive: true });

// Always emit a plain-text script — handy for any TTS tool or manual recording.
writeFileSync(
  resolve(outDir, "voiceover-script.txt"),
  scenes.map((s) => `# ${s.id}\n${s.vo}\n`).join("\n"),
  "utf8",
);

if (process.argv.includes("--dry-run")) {
  console.log("Wrote out/voiceover-script.txt (dry run — no audio generated).");
  process.exit(0);
}

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

if (!API_KEY || !VOICE_ID) {
  console.error(
    "Missing ELEVENLABS_API_KEY and/or ELEVENLABS_VOICE_ID.\n" +
      "Pick a voice in the ElevenLabs app → copy its Voice ID. Or run with --dry-run.",
  );
  process.exit(1);
}

const manifest = [];
for (const s of scenes) {
  const file = resolve(voDir, `${s.id}.mp3`);
  process.stdout.write(`TTS ${s.id} … `);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: s.vo,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    console.error(`\nElevenLabs failed for ${s.id}: ${res.status}\n${await res.text()}`);
    process.exit(1);
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const dur = parseFloat(
    execFileSync(FFPROBE, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file,
    ]).toString().trim(),
  );
  manifest.push({ id: s.id, file: `${s.id}.mp3`, durationSec: dur });
  console.log(`${dur.toFixed(1)}s`);
}

writeFileSync(resolve(voDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n✅ ${manifest.length} voice clips → ${voDir}`);
