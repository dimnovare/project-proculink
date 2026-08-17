/* ── The greyed Document tab must not author its own cause ────────────────────
 *
 * THE DEFECT, VERBATIM (IncomingPane.tsx):
 *
 *     title={documentAvailable ? "Show the file this order arrived as"
 *                              : "No document is stored for this order"}
 *
 * `documentAvailable` is `useSourceDocument`'s `hasDocument`, and that is false for FOUR
 * different situations, only one of which is the sentence above:
 *
 *   • 204 — no file stored.                  ← the one the copy describes
 *   • the fetch failed (network / 5xx).
 *   • 429 — the shared download budget.
 *   • the request has not answered yet.
 *
 * On the error path the surrounding screen renders `sourceUnavailableMessage`'s error arm —
 * "We couldn't load the original document just now" — at the same time, from the same hook,
 * about the same order. Two panes on one screen, one saying the file could not be loaded and
 * the other saying no file exists. An operator who reads the tab stops looking; an operator
 * who reads the notice retries. Only one of them was told the truth.
 *
 * THE DISTINCTION IS THE TEST. Same component, same `documentAvailable: false`, different
 * query state — carried by the caller's own `documentNotice`. So this file drives the notice
 * for each state and asserts the tab and the pane agree, plus the control that the
 * genuinely-absent case still reads as genuinely absent.
 *
 * jsdom applies no Tailwind, so everything below is looked up by testid on the single pane
 * this component renders, never off whole-body text.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncomingPane, type IncomingPaneProps } from "./IncomingPane";
import { sourceUnavailableMessage } from "@/lib/sourceDocument";
import type { MapperSourcePortProps } from "./MapperWireLayer";
import type { SourceField } from "./types";

afterEach(cleanup);

const noop = () => {};
const portProps = (): MapperSourcePortProps => ({
  ref: noop,
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
  onPointerCancel: noop,
  onKeyDown: noop,
  tabIndex: 0,
  role: "button",
  "aria-label": "Map this field",
  "data-wired": false,
  "data-connecting": false,
});

const FIELDS: SourceField[] = [
  { id: "PoNumber", label: "PO number", value: "PO-2026-0142", group: "header", mapped: false },
];

/** Mount the pane with no document, and the caller's reason for that. */
function mountWithout(notice: string | null) {
  const props: IncomingPaneProps = {
    fields: FIELDS,
    query: "",
    onQuery: vi.fn(),
    filter: "all",
    onFilter: vi.fn(),
    portProps,
    hasIncomingSource: true,
    view: "document",
    onView: vi.fn(),
    documentAvailable: false,
    documentSlot: null,
    documentNotice: notice,
  };
  render(<IncomingPane {...props} />);
  const tab = screen.getByTestId("incoming-view-document");
  // Floor: the tab really is the disabled one, so the title claim below is the claim
  // an operator would actually meet.
  expect(tab).toBeDisabled();
  return tab;
}

/** The two sentences the shipped model produces, read from the model itself. */
const FETCH_FAILED = sourceUnavailableMessage({ kind: "error" })!;
const GENUINELY_NONE = sourceUnavailableMessage({ kind: "none" })!;
const THROTTLED = sourceUnavailableMessage({ kind: "throttled", retryAfterSeconds: 30 })!;

describe("the disabled Document tab says what the pane says", () => {
  it("does not claim 'no document is stored' when the FETCH failed", () => {
    const tab = mountWithout(FETCH_FAILED);

    // The defect, stated as the assertion.
    expect(tab.getAttribute("title")).not.toContain("No document is stored");
    // And the two surfaces agree, because they are now the same sentence.
    expect(tab.getAttribute("title")).toBe(FETCH_FAILED);
    expect(screen.getByTestId("incoming-document-notice").textContent).toBe(FETCH_FAILED);
  });

  it("does not claim it either when the request was throttled", () => {
    const tab = mountWithout(THROTTLED);
    expect(tab.getAttribute("title")).not.toContain("No document is stored");
    expect(tab.getAttribute("title")).toBe(THROTTLED);
  });

  it("STILL says a stored file is absent when that is genuinely the case", () => {
    // ANTI-VACUITY, and the distinction that is the defect: identical props except for
    // which state the caller settled in. A fix that simply deleted the cause would pass
    // both negatives above and fail here.
    const tab = mountWithout(GENUINELY_NONE);

    expect(tab.getAttribute("title")).toBe(GENUINELY_NONE);
    expect(GENUINELY_NONE).toMatch(/no original document is stored/i);
    // The two sentences really are different, so the two assertions above are not the
    // same assertion written twice.
    expect(GENUINELY_NONE).not.toBe(FETCH_FAILED);
  });

  it("states the fact and stops when the caller gave no reason", () => {
    // The pre-answer beat: the surrounding screen suppresses the notice while the fetch is
    // open ("a notice that appears and then retracts is worse than a beat of silence"), so
    // the tab has nothing to quote — and must not fill the gap with a cause.
    const tab = mountWithout(null);

    expect(tab.getAttribute("title")).not.toContain("No document is stored");
    expect(tab.getAttribute("title")).toBeTruthy();
    expect(screen.queryByTestId("incoming-document-notice")).toBeNull();
  });

  it("keeps the plain invitation when a document IS available", () => {
    // The other anti-vacuity direction: the title is not now the notice on every branch.
    const props: IncomingPaneProps = {
      fields: FIELDS,
      query: "",
      onQuery: vi.fn(),
      filter: "all",
      onFilter: vi.fn(),
      portProps,
      hasIncomingSource: true,
      view: "document",
      onView: vi.fn(),
      documentAvailable: true,
      documentSlot: <div data-testid="doc-body">the rendered document</div>,
      documentNotice: null,
    };
    render(<IncomingPane {...props} />);

    const tab = screen.getByTestId("incoming-view-document");
    expect(tab).not.toBeDisabled();
    expect(tab.getAttribute("title")).toBe("Show the file this order arrived as");
  });
});
