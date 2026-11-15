import { describe, it, expect } from "vitest";
import { DOCUMENT_TABS, documentsAddress, readDocumentsAddress } from "./documentTabs";

describe("documentTabs", () => {
  it("derives each tab's statuses from the status table and reads only an address it understands", () => {
    expect(DOCUMENT_TABS.map((t) => [t.id, t.label, t.statuses])).toEqual([
      ["needs-you", "Needs you", ["needs_review", "ready"]],
      ["in-progress", "In progress", ["received", "reading", "sending"]],
      ["sent", "Sent", ["sent"]],
      ["failed", "Couldn't send or read", ["read_failed", "send_failed"]],
      ["all", "All", null],
    ]);
    const read = (q: string) => readDocumentsAddress(new URLSearchParams(q));
    expect(read("")).toEqual({ tab: null, page: 1 });
    expect(read("show=sent&page=3")).toEqual({ tab: "sent", page: 3 });
    expect(read("show=bogus&page=-2")).toEqual({ tab: null, page: 1 });
    expect(read("show=sent&show=all")).toEqual({ tab: null, page: 1 });
    for (const bad of ["page=0", "page=abc", "page=2.5", "page=", "page=1e3", "page=1e9", "page=02", "page=2&page=3", "page=1000000000"]) {
      expect(read(bad).page).toBe(1);
    }
    expect(read("page=999999999").page).toBe(999999999); // the largest page read; the server answers it with an empty page
    expect([documentsAddress("sent"), documentsAddress("sent", 1), documentsAddress("all", 2)])
      .toEqual(["/documents?show=sent", "/documents?show=sent", "/documents?show=all&page=2"]);
  });
});
