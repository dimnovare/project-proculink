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
    expect(screen.getByLabelText("Confidence 92%")).toBeInTheDocument();
  });

  it("does NOT claim the number came from a model unless the caller says so", () => {
    // The chip hard-coded "AI confidence" into its aria-label and title, so every call
    // site made an AI claim on the user's behalf — including a supplier auto-detect
    // heuristic and a saved supplier mapping that no model has ever been invoked for.
    // The default now says only what is always true: this is a confidence.
    render(<ConfidenceChip value={92} />);
    expect(screen.queryByLabelText("AI confidence 92%")).toBeNull();
    expect(screen.getByLabelText("Confidence 92%")).toBeInTheDocument();
  });

  it("says 'AI confidence' when the caller states it AND a model produced the number", () => {
    // This test used to pass `label="AI confidence"` with nothing else and assert the AI wording
    // came out — i.e. it pinned "the caller's word is enough". That was the contract, and the
    // contract was the bug: saying the words was the whole of the requirement, so a call site
    // rendering a client-side Levenshtein score satisfied it. `basis` is now the evidence, and
    // the label alone no longer buys the claim (see "an AI claim has to be earned" below).
    render(<ConfidenceChip value={86} label="AI confidence" basis="model" />);
    expect(screen.getByLabelText("AI confidence 86%")).toBeInTheDocument();
    expect(screen.getByTitle("AI confidence · 86%")).toBeInTheDocument();
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

/**
 * The chip's own guard rails.
 *
 * `label` was a free string, which moved the "is this really AI?" decision to every call site and
 * then trusted all of them. They did not all get it right: PoMappingEditor passed
 * `label="AI confidence"` gated only on `score != null`, so a client-side Levenshtein match —
 * the LIVE fallback whenever the suggest-fields request errors, 404s, or returns an unparseable
 * body — rendered `aria-label="AI confidence 89%"` in the violet reserved for model output.
 *
 * The rule now lives in the component, where a fourth call site cannot forget it.
 */
describe("an AI claim has to be earned", () => {
  it("keeps the AI label when a model really scored it", () => {
    render(<ConfidenceChip value={0.89} label="AI confidence" basis="model" />);
    expect(screen.getByLabelText("AI confidence 89%")).toBeInTheDocument();
  });

  it("strips the AI label from a heuristic score, in BOTH the text and the accessible name", () => {
    render(<ConfidenceChip value={0.89} label="AI confidence" basis="heuristic" />);

    // The number survives — a string-similarity score is a real measurement.
    expect(screen.getByText("89%")).toBeInTheDocument();

    // The attribution does not. Asserted on the accessible name specifically: the defect lived in
    // an aria-label, which never appears in textContent.
    expect(screen.queryByLabelText(/AI confidence/i)).toBeNull();
    expect(screen.getByLabelText("Match 89%")).toBeInTheDocument();
    expect(document.querySelector('[aria-label*="AI"]')).toBeNull();
  });

  it("strips the AI label when the basis is simply not stated", () => {
    // An omitted basis is not evidence of a model. Defaulting the other way is precisely how the
    // fabricated attribution spread.
    render(<ConfidenceChip value={0.89} label="AI confidence" />);
    expect(screen.queryByLabelText(/AI confidence/i)).toBeNull();
    expect(screen.getByLabelText("Confidence 89%")).toBeInTheDocument();
  });

  it("renders nothing at all when there is no number", () => {
    // Not "0%". On the confidence ramp 0% is red — a claim of near-certain wrongness — so an
    // absent score rendering as zero is a LOUDER lie than the fabricated 95% this work removed.
    const { container, rerender } = render(<ConfidenceChip value={null} label="AI confidence" basis="model" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ConfidenceChip value={undefined} label="AI confidence" basis="model" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ConfidenceChip value={Number.NaN} label="AI confidence" basis="model" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a deterministic basis — a lookup has no score", () => {
    const { container } = render(<ConfidenceChip value={1} label="AI confidence" basis="deterministic" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not mistake the letters 'ai' inside an ordinary word for an AI claim", () => {
    // The guard matches the word AI, not the substring: "Plain confidence" must survive intact.
    render(<ConfidenceChip value={0.89} label="Plain confidence" basis="heuristic" />);
    expect(screen.getByLabelText("Plain confidence 89%")).toBeInTheDocument();
  });
});
