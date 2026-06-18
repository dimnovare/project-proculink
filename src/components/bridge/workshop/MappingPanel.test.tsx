import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MappingPanel, type WorkshopMappingRow, type SourceOption } from "./MappingPanel";

// Mock the composed drag surface — MapperWorkbench pulls TanStack Query +
// next/navigation; this test isolates MappingPanel's OWN behavior. The mock just
// proves MappingPanel mounts the engine (composition, not reimplementation).
vi.mock("../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: { orderId?: string }) => (
    <div data-testid="mock-mapper-workbench" data-order-id={props.orderId} />
  ),
}));

afterEach(cleanup);

const SOURCES: SourceOption[] = [
  { id: "PoNumber", label: "PO Number" },
  { id: "raw:b2", label: "Cell B2" },
];

const ROWS: WorkshopMappingRow[] = [
  { outputField: "orderNumber", label: "Order number", source: "PoNumber", confidence: 0.99, accepted: true },
  { outputField: "itemCode", label: "Item code", source: "WIDGET-B", confidence: 0.6, accepted: false, provenance: "catalog near-match" },
  { outputField: "currency", label: "Currency", source: null, confidence: 0, accepted: false },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof MappingPanel>> = {}) {
  const props: React.ComponentProps<typeof MappingPanel> = {
    suggestions: ROWS,
    sourceOptions: SOURCES,
    calibration: { trustedThreshold: 0.85 },
    onAccept: vi.fn(),
    onChangeSource: vi.fn(),
    onAddField: vi.fn(),
    order: null,
    orderId: "ord-1",
    ...overrides,
  };
  return { props, ...render(<MappingPanel {...props} />) };
}

describe("MappingPanel", () => {
  test("collapses the AI-mapped rows behind an 'N mapped by AI' toggle, expandable", () => {
    renderPanel();
    const toggle = screen.getByTestId("auto-toggle");
    expect(toggle).toHaveTextContent("1 mapped by AI");
    // collapsed by default — auto rows hidden
    expect(screen.queryAllByTestId("auto-row")).toHaveLength(0);
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("auto-row")).toHaveLength(1);
    expect(screen.getByText("Order number")).toBeInTheDocument();
  });

  test("shows only the attention rows by default (unmapped + low-confidence)", () => {
    renderPanel();
    const rows = screen.getAllByTestId("attention-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Item code")).toBeInTheDocument();
    expect(screen.getByText("Currency")).toBeInTheDocument();
  });

  test("each attention row has a drag handle (the manual escape) + AI provenance", () => {
    renderPanel();
    expect(screen.getAllByTestId("drag-handle").length).toBe(2);
    expect(screen.getByText("catalog near-match")).toBeInTheDocument();
  });

  test("Accept on an attention row calls onAccept with that row", () => {
    const { props } = renderPanel();
    const itemRow = screen.getByText("Item code").closest("li")!;
    fireEvent.click(within(itemRow).getByRole("button", { name: "Accept" }));
    expect(props.onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ outputField: "itemCode" }),
    );
  });

  test("the change-source <select> calls onChangeSource(outputField, sourceId)", () => {
    const { props } = renderPanel();
    const curRow = screen.getByText("Currency").closest("li")!;
    const select = within(curRow).getByRole("combobox");
    fireEvent.change(select, { target: { value: "raw:b2" } });
    expect(props.onChangeSource).toHaveBeenCalledWith("currency", "raw:b2");
  });

  test("Accept is disabled when there is no suggestion to commit", () => {
    renderPanel();
    const curRow = screen.getByText("Currency").closest("li")!;
    expect(within(curRow).getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  test("'+ Add output field' calls onAddField", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByTestId("add-output-field"));
    expect(props.onAddField).toHaveBeenCalledTimes(1);
  });

  test("AI confidence chip uses the AI violet class (suggestions only)", () => {
    renderPanel();
    const chip = screen.getAllByTestId("ai-confidence")[0];
    expect(chip).toHaveClass("workshop-ai-chip");
    expect(chip).toHaveTextContent("60%");
  });

  test("composes the real MapperWorkbench drag surface (not a reimplemented wire layer)", () => {
    renderPanel({ orderId: "ord-42" });
    const engine = screen.getByTestId("mock-mapper-workbench");
    expect(engine).toHaveAttribute("data-order-id", "ord-42");
    expect(screen.getByTestId("mapper-drag-surface")).toContainElement(engine);
  });
});
