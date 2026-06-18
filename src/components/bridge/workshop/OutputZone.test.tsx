import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OutputZone, type OutputFormatOption } from "./OutputZone";
import type { Order } from "@/types/procurement";

// Mock the composed children — both pull api-client. This test isolates
// OutputZone's OWN shell (format switch, send gating, structure toggle); the
// preview==delivery behavior is covered by OutputPreview's own suite.
vi.mock("../review/OutputPreview", () => ({
  OutputPreview: (props: { orderId: string }) => (
    <div data-testid="mock-output-preview" data-order-id={props.orderId} />
  ),
}));
vi.mock("../OutputStructureDesigner", () => ({
  OutputStructureDesigner: (props: { onClose: () => void }) => (
    <div data-testid="mock-structure-designer">
      <button onClick={props.onClose}>close-designer</button>
    </div>
  ),
}));

afterEach(cleanup);

const ORDER: Order = {
  id: "ord-1",
  poNumber: "PO-1",
  supplierId: "sup-1",
  supplierName: "Acme",
  orderDate: "2026-06-18",
  currency: "EUR",
  status: "ready_to_deliver",
  createdAt: "2026-06-18T00:00:00Z",
  updatedAt: "2026-06-18T00:00:00Z",
  lines: [],
  artifacts: [],
};

const FORMATS: OutputFormatOption[] = [
  { id: "json", label: "JSON" },
  { id: "csv", label: "CSV" },
];

function renderZone(overrides: Partial<React.ComponentProps<typeof OutputZone>> = {}) {
  const props: React.ComponentProps<typeof OutputZone> = {
    order: ORDER,
    orderId: "ord-1",
    crossed: false,
    fieldValues: {},
    onOutputAction: vi.fn(),
    artifacts: [],
    canSend: true,
    ...overrides,
  };
  return { props, ...render(<OutputZone {...props} />) };
}

describe("OutputZone", () => {
  test("wraps the OutputPreview (preview == delivery), passing the orderId", () => {
    renderZone({ orderId: "ord-99" });
    expect(screen.getByTestId("mock-output-preview")).toHaveAttribute("data-order-id", "ord-99");
  });

  test("the format switch calls onFormatChange with the picked format", () => {
    const onFormatChange = vi.fn();
    renderZone({ format: "json", formatOptions: FORMATS, onFormatChange });
    fireEvent.change(screen.getByRole("combobox", { name: "Output format" }), { target: { value: "csv" } });
    expect(onFormatChange).toHaveBeenCalledWith("csv");
  });

  test("'+ Edit output structure' opens the OutputStructureDesigner overlay", () => {
    renderZone();
    expect(screen.queryByTestId("mock-structure-designer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-structure"));
    expect(screen.getByTestId("mock-structure-designer")).toBeInTheDocument();
    // closing the designer removes the overlay
    fireEvent.click(screen.getByText("close-designer"));
    expect(screen.queryByTestId("mock-structure-designer")).not.toBeInTheDocument();
  });

  test("the green Send is enabled when canSend is true and calls onSend", () => {
    const onSend = vi.fn();
    renderZone({ canSend: true, onSend });
    const send = screen.getByRole("button", { name: "Send to supplier" });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("Send is disabled when canSend is false (green only when valid)", () => {
    renderZone({ canSend: false });
    expect(screen.getByRole("button", { name: "Send to supplier" })).toBeDisabled();
    expect(screen.getByText(/Resolve the issues to send/i)).toBeInTheDocument();
  });

  test("collapsed → renders a rail with an expand affordance", () => {
    const onExpand = vi.fn();
    renderZone({ collapsed: true, onExpand });
    expect(screen.queryByTestId("output-zone")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("output-zone-rail"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  test("the collapse chevron calls onCollapse", () => {
    const onCollapse = vi.fn();
    renderZone({ onCollapse });
    fireEvent.click(screen.getByRole("button", { name: /Collapse output/i }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
