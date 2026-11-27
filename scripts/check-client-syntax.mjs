/**
 * check-client-syntax.mjs — fails when built client JS holds syntax Safari 15.4 cannot parse.
 *
 * A class `static {}` block (ES2022, Safari 16.4+) in a shared chunk is a SyntaxError on
 * iOS < 16.4: the whole chunk dies, the public site never hydrates and every app route shows
 * the error page. intl-messageformat shipped one; next.config.ts transpiles it. Regex
 * lookbehind is the same class of defect (Safari 16.4+).
 *
 * Skipped: the lazily loaded pdf.js chunk. A failure there is caught by PdfDocumentView's
 * query and shows its fallback, it does not take the page down.
 *
 * Usage: node scripts/check-client-syntax.mjs [chunksDir]   (default .next/static/chunks)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? ".next/static/chunks";
const BANNED = [
  ["class static block", /\bstatic\s*\{/],
  ["regex lookbehind", /\(\?<[=!]/],
];
const bad = [];
for (const f of readdirSync(dir, { recursive: true })) {
  if (!String(f).endsWith(".js")) continue;
  const src = readFileSync(join(dir, String(f)), "utf8");
  if (src.includes("GlobalWorkerOptions")) continue; // pdf.js, see header
  for (const [name, re] of BANNED) if (re.test(src)) bad.push(`${f}: ${name}`);
}
if (bad.length) {
  console.error(`Client JS that Safari < 16.4 cannot parse (add the package to transpilePackages):\n${bad.join("\n")}`);
  process.exit(1);
}
console.log(`check-client-syntax: ok (${dir})`);
