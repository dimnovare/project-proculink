#!/usr/bin/env node
/**
 * Assemble the final walkthrough MP4:
 *   intro card → (footage + voiceover) → outro card,  with a music bed under it all.
 *
 *   node scripts/demo-video/assemble.mjs
 *
 * Inputs:
 *   - newest .webm under out/capture/      (Playwright screen capture)
 *   - out/vo/*.mp3 + out/vo/manifest.json  (ElevenLabs voiceover)
 *   - out/markers.json                     (scene timestamps for narration sync)
 *   - assets/music.mp3                      (optional music bed)
 *
 * Flags / env:
 *   --video=<path>        specific capture file
 *   --no-captions         skip captions.srt
 *   DEMO_MUSIC_VOL=0.22   music mix level (0..1) — bump if you can't hear it
 *   DEMO_LEAD_SEC=0.3     lead-in trimmed off the footage
 *
 * Requires ffmpeg + ffprobe on PATH.
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeLogos } from "./make-logo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "out");
mkdirSync(out, { recursive: true });

// Rasterise the navy-card logo (gradient mark + white wordmark) → out/logo-lockup.png.
const logos = await makeLogos(out);

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const GAP = parseFloat(process.env.DEMO_GAP_SEC ?? "0.6");
const MUSIC_VOL = parseFloat(process.env.DEMO_MUSIC_VOL ?? "0.22");
const INTRO = parseFloat(process.env.DEMO_INTRO_SEC ?? "4.5");
const OUTRO = parseFloat(process.env.DEMO_OUTRO_SEC ?? "5");
// Fonts for the title cards (escaped colon for the ffmpeg drawtext filter).
const FONT_BOLD = "C\\:/Windows/Fonts/arialbd.ttf";
const FONT_REG = "C\\:/Windows/Fonts/arial.ttf";

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const noCaptions = args.includes("--no-captions");

const scenes = JSON.parse(readFileSync(resolve(here, "scenes.json"), "utf8"));
const manifestPath = resolve(out, "vo", "manifest.json");
if (!existsSync(manifestPath)) { console.error("No out/vo/manifest.json — run `bun run demo:vo` first."); process.exit(1); }
const vo = JSON.parse(readFileSync(manifestPath, "utf8"));
const byId = Object.fromEntries(vo.map((v) => [v.id, v]));
const markers = existsSync(resolve(out, "markers.json"))
  ? JSON.parse(readFileSync(resolve(out, "markers.json"), "utf8")) : null;

const run = (a) => execFileSync(FFMPEG, a, { stdio: "inherit" });
const probeDur = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());

// 1. Locate the capture video.
function newestWebm(dir) {
  let best = null;
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else if (e.endsWith(".webm") && (!best || st.mtimeMs > best.m)) best = { p, m: st.mtimeMs }; } };
  if (existsSync(dir)) walk(dir);
  return best?.p;
}
const videoIn = arg("video", newestWebm(resolve(out, "capture")));
if (!videoIn) { console.error("No capture .webm found. Run `bun run demo:capture` first (or pass --video=)."); process.exit(1); }
const videoDur = probeDur(videoIn);
console.log(`🎞  video : ${videoIn} (${videoDur.toFixed(1)}s)`);

// 2. Per-scene start offsets (relative to the footage), lead-in trimmed.
const starts = {};
if (markers) { for (const s of scenes) starts[s.id] = markers[s.id] ?? 0; }
else { let t = 0; for (const s of scenes) { starts[s.id] = t; t += (byId[s.id]?.durationSec ?? 0) + GAP; } }
const LEAD = parseFloat(process.env.DEMO_LEAD_SEC ?? "0.3");
const trimStart = markers ? Math.max(0, (starts[scenes[0].id] ?? 0) - LEAD) : 0;
if (trimStart > 0) for (const s of scenes) starts[s.id] = Math.max(0, starts[s.id] - trimStart);

const lastEnd = Math.max(...scenes.map((s) => (starts[s.id] ?? 0) + (byId[s.id]?.durationSec ?? 0)));
const coreDur = Math.max(videoDur - trimStart, lastEnd) + 0.6;
const totalDur = INTRO + coreDur + OUTRO;
console.log(`✂️  trim ${trimStart.toFixed(1)}s · core ${coreDur.toFixed(1)}s · total ${totalDur.toFixed(1)}s (intro ${INTRO} + core + outro ${OUTRO})`);

// 3. Voiceover track (delay each clip to its marker, mix).
const voFiles = scenes.map((s) => byId[s.id]).filter(Boolean);
const voInputs = voFiles.flatMap((v) => ["-i", resolve(out, "vo", v.file)]);
const delays = voFiles.map((v, i) => { const ms = Math.round((starts[v.id] ?? 0) * 1000); return `[${i}:a]adelay=${ms}|${ms}[a${i}]`; }).join(";");
const mix = voFiles.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voFiles.length}:normalize=0[vo]`;
const voOut = resolve(out, "voiceover.m4a");
run(["-y", ...voInputs, "-filter_complex", `${delays};${mix}`, "-map", "[vo]", "-t", coreDur.toFixed(2), "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", voOut]);

// 4. Captions — shifted by the intro so they line up in the final cut.
if (!noCaptions) {
  const tc = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000); const p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`; };
  const srt = scenes.map((s, i) => { const st = (starts[s.id] ?? 0) + INTRO; const d = byId[s.id]?.durationSec ?? 3; return `${i + 1}\n${tc(st)} --> ${tc(st + d)}\n${s.vo.replace(/\s+/g, " ").trim()}\n`; }).join("\n");
  writeFileSync(resolve(out, "captions.srt"), srt, "utf8");
  console.log("📝 captions:", resolve(out, "captions.srt"));
}

// 5. Core = footage (scaled, lead-trimmed, fade-in, frozen tail) + voiceover.
const core = resolve(out, "core.mp4");
run(["-y", ...(trimStart > 0 ? ["-ss", trimStart.toFixed(3)] : []), "-i", videoIn, "-i", voOut,
  "-filter_complex",
  "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,fade=t=in:st=0:d=0.4,tpad=stop=-1:stop_mode=clone[v]",
  "-map", "[v]", "-map", "1:a", "-t", coreDur.toFixed(2),
  "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", core]);

// 6/7. Branded title cards: navy bg + the real ProcuLink logo (gradient mark +
// white wordmark) overlaid, + centered drawtext lines, fade in/out, silent
// stereo track (music is mixed over the whole timeline in step 8).
function makeCard(outPath, dur, opts) {
  const { lines, fadeOut = false, logo, logoW = 640, logoY = 350 } = opts;
  const draws = lines.map((l) => `drawtext=fontfile='${l.font}':text='${l.text}':fontcolor=${l.color}:fontsize=${l.size}:x=(w-text_w)/2:y=${l.y}`).join(",");
  const fadeOutF = fadeOut ? `,fade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.6` : "";
  const filter =
    `[2:v]scale=${logoW}:-1[lg];` +
    `[0:v][lg]overlay=(W-w)/2:${logoY}[bg];` +
    `[bg]${draws},fade=t=in:d=0.6${fadeOutF}[v]`;
  run(["-y",
    "-f", "lavfi", "-i", `color=c=0x0B1A2F:s=1920x1080:d=${dur}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-i", logo,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "1:a", "-t", String(dur),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", outPath]);
}
const intro = resolve(out, "intro.mp4");
const outro = resolve(out, "outro.mp4");
// Intro: logo + tagline.
makeCard(intro, INTRO, {
  logo: logos.lockup, logoW: 700, logoY: 400,
  lines: [
    { text: "The missing link between buyers and suppliers.", font: FONT_REG, size: 50, color: "0xC9D5E6", y: 625 },
  ],
  fadeOut: true,
});
// Outro: logo + statement + CTA.
makeCard(outro, OUTRO, {
  logo: logos.lockup, logoW: 660, logoY: 340,
  lines: [
    { text: "Connecting procurement.", font: FONT_BOLD, size: 58, color: "white", y: 560 },
    { text: "Start free at proculink.eu", font: FONT_BOLD, size: 44, color: "0x3DBE6B", y: 672 },
  ],
  fadeOut: true,
});

// 8. Final: concat intro+core+outro, overlay the music bed (audible).
const music = arg("music", existsSync(resolve(here, "assets", "music.mp3")) ? resolve(here, "assets", "music.mp3") : "");
const finalOut = resolve(out, "walkthrough.mp4");
const inputs = ["-i", intro, "-i", core, "-i", outro, ...(music ? ["-i", music] : [])];
const concatF = "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[cv][ca]";
const aOut = music
  ? `${concatF};[3:a]aloop=loop=-1:size=2e9,volume=${MUSIC_VOL},afade=t=in:d=2,afade=t=out:st=${(totalDur - 2).toFixed(2)}:d=2[m];[ca][m]amix=inputs=2:duration=first:normalize=0[aout]`
  : `${concatF};[ca]anull[aout]`;
if (music) console.log(`🎵 music : ${music} @ vol ${MUSIC_VOL}`);
run(["-y", ...inputs, "-filter_complex", aOut, "-map", "[cv]", "-map", "[aout]", "-t", totalDur.toFixed(2),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalOut]);

console.log(`\n✅ ${finalOut}`);
