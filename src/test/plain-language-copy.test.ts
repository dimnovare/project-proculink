// Copy guards for two plain-language UX fixes (2026-06).
//
// 1. library/templates — the template-body help box no longer uses the "Canonical {tokens} … keep
//    placeholders explicit and supplier-scoped" jargon; it now reads in plain English.
// 2. operations/connectors — the coming-soon mock connector cards no longer double-message
//    ("— not yet available" suffix AND a "Coming soon" badge); the badge alone carries it.
//
// These are source-text assertions (not RTL renders) so they stay cheap and don't need Clerk /
// query providers. If someone reintroduces the retired phrasing, these fail loudly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("plain-language copy guards", () => {
  it("templates help box drops the canonical-token / supplier-scoped jargon", () => {
    const src = read("src/app/(app)/library/templates/page.tsx");
    expect(src).not.toContain("Canonical {tokens}");
    expect(src).not.toContain("supplier-scoped");
    expect(src).toContain("filled in from the order when you send it");
  });

  it("coming-soon connector cards drop the redundant “— not yet available” suffix", () => {
    const src = read("src/app/(app)/operations/connectors/page.tsx");
    expect(src).not.toContain("not yet available");
  });
});
