// WP-27 fix — the practice CTA's reassurance copy must not hardcode a party noun.
//
// WAVE4 binding constraint: "Never hardcode a party noun in user-facing copy. Route
// through partyLabels(direction). Hardcoding 'supplier' silently deletes the inbound
// mode." An inbound org has CUSTOMERS; telling it "nothing goes to a real supplier"
// is a sentence about a party it does not have.
//
// This is a REGRESSION guard, not a new rule: the copy PracticeOrderPrompt replaced
// (OnboardingChecklist's honesty line) was already noun-aware — "…expected for the
// practice {nounLower}". lint:vocab cannot catch this; it checks nav labels against
// the nine-noun budget, not body copy.

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useSampleOrder", () => ({
  usePracticeOrderEmail: () => "coordinator@northgate.example",
}));

import { PracticeOrderPrompt } from "./PracticeOrderPrompt";

afterEach(cleanup);

/** Everything the component renders, collapsed and expanded. */
function copy(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("PracticeOrderPrompt — party nouns", () => {
  test("an inbound org never reads the word 'supplier'", () => {
    const { container } = render(
      <PracticeOrderPrompt nounLower="customer" pending={false} onRun={vi.fn()} />,
    );

    // Collapsed: the CTA plus its one-line reassurance.
    expect(copy(container)).not.toMatch(/supplier/i);

    // Expanded: the address field plus the second reassurance line. Both were
    // hardcoded, so checking only one state would miss half the defect.
    fireEvent.click(screen.getByRole("button", { name: /try a practice order/i }));
    expect(screen.getByLabelText(/send the finished file to/i)).toBeInTheDocument();
    expect(copy(container)).not.toMatch(/supplier/i);
  });

  test("an outbound org still reads 'supplier' — the noun is threaded, not deleted", () => {
    const { container } = render(
      <PracticeOrderPrompt nounLower="supplier" pending={false} onRun={vi.fn()} />,
    );

    expect(copy(container)).toMatch(/supplier/i);
    fireEvent.click(screen.getByRole("button", { name: /try a practice order/i }));
    expect(copy(container)).toMatch(/supplier/i);
  });
});
