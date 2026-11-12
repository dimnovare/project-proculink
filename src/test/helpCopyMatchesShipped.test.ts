import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COPY, canRetryRead, readFailureMessage } from "@/lib/documentRefusals";

/**
 * The troubleshooting article is a promise about what the screens say and which buttons they carry, so it
 * fails the way a button does: silently, and only for the person acting on it.
 *
 * Both directions are read from the product, never typed here:
 *   - every sentence the article quotes and every label it bolds must appear in the shipped copy;
 *   - every read failure the product treats as final (no **Try again**) must be quoted by the article.
 *
 * The shipped copy is the source text of the screens a reader sees (the flow and document components, the
 * refusal table, the status manifest and the app navigation), so renaming a button breaks the article's test
 * instead of quietly making the article wrong.
 */

const ROOT = process.cwd();
const ARTICLE = join(ROOT, "src", "app", "(marketing)", "help", "troubleshooting", "page.mdx");
const FLOWS = join(ROOT, "src", "components", "flows");

const SHIPPED = [
  ...readdirSync(FLOWS).filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f)).map((f) => join(FLOWS, f)),
  join(ROOT, "src", "lib", "documentRefusals.ts"),
  join(ROOT, "src", "lib", "documentStatusManifest.ts"),
  join(ROOT, "src", "components", "bridge", "BridgeSidebar.tsx"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const body = readFileSync(ARTICLE, "utf8").split("# Troubleshooting")[1] ?? "";
const quoted = [...body.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
const bold = [...body.matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => m[1]);

describe("the troubleshooting article quotes and names what the product shows", () => {
  it("every quoted sentence and every bold label is in the shipped copy", () => {
    // Anti-vacuity: the article quotes a dozen messages and bolds a dozen labels; an empty walk proves nothing.
    expect(quoted.length, "no quoted messages found").toBeGreaterThanOrEqual(10);
    expect(bold.length, "no bold labels found").toBeGreaterThanOrEqual(10);
    // Sentences match as substrings of the shipped copy. A bold label must be a whole string or whole JSX text
    // there (`>Label<`, "Label", 'Label', `Label` or a line of its own), so a short label such as Send cannot
    // survive a rename by matching a longer sentence.
    const whole = (label: string) => {
      const l = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`[>"'\`]\\s*${l}\\s*[<"'\`]|^\\s*${l}\\s*$`, "m").test(SHIPPED);
    };
    const missing = [...quoted.filter((q) => !SHIPPED.includes(q)), ...bold.filter((b) => !whole(b))];
    expect(missing, "in the article but not in the shipped copy").toEqual([]);
  });

  it("every read failure the product treats as final is quoted, and so is the fallback", () => {
    const final = Object.keys(COPY).filter((reason) => !canRetryRead(reason));
    expect(final.length, "the product has final read failures").toBeGreaterThanOrEqual(3);
    for (const reason of [...final, null]) {
      expect(quoted, `the article never quotes the message for ${reason}`).toContain(readFailureMessage(reason));
    }
  });
});
