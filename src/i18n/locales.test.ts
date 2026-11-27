import { describe, expect, it } from "vitest";
import { pickLocale } from "./locales";

describe("pickLocale", () => {
  it("prefers the saved cookie, then the best Accept-Language match by q, then English", () => {
    expect(pickLocale("pl", "de-DE,de;q=0.9")).toBe("pl");
    expect(pickLocale("xx", "ja;q=1, fr-CA;q=0.8, de;q=0.9")).toBe("de");
    expect(pickLocale(undefined, "et-EE")).toBe("et");
    expect(pickLocale(undefined, "ja, zh;q=0.5")).toBe("en");
    expect(pickLocale(undefined, null)).toBe("en");
  });
});
