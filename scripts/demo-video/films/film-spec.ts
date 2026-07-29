import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));

const beatSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["ui", "brand", "abstract"]),
  source: z.enum(["capture", "generated", "card"]).optional(),
  route: z.string().startsWith("/").optional(),
  vo: z.string().min(1),
  shot: z.string().min(1),
  actionLeadMs: z.number().int().nonnegative().optional(),
  extraMs: z.number().int().nonnegative().optional(),
  overIntro: z.boolean().optional(),
  overOutro: z.boolean().optional(),
}).strict();

const filmSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  targetSeconds: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
  }).strict(),
  captions: z.boolean().optional(),
  intro: z.object({
    kicker: z.string().min(1),
    headline: z.string().min(1),
  }).strict(),
  outro: z.object({
    headline: z.string().min(1),
    cta: z.string().min(1),
  }).strict(),
  beats: z.array(beatSchema).min(1),
}).strict();

export type FilmBeat = z.infer<typeof beatSchema>;
export type FilmSpec = z.infer<typeof filmSchema>;

export function validateFilmSpec(input: unknown): FilmSpec {
  const spec = filmSchema.parse(input);
  if (spec.captions === true) {
    throw new Error("Captions and subtitles are forbidden for these films.");
  }
  if (spec.targetSeconds.min >= spec.targetSeconds.max) {
    throw new Error("Film duration minimum must be less than maximum.");
  }
  const ids = spec.beats.map((beat) => beat.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate beat id in film specification.");
  }
  for (const beat of spec.beats) {
    if (beat.kind === "ui" && beat.source !== "capture") {
      throw new Error('UI beats must use source "capture".');
    }
    if (beat.source === "generated" && beat.kind !== "abstract") {
      throw new Error("Generated footage is allowed only for abstract beats.");
    }
  }
  return spec;
}

export function loadFilmSpec(id: string): FilmSpec {
  return validateFilmSpec(
    JSON.parse(readFileSync(resolve(here, `${id}.json`), "utf8")),
  );
}
