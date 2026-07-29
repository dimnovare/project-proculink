#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveProcessTimeoutMs,
  runFilmProcess,
} from "./film-process.mjs";
import { loadFilmSpec, validateFilmSpec } from "./film-spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_CAPTION_EXTENSIONS = new Set([".srt", ".vtt", ".ass"]);

function parseFrameRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  return bottom && Number.isFinite(top) && Number.isFinite(bottom)
    ? top / bottom
    : Number.NaN;
}

export function parseVolumeDetect(output) {
  const meanMatch = String(output).match(
    /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i,
  );
  const peakMatch = String(output).match(
    /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i,
  );
  if (!meanMatch || !peakMatch) {
    throw new Error("FFmpeg volumedetect did not report mean and peak volume.");
  }
  const meanDb = Number(meanMatch[1]);
  const peakDb = Number(peakMatch[1]);
  if (!Number.isFinite(meanDb) || !Number.isFinite(peakDb)) {
    throw new Error("Film audio is silent or has invalid volume measurements.");
  }
  return { meanDb, peakDb };
}

export function findCaptionFiles(directory) {
  if (!existsSync(directory)) return [];
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findCaptionFiles(path));
    } else if (
      entry.isFile() &&
      FORBIDDEN_CAPTION_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      matches.push(path);
    }
  }
  return matches.sort();
}

export function buildContactSheetArgs(framePaths, outputPath) {
  if (!Array.isArray(framePaths) || framePaths.length === 0) {
    throw new Error("At least one beat frame is required for a contact sheet.");
  }
  return [
    "montage",
    ...framePaths,
    "-tile",
    "4x",
    "-geometry",
    "480x270+0+0",
    "-background",
    "#0B1A2F",
    "-strip",
    outputPath,
  ];
}

export function evaluateFilm({
  filmId,
  spec: specInput,
  probe,
  volume,
  decodeErrors,
  captionFiles,
}) {
  const spec = validateFilmSpec(specInput);
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const subtitleStreams = streams.filter(
    (stream) => stream.codec_type === "subtitle",
  ).length;
  const durationSeconds = Number(probe?.format?.duration);
  const fps = parseFrameRate(
    videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate,
  );
  const failures = [];

  if (!Number.isFinite(durationSeconds)) {
    failures.push("Film duration is missing or invalid.");
  } else if (
    durationSeconds < spec.targetSeconds.min ||
    durationSeconds > spec.targetSeconds.max
  ) {
    failures.push(
      `Film duration ${durationSeconds}s is outside ` +
        `${spec.targetSeconds.min}-${spec.targetSeconds.max}s.`,
    );
  }
  if (!videoStream) failures.push("Film has no video stream.");
  if (videoStream?.codec_name !== "h264") {
    failures.push(`Expected H.264 video, found ${videoStream?.codec_name ?? "none"}.`);
  }
  if (videoStream?.width !== 1920 || videoStream?.height !== 1080) {
    failures.push(
      `Expected 1920x1080 video, found ${videoStream?.width ?? 0}x` +
        `${videoStream?.height ?? 0}.`,
    );
  }
  if (!Number.isFinite(fps) || Math.abs(fps - 30) > 0.001) {
    failures.push(`Expected 30 fps video, found ${fps}.`);
  }
  if (!audioStream) failures.push("Film has no audio stream.");
  if (audioStream && audioStream.codec_name !== "aac") {
    failures.push(`Expected AAC audio, found ${audioStream.codec_name}.`);
  }
  if (audioStream && audioStream.channels !== 2) {
    failures.push(`Expected stereo audio, found ${audioStream.channels} channels.`);
  }
  if (subtitleStreams !== 0) {
    failures.push(`Expected zero subtitle streams, found ${subtitleStreams}.`);
  }
  if (!Number.isInteger(decodeErrors) || decodeErrors !== 0) {
    failures.push(`Expected zero decode errors, found ${decodeErrors}.`);
  }
  if (
    typeof volume?.peakDb !== "number" ||
    !Number.isFinite(volume.peakDb)
  ) {
    failures.push("Film peak volume is missing or invalid.");
  } else if (volume.peakDb > -0.5) {
    failures.push(
      `Film peak ${volume.peakDb} dB exceeds the -0.5 dB ceiling.`,
    );
  }
  if (
    typeof volume?.meanDb !== "number" ||
    !Number.isFinite(volume.meanDb)
  ) {
    failures.push("Film mean volume is missing or invalid.");
  }
  if (captionFiles.length > 0) {
    failures.push(
      `Forbidden caption artifact found: ${captionFiles.join(", ")}.`,
    );
  }

  const report = {
    filmId,
    passed: failures.length === 0,
    durationSeconds,
    video: {
      codec: videoStream?.codec_name ?? null,
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      fps,
    },
    audio: {
      codec: audioStream?.codec_name ?? null,
      channels: audioStream?.channels ?? 0,
      meanDb: volume?.meanDb ?? null,
      peakDb: volume?.peakDb ?? null,
    },
    subtitleStreams,
    decodeErrors,
  };
  return { report, failures };
}

function countDecodeErrors(result) {
  const diagnostics = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (diagnostics.length > 0) return diagnostics.length;
  return result.status === 0 ? 0 : 1;
}

function requirePath(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`Missing required film QA input: ${path}. ${hint}`);
  }
}

export function verifyFilm(filmId, options = {}) {
  const env = options.env ?? process.env;
  const spec = validateFilmSpec(options.spec ?? loadFilmSpec(filmId));
  if (spec.id !== filmId) {
    throw new Error(
      `Film id mismatch: requested ${filmId}, specification contains ${spec.id}.`,
    );
  }

  const outputRoot = options.outputRoot ?? resolve(here, "out");
  const outputDirectory = resolve(outputRoot, filmId);
  const filmPath = resolve(outputRoot, `${filmId}.mp4`);
  const planPath = resolve(outputDirectory, "assembly-plan.json");
  requirePath(filmPath, "Assemble the film first.");
  requirePath(planPath, "Assemble the film first.");

  const runProcess = options.runProcess ?? runFilmProcess;
  const timeoutMs = resolveProcessTimeoutMs(env);
  const ffmpeg = env.FFMPEG ?? "ffmpeg";
  const ffprobe = env.FFPROBE ?? "ffprobe";
  const magick = env.MAGICK ?? "magick";
  const probeResult = runProcess(
    ffprobe,
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filmPath,
    ],
    { timeoutMs },
  );
  const probe = JSON.parse(probeResult.stdout);
  const hasAudio = probe.streams?.some(
    (stream) => stream.codec_type === "audio",
  );
  const volume = hasAudio
    ? parseVolumeDetect(
        runProcess(
          ffmpeg,
          [
            "-hide_banner",
            "-i",
            filmPath,
            "-map",
            "0:a:0",
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
          ],
          { timeoutMs },
        ).stderr,
      )
    : { meanDb: Number.NaN, peakDb: Number.NaN };
  const decodeResult = runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      filmPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-f",
      "null",
      "-",
    ],
    { allowFailure: true, timeoutMs },
  );
  const decodeErrors = countDecodeErrors(decodeResult);
  const captionFiles = findCaptionFiles(outputRoot);
  const evaluation = evaluateFilm({
    filmId,
    spec,
    probe,
    volume,
    decodeErrors,
    captionFiles,
  });

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const timelineById = new Map(
    (Array.isArray(plan.timeline) ? plan.timeline : []).map((item) => [
      item.id,
      item,
    ]),
  );
  const qaDirectory = resolve(outputDirectory, "qa");
  const framesDirectory = resolve(qaDirectory, "beats");
  mkdirSync(framesDirectory, { recursive: true });
  const framePaths = [];
  for (const beat of spec.beats) {
    const timelineBeat = timelineById.get(beat.id);
    if (!timelineBeat) {
      throw new Error(`Assembly plan has no timeline entry for beat ${beat.id}.`);
    }
    const timestamp = Math.min(
      Number(plan.totalDurationSeconds) - 0.05,
      Number(timelineBeat.startSeconds) +
        Math.min(1, Number(timelineBeat.durationSeconds) / 2),
    );
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`Invalid QA frame timestamp for beat ${beat.id}.`);
    }
    const framePath = resolve(framesDirectory, `${beat.id}.jpg`);
    runProcess(
      ffmpeg,
      [
        "-y",
        "-ss",
        timestamp.toFixed(3),
        "-i",
        filmPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        framePath,
      ],
      { timeoutMs },
    );
    framePaths.push(framePath);
  }

  const contactSheetPath = resolve(qaDirectory, "contact-sheet.jpg");
  runProcess(
    magick,
    buildContactSheetArgs(framePaths, contactSheetPath),
    { timeoutMs },
  );
  const reportPath = resolve(qaDirectory, "report.json");
  writeFileSync(
    reportPath,
    `${JSON.stringify(evaluation.report, null, 2)}\n`,
    "utf8",
  );

  if (!evaluation.report.passed) {
    throw new Error(
      `Film verification failed:\n- ${evaluation.failures.join("\n- ")}`,
    );
  }
  return {
    report: evaluation.report,
    reportPath,
    contactSheetPath,
    framePaths,
  };
}

function main() {
  const filmIds = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (filmIds.length !== 1) {
    throw new Error("Usage: node verify-film.mjs <film-id>");
  }
  const result = verifyFilm(filmIds[0]);
  console.log(`[${filmIds[0]}] verification passed: ${result.reportPath}`);
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
