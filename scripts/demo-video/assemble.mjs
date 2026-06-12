#!/usr/bin/env node
/**
 * Assemble the final card-based walkthrough MP4:
 *
 *   intro card → [ scene card + voiceover ] × N → outro card,  music bed under all.
 *
 *   node scripts/demo-video/assemble.mjs
 *
 * This is the CARD pipeline — no screen-recording. Each scene in scenes.json is
 * a clean, on-brand navy card (make-cards.mjs) shown for exactly its voiceover's
 * length (+ a small pad), with a subtle fade + slow zoom so it reads as motion,
 * not a static slideshow. The ElevenLabs voiceover for each scene is muxed onto
 * its own clip, so narration and caption always track the card on screen.
 *
 * Inputs (all produced by the sibling scripts):
 *   - out/cards/*.png            (make-cards.mjs — run automatically here)
 *   - out/vo/*.mp3 + manifest    (generate-vo.mjs — `bun run demo:vo`)
 *   - assets/music.mp3           (ElevenLabs Music bed — optional, looped)
 *
 * Flags / env:
 *   DEMO_MUSIC_VOL=0.10   music mix level (0..1)
 *   DEMO_PAD_SEC=1.0      silent pad added after each scene's VO
 *   DEMO_INTRO_SEC=4.5    intro card length
 *   DEMO_OUTRO_SEC=5.5    outro card length
 *   DEMO_VO_LEAD=0.5      delay before each scene's VO starts (lets the card land)
 *
 * Requires ffmpeg + ffprobe on PATH, and `magick` (ImageMagick) for the cards.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeCards } from "./make-cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "out");
mkdirSync(out, { recursive: true });

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const MUSIC_VOL = parseFloat(process.env.DEMO_MUSIC_VOL ?? "0.10");
const OUT_GAIN = parseFloat(process.env.DEMO_OUTPUT_GAIN_DB ?? "6");
// Pad = extra dwell after each scene's VO so the card has reading time and the
// pacing breathes (this is what lifts the cut to a comfortable ~2.5 min).
const PAD = parseFloat(process.env.DEMO_PAD_SEC ?? "1.8");
const VO_LEAD = parseFloat(process.env.DEMO_VO_LEAD ?? "0.5");
const INTRO = parseFloat(process.env.DEMO_INTRO_SEC ?? "5.0");
const OUTRO = parseFloat(process.env.DEMO_OUTRO_SEC ?? "6.0");
const W = 1920, H = 1080, FPS = 30;

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const noCaptions = args.includes("--no-captions");

const run = (a) => execFileSync(FFMPEG, a, { stdio: ["ignore", "ignore", "inherit"] });
const probeDur = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());

// 0. Render the brand + scene cards.
console.log("🎨 rendering cards …");
const cards = makeCards(out);

// 1. Voiceover manifest (per-scene durations).
const manifestPath = resolve(out, "vo", "manifest.json");
if (!existsSync(manifestPath)) { console.error("No out/vo/manifest.json — run `bun run demo:vo` first."); process.exit(1); }
const vo = JSON.parse(readFileSync(manifestPath, "utf8"));
const byId = Object.fromEntries(vo.map((v) => [v.id, v]));
const scenes = cards.scenes;

// 2. Build one clip per card.
//    A "still" card → an animated clip: scale, slow zoom (Ken Burns), fade in/out.
//    Scene clips carry the scene's VO (delayed by VO_LEAD); intro/outro are silent.
const clipsDir = resolve(out, "clips");
mkdirSync(clipsDir, { recursive: true });

function kenBurns(dur) {
  // Very gentle zoom from 1.00 → ~1.04 over the clip — motion without drama.
  const frames = Math.max(1, Math.round(dur * FPS));
  return (
    `scale=${W * 4}:-1,` +
    `zoompan=z='min(zoom+0.00035,1.045)':d=${frames}:s=${W}x${H}:fps=${FPS}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',` +
    `setsar=1`
  );
}

function imageClip(png, dur, outPath, { voFile, fadeOut } = {}) {
  const fIn = `fade=t=in:st=0:d=0.5`;
  const fOut = fadeOut ? `,fade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.6` : "";
  const vf = `${kenBurns(dur)},${fIn}${fOut},format=yuv420p`;
  if (voFile) {
    // VO delayed so the card lands first; clip held for dur; silence-padded tail.
    const ms = Math.round(VO_LEAD * 1000);
    run([
      "-y", "-loop", "1", "-i", png, "-i", resolve(out, "vo", voFile),
      "-filter_complex",
      `[0:v]${vf}[v];[1:a]adelay=${ms}|${ms},apad,aresample=44100[a]`,
      "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(2),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", outPath,
    ]);
  } else {
    run([
      "-y", "-loop", "1", "-i", png, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_complex", `[0:v]${vf}[v]`,
      "-map", "[v]", "-map", "1:a", "-t", dur.toFixed(2),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-shortest", outPath,
    ]);
  }
}

const clips = [];
const timeline = []; // { id, start, dur } for captions

console.log("🎬 intro card …");
const introClip = resolve(clipsDir, "00-intro.mp4");
imageClip(cards.intro, INTRO, introClip, { fadeOut: true });
clips.push(introClip);
let cursor = INTRO;

scenes.forEach((s, i) => {
  const voDur = byId[s.id]?.durationSec ?? 4;
  const dur = +(VO_LEAD + voDur + PAD).toFixed(2);
  const clip = resolve(clipsDir, `${String(i + 1).padStart(2, "0")}-${s.id}.mp4`);
  console.log(`🎬 ${s.id}  (vo ${voDur.toFixed(1)}s → clip ${dur.toFixed(1)}s)`);
  imageClip(cards.scenePngs[s.id], dur, clip, { voFile: byId[s.id]?.file, fadeOut: true });
  clips.push(clip);
  timeline.push({ id: s.id, vo: s.vo, start: cursor + VO_LEAD, dur: voDur });
  cursor += dur;
});

console.log("🎬 outro card …");
const outroClip = resolve(clipsDir, "99-outro.mp4");
imageClip(cards.outro, OUTRO, outroClip, { fadeOut: true });
clips.push(outroClip);
const totalDur = cursor + OUTRO;

// 3. Captions.srt over the final timeline.
if (!noCaptions) {
  const tc = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000); const p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`; };
  const srt = timeline.map((t, i) => `${i + 1}\n${tc(t.start)} --> ${tc(t.start + t.dur)}\n${t.vo.replace(/\s+/g, " ").trim()}\n`).join("\n");
  writeFileSync(resolve(out, "captions.srt"), srt, "utf8");
  console.log("📝 captions:", resolve(out, "captions.srt"));
}

// 4. Concat all clips (consistent codec/sr/ac → demuxer concat is safe).
const listPath = resolve(out, "_concat.txt");
writeFileSync(listPath, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
const concatOut = resolve(out, "core.mp4");
// Stream-copy the video (already uniform H.264) but RE-ENCODE the audio so the
// per-clip AAC frames stitch with clean, monotonic timestamps (a plain `-c copy`
// concat of separately-encoded clips warns on non-monotonic DTS at each seam).
run([
  "-y", "-f", "concat", "-safe", "0", "-i", listPath,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
  "-video_track_timescale", "30000", concatOut,
]);

// 5. Final: music bed under the whole timeline + output loudness lift.
const music = arg("music", existsSync(resolve(here, "assets", "music.mp3")) ? resolve(here, "assets", "music.mp3") : "");
const finalOut = resolve(out, "walkthrough.mp4");
if (music) {
  console.log(`🎵 music : ${music} @ vol ${MUSIC_VOL}`);
  run([
    "-y", "-i", concatOut, "-i", music,
    "-filter_complex",
    `[1:a]aloop=loop=-1:size=2e9,volume=${MUSIC_VOL},afade=t=in:d=2,afade=t=out:st=${(totalDur - 2).toFixed(2)}:d=2[m];` +
      `[0:a][m]amix=inputs=2:duration=first:normalize=0,volume=${OUT_GAIN}dB,alimiter=limit=0.95[aout]`,
    "-map", "0:v", "-map", "[aout]", "-t", totalDur.toFixed(2),
    "-c:v", "copy", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalOut,
  ]);
} else {
  run([
    "-y", "-i", concatOut, "-af", `volume=${OUT_GAIN}dB,alimiter=limit=0.95`,
    "-c:v", "copy", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalOut,
  ]);
}

rmSync(listPath, { force: true });
const finalDur = probeDur(finalOut);
console.log(`\n✅ ${finalOut}  —  ${finalDur.toFixed(1)}s`);
