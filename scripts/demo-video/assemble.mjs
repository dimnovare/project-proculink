#!/usr/bin/env node
/**
 * Assemble the final walkthrough MP4 from:
 *   - the Playwright screen capture (newest .webm under out/capture/)
 *   - the ElevenLabs voice clips (out/vo/*.mp3 + manifest.json)
 *   - scene markers (out/markers.json) for narration sync
 *   - an optional music bed (scripts/demo-video/assets/music.mp3)
 *
 * Produces out/walkthrough.mp4 (1080p, H.264 + AAC, faststart) and out/captions.srt.
 *
 *   node scripts/demo-video/assemble.mjs
 *
 * Flags:
 *   --video=<path>   Use a specific capture file instead of the newest .webm.
 *   --music=<path>   Use a specific music bed (default: assets/music.mp3 if present).
 *   --no-captions    Skip the .srt.
 *
 * Requires: ffmpeg + ffprobe on PATH.
 *
 * Sync model: each scene's narration is placed at its recorded marker time (the
 * moment its screen became ready during capture), so the voice always matches
 * the screen. If markers.json is absent, falls back to back-to-back narration
 * with a fixed gap. The video is trimmed/last-frame-padded to cover the audio.
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "out");
mkdirSync(out, { recursive: true });

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const GAP = parseFloat(process.env.DEMO_GAP_SEC ?? "0.6");
const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const noCaptions = args.includes("--no-captions");

const scenes = JSON.parse(readFileSync(resolve(here, "scenes.json"), "utf8"));
const manifestPath = resolve(out, "vo", "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No out/vo/manifest.json — run `bun run demo:vo` first.");
  process.exit(1);
}
const vo = JSON.parse(readFileSync(manifestPath, "utf8"));
const byId = Object.fromEntries(vo.map((v) => [v.id, v]));
const markers = existsSync(resolve(out, "markers.json"))
  ? JSON.parse(readFileSync(resolve(out, "markers.json"), "utf8"))
  : null;

function probeDur(file) {
  return parseFloat(
    execFileSync(FFPROBE, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file,
    ]).toString().trim(),
  );
}

// 1. Locate the capture video.
function newestWebm(dir) {
  let best = null;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".webm") && (!best || st.mtimeMs > best.m)) best = { p, m: st.mtimeMs };
    }
  };
  if (existsSync(dir)) walk(dir);
  return best?.p;
}
const videoIn = arg("video", newestWebm(resolve(out, "capture")));
if (!videoIn) {
  console.error("No capture .webm found. Run `bun run demo:capture` first (or pass --video=).");
  process.exit(1);
}
const videoDur = probeDur(videoIn);
console.log(`🎞  video : ${videoIn} (${videoDur.toFixed(1)}s)`);
console.log(markers ? "🎯 sync  : marker-based (out/markers.json)" : "🎯 sync  : fallback (no markers.json)");

// 2. Per-scene start offsets.
const starts = {};
if (markers) {
  for (const s of scenes) starts[s.id] = markers[s.id] ?? 0;
} else {
  let t = 0;
  for (const s of scenes) {
    starts[s.id] = t;
    t += (byId[s.id]?.durationSec ?? 0) + GAP;
  }
}
// Trim the lead-in (page load + cookie dismiss) so the video opens cleanly on
// the hero right as narration starts. Shift every marker by the same amount.
const LEAD = parseFloat(process.env.DEMO_LEAD_SEC ?? "0.3");
const trimStart = markers ? Math.max(0, (starts[scenes[0].id] ?? 0) - LEAD) : 0;
if (trimStart > 0) for (const s of scenes) starts[s.id] = Math.max(0, starts[s.id] - trimStart);

const lastEnd = Math.max(...scenes.map((s) => (starts[s.id] ?? 0) + (byId[s.id]?.durationSec ?? 0)));
const finalDur = Math.max(videoDur - trimStart, lastEnd) + 0.6;
if (trimStart > 0) console.log(`✂️  trim : ${trimStart.toFixed(1)}s lead-in`);
console.log(`🗣  narration ends ${lastEnd.toFixed(1)}s · final ${finalDur.toFixed(1)}s`);
for (const s of scenes) {
  console.log(`   ${s.id.padEnd(12)} @ ${(starts[s.id] ?? 0).toFixed(1)}s  (${(byId[s.id]?.durationSec ?? 0).toFixed(1)}s)`);
}

// 3. Voiceover track: delay each clip to its start, then mix to finalDur.
const voFiles = scenes.map((s) => byId[s.id]).filter(Boolean);
const inputs = voFiles.flatMap((v) => ["-i", resolve(out, "vo", v.file)]);
const delays = voFiles
  .map((v, i) => {
    const ms = Math.round((starts[v.id] ?? 0) * 1000);
    return `[${i}:a]adelay=${ms}|${ms}[a${i}]`;
  })
  .join(";");
const mix = voFiles.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voFiles.length}:normalize=0[vo]`;
const voOut = resolve(out, "voiceover.m4a");
execFileSync(
  FFMPEG,
  ["-y", ...inputs, "-filter_complex", `${delays};${mix}`, "-map", "[vo]",
    "-t", finalDur.toFixed(2), "-c:a", "aac", "-b:a", "192k", voOut],
  { stdio: "inherit" },
);

// 4. Captions.
if (!noCaptions) {
  const srt = scenes
    .map((s, i) => {
      const st = starts[s.id] ?? 0;
      const d = byId[s.id]?.durationSec ?? 3;
      return `${i + 1}\n${tc(st)} --> ${tc(st + d)}\n${s.vo.replace(/\s+/g, " ").trim()}\n`;
    })
    .join("\n");
  writeFileSync(resolve(out, "captions.srt"), srt, "utf8");
  console.log("📝 captions:", resolve(out, "captions.srt"));
}

// 5. Final mux: scale video to 1080p, extend last frame to cover narration,
//    overlay voiceover, optionally duck in a music bed.
const music = arg("music", existsSync(resolve(here, "assets", "music.mp3")) ? resolve(here, "assets", "music.mp3") : "");
const finalOut = resolve(out, "walkthrough.mp4");
const muxInputs = [...(trimStart > 0 ? ["-ss", trimStart.toFixed(3)] : []), "-i", videoIn, "-i", voOut];
const aFadeOut = `afade=t=out:st=${Math.max(0, finalDur - 1).toFixed(2)}:d=1`;
let aFilter;
if (music) {
  muxInputs.push("-i", music);
  aFilter =
    "[1:a]volume=1.0[v];" +
    "[2:a]aloop=loop=-1:size=2e9,volume=0.06[m];" +
    `[v][m]amix=inputs=2:duration=first:normalize=0,${aFadeOut}[aout]`;
  console.log("🎵 music  :", music);
} else {
  aFilter = `[1:a]${aFadeOut}[aout]`;
}
execFileSync(
  FFMPEG,
  ["-y", ...muxInputs,
    "-filter_complex",
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease," +
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30," +
      "fade=t=in:st=0:d=0.5,tpad=stop=-1:stop_mode=clone," +
      `fade=t=out:st=${Math.max(0, finalDur - 0.6).toFixed(2)}:d=0.6[vid];` + aFilter,
    "-map", "[vid]", "-map", "[aout]",
    "-t", finalDur.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalOut],
  { stdio: "inherit" },
);

console.log(`\n✅ ${finalOut}`);

function tc(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}
