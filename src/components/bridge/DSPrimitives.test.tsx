import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, BUTTON_SIZE, Pill } from "./DSPrimitives";

describe("shared buttons and tags", () => {
  it("gives each filled button its meaning: navy makes real, green sends, blue brings in", () => {
    render(<><Button variant="primary">Publish changes</Button><Button variant="send">Send</Button><Button variant="blue">Import a table</Button></>);
    expect(screen.getByRole("button", { name: "Publish changes" })).toHaveClass("bg-navy");
    expect(screen.getByRole("button", { name: "Send" })).toHaveClass("bg-brand-green-btn");
    expect(screen.getByRole("button", { name: "Import a table" })).toHaveClass("bg-brand-blue");
  });

  it("keeps button and tag text at 12.5px or more", () => {
    const sizes = Object.values(BUTTON_SIZE).map((cls) => Number(/text-\[([\d.]+)px\]/.exec(cls)![1]));
    expect(sizes).toHaveLength(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12.5);
    render(<Pill tone="amber">2 values to check</Pill>);
    expect(screen.getByText("2 values to check").style.fontSize).toBe("12.5px");
  });
});
