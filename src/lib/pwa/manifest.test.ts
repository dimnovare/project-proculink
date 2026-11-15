import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cssToken } from "@/lib/cssTokens";
import { SITE_DESCRIPTION } from "@/lib/seo";
import { isProtectedPath } from "@/middleware";

it("the manifest opens a protected Documents page in its own window, in the token colours, with icons the app draws", () => {
  const m = JSON.parse(readFileSync("public/site.webmanifest", "utf8"));
  const navy = cssToken(readFileSync("src/app/globals.css", "utf8"), "navy");
  expect(m).toMatchObject({ id: "/", start_url: "/documents", scope: "/", display: "standalone", name: "ProcuLink",
    short_name: "ProcuLink", lang: "en", description: SITE_DESCRIPTION, background_color: navy, theme_color: navy });
  expect(isProtectedPath(m.start_url)).toBe(true);
  expect(existsSync("src/app/(app)/documents/page.tsx")).toBe(true);
  expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const { src } of m.icons) {
    expect(existsSync(join("src/app", src.slice(1), "route.tsx"))).toBe(true);
    expect(existsSync(join("public", src.slice(1)))).toBe(false);
  }
});
