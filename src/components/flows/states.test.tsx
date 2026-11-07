import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { ReadProblem } from "./states";
import { COPY } from "@/lib/documentRefusals";

describe("ReadProblem", () => {
  it("says why a held document is waiting when no output matches", () => {
    const summary = { id: "d", status: "needs_review", statusReason: "no_output_matches" };
    const { container } = render(<ReadProblem summary={summary as never} nothingRead={false} retry={{} as never} />);
    expect(within(container).getByText(COPY.no_output_matches)).toBeTruthy();
  });
});
