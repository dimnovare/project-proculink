import { describe, it, expect } from "vitest";
import type { DocumentPage, DocumentRow } from "@/lib/api/documents";
import { pickNext, positionText, queuePosition } from "./reviewQueue";

const r = (id: string) => ({ id, flowId: "flow-a" }) as DocumentRow;
const page = (ids: string[], total = ids.length) => ({ items: ids.map(r), totalCount: total, page: 1, pageSize: 50 }) as DocumentPage;

describe("review queue", () => {
  it("places the document in the queue and picks the next one from what the server says now", () => {
    expect(positionText(queuePosition(page(["a", "b", "c"]), "b"))).toBe("Document 2 of 3");
    expect(positionText(queuePosition(page(["a"], 1), "a"))).toBe("The only one waiting");
    expect(positionText(queuePosition(page(["a", "b"], 80), "z"))).toBeNull();          // not in the first 50
    expect(queuePosition(undefined, "a")).toBeNull();                                     // unknown is not a position
    const before = page(["a", "b", "c"]).items;
    expect(pickNext(before, page(["a", "c"]).items, "b")?.id).toBe("c");                   // the one after, still listed
    expect(pickNext(before, page(["a", "b"]).items, "b")?.id).toBe("a");                   // c was taken: wrap round
    expect(pickNext(before, page(["n", "a", "b"]).items, "c")?.id).toBe("a");              // a new arrival waits its turn
    expect(pickNext(before, page(["b"]).items, "b")).toBeNull();                           // nothing else needs you
    expect(pickNext(before, page(["z"]).items, "b")?.id).toBe("z");                        // all known ones gone: the server's first
    expect(pickNext(undefined, undefined, "b")).toBeNull();                                // unknown: never guess
    expect(pickNext(before, undefined, "c")?.id).toBe("a");                                // Skip: the queue as it is
  });
});
