// Reduced motion on the marketing hero.
//
// The audit's finding was narrow and precise: in-app reduced-motion handling is
// CORRECT, only marketing is wrong. That is because the in-app fix solves the
// hard case — SVG SMIL. `globals.css` neutralises CSS `animation-duration` under
// `prefers-reduced-motion: reduce`, but `<animate>` / `<animateMotion>` are not
// CSS and no media query can stop them. WireTopology already handled that by
// reading the media query in JS and NOT RENDERING the SMIL element; the hero
// could not reuse that because the hook was file-private, so it shipped eight
// `repeatCount="indefinite"` animations with nothing guarding them.
//
// So these tests assert the SMIL ELEMENT COUNT, not a CSS property. Asserting a
// class or an `animation: none` rule would pass while the hero kept animating —
// that is exactly the mistake that produced the defect.

import { render } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { BridgeIllustration } from "./BridgeIllustration";

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Every SMIL animation element in the tree. CSS cannot stop any of these. */
function smilCount(root: HTMLElement): number {
  return root.querySelectorAll("animate, animateMotion, animateTransform, set").length;
}

afterEach(() => setReducedMotion(false));

describe("BridgeIllustration — the marketing hero", () => {
  it("animates by default (no reduced-motion preference)", () => {
    setReducedMotion(false);
    const { container } = render(<BridgeIllustration />);
    // Four wires × (one animateMotion + one opacity animate).
    expect(smilCount(container)).toBe(8);
  });

  it("renders ZERO SMIL animations under prefers-reduced-motion: reduce", () => {
    setReducedMotion(true);
    const { container } = render(<BridgeIllustration />);
    expect(
      smilCount(container),
      "The hero must not emit <animateMotion>/<animate> under reduce. A CSS " +
        "@media rule cannot stop SMIL — the elements have to not exist.",
    ).toBe(0);
  });

  it("still draws the wires themselves under reduce — only the motion goes", () => {
    setReducedMotion(true);
    const { container } = render(<BridgeIllustration />);
    // The four wire paths carry ids wpath-0..3; losing them would mean the guard
    // removed the illustration rather than its animation.
    expect(container.querySelectorAll('path[id^="wpath-"]').length).toBe(4);
  });
});
