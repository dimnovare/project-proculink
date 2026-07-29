#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveProcessTimeoutMs,
  runFilmProcess,
} from "./film-process.mjs";
import { loadFilmSpec, validateFilmSpec } from "./film-spec.ts";
import { renderFilmCards } from "./render-film-cards.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OPTIONS = Object.freeze({
  musicVolume: 0.1,
  outputGain: 1.45,
  introSeconds: 2.4,
  outroSeconds: 3,
});

export const FINAL_VIDEO_ENCODING_ARGS = Object.freeze([
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
]);

function finitePositive(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}.`);
  }
  return parsed;
}

function finiteNonNegative(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value}.`);
  }
  return parsed;
}

function assemblyOptions(env = process.env) {
  return {
    musicVolume: finiteNonNegative(
      env.FILM_MUSIC_VOLUME ?? DEFAULT_OPTIONS.musicVolume,
      "film music volume",
    ),
    outputGain: finitePositive(
      env.FILM_OUTPUT_GAIN ?? DEFAULT_OPTIONS.outputGain,
      "film output gain",
    ),
    introSeconds: finitePositive(
      env.FILM_INTRO_SECONDS ?? DEFAULT_OPTIONS.introSeconds,
      "film intro duration",
    ),
    outroSeconds: finitePositive(
      env.FILM_OUTRO_SECONDS ?? DEFAULT_OPTIONS.outroSeconds,
      "film outro duration",
    ),
  };
}

function seconds(value) {
  return Number(value.toFixed(3));
}

function durationText(value) {
  return value.toFixed(3);
}

function indexManifest(spec, manifest) {
  if (!Array.isArray(manifest)) {
    throw new Error("Narration manifest must be an array.");
  }
  const expectedIds = new Set(spec.beats.map((beat) => beat.id));
  const byId = new Map();
  for (const item of manifest) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Invalid narration manifest entry.");
    }
    if (typeof item.id !== "string" || !item.id) {
      throw new Error("Invalid narration manifest beat id.");
    }
    if (!expectedIds.has(item.id)) {
      throw new Error(`Unknown narration manifest beat: ${item.id}.`);
    }
    if (byId.has(item.id)) {
      throw new Error(`Duplicate narration manifest beat id: ${item.id}.`);
    }
    if (typeof item.file !== "string" || !item.file) {
      throw new Error(`Missing narration file for beat ${item.id}.`);
    }
    finitePositive(item.durationSec, `narration duration for ${item.id}`);
    byId.set(item.id, item);
  }
  for (const beat of spec.beats) {
    if (!byId.has(beat.id)) {
      throw new Error(`Missing narration manifest beat: ${beat.id}.`);
    }
  }
  return byId;
}

function cardClipArgs(cardPath, voicePath, duration, outputPath) {
  const audioInputs = voicePath
    ? ["-i", voicePath]
    : [
        "-f",
        "lavfi",
        "-t",
        durationText(duration),
        "-i",
        "anullsrc=r=48000:cl=stereo",
      ];
  const audioFilter = voicePath
    ? `[1:a]aresample=48000,apad,atrim=duration=${durationText(duration)}[a]`
    : `[1:a]atrim=duration=${durationText(duration)}[a]`;
  return [
    "-y",
    "-loop",
    "1",
    "-t",
    durationText(duration),
    "-i",
    cardPath,
    ...audioInputs,
    "-filter_complex",
    `[0:v]scale=1920:1080,setsar=1,fps=30[v];${audioFilter}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    durationText(duration),
    ...FINAL_VIDEO_ENCODING_ARGS,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ];
}

function contentClipArgs({
  sourcePath,
  sourceStart,
  voicePath,
  duration,
  outputPath,
}) {
  return [
    "-y",
    ...(sourceStart === null
      ? []
      : ["-ss", durationText(sourceStart)]),
    "-t",
    durationText(duration),
    "-i",
    sourcePath,
    "-i",
    voicePath,
    "-filter_complex",
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
      `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,` +
      `tpad=stop_mode=clone:stop_duration=${durationText(duration)}[v];` +
      `[1:a]aresample=48000,apad,atrim=duration=${durationText(duration)}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    durationText(duration),
    ...FINAL_VIDEO_ENCODING_ARGS,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ];
}

function concatArgs(segmentPaths, duration, outputPath) {
  const inputs = segmentPaths.flatMap((path) => ["-i", path]);
  const streams = segmentPaths
    .map((_, index) => `[${index}:v][${index}:a]`)
    .join("");
  return [
    "-y",
    ...inputs,
    "-filter_complex",
    `${streams}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    durationText(duration),
    ...FINAL_VIDEO_ENCODING_ARGS,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    outputPath,
  ];
}

function finalMixArgs({
  pictureAndVoicePath,
  musicPath,
  duration,
  musicVolume,
  outputGain,
  outputPath,
}) {
  const exactDuration = durationText(duration);
  return [
    "-y",
    "-i",
    pictureAndVoicePath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-filter_complex",
    `[1:a]aresample=48000,atrim=duration=${exactDuration},` +
      `asetpts=PTS-STARTPTS,volume=${musicVolume}[music];` +
      `[0:a][music]amix=inputs=2:duration=first:normalize=0,` +
      `volume=${outputGain}[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-t",
    exactDuration,
    ...FINAL_VIDEO_ENCODING_ARGS,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export function buildAssemblyPlan({
  spec: specInput,
  outputRoot,
  markers,
  manifest,
  captureDuration,
  generatedDurations = {},
  musicPath,
  options = DEFAULT_OPTIONS,
}) {
  const spec = validateFilmSpec(specInput);
  const settings = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  finiteNonNegative(settings.musicVolume, "film music volume");
  finitePositive(settings.outputGain, "film output gain");
  finitePositive(settings.introSeconds, "film intro duration");
  finitePositive(settings.outroSeconds, "film outro duration");
  finitePositive(captureDuration, "capture duration");
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) {
    throw new Error("Capture markers must be an object.");
  }

  const byId = indexManifest(spec, manifest);
  const introBeats = spec.beats.filter((beat) => beat.overIntro);
  const outroBeats = spec.beats.filter((beat) => beat.overOutro);
  if (introBeats.length > 1 || outroBeats.length > 1) {
    throw new Error("Only one narration beat may play over each brand card.");
  }
  const contentBeats = spec.beats.filter(
    (beat) => !beat.overIntro && !beat.overOutro,
  );
  const capturedBeats = contentBeats.filter(
    (beat) => beat.source === "capture",
  );
  if (capturedBeats.length === 0) {
    throw new Error("A film requires at least one captured UI beat.");
  }

  for (const beat of capturedBeats) {
    if (!Object.hasOwn(markers, beat.id)) {
      throw new Error(`Missing capture marker for beat ${beat.id}.`);
    }
    finiteNonNegative(markers[beat.id], `capture marker for ${beat.id}`);
  }
  for (let index = 1; index < capturedBeats.length; index += 1) {
    if (
      Number(markers[capturedBeats[index].id]) <=
      Number(markers[capturedBeats[index - 1].id])
    ) {
      throw new Error("Capture markers must increase in film-spec order.");
    }
  }

  const outputDirectory = resolve(outputRoot, spec.id);
  const assemblyDirectory = resolve(outputDirectory, "assembly");
  const capturePath = resolve(outputDirectory, "capture.webm");
  const resolvedMusicPath =
    musicPath ?? resolve(here, "..", "assets", "music.mp3");
  const finalOutputPath = resolve(outputRoot, `${spec.id}.mp4`);
  const posterPath = resolve(outputRoot, `${spec.id}-poster.jpg`);
  const introPath = resolve(assemblyDirectory, "000-intro.mp4");
  const outroPath = resolve(assemblyDirectory, "999-outro.mp4");
  const pictureAndVoicePath = resolve(
    assemblyDirectory,
    "picture-and-voice.mp4",
  );
  const commands = [];
  const timeline = [];
  const segmentPaths = [introPath];
  let cursor = 0;

  const introBeat = introBeats[0];
  const introVoiceDuration = introBeat
    ? Number(byId.get(introBeat.id).durationSec)
    : 0;
  const introDuration = Math.max(
    Number(settings.introSeconds),
    introVoiceDuration + 0.4,
  );
  commands.push({
    label: "render intro clip",
    executable: "ffmpeg",
    args: cardClipArgs(
      resolve(outputDirectory, "cards", "intro.png"),
      introBeat
        ? resolve(outputDirectory, "vo", byId.get(introBeat.id).file)
        : null,
      introDuration,
      introPath,
    ),
  });
  if (introBeat) {
    timeline.push({
      id: introBeat.id,
      source: "intro",
      startSeconds: 0,
      durationSeconds: seconds(introDuration),
    });
  }
  cursor += introDuration;

  const captureIndex = new Map(
    capturedBeats.map((beat, index) => [beat.id, index]),
  );
  for (const [index, beat] of contentBeats.entries()) {
    const voice = byId.get(beat.id);
    const voicePath = resolve(outputDirectory, "vo", voice.file);
    const segmentPath = resolve(
      assemblyDirectory,
      `${String(index + 1).padStart(3, "0")}-${beat.id}.mp4`,
    );
    let duration;
    let sourcePath;
    let sourceStart = null;

    if (beat.source === "capture") {
      const markerIndex = captureIndex.get(beat.id);
      const start = Number(markers[beat.id]);
      const nextBeat = capturedBeats[markerIndex + 1];
      const end = nextBeat
        ? Number(markers[nextBeat.id])
        : Number(captureDuration);
      duration = end - start;
      finitePositive(duration, `captured segment duration for ${beat.id}`);
      if (Number(voice.durationSec) > duration) {
        throw new Error(
          `Narration for ${beat.id} exceeds its captured segment duration.`,
        );
      }
      sourcePath = capturePath;
      sourceStart = start;
    } else if (beat.source === "generated" && beat.kind === "abstract") {
      const generatedDuration = finitePositive(
        generatedDurations[beat.id],
        `generated segment duration for ${beat.id}`,
      );
      duration = Math.max(generatedDuration, Number(voice.durationSec) + 0.4);
      sourcePath = resolve(outputDirectory, "abstract", `${beat.id}.mp4`);
    } else {
      throw new Error(
        `Unsupported content source for beat ${beat.id}: ${beat.source}.`,
      );
    }

    duration = seconds(duration);
    commands.push({
      label: `render beat ${beat.id}`,
      executable: "ffmpeg",
      args: contentClipArgs({
        sourcePath,
        sourceStart,
        voicePath,
        duration,
        outputPath: segmentPath,
      }),
    });
    timeline.push({
      id: beat.id,
      source: beat.source,
      startSeconds: seconds(cursor),
      durationSeconds: duration,
    });
    segmentPaths.push(segmentPath);
    cursor += duration;
  }

  const outroBeat = outroBeats[0];
  const outroVoiceDuration = outroBeat
    ? Number(byId.get(outroBeat.id).durationSec)
    : 0;
  const outroDuration = Math.max(
    Number(settings.outroSeconds),
    outroVoiceDuration + 0.4,
  );
  commands.push({
    label: "render outro clip",
    executable: "ffmpeg",
    args: cardClipArgs(
      resolve(outputDirectory, "cards", "outro.png"),
      outroBeat
        ? resolve(outputDirectory, "vo", byId.get(outroBeat.id).file)
        : null,
      outroDuration,
      outroPath,
    ),
  });
  if (outroBeat) {
    timeline.push({
      id: outroBeat.id,
      source: "outro",
      startSeconds: seconds(cursor),
      durationSeconds: seconds(outroDuration),
    });
  }
  segmentPaths.push(outroPath);
  cursor += outroDuration;
  const totalDurationSeconds = seconds(cursor);

  commands.push({
    label: "concatenate picture and voice",
    executable: "ffmpeg",
    args: concatArgs(segmentPaths, totalDurationSeconds, pictureAndVoicePath),
  });
  commands.push({
    label: "mix final film",
    executable: "ffmpeg",
    args: finalMixArgs({
      pictureAndVoicePath,
      musicPath: resolvedMusicPath,
      duration: totalDurationSeconds,
      musicVolume: settings.musicVolume,
      outputGain: settings.outputGain,
      outputPath: finalOutputPath,
    }),
  });

  const firstCapturedBeat = capturedBeats[0];
  const firstCapturedDuration = timeline.find(
    (item) => item.id === firstCapturedBeat.id,
  ).durationSeconds;
  const posterSourceSeconds =
    Number(markers[firstCapturedBeat.id]) +
    Math.min(1, firstCapturedDuration / 2);
  commands.push({
    label: "extract real UI poster",
    executable: "ffmpeg",
    args: [
      "-y",
      "-ss",
      durationText(posterSourceSeconds),
      "-i",
      capturePath,
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease," +
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      posterPath,
    ],
  });

  return {
    filmId: spec.id,
    trimStartSeconds: Number(markers[firstCapturedBeat.id]),
    totalDurationSeconds,
    outputPath: finalOutputPath,
    posterPath,
    musicPath: resolvedMusicPath,
    timeline,
    commands,
  };
}

function probeDuration(filePath, runProcess, ffprobe, timeoutMs) {
  const result = runProcess(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      filePath,
    ],
    { timeoutMs },
  );
  return finitePositive(
    String(result?.stdout ?? result).trim(),
    `media duration for ${filePath}`,
  );
}

function requirePath(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`Missing required film input: ${path}. ${hint}`);
  }
}

export function assembleFilm(filmId, options = {}) {
  const env = options.env ?? process.env;
  const renderCards = options.renderCards ?? renderFilmCards;
  const spec = validateFilmSpec(options.spec ?? loadFilmSpec(filmId));
  if (spec.id !== filmId) {
    throw new Error(
      `Film id mismatch: requested ${filmId}, specification contains ${spec.id}.`,
    );
  }
  const outputRoot = options.outputRoot ?? resolve(here, "out");
  const outputDirectory = resolve(outputRoot, filmId);
  const capturePath = resolve(outputDirectory, "capture.webm");
  const markersPath = resolve(outputDirectory, "markers.json");
  const manifestPath = resolve(outputDirectory, "vo", "manifest.json");
  const musicPath = env.FILM_MUSIC_FILE
    ? resolve(process.cwd(), env.FILM_MUSIC_FILE)
    : resolve(here, "..", "assets", "music.mp3");

  requirePath(capturePath, "Run the film capture first.");
  requirePath(markersPath, "Run the film capture first.");
  requirePath(manifestPath, "Generate film narration first.");
  requirePath(musicPath, "Restore the committed film music bed.");

  const markers = JSON.parse(readFileSync(markersPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const item of manifest) {
    if (item?.file) {
      requirePath(
        resolve(outputDirectory, "vo", item.file),
        `Regenerate narration for ${item.id ?? "unknown beat"}.`,
      );
    }
  }

  const runProcess = options.runProcess ?? runFilmProcess;
  const timeoutMs = resolveProcessTimeoutMs(env);
  const ffmpeg = env.FFMPEG ?? "ffmpeg";
  const ffprobe = env.FFPROBE ?? "ffprobe";
  const captureDuration =
    options.captureDuration ??
    probeDuration(capturePath, runProcess, ffprobe, timeoutMs);
  const generatedDurations = {};
  for (const beat of spec.beats.filter(
    (candidate) =>
      !candidate.overIntro &&
      !candidate.overOutro &&
      candidate.source === "generated",
  )) {
    const generatedPath = resolve(
      outputDirectory,
      "abstract",
      `${beat.id}.mp4`,
    );
    requirePath(
      generatedPath,
      `Provide the approved abstract clip for ${beat.id}.`,
    );
    generatedDurations[beat.id] =
      options.generatedDurations?.[beat.id] ??
      probeDuration(
        generatedPath,
        runProcess,
        ffprobe,
        timeoutMs,
      );
  }

  const plan = buildAssemblyPlan({
    spec,
    outputRoot,
    markers,
    manifest,
    captureDuration,
    generatedDurations,
    musicPath,
    options: assemblyOptions(env),
  });
  const assemblyDirectory = resolve(outputDirectory, "assembly");
  mkdirSync(assemblyDirectory, { recursive: true });

  if (!options.dryRun) {
    renderCards(spec, outputDirectory, {
      magick: env.MAGICK,
      runProcess: options.cardRunProcess,
      timeoutMs,
    });
    for (const command of plan.commands) {
      runProcess(
        command.executable === "ffmpeg" ? ffmpeg : command.executable,
        command.args,
        { timeoutMs },
      );
    }
  }

  const planPath = resolve(outputDirectory, "assembly-plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { ...plan, planPath, dryRun: Boolean(options.dryRun) };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filmIds = args.filter((argument) => !argument.startsWith("--"));
  if (filmIds.length !== 1) {
    throw new Error("Usage: node assemble-film.mjs <film-id> [--dry-run]");
  }
  const result = assembleFilm(filmIds[0], { dryRun });
  console.log(
    dryRun
      ? `[${filmIds[0]}] wrote dry-run assembly plan: ${result.planPath}`
      : `[${filmIds[0]}] assembled ${result.outputPath}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
