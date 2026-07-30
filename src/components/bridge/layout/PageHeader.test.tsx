import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

// PageHeader `titleHidden` — the shared mechanism behind the nav-dedup rule
// (the active topbar tab IS the page name; pages stop re-announcing it).
// Every audited page renders its h1 through this component, so these tests
// pin the contract all of them rely on: exactly one h1, same text, sr-only.

vi.mock("next/navigation", () => ({
  // Non-hub path: HubEyebrow (used in the visible variant) renders nothing.
  usePathname: () => "/inbox",
}));

describe("PageHeader", () => {
  it("visible variant renders exactly one h1 with the title text", () => {
    render(<PageHeader title="Upload an order" sub="One file at a time" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Upload an order");
    expect(headings[0]).not.toHaveClass("sr-only");
  });

  it("titleHidden keeps exactly one h1 with the same text, visually hidden", () => {
    render(<PageHeader titleHidden title="Inbox" sub="2 need review" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Inbox");
    expect(headings[0]).toHaveClass("sr-only");
  });

  it("titleHidden still renders the sub and the actions", () => {
    render(
      <PageHeader
        titleHidden
        title="Webhooks"
        sub="3 endpoints"
        actions={<button type="button">Add endpoint</button>}
      />,
    );
    expect(screen.getByText("3 endpoints")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add endpoint" })).toBeInTheDocument();
  });

  it("titleHidden with actions only keeps the actions reachable", () => {
    render(<PageHeader titleHidden title="Connections" actions={<button type="button">Manage suppliers</button>} />);
    expect(screen.getByRole("button", { name: "Manage suppliers" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("titleHidden with no sub/actions renders only the sr-only h1", () => {
    const { container } = render(<PageHeader titleHidden title="Operations health" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Operations health");
    expect(headings[0]).toHaveClass("sr-only");
    // No visual header row is left behind (the h1 is the only element).
    expect(container.querySelectorAll("div")).toHaveLength(0);
  });
});
