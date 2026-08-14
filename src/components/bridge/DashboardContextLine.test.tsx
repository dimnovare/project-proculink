import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DashboardContextLine, greetingForHour } from "./DashboardContextLine";

// The dashboard's 36px context line (founder-approved mock 2026-07):
// greeting + date + blockers segment with a jump link. The blockers rules are
// load-bearing: 0 over a COMPLETE population must read "All clear" (never
// "0 blockers…") with the jump link hidden; null (source query not settled)
// renders no segment at all.
//
// And 0 over an INCOMPLETE one must not read "All clear" at all (audit 2026-08-13 v3,
// P0-9). The count comes from BridgeDashboard's `needsYouAll`, computed over
// `ordersPage?.items ?? []` fetched at `pageSize: 100`, while the attention strip
// further down the same screen prints its count from the summary endpoint — the whole
// population. Past a hundred orders "All clear" could render directly above "137 orders
// need your attention", with both numbers individually correct.

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

/** The whole account fits in what was counted — the only case that earns a verdict. */
function renderComplete(blockers: number | null, onJump: () => void = () => {}) {
  return render(
    <DashboardContextLine
      blockers={blockers}
      blockersScanned={blockers ?? 0}
      blockersComplete
      onJumpToBlockers={onJump}
    />,
  );
}

describe("DashboardContextLine", () => {
  it("renders the greeting with the Clerk first name and the blockers segment", () => {
    renderComplete(3);
    // Greeting text depends on the test machine's clock — assert the shape.
    expect(screen.getByText(/^Good (morning|afternoon|evening), Dim$/)).toBeInTheDocument();
    expect(screen.getByText("3 blockers")).toBeInTheDocument();
    expect(screen.getByText(/need you first/)).toBeInTheDocument();
  });

  it("falls back to a name-less greeting when Clerk has no first name", () => {
    mockFirstName = null;
    renderComplete(null);
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeInTheDocument();
  });

  it("uses singular grammar for one blocker", () => {
    renderComplete(1);
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText(/needs you first/)).toBeInTheDocument();
  });

  it("shows the jump link when blockers exist and wires the click", () => {
    const onJump = vi.fn();
    renderComplete(2, onJump);
    fireEvent.click(screen.getByRole("button", { name: /Jump to blockers/ }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("at 0 blockers over the WHOLE account says All clear and hides the jump link", () => {
    renderComplete(0);
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 blockers/)).not.toBeInTheDocument();
  });

  it("renders no blockers segment while the source is unsettled (null)", () => {
    renderComplete(null);
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    expect(screen.queryByText(/blocker/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
  });
});

describe("0 blockers over a PAGE is not a verdict about the account (P0-9)", () => {
  it("names the window it covered instead of claiming All clear", () => {
    render(
      <DashboardContextLine
        blockers={0}
        blockersScanned={100}
        blockersComplete={false}
        onJumpToBlockers={() => {}}
      />,
    );
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    expect(screen.getByText(/No blockers in the newest 100 orders/)).toBeInTheDocument();
    // Still no fabricated 0, and still nothing to jump to.
    expect(screen.queryByText(/0 blockers/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to blockers/ })).not.toBeInTheDocument();
  });

  it("says how many it actually looked at, with singular grammar at one", () => {
    render(
      <DashboardContextLine
        blockers={0}
        blockersScanned={1}
        blockersComplete={false}
        onJumpToBlockers={() => {}}
      />,
    );
    expect(screen.getByText(/No blockers in the newest 1 order$/)).toBeInTheDocument();
  });

  it("still reports blockers it DID find — a truncated window does not suppress them", () => {
    // The count is honest whatever the window: those orders really do need a human, and
    // the jump link goes to the rows that produced it. Only the verdict was over-claiming.
    render(
      <DashboardContextLine
        blockers={4}
        blockersScanned={100}
        blockersComplete={false}
        onJumpToBlockers={() => {}}
      />,
    );
    expect(screen.getByText("4 blockers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jump to blockers/ })).toBeInTheDocument();
  });
});
