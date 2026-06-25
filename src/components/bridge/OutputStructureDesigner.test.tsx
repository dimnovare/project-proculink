// OutputStructureDesigner — T8 namespace authoring RTL tests.
//
// Proves the designer (1) lets the user author a per-node XML namespace + prefix on an element node,
// and a root prefix→uri namespace, and (2) SAVES them in the OutputTree the backend PUT receives
// (node.namespace / node.prefix / template.namespaces). Also pins the data-loss guarantee end to end:
// loading an inferred namespaced tree, editing an unrelated node, and saving preserves all namespaces.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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

  it("X (Close) confirms after an edit, and only closes when confirmed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes to this output structure?");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X (Close) keeps the modal open when the user cancels the confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Close$/i }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel confirms after an edit, and only closes when confirmed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderDesigner(plainXmlTree(), onClose);
    editTree();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes to this output structure?");
    expect(onClose).toHaveBeenCalledTimes(1);
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
