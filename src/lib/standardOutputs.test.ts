import { describe, expect, it } from "vitest";
import { KSEF, standardFamilies } from "@/lib/standardOutputs";

describe("standardFamilies", () => {
  it("offers the KSeF file only when ksefOn, and only as an invoice", () => {
    const ids = (f: { id: string }[]) => f.map((x) => x.id);
    const [ksef] = [...KSEF];
    expect(ids(standardFamilies(true, false).invoices)).not.toContain(ksef);
    expect(ids(standardFamilies(true).invoices)).not.toContain(ksef);
    const on = standardFamilies(false, true);
    expect(ids(on.invoices)).toEqual([ksef]);
    expect(on.invoices[0]).toMatchObject({ name: "KSeF invoice file", creditNote: null, version: "FA(3) 1-0E" });
    expect(ids(on.orders)).not.toContain(ksef);
    expect(ids(standardFamilies(true, true).orders)).not.toContain(ksef);
  });
});
