import { describe, it, expect } from "vitest";
import { shouldHonorFormat, previewInfoNote } from "./previewFormatModel";

describe("shouldHonorFormat — exploratory opt-in decision", () => {
  it("is false when the delivered format is unknown (no pin / no defaultFormat)", () => {
    expect(shouldHonorFormat("csv", null)).toBe(false);
    expect(shouldHonorFormat("json", null)).toBe(false);
  });

  it("is false when the toggle matches the connection's delivered format", () => {
    expect(shouldHonorFormat("json", "json")).toBe(false);
  });

  it("is true only when the toggle differs from a KNOWN delivered format", () => {
    expect(shouldHonorFormat("csv", "json")).toBe(true);
    expect(shouldHonorFormat("xml", "json")).toBe(true);
  });
});

describe("previewInfoNote — honest preview labelling", () => {
  it("EXPLORATORY: names the explored format and what the supplier actually receives", () => {
    const note = previewInfoNote({
      honored: true,
      selected: "csv",
      delivered: "csv", // exploratory render → server reports the explored format
      connectionFormat: "json",
      hasHarderMessage: false,
    });
    expect(note).toBe("Preview as CSV · not the delivered format (the supplier receives JSON).");
  });

  it("EXPLORATORY: falls back to the delivered format when connectionFormat is somehow unknown", () => {
    const note = previewInfoNote({
      honored: true,
      selected: "xml",
      delivered: "xml",
      connectionFormat: null,
      hasHarderMessage: false,
    });
    expect(note).toBe("Preview as XML · not the delivered format (the supplier receives XML).");
  });

  it("DEFAULT: notes the swap when a pinned connection delivers a different format than the toggle", () => {
    const note = previewInfoNote({
      honored: false,
      selected: "csv",
      delivered: "json", // server swapped to the pinned format
      connectionFormat: "json",
      hasHarderMessage: false,
    });
    expect(note).toContain("This connection delivers JSON");
    expect(note).toContain("unless you explore another format");
  });

  it("DEFAULT: no note when the toggle already matches the delivered bytes", () => {
    const note = previewInfoNote({
      honored: false,
      selected: "json",
      delivered: "json",
      connectionFormat: "json",
      hasHarderMessage: false,
    });
    expect(note).toBeNull();
  });

  it("DEFAULT: suppresses the calm note when a harder warning/error is already shown", () => {
    const note = previewInfoNote({
      honored: false,
      selected: "csv",
      delivered: "json",
      connectionFormat: "json",
      hasHarderMessage: true, // e.g. "lines still need review"
    });
    expect(note).toBeNull();
  });
});
