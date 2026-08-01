/**
 * check-emitted-css.mjs — reads what the CSS COMPILER emits, not what the source says.
 *
 * WHY THIS EXISTS. Every other token guard in this repo reads SOURCE TEXT. That is
 * a different scanner from the one that builds the stylesheet, and the two
 * disagreeing is not hypothetical — it shipped:
 *
 *   scripts/check-tokens.mjs   skips `*.test.ts(x)`  (a test that pins a ban must
 *   src/test/token-contrast.ts skips `*.test.ts(x)`   be able to NAME the value)
 *   tailwind.config.ts         skipped nothing
 *
 *   → src/test/check-tokens.test.ts wrote the fixture string
 *     `focus-visible:ring-[#28C55E]`, Tailwind's content scanner (a REGEX OVER FILE
 *     TEXT — it does not parse, and cannot tell a fixture from a class) read it as a
 *     class candidate, and `bun run build` shipped
 *     `.focus-visible\:ring-\[\#28C55E\]{--tw-ring-color:rgb(40 197 94/…)}`
 *     into production CSS.
 *
 * The retired emerald was put back into the build BY THE TEST WRITTEN TO PROVE IT
 * WAS GONE — and re-running that test could never have revealed it, because the
 * test is not the scanner that emits. This gate closes the loop by asking the real
 * compiler, with the real config, what actually comes out.
 *
 * IT MATCHES DECIMAL AS WELL AS HEX, and that is load-bearing here specifically:
 * Tailwind compiles `ring-[#28C55E]` to `rgb(40 197 94 / …)`. A hex-only grep finds
 * only the escaped SELECTOR — rename the class and the banned declaration would
 * still ship, unseen. See scripts/retired-colors.mjs.
 *
 * WHAT THIS GATE DOES NOT DO — read this before quoting a green run.
 *   1. IT IS NOT A CONTRAST CHECK, and it is not a token lint. It answers exactly
 *      one question: "does a RETIRED value appear in compiled CSS?" A perfectly
 *      legal-looking token pair that fails WCAG is green here, permanently. See
 *      src/test/token-contrast.test.ts.
 *   2. IT ONLY SEES TAILWIND'S OUTPUT plus, with --built, whatever `.next` holds.
 *      CSS that reaches the page some other way — a styled-jsx block, a runtime
 *      `style.setProperty`, a third-party stylesheet, an inline `style={{}}` (which
 *      never enters a stylesheet at all) — is invisible to it. Inline styles are
 *      the majority of this codebase's colour, and NONE of it is checked here.
 *   3. IT PROVES EMISSION, NOT REACHABILITY. A rule in the bundle may be dead. This
 *      gate treats a banned value in the stylesheet as a defect regardless, because
 *      "it is emitted but nothing uses it" is not a property source text can show.
 *   4. --built IS BEST-EFFORT. Without a prior `bun run build` there is no `.next`
 *      to read, and the flag reports that it found nothing to scan rather than
 *      pretending to have checked. The COMPILE pass always runs, so this script is
 *      never vacuous — a green run always means the compiler was asked.
 *
 * Usage:
 *   bun run lint:emitted-css                     # compile + check, exits 1 on a hit
 *   node scripts/check-emitted-css.mjs --built   # also scan .next/static/css/**
 *   node scripts/check-emitted-css.mjs --config <path> --input <path>   # fixtures
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { retiredRegex, RETIRED_DESCRIPTION } from "./retired-colors.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(__dirname, "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const CONFIG = flag("--config", join(REPO, "tailwind.config.ts"));
// globals.css rather than a bare `@tailwind utilities` stub: it carries the
// `:root` custom-property block as well as the three directives, so the compiled
// sheet is as close to what ships as a single compile can be.
const INPUT = flag("--input", join(REPO, "src", "app", "globals.css"));
const ALSO_BUILT = argv.includes("--built");

const TAILWIND_CLI = join(REPO, "node_modules", "tailwindcss", "lib", "cli.js");

/** Compile with the REAL config and return the emitted stylesheet. */
function compile() {
  const out = join(mkdtempSync(join(tmpdir(), "plk-emitted-")), "out.css");
  try {
    execFileSync(
      process.execPath,
      [TAILWIND_CLI, "-c", CONFIG, "-i", INPUT, "-o", out],
      { cwd: REPO, encoding: "utf8", stdio: "pipe" },
    );
    return readFileSync(out, "utf8");
  } finally {
    rmSync(join(out, ".."), { recursive: true, force: true });
  }
}

/** Every .css file under a directory tree. */
function cssFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (entry.endsWith(".css")) out.push(full);
    }
  }
  return out;
}

/** `{ line, text }` for every retired value in a stylesheet. */
function scan(css) {
  const re = retiredRegex();
  const out = [];
  css.split(/\r?\n/).forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      // Compiled CSS is frequently one enormous line. Report a window around the
      // hit rather than 40 000 characters of context.
      const from = Math.max(0, m.index - 60);
      out.push({
        line: i + 1,
        value: m[0],
        context: line.slice(from, m.index + m[0].length + 60).trim(),
      });
    }
  });
  return out;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
// The label names the config actually used — "real config" on a fixture run was
// a small lie that made a failing test report harder to read than it needed to be.
const CONFIG_LABEL =
  CONFIG === join(REPO, "tailwind.config.ts")
    ? "tailwind compile (real config)"
    : `tailwind compile (${relative(REPO, CONFIG).replace(/\\/g, "/")})`;

const sources = [{ label: CONFIG_LABEL, css: compile() }];

if (ALSO_BUILT) {
  const built = cssFiles(join(REPO, ".next", "static", "css"));
  if (built.length === 0) {
    console.log(
      "  --built: no .next/static/css to scan (run `bun run build` first). The\n" +
        "  compile pass above still ran, so this is a narrower check, not a skipped one.",
    );
  }
  for (const f of built) {
    sources.push({
      label: relative(REPO, f).replace(/\\/g, "/"),
      css: readFileSync(f, "utf8"),
    });
  }
}

console.log(`\nEmitted-CSS gate — ${sources.length} stylesheet(s), banned: ${RETIRED_DESCRIPTION}\n`);

let failures = 0;
for (const { label, css } of sources) {
  const hits = scan(css);
  if (hits.length === 0) {
    console.log(`  OK    ${label}  (${css.length} bytes)`);
    continue;
  }
  failures += hits.length;
  console.error(`  FAIL  ${label} — ${hits.length} retired value(s):`);
  for (const h of hits.slice(0, 10)) {
    console.error(`          line ${h.line}  "${h.value}"  …${h.context}…`);
  }
  if (hits.length > 10) console.error(`          … and ${hits.length - 10} more`);
}

console.log(
  `\nLimits: this reads COMPILED CSS only. Inline style={{}} never enters a\n` +
    `stylesheet and is not checked here; nor is contrast (see\n` +
    `src/test/token-contrast.test.ts). Emission is not reachability.\n`,
);

if (failures > 0) {
  console.error(
    `A retired colour reached compiled CSS. If the source of it is a TEST FIXTURE,\n` +
      `the fix is not to delete the test — it is that tailwind.config.ts and the\n` +
      `token guards must agree on which files they scan. See the header.\n`,
  );
  process.exit(1);
}

process.exit(0);
