import { describe, expect, it } from "vitest";
import { formatReadValue } from "./format-number";

const NBSP = " ";
const NNBSP = " ";

describe("formatReadValue", () => {
  it("writes money the reader's way, with the printed decimals and the currency where it was", () => {
    const shown = (locale: string) => formatReadValue("1 303.40", "money", "total_net", locale);
    expect(shown("en")).toBe("1,303.40");
    expect(shown("de")).toBe("1.303,40");
    expect(shown("fr")).toBe(`1${NNBSP}303,40`);
    expect(shown("pl")).toBe(`1${NBSP}303,40`);
    expect(shown("et")).toBe(`1${NBSP}303,40`);
    expect(formatReadValue("€ 1303,4", "money", null, "en")).toBe("€ 1,303.4");
    expect(formatReadValue("1'234.50 CHF", "number", null, "de")).toBe("1.234,50 CHF");
    expect(formatReadValue("2026-05-21", "date", null, "de")).toBe("21.05.2026");
    expect(formatReadValue("21/05/2026", "date", null, "en")).toBe("21/05/2026");
  });

  it("leaves a value with two readings, a document number or a non-number as read", () => {
    for (const [raw, type, meaning] of [["1.500", "money", null], ["1,500", "number", null], ["03/04/2026", "date", null], ["10045", "number", "document_number"],
      ["0012", "number", null], ["KS-100", "number", null], ["12500", "text", null], ["5 Nov 2026", "date", null]] as const)
      expect(formatReadValue(raw, type, meaning, "de"), raw).toBe(raw);
  });
});
