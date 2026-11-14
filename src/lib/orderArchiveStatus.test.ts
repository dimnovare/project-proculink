import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/api-client";
import { downloadFailureMessage } from "./orderArchiveStatus";

describe("downloadFailureMessage", () => {
  it("tells each failure apart", () => {
    const msg = (s: number) => downloadFailureMessage(new ApiHttpError("x", s, null));
    expect(new Set([msg(410), msg(404), msg(429), msg(403)]).size).toBe(4);
    expect(downloadFailureMessage(new Error("boom"))).toMatch(/try again/i);
  });
});
