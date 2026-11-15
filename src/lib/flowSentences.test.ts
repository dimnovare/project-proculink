import { describe, expect, it } from "vitest";
import type { FlowSummaryOutput } from "@/lib/api/documents";
import { doesLine, sendsWords, waysInWords } from "./flowSentences";

const out = (name: string, destination: string | null): FlowSummaryOutput => ({ name, format: "csv", standard: null, destination });

describe("flow sentences", () => {
  it("names the ways in once each, in a fixed order, upload last", () => {
    expect(waysInWords(["sftp", "email", "ftp", "imap", "nonsense"])).toBe("email, a mailbox, a server and upload");
    expect(waysInWords([])).toBe("upload");
  });

  it("says what is sent and what is downloaded, and nothing without a summary", () => {
    expect(sendsWords([])).toBe("Nothing is sent yet.");
    expect(sendsWords([out("Invoice CSV", "Accounting server"), out("Finance copy", "Finance inbox")]))
      .toBe("Sends Invoice CSV to Accounting server and Finance copy to Finance inbox.");
    expect(sendsWords([out("Invoice CSV", "Accounting server"), out("Remittance sheet", null)]))
      .toBe("Sends Invoice CSV to Accounting server. You download Remittance sheet.");
    expect(doesLine({ summary: null })).toBeNull();
    expect(doesLine({})).toBeNull();
  });
});
