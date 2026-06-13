#!/usr/bin/env node
/**
 * Assemble one PER-TOOL walkthrough MP4:
 *
 *   branded intro card (logo + tool name) → real-UI screen recording with the
 *   ElevenLabs narration synced to the beat markers + a low music bed →
 *   branded outro card.
 *
 *   node scripts/demo-video/tools/assemble-tool.mjs upload [review …]
 *
 * Inputs (per tool, under tools/out/<tool>/):
 *   capture.webm        Playwright recording (demo:tools:capture)
 *   markers.json        beat → seconds offsets written by the capture spec
 *   vo/manifest.json    beat VO durations + mp3s (demo:tools:vo)
 *   cards/intro|outro.png  (re-rendered automatically via make-tool-cards.mjs)
 *   ../assets/music.mp3 the committed ElevenLabs music bed
 *
 * Output: tools/out/<tool>.mp4 (+ <tool>-poster.jpg + <tool>.srt),
 * 1080p H.264 + AAC, faststart. Adapted from the v5 footage assembler
 * (git 8888453:scripts/demo-video/assemble.mjs).
 *
 * Env:
 *   DEMO_MUSIC_VOL=0.14   music mix level (0..1) — tutorial bed, subordinate
 *   DEMO_LEAD_SEC=0.4     lead-in kept before the first beat marker
 *   DEMO_INTRO_SEC=2.0    intro card seconds · DEMO_OUTRO_SEC=3.2
 *
 * Requires ffmpeg + ffprobe (and ImageMagick for the cards) on PATH.
 */
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeToolCards } from "./make-tool-cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const MUSIC_VOL = parseFloat(process.env.DEMO_MUSIC_VOL ?? "0.14");
// Final output gain — lifts the whole mix to the v5 reference loudness
// (mean ≈ -21 dB). VO peaks ≈ -8 dB before gain, so 1.7 (+4.6 dB) stays clear
// of clipping (max ≈ -3.3 dB).
const OUT_GAIN = parseFloat(process.env.DEMO_OUT_GAIN ?? "1.7");
const LEAD = parseFloat(process.env.DEMO_LEAD_SEC ?? "0.4");
// Music fade-in seconds (DEMO_MUSIC_FADEIN). Shorter = the bed establishes faster
// over the intro card; default keeps the original 1.5s behaviour.
const MUSIC_FADEIN = parseFloat(process.env.DEMO_MUSIC_FADEIN ?? "1.5");
const INTRO = parseFloat(process.env.DEMO_INTRO_SEC ?? "2.0");
const OUTRO = parseFloat(process.env.DEMO_OUTRO_SEC ?? "3.2");

const run = (a) => execFileSync(FFMPEG, a, { stdio: ["ignore", "ignore", "inherit"] });
const probeDur = (f) =>
  parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());

const tools = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (tools.length === 0) {
  console.error("Usage: node assemble-tool.mjs <tool> [<tool> …]");
  process.exit(1);
}

for (const tool of tools) {
  const spec = JSON.parse(readFileSync(resolve(here, `${tool}.json`), "utf8"));
  const dir = resolve(here, "out", tool);
  const videoIn = resolve(dir, "capture.webm");
  const markersPath = resolve(dir, "markers.json");
  const manifestPath = resolve(dir, "vo", "manifest.json");
  for (const [p, hint] of [
    [videoIn, "run `bun run demo:tools:capture`"],
    [markersPath, "run `bun run demo:tools:capture`"],
    [manifestPath, "run `bun run demo:tools:vo`"],
  ]) {
    if (!existsSync(p)) {
      console.error(`[${tool}] missing ${p} — ${hint}`);
      process.exit(1);
    }
  }

  const markers = JSON.parse(readFileSync(markersPath, "utf8"));
  const vo = JSON.parse(readFileSync(manifestPath, "utf8"));
  const byId = Object.fromEntries(vo.map((v) => [v.id, v]));
  const videoDur = probeDur(videoIn);
  console.log(`[${tool}] 🎞 footage ${videoDur.toFixed(1)}s · ${vo.length} VO clips`);

  // A beat flagged `overOutro:true` in the spec has its VO laid over the OUTRO
  // brand card (not the core footage), so the closing line never plays over a
  // stale/frozen product frame. It is excluded from the core VO mix; OUTRO is
  // auto-extended to fit its clip.
  const outroBeat = spec.beats.find((b) => b.overOutro && byId[b.id]);

  // Per-beat start offsets relative to the (lead-trimmed) footage.
  const beats = spec.beats.filter((b) => byId[b.id] && markers[b.id] != null && !b.overOutro);
  const trimStart = Math.max(0, (markers[beats[0].id] ?? 0) - LEAD);
  const starts = {};
  for (const b of beats) starts[b.id] = Math.max(0, markers[b.id] - trimStart);
  const lastEnd = Math.max(...beats.map((b) => starts[b.id] + byId[b.id].durationSec));
  const coreDur = Math.max(videoDur - trimStart, lastEnd) + 0.8;
  // Outro card holds its VO + a short tail; falls back to the env default.
  const outroVoDur = outroBeat ? byId[outroBeat.id].durationSec : 0;
  const outroDur = outroBeat ? Math.max(OUTRO, outroVoDur + 1.4) : OUTRO;
  const totalDur = INTRO + coreDur + outroDur;
  console.log(`[${tool}] ✂ trim ${trimStart.toFixed(1)}s · core ${coreDur.toFixed(1)}s · outro ${outroDur.toFixed(1)}s · total ${totalDur.toFixed(1)}s`);

  // 1. Voiceover track — delay each clip to its beat marker, mix.
  const voInputs = beats.flatMap((b) => ["-i", resolve(dir, "vo", byId[b.id].file)]);
  const delays = beats
    .map((b, i) => {
      const ms = Math.round(starts[b.id] * 1000);
      return `[${i}:a]adelay=${ms}|${ms}[a${i}]`;
    })
    .join(";");
  const mix = beats.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${beats.length}:normalize=0[vo]`;
  const voOut = resolve(dir, "voiceover.m4a");
  run(["-y", ...voInputs, "-filter_complex", `${delays};${mix}`, "-map", "[vo]", "-t", coreDur.toFixed(2), "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", voOut]);

  // 2. Captions (per-beat) — shifted by the intro card.
  const tc = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
  };
  const srtRows = beats.map((b) => ({ st: starts[b.id] + INTRO, dur: byId[b.id].durationSec, vo: b.vo }));
  if (outroBeat) {
    srtRows.push({ st: INTRO + coreDur + 0.45, dur: outroVoDur, vo: outroBeat.vo }); // over the outro card
  }
  const srt = srtRows
    .map((r, i) => `${i + 1}\n${tc(r.st)} --> ${tc(r.st + r.dur)}\n${r.vo.replace(/\s+/g, " ").trim()}\n`)
    .join("\n");
  const srtPath = resolve(here, "out", `${tool}.srt`);
  writeFileSync(srtPath, srt, "utf8");

  // 3. Core = footage (lead-trimmed, 1080p30, fade-in, frozen tail) + VO.
  const core = resolve(dir, "core.mp4");
  run(["-y", ...(trimStart > 0 ? ["-ss", trimStart.toFixed(3)] : []), "-i", videoIn, "-i", voOut,
    "-filter_complex",
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,fade=t=in:st=0:d=0.4,tpad=stop=-1:stop_mode=clone[v]",
    "-map", "[v]", "-map", "1:a", "-t", coreDur.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", core]);

  // 4. Intro / outro cards (re-rendered each run; cheap + deterministic).
  const cards = makeToolCards(tool);
  // A card clip with silent audio. `voFile` (optional) lays a VO clip over the
  // card, delayed by `voDelay` seconds (used for the over-outro closing line).
  const cardClip = (png, dur, out, fadeOut, voFile, voDelay = 0.45) => {
    const fades = `fade=t=in:d=0.45${fadeOut ? `,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5` : ""}`;
    const aArgs = voFile
      ? ["-i", voFile, "-filter_complex",
         `[1:a]adelay=${Math.round(voDelay * 1000)}|${Math.round(voDelay * 1000)},apad[av]`,
         "-map", "0:v", "-map", "[av]"]
      : ["-f", "lavfi", "-t", String(dur), "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v", "-map", "1:a"];
    run(["-y", "-loop", "1", "-t", String(dur), "-i", png,
      ...aArgs,
      "-vf", `scale=1920:1080,setsar=1,fps=30,${fades}`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-t", String(dur), out]);
  };
  const introClip = resolve(dir, "intro.mp4");
  const outroClip = resolve(dir, "outro.mp4");
  cardClip(cards.intro, INTRO, introClip, true);
  cardClip(cards.outro, outroDur, outroClip, false,
    outroBeat ? resolve(dir, "vo", byId[outroBeat.id].file) : null);

  // 5. Final: concat intro+core+outro; loop the music bed underneath, low.
  //    DEMO_MUSIC_FILE overrides the shared committed bed (assets/music.mp3) so a
  //    per-video bed (e.g. the v13 enterprise track) never overwrites the bed the
  //    10 published tool videos share. Falls back to the committed bed.
  const musicOverride = process.env.DEMO_MUSIC_FILE ? resolve(process.cwd(), process.env.DEMO_MUSIC_FILE) : "";
  const defaultMusic = resolve(here, "..", "assets", "music.mp3");
  const music = musicOverride && existsSync(musicOverride)
    ? musicOverride
    : existsSync(defaultMusic) ? defaultMusic : "";
  const finalOut = resolve(here, "out", `${tool}.mp4`);
  const inputs = ["-i", introClip, "-i", core, "-i", outroClip, ...(music ? ["-i", music] : [])];
  const concatF = "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[cv][ca]";
  const aOut = music
    ? `${concatF};[3:a]aloop=loop=-1:size=2e9,volume=${MUSIC_VOL},afade=t=in:d=${MUSIC_FADEIN},afade=t=out:st=${(totalDur - 2).toFixed(2)}:d=2[m];[ca][m]amix=inputs=2:duration=first:normalize=0,volume=${OUT_GAIN}[aout]`
    : `${concatF};[ca]volume=${OUT_GAIN}[aout]`;
  if (music) console.log(`[${tool}] 🎵 music @ vol ${MUSIC_VOL}`);
  run(["-y", ...inputs, "-filter_complex", aOut, "-map", "[cv]", "-map", "[aout]", "-t", totalDur.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalOut]);

  // 6. Poster — a real-UI frame from shortly after the first beat.
  const poster = resolve(here, "out", `${tool}-poster.jpg`);
  run(["-y", "-ss", (INTRO + 2.2).toFixed(2), "-i", finalOut, "-frames:v", "1", "-update", "1", "-q:v", "3", poster]);

  console.log(`[${tool}] ✅ ${finalOut}`);
  console.log(`[${tool}]    poster ${poster} · captions ${srtPath}`);
}
