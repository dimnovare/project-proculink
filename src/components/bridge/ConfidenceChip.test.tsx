/**
 * ConfidenceChip — one chip, one set of thresholds.
 *
 * Four implementations used to disagree (>=90/75, >=85/65, >=85/60, >=90/75) and
 * NONE of them had a test, which is why an 88% could read green in one pane and
 * amber in another for as long as it did. These pin the CLAUDE.md §6 contract —
 * >=90 green, 75-89 amber, <75 red — at every boundary, so moving a threshold
 * fails here rather than being noticed on a screenshot.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceChip, confidenceTone } from "./ConfidenceChip";
import { confidenceTier } from "@/lib/ds-tokens";

const OK_FG = "#1E6D29";
const WARN_FG = "#8A5310";
const DANGER_FG = "#B43838";

describe("confidence thresholds — CLAUDE.md §6 contract", () => {
  it("74 is DANGER (below the 75 amber floor)", () => {
    expect(confidenceTier(74)).toBe("danger");
    expect(confidenceTone(74).fg).toBe(DANGER_FG);
  });

  it("75 is WARN (the amber floor is inclusive)", () => {
    expect(confidenceTier(75)).toBe("warn");
    expect(confidenceTone(75).fg).toBe(WARN_FG);
  });

  it("89 is still WARN (amber runs 75-89)", () => {
    expect(confidenceTier(89)).toBe("warn");
    expect(confidenceTone(89).fg).toBe(WARN_FG);
  });

  it("90 is OK (the green floor is inclusive)", () => {
    expect(confidenceTier(90)).toBe("ok");
    expect(confidenceTone(90).fg).toBe(OK_FG);
  });

  it("85 is WARN, not OK — the retired 85/65 ramp would have called it green", () => {
    expect(confidenceTone(85).fg).toBe(WARN_FG);
  });

  it("62 is DANGER, not WARN — the retired 85/60 ramp would have called it amber", () => {
    expect(confidenceTone(62).fg).toBe(DANGER_FG);
  });
});

describe("<ConfidenceChip>", () => {
  it("renders a whole percent and labels it for screen readers", () => {
    render(<ConfidenceChip value={92} />);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByLabelText("AI confidence 92%")).toBeInTheDocument();
  });

  it("normalises a 0..1 score before tiering", () => {
    // A 0.92 tiered without normalisation would fall under 75 and render red.
    render(<ConfidenceChip value={0.92} />);
    const chip = screen.getByText("92%");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveStyle({ color: OK_FG });
  });

  it("colours the boundary values per the contract", () => {
    const { rerender } = render(<ConfidenceChip value={90} />);
    expect(screen.getByText("90%")).toHaveStyle({ color: OK_FG });

    rerender(<ConfidenceChip value={89} />);
    expect(screen.getByText("89%")).toHaveStyle({ color: WARN_FG });

    rerender(<ConfidenceChip value={74} />);
    expect(screen.getByText("74%")).toHaveStyle({ color: DANGER_FG });
  });
});
