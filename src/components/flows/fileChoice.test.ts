import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow, FlowOutput } from "@/lib/api/documents";
import { excelSeparator, toSimple } from "@/lib/flowOutputModel";
import { aFileOf, renamed, replaceOutput, typeChoice } from "./fileChoice";

const api = vi.hoisted(() => ({ getFlow: vi.fn(), updateOutput: vi.fn(), publishFlow: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const leaf = (name: string, field: string) => ({ name, nodeType: "field", children: [], rule: { outputPath: name, canonicalField: field, fieldManipulators: [] } });
const csvOut = {
  id: "out-1", flowId: "flow-1", name: "Invoices CSV", format: "csv", tableKey: null, destinationId: "dest-1", createdAt: "",
  sendWhen: { field: "invoice_number", op: "is", value: "A" },
  template: { format: "csv", root: { name: "document", nodeType: "object", children: [leaf("Invoice", "invoice_number"), leaf("Item", "item")] } },
} as FlowOutput;
const flow = { id: "flow-1", name: "Invoices", fields: { fields: [], tables: [] } } as unknown as Flow;

beforeEach(() => {
  vi.clearAllMocks();
  api.updateOutput.mockImplementation(async (_f: string, id: string, b: object) => ({ ...csvOut, ...b, id }));
  api.publishFlow.mockResolvedValue(flow);
});

describe("fileChoice", () => {
  it("keeps the person's name and swaps a type it ends with", () => {
    expect(renamed("Invoices CSV", "CSV", "XML")).toBe("Invoices XML");
    expect(renamed("Accounting import", "CSV", "XML")).toBe("Accounting import");
    expect(renamed("CSV file", "CSV", "XML")).toBe("XML file");             // the default name follows its type
    expect(renamed("My CSV file", "CSV", "Excel")).toBe("My CSV file");
    expect(aFileOf({ format: "xml" })).toBe("an XML file");
    expect(aFileOf({ format: "txt" })).toBe("a text file");
  });

  it("replaces the same output, keeps its destination, and puts it in use when nothing else waits", async () => {
    api.getFlow.mockResolvedValue({ ...flow, publishedVersion: 2, hasChanges: false });
    const r = await replaceOutput("flow-1", csvOut, typeChoice(csvOut, "xml"));
    expect(api.updateOutput).toHaveBeenCalledWith("flow-1", "out-1", expect.objectContaining({
      replace: true, format: "xml", standard: null, name: "Invoices XML", destinationId: "dest-1", sendWhen: csvOut.sendWhen, layout: null,
    }));
    expect(api.publishFlow).toHaveBeenCalledWith("flow-1");
    expect(r.inUse).toBe(true);
  });

  it("a file that becomes a CSV again opens in the user's Excel: separator and byte-order mark", () => {
    const xml = typeChoice(csvOut, "xml");
    const back = toSimple(typeChoice({ ...csvOut, format: "xml", template: xml.template! }, "csv").template!)!;
    expect(back).toMatchObject({ byteOrderMark: true });
    expect(back.delimiter ?? ",").toBe(excelSeparator());
    expect(toSimple(typeChoice(csvOut, "csv").template!)!.byteOrderMark).toBeUndefined(); // a CSV staying a CSV is left alone
    expect(typeChoice({ ...csvOut, standard: "ubl-order", template: null } as unknown as FlowOutput, "csv"))
      .toMatchObject({ template: null, csvSeparator: excelSeparator() });
  });

  it("leaves other waiting changes alone: no publish", async () => {
    api.getFlow.mockResolvedValue({ ...flow, publishedVersion: 2, hasChanges: true });
    expect((await replaceOutput("flow-1", csvOut, typeChoice(csvOut, "json"))).inUse).toBe(false);
    expect(api.publishFlow).not.toHaveBeenCalled();
  });
});
