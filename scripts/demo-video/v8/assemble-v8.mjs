#!/usr/bin/env node
/**
 * Assemble the v8 hero walkthrough:
 *
 *   [animated cold open]  →  [v7 real-UI body footage, reused]  →  [outro card]
 *
 * under ONE cohesive ElevenLabs narration and a continuous music bed.
 *
 *   node scripts/demo-video/v8/assemble-v8.mjs
 *
 * Inputs (all already produced — nothing is re-recorded here):
 *   v8/out/cold-open.webm                 the new motion scene (capture-cold-open.mjs)
 *   v8/out/vo/{o1,o2,o3}.mp3              the 3 new opening VO lines (generate-coldopen-vo.mjs)
 *   tools/out/walkthrough/capture.webm   the founder-approved full-UI take (v7 capture)
 *   tools/out/walkthrough/markers.json   per-beat second offsets into that take
 *   tools/out/walkthrough/vo/*.mp3       the 15 founder-approved body VO clips
 *   assets/music.mp3                     the committed ElevenLabs music bed
 *
 * Output: tools/out/walkthrough-v8.mp4 (+ -poster.jpg + .srt), 1080p30 H.264+AAC.
 *
 * Env (defaults tuned to the v5/v7 reference loudness):
 *   DEMO_MUSIC_VOL=0.14   DEMO_OUT_GAIN=1.7
 *   V8_BODY_FADE=0.5      hard-cut fade-in on the body (s)
 *   V8_OUTRO_SEC=3.4
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeOutroCard } from "./make-outro-card.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const MUSIC_VOL = parseFloat(process.env.DEMO_MUSIC_VOL ?? "0.14");
const OUT_GAIN = parseFloat(process.env.DEMO_OUT_GAIN ?? "1.7");
const BODY_FADE = parseFloat(process.env.V8_BODY_FADE ?? "0.5");
const OUTRO = parseFloat(process.env.V8_OUTRO_SEC ?? "3.4");
const BODY_LEAD = parseFloat(process.env.V8_BODY_LEAD ?? "0.4"); // lead kept before u1 marker

const run = (a) => execFileSync(FFMPEG, a, { stdio: ["ignore", "ignore", "inherit"] });
const probeDur = (f) =>
  parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());

const spec = JSON.parse(readFileSync(resolve(here, "walkthrough-v8.json"), "utf8"));
const outDir = resolve(here, "out");
const work = resolve(outDir, "work");
mkdirSync(work, { recursive: true });

// Resolve all inputs up-front; fail loudly with the exact missing path.
const coldWebm = resolve(here, spec.coldOpen.source);
const bodyWebm = resolve(here, spec.body.source);
const markersPath = resolve(here, spec.body.markers);
const bodyVoDir = resolve(here, spec.body.reuseVoFrom);
const music = resolve(here, "..", "assets", "music.mp3");
for (const [p, hint] of [
  [coldWebm, "run `node v8/capture-cold-open.mjs`"],
  [bodyWebm, "the v7 capture (tools/out/walkthrough/capture.webm)"],
  [markersPath, "the v7 capture markers"],
  [music, "the committed music bed (assets/music.mp3)"],
]) {
  if (!existsSync(p)) { console.error(`[v8] missing ${p} — ${hint}`); process.exit(1); }
}
for (const l of spec.coldOpen.vo) {
  const f = resolve(outDir, "vo", `${l.id}.mp3`);
  if (!existsSync(f)) { console.error(`[v8] missing cold-open VO ${f} — run generate-coldopen-vo.mjs`); process.exit(1); }
}

const markers = JSON.parse(readFileSync(markersPath, "utf8"));
const VID_FILTER = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30";

/* ─────────────────────────────────────────────────────────────────────────
   STAGE 1 — COLD OPEN (video + opening VO)
   ───────────────────────────────────────────────────────────────────────── */
const coldTrim = spec.coldOpen.trimSec;
console.log(`[v8] ❄ cold open → ${coldTrim.toFixed(1)}s`);

// 1a. cold-open VO track: each opening line delayed to its atSec, mixed to coldTrim.
const coVo = spec.coldOpen.vo;
const coVoOut = resolve(work, "coldopen-vo.m4a");
{
  const inputs = coVo.flatMap((l) => ["-i", resolve(outDir, "vo", `${l.id}.mp3`)]);
  const delays = coVo.map((l, i) => `[${i}:a]adelay=${Math.round(l.atSec * 1000)}|${Math.round(l.atSec * 1000)}[a${i}]`).join(";");
  const mix = coVo.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${coVo.length}:normalize=0[vo]`;
  run(["-y", ...inputs, "-filter_complex", `${delays};${mix}`, "-map", "[vo]", "-t", coldTrim.toFixed(2), "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", coVoOut]);
}

// 1b. cold-open video (trimmed, normalised) + its VO. Tail fades to navy for the hard cut.
const coldSeg = resolve(work, "seg-cold.mp4");
run(["-y", "-i", coldWebm, "-i", coVoOut,
  "-filter_complex", `[0:v]trim=0:${coldTrim.toFixed(2)},setpts=PTS-STARTPTS,${VID_FILTER}[v]`,
  "-map", "[v]", "-map", "1:a", "-t", coldTrim.toFixed(2),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", coldSeg]);

/* ─────────────────────────────────────────────────────────────────────────
   STAGE 2 — BODY (reused v7 footage from the u1-upload beat + body VO)
   ───────────────────────────────────────────────────────────────────────── */
const beats = spec.body.beats.filter((b) => markers[b.id] != null);
const u1 = markers[spec.body.startBeat];
const trimStart = Math.max(0, u1 - BODY_LEAD);
const bodyDurFull = probeDur(bodyWebm);

// per-beat offsets relative to the lead-trimmed body
const starts = {};
for (const b of beats) starts[b.id] = Math.max(0, markers[b.id] - trimStart);

// measure each reused body VO clip
const byId = {};
for (const b of beats) {
  const f = resolve(bodyVoDir, `${b.id}.mp3`);
  if (!existsSync(f)) { console.error(`[v8] missing body VO ${f}`); process.exit(1); }
  byId[b.id] = { file: f, dur: probeDur(f) };
}
const lastEnd = Math.max(...beats.map((b) => starts[b.id] + byId[b.id].dur));
const bodyDur = Math.max(bodyDurFull - trimStart, lastEnd) + spec.body.tailPadSec;
console.log(`[v8] 🎞 body trimStart ${trimStart.toFixed(1)}s · dur ${bodyDur.toFixed(1)}s (${beats.length} beats)`);

// 2a. body VO track
const bodyVoOut = resolve(work, "body-vo.m4a");
{
  const inputs = beats.flatMap((b) => ["-i", byId[b.id].file]);
  const delays = beats.map((b, i) => { const ms = Math.round(starts[b.id] * 1000); return `[${i}:a]adelay=${ms}|${ms}[a${i}]`; }).join(";");
  const mix = beats.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${beats.length}:normalize=0[vo]`;
  run(["-y", ...inputs, "-filter_complex", `${delays};${mix}`, "-map", "[vo]", "-t", bodyDur.toFixed(2), "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", bodyVoOut]);
}

// 2b. body video (lead-trimmed, normalised, fade-in for the hard cut, frozen tail) + VO
const bodySeg = resolve(work, "seg-body.mp4");
run(["-y", ...(trimStart > 0 ? ["-ss", trimStart.toFixed(3)] : []), "-i", bodyWebm, "-i", bodyVoOut,
  "-filter_complex", `[0:v]${VID_FILTER},fade=t=in:st=0:d=${BODY_FADE},tpad=stop=-1:stop_mode=clone[v]`,
  "-map", "[v]", "-map", "1:a", "-t", bodyDur.toFixed(2),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", bodySeg]);

/* ─────────────────────────────────────────────────────────────────────────
   STAGE 3 — OUTRO card
   ───────────────────────────────────────────────────────────────────────── */
const outroPng = makeOutroCard();
const outroSeg = resolve(work, "seg-outro.mp4");
run(["-y", "-loop", "1", "-t", String(OUTRO), "-i", outroPng,
  "-f", "lavfi", "-t", String(OUTRO), "-i", "anullsrc=r=44100:cl=stereo",
  "-vf", `scale=1920:1080,setsar=1,fps=30,fade=t=in:d=0.45`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", outroSeg]);

/* ─────────────────────────────────────────────────────────────────────────
   STAGE 4 — concat + continuous music bed + final gain
   ───────────────────────────────────────────────────────────────────────── */
const totalDur = coldTrim + bodyDur + OUTRO;
console.log(`[v8] ⏱ total ${totalDur.toFixed(1)}s · 🎵 music @ ${MUSIC_VOL} · gain ${OUT_GAIN}`);
const finalOut = resolve(outDir, "..", "..", "tools", "out", "walkthrough-v8.mp4");

const concatF = "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[cv][ca]";
const aOut = `${concatF};[3:a]aloop=loop=-1:size=2e9,volume=${MUSIC_VOL},afade=t=in:d=1.5,afade=t=out:st=${(totalDur - 2).toFixed(2)}:d=2[m];[ca][m]amix=inputs=2:duration=first:normalize=0,volume=${OUT_GAIN}[aout]`;
run(["-y", "-i", coldSeg, "-i", bodySeg, "-i", outroSeg, "-i", music,
  "-filter_complex", aOut, "-map", "[cv]", "-map", "[aout]", "-t", totalDur.toFixed(2),
  "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalOut]);

/* ─────────────────────────────────────────────────────────────────────────
   STAGE 5 — captions (.srt) + poster
   ───────────────────────────────────────────────────────────────────────── */
const tc = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
};
let idx = 0;
const cues = [];
for (const l of spec.coldOpen.vo) {
  const dur = probeDur(resolve(outDir, "vo", `${l.id}.mp3`));
  cues.push(`${++idx}\n${tc(l.atSec)} --> ${tc(l.atSec + dur)}\n${l.vo}\n`);
}
for (const b of beats) {
  const st = coldTrim + starts[b.id];
  cues.push(`${++idx}\n${tc(st)} --> ${tc(st + byId[b.id].dur)}\n${b.vo.replace(/\s+/g, " ").trim()}\n`);
}
const srtPath = resolve(outDir, "..", "..", "tools", "out", "walkthrough-v8.srt");
writeFileSync(srtPath, cues.join("\n"), "utf8");

const poster = resolve(outDir, "..", "..", "tools", "out", "walkthrough-v8-poster.jpg");
run(["-y", "-ss", (coldTrim + 6).toFixed(2), "-i", finalOut, "-frames:v", "1", "-update", "1", "-q:v", "3", poster]);

console.log(`[v8] ✅ ${finalOut}`);
console.log(`[v8]    poster ${poster} · captions ${srtPath}`);
