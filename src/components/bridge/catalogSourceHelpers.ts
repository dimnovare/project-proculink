/**
 * catalogSourceHelpers.ts — pure helpers for the catalog pull-source editor.
 *
 * Extracted so they can be unit-tested without rendering the component:
 *   - defaultPortForProtocol: protocol → conventional default port
 *   - formatLastSync: honest "Last synced / Last sync failed / Never synced" line
 */

import type { CatalogSource, CatalogSourceProtocol } from "@/lib/api/catalogSources";

/** Conventional default port per protocol (SFTP 22, FTP/FTPS 21). */
export function defaultPortForProtocol(protocol: CatalogSourceProtocol): number {
  return protocol === "sftp" ? 22 : 21;
}

/**
 * Relative "X ago" rendering of a past timestamp. Returns null for a missing or
 * unparseable input. Mirrors the minute/hour/day buckets used elsewhere (Inbox).
 */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export interface LastSyncLine {
  /** "ok" | "failed" | "running" | "unchanged" | "never" — drives the dot colour. */
  tone: "ok" | "failed" | "running" | "unchanged" | "never";
  text: string;
}

/**
 * Honest last-sync status line. Never over-claims:
 *   - failed  → "Last sync failed: <msg>" (or generic if no message)
 *   - running → "Syncing now…"
 *   - ok      → "Last synced <rel>"
 *   - unchanged → "Last checked <rel> — no change"
 *   - none    → "Never synced"
 */
export function formatLastSync(
  source: Pick<CatalogSource, "lastSyncStatus" | "lastSyncAt" | "lastSyncError"> | null | undefined,
  now: number = Date.now(),
): LastSyncLine {
  if (!source || !source.lastSyncStatus) {
    return { tone: "never", text: "Never synced" };
  }
  const rel = relativeTime(source.lastSyncAt, now);
  switch (source.lastSyncStatus) {
    case "failed": {
      const msg = source.lastSyncError?.trim();
      return { tone: "failed", text: msg ? `Last sync failed: ${msg}` : "Last sync failed" };
    }
    case "running":
      return { tone: "running", text: rel ? `Syncing (started ${rel})` : "Syncing now…" };
    case "unchanged":
      return { tone: "unchanged", text: rel ? `Last checked ${rel} — no change` : "No change since last check" };
    case "ok":
    default:
      return { tone: "ok", text: rel ? `Last synced ${rel}` : "Synced" };
  }
}
