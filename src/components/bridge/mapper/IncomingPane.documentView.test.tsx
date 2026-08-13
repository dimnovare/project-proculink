import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { IncomingPane, type IncomingPaneProps } from "./IncomingPane";
import type { MapperSourcePortProps } from "./MapperWireLayer";
import type { SourceField } from "./types";

afterEach(cleanup);

const noop = () => {};

/** Mirrors wire.sourcePortProps — the row spreads these onto its drag grip. */
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

// The received column's two bodies.
//
// The document is what the operator is actually checking — the field list is DERIVED from it,
// so a screen showing only the field list is showing the same information once, unchecked. This
// pins the three things that have to stay true:
//
//   1. With a document, the column shows it by default.
//   2. With no document, the column shows the field list it has always had, PLUS one sentence
//      saying why the paper is not next to it. Never an empty pane, never an error surface.
//   3. The field list is always one tap away, because those rows are the drag-source for the
//      connector wires.

const FIELDS: SourceField[] = [
  { id: "PoNumber", label: "PO number", value: "PO-2026-0142", group: "header", mapped: false },
  { id: "Line1Code", label: "Item code", value: "ACM-BLT-M8", group: "line", mapped: false },
];

function setup(overrides: Partial<IncomingPaneProps> = {}) {
  const onView = vi.fn();
  const props: IncomingPaneProps = {
    fields: FIELDS,
    query: "",
    onQuery: vi.fn(),
    filter: "all",
    onFilter: vi.fn(),
    portProps,
    hasIncomingSource: true,
    view: "document",
    onView,
    documentAvailable: true,
    documentSlot: <div data-testid="doc-body">the rendered document</div>,
    ...overrides,
  };
  render(<IncomingPane {...props} />);
  return { onView };
}

describe("the received column defaults to the document", () => {
  it("renders the document, titled as the file rather than as extracted values", () => {
    setup();
    expect(screen.getByTestId("doc-body")).toBeInTheDocument();
    expect(screen.getByText("Original document")).toBeInTheDocument();
    expect(screen.queryByText("What we received")).not.toBeInTheDocument();
  });

  it("shows the format tag the caller derived from the served content type", () => {
    setup({ sourceType: "PDF" });
    expect(screen.getByTitle("Received as PDF")).toBeInTheDocument();
  });

  it("keeps the field list one tap away — those rows are the drag-source for wiring", () => {
    const { onView } = setup();
    fireEvent.click(screen.getByTestId("incoming-view-fields"));
    expect(onView).toHaveBeenCalledWith("fields");
  });
});

describe("with no document the column is the pane that already existed, plus a reason", () => {
  it("falls back to the field list rather than rendering an empty pane", () => {
    setup({
      documentAvailable: false,
      documentSlot: null,
      documentNotice: "No original document is stored for this order, so there is nothing to display.",
    });
    expect(screen.queryByTestId("doc-body")).not.toBeInTheDocument();
    expect(screen.getByText("What we received")).toBeInTheDocument();
    expect(screen.getByText("PO number")).toBeInTheDocument();
    expect(screen.getByText("Item code")).toBeInTheDocument();
  });

  it("states why, in one plain sentence above the fields", () => {
    const notice = "This file has been removed under your organisation's data-retention policy.";
    setup({ documentAvailable: false, documentSlot: null, documentNotice: notice });
    expect(screen.getByTestId("incoming-document-notice")).toHaveTextContent(notice);
  });

  it("the Document tab is disabled and says why, instead of vanishing", () => {
    // A control that disappears reads as "this screen has no document view". A disabled one
    // with a reason reads as "this order has no document", which is what is actually true.
    const { onView } = setup({ documentAvailable: false, documentSlot: null });
    const tab = screen.getByTestId("incoming-view-document");
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute("title", "No document is stored for this order");
    fireEvent.click(tab);
    expect(onView).not.toHaveBeenCalled();
  });

  it("shows no notice while the answer is still unknown", () => {
    setup({ documentAvailable: false, documentSlot: null, documentNotice: null });
    expect(screen.queryByTestId("incoming-document-notice")).not.toBeInTheDocument();
  });

  it("the empty-field-list copy still reads off the real flag, not a stringly one", () => {
    // `hasIncomingSource` replaced `sourceFileKey`, which was set to the ORDER ID and used
    // purely for truthiness. Both branches must still be reachable.
    setup({ fields: [], hasIncomingSource: false, documentAvailable: false, documentSlot: null });
    expect(screen.getByText(/arrived already-structured/)).toBeInTheDocument();
  });
});

describe("callers with nothing to offer are unchanged", () => {
  it("no onView means no toggle at all", () => {
    setup({ view: "fields", onView: undefined, documentAvailable: false, documentSlot: null });
    expect(screen.queryByTestId("incoming-view-document")).not.toBeInTheDocument();
    expect(screen.queryByTestId("incoming-view-fields")).not.toBeInTheDocument();
    expect(screen.getByText("What we received")).toBeInTheDocument();
  });
});
