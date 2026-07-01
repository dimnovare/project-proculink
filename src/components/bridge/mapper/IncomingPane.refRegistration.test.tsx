// Regression guard for the 2-column mapper's wire-anchor collision (2026-06-14).
//
// BUG: IncomingRow registers two DOM nodes under the same id — the row <div> via anchorRef and
// the right-edge drag PORT <span> via portProps(id).ref. MapperWorkbench USED to route BOTH into
// the single `sourceEls` map that MapperWireLayer.measure() reads. React resolves the child port
// ref before the parent row ref, so the row clobbered the port → wires anchored at the full-width
// row edge instead of the 22px grip. FIX: MapperWorkbench routes anchorRef into a SEPARATE
// `sourceRowEls` map, leaving the engine-measured `sourceEls` holding the PORT.
//
// These tests pin the structural contract IncomingPane must keep for that split to hold.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { IncomingPane } from "./IncomingPane";
import type { MapperSourcePortProps } from "./MapperWireLayer";
import type { SourceField } from "./types";

afterEach(cleanup);

const noop = () => {};

// Mirror wire.sourcePortProps: every prop the IncomingRow spreads onto the grip, plus a ref that
// records the PORT element into the given map (exactly how MapperWireLayer feeds `sourceEls`).
function makePortProps(into: Record<string, HTMLElement | null>) {
  return (id: string): MapperSourcePortProps => ({
    ref: (el) => { into[id] = el; },
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
}

const FIELDS: SourceField[] = [
  { id: "PoNumber", label: "PO Number", value: "DEMO-2026-001", group: "header", mapped: false },
];

describe("IncomingPane wire-anchor ref registration", () => {
  it("puts the right-edge PORT in the wire-engine map and the ROW in a separate map", () => {
    // Post-fix routing: portProps.ref → sourceEls (engine-measured); anchorRef → sourceRowEls.
    const sourceEls: Record<string, HTMLElement | null> = {};
    const sourceRowEls: Record<string, HTMLElement | null> = {};

    render(
      <IncomingPane
        fields={FIELDS}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        portProps={makePortProps(sourceEls)}
        anchorRef={(id, el) => { sourceRowEls[id] = el; }}
      />,
    );

    const portEl = sourceEls["PoNumber"];
    const rowEl = sourceRowEls["PoNumber"];

    expect(portEl).toBeTruthy();
    expect(rowEl).toBeTruthy();
    expect(portEl).not.toBe(rowEl);

    // The element the engine measures is the blue-circle port — NOT the full-width row.
    expect(portEl!).toHaveClass("mapper-port");
    expect(rowEl!).toHaveClass("mapper-row");
    expect(rowEl!).toHaveAttribute("data-mapper-row");

    // The grip is nested inside the row, which is exactly why a shared map mis-resolves.
    expect(rowEl!.contains(portEl!)).toBe(true);
  });

  it("demonstrates the original bug: one shared map lets the row clobber the port", () => {
    // Route BOTH refs into ONE record (the pre-fix MapperWorkbench wiring). The child port ref
    // resolves first, then the parent row ref overwrites it — so the row wins.
    const shared: Record<string, HTMLElement | null> = {};

    render(
      <IncomingPane
        fields={FIELDS}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        portProps={makePortProps(shared)}
        anchorRef={(id, el) => { shared[id] = el; }}
      />,
    );

    // Bug signature the engine would have measured: the row, not the grip.
    expect(shared["PoNumber"]).toHaveClass("mapper-row");
    expect(shared["PoNumber"]).not.toHaveClass("mapper-grip");
  });
});
