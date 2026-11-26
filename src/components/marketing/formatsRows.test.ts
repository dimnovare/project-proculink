import { describe, expect, it } from "vitest";
import { FORMATS } from "@/components/flows/OutputEditor";
import { CHANNELS } from "@/lib/channels";
import { FILE_KINDS } from "@/lib/fileKinds";
import { WAY_IN_WORDS } from "@/lib/flowSentences";
import { STANDARD_NAME_TOKENS } from "@/lib/marketing/format-catalog";
import { NEVER_CLAIM } from "@/lib/neverClaim";
import { STANDARD_OUTPUTS, standardName } from "@/lib/standardOutputs";
import { EARLY_ACCESS_KEYS, HELD_BACK, OUTPUT_ROWS, READ_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS, outOfStep } from "./formatsRows";

const OUTPUT_KEYS = [...Object.keys(FORMATS), ...STANDARD_OUTPUTS];

const REGISTRIES = [
  ["the file kinds the upload accepts", [...FILE_KINDS.base, ...FILE_KINDS.photos, ...FILE_KINDS.more], READ_ROWS],
  ["the output formats", OUTPUT_KEYS, OUTPUT_ROWS],
  ["the ways in", ["upload", ...Object.keys(WAY_IN_WORDS)], WAYS_IN_ROWS],
  ["the ways out", [...CHANNELS.keys()], WAYS_OUT_ROWS],
] as const;

describe("the Formats rows", () => {
  it("every kind each registry holds is a row, held back or in early access, exactly once", () => {
    for (const [name, registry, rows] of REGISTRIES) {
      expect(registry.length, `${name}: empty registry, so this proves nothing`).toBeGreaterThan(0);
      const held = Object.keys(HELD_BACK).filter((k) => registry.includes(k as never));
      const early = [...EARLY_ACCESS_KEYS].filter((k) => registry.includes(k as never));
      const listed = rows.flatMap((r) => r.keys);
      expect(outOfStep(registry, rows), name).toEqual({ unlisted: [], unknown: [] });
      expect(new Set([...listed, ...held, ...early]).size, `${name}: a key is in two of listed, held and early access`).toBe(listed.length + held.length + early.length);
    }
    // Every early-access key is a real way out, so the block names nothing the app lacks.
    expect([...EARLY_ACCESS_KEYS].filter((k) => !CHANNELS.has(k))).toEqual([]);
    // Control: one extra registry key is caught, and so is a row naming a key no registry holds.
    expect(outOfStep([...OUTPUT_KEYS, "heic"], OUTPUT_ROWS).unlisted).toEqual(["heic"]);
    expect(outOfStep(OUTPUT_KEYS.filter((k) => k !== "fixed"), OUTPUT_ROWS).unknown).toEqual(["fixed"]);
  });

  it("names only the listed standards, and every held-back standard output is banned site-wide", () => {
    // Held-back standard OUTPUTS only: the read-side cxml/edi/x12 kinds share words with the listed order outputs.
    const held = STANDARD_OUTPUTS.filter((id) => HELD_BACK[id]);
    expect(held.length, "the e-invoice outputs stay held back").toBeGreaterThan(0);
    for (const id of held) expect(NEVER_CLAIM.some((c) => c.pattern.test(standardName(id))), `${standardName(id)} is held back but not in NEVER_CLAIM`).toBe(true);
    const listed = OUTPUT_ROWS.flatMap((r) => r.keys);
    const text = [READ_ROWS, OUTPUT_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS].flat().map((r) => `${r.name} ${r.note}`).join("\n").toLowerCase();
    for (const { token, catalogId } of STANDARD_NAME_TOKENS) if (!listed.includes(catalogId)) expect(text, String(token)).not.toMatch(token);
    expect(text).not.toMatch(/certified|compliant|validated by/);
  });
});
