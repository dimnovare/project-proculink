import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "./documentRefusals";

const refusal = (body: unknown) => new ApiHttpError("x", 422, body);

describe("documentRefusalMessage", () => {
  it("names the output and the reason", () => {
    expect(documentRefusalMessage(refusal({ error: "output_invalid", output: "Accounting CSV", detail: "x" })))
      .toBe('The output "Accounting CSV" couldn\'t be made: x');
  });
  it("falls back to the generic line for an unknown token", () => {
    expect(documentRefusalMessage(refusal({ error: "mystery" }))).toBe("Something went wrong. Try again.");
  });
});
