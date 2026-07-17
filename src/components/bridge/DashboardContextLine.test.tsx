import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DashboardContextLine, greetingForHour } from "./DashboardContextLine";

// The dashboard's 36px context line (founder-approved mock 2026-07):
// greeting + date + blockers segment with a jump link. The blockers rules are
// load-bearing: 0 must read "All clear" (never "0 blockers…") with the jump
// link hidden; null (source query not settled) renders no segment at all.

let mockFirstName: string | null = "Dim";
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: mockFirstName ? { firstName: mockFirstName } : null, isLoaded: true }),
}));

afterEach(() => {
  cleanup();
  mockFirstName = "Dim";
});

describe("greetingForHour", () => {
  it("maps the local hour to morning / afternoon / evening", () => {
    expect(greetingForHour(0)).toBe("morning");
    expect(greetingForHour(11)).toBe("morning");
    expect(greetingForHour(12)).toBe("afternoon");
    expect(greetingForHour(17)).toBe("afternoon");
    expect(greetingForHour(18)).toBe("evening");
    expect(greetingForHour(23)).toBe("evening");
  });
});

describe("DashboardContextLine", () => {
  it("renders the greeting with the Clerk first name and the blockers segment", () => {
    render(<DashboardContextLine blockers={3} onJumpToBlockers={() => {}} />);
    // Greeting text depends on the test machine's clock — assert the shape.
    expect(screen.getByText(/^Good (morning|afternoon|evening), Dim$/)).toBeInTheDocument();
    expect(screen.getByText("3 blockers")).toBeInTheDocument();
    expect(screen.getByText(/need you first/)).toBeInTheDocument();
  });

  it("falls back to a name-less greeting when Clerk has no first name", () => {
    mockFirstName = null;
    render(<DashboardContextLine blockers={null} onJumpToBlockers={() => {}} />);
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeInTheDocument();
  });

  it("uses singular grammar for one blocker", () => {
    render(<DashboardContextLine blockers={1} onJumpToBlockers={() => {}} />);
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText(/needs you first/)).toBeInTheDocument();
  });

  it("shows the jump link when blockers exist and wires the click", () => {
    const onJump = vi.fn();
    render(<DashboardContextLine blockers={2} onJumpToBlockers={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: /Jump to blockers/ }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("at 0 blockers says All clear and hides the jump link — never a 0 count", () => {
    render(<DashboardContextLine blockers={0} onJumpToBlockers={() => {}} />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 blockers/)).not.toBeInTheDocument();
  });

  it("renders no blockers segment while the source is unsettled (null)", () => {
    render(<DashboardContextLine blockers={null} onJumpToBlockers={() => {}} />);
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    expect(screen.queryByText(/blocker/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
  });
});
