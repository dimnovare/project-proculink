#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveProcessTimeoutMs,
  runFilmProcess,
} from "./film-process.mjs";
import { loadFilmSpec, validateFilmSpec } from "./film-spec.ts";

const here = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = Object.freeze({
  voiceId: "onwK4e9ZLuTAKqWW03F9",
  model: "eleven_multilingual_v2",
  stability: 0.62,
  similarity: 0.8,
  style: 0,
  speed: 1.06,
});

function numericSetting(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name} setting.`);
  }
  return parsed;
}

function voiceSettings(env = process.env) {
  return {
    voiceId: env.ELEVENLABS_VOICE_ID ?? DEFAULTS.voiceId,
    model: env.ELEVENLABS_MODEL ?? DEFAULTS.model,
    stability: numericSetting(
      env.ELEVENLABS_STABILITY,
      DEFAULTS.stability,
      "ElevenLabs stability",
    ),
    similarity: numericSetting(
      env.ELEVENLABS_SIMILARITY,
      DEFAULTS.similarity,
      "ElevenLabs similarity",
    ),
    style: numericSetting(
      env.ELEVENLABS_STYLE,
      DEFAULTS.style,
      "ElevenLabs style",
    ),
    speed: numericSetting(
      env.ELEVENLABS_SPEED,
      DEFAULTS.speed,
      "ElevenLabs speed",
    ),
  };
}

export function formatVoiceoverScript(specInput) {
  const spec = validateFilmSpec(specInput);
  return `${spec.beats
    .map((beat) => `# ${beat.id}\n${beat.vo.trim()}`)
    .join("\n\n")}\n`;
}

export function buildElevenLabsRequest(beat, apiKey, env = process.env) {
  const settings = voiceSettings(env);
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}`,
    options: {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: beat.vo,
        model_id: settings.model,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarity,
          style: settings.style,
          speed: settings.speed,
          use_speaker_boost: true,
        },
      }),
    },
  };
}

export function buildSilenceTrimArgs(inputPath, outputPath) {
  return [
    "-y",
    "-i",
    inputPath,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04," +
      "areverse," +
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.10," +
      "areverse",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath,
  ];
}

function readApiKey(env = process.env) {
  if (env.ELEVENLABS_API_KEY?.trim()) {
    return env.ELEVENLABS_API_KEY.trim();
  }
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const keyPath = join(home, ".proculink-secrets", "elevenlabs.key");
  if (!home || !existsSync(keyPath)) {
    return null;
  }
  return readFileSync(keyPath, "utf8").trim() || null;
}

function measuredDuration(output) {
  const duration = Number(String(output).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned an invalid narration duration: ${output}`);
  }
  return duration;
}

export async function generateFilmVoiceover(filmId, options = {}) {
  const env = options.env ?? process.env;
  const spec = validateFilmSpec(options.spec ?? loadFilmSpec(filmId));
  if (spec.id !== filmId) {
    throw new Error(
      `Film id mismatch: requested ${filmId}, specification contains ${spec.id}.`,
    );
  }

  const outputRoot = options.outputRoot ?? resolve(here, "out");
  const outputDirectory = resolve(outputRoot, filmId);
  const scriptPath = resolve(outputDirectory, "voiceover-script.txt");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(scriptPath, formatVoiceoverScript(spec), "utf8");

  if (options.dryRun) {
    return { dryRun: true, scriptPath, manifest: [] };
  }

  const apiKey = readApiKey(env);
  if (!apiKey) {
    throw new Error(
      "No ElevenLabs key. Set ELEVENLABS_API_KEY or add " +
        "~/.proculink-secrets/elevenlabs.key.",
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for ElevenLabs.");
  }
  const runProcess = options.runProcess ?? runFilmProcess;
  const timeoutMs = resolveProcessTimeoutMs(env);
  const ffmpeg = env.FFMPEG ?? "ffmpeg";
  const ffprobe = env.FFPROBE ?? "ffprobe";
  const voiceDirectory = resolve(outputDirectory, "vo");
  mkdirSync(voiceDirectory, { recursive: true });

  const manifest = [];
  for (const beat of spec.beats) {
    const request = buildElevenLabsRequest(beat, apiKey, env);
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let audioBuffer;
    try {
      response = await fetchImpl(request.url, {
        ...request.options,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `ElevenLabs failed for ${beat.id}: HTTP ${response.status}. ${detail}`,
        );
      }
      audioBuffer = await response.arrayBuffer();
    } finally {
      clearTimeout(requestTimeout);
    }

    const outputPath = resolve(voiceDirectory, `${beat.id}.mp3`);
    const rawPath = resolve(voiceDirectory, `${beat.id}.raw.mp3`);
    const trimmedPath = resolve(voiceDirectory, `${beat.id}.trimmed.mp3`);
    writeFileSync(rawPath, Buffer.from(audioBuffer));

    runProcess(ffmpeg, buildSilenceTrimArgs(rawPath, trimmedPath), {
      timeoutMs,
    });
    rmSync(outputPath, { force: true });
    renameSync(trimmedPath, outputPath);
    rmSync(rawPath, { force: true });

    const durationResult = runProcess(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        outputPath,
      ],
      { timeoutMs },
    );
    manifest.push({
      id: beat.id,
      file: `${beat.id}.mp3`,
      durationSec: measuredDuration(
        durationResult?.stdout ?? durationResult,
      ),
    });
  }

  const manifestPath = resolve(voiceDirectory, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dryRun: false, scriptPath, manifestPath, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filmIds = args.filter((argument) => !argument.startsWith("--"));
  if (filmIds.length !== 1) {
    throw new Error(
      "Usage: node generate-film-vo.mjs <film-id> [--dry-run]",
    );
  }

  const result = await generateFilmVoiceover(filmIds[0], { dryRun });
  if (result.dryRun) {
    console.log(`[${filmIds[0]}] wrote voiceover-script.txt (dry run)`);
  } else {
    console.log(
      `[${filmIds[0]}] wrote ${result.manifest.length} narration clips.`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
