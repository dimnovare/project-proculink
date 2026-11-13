import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { stripComments, syntaxFor } from "@/test/sourceScan";
import {
  AUTOMATIC_DELIVERY_LABEL,
  REVIEW_BEFORE_DELIVERY_LABEL,
  RETIRED_DELIVERY_MODE_NAMES,
  deliveryModeLabel,
} from "./deliveryMode";

// One switch, one name.
//
// The per-supplier `autoDeliver` switch shipped under four names at once — "Auto-process" on the
// suppliers list, "Auto-deliver" on the Delivery tab, "Send automatically" on the supplier
// Overview, "auto-send" on the Changes summaries — and the help centre repeated two of them. This
// walks the shipped copy (components, app routes, help MDX, and the help/section registries) with
// comments stripped, and fails on any of the four.
//
// It is vocabulary-bound and says so: it bans the four names that shipped, not every synonym a
// writer could reach for. `auto-processed` (the dashboard's throughput metric, a different thing)
// is deliberately not matched — the patterns end on a word boundary.

const REPO_ROOT = join(__dirname, "..", "..");
const SRC = join(REPO_ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".next", "test", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (/\.(tsx?|mdx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const CORPUS = [
  ...walk(join(SRC, "components")),
  ...walk(join(SRC, "app")),
  join(SRC, "lib", "section-guides.ts"),
  join(SRC, "lib", "help-articles.ts"),
  join(SRC, "lib", "guides.ts"),
].map((file) => ({ file, text: stripComments(readFileSync(file, "utf8"), syntaxFor(file)) }));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RETIRED = new RegExp(`\\b(?:${RETIRED_DELIVERY_MODE_NAMES.map(escape).join("|")})\\b`, "i");

function offendersIn(corpus: Array<{ file: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { file, text } of corpus) {
    text.split("\n").forEach((line, i) => {
      if (RETIRED.test(line)) out.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("the automatic-sending switch has one name", () => {
  it("reads a real corpus, help pages included", () => {
    expect(CORPUS.length, "the walk found almost nothing — the root moved").toBeGreaterThan(200);
    expect(CORPUS.some(({ file }) => file.endsWith(".mdx")), "no help MDX in the corpus").toBe(true);
  });

  it("no shipped copy uses a retired name for it", () => {
    expect(
      offendersIn(CORPUS),
      `say "${AUTOMATIC_DELIVERY_LABEL}" (on) or "${REVIEW_BEFORE_DELIVERY_LABEL}" (off) instead`,
    ).toEqual([]);
  });

  it("flags each retired name as it shipped, and leaves the other metric alone", () => {
    // Fed the original defects verbatim, so a green run above means absence, not blindness.
    const shipped = [
      `{ label: "Auto-process", align: "left"  },`,
      `          Auto-deliver`,
      `    ["Send automatically", data.autoDeliver ? "On" : "Off", false],`,
      '? `${deliveryLabel}${props.deliveryAutoDeliver ? " · auto-send" : ""}`',
      "and whether **auto-process** is on.",
    ];
    for (const line of shipped) {
      expect(offendersIn([{ file: join(SRC, "x.tsx"), text: line }]), line).toHaveLength(1);
    }
    // The dashboard's auto-processed rate is a different measurement, not this switch.
    expect(offendersIn([{ file: join(SRC, "x.tsx"), text: "auto-processed · 3 of 4 completed" }])).toEqual([]);
    // A comment naming the old label is history, not copy.
    expect(offendersIn([{ file: join(SRC, "x.tsx"), text: stripComments("// was \"Auto-process\"") }])).toEqual([]);
  });

  it("maps the saved flag to exactly one of the two names", () => {
    expect(deliveryModeLabel(true)).toBe(AUTOMATIC_DELIVERY_LABEL);
    expect(deliveryModeLabel(false)).toBe(REVIEW_BEFORE_DELIVERY_LABEL);
  });
});
