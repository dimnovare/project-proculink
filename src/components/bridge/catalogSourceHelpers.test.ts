import { describe, it, expect } from "vitest";
import { defaultPortForProtocol, formatLastSync, relativeTime } from "./catalogSourceHelpers";
import type { CatalogSource } from "@/lib/api/catalogSources";

describe("defaultPortForProtocol", () => {
  it("returns 22 for sftp", () => {
    expect(defaultPortForProtocol("sftp")).toBe(22);
  });
  it("returns 21 for ftp and ftps", () => {
    expect(defaultPortForProtocol("ftp")).toBe(21);
    expect(defaultPortForProtocol("ftps")).toBe(21);
  });
});

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

function src(partial: Partial<CatalogSource>): CatalogSource {
  return {
    protocol: "sftp",
    host: "h",
    port: 22,
    path: "/p",
    username: "u",
    hasPassword: true,
    schedule: 24,
    isEnabled: true,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    ...partial,
  };
}

describe("formatLastSync", () => {
  const now = new Date("2026-06-12T12:00:00Z").getTime();

  it("reports never synced when there is no status", () => {
    expect(formatLastSync(null, now)).toEqual({ tone: "never", text: "Never synced" });
    expect(formatLastSync(src({ lastSyncStatus: null }), now).tone).toBe("never");
  });

  it("surfaces the failure message honestly", () => {
    const line = formatLastSync(
      src({ lastSyncStatus: "failed", lastSyncAt: "2026-06-12T10:00:00Z", lastSyncError: "Connection timed out" }),
      now,
    );
    expect(line.tone).toBe("failed");
    expect(line.text).toBe("Last sync failed: Connection timed out");
  });

  it("falls back to a generic failure when no message is present", () => {
    expect(formatLastSync(src({ lastSyncStatus: "failed", lastSyncError: null }), now).text).toBe(
      "Last sync failed",
    );
  });

  it("renders running, unchanged, and ok states with relative time", () => {
    expect(formatLastSync(src({ lastSyncStatus: "running", lastSyncAt: "2026-06-12T11:55:00Z" }), now).text).toBe(
      "Syncing (started 5m ago)",
    );
    expect(formatLastSync(src({ lastSyncStatus: "unchanged", lastSyncAt: "2026-06-12T10:00:00Z" }), now).text).toBe(
      "Last checked 2h ago — no change",
    );
    expect(formatLastSync(src({ lastSyncStatus: "ok", lastSyncAt: "2026-06-12T11:00:00Z" }), now).text).toBe(
      "Last synced 1h ago",
    );
  });
});
