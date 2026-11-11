import { it, expect } from "vitest";
import { csvCell } from "./csvCell";

it("quotes cells and neutralises formula triggers", () => {
  expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  expect(csvCell("PO-1")).toBe(`"PO-1"`);
  expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  expect(csvCell(null)).toBe(`""`);
  expect(csvCell(-5)).toBe(`"-5"`);
});
