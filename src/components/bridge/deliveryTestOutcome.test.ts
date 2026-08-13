// A failed connection test used to look the same whatever failed.
//
// The editor rendered one red box reading "Test-fire failed" for a refused sign-in, a hostname
// that never answered, and a path that was not there — three different repairs (fix the
// credential / fix the address / fix the path) presented identically, with only whatever sentence
// the backend happened to send to tell them apart.
//
// These pin the split. The line that matters is `responseCode == null`: no HTTP status came back,
// so nothing answered at all, and the operator is looking at an address problem rather than a
// credential one. Everything else is derived from the status code and nothing beyond it.

import { describe, it, expect } from "vitest";
import { describeDeliveryTestOutcome } from "./deliveryTestOutcome";

describe("describeDeliveryTestOutcome", () => {
  it("reports a pass without guidance — the honesty note carries that state", () => {
    const out = describeDeliveryTestOutcome({ success: true, responseCode: 200 });
    expect(out.tone).toBe("pass");
    expect(out.title).toMatch(/answered/i);
    expect(out.guidance).toBe("");
  });

  it("tells an unreachable address apart from a refused sign-in", () => {
    // No status code = nothing replied. This is the DNS / wrong host / timed-out case, and it is
    // NOT a credential problem — saying so is the whole point.
    const unreachable = describeDeliveryTestOutcome({ success: false, responseCode: null });
    expect(unreachable.tone).toBe("unreachable");
    expect(unreachable.guidance).toMatch(/not a sign-in problem/i);

    const refused = describeDeliveryTestOutcome({ success: false, responseCode: 401 });
    expect(refused.tone).toBe("refused");
    expect(refused.guidance).toMatch(/credential/i);

    // The defect verbatim: these two produced identical output.
    expect(unreachable.title).not.toBe(refused.title);
    expect(unreachable.guidance).not.toBe(refused.guidance);
  });

  it("treats a missing responseCode field the same as an explicit null", () => {
    expect(describeDeliveryTestOutcome({ success: false }).tone).toBe("unreachable");
  });

  it("reads 401 and 403 as the sign-in being refused, and names the header to check", () => {
    for (const code of [401, 403]) {
      const out = describeDeliveryTestOutcome({ success: false, responseCode: code });
      expect(out.tone).toBe("refused");
      expect(out.title).toContain(String(code));
      expect(out.guidance).toMatch(/header name/i);
    }
  });

  it("reads 404 and 405 as the address being wrong, not the credential", () => {
    for (const code of [404, 405]) {
      const out = describeDeliveryTestOutcome({ success: false, responseCode: code });
      expect(out.tone).toBe("rejected");
      expect(out.guidance).toMatch(/path/i);
      expect(out.guidance).not.toMatch(/credential/i);
    }
  });

  it("reads 5xx, 429 and 408 as their problem, and says not to change anything yet", () => {
    for (const code of [408, 429, 500, 502, 503]) {
      const out = describeDeliveryTestOutcome({ success: false, responseCode: code });
      expect(out.tone).toBe("their-side");
      expect(out.guidance).toMatch(/nothing here needs changing/i);
    }
  });

  it("falls back to a plain rejection for a 4xx it cannot classify", () => {
    const out = describeDeliveryTestOutcome({ success: false, responseCode: 422 });
    expect(out.tone).toBe("rejected");
    expect(out.title).toContain("422");
  });

  it("gives every failure a distinct headline", () => {
    // Anti-vacuity: the classifier must not have collapsed back into one message with the code
    // interpolated. Compare the codeless part of each title.
    const codes = [null, 401, 404, 500, 422];
    const titles = codes.map(
      (c) => describeDeliveryTestOutcome({ success: false, responseCode: c }).title.replace(/\s*\(\d+\)/, ""),
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("never states a status code it was not given", () => {
    expect(describeDeliveryTestOutcome({ success: false, responseCode: null }).title).not.toMatch(/\d{3}/);
  });
});
