// Memoised filesystem reads for the whole-tree source-scan guards.
//
// Not a test file (no `.test.` in the name) so vitest treats it as a helper.
//
// WHY THIS EXISTS. A dozen guards in src/test answer their question by reading the ENTIRE src/
// corpus — route reachability, the link crawl, the endpoint sweep, the retired-vocabulary ban, the
// emoji ban, the count-population registry, and more. Their corpus coverage is the whole point of
// them and must not be narrowed. But the reading is not free, and it was being repeated:
//
//   • statusVocabulary re-read and re-stripped all ~300 copy-bearing files ONCE PER RETIRED PHRASE
//     — nine identical sweeps in one `test.each`;
//   • counterpartyDeIdentification ran its whole `sweep()` twice, once per assertion;
//   • route-reachability walked and re-read all of src/ twice more AFTER its module-scope sweep
//     had already read every one of those files;
//   • endpoint-reachability, readyBarClaim and sourceScan each re-read files they had just read.
//
// Measured on the dev machine, quiet, over the 739 files under src/: the walk is ~18ms with
// `withFileTypes` (and ~50-90ms with a `statSync` per entry), `readFileSync` of all of them is
// ~700-850ms, and `stripComments` over the result is ~1000ms. So ONE pass is ~1.8s and a warm
// cached pass is ~0ms — the repeats were the entire problem, not the first read.
//
// WHY IT MATTERS, precisely. Those numbers are quiet-machine numbers. A full-suite run with three
// workers puts a single pass at ~4s against vitest's 5000ms default per-test budget, so on a loaded
// machine these guards fail as a group with `Test timed out in 5000ms.` and zero assertion
// failures. CI is uncontended and stays green, which makes it worse rather than better: the only
// place it shows up is a local run, where a red suite has to be re-classified by hand before the
// gate can be trusted, and "my change broke eight files" is the obvious wrong reading.
//
// Raising the timeouts was the alternative and it is a trap this repo has already sprung:
// `sourceScan.test.ts` carries an explicit `20_000` on both of its sweeps, and one of them STILL
// blew that budget (22.7s) on a contended run. A bigger number hides the growth in sweep cost, and
// src/ only gets bigger.
//
// WHAT THIS DOES NOT DO. It does not walk for you, and it does not decide what a corpus is. Each
// guard keeps its own walk, its own skip rules and its own filters, because those encode what that
// guard's question means — the crawl's corpus is not the emoji ban's corpus. All that is shared is
// the I/O underneath, which is identical for everyone.
//
// STALENESS. Every cache here is process-lifetime and never invalidated. That is sound because
// vitest gives each test FILE its own module registry, so a cache lives exactly as long as one
// guard's run, and none of these guards mutates the tree it scans. A test that writes into a
// directory it also scans must not use these helpers — read it directly.

import fs from "node:fs";
import path from "node:path";

import { stripComments, syntaxFor, type SourceSyntax } from "./sourceScan";

/** One directory entry, with symlinks already resolved — see `dirEntries`. */
export type CorpusDirent = { readonly name: string; readonly isDirectory: boolean };

const DIR_ENTRIES = new Map<string, CorpusDirent[]>();
const TEXT = new Map<string, string>();
const STRIPPED = new Map<string, string>();

function isDirectoryFollowingLinks(full: string): boolean {
  try {
    return fs.statSync(full).isDirectory();
  } catch {
    return false; // a broken link is not a directory to descend into
  }
}

/**
 * One `readdirSync`, memoised, classified into files and directories.
 *
 * Replaces the `readdirSync(dir)` + `statSync(full).isDirectory()` pair that five of these guards
 * were written with: `withFileTypes` carries the classification back from the same syscall, which
 * is where the walk's 3-5x comes from.
 *
 * A `Dirent` reports a symlink AS a symlink, where `statSync` reports what it points at, so a
 * symlinked directory would silently stop being descended into. That single case falls back to
 * `statSync` to keep the classification identical to the code this replaces.
 */
export function dirEntries(dir: string): readonly CorpusDirent[] {
  const key = path.normalize(dir);
  const cached = DIR_ENTRIES.get(key);
  if (cached) return cached;

  const entries = fs.readdirSync(key, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isSymbolicLink()
      ? isDirectoryFollowingLinks(path.join(key, entry.name))
      : entry.isDirectory(),
  }));
  DIR_ENTRIES.set(key, entries);
  return entries;
}

/** `fs.readFileSync(file, "utf8")`, memoised. */
export function readSource(file: string): string {
  const key = path.normalize(file);
  const cached = TEXT.get(key);
  if (cached !== undefined) return cached;

  const text = fs.readFileSync(key, "utf8");
  TEXT.set(key, text);
  return text;
}

/**
 * `stripComments(readSource(file))`, memoised — the other half of the cost.
 *
 * The syntax is part of the key, because a caller may deliberately read an `.mdx` file with the JS
 * stripper or vice versa, and the two produce different text.
 */
export function strippedSource(file: string, syntax: SourceSyntax = syntaxFor(file)): string {
  const key = `${path.normalize(file)}\u0000${syntax}`;
  const cached = STRIPPED.get(key);
  if (cached !== undefined) return cached;

  const code = stripComments(readSource(file), syntax);
  STRIPPED.set(key, code);
  return code;
}
