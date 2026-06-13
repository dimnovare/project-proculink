#!/usr/bin/env node
/**
 * Generate a per-tool walkthrough voiceover with ElevenLabs.
 *
 * Reads tools/<tool>.json and produces one MP3 per beat under
 * tools/out/<tool>/vo/, plus a manifest.json with measured durations. The
 * capture spec uses those durations as its per-beat hold budgets, and
 * assemble-tool.mjs uses them to sync narration to the beat markers.
 *
 *   node scripts/demo-video/tools/generate-tool-vo.mjs upload [review …]
 *
 * Voice: Daniel — Steady Broadcaster (onwK4e9ZLuTAKqWW03F9), the same voice as
 * the main walkthrough, model eleven_multilingual_v2.
 *
 * The API key is read from the env, or from
 * %USERPROFILE%\.proculink-secrets\elevenlabs.key — NEVER printed or committed.
 *
 * Flags:
 *   --dry-run   Only write out/<tool>/voiceover-script.txt (no API calls).
 *
 * Requires ffprobe on PATH (duration measurement) unless --dry-run.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tools = args.filter((a) => !a.startsWith("--"));
if (tools.length === 0) {
  console.error("Usage: node generate-tool-vo.mjs <tool> [<tool> …] [--dry-run]");
  process.exit(1);
}

function readApiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const keyFile = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".proculink-secrets", "elevenlabs.key");
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  return null;
}

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9"; // Daniel — Steady Broadcaster
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

// Voice settings. Defaults match the published tool library (stability 0.5).
// For a CALM, measured, teacherly delivery (the v10 explainer), raise stability
// (less expressive jitter) and keep style at 0 — set via env, e.g.
//   ELEVENLABS_STABILITY=0.72 node generate-tool-vo.mjs walkthrough-v10
//
// v11 PACING FIX: the founder said v10's calm read was TOO SLOW. The
// ElevenLabs `speed` voice-setting (range 0.7–1.2 on eleven_multilingual_v2,
// default 1.0) raises the delivery rate WITHOUT pitch-shifting; v11 ships at
// ELEVENLABS_SPEED=1.12 (~12% faster) with stability dropped back to 0.55 for a
// more confident, less-draggy read. After TTS we also HARD-TRIM leading/
// trailing silence (silenceremove) so no inter-clip padding survives.
const VS_STABILITY = parseFloat(process.env.ELEVENLABS_STABILITY ?? "0.5");
const VS_SIMILARITY = parseFloat(process.env.ELEVENLABS_SIMILARITY ?? "0.8");
const VS_STYLE = parseFloat(process.env.ELEVENLABS_STYLE ?? "0.0");
const VS_SPEED = parseFloat(process.env.ELEVENLABS_SPEED ?? "1.0");
// Hard silence trim of the rendered mp3 (kills any leading/trailing pad the
// model adds). Disable with ELEVENLABS_TRIM_SILENCE=0.
const TRIM_SILENCE = (process.env.ELEVENLABS_TRIM_SILENCE ?? "1") !== "0";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

for (const tool of tools) {
  const spec = JSON.parse(readFileSync(resolve(here, `${tool}.json`), "utf8"));
  const outDir = resolve(here, "out", tool);
  const voDir = resolve(outDir, "vo");
  mkdirSync(voDir, { recursive: true });

  // Always emit the plain-text script — review artifact + manual-TTS fallback.
  writeFileSync(
    resolve(outDir, "voiceover-script.txt"),
    spec.beats.map((b) => `# ${b.id}\n${b.vo}\n`).join("\n"),
    "utf8",
  );

  if (dryRun) {
    console.log(`[${tool}] wrote voiceover-script.txt (dry run)`);
    continue;
  }

  const API_KEY = readApiKey();
  if (!API_KEY) {
    console.error("No ElevenLabs key (env ELEVENLABS_API_KEY or ~/.proculink-secrets/elevenlabs.key).");
    process.exit(1);
  }

  const manifest = [];
  for (const b of spec.beats) {
    const file = resolve(voDir, `${b.id}.mp3`);
    process.stdout.write(`[${tool}] TTS ${b.id} … `);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text: b.vo,
        model_id: MODEL,
        voice_settings: { stability: VS_STABILITY, similarity_boost: VS_SIMILARITY, style: VS_STYLE, use_speaker_boost: true, speed: VS_SPEED },
      }),
    });
    if (!res.ok) {
      console.error(`\nElevenLabs failed for ${b.id}: ${res.status}\n${await res.text()}`);
      process.exit(1);
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));

    // Trim leading + trailing dead air so beats butt up with no inter-beat
    // padding (the v10 "stale screens / too slow" complaint), but KEEP the
    // natural sentence breathing inside each clip — over-trimming internal
    // pauses makes the read feel rushed/robotic. start_periods=1 trims only the
    // head; the single tail stop_periods=1 trims only the very end.
    if (TRIM_SILENCE) {
      const trimmed = `${file}.trim.mp3`;
      try {
        execFileSync(FFMPEG, ["-y", "-i", file, "-af",
          "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04," +
          "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.10,areverse",
          "-c:a", "libmp3lame", "-q:a", "2", trimmed], { stdio: ["ignore", "ignore", "ignore"] });
        writeFileSync(file, readFileSync(trimmed));
        execFileSync(process.platform === "win32" ? "cmd" : "rm",
          process.platform === "win32" ? ["/c", "del", "/q", trimmed] : ["-f", trimmed],
          { stdio: ["ignore", "ignore", "ignore"] });
      } catch (e) {
        console.log(` (trim skipped: ${(e?.message ?? e).toString().split("\n")[0]})`);
      }
    }

    const dur = parseFloat(
      execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file])
        .toString()
        .trim(),
    );
    manifest.push({ id: b.id, file: `${b.id}.mp3`, durationSec: dur });
    console.log(`${dur.toFixed(1)}s`);
  }

  writeFileSync(resolve(voDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[${tool}] ✅ ${manifest.length} voice clips → ${voDir}`);
}
