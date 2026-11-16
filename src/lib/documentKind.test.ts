import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { rowNeed, type ListedDocument } from "@/components/flows/DocumentList";
import { inInbox, kindPlural, kindSentence } from "./documentKind";

const row: ListedDocument = {
  id: "d", flowId: "f", flowName: "Supplier invoices", fileName: "invoice-2292.pdf", status: "received", statusReason: null,
  pageCount: 1, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-16T09:00:00Z", source: "upload", sourceRef: null,
};

describe("documentKind", () => {
  it("says what a document is in words, and never guesses a kind", () => {
    expect(kindSentence("Invoice", "Example Supplier Ltd")).toBe("An invoice from Example Supplier Ltd");
    expect(kindSentence("Delivery note", null)).toBe("A delivery note");
    expect(kindSentence("CMR note", "Sample Traders Ltd")).toBe("A CMR note from Sample Traders Ltd");
    expect(kindSentence(null, "Sample Traders Ltd")).toBe("From Sample Traders Ltd");
    expect(kindSentence(null, null)).toBeNull();
    expect(["Invoice", "Delivery note", "Company", "Box", "Purchase orders", "CMR note"].map(kindPlural))
      .toEqual(["invoices", "delivery notes", "companies", "boxes", "purchase orders", "CMR notes"]);
    expect(kindPlural(null)).toBe("documents like this");
    expect(inInbox({ flowId: "f", inInbox: undefined }, undefined)).toBeUndefined();
    expect(inInbox({ flowId: "f" }, { flowId: "f", address: null, intakeId: null })).toBe(true);
    expect(inInbox({ flowId: "g", inInbox: true }, { flowId: "f", address: null, intakeId: null })).toBe(true);
  });

  it("labels the sorting reasons, keeps Downloaded apart from Sent, and an unknown reason is the status", () => {
    expect(documentStatus("needs_review", "new_kind").label).toBe("New kind");
    expect(documentStatus("needs_review", "choose_flow").label).toBe("Choose a flow");
    expect(documentStatus("needs_review", "check_sort")).toMatchObject({ label: "Check the flow", needsYou: true, editable: true });
    expect(documentStatus("sent", "downloaded")).toMatchObject({ label: "Downloaded", tone: "success", needsYou: false });
    expect(documentStatus("sent", "something_new").label).toBe("Sent");
    expect(rowNeed({ ...row, status: "needs_review", statusReason: "check_sort", failedChecks: 2, checks: ["low_confidence", "low_confidence"] }).text).toBe("Check the flow");
    expect(documentRefusalMessage(new ApiHttpError("x", 415, { error: "unsupported_format" }))).toBe("This file type can't be read.");
  });
});
