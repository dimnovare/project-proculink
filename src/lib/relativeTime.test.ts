import { describe, it, expect } from "vitest";
import { relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  const now = new Date("2026-06-12T12:00:00Z").getTime();
  it("returns null for missing/unparseable input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("not-a-date", now)).toBeNull();
  });
  it("buckets seconds/minutes/hours/days", () => {
    expect(relativeTime("2026-06-12T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-12T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-12T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("2d ago");
  });
});
