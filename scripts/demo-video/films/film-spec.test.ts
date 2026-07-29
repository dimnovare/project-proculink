import { describe, expect, it } from "vitest";
import { validateFilmSpec } from "./film-spec";

const valid = {
  id: "walkthrough-2026-07",
  title: "ProcuLink walkthrough",
  targetSeconds: { min: 90, max: 110 },
  intro: {
    kicker: "How ProcuLink works",
    headline: "From buyer PO to supplier-ready order",
  },
  outro: {
    headline: "Send every purchase order in the format each supplier needs.",
    cta: "proculink.eu",
  },
  beats: [
    {
      id: "open",
      kind: "ui",
      route: "/upload",
      vo: "ProcuLink turns buyer purchase orders into supplier-ready orders.",
      shot: "Current upload screen.",
    },
  ],
};

describe("validateFilmSpec", () => {
  it("accepts a valid specification", () => {
    expect(validateFilmSpec(valid)).toEqual(valid);
  });

  it("rejects subtitle or caption output", () => {
    expect(() =>
      validateFilmSpec({ ...valid, captions: true }),
    ).toThrow(/captions and subtitles are forbidden/i);
  });

  it("rejects generated footage for a UI beat", () => {
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [{ ...valid.beats[0], source: "generated" }],
      }),
    ).toThrow(/ui beats must use real capture/i);
  });

  it("rejects duplicate beat ids", () => {
    expect(() =>
      validateFilmSpec({
        ...valid,
        beats: [valid.beats[0], valid.beats[0]],
      }),
    ).toThrow(/duplicate beat id/i);
  });
});
