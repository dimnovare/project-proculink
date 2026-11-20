import { describe, expect, it } from "vitest";
import { dayAt, finishedLabel, madeLine } from "./flowWords";

describe("flowWords", () => {
  it("finishedLabel follows the document's own files, not the flow", () => {
    expect(finishedLabel([{ deliveryId: "d1", fileName: "invoice-1042.csv", delivered: false, destination: null }])).toBe("File ready");
    expect(finishedLabel([{ deliveryId: "d1", fileName: "a.csv", delivered: true, destination: "Accounting folder" }])).toBe("Sent to Accounting folder");
    expect(finishedLabel([{ deliveryId: "d1", fileName: "a.csv", delivered: true, destination: null }])).toBe("Sent");
    expect(madeLine([{ deliveryId: "d1", fileName: "invoice-1042.csv", delivered: false, destination: null }])).toBe("Made into invoice-1042.csv");
  });

  it("dayAt names the day plainly", () => {
    const now = new Date(2026, 10, 20, 15, 0);
    expect(dayAt(new Date(2026, 10, 20, 14, 2).toISOString(), now)).toBe("today at 14:02");
    expect(dayAt(new Date(2026, 10, 19, 9, 30).toISOString(), now)).toBe("yesterday at 09:30");
    expect(dayAt(new Date(2026, 10, 18, 14, 2).toISOString(), now)).toBe("on 18 November at 14:02");
  });
});
