// Copy guards for a plain-language UX fix (2026-06).
//
// operations/connectors — the coming-soon mock connector cards no longer double-message
// ("— not yet available" suffix AND a "Coming soon" badge); the badge alone carries it.
//
// (A sibling guard covered the library/templates help box, which used "Canonical {tokens} …
// supplier-scoped" jargon. That page was retired in 2026-07, so the guard went with it.)
//
// These are source-text assertions (not RTL renders) so they stay cheap and don't need Clerk /
// query providers. If someone reintroduces the retired phrasing, these fail loudly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("plain-language copy guards", () => {
  it("coming-soon connector cards drop the redundant “— not yet available” suffix", () => {
    const src = read("src/app/(app)/operations/connectors/page.tsx");
    expect(src).not.toContain("not yet available");
  });
});
