import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("shows the title, its one helper line and the way back", () => {
    render(<PageHeader title="Supplier invoices" sub="Live, version 4" back={{ href: "/flows", label: "Flows" }} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Supplier invoices" });
    expect(h1).not.toHaveClass("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1.parentElement!.querySelector("p")).toHaveTextContent("Live, version 4");
    const back = screen.getByRole("link", { name: "Back to Flows" });
    expect(back).toHaveAttribute("href", "/flows");
    expect(back.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws a title action right after the title, and nothing extra without one", () => {
    const { rerender } = render(<PageHeader title="Supplier invoices" />);
    const plain = screen.getByRole("heading", { level: 1 });
    expect(plain.nextElementSibling).toBeNull();
    rerender(<PageHeader title="Supplier invoices" titleAction={<button type="button">Rename this flow</button>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Supplier invoices" });
    expect(h1.nextElementSibling).toBe(screen.getByRole("button", { name: "Rename this flow" }));
  });
});
