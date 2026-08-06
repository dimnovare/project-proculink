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
const inferOutputStructure = vi.fn();
vi.mock("@/lib/api-client", () => ({
  upsertMappingOverride: (id: string, o: OrderMappingOverride) => upsertMappingOverride(id, o),
  previewMappingOverride: vi.fn().mockResolvedValue({ format: "xml", content: "<Order/>" }),
  inferOutputStructure: (...a: unknown[]) => inferOutputStructure(...a),
  getSourceTokens: vi.fn().mockResolvedValue([]),
  // WP-16: the designer fetches the order so it can run the two `OutputFieldValidator` checks the
  // tree path skips (non-positive quantity, negative unit price). Null keeps those tests focused on
  // namespaces and reordering — an order-less designer still validates the LAYOUT.
  apiClient: { getOrderById: vi.fn().mockResolvedValue(null) },
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

    // WP-16: the namespace section is no longer a disclosure — it is an always-visible preset
    // dropdown, and the hand-typed prefix/address rows are what "Custom…" reveals.
    fireEvent.change(screen.getByLabelText("XML namespaces"), { target: { value: "custom" } });
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

    // A real CLICK, which is what a browser can actually deliver. The first version of
    // this test used a synthetic keyDown aimed at the button — and the button was
    // `disabled`, so React never fires activation on it and a browser cannot originate
    // a key event there at all. jsdom allowed the dispatch, the test passed, and the
    // announcement had no caller outside the test.
    fireEvent.click(screen.getByRole("button", { name: /Move Sku up/i }));

    expect(screen.getByTestId("designer-announcer").textContent).toContain("Sku is already first");

    // …and nothing moved, which is the other half of "the control is not broken".
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));
    expect(savedNames()).toEqual(["Sku", "Qty", "Price"]);
  });

  it("the boundary control is FOCUSABLE, or the announcement can never be reached", () => {
    renderDesigner(threeFieldTree());
    const up = screen.getByRole("button", { name: /Move Sku up/i });

    // `disabled` would bar it from the tab order — and from firing the very
    // announcement it exists to make. aria-disabled conveys the state and keeps it
    // reachable; move()'s own guard is what stops the tree changing.
    up.focus();
    expect(document.activeElement).toBe(up);
    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(up).toHaveProperty("disabled", false);
  });

  it("Alt+ArrowUp at the boundary announces too — the key route must work as well", () => {
    renderDesigner(threeFieldTree());

    fireEvent.keyDown(screen.getByRole("button", { name: /Move Sku up/i }), { key: "ArrowUp", altKey: true });
    expect(screen.getByTestId("designer-announcer").textContent).toContain("Sku is already first");
  });

  it("the boundary controls report themselves disabled at each end — without leaving the tab order", () => {
    renderDesigner(threeFieldTree());

    expect(screen.getByRole("button", { name: /Move Sku up/i }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: /Move Price down/i }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: /Move Sku down/i }).getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByRole("button", { name: /Move Price up/i }).getAttribute("aria-disabled")).toBe("false");

    // None of them is the native `disabled` that would make the state unreachable.
    for (const name of [/Move Sku up/i, /Move Price down/i, /Move Sku down/i, /Move Price up/i])
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", false);
  });

  it("a boundary press does not move the tree even though the control is live", () => {
    renderDesigner(threeFieldTree());

    fireEvent.click(screen.getByRole("button", { name: /Move Price down/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Sku", "Qty", "Price"]);
  });

  // ── F2: index keys reconcile by POSITION, so state and focus must follow the node ──

  it("pressing the SAME control twice moves the same node twice", () => {
    renderDesigner(threeFieldTree());

    // Without focus following the node, the second press lands on the neighbour that
    // just swapped into that position and moves it back — the tree returns to its
    // original order and a keyboard user can never move anything past one place.
    fireEvent.click(screen.getByRole("button", { name: /Move Sku down/i }));
    fireEvent.click(document.activeElement as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedNames()).toEqual(["Qty", "Price", "Sku"]);
  });

  it("an open inline name editor cannot rename the node that swaps into its place", () => {
    renderDesigner(threeFieldTree());

    // Open the name editor on Sku, then move Sku. The editor belongs to the ROW, and
    // rows are keyed by index — so left alone it stays put while a different node
    // slides underneath it, and the next keystroke renames THAT node instead. The
    // node name is the CSV column header, so the wrong name reaches the supplier.
    fireEvent.click(screen.getByRole("button", { name: /Edit name \(Sku\)/i }));
    expect(screen.getByLabelText("Node name")).toHaveProperty("value", "Sku");

    fireEvent.click(screen.getByRole("button", { name: /Move Sku down/i }));

    expect(screen.queryByLabelText("Node name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));
    expect(savedNames()).toEqual(["Qty", "Sku", "Price"]);
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

// ─────────────────────────────────────────────────────────────────────────────
// WP-15 · S8 — the CSV dialect panel.
//
// The emitter gained delimiter / quoting / line ending / encoding / header-row in
// S6, all nullable, every null meaning "exactly the bytes as before". This is the
// half an operator can reach — plus the one place the founder ruling of
// 2026-07-31 is implemented: NEW layouts default to CRLF, existing ones keep what
// they have, and the DESIGNER is what writes that in.
// ─────────────────────────────────────────────────────────────────────────────
describe("OutputStructureDesigner — CSV dialect", () => {
  function csvTree(csvDialect?: OutputNodeTemplate["csvDialect"]): OutputNodeTemplate {
    return {
      format: "csv",
      csvDialect,
      root: { name: "root", nodeType: "object", children: [
        { name: "OrderRef", nodeType: "field", rule: { outputPath: "OrderRef", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
      ] },
    };
  }

  const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /CSV format/i }));

  it("the panel is CSV-only — it does not render for JSON or XML", () => {
    renderDesigner(plainXmlTree());
    expect(screen.queryByRole("button", { name: /CSV format/i })).toBeNull();
    cleanup();

    renderDesigner({ ...csvTree(), format: "json" });
    expect(screen.queryByRole("button", { name: /CSV format/i })).toBeNull();
  });

  it("changing the delimiter saves it on the tree", () => {
    renderDesigner(csvTree());
    openPanel();
    fireEvent.change(screen.getByLabelText("Column separator"), { target: { value: ";" } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect?.delimiter).toBe(";");
  });

  it("changing the line ending, quote policy, encoding and header row all save", () => {
    renderDesigner(csvTree());
    openPanel();
    fireEvent.change(screen.getByLabelText("Line ending"), { target: { value: "\r\n" } });
    fireEvent.change(screen.getByLabelText("Quoting"), { target: { value: "always" } });
    fireEvent.change(screen.getByLabelText("Text encoding"), { target: { value: "windows-1252" } });
    fireEvent.click(screen.getByLabelText("Write a header row"));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    const d = savedTree().csvDialect!;
    expect(d.lineEnding).toBe("\r\n");
    expect(d.quotePolicy).toBe("always");
    expect(d.encoding).toBe("windows-1252");
    expect(d.writeHeaderRow).toBe(false);
  });

  it("an EXISTING layout with no dialect is left alone when nothing is touched", () => {
    // The byte-parity guarantee, at the UI seam. Opening the designer on an old
    // supplier's tree and saving must not invent a dialect — a defaulted CRLF here
    // would change the bytes of every existing CSV supplier the first time anyone
    // looked at their layout.
    renderDesigner(csvTree());
    fireEvent.click(screen.getByRole("button", { name: /Edit name \(OrderRef\)/i }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Ref" } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect ?? null).toBeNull();
  });

  it("an existing dialect round-trips even when the panel is never opened", () => {
    renderDesigner(csvTree({ delimiter: ";", lineEnding: "\n" }));
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect).toEqual({ delimiter: ";", lineEnding: "\n" });
  });

  it("the panel shows what the tree actually carries, not a guess", () => {
    renderDesigner(csvTree({ delimiter: "\t", quotePolicy: "always" }));
    openPanel();

    expect(screen.getByLabelText("Column separator")).toHaveProperty("value", "\t");
    expect(screen.getByLabelText("Quoting")).toHaveProperty("value", "always");
    // Untouched members read as the emitter's default, not as blank-and-therefore-unknown.
    expect(screen.getByLabelText("Write a header row")).toHaveProperty("checked", true);
  });
});

// ── S8 · the parity seam itself ──────────────────────────────────────────────
// The three cases below exist because a mutation round found the byte-parity
// claim UNTESTED: the case above never opens the panel, so nothing exercised the
// key-writing at all. Deleting the "drop the key" branch, keeping an emptied
// dialect as `{}`, and writing `true` instead of dropping the header-row key all
// passed. Each is a way for a supplier's bytes to change because somebody opened
// a panel and changed nothing.
describe("OutputStructureDesigner — CSV dialect leaves no trace when nothing changed", () => {
  function csvTree(csvDialect?: OutputNodeTemplate["csvDialect"]): OutputNodeTemplate {
    return {
      format: "csv",
      csvDialect,
      root: { name: "root", nodeType: "object", children: [
        { name: "OrderRef", nodeType: "field", rule: { outputPath: "OrderRef", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
      ] },
    };
  }
  const savedDialect = () => savedTree().csvDialect ?? null;
  const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /CSV format/i }));

  it("opening the panel and touching nothing writes NO dialect", () => {
    renderDesigner(csvTree());
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedDialect()).toBeNull();
  });

  it("changing a control and changing it BACK leaves no dialect behind", () => {
    renderDesigner(csvTree());
    openPanel();

    fireEvent.change(screen.getByLabelText("Column separator"), { target: { value: ";" } });
    fireEvent.change(screen.getByLabelText("Column separator"), { target: { value: "," } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    // NOT `{}` — an empty object is a dialect the backend will read, and "no
    // dialect" is the only shape that is guaranteed byte-identical.
    expect(savedDialect()).toBeNull();
  });

  it("un-ticking and re-ticking the header row leaves no key behind", () => {
    renderDesigner(csvTree());
    openPanel();

    const box = screen.getByLabelText("Write a header row");
    fireEvent.click(box);   // false — written
    fireEvent.click(box);   // back to the default — must be REMOVED, not written as true
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedDialect()).toBeNull();
  });

  it("reverting ONE control of several keeps the others and drops only that key", () => {
    renderDesigner(csvTree());
    openPanel();

    fireEvent.change(screen.getByLabelText("Column separator"), { target: { value: ";" } });
    fireEvent.change(screen.getByLabelText("Quoting"), { target: { value: "always" } });
    fireEvent.change(screen.getByLabelText("Quoting"), { target: { value: "minimal" } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedDialect()).toEqual({ delimiter: ";" });
  });
});

// ── S8 · the founder ruling, at the only seam that implements it ─────────────
// "New layouts default to CRLF; existing ones keep what they have." Both halves
// are one `if`, and a mutation widening it to every tree SURVIVED — nothing drove
// the infer path, because inferOutputStructure was a bare vi.fn(). Either half
// getting this wrong changes bytes: defaulting on the edit path re-terminates
// every existing supplier the first time their layout is opened, and not
// defaulting on the infer path means new work keeps inheriting the server's
// platform-dependent Environment.NewLine.
describe("OutputStructureDesigner — CRLF is for NEW layouts only", () => {
  const inferredCsv: OutputNodeTemplate = {
    format: "csv",
    root: { name: "root", nodeType: "object", children: [
      { name: "Ref", nodeType: "field", rule: { outputPath: "Ref", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
    ] },
  };

  async function inferFrom(tree: OutputNodeTemplate) {
    inferOutputStructure.mockResolvedValueOnce(tree);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OutputStructureDesigner orderId="o-1" baseOverride={{ customFields: [] }} initialTree={null} onClose={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Supplier sample file"), { target: { value: "a,b\n1,2\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Build from a sample/i }));
    await screen.findByRole("button", { name: /Save structure/i });
  }

  it("a freshly INFERRED CSV layout is pinned to CRLF", async () => {
    await inferFrom(inferredCsv);
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect?.lineEnding).toBe("\r\n");
  });

  it("an inferred layout that already declares a dialect is NOT overwritten", async () => {
    await inferFrom({ ...inferredCsv, csvDialect: { lineEnding: "\n", delimiter: ";" } });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect).toEqual({ lineEnding: "\n", delimiter: ";" });
  });

  it("a freshly inferred JSON layout gets no CSV dialect at all", async () => {
    await inferFrom({ ...inferredCsv, format: "json" });
    fireEvent.click(screen.getByRole("button", { name: /Save structure/i }));

    expect(savedTree().csvDialect ?? null).toBeNull();
  });
});
