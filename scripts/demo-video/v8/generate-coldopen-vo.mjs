#!/usr/bin/env node
/**
 * Generate the v8 COLD-OPEN voiceover (3 lines) with ElevenLabs.
 *
 * The walkthrough BODY reuses the already-produced, founder-approved per-beat
 * VO mp3s under tools/out/walkthrough/vo/ — only the new opening is synthesised
 * here, so the one cohesive narration = [3 new opening lines] + [15 body lines].
 *
 *   node scripts/demo-video/v8/generate-coldopen-vo.mjs
 *
 * Voice: Daniel — Steady Broadcaster (onwK4e9ZLuTAKqWW03F9), model
 * eleven_multilingual_v2 — identical to the rest of the walkthrough so the
 * opening and body are the same narrator. Key read from env or
 * %USERPROFILE%\.proculink-secrets\elevenlabs.key — NEVER printed/committed.
 *
 * Output: v8/out/vo/<id>.mp3 + v8/out/vo/coldopen-manifest.json (durations).
 *
 * Flags: --dry-run  → write the script only, no API calls.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const spec = JSON.parse(readFileSync(resolve(here, "walkthrough-v8.json"), "utf8"));
const lines = spec.coldOpen.vo;

const voDir = resolve(here, "out", "vo");
mkdirSync(voDir, { recursive: true });
writeFileSync(
  resolve(here, "out", "coldopen-script.txt"),
  lines.map((l) => `# ${l.id} @ ${l.atSec}s\n${l.vo}\n`).join("\n"),
  "utf8",
);

if (dryRun) {
  console.log("[v8 cold-open VO] wrote coldopen-script.txt (dry run)");
  process.exit(0);
}

function readApiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const keyFile = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".proculink-secrets", "elevenlabs.key");
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  return null;
}
const API_KEY = readApiKey();
if (!API_KEY) {
  console.error("No ElevenLabs key (env ELEVENLABS_API_KEY or ~/.proculink-secrets/elevenlabs.key).");
  process.exit(1);
}

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

const manifest = [];
for (const l of lines) {
  const file = resolve(voDir, `${l.id}.mp3`);
  process.stdout.write(`[v8 cold-open VO] TTS ${l.id} … `);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: l.vo,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    console.error(`\nElevenLabs failed for ${l.id}: ${res.status}\n${await res.text()}`);
    process.exit(1);
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const dur = parseFloat(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim(),
  );
  manifest.push({ id: l.id, file: `${l.id}.mp3`, atSec: l.atSec, durationSec: dur });
  console.log(`${dur.toFixed(2)}s`);
}
writeFileSync(resolve(voDir, "coldopen-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[v8 cold-open VO] ✅ ${manifest.length} clips → ${voDir}`);
