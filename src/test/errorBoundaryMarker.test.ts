import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Every error surface carries `data-plk-error-boundary`.
 *
 * WHY THIS GUARD EXISTS. The attribute looks decorative, so it is exactly the
 * kind of thing a future cleanup deletes. It is not decorative: it is the only
 * signal the accessibility and visual gates have that a screen is showing an
 * error instead of its content.
 *
 * That matters because of one measured fact. `src/app/(app)/error.tsx` renders
 * INSIDE `(app)/layout.tsx` — its own header comment says so — which means a
 * screen whose page component throws still answers HTTP 200 and still paints the
 * sidebar, the topbar and the breadcrumb. An adversarial run put
 * `throw new Error(...)` in `src/app/(app)/upload/page.tsx` and the axe gate
 * PASSED: 200 status, >200 characters of text, a dozen interactive controls —
 * every floor satisfied by chrome belonging to a page that never rendered.
 *
 * Delete the attribute and that hole silently reopens. This test is the tripwire.
 * It is a source scan rather than a render test on purpose: it has to hold for
 * `global-error.tsx`, which cannot be rendered in jsdom (it emits its own <html>
 * and <body>).
 */

const ROOT = process.cwd();

interface Surface {
  file: string;
  marker: string;
  why: string;
}

const SURFACES: Surface[] = [
  {
    file: "src/app/(app)/error.tsx",
    marker: "app-route",
    why: "the (app) route boundary — renders inside the layout, so the shell stays and the status stays 200",
  },
  {
    file: "src/app/global-error.tsx",
    marker: "global",
    why: "the root boundary — replaces the document, so nothing else can be asked about the page",
  },
  {
    file: "src/components/bridge/ErrorBoundary.tsx",
    marker: "component",
    why: "the nested component boundary — replaces one region while the rest of the screen renders normally",
  },
];

describe("error surfaces are machine-detectable", () => {
  it.each(SURFACES)("$file carries data-plk-error-boundary=\"$marker\"", ({ file, marker, why }) => {
    const path = join(ROOT, file);
    expect(existsSync(path), `${file} does not exist — was it moved? ${why}`).toBe(true);

    const source = readFileSync(path, "utf8");
    expect(
      source.includes(`data-plk-error-boundary="${marker}"`),
      `${file} lost its data-plk-error-boundary="${marker}" attribute (${why}).\n\n` +
        "Without it, tests/e2e/a11yHarness.ts cannot tell an error screen from a rendered one, and " +
        "a screen whose component throws passes the accessibility and visual gates on the strength " +
        "of the app shell alone. If this surface genuinely no longer needs a marker, remove its " +
        "entry from SURFACES here AND from the check in a11yHarness.ts, in the same commit.",
    ).toBe(true);
  });

  it("covers every error surface in the tree", () => {
    // Anti-vacuity: a new error boundary added without a marker must not be able
    // to slip past by simply not being in the list above.
    const candidates = [
      "src/app/(app)/error.tsx",
      "src/app/global-error.tsx",
      "src/app/error.tsx",
      "src/app/(marketing)/error.tsx",
      "src/components/bridge/ErrorBoundary.tsx",
    ].filter((f) => existsSync(join(ROOT, f)));

    const unlisted = candidates.filter((f) => !SURFACES.some((s) => s.file === f));
    expect(
      unlisted,
      "these error surfaces exist but are not in SURFACES — add them, with a marker",
    ).toEqual([]);
    expect(candidates.length, "no error surfaces found at all — the paths are wrong").toBeGreaterThan(0);
  });
});
