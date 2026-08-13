// A ghost wire may not claim a score it does not have.
//
// `GET /api/orders/{id}/mapping-suggestions` used to send a hard-coded `confidence: 0.95` for
// every entry read back from a supplier's SAVED PO mapping — a configured fact, produced by no
// model, because the suggester is deliberately never invoked on that path. This component drew
// it as a confident green ring reading "95" over controls labelled "Accept AI suggestion: …
// (AI 95% confidence)". Three separate lies in one 18px circle.
//
// These assert the strings a screen reader announces and the numeral a user sees, not prop
// names — a component that stopped reading `basis` but kept a `confidence` prop would still
// fail here.

import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GhostWire } from "./GhostWire";
import type { MappingSuggestion } from "@/lib/api/types";

afterEach(cleanup);

const SAVED: MappingSuggestion = {
  targetKey: "SupplierItemCode",
  sourceId: "BuyerItemCode",
  confidence: null,
  reason: "saved mapping for this supplier",
  sourceKind: "canonical",
  basis: "saved_mapping",
};

const SCORED: MappingSuggestion = {
  targetKey: "SupplierItemCode",
  sourceId: "raw_ihre_materialnr",
  confidence: 0.86,
  reason: "label 'Ihre Materialnr' ~ supplierItemCode",
  sourceKind: "raw",
  basis: "model",
};

/** GhostWire paints SVG primitives, so it has to be mounted inside an <svg>. */
function draw(suggestion: MappingSuggestion) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const { container } = render(
    <svg>
      <GhostWire suggestion={suggestion} hx={0} hy={0} zx={100} zy={40} onAccept={onAccept} onReject={onReject} />
    </svg>,
  );
  return { container, onAccept, onReject };
}

/** Every accessible name currently on screen. */
function accessibleNames(): string[] {
  return Array.from(document.querySelectorAll("[aria-label]")).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("<GhostWire> — a suggestion nothing scored", () => {
  it("names its controls 'saved mapping suggestion', never 'AI'", () => {
    draw(SAVED);

    const accept = screen.getByLabelText(/^Accept saved mapping suggestion:/);
    const dismiss = screen.getByLabelText(/^Dismiss saved mapping suggestion:/);

    expect(accept).toBeTruthy();
    expect(dismiss).toBeTruthy();
    for (const name of accessibleNames()) expect(name).not.toMatch(/AI/);
  });

  it("says where the suggestion came from instead of quoting a confidence", () => {
    draw(SAVED);
    expect(
      screen.getByLabelText("Accept saved mapping suggestion: saved mapping for this supplier (saved supplier mapping)"),
    ).toBeTruthy();
  });

  it("draws no numeral in the ring — an empty ring, not a fabricated score", () => {
    const { container } = draw(SAVED);
    // The ✓ and ✕ glyphs are <text> too; what must not exist is a numeric one.
    const numerals = Array.from(container.querySelectorAll("text"))
      .map((t) => t.textContent ?? "")
      .filter((t) => /\d/.test(t));
    expect(numerals).toEqual([]);
    expect(container.textContent).not.toMatch(/95/);
  });

  it("uses a neutral buyer-blue stroke, not a confidence tier colour", () => {
    const { container } = draw(SAVED);
    const strokes = Array.from(container.querySelectorAll("path, circle"))
      .map((el) => el.getAttribute("stroke") ?? el.getAttribute("fill") ?? "")
      .map((s) => s.toUpperCase());
    // #2E8E3A / #B36D14 / #B43838 are ghostTierColor's three tiers — each one asserts a score.
    // (The accept control's own green/red are allowed; they are the ✓/✕ affordance, so this
    // checks the WIRE + RING + anchor specifically.)
    const wire = container.querySelector("path");
    const ring = container.querySelectorAll("circle")[1];
    const anchor = container.querySelectorAll("circle")[0];
    expect(wire?.getAttribute("stroke")).toBe("var(--brand-blue)");
    expect(ring?.getAttribute("stroke")).toBe("var(--brand-blue)");
    expect(anchor?.getAttribute("fill")).toBe("var(--brand-blue)");
    // And the violet AI accent is nowhere on the unscored wire.
    expect(strokes).not.toContain("#6F4FCE");
  });
});

describe("<GhostWire> — a real model score is untouched", () => {
  it("still renders the numeral and the AI-suggestion labels", () => {
    const { container } = draw(SCORED);

    expect(screen.getByLabelText("Accept AI suggestion: label 'Ihre Materialnr' ~ supplierItemCode (AI 86% confidence)")).toBeTruthy();
    expect(screen.getByLabelText("Dismiss AI suggestion: label 'Ihre Materialnr' ~ supplierItemCode (AI 86% confidence)")).toBeTruthy();

    const numerals = Array.from(container.querySelectorAll("text"))
      .map((t) => t.textContent ?? "")
      .filter((t) => /\d/.test(t));
    expect(numerals).toEqual(["86"]);
  });

  it("keeps the tier colour and the violet AI anchor", () => {
    const { container } = draw(SCORED);
    const wire = container.querySelector("path");
    const anchor = container.querySelectorAll("circle")[0];
    expect(wire?.getAttribute("stroke")).toBe("#2E8E3A"); // ok tier: 0.86 >= 0.85
    expect(anchor?.getAttribute("fill")).toBe("#6F4FCE");
  });
});

describe("<GhostWire> — an older backend that omits `basis`", () => {
  it("reads a null confidence as a saved mapping rather than inventing a number", () => {
    const legacy: MappingSuggestion = { ...SAVED, basis: undefined };
    const { container } = draw(legacy);
    expect(screen.getByLabelText(/^Accept saved mapping suggestion:/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("still treats a real number as a model score", () => {
    const legacy: MappingSuggestion = { ...SCORED, basis: undefined };
    draw(legacy);
    expect(screen.getByLabelText(/^Accept AI suggestion:.*\(AI 86% confidence\)$/)).toBeTruthy();
  });
});
