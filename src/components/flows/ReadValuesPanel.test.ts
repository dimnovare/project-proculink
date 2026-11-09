import { expect, it } from "vitest";
import { locationText } from "./ReadValuesPanel";

it("labels paragraph and line addresses, leaves others raw", () => {
  expect(locationText({ page: null, address: "para:2" } as never)).toBe("Paragraph 2");
  expect(locationText({ page: null, address: "line:7" } as never)).toBe("Line 7");
  expect(locationText({ page: null, address: "json:/po" } as never)).toBe("json:/po");
});
