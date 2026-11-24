import { afterEach, describe, expect, it, vi } from "vitest";
import { savePreview } from "./saveBlob";

const bytes = (blob: Blob) => new Promise<number[]>((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve([...new Uint8Array(r.result as ArrayBuffer)]);
  r.readAsArrayBuffer(blob);
});

describe("savePreview", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts a CSV's byte-order mark back, and adds none when the file has none", async () => {
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { saved.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const p = { contentType: "text/csv", fileName: "a.csv", content: "a;b", lookupMisses: [] };
    savePreview({ ...p, byteOrderMark: true });
    savePreview(p);
    expect(await bytes(saved[0])).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x3b, 0x62]);
    expect(await bytes(saved[1])).toEqual([0x61, 0x3b, 0x62]);
  });
});
