import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/core";
import { COPY, canRetryRead, documentRefusalMessage, readFailureMessage } from "./documentRefusals";

const refusal = (body: unknown) => new ApiHttpError("x", 422, body);

describe("documentRefusalMessage", () => {
  it("names the output and the reason", () => {
    expect(documentRefusalMessage(refusal({ error: "output_invalid", output: "Accounting CSV", detail: "x" })))
      .toBe('The output "Accounting CSV" couldn\'t be made: x');
  });
  it("words an output_invalid machine token", () => {
    expect(documentRefusalMessage(refusal({ error: "output_invalid", detail: "send_when" }))).toBe(COPY.send_when);
  });
  it("falls back to the generic line for an unknown token", () => {
    expect(documentRefusalMessage(refusal({ error: "mystery" }))).toBe("Something went wrong. Try again.");
  });
  it("passes an invalid_intake detail through", () => {
    expect(documentRefusalMessage(refusal({ error: "invalid_intake", detail: "Host is required." }))).toBe("Host is required.");
  });
  it.each([
    [403, "requires_org_admin", "Only a workspace admin can change this."],
    [429, "pilot_expired", "Your trial has ended, so new documents aren't being accepted."],
    [429, "order_limit_reached", "You've reached your plan's document limit for this month."],
    [413, undefined, "This file is too large."],
  ])("words a %s %s refusal", (status, error, words) => {
    expect(documentRefusalMessage(new ApiHttpError("x", status, error ? { error } : null))).toBe(words);
  });
});

describe("scan read failures", () => {
  it("a no-egress read failure has its own copy and no retry", () => {
    expect(readFailureMessage("no_egress")).toBe("This workspace keeps documents on our own servers, so they aren't sent to AI to be read.");
    expect(canRetryRead("no_egress")).toBe(false);
    expect(canRetryRead("usage_cap")).toBe(true);
    expect(canRetryRead("scanned_not_supported", { scansOn: true })).toBe(true);
    expect(canRetryRead("scanned_not_supported")).toBe(false);
    expect(canRetryRead("scanned_not_supported", { scansOn: false })).toBe(false);
  });
});
