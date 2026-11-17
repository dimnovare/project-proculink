import { describe, it, expect } from "vitest";
import { BEING_READ_STATUSES, DOCUMENT_TABS, documentsAddress, documentsHelper, readDocumentsAddress, startOfWeek } from "./documentTabs";

describe("documentTabs", () => {
  it("derives each tab's statuses from the status table and reads only an address it understands", () => {
    expect(DOCUMENT_TABS.map((t) => [t.id, t.label, t.statuses])).toEqual([
      ["needs-you", "Needs you", ["needs_review", "ready"]],
      ["sent", "Sent", ["sent"]],
      ["failed", "Couldn't send or read", ["read_failed", "send_failed"]],
      ["all", "All", null],
    ]);
    expect(BEING_READ_STATUSES).toEqual(["received", "reading"]);
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

  it("starts the week on Monday and words only what is known", () => {
    expect(startOfWeek(new Date(2026, 5, 3, 15, 30))).toEqual(new Date(2026, 5, 1)); // a Wednesday
    expect(startOfWeek(new Date(2026, 5, 7, 23, 59))).toEqual(new Date(2026, 5, 1)); // Sunday night still belongs to it
    expect(startOfWeek(new Date(2026, 5, 1, 0, 0))).toEqual(new Date(2026, 5, 1)); // Monday midnight is the start
    expect(documentsHelper(3, 24)).toBe("3 need you. 24 were sent this week.");
    expect(documentsHelper(1, 1)).toBe("1 needs you. 1 was sent this week.");
    expect(documentsHelper(0, 0)).toBe("Nothing needs you.");
    expect(documentsHelper(2, undefined)).toBe("2 need you.");
    expect(documentsHelper(undefined, 24)).toBeNull();
    expect(documentsHelper(3, 24, 2)).toBe("3 need you. 2 being read. 24 were sent this week.");
    expect(documentsHelper(0, 0, 1)).toBe("Nothing needs you. 1 being read.");
    expect(documentsHelper(3, 24, 0)).toBe("3 need you. 24 were sent this week.");
    expect(documentsHelper(3, 24, undefined)).toBe("3 need you. 24 were sent this week.");
    expect(documentsHelper(undefined, 24, 2)).toBeNull();
  });
});
