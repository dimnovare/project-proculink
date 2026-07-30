import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParsingGate } from "./ParsingGate";

// The parse gate is the screen a user watches while the Worker reads their file. It polls every 3
// seconds and, until WP-08, escalated NEVER: if the Worker was down the spinner ran forever and the
// copy kept promising "this usually takes a few seconds". "Nothing happens" is exactly what a Worker
// outage looks like from here, so the calm state has to be able to stop being calm.
//
// The honesty contract (G9), restored from the deleted MagicMappingPreview escalation:
//   • it NEVER claims failure — the Worker may simply be catching up, and a false "failed" would
//     make a user re-upload a document that is still in flight;
//   • it names the one thing they can actually do (check system health);
//   • polling continues unchanged — the screen must still auto-advance if the parse completes.

describe("ParsingGate", () => {
  it("stays calm while the parse is within its normal window", () => {
    render(<ParsingGate stalled={false} />);

    expect(screen.getByTestId("order-parsing")).toBeInTheDocument();
    expect(screen.getByText(/reading your file/i)).toBeInTheDocument();
    // No escalation, and no link offered — there is nothing wrong to investigate yet.
    expect(screen.queryByTestId("order-parsing-stalled")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /system health/i })).not.toBeInTheDocument();
  });

  it("escalates once the parse has been running too long, without claiming failure", () => {
    render(<ParsingGate stalled />);

    // Still the parsing gate — the escalation replaces the reassurance, not the screen.
    expect(screen.getByTestId("order-parsing")).toBeInTheDocument();
    const escalation = screen.getByTestId("order-parsing-stalled");
    expect(escalation).toBeInTheDocument();

    // The one action a user can take, as a real link a click can follow.
    const link = screen.getByRole("link", { name: /system health/i });
    expect(link).toHaveAttribute("href", "/operations/health");

    // Honesty: it must NOT say the order failed, was rejected, or needs re-uploading.
    const text = escalation.textContent ?? "";
    expect(text).not.toMatch(/fail|error|rejected|try again|re-?upload/i);

    // …and the "few seconds" reassurance must be gone. Leaving it beside a stall warning is the
    // contradiction that made the old screen untrustworthy.
    expect(screen.queryByText(/usually takes a few seconds/i)).not.toBeInTheDocument();
  });
});
