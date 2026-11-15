import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTECTED_ROUTE_PATTERNS } from "@/middleware";
import { listAppRoutes, ROOT, servesNothing } from "@/test/appRoutes";

describe("page not found inside the app", () => {
  it("every protected prefix has a catch-all that throws to the in-app page", () => {
    const prefixes = PROTECTED_ROUTE_PATTERNS.map((p) => p.replace("(.*)", "").slice(1));
    expect(prefixes.length).toBeGreaterThanOrEqual(8);
    for (const prefix of prefixes) {
      const file = join(ROOT, "src", "app", "(app)", prefix, "[...missing]", "page.tsx");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(/export default function \w*\(\)\s*\{\s*notFound\(\);?\s*\}/);
    }
    const page = readFileSync(join(ROOT, "src", "app", "(app)", "not-found.tsx"), "utf8");
    expect(page).toMatch(/AppNotFound/);
    // They serve no URL of their own, so no guard may count one as a page.
    expect(listAppRoutes().filter((r) => r.includes("[...missing]"))).toEqual([]);
  });

  it("a real page that only quotes the catch-all in a comment still counts as a page", () => {
    const file = join(mkdtempSync(join(tmpdir(), "plk-")), "page.tsx");
    writeFileSync(file, "// Unlike export default function Missing() { notFound(); }\nexport default function Page() { return null; }\n");
    expect(servesNothing(file)).toBe(false);
    writeFileSync(file, "/* not found */\nexport default function Missing() {\n  notFound();\n}\n");
    expect(servesNothing(file)).toBe(true);
  });
});
