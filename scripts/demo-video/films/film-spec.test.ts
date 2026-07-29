import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FilmClock, narrationBudgets } from "./capture-helpers";
import { validateFilmSpec } from "./film-spec";

const here = dirname(fileURLToPath(import.meta.url));
const manifestFilmId = "film-spec-test";

const valid = {
  id: "walkthrough-2026-07",
  title: "ProcuLink walkthrough",
  targetSeconds: { min: 90, max: 110 },
  intro: {
    kicker: "How ProcuLink works",
    headline: "From buyer PO to supplier-ready order",
  },
  outro: {
    headline: "Send every purchase order in the format each supplier needs.",
    cta: "proculink.eu",
  },
  beats: [
    {
      id: "open",
      kind: "ui",
      source: "capture",
      route: "/upload",
      vo: "ProcuLink turns buyer purchase orders into supplier-ready orders.",
      shot: "Current upload screen.",
    },
  ],
};

function writeManifest(manifest: unknown) {
  const path = resolve(here, "out", manifestFilmId, "vo", "manifest.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest), "utf8");
}

function writeRawManifest(manifest: string) {
  const path = resolve(here, "out", manifestFilmId, "vo", "manifest.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, manifest, "utf8");
}

afterEach(() => {
  rmSync(resolve(here, "out", manifestFilmId), { force: true, recursive: true });
});

describe("validateFilmSpec", () => {
  it("accepts a valid specification", () => {
    expect(validateFilmSpec(valid)).toEqual(valid);
  });

  it("rejects subtitle or caption output", () => {
    expect(() =>
      validateFilmSpec({ ...valid, captions: true }),
    ).toThrow(/captions and subtitles are forbidden/i);
  });

  it("rejects subtitle and SRT fields", () => {
    expect(() => validateFilmSpec({ ...valid, subtitles: true })).toThrow();
    expect(() => validateFilmSpec({ ...valid, srt: "captions.srt" })).toThrow();
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], unexpected: true }],
      }),
    ).toThrow();
  });

  it("requires every UI beat to use capture footage", () => {
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], source: undefined }],
      }),
    ).toThrow(/ui beats must use source "capture"/i);

    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], source: "generated" }],
      }),
    ).toThrow(/ui beats must use source "capture"/i);

    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], source: "card" }],
      }),
    ).toThrow(/ui beats must use source "capture"/i);
  });

  it("allows generated footage only for abstract beats", () => {
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], kind: "brand", source: "generated" }],
      }),
    ).toThrow(/generated footage is allowed only for abstract beats/i);

    expect(validateFilmSpec({
      ...valid,
      beats: [{ ...valid.beats[0], kind: "abstract", source: "generated" }],
    })).toEqual({
      ...valid,
      beats: [{ ...valid.beats[0], kind: "abstract", source: "generated" }],
    });
  });

  it("rejects duplicate beat ids", () => {
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [valid.beats[0], valid.beats[0]],
      }),
    ).toThrow(/duplicate beat id/i);
  });

  it("rejects an invalid duration range", () => {
    expect(() =>
      validateFilmSpec({ ...valid, targetSeconds: { min: 110, max: 90 } }),
    ).toThrow(/minimum must be less than maximum/i);
  });
});

describe("FilmClock", () => {
  it("rejects an unknown marker", () => {
    expect(() => new FilmClock().since("not-marked")).toThrow(
      /unknown film marker/i,
    );
  });
});

describe("narrationBudgets", () => {
  const spec = validateFilmSpec({ ...valid, id: manifestFilmId });

  it("rejects a manifest missing a film beat", () => {
    writeManifest([]);
    expect(() => narrationBudgets(spec)).toThrow(/missing manifest beat id/i);
  });

  it("rejects duplicate manifest beat ids", () => {
    writeManifest([
      { id: "open", durationSec: 1 },
      { id: "open", durationSec: 2 },
    ]);
    expect(() => narrationBudgets(spec)).toThrow(/duplicate manifest beat id/i);
  });

  it("rejects missing and invalid manifest durations", () => {
    writeManifest([{ id: "open" }]);
    expect(() => narrationBudgets(spec)).toThrow(/invalid narration duration/i);

    writeManifest([{ id: "open", durationSec: 0 }]);
    expect(() => narrationBudgets(spec)).toThrow(/invalid narration duration/i);

    writeRawManifest('[{"id":"open","durationSec":1e999}]');
    expect(() => narrationBudgets(spec)).toThrow(/invalid narration duration/i);
  });
});
