import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReceivedZone } from "./ReceivedZone";
import type { SourceField } from "../mapper/types";

afterEach(cleanup);

const sf = (over: Partial<SourceField> & { id: string }): SourceField => ({
  label: over.id,
  value: "",
  group: "header",
  mapped: false,
  ...over,
});

// A lossless set spanning all four groups, with raw extras that a canonical-only
// view would drop — the invariant under test (#4: every source field appears).
const FIELDS: SourceField[] = [
  sf({ id: "cell:r1c1", label: "PO Number", value: "PO-1", group: "header" }),
  sf({ id: "cell:r1c2", label: "Order Date", value: "2026-06-18", group: "header" }),
  sf({ id: "cell:r2c1", label: "Ship-to", value: "Acme OÜ", group: "parties" }),
  sf({ id: "cell:r3c1", label: "Item", value: "BOLT-1", group: "line" }),
  sf({ id: "cell:r3c9", label: "Vendor Ref", value: "VR-9", group: "raw" }),
  sf({ id: "cell:r3c10", label: "Internal Note", value: "rush", group: "raw" }),
];

describe("ReceivedZone", () => {
  test("renders a row for EVERY received field (lossless, no dedup-drop)", () => {
    render(<ReceivedZone fields={FIELDS} />);
    // Raw extras is collapsed by default — expand it so all rows are visible.
    fireEvent.click(screen.getByRole("button", { name: /Raw extras/i }));
    expect(screen.getAllByTestId("received-row")).toHaveLength(FIELDS.length);
    expect(screen.getByText("Vendor Ref")).toBeInTheDocument();
    expect(screen.getByText("Internal Note")).toBeInTheDocument();
  });

  test("groups into Header / Parties / Line items / Raw extras", () => {
    render(<ReceivedZone fields={FIELDS} />);
    expect(screen.getByTestId("received-group-header")).toBeInTheDocument();
    expect(screen.getByTestId("received-group-parties")).toBeInTheDocument();
    expect(screen.getByTestId("received-group-line")).toBeInTheDocument();
    expect(screen.getByTestId("received-group-raw")).toBeInTheDocument();
  });

  test("each row shows value + a source pointer + a drag handle", () => {
    render(<ReceivedZone fields={[FIELDS[0]]} />);
    expect(screen.getByText("PO-1")).toBeInTheDocument();
    expect(screen.getByTestId("source-pointer")).toHaveTextContent("cell:r1c1");
    expect(screen.getByTestId("received-drag-handle")).toBeInTheDocument();
  });

  test("formatPointer can humanize the source pointer", () => {
    render(<ReceivedZone fields={[FIELDS[0]]} formatPointer={() => "Cell A1"} />);
    expect(screen.getByTestId("source-pointer")).toHaveTextContent("Cell A1");
  });

  test("each row carries its stable anchor id (the wire anchor)", () => {
    render(<ReceivedZone fields={[FIELDS[0]]} />);
    expect(screen.getByTestId("received-row")).toHaveAttribute("data-anchor-id", "cell:r1c1");
  });

  test("honest empty only when truly source-less", () => {
    render(<ReceivedZone fields={[]} />);
    expect(screen.queryAllByTestId("received-row")).toHaveLength(0);
    expect(screen.getByText(/No received fields captured/i)).toBeInTheDocument();
  });

  test("collapsed → renders a rail with an expand affordance", () => {
    const onExpand = vi.fn();
    render(<ReceivedZone fields={FIELDS} collapsed onExpand={onExpand} />);
    expect(screen.queryByTestId("received-zone")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("received-zone-rail"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  test("the collapse chevron calls onCollapse", () => {
    const onCollapse = vi.fn();
    render(<ReceivedZone fields={FIELDS} onCollapse={onCollapse} />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse received fields/i }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
