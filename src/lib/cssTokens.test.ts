import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssToken } from "./cssTokens";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("cssToken", () => {
  it("reads a colour token from the stylesheet, never a longer name that starts the same, and refuses an unknown one", () => {
    for (const name of ["navy", "navy-text", "surface", "brand-blue", "brand-blue-bright", "brand-green", "brand-green-bright"]) {
      expect(cssToken(css, name), name).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
    expect(cssToken(css, "brand-blue")).not.toBe(cssToken(css, "brand-blue-bright"));
    expect(cssToken(css, "navy")).not.toBe(cssToken(css, "navy-text"));
    expect(() => cssToken(css, "no-such-token")).toThrow(/no-such-token/);
  });
});
