import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, INPUT } from "./DestinationForm";

describe("Field", () => {
  it("marks a value that needs a look in words, not by colour alone", () => {
    const { container } = render(
      <Field label="Date" look="Check this one. It is written as 21.11.26."><input className={INPUT} defaultValue="2026-11-21" /></Field>,
    );
    expect(screen.getByText("Check this one. It is written as 21.11.26.")).toBeInTheDocument();
    expect(container.querySelector("label")).toHaveClass("plk-look");
    expect(screen.getByLabelText(/^Date/)).toHaveValue("2026-11-21");
  });

  it("draws a value we are sure of plainly", () => {
    const { container } = render(<Field label="Invoice number"><input className={INPUT} defaultValue="INV-2291" /></Field>);
    expect(container.querySelector("label")).not.toHaveClass("plk-look");
    expect(INPUT).toContain("text-[14px]");
  });
});
