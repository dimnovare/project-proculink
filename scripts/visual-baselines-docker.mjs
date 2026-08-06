#!/usr/bin/env node
/**
 * Run the visual-regression suite inside a Linux container (WP-41).
 *
 *   bun run visual:linux          compare against the committed baselines
 *   bun run visual:linux:update   regenerate the committed baselines
 *
 * WHY. `tests/e2e/visual.spec.ts` refuses to run outside Linux, because the
 * baselines it compares are generated for ubuntu-latest — the runner that judges
 * PRs — and Windows/macOS text rasterisation does not match it. Without this
 * script that refusal would mean the founder simply cannot touch the baselines.
 * With it, `bun run visual:linux:update` produces byte-identical output to CI
 * from a Windows box.
 *
 * WHAT IT PROTECTS. The repo is bind-mounted so regenerated PNGs land straight
 * in the working tree, but three directories are shadowed by named volumes so the
 * container never writes Linux artefacts into a Windows checkout:
 *
 *   /work/node_modules   Linux-native binaries (@next/swc, lightningcss…) would
 *                        otherwise replace the host's and break `bun run dev`.
 *   /work/.next          a Linux dev-server cache is not a Windows one.
 *   /work/.cache         Next/SWC scratch.
 *
 * This is the same trap as a worktree's empty node_modules, one level out: the
 * install has to happen where the binaries will be executed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DOCKERFILE = join(HERE, "visual-baselines.Dockerfile");

const IMAGE = "proculink-visual-baselines:v1.60.0";
const VOL_MODULES = "proculink-visual-node-modules";
const VOL_NEXT = "proculink-visual-next";
const VOL_CACHE = "proculink-visual-cache";

const args = process.argv.slice(2);
const update = args.includes("--update");
const passthrough = args.filter((a) => a !== "--update");

function run(cmd, cmdArgs, opts = {}) {
  const printable = [cmd, ...cmdArgs].join(" ");
  console.log(`\n$ ${printable}\n`);
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: false, ...opts });
  if (result.error) {
    console.error(`\nFailed to run \`${cmd}\`: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

// ── Preflight ────────────────────────────────────────────────────────────────
const probe = spawnSync("docker", ["info", "--format", "{{.OSType}}"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.error(
    "\nDocker is not available.\n\n" +
      "The visual baselines are Linux-only (see tests/e2e/visual.spec.ts for why), and this\n" +
      "script is how a non-Linux machine runs them. Options:\n" +
      "  • start Docker Desktop and re-run, or\n" +
      "  • push the branch and read the `Visual regression` job in CI, which runs the same\n" +
      "    suite on ubuntu-latest and uploads the diff images as an artifact.\n",
  );
  process.exit(1);
}
if (probe.stdout.trim() !== "linux") {
  console.error(
    `\nDocker is running ${probe.stdout.trim()} containers, not linux.\n` +
      "Switch Docker Desktop to Linux containers — Windows containers cannot produce the\n" +
      "baselines ubuntu-latest will compare against.\n",
  );
  process.exit(1);
}
if (!existsSync(DOCKERFILE)) {
  console.error(`\nMissing ${DOCKERFILE}`);
  process.exit(1);
}

// ── Build (layer-cached; ~2 minutes cold, instant warm) ──────────────────────
const built = run("docker", ["build", "-f", DOCKERFILE, "-t", IMAGE, HERE]);
if (built !== 0) process.exit(built);

// ── Run ──────────────────────────────────────────────────────────────────────
const script = [
  "set -e",
  // The bind-mounted node_modules volume starts empty; install into it. Not
  // `--frozen-lockfile`: bun.lockb is written on Windows and a platform-specific
  // optional dependency set can legitimately differ on Linux.
  "bun install",
  // `next dev` and Playwright both need to be resolvable from node_modules/.bin.
  update
    ? `bun run test:e2e:visual:update ${passthrough.join(" ")}`.trim()
    : `bun run test:e2e:visual ${passthrough.join(" ")}`.trim(),
].join(" && ");

const status = run("docker", [
  "run",
  "--rm",
  "--init",
  // Chromium crashes on the default 64MB /dev/shm.
  "--shm-size=1gb",
  "-v",
  `${REPO}:/work`,
  "-v",
  `${VOL_MODULES}:/work/node_modules`,
  "-v",
  `${VOL_NEXT}:/work/.next`,
  "-v",
  `${VOL_CACHE}:/work/.cache`,
  "-w",
  "/work",
  // Mirror the CI job's environment so the container renders what CI renders.
  "-e",
  "CI=1",
  "-e",
  "PROCULINK_QA_BYPASS_AUTH=true",
  "-e",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ci_placeholder_not_real",
  "-e",
  "CLERK_SECRET_KEY=sk_test_ci_placeholder_not_real",
  "-e",
  "NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true",
  "-e",
  "NEXT_PUBLIC_USE_MOCK=true",
  "-e",
  "NEXT_PUBLIC_API_BASE_URL=http://localhost:5223",
  "-e",
  "SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1",
  // /work is a bind mount across the VM boundary, so `next dev`'s first compile
  // is several times slower than it is on the CI runner's native disk. CI keeps
  // the 120s default; only this path needs the longer rope.
  "-e",
  "PLAYWRIGHT_WEBSERVER_TIMEOUT_MS=600000",
  // Watch by polling, not inotify.
  //
  // Measured: `next dev`'s initial Watchpack scan of the bind-mounted /work died
  // with `ENOMEM: not enough memory, scandir '/work/src'`. That is not RAM
  // exhaustion — Linux reports ENOMEM when the kernel cannot allocate more
  // inotify watches, and a Windows bind mount presents thousands of directories
  // to watch across the VM boundary. Polling never allocates a watch.
  //
  // Nothing here edits files while the suite runs, so the extra latency is
  // irrelevant and the CPU cost is bounded by the interval.
  "-e",
  "WATCHPACK_POLLING=1000",
  "-e",
  "CHOKIDAR_USEPOLLING=1",
  "-e",
  "NEXT_TELEMETRY_DISABLED=1",
  IMAGE,
  "bash",
  "-lc",
  script,
]);

if (status === 0 && update) {
  console.log(
    "\nBaselines regenerated on Linux. `git status tests/e2e/__screenshots__` to review the\n" +
      "diff before committing — every changed PNG is a visual change somebody should look at.\n",
  );
}
process.exit(status);
