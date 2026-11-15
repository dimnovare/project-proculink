import { describe, expect, it } from "vitest";
import { FORMATS } from "@/components/flows/OutputEditor";
import { CHANNELS } from "@/lib/channels";
import { FILE_KINDS } from "@/lib/fileKinds";
import { WAY_IN_WORDS } from "@/lib/flowSentences";
import { STANDARD_NAME_TOKENS } from "@/lib/marketing/format-catalog";
import { NEVER_CLAIM } from "@/lib/neverClaim";
import { STANDARD_OUTPUTS, standardName } from "@/lib/standardOutputs";
import { HELD_BACK, OUTPUT_ROWS, READ_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS, outOfStep } from "./formatsRows";

const REGISTRIES = [
  ["the file kinds the upload accepts", [...FILE_KINDS.base, ...FILE_KINDS.photos, ...FILE_KINDS.more], READ_ROWS],
  ["the output formats", Object.keys(FORMATS), OUTPUT_ROWS],
  ["the ways in", ["upload", ...Object.keys(WAY_IN_WORDS)], WAYS_IN_ROWS],
  ["the ways out", [...CHANNELS.keys()], WAYS_OUT_ROWS],
  ["the standard outputs", [...STANDARD_OUTPUTS], []],
] as const;

describe("the Formats rows", () => {
  it("every kind each registry holds is a row or is held back, and nothing else", () => {
    for (const [name, registry, rows] of REGISTRIES) {
      expect(registry.length, `${name}: empty registry, so this proves nothing`).toBeGreaterThan(0);
      const held = Object.keys(HELD_BACK).filter((k) => registry.includes(k as never));
      const listed = rows.flatMap((r) => r.keys);
      expect(outOfStep(registry, rows), name).toEqual({ unlisted: [], unknown: [] });
      expect(new Set([...listed, ...held]).size, `${name}: a key is listed twice or both listed and held`).toBe(listed.length + held.length);
    }
    // Control: one extra registry key is caught, and so is a row naming a key no registry holds.
    expect(outOfStep([...Object.keys(FORMATS), "heic"], OUTPUT_ROWS).unlisted).toEqual(["heic"]);
    expect(outOfStep(Object.keys(FORMATS).filter((k) => k !== "fixed"), OUTPUT_ROWS).unknown).toEqual(["fixed"]);
  });

  it("names no standard, and every held-back standard is banned site-wide", () => {
    for (const id of STANDARD_OUTPUTS) {
      expect(HELD_BACK[id], id).toBeTruthy();
      expect(NEVER_CLAIM.some((c) => c.pattern.test(standardName(id))), `${standardName(id)} is held back but not in NEVER_CLAIM`).toBe(true);
    }
    const text = [READ_ROWS, OUTPUT_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS].flat().map((r) => `${r.name} ${r.note}`).join("\n").toLowerCase();
    for (const { token } of STANDARD_NAME_TOKENS) expect(text, String(token)).not.toMatch(token);
    expect(text).not.toMatch(/certified|compliant|validated by/);
  });
});
