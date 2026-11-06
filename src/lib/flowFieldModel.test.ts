import { describe, expect, it } from "vitest";
import type { ReadResult } from "@/lib/api/documents";
import { fieldListFromRead } from "@/lib/flowFieldModel";

const f = (key: string, label: string, type: string) => ({
  key, label, value: "x", type, meaning: null, confidence: 1, location: null, notOnPage: false, listed: true, edited: false,
});

describe("fieldListFromRead", () => {
  it("keeps keys, labels and types, with nothing required", () => {
    const read: ReadResult = {
      kindLabel: null, truncated: false,
      fields: [f("number", "Number", "code"), f("total", "Total", "money")],
      tables: [{
        key: "lines", label: "Lines", listed: true, rows: [],
        columns: [{ key: "item", label: "Item", type: "text", meaning: null }, { key: "qty", label: "Qty", type: "number", meaning: null }],
      }],
    };
    expect(fieldListFromRead(read)).toEqual({
      fields: [
        { key: "number", label: "Number", type: "code", meaning: null, required: false },
        { key: "total", label: "Total", type: "money", meaning: null, required: false },
      ],
      tables: [{
        key: "lines", label: "Lines",
        columns: [
          { key: "item", label: "Item", type: "text", meaning: null, required: false },
          { key: "qty", label: "Qty", type: "number", meaning: null, required: false },
        ],
      }],
    });
  });
});
