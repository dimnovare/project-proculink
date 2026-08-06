// OutputStructureDesigner — WP-16 wiring tests.
//
// The pure modules (`outputConditionModel`, `outputNamespacePresets`, `outputTreeProblems`) have
// their own unit tests. These tests exist because passing unit tests prove nothing about whether the
// component CALLS them — the exact defect this repo has already paid for once, where a text-
// sanitising function was pinned perfectly and nothing pinned that any component invoked it.
//
// So every assertion below renders the real designer and reads the real screen, and the thing being
// asserted is what reaches the save payload or the user's eyes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderMappingOverride, OutputNodeTemplate } from "@/lib/api/types";
import type { Order, OrderLine } from "@/types/procurement";

const upsertMappingOverride = vi.fn<(id: string, o: OrderMappingOverride) => Promise<OrderMappingOverride>>(
  (_id, o) => Promise.resolve(o),
);
const getOrderById = vi.fn<(id: string) => Promise<Order | null>>();

vi.mock("@/lib/api-client", () => ({
  upsertMappingOverride: (id: string, o: OrderMappingOverride) => upsertMappingOverride(id, o),
  previewMappingOverride: vi.fn().mockResolvedValue({ format: "xml", content: "<Order/>" }),
  inferOutputStructure: vi.fn(),
  getSourceTokens: vi.fn().mockResolvedValue([]),
  apiClient: { getOrderById: (id: string) => getOrderById(id) },
}));

import { OutputStructureDesigner } from "./OutputStructureDesigner";
import { UBL_CBC_URI, UBL_CAC_URI } from "./outputNamespacePresets";

afterEach(cleanup);

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: "l1", lineNumber: 1, buyerItemCode: "B-1", supplierItemCode: "S-1",
    description: "Widget", quantity: 5, unit: "EA", unitPrice: 10, confidence: 1, needsReview: false,
    ...over,
  };
}

function order(lines: OrderLine[] = [line()]): Order {
  return {
    id: "o-1", poNumber: "PO-1", supplierId: "sup-9", supplierName: "Wortmann",
    orderDate: "2026-06-15", currency: "EUR", status: "pending_review",
    createdAt: "", updatedAt: "", lines, artifacts: [],
  };
}

beforeEach(() => {
  upsertMappingOverride.mockClear();
  getOrderById.mockReset();
  getOrderById.mockResolvedValue(order());
});

function renderDesigner(initialTree: OutputNodeTemplate) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OutputStructureDesigner
          orderId="o-1" baseOverride={{ customFields: [] }} initialTree={initialTree} onClose={() => {}}
        />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

function savedTree(): OutputNodeTemplate {
  expect(upsertMappingOverride).toHaveBeenCalled();
  return upsertMappingOverride.mock.calls.at(-1)![1].outputTree!;
}

const saveButton = () => screen.getByRole("button", { name: /save structure|fix \d+ problem/i });

function xmlTree(over: Partial<OutputNodeTemplate> = {}): OutputNodeTemplate {
  return {
    format: "xml",
    root: { name: "Order", nodeType: "object", children: [
      { name: "ID", nodeType: "field", rule: { outputPath: "ID", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
      { name: "Lines", nodeType: "array", collection: "lines", children: [
        { name: "Line", nodeType: "object", children: [
          { name: "Qty", nodeType: "field", rule: { outputPath: "Qty", canonicalField: "Quantity", fixedValue: null, fieldManipulators: [] } },
        ] },
      ] },
    ] },
    ...over,
  };
}

/** Open the row for `name`, reveal Advanced, and open its condition editor. */
function openCondition(name: string) {
  const row = screen.getByRole("button", { name: new RegExp(`Edit name \\(${name}\\)`, "i") }).closest("div")!;
  const advanced = within(row).queryByRole("button", { name: /Show advanced options/i });
  if (advanced) fireEvent.click(advanced);
  const add = within(row).queryByRole("button", { name: /Only include this when a rule is true/i });
  if (add) fireEvent.click(add);
}

// ── Scope item 4: the format rewrite ─────────────────────────────────────────
// `designerFormat()` coerced a saved cXml/ubl/x12 tree to "xml" while SEEDING state, and save wrote
// the seed verbatim. So merely opening and saving a cXML layout rewrote it — data loss with no
// consent. Worse than it looks: the backend then requires the layout's format to EQUAL the
// connection's delivery format, so the rewritten `xml` layout is silently dropped at transform time
// and the fixed cXML transform delivers instead. A loud failure became a silent no-op.
describe("the format is never rewritten without consent", () => {
  it("a cXML layout cannot be saved at all until the author decides what to do", () => {
    renderDesigner(xmlTree({ format: "cXml" }));
    fireEvent.click(saveButton());
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });

  it("and it says so, naming the format and why", () => {
    renderDesigner(xmlTree({ format: "cXml" }));
    expect(screen.getByText(/cXML can't be built from a layout/i)).toBeTruthy();
  });

  it("converting to plain XML asks first, and only then changes the format", async () => {
    renderDesigner(xmlTree({ format: "cXml" }));
    fireEvent.click(screen.getByRole("button", { name: /Turn this into a plain XML layout/i }));

    // The confirm names the consequence — the supplier may reject the result.
    expect(await screen.findByText(/without the cXML envelope/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Convert to XML$/i }));

    await waitFor(() => expect(screen.queryByText(/cXML can't be built from a layout/i)).toBeNull());
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().format).toBe("xml"));
  });

  it("declining the conversion leaves the format alone", async () => {
    renderDesigner(xmlTree({ format: "cXml" }));
    fireEvent.click(screen.getByRole("button", { name: /Turn this into a plain XML layout/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Keep it as cXML$/i }));
    await waitFor(() => expect(screen.getByText(/cXML can't be built from a layout/i)).toBeTruthy());
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });

  it("an ordinary XML layout still saves as XML — the regression floor", async () => {
    renderDesigner(xmlTree());
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().format).toBe("xml"));
  });

  it("switching format with the segmented control still works", async () => {
    renderDesigner(xmlTree());
    fireEvent.click(screen.getByRole("radio", { name: /CSV format/i }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().format).toBe("csv"));
  });

  // Found by trying to break this feature after building it: the fork bar's conversion asks first,
  // but the format pills sat right above it and changed the same field with no question at all. The
  // consequence is identical — the envelope is dropped — so the pills ask the same question.
  it("the format pills cannot be used to skip the conversion warning", async () => {
    renderDesigner(xmlTree({ format: "cXml" }));
    fireEvent.click(screen.getByRole("radio", { name: /XML format/i }));

    expect(await screen.findByText(/without the cXML envelope/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Keep it as cXML$/i }));
    await waitFor(() => expect(screen.getByText(/cXML can't be built from a layout/i)).toBeTruthy());
  });
});

// ── Scope item 1: the structured conditional builder ─────────────────────────
describe("conditions are built, not typed", () => {
  it("picking a field, an operator and a value writes the predicate the emitter runs", async () => {
    renderDesigner(xmlTree());
    openCondition("Qty");

    fireEvent.click(screen.getByRole("radio", { name: /Only include when/i }));
    fireEvent.change(screen.getByLabelText("Condition field"), { target: { value: "Quantity" } });
    fireEvent.change(screen.getByLabelText("Condition operator"), { target: { value: "isMoreThan" } });
    fireEvent.change(screen.getByLabelText("Condition value"), { target: { value: "0" } });

    fireEvent.click(saveButton());
    await waitFor(() => {
      const qty = savedTree().root.children![1].children![0].children![0];
      expect(qty.includeWhen).toBe("line.Quantity > 0");
    });
  });

  it("shows the generated expression, so the builder teaches the raw form", () => {
    renderDesigner(xmlTree());
    openCondition("Qty");
    fireEvent.click(screen.getByRole("radio", { name: /Only include when/i }));
    fireEvent.change(screen.getByLabelText("Condition field"), { target: { value: "Quantity" } });
    fireEvent.change(screen.getByLabelText("Condition operator"), { target: { value: "isMoreThan" } });
    fireEvent.change(screen.getByLabelText("Condition value"), { target: { value: "0" } });
    expect(screen.getByTestId("condition-preview").textContent).toContain("line.Quantity > 0");
  });

  // `"10" > "9"` is FALSE as a string comparison, produces a plausible file, and a coordinator would
  // never find it. The operator simply is not offered on a text field.
  it("does not offer a numeric comparison on a text field", () => {
    renderDesigner(xmlTree());
    openCondition("ID");
    fireEvent.click(screen.getByRole("radio", { name: /Only include when/i }));
    fireEvent.change(screen.getByLabelText("Condition field"), { target: { value: "BuyerName" } });
    const ops = within(screen.getByLabelText("Condition operator") as HTMLSelectElement)
      .getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(ops).toEqual(["is", "isNot", "isEmpty", "isNotEmpty"]);
  });

  it("an emptiness operator hides the value input", () => {
    renderDesigner(xmlTree());
    openCondition("ID");
    fireEvent.click(screen.getByRole("radio", { name: /Only include when/i }));
    fireEvent.change(screen.getByLabelText("Condition operator"), { target: { value: "isEmpty" } });
    expect(screen.queryByLabelText("Condition value")).toBeNull();
  });

  it("a saved predicate reopens IN the builder with its parts filled in", () => {
    const t = xmlTree();
    t.root.children![0] = { ...t.root.children![0], includeWhen: 'order.Currency == "EUR"' };
    renderDesigner(t);

    // Advanced auto-opens for a node that already carries a condition; click the pill to edit.
    fireEvent.click(screen.getByRole("button", { name: /Click to edit the condition/i }));
    expect((screen.getByLabelText("Condition field") as HTMLSelectElement).value).toBe("Currency");
    expect((screen.getByLabelText("Condition operator") as HTMLSelectElement).value).toBe("is");
    expect((screen.getByLabelText("Condition value") as HTMLInputElement).value).toBe("EUR");
  });

  it("an expression the builder has no shape for opens raw, says so, and is NEVER rewritten", async () => {
    const raw = "string.size(line.Description) > 3";
    const t = xmlTree();
    t.root.children![1].children![0].children![0] = { ...t.root.children![1].children![0].children![0], includeWhen: raw };
    renderDesigner(t);

    fireEvent.click(screen.getByRole("button", { name: /Click to edit the condition/i }));
    // The apostrophe is a typographic one in the rendered copy, so the matcher does not pin it.
    expect(screen.getByText(/This condition was written as an expression, so it.s shown as written\./i)).toBeTruthy();
    expect((screen.getByLabelText("Condition expression") as HTMLInputElement).value).toBe(raw);

    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(savedTree().root.children![1].children![0].children![0].includeWhen).toBe(raw);
    });
  });

  it("the raw escape hatch is reachable from the builder", () => {
    renderDesigner(xmlTree());
    openCondition("ID");
    fireEvent.click(screen.getByRole("radio", { name: /Only include when/i }));
    fireEvent.click(screen.getByRole("button", { name: /Write it as an expression/i }));
    expect(screen.getByLabelText("Condition expression")).toBeTruthy();
  });

  it("choosing 'Always include' clears the condition", async () => {
    const t = xmlTree();
    t.root.children![0] = { ...t.root.children![0], includeWhen: 'order.Currency == "EUR"' };
    renderDesigner(t);
    fireEvent.click(screen.getByRole("button", { name: /Click to edit the condition/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Always include/i }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().root.children![0].includeWhen ?? null).toBeNull());
  });

  // A CSV file has the same columns on every row, so a per-column condition cannot do anything. The
  // control is present and disabled WITH THE REASON, never silently greyed.
  it("in CSV a per-column condition is disabled and says why", () => {
    renderDesigner(xmlTree({ format: "csv" }));
    openCondition("ID");
    expect(screen.getByText(/A CSV file has the same columns on every row/i)).toBeTruthy();
    expect(screen.queryByLabelText("Condition field")).toBeNull();
  });
});

// ── Scope item 2: namespace presets ──────────────────────────────────────────
describe("namespaces are picked, not transcribed", () => {
  it("choosing UBL 2.1 writes both OASIS addresses", async () => {
    renderDesigner(xmlTree());
    fireEvent.change(screen.getByLabelText("XML namespaces"), { target: { value: "ubl21" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().namespaces).toEqual({ cbc: UBL_CBC_URI, cac: UBL_CAC_URI }));
  });

  it("choosing None clears them", async () => {
    renderDesigner(xmlTree({ namespaces: { cbc: UBL_CBC_URI, cac: UBL_CAC_URI } }));
    fireEvent.change(screen.getByLabelText("XML namespaces"), { target: { value: "none" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(savedTree().namespaces ?? null).toBeNull());
  });

  it("a saved UBL map reopens as the UBL preset, not as Custom", () => {
    renderDesigner(xmlTree({ namespaces: { cbc: UBL_CBC_URI, cac: UBL_CAC_URI } }));
    expect((screen.getByLabelText("XML namespaces") as HTMLSelectElement).value).toBe("ubl21");
  });

  it("Custom reveals the editable prefix/address rows", () => {
    renderDesigner(xmlTree());
    expect(screen.queryByRole("button", { name: /^\+ namespace$/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("XML namespaces"), { target: { value: "custom" } });
    expect(screen.getByRole("button", { name: /^\+ namespace$/ })).toBeTruthy();
  });

  // FE #91 retracted Peppol BIS 3 as a sold claim. A preset carrying its name would read as that
  // claim being quietly reinstated, and cXML has no namespaces at all.
  it("offers neither a Peppol nor a cXML preset", () => {
    renderDesigner(xmlTree());
    const options = within(screen.getByLabelText("XML namespaces") as HTMLSelectElement)
      .getAllByRole("option").map((o) => o.textContent?.toLowerCase() ?? "");
    expect(options.join(" ")).not.toContain("peppol");
    expect(options.join(" ")).not.toContain("cxml");
  });

  // Found by trying to break this feature after building it: a namespace with NO prefix has no map
  // key to be hoisted to, so "Move them to the top" would run, leave that element behind, and the
  // same warning would still be on screen. A control that visibly does nothing reads as broken, so
  // it is withheld and the reason is stated — the other exit still works.
  it("does not offer a hoist it cannot finish", () => {
    const t = xmlTree({ namespaces: { cbc: UBL_CBC_URI } });
    t.root.children![0] = { ...t.root.children![0], prefix: null, namespace: "urn:default" };
    renderDesigner(t);

    expect(screen.queryByRole("button", { name: /Move them to the top/i })).toBeNull();
    expect(screen.getByText(/namespace with no prefix, which can.t be moved to the top/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep them on each element/i })).toBeTruthy();
  });

  it("the mode collision offers a control that fixes it, not just a complaint", async () => {
    const t = xmlTree({ namespaces: { cbc: UBL_CBC_URI } });
    t.root.children![0] = { ...t.root.children![0], prefix: "cac", namespace: UBL_CAC_URI };
    renderDesigner(t);

    fireEvent.click(screen.getByRole("button", { name: /Move them to the top/i }));
    fireEvent.click(saveButton());
    await waitFor(() => {
      const saved = savedTree();
      expect(saved.namespaces).toEqual({ cbc: UBL_CBC_URI, cac: UBL_CAC_URI });
      expect(saved.root.children![0].prefix ?? null).toBeNull();
    });
  });
});

// ── Scope item 3: the validator, on the screen ───────────────────────────────
describe("a layout that cannot produce a valid file fails here, not at delivery", () => {
  it("a repeating list with no item template blocks the save and names itself", () => {
    const t = xmlTree();
    t.root.children![1] = { ...t.root.children![1], children: [] };
    renderDesigner(t);

    expect(screen.getByText(/The repeating list "Lines" is empty, so no order lines would be sent\./i)).toBeTruthy();
    expect(saveButton().textContent).toMatch(/Fix 1 problem to save/i);
    // Both halves of the block are pinned: the control is really disabled (the half a sighted user
    // and a screen reader both read), AND pressing it saves nothing (the half that is correctness).
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });

  it("a prefix with no address blocks the save", () => {
    const t = xmlTree();
    t.root.children![0] = { ...t.root.children![0], prefix: "cbc", namespace: null };
    renderDesigner(t);
    expect(screen.getByText(/"cbc" has a prefix but no web address/i)).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(upsertMappingOverride).not.toHaveBeenCalled();
  });

  it("a clean layout says so and saves", async () => {
    renderDesigner(xmlTree());
    expect(screen.getByText(/This layout will produce a valid file\./i)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertMappingOverride).toHaveBeenCalled());
  });

  // THE PACKET'S LOAD-BEARING CLAIM. The tree path runs `GuardResolved` — needs review, missing
  // supplier item code. Every fixed transform runs `OutputFieldValidator`, which ALSO refuses a
  // non-positive quantity and a negative unit price. Those two are exactly what the tree path
  // skipped, so an order carrying either delivered silently through a designed layout.
  it("surfaces the two order checks the tree path skipped and the fixed transforms enforce", async () => {
    getOrderById.mockResolvedValue(order([
      line({ lineNumber: 4, quantity: 0 }),
      line({ id: "l2", lineNumber: 7, unitPrice: -1.5 }),
    ]));
    renderDesigner(xmlTree());

    expect(await screen.findByText(/Line 4's quantity is 0\. Orders with a zero quantity are held for review\./i)).toBeTruthy();
    expect(screen.getByText(/Line 7's unit price is -1\.5\. Orders with a negative price are held for review\./i)).toBeTruthy();
  });

  // Founder ruling 2026-07-31: those checks ship as a warning, not a block. Blocking would stop
  // orders that deliver today, and an order that is not ready is not a broken layout.
  it("but an order problem never blocks the save — the layout is fine", async () => {
    getOrderById.mockResolvedValue(order([line({ lineNumber: 4, quantity: 0 })]));
    renderDesigner(xmlTree());
    await screen.findByText(/Line 4's quantity is 0/i);

    expect(saveButton().textContent).not.toMatch(/Fix/i);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertMappingOverride).toHaveBeenCalled());
  });

  it("an unbound value warns without blocking", async () => {
    const t = xmlTree();
    t.root.children!.push({ name: "vat_code", nodeType: "field", rule: { outputPath: "vat_code", canonicalField: null, fixedValue: null, fieldManipulators: [] } });
    renderDesigner(t);
    expect(screen.getByText(/"vat_code" has no field, so it will always be sent empty\./i)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertMappingOverride).toHaveBeenCalled());
  });
});
