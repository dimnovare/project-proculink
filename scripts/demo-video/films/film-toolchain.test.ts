import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildElevenLabsRequest,
  buildSilenceTrimArgs,
  formatVoiceoverScript,
  generateFilmVoiceover,
} from "./generate-film-vo.mjs";
import {
  buildCardRenderArgs,
  buildCardSvg,
  renderFilmCards,
} from "./render-film-cards.mjs";
import {
  FINAL_VIDEO_ENCODING_ARGS,
  assembleFilm,
  buildAssemblyPlan,
} from "./assemble-film.mjs";
import {
  buildContactSheetArgs,
  decodeErrorStatus,
  evaluateFilm,
  findCaptionFiles,
  parseVolumeDetect,
  verifyFilm,
} from "./verify-film.mjs";
import {
  buildWindowsTreeKillCommand,
  buildProcessOptions,
  resolveProcessTimeoutMs,
  runFilmProcess,
  terminateProcessTree,
} from "./film-process.mjs";

const temporaryDirectories: string[] = [];

const spec = {
  id: "toolchain-test",
  title: "ProcuLink film toolchain test",
  targetSeconds: { min: 15, max: 25 },
  intro: {
    kicker: "The bridge layer",
    headline: "From buyer order to supplier-ready output",
  },
  outro: {
    headline: "Every purchase order, ready for its supplier",
    cta: "proculink.eu",
  },
  beats: [
    {
      id: "welcome",
      kind: "brand",
      source: "card",
      vo: "Welcome narration must never become card text.",
      shot: "Intro card.",
      overIntro: true,
    },
    {
      id: "upload",
      kind: "ui",
      source: "capture",
      route: "/upload",
      vo: "Upload a buyer purchase order.",
      shot: "Upload screen.",
    },
    {
      id: "bridge",
      kind: "abstract",
      source: "generated",
      vo: "The document crosses the bridge.",
      shot: "Abstract document motion.",
    },
    {
      id: "review",
      kind: "ui",
      source: "capture",
      route: "/inbox/order-1",
      vo: "Review only the exception.",
      shot: "Order review.",
    },
    {
      id: "close",
      kind: "brand",
      source: "card",
      vo: "Closing narration must never become card text.",
      shot: "Outro card.",
      overOutro: true,
    },
  ],
} as const;

const manifest = spec.beats.map((beat) => ({
  id: beat.id,
  file: `${beat.id}.mp3`,
  durationSec: 2,
}));

function makeTemporaryDirectory() {
  const directory = resolve(
    tmpdir(),
    `proculink-film-toolchain-${process.pid}-${temporaryDirectories.length}`,
  );
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bounded external process execution", () => {
  it("constructs a finite process timeout and rejects invalid overrides", () => {
    expect(resolveProcessTimeoutMs({})).toBe(1_200_000);
    expect(
      resolveProcessTimeoutMs({ FILM_PROCESS_TIMEOUT_MS: "2500" }),
    ).toBe(2500);
    expect(() =>
      resolveProcessTimeoutMs({ FILM_PROCESS_TIMEOUT_MS: "0" }),
    ).toThrow(/process timeout/i);
    expect(buildProcessOptions({ timeoutMs: 2500 })).toMatchObject({
      timeout: 2500,
      windowsHide: true,
      shell: false,
    });
  });

  it("terminates a child process that does not exit", () => {
    const startedAt = Date.now();

    expect(() =>
      runFilmProcess(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 150 },
      ),
    ).toThrow(/timed out after 150 ms/i);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("terminates a chatty process when captured output exceeds its limit", () => {
    const startedAt = Date.now();

    expect(() =>
      runFilmProcess(
        process.execPath,
        [
          "-e",
          'setInterval(() => process.stdout.write("x".repeat(1024)), 1)',
        ],
        {
          maxOutputBytes: 2_048,
          timeoutMs: 5_000,
        },
      ),
    ).toThrow(/output exceeded 2 KiB/i);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("dispatches a safe Windows process-tree kill without shell interpolation", () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }> = [];
    const spawnSyncImpl = (
      command: string,
      args: string[],
      options: Record<string, unknown>,
    ) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(buildWindowsTreeKillCommand(4321)).toEqual({
      command: "taskkill",
      args: ["/PID", "4321", "/T", "/F"],
    });
    terminateProcessTree(4321, {
      platform: "win32",
      spawnSyncImpl,
    });
    expect(calls).toEqual([
      {
        command: "taskkill",
        args: ["/PID", "4321", "/T", "/F"],
        options: expect.objectContaining({
          shell: false,
          windowsHide: true,
        }),
      },
    ]);
  });
});

describe("film voiceover generation", () => {
  it("formats a review script without caption artifacts", () => {
    const script = formatVoiceoverScript(spec);

    expect(script).toContain("# welcome");
    expect(script).toContain(spec.beats[0].vo);
    expect(script).not.toMatch(/\.(srt|vtt|ass)\b/i);
    expect(script).not.toContain("-->");
  });

  it("constructs the approved ElevenLabs request defaults", () => {
    const request = buildElevenLabsRequest(spec.beats[1], "test-key", {});
    const body = JSON.parse(request.options.body);

    expect(request.url).toContain("/onwK4e9ZLuTAKqWW03F9");
    expect(request.options.headers["xi-api-key"]).toBe("test-key");
    expect(body.model_id).toBe("eleven_multilingual_v2");
    expect(body.voice_settings).toMatchObject({
      stability: 0.62,
      similarity_boost: 0.8,
      style: 0,
      speed: 1.06,
      use_speaker_boost: true,
    });
  });

  it("constructs fail-loud leading and trailing silence trimming", () => {
    const args = buildSilenceTrimArgs("raw.mp3", "trimmed.mp3");

    expect(args).toContain("raw.mp3");
    expect(args).toContain("trimmed.mp3");
    expect(args.join(" ")).toContain("silenceremove");
    expect(args.join(" ")).toContain("areverse");
  });

  it("dry-run writes only the review script and calls no external service", async () => {
    const outputRoot = makeTemporaryDirectory();
    let fetchCalls = 0;
    let processCalls = 0;

    const result = await generateFilmVoiceover(spec.id, {
      dryRun: true,
      outputRoot,
      spec,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("Dry-run called ElevenLabs.");
      },
      runProcess: () => {
        processCalls += 1;
        throw new Error("Dry-run launched a process.");
      },
    });

    expect(result.dryRun).toBe(true);
    expect(fetchCalls).toBe(0);
    expect(processCalls).toBe(0);
    expect(existsSync(resolve(outputRoot, spec.id, "voiceover-script.txt"))).toBe(true);
    expect(existsSync(resolve(outputRoot, spec.id, "vo"))).toBe(false);
    expect(readdirSync(resolve(outputRoot, spec.id))).toEqual([
      "voiceover-script.txt",
    ]);
  });

  it("can regenerate an existing narration clip through injected seams", async () => {
    const outputRoot = makeTemporaryDirectory();
    const oneBeatSpec = {
      ...spec,
      id: "voice-rerun-test",
      beats: [spec.beats[1]],
    };
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const runProcess = (command: string, args: string[]) => {
      if (command === "fake-ffmpeg") {
        copyFileSync(args[args.indexOf("-i") + 1], args.at(-1)!);
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "1.25", stderr: "" };
    };
    const options = {
      outputRoot,
      spec: oneBeatSpec,
      fetchImpl,
      runProcess,
      env: {
        ELEVENLABS_API_KEY: "injected-test-key",
        FFMPEG: "fake-ffmpeg",
        FFPROBE: "fake-ffprobe",
        FILM_PROCESS_TIMEOUT_MS: "1000",
      },
    };

    await generateFilmVoiceover(oneBeatSpec.id, options);
    await expect(
      generateFilmVoiceover(oneBeatSpec.id, options),
    ).resolves.toMatchObject({
      dryRun: false,
      manifest: [{ id: "upload", durationSec: 1.25 }],
    });
  });

  it("keeps the request timeout active while an MP3 body is stalled", async () => {
    const outputRoot = makeTemporaryDirectory();
    const oneBeatSpec = {
      ...spec,
      id: "voice-stalled-body-test",
      beats: [spec.beats[1]],
    };
    let processCalls = 0;
    const startedAt = Date.now();

    await expect(
      generateFilmVoiceover(oneBeatSpec.id, {
        outputRoot,
        spec: oneBeatSpec,
        env: {
          ELEVENLABS_API_KEY: "injected-test-key",
          FILM_PROCESS_TIMEOUT_MS: "80",
        },
        fetchImpl: async (_url, options) => ({
          ok: true,
          status: 200,
          text: async () => "",
          arrayBuffer: () =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => reject(new Error("body aborted")),
                { once: true },
              );
            }),
        }),
        runProcess: () => {
          processCalls += 1;
          throw new Error("Stalled body launched a process.");
        },
      }),
    ).rejects.toThrow(/body aborted/i);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(processCalls).toBe(0);
    expect(
      existsSync(
        resolve(outputRoot, oneBeatSpec.id, "vo", "upload.raw.mp3"),
      ),
    ).toBe(false);
  });
});

describe("branded film cards", () => {
  it("uses approved card copy without narration sentences", () => {
    const intro = buildCardSvg(spec, "intro");
    const outro = buildCardSvg(spec, "outro");

    expect(intro).toContain('width="1920"');
    expect(intro).toContain('height="1080"');
    expect(intro).toContain("The bridge layer");
    expect(intro).toContain("From buyer order");
    expect(outro).toContain("Every purchase order");
    expect(outro).toContain("proculink.eu");
    for (const beat of spec.beats) {
      expect(intro).not.toContain(beat.vo);
      expect(outro).not.toContain(beat.vo);
    }
  });

  it("constructs ImageMagick rendering from committed mark and lockup assets", () => {
    const args = buildCardRenderArgs({
      svgPath: "intro.svg",
      outputPath: "intro.png",
      markPath: "public/mark-primary.svg",
      lockupPath: "public/lockup-mono.svg",
    });
    const command = args.join(" ");

    expect(command).toContain("public/mark-primary.svg");
    expect(command).toContain("public/lockup-mono.svg");
    expect(command).toContain("1920x1080");
    expect(command.match(/-background none/g) ?? []).toHaveLength(2);
    expect(command.match(/-density 384/g) ?? []).toHaveLength(2);
    expect(args.at(-1)).toBe("intro.png");
  });

  it("exports the stable card paths", () => {
    const outputDirectory = makeTemporaryDirectory();
    const calls: string[][] = [];
    const result = renderFilmCards(spec, outputDirectory, {
      runProcess: (_command: string, args: string[]) => {
        calls.push(args);
      },
    });

    expect(result).toEqual({
      intro: resolve(outputDirectory, "cards", "intro.png"),
      outro: resolve(outputDirectory, "cards", "outro.png"),
    });
    expect(calls).toHaveLength(2);
  });
});

describe("no-caption film assembly", () => {
  it("uses one canonical final video encoding flag list", () => {
    expect(FINAL_VIDEO_ENCODING_ARGS).toEqual([
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
  });

  it("builds an ordered timeline and does not require card markers", () => {
    const plan = buildAssemblyPlan({
      spec,
      outputRoot: "C:/film/out",
      markers: { upload: 3, review: 8 },
      manifest,
      captureDuration: 12,
      generatedDurations: { bridge: 3 },
    });

    expect(plan.trimStartSeconds).toBe(3);
    expect(plan.timeline.map((beat) => beat.id)).toEqual([
      "welcome",
      "upload",
      "bridge",
      "review",
      "close",
    ]);
    expect(plan.timeline[0]).toMatchObject({ source: "intro", startSeconds: 0 });
    expect(plan.timeline.at(-1)).toMatchObject({ source: "outro" });
  });

  it("loops and trims a short music bed to a 110 second final duration", () => {
    const plan = buildAssemblyPlan({
      spec: {
        ...spec,
        targetSeconds: { min: 100, max: 120 },
      },
      outputRoot: "C:/film/out",
      markers: { upload: 3, review: 101 },
      manifest,
      captureDuration: 105,
      generatedDurations: { bridge: 3 },
    });
    const finalCommand = plan.commands.find(
      (command) => command.label === "mix final film",
    );
    const command = finalCommand?.args.join(" ") ?? "";

    expect(plan.totalDurationSeconds).toBe(110.4);
    expect(command).toContain("-stream_loop -1");
    expect(command).toContain("atrim=duration=110.400");
    expect(command).toContain("-t 110.400");
    expect(command).toContain("-c:v libx264 -preset medium -crf 20");
    expect(command).toContain("-pix_fmt yuv420p -r 30");
    expect(command).toContain(
      "-c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart",
    );
    expect(command).not.toMatch(/subtitles?|captions?|\.srt|\.vtt|\.ass/i);
  });

  it("fails when a captured content beat has no marker", () => {
    expect(() =>
      buildAssemblyPlan({
        spec,
        outputRoot: "C:/film/out",
        markers: { upload: 3 },
        manifest,
        captureDuration: 12,
        generatedDurations: { bridge: 3 },
      }),
    ).toThrow(/missing capture marker.*review/i);
  });

  it("rejects narration manifest entries that are not in the strict spec", () => {
    expect(() =>
      buildAssemblyPlan({
        spec,
        outputRoot: "C:/film/out",
        markers: { upload: 3, review: 8 },
        manifest: [
          ...manifest,
          { id: "unknown", file: "unknown.mp3", durationSec: 1 },
        ],
        captureDuration: 12,
        generatedDurations: { bridge: 3 },
      }),
    ).toThrow(/unknown narration manifest beat/i);
  });

  it("orchestrates probes, cards, assembly, music, and a real-capture poster", () => {
    const outputRoot = makeTemporaryDirectory();
    const filmDirectory = resolve(outputRoot, spec.id);
    mkdirSync(resolve(filmDirectory, "vo"), { recursive: true });
    mkdirSync(resolve(filmDirectory, "abstract"), { recursive: true });
    writeFileSync(resolve(filmDirectory, "capture.webm"), "capture");
    writeFileSync(
      resolve(filmDirectory, "markers.json"),
      JSON.stringify({ upload: 3, review: 8 }),
    );
    writeFileSync(
      resolve(filmDirectory, "vo", "manifest.json"),
      JSON.stringify(manifest),
    );
    for (const item of manifest) {
      writeFileSync(resolve(filmDirectory, "vo", item.file), "voice");
    }
    writeFileSync(
      resolve(filmDirectory, "abstract", "bridge.mp4"),
      "abstract",
    );
    const musicPath = resolve(outputRoot, "music.mp3");
    writeFileSync(musicPath, "music");
    const calls: Array<{ command: string; args: string[] }> = [];
    let renderedCards = 0;

    const result = assembleFilm(spec.id, {
      outputRoot,
      spec,
      env: {
        FFMPEG: "fake-ffmpeg",
        FFPROBE: "fake-ffprobe",
        FILM_MUSIC_FILE: musicPath,
        FILM_PROCESS_TIMEOUT_MS: "1000",
      },
      renderCards: () => {
        renderedCards += 1;
        return {
          intro: resolve(filmDirectory, "cards", "intro.png"),
          outro: resolve(filmDirectory, "cards", "outro.png"),
        };
      },
      runProcess: (command: string, args: string[]) => {
        calls.push({ command, args });
        if (command === "fake-ffprobe") {
          return {
            status: 0,
            stdout: args.at(-1)?.endsWith("capture.webm") ? "12" : "3",
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(renderedCards).toBe(1);
    expect(calls.slice(0, 2).map((call) => call.command)).toEqual([
      "fake-ffprobe",
      "fake-ffprobe",
    ]);
    expect(
      calls.filter((call) => call.command === "fake-ffmpeg"),
    ).toHaveLength(result.commands.length);
    const finalMix = calls.find((call) =>
      call.args.includes(resolve(outputRoot, `${spec.id}.mp4`)),
    );
    expect(finalMix?.args).toContain("-stream_loop");
    const poster = calls.at(-1);
    expect(poster?.args).toContain(resolve(filmDirectory, "capture.webm"));
    expect(poster?.args.at(-1)).toBe(
      resolve(outputRoot, `${spec.id}-poster.jpg`),
    );
    expect(
      existsSync(resolve(filmDirectory, "assembly-plan.json")),
    ).toBe(true);
  });
});

describe("film verification", () => {
  const healthyProbe = {
    format: { duration: "19.4" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        pix_fmt: "yuv420p",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30/1",
      },
      { codec_type: "audio", codec_name: "aac", channels: 2 },
    ],
  };

  it("parses FFmpeg volume detection output", () => {
    expect(
      parseVolumeDetect(
        "[Parsed_volumedetect_0] mean_volume: -20.4 dB\n" +
          "[Parsed_volumedetect_0] max_volume: -2.1 dB",
      ),
    ).toEqual({ meanDb: -20.4, peakDb: -2.1 });
  });

  it("passes only the required technical media shape", () => {
    const result = evaluateFilm({
      filmId: spec.id,
      spec,
      probe: healthyProbe,
      volume: { meanDb: -20.4, peakDb: -2.1 },
      decodeErrors: 0,
      captionFiles: [],
    });

    expect(result.failures).toEqual([]);
    expect(result.report).toMatchObject({
      filmId: spec.id,
      passed: true,
      video: {
        codec: "h264",
        pixelFormat: "yuv420p",
        width: 1920,
        height: 1080,
        fps: 30,
      },
      audio: { codec: "aac", channels: 2, meanDb: -20.4, peakDb: -2.1 },
      subtitleStreams: 0,
      decodeErrors: 0,
    });
  });

  it("rejects subtitle streams, decode errors, hot peaks, and missing audio", () => {
    const result = evaluateFilm({
      filmId: spec.id,
      spec,
      probe: {
        ...healthyProbe,
        streams: [
          healthyProbe.streams[0],
          { codec_type: "subtitle", codec_name: "mov_text" },
        ],
      },
      volume: { meanDb: -12, peakDb: -0.4 },
      decodeErrors: 2,
      captionFiles: ["out/toolchain-test/captions.srt"],
    });

    expect(result.report.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/audio stream/i);
    expect(result.failures.join("\n")).toMatch(/subtitle stream/i);
    expect(result.failures.join("\n")).toMatch(/decode error/i);
    expect(result.failures.join("\n")).toMatch(/peak/i);
    expect(result.failures.join("\n")).toMatch(/caption artifact/i);
  });

  it("rejects a video stream that is not yuv420p", () => {
    const result = evaluateFilm({
      filmId: spec.id,
      spec,
      probe: {
        ...healthyProbe,
        streams: [
          { ...healthyProbe.streams[0], pix_fmt: "yuv444p" },
          healthyProbe.streams[1],
        ],
      },
      volume: { meanDb: -20.4, peakDb: -2.1 },
      decodeErrors: 0,
      captionFiles: [],
    });

    expect(result.report.video.pixelFormat).toBe("yuv444p");
    expect(result.failures.join("\n")).toMatch(/yuv420p.*yuv444p/i);
  });

  it("reports decode status as a binary clean-or-error result", () => {
    expect(decodeErrorStatus({ status: 0, stdout: "", stderr: "" })).toBe(0);
    expect(
      decodeErrorStatus({
        status: 0,
        stdout: "",
        stderr: "first diagnostic\nsecond diagnostic",
      }),
    ).toBe(1);
    expect(decodeErrorStatus({ status: 1, stdout: "", stderr: "" })).toBe(1);
  });

  it("finds forbidden caption artifacts recursively", () => {
    const directory = makeTemporaryDirectory();
    mkdirSync(resolve(directory, "nested"), { recursive: true });
    writeFileSync(resolve(directory, "nested", "captions.vtt"), "WEBVTT");

    expect(findCaptionFiles(directory)).toEqual([
      resolve(directory, "nested", "captions.vtt"),
    ]);
  });

  it("builds a four-column contact sheet", () => {
    const args = buildContactSheetArgs(
      ["one.jpg", "two.jpg", "three.jpg", "four.jpg", "five.jpg"],
      "contact-sheet.jpg",
    );

    expect(args).toContain("4x");
    expect(args.at(-1)).toBe("contact-sheet.jpg");
  });

  it("orchestrates ffprobe, volume, decode, beat frames, and contact sheet", () => {
    const outputRoot = makeTemporaryDirectory();
    const filmDirectory = resolve(outputRoot, spec.id);
    mkdirSync(filmDirectory, { recursive: true });
    writeFileSync(resolve(outputRoot, `${spec.id}.mp4`), "film");
    writeFileSync(
      resolve(filmDirectory, "assembly-plan.json"),
      JSON.stringify({
        totalDurationSeconds: 19.4,
        timeline: spec.beats.map((beat, index) => ({
          id: beat.id,
          source: beat.overIntro
            ? "intro"
            : beat.overOutro
              ? "outro"
              : beat.source,
          startSeconds: index * 3,
          durationSeconds: 2,
        })),
      }),
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = verifyFilm(spec.id, {
      outputRoot,
      spec,
      env: {
        FFMPEG: "fake-ffmpeg",
        FFPROBE: "fake-ffprobe",
        MAGICK: "fake-magick",
        FILM_PROCESS_TIMEOUT_MS: "1000",
      },
      runProcess: (command: string, args: string[]) => {
        calls.push({ command, args });
        if (command === "fake-ffprobe") {
          return {
            status: 0,
            stdout: JSON.stringify(healthyProbe),
            stderr: "",
          };
        }
        if (args.includes("volumedetect")) {
          return {
            status: 0,
            stdout: "",
            stderr: "mean_volume: -20.4 dB\nmax_volume: -2.1 dB",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls[0]).toMatchObject({ command: "fake-ffprobe" });
    expect(calls[0].args).toContain("-of");
    expect(calls[0].args).toContain("json");
    expect(calls[1].args).toContain("volumedetect");
    expect(calls[2].args).toContain("0:v:0");
    expect(
      calls.filter(
        (call) =>
          call.command === "fake-ffmpeg" &&
          call.args.includes("-frames:v"),
      ),
    ).toHaveLength(spec.beats.length);
    expect(calls.at(-1)).toMatchObject({ command: "fake-magick" });
    expect(calls.at(-1)?.args).toContain("4x");
    expect(result.report.video.pixelFormat).toBe("yuv420p");
    expect(existsSync(result.reportPath)).toBe(true);
  });
});
