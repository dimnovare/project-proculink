/**
 * catalogSourceHelpers.ts — pure helpers for the catalog pull-source editor.
 *
 * Extracted so they can be unit-tested without rendering the component:
 *   - defaultPortForProtocol: protocol → conventional default port
 *   - protocolUsesUrl: http/https are URL-based; sftp/ftp/ftps are host-based
 *   - buildAuthConfigPayload: write-only authConfig per HTTP auth method
 *     (null = keep stored, object = set/clear), mirroring the password sentinel
 *   - formatLastSync: honest "Last synced / Last sync failed / Never synced" line
 */

import type {
  CatalogHttpAuthConfig,
  CatalogHttpAuthMethod,
  CatalogSource,
  CatalogSourceProtocol,
} from "@/lib/api/catalogSources";

/** Conventional default port per protocol (SFTP 22, FTP/FTPS 21; URL protocols 0). */
export function defaultPortForProtocol(protocol: CatalogSourceProtocol): number {
  if (protocol === "sftp") return 22;
  if (protocol === "ftp" || protocol === "ftps") return 21;
  return 0; // http/https are URL-based — port lives in the URL.
}

/** True for the URL-based protocols (http/https); false for the host-based file servers. */
export function protocolUsesUrl(protocol: CatalogSourceProtocol): boolean {
  return protocol === "http" || protocol === "https";
}

/** Form-state inputs the auth-config builder reads (one field set per method). */
export interface CatalogAuthFormState {
  authMethod: CatalogHttpAuthMethod;
  apiKeyHeader: string;
  apiKeyValue: string;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

/**
 * Builds the write-only `authConfig` payload for an HTTP catalog source, mirroring
 * the masked-password sentinel:
 *
 *   - `none`            → null when a config is already stored (the backend drops it
 *                         on save), else an empty object so a fresh save is explicit.
 *   - any other method  → when the method's secret field is blank AND a config is
 *                         already stored, return null (keep the stored secret).
 *                         Otherwise return the object with the entered values.
 *
 * Only the fields the selected method uses are emitted — never cross-method bleed.
 */
export function buildAuthConfigPayload(
  form: CatalogAuthFormState,
  hasAuthConfig: boolean,
): CatalogHttpAuthConfig | null {
  switch (form.authMethod) {
    case "none":
      // 'none' carries no secret. Keep null when one was stored (backend clears it),
      // else send an empty object so the save is unambiguous.
      return hasAuthConfig ? null : {};
    case "apikey": {
      if (!form.apiKeyValue && hasAuthConfig) return null; // keep stored
      return {
        apiKeyHeader: form.apiKeyHeader.trim() || "X-Api-Key",
        apiKeyValue: form.apiKeyValue,
      };
    }
    case "bearer": {
      if (!form.bearerToken && hasAuthConfig) return null;
      return { bearerToken: form.bearerToken };
    }
    case "basic": {
      if (!form.basicPassword && hasAuthConfig) return null;
      return { basicUsername: form.basicUsername.trim(), basicPassword: form.basicPassword };
    }
    case "oauth2_client_credentials": {
      if (!form.clientSecret && hasAuthConfig) return null;
      return {
        tokenUrl: form.tokenUrl.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret,
        ...(form.scope.trim() ? { scope: form.scope.trim() } : {}),
      };
    }
    default:
      return null;
  }
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
