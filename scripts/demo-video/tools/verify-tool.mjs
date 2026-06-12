#!/usr/bin/env node
/**
 * Verify assembled per-tool MP4s: stream specs (1080p30 H.264 + AAC), zero
 * decode errors, mean loudness, and one extracted frame per beat (named
 * out/<tool>/check/<beat>.jpg) for the manual frame-eyeball pass.
 *
 *   node scripts/demo-video/tools/verify-tool.mjs <tool> [<tool> …]
 */
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const INTRO = parseFloat(process.env.DEMO_INTRO_SEC ?? "2.0");
const LEAD = parseFloat(process.env.DEMO_LEAD_SEC ?? "0.4");

for (const tool of process.argv.slice(2)) {
  const mp4 = resolve(here, "out", `${tool}.mp4`);
  const info = JSON.parse(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries",
      "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration,size",
      "-of", "json", mp4]).toString(),
  );
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.find((s) => s.codec_type === "audio");
  console.log(`[${tool}] ${v.codec_name} ${v.width}x${v.height}@${v.avg_frame_rate} + ${a.codec_name} ${a.sample_rate}Hz/${a.channels}ch · ${parseFloat(info.format.duration).toFixed(1)}s · ${(info.format.size / 1e6).toFixed(1)} MB`);

  // decode check (stderr must be empty)
  const dec = spawnSync(FFMPEG, ["-v", "error", "-i", mp4, "-f", "null", "NUL"], { encoding: "utf8" });
  console.log(`[${tool}] decode errors: ${dec.stderr.trim() === "" ? "0" : dec.stderr.trim()}`);

  // loudness
  const volRun = spawnSync(FFMPEG, ["-i", mp4, "-af", "volumedetect", "-f", "null", "NUL"], { encoding: "utf8" });
  const all = (volRun.stderr ?? "") + (volRun.stdout ?? "");
  const mean = all.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1];
  const max = all.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1];
  console.log(`[${tool}] mean ${mean} dB · max ${max} dB`);

  // per-beat frames for the eyeball pass
  const spec = JSON.parse(readFileSync(resolve(here, `${tool}.json`), "utf8"));
  const markers = JSON.parse(readFileSync(resolve(here, "out", tool, "markers.json"), "utf8"));
  const beats = spec.beats.filter((b) => markers[b.id] != null);
  const trim = Math.max(0, markers[beats[0].id] - LEAD);
  const checkDir = resolve(here, "out", tool, "check");
  mkdirSync(checkDir, { recursive: true });
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const start = markers[b.id] - trim + INTRO;
    const next = i + 1 < beats.length ? markers[beats[i + 1].id] - trim + INTRO : start + 10;
    const at = start + Math.min(5, Math.max(2.5, (next - start) * 0.6));
    execFileSync(FFMPEG, ["-y", "-ss", at.toFixed(2), "-i", mp4, "-frames:v", "1", "-q:v", "3", "-update", "1",
      resolve(checkDir, `${b.id}.jpg`)], { stdio: ["ignore", "ignore", "ignore"] });
  }
  console.log(`[${tool}] ${beats.length} beat frames → ${checkDir}`);
}
