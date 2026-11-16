import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api/core";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { rowNeed, type ListedDocument } from "@/components/flows/DocumentList";
import { inInbox, kindSentence } from "./documentKind";

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
    const cases: [string, string | null, string | null][] = [
      ["?!", "Sample Traders Ltd", "From Sample Traders Ltd"], ["?!", null, null],
      ["ASN", null, "An ASN"], ["EDI message", null, "An EDI message"], ["XML invoice", null, "An XML invoice"],
      ["X-ray report", null, "An X-ray report"], ["UBL invoice", null, "A UBL invoice"],
      ["Hourly timesheet", null, "An hourly timesheet"],
      ["Invoices", "Kestrel Supplies", "Invoices from Kestrel Supplies"], ["Analysis", "Example Lab Ltd", "Analysis from Example Lab Ltd"],
      ["Invoices", null, "Invoices"], ["Address change", null, "An address change"],
      ["Invoice", "Example Ltd.", "An invoice from Example Ltd."],
      ["Bill of materials", null, "A bill of materials"], ["ASNs", "Sample Traders Ltd", "ASNs from Sample Traders Ltd"], ["Bonus", null, "A bonus"],
    ];
    for (const [kind, sender, said] of cases) expect(kindSentence(kind, sender), kind).toBe(said);
    expect(inInbox({ flowId: "f", inInbox: undefined }, undefined)).toBeUndefined();
    expect(inInbox({ flowId: "f", inInbox: false }, { flowId: "f", address: null, intakeId: null })).toBe(false);
    expect(inInbox({ flowId: "f" }, { flowId: "f", address: null, intakeId: null })).toBe(true);
    expect(inInbox({ flowId: "g", inInbox: true }, { flowId: "f", address: null, intakeId: null })).toBe(true);
  });

  it("labels the sorting reasons, keeps Downloaded apart from Sent, and an unknown reason is the status", () => {
    expect(documentStatus("needs_review", "new_kind").label).toBe("New kind");
    expect(documentStatus("needs_review", "choose_flow").label).toBe("Choose a flow");
    expect(documentStatus("needs_review", "check_sort")).toMatchObject({ label: "Check the flow", needsYou: true, editable: true });
    expect(documentStatus("sent", "downloaded")).toMatchObject({ label: "Downloaded", tone: "success", needsYou: false });
    expect(documentStatus("needs_review", "downloaded").label).not.toBe("Downloaded");
    const review = documentStatus("needs_review", null);
    expect(documentStatus("needs_review", "new_kind")).toMatchObject({ tone: review.tone, needsYou: review.needsYou });
    expect(documentStatus("sent", "something_new").label).toBe("Sent");
    expect(rowNeed({ ...row, status: "needs_review", statusReason: "check_sort", failedChecks: 2, checks: ["low_confidence", "low_confidence"] }).text).toBe("Check the flow");
    expect(documentRefusalMessage(new ApiHttpError("x", 415, { error: "unsupported_format" }))).toBe("This file type can't be read.");
    expect([422, 400].map((s) => documentRefusalMessage(new ApiHttpError("x", s, { error: "invalid_fields", detail: "Field key is taken." }))))
      .toEqual([COPY.invalid_fields, "Field key is taken."]);
  });
});
