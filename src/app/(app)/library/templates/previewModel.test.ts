import { describe, it, expect } from "vitest";
import { bodyForPreview, previewFor } from "./previewModel";

// B7 — the output-templates editor must preview AND export the user's SAVED body
// (config.body), not the static per-format skeleton. bodyForPreview is the single
// helper both the export and the preview pane use; these freeze the prefer-saved
// vs fall-back-to-skeleton behaviour.
describe("bodyForPreview", () => {
  it("prefers the authored config.body (split into lines) when present", () => {
    const card = { fmt: "cXML", config: { body: '<Order id="X">\n  <Line/>\n</Order>' } };
    expect(bodyForPreview(card)).toEqual(['<Order id="X">', "  <Line/>", "</Order>"]);
  });

  it("falls back to the per-format skeleton when there is no body", () => {
    const card = { fmt: "cXML", config: null };
    expect(bodyForPreview(card)).toEqual(previewFor("cXML"));
    expect(bodyForPreview(card)[0]).toContain("<cXML");
  });

  it("falls back to the skeleton when the body is empty / whitespace-only", () => {
    expect(bodyForPreview({ fmt: "JSON", config: { body: "" } })[0]).toBe("{");
    expect(bodyForPreview({ fmt: "JSON", config: { body: "   \n  " } })[0]).toBe("{");
  });

  it("uses the JSON skeleton for an unknown format with no body", () => {
    expect(bodyForPreview({ fmt: "totally-unknown", config: null })[0]).toBe("{");
  });
});
