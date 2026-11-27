import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./sourceScan";
import { sendLabel } from "@/components/flows/SelectionBar";

/**
 * Filled buttons are navy; green (`send`) is only for a press that sends a document out. The blue
 * fill was retired on 2026-11-27 after "Choose files" (blue), "Review next" (green) and "Upgrade" (navy)
 * read as three rules. Scans code with comments stripped, never this file.
 */
const files = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f, code: stripComments(readFileSync(join("src", f), "utf8"), "js") }));
const SENDS = /\b(Send|Issue)\b/;
/** A label held in a variable, and where its words come from. */
const DYNAMIC: Record<string, string[]> = { "{label}": [1, 2, 5].flatMap((n) => [sendLabel(n, n), sendLabel(n, 1)]).filter((s): s is string => !!s) };

describe("button colours", () => {
  it("no blue fill comes back", () => {
    const blue = files.filter(({ code }) => /variant=(?:["']blue["']|\{[^}]*["']blue["'])|buttonClass\([^)]*["']blue["']/.test(code)).map(({ f }) => f);
    expect(blue).toEqual([]);
  });

  it("every green button's label sends", () => {
    const found: string[] = [];
    for (const { f, code } of files)
      for (const m of code.matchAll(/variant=(?:"send"|\{[^}]*"send")|buttonClass\([^)]*"send"/g)) {
        const end = code.indexOf(m[0].startsWith("variant") ? "</Button>" : "</Link>", m.index);
        const segment = code.slice(m.index, end);
        const label = segment.slice(segment.lastIndexOf(">") + 1).trim();
        // `{name}` held in a `const name = "…"` of the same file is checked through that string.
        const held = /^\{(\w+)\}$/.exec(label);
        const local = held && new RegExp(`const ${held[1]} = (["'\`])(.*?)\\1`).exec(code)?.[2];
        found.push(f);
        if (DYNAMIC[label]) for (const words of DYNAMIC[label]) expect(words, `${f}: ${label}`).toMatch(SENDS);
        else expect(local ?? label, f).toMatch(SENDS);
      }
    expect(found.length).toBeGreaterThanOrEqual(2); // the scan still finds the send buttons
  });
});
