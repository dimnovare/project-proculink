#!/usr/bin/env node
/**
 * Points this checkout's git at .githooks/ so the pre-commit gates run.
 *
 * Wired to package.json `prepare`, which `bun install` runs — so cloning the
 * repo and installing is all a developer has to do. There is no husky and no
 * lint-staged; the hook is a plain sh script and this is the whole installer.
 *
 * THIS SCRIPT MUST NEVER EXIT NON-ZERO. `prepare` failing fails `bun install`,
 * and `bun install` runs in the Vercel production build. A developer convenience
 * is not allowed to be able to break a deploy — so every failure path below is
 * a warning and exit 0.
 *
 * Undo:  git config --unset core.hooksPath
 */
import { execFileSync } from "node:child_process";

const git = (args) => execFileSync("git", args, { stdio: "ignore" });

try {
  // No .git means a tarball, a Docker context, or a build environment that
  // exported the tree without history. Nothing to install, and not an error.
  git(["rev-parse", "--git-dir"]);
} catch {
  process.exit(0);
}

try {
  git(["config", "core.hooksPath", ".githooks"]);
} catch (error) {
  console.warn(
    `[install-hooks] could not set core.hooksPath, pre-commit gates are off: ${error.message}`,
  );
}

process.exit(0);
