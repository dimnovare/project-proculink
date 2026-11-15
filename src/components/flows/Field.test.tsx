import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, INPUT } from "./DestinationForm";

describe("Field", () => {
  it("marks a value that needs a look in words, not by colour alone", () => {
    render(<Field label="Date" look="Check this one. We are 72% sure of it."><input className={INPUT} defaultValue="2026-05-20" /></Field>);
    const box = screen.getByLabelText("Date");                                   // named by its label alone
    expect(box).toHaveAccessibleDescription("Check this one. We are 72% sure of it.");
    expect(box.closest(".plk-look")).not.toBeNull();
  });

  it("draws a value we are sure of plainly", () => {
    const { container } = render(<Field label="Invoice number"><input className={INPUT} defaultValue="INV-2291" /></Field>);
    expect(container.querySelector("label")).not.toHaveClass("plk-look");
    expect(INPUT).toContain("text-[14px]");
  });
});
