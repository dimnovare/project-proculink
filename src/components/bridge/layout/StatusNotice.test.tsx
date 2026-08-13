// StatusNotice — the guard for "a failure never renders in the success tone".
//
// The defect this component replaces was not a wrong colour constant; it was a
// caller free to pick any colour and any ARIA for any outcome. So the assertions
// below are about the MAPPING being closed, not about one banner looking right:
// every tone is walked from the exported palette rather than typed out here, and
// each walk carries a floor so an empty or shrunken set fails instead of passing
// vacuously. `all()` over an empty list is true, and that has silently disarmed
// checks in this repo before.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { StatusNotice, noticeAria, TONE_PALETTE, type NoticeTone } from "./StatusNotice";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALL_TONES: readonly NoticeTone[] = ["success", "error", "working"];

/** Every tone that must never be announced politely or painted green. */
const FAILURE_TONES: readonly NoticeTone[] = ["error"];

describe("StatusNotice — announcement semantics are derived, not passed", () => {
  it("walks every tone the component supports", () => {
    // Anti-vacuity floor. If a tone is added to NoticeTone and not to this
    // array, the coverage assertions below would silently stop covering it.
    expect(ALL_TONES.length).toBe(3);
    expect(new Set(ALL_TONES).size).toBe(ALL_TONES.length);
  });

  it("announces a failure assertively and everything else politely", () => {
    let checked = 0;
    for (const tone of ALL_TONES) {
      const aria = noticeAria(tone);
      if (tone === "error") {
        expect(aria.role).toBe("alert");
        // role="alert" already implies an assertive live region. Setting
        // aria-live as well is a double announcement.
        expect(aria["aria-live"]).toBeUndefined();
      } else {
        expect(aria.role).toBe("status");
        expect(aria["aria-live"]).toBe("polite");
      }
      checked += 1;
    }
    expect(checked).toBe(ALL_TONES.length);
  });

  it("renders the derived role on the element itself", () => {
    let checked = 0;
    for (const tone of ALL_TONES) {
      const { unmount } = render(<StatusNotice tone={tone}>Outcome for {tone}</StatusNotice>);
      const expectedRole = tone === "error" ? "alert" : "status";
      const el = screen.getByRole(expectedRole);
      expect(el).toHaveTextContent(`Outcome for ${tone}`);
      expect(el.getAttribute("data-notice-tone")).toBe(tone);
      checked += 1;
      unmount();
    }
    expect(checked).toBe(ALL_TONES.length);
  });
});

describe("StatusNotice — a failure never wears the success palette", () => {
  // Read from the exported table, NOT from the rendered element. jsdom does not
  // resolve `var()` inside a `background` shorthand, so `el.style.background` is
  // "" for every tone — a "these differ" assertion over the DOM would compare two
  // empty strings and pass forever, which is precisely the vacuous-check failure
  // this repo keeps meeting. The DOM's job is asserted separately, above: that the
  // element carries the tone it was given.

  it("covers every tone in the palette table", () => {
    // Floor: the table must actually have the members the loops below walk.
    expect(Object.keys(TONE_PALETTE).sort()).toEqual([...ALL_TONES].sort());
    for (const tone of ALL_TONES) {
      expect(TONE_PALETTE[tone].bg).toMatch(/^var\(--/);
      expect(TONE_PALETTE[tone].fg).toMatch(/^var\(--/);
      expect(TONE_PALETTE[tone].border).toMatch(/^var\(--/);
    }
  });

  it("shares no colour between a failure and a success, in any slot", () => {
    expect(FAILURE_TONES.length).toBeGreaterThan(0);
    const success = TONE_PALETTE.success;

    let compared = 0;
    for (const tone of FAILURE_TONES) {
      const failure = TONE_PALETTE[tone];
      expect(failure.bg).not.toBe(success.bg);
      expect(failure.fg).not.toBe(success.fg);
      expect(failure.border).not.toBe(success.border);
      compared += 1;
    }
    expect(compared).toBe(FAILURE_TONES.length);
  });

  it("gives the in-progress tone its own colour, not the success one", () => {
    // "Trying to send it again" must not read as "it was sent". This is the
    // reason `working` exists as a third tone rather than reusing success.
    expect(TONE_PALETTE.working.bg).not.toBe(TONE_PALETTE.success.bg);
    expect(TONE_PALETTE.working.fg).not.toBe(TONE_PALETTE.success.fg);
  });

  it("uses no fractional opacity anywhere in the component", () => {
    // Fractional opacity composites text WITH its background rather than fading
    // one against the other, and collapsed an 11:1 ratio to 2.66:1 elsewhere in
    // this codebase.
    //
    // Asserted against the SOURCE, not the DOM, and that is forced rather than
    // lazy: jsdom's CSS parser discards any declaration whose value contains
    // `var()`, so a rendered notice's style attribute carries no background, no
    // border and no colour at all. A DOM-based "has no opacity" check would be
    // true of a string that also has no colours in it — vacuous in exactly the
    // way this file is trying not to be.
    const source = readFileSync(
      path.join(__dirname, "StatusNotice.tsx"),
      "utf8",
    );
    // Floor: prove the file really was read and really is the component, before
    // asserting anything about what it does NOT contain.
    expect(source).toContain("export function StatusNotice");
    expect(source).toContain("TONE_PALETTE");
    expect(source).not.toMatch(/opacity\s*:/);
  });
});

describe("StatusNotice — content", () => {
  it("renders a trailing action beside the message", () => {
    render(
      <StatusNotice tone="error" action={<button type="button">Try again</button>}>
        We couldn&apos;t resolve that issue.
      </StatusNotice>,
    );
    const el = screen.getByRole("alert");
    expect(el).toHaveTextContent("We couldn't resolve that issue.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
