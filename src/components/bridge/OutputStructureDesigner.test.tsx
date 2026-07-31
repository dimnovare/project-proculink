// OutputStructureDesigner — T8 namespace authoring RTL tests.
//
// Proves the designer (1) lets the user author a per-node XML namespace + prefix on an element node,
// and a root prefix→uri namespace, and (2) SAVES them in the OutputTree the backend PUT receives
// (node.namespace / node.prefix / template.namespaces). Also pins the data-loss guarantee end to end:
// loading an inferred namespaced tree, editing an unrelated node, and saving preserves all namespaces.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderMappingOverride, OutputNode, OutputNodeTemplate } from "@/lib/api/types";

// Capture what the designer saves. previewMappingOverride is a harmless no-op (the live preview).
const upsertMappingOverride = vi.fn<(id: string, o: OrderMappingOverride) => Promise<OrderMappingOverride>>(
  (_id, o) => Promise.resolve(o),
);
vi.mock("@/lib/api-client", () => ({
  upsertMappingOverride: (id: string, o: OrderMappingOverride) => upsertMappingOverride(id, o),
  previewMappingOverride: vi.fn().mockResolvedValue({ format: "xml", content: "<Order/>" }),
  inferOutputStructure: vi.fn(),
  getSourceTokens: vi.fn().mockResolvedValue([]),
}));

import { OutputStructureDesigner } from "./OutputStructureDesigner";

afterEach(cleanup);
beforeEach(() => upsertMappingOverride.mockClear());

const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const ORDER2 = "urn:oasis:names:specification:ubl:schema:xsd:Order-2";

function renderDesigner(initialTree: OutputNodeTemplate, onClose: () => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OutputStructureDesigner orderId="o-1" baseOverride={{ customFields: [] }} initialTree={initialTree} onClose={onClose} />
    </QueryClientProvider>,
  );
}

/** The last OutputTree the designer tried to save. */
function savedTree(): OutputNodeTemplate {
  expect(upsertMappingOverride).toHaveBeenCalled();
  const override = upsertMappingOverride.mock.calls.at(-1)![1];
  return override.outputTree!;
}

// A simple XML tree with no namespaces yet — the authoring entry point.
function plainXmlTree(): OutputNodeTemplate {
  return {
    format: "xml",
    root: { name: "Order", nodeType: "object", children: [
      { name: "ID", nodeType: "field", rule: { outputPath: "ID", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
    ] },
  };
}

describe("OutputStructureDesigner — per-node namespace authoring (XML)", () => {
  it("authoring a prefix + namespace URI on a node saves node.namespace + node.prefix", () => {
    renderDesigner(plainXmlTree());

    // Both the root <Order> and the <ID> element offer "+ namespace"; target the ID field row.
    // P-1: namespace authoring now lives behind the per-node "Advanced" disclosure (collapsed by
    // default on a fresh node), so open Advanced on the ID row before reaching for "+ namespace".
    const idRow = screen.getByRole("button", { name: /Edit name \(ID\)/i }).closest("div")!;
    fireEvent.click(within(idRow).getByRole("button", { name: /Show advanced options/i }));
    fireEvent.click(within(idRow).getByRole("button", { name: /Put this element in an XML namespace/i }));

    fireEvent.change(screen.getByLabelText("XML namespace prefix"), { target: { value: "cbc" } });
    fireEvent.change(screen.getByLabelText("XML namespace URI"), { target: { value: CBC } });

    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const tree = savedTree();
    const id = tree.root.children!.find((c: OutputNode) => c.name === "ID")!;
    expect(id.prefix).toBe("cbc");
    expect(id.namespace).toBe(CBC);
  });
});

describe("OutputStructureDesigner — root namespaces editor (XML)", () => {
  it("adding a prefix→uri row saves it in template.namespaces", () => {
    renderDesigner(plainXmlTree());

    // Expand the XML-namespaces section and add a row.
    fireEvent.click(screen.getByRole("button", { name: /XML namespaces/i }));
    fireEvent.click(screen.getByRole("button", { name: /^\+ namespace$/i }));

    fireEvent.change(screen.getByLabelText("Namespace prefix 1"), { target: { value: "cbc" } });
    fireEvent.change(screen.getByLabelText("Namespace URI 1"), { target: { value: CBC } });

    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().namespaces).toEqual({ cbc: CBC });
  });
});

describe("OutputStructureDesigner — inferred-tree round-trip (no namespace loss)", () => {
  // A namespaced tree as if just inferred from a UBL sample: root default ns + cbc:/cac: prefixes.
  function inferredUblTree(): OutputNodeTemplate {
    return {
      format: "xml",
      root: { name: "Order", nodeType: "object", namespace: ORDER2, prefix: null, children: [
        { name: "ID", nodeType: "field", namespace: CBC, prefix: "cbc",
          rule: { outputPath: "ID", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
      ] },
    };
  }

  it("editing an UNRELATED node (rename) and saving preserves every node's namespace", () => {
    renderDesigner(inferredUblTree());

    // Per-node mode is active, so the root-map editor is hidden — confirm we never lose the per-node ns.
    // Rename the ID node (click its name button, type a new name).
    fireEvent.click(screen.getByRole("button", { name: /Edit name \(ID\)/i }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "OrderNumber" } });

    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const tree = savedTree();
    // Root default namespace survives.
    expect(tree.root.namespace).toBe(ORDER2);
    // The renamed node keeps its cbc: namespace + prefix.
    const renamed = tree.root.children!.find((c: OutputNode) => c.name === "OrderNumber")!;
    expect(renamed.namespace).toBe(CBC);
    expect(renamed.prefix).toBe("cbc");
  });

  it("does NOT show the root-namespaces editor while the tree uses per-node namespaces", () => {
    renderDesigner(inferredUblTree());
    expect(screen.queryByRole("button", { name: /XML namespaces/i })).toBeNull();
  });
});

describe("OutputStructureDesigner — guarded close (unsaved-edit footgun)", () => {
  // Both the header X and the footer Cancel discard in-modal edits, so each must confirm before
  // closing WHEN THE USER HAS ACTUALLY EDITED. A freshly-opened, UNEDITED designer closes with no
  // prompt (the `dirty` flag only flips true on a real edit — not merely because nothing is saved yet).
  afterEach(() => vi.restoreAllMocks());

  // Make one real edit (rename a node), which sets the designer dirty.
  function editTree() {
    fireEvent.click(screen.getByRole("button", { name: /Edit name \(ID\)/i }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Changed" } });
  }

  it("a freshly-opened, UNEDITED designer closes via X with NO confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);

    fireEvent.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X (Close) confirms after an edit, and only closes when confirmed", async () => {
    // The designer now routes through the shared useConfirm() dialog; with no
    // ConfirmProvider in this isolated render it falls back to window.confirm
    // (joining title + body with a blank line), so the existing spy still works.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(confirm).toHaveBeenCalledWith(
      "Discard unsaved changes?\n\nYou have unsaved changes to this output structure. Discard them?",
    );
    // requestClose is async now — onClose fires after the confirm promise resolves.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("X (Close) keeps the modal open when the user cancels the confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel confirms after an edit, and only closes when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(confirm).toHaveBeenCalledWith(
      "Discard unsaved changes?\n\nYou have unsaved changes to this output structure. Discard them?",
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel keeps the modal open when the user cancels the confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · S1 — the designer must not destroy rule fields it does not name.
//
// The pure writers are pinned in outputRuleModel.test.ts. THIS file pins that the
// designer actually CALLS them: a model with the right behaviour and no caller is
// the exact shape of the defect WP-13 existed to fix, and a mutation that reverted
// this component to its inline five-key literal left the model's own tests green.
// ─────────────────────────────────────────────────────────────────────────────
describe("OutputStructureDesigner — an authored Expression survives an edit", () => {
  /** A node bound by canonical field, carrying BOTH an expression and a format preset. */
  function treeWithExpression(): OutputNodeTemplate {
    return {
      format: "xml",
      root: { name: "Order", nodeType: "object", children: [
        { name: "Total", nodeType: "field", rule: {
          outputPath: "Total",
          canonicalField: "GrandTotal",
          fixedValue: null,
          expression: "line.Quantity * line.UnitPrice",
          // Matches FORMAT_PRESETS "num-us", so the format pill renders and is clickable.
          fieldManipulators: [{ type: "NumberFormat", params: ["N2"] }],
        } },
      ] },
    };
  }

  it("changing the value format keeps the expression the template editor wrote", () => {
    renderDesigner(treeWithExpression());

    fireEvent.click(screen.getByTitle("Click to change formatting"));
    fireEvent.change(screen.getByLabelText("Value format"), { target: { value: "date-eu" } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const total = savedTree().root.children!.find((c: OutputNode) => c.name === "Total")!;
    expect(total.rule!.expression).toBe("line.Quantity * line.UnitPrice");
    expect(total.rule!.fieldManipulators).toEqual([{ type: "DateFormat", params: ["yyyy-MM-dd", "dd/MM/yyyy"] }]);
  });

  it("REBINDING the node keeps the expression (the setBinding path)", () => {
    renderDesigner(treeWithExpression());

    // Clearing the source runs setBinding("canonicalField", null) — the writer whose
    // inline five-key literal was the original data-loss bug.
    fireEvent.click(screen.getByRole("button", { name: /Clear the source for Total/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const total = savedTree().root.children!.find((c: OutputNode) => c.name === "Total")!;
    expect(total.rule!.expression).toBe("line.Quantity * line.UnitPrice");
    expect(total.rule!.canonicalField).toBeNull();
  });

  it("clearing the value format keeps it too", () => {
    renderDesigner(treeWithExpression());

    fireEvent.click(screen.getByRole("button", { name: /Remove formatting/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const total = savedTree().root.children!.find((c: OutputNode) => c.name === "Total")!;
    expect(total.rule!.expression).toBe("line.Quantity * line.UnitPrice");
    expect(total.rule!.fieldManipulators).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · S5 — reorder from the UI.
//
// `moveAt` is pinned in outputNamespaceModel.test.ts. This file pins that the
// designer REACHES it — pointer and keyboard — and that every press says what
// happened. A reorder control that moves a row silently is unusable without
// sight of the tree, and the boundary press is the one most likely to be met
// with silence and read as "broken".
// ─────────────────────────────────────────────────────────────────────────────
describe("OutputStructureDesigner — reordering nodes", () => {
  function threeFieldTree(): OutputNodeTemplate {
    return {
      format: "csv",
      root: { name: "Order", nodeType: "object", children: [
        { name: "Sku", nodeType: "field", namespace: "urn:cbc", prefix: "cbc",
          rule: { outputPath: "Sku", canonicalField: "SupplierItemCode", fixedValue: null, fieldManipulators: [] } },
        { name: "Qty", nodeType: "field", rule: { outputPath: "Qty", canonicalField: "Quantity", fixedValue: null, fieldManipulators: [] } },
        { name: "Price", nodeType: "field", rule: { outputPath: "Price", canonicalField: "UnitPrice", fixedValue: null, fieldManipulators: [] } },
      ] },
    };
  }

  const savedNames = () => savedTree().root.children!.map((c: OutputNode) => c.name);

  it("the down control reorders the node and the SAVE carries the new order", () => {
    renderDesigner(threeFieldTree());

    fireEvent.click(screen.getByRole("button", { name: /Move Sku down/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Qty", "Sku", "Price"]);
  });

  it("the up control reorders the other way", () => {
    renderDesigner(threeFieldTree());

    fireEvent.click(screen.getByRole("button", { name: /Move Price up/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Sku", "Price", "Qty"]);
  });

  it("Alt+ArrowDown moves the row from the keyboard", () => {
    renderDesigner(threeFieldTree());

    fireEvent.keyDown(screen.getByRole("button", { name: /Move Sku down/i }), { key: "ArrowDown", altKey: true });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Qty", "Sku", "Price"]);
  });

  it("Alt+ArrowUp moves the row from the keyboard", () => {
    renderDesigner(threeFieldTree());

    fireEvent.keyDown(screen.getByRole("button", { name: /Move Price up/i }), { key: "ArrowUp", altKey: true });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Sku", "Price", "Qty"]);
  });

  it("a plain ArrowDown does NOT move the row — Alt is the modifier", () => {
    renderDesigner(threeFieldTree());

    fireEvent.keyDown(screen.getByRole("button", { name: /Move Sku down/i }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Sku", "Qty", "Price"]);
  });

  it("announces the new position, so a move is never silent", () => {
    renderDesigner(threeFieldTree());

    fireEvent.click(screen.getByRole("button", { name: /Move Sku down/i }));

    const live = screen.getByTestId("designer-announcer");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Sku moved to position 2 of 3");
  });

  it("a BOUNDARY press says why nothing moved rather than saying nothing", () => {
    renderDesigner(threeFieldTree());

    // The press most likely to be read as "the control is broken".
    fireEvent.keyDown(screen.getByRole("button", { name: /Move Sku up/i }), { key: "ArrowUp", altKey: true });

    expect(screen.getByTestId("designer-announcer").textContent).toContain("Sku is already first");

    // …and nothing moved, which is the other half of "the control is not broken".
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));
    expect(savedNames()).toEqual(["Sku", "Qty", "Price"]);
  });

  it("the boundary controls are disabled at each end", () => {
    renderDesigner(threeFieldTree());

    expect(screen.getByRole("button", { name: /Move Sku up/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Move Price down/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Move Sku down/i })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /Move Price up/i })).toHaveProperty("disabled", false);
  });

  it("the root has no move controls — it has no siblings", () => {
    renderDesigner(threeFieldTree());
    expect(screen.queryByRole("button", { name: /Move Order up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move Order down/i })).toBeNull();
  });

  it("a reordered node keeps its namespace all the way into the saved tree", () => {
    renderDesigner(threeFieldTree());

    fireEvent.click(screen.getByRole("button", { name: /Move Sku down/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const sku = savedTree().root.children!.find((c: OutputNode) => c.name === "Sku")!;
    expect(sku.namespace).toBe("urn:cbc");
    expect(sku.prefix).toBe("cbc");
    expect(sku.rule!.canonicalField).toBe("SupplierItemCode");
  });
});
