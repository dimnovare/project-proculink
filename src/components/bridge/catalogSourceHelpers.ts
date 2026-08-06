/**
 * catalogSourceHelpers.ts — pure helpers for the catalog pull-source editor.
 *
 * Extracted so they can be unit-tested without rendering the component:
 *   - defaultPortForProtocol: protocol → conventional default port
 *   - protocolUsesUrl: http/https are URL-based; sftp/ftp/ftps are host-based
 *   - hasSavedAuthSecretForMethod: "leave blank to keep" is only honest when the
 *     SAVED secret belongs to the SAME auth method the form currently shows
 *   - httpAuthFormSatisfied: save-gate — keep needs a method-matched saved secret;
 *     replace needs the full usable field set (nothing typed is silently dropped)
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
import { serverReasonOrNull } from "@/lib/serverText";

/** Conventional default port per protocol (SFTP 22, FTP/FTPS 21; URL protocols 0). */
export function defaultPortForProtocol(protocol: CatalogSourceProtocol): number {
  if (protocol === "sftp") return 22;
  if (protocol === "ftp" || protocol === "ftps") return 21;
  return 0; // http/https/logicom are URL-based — port lives in the URL.
}

/** True for the URL-based protocols (http/https/logicom); false for the host-based file servers. */
export function protocolUsesUrl(protocol: CatalogSourceProtocol): boolean {
  return protocol === "http" || protocol === "https" || protocol === "logicom";
}

/** True for a vendor-connector protocol (custom auth via the backend fetcher seam). */
export function protocolIsVendor(protocol: CatalogSourceProtocol): boolean {
  return protocol === "logicom";
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
 * True when the SAVED source has an encrypted auth secret for the SAME method the
 * form currently shows — the ONLY situation where "leave blank to keep" is honest.
 *
 * Why method-matched: the backend keeps the stored (encrypted) blob whenever
 * `authConfig` is null, and `HttpAuthApplier` applies the blob's OWN `type`
 * discriminator at fetch time — so switching e.g. bearer → basic while sending
 * null would save `authMethod: "basic"` but still authenticate with the old
 * bearer token. A method switch must always re-enter credentials.
 */
export function hasSavedAuthSecretForMethod(
  source: Pick<CatalogSource, "hasAuthConfig" | "authMethod"> | null | undefined,
  method: CatalogHttpAuthMethod,
): boolean {
  return method !== "none" && Boolean(source?.hasAuthConfig) && source?.authMethod === method;
}

/**
 * Save-gate for the HTTP auth form. Two honest paths per method:
 *
 *   - KEEP: the secret fields are blank AND a secret for THIS method is saved
 *     (`hasSavedSecret` — compute it with {@link hasSavedAuthSecretForMethod}).
 *   - REPLACE: the user typed something → the full usable field set is required
 *     (apikey: header + value; bearer: token; basic: password, username optional;
 *     oauth2: token URL + client ID + client secret) so a partial edit is never
 *     silently discarded by the keep-sentinel.
 */
export function httpAuthFormSatisfied(
  form: CatalogAuthFormState,
  hasSavedSecret: boolean,
): boolean {
  switch (form.authMethod) {
    case "none":
      return true;
    case "apikey": {
      if (form.apiKeyValue.length > 0) return form.apiKeyHeader.trim().length > 0;
      // Header-only edits cannot merge with the stored value (the header lives inside
      // the encrypted blob) — changing it requires re-entering the value too.
      const header = form.apiKeyHeader.trim();
      return hasSavedSecret && (header === "" || header === "X-Api-Key");
    }
    case "bearer":
      return form.bearerToken.length > 0 || hasSavedSecret;
    case "basic": {
      if (form.basicUsername.trim() || form.basicPassword) return form.basicPassword.length > 0;
      return hasSavedSecret;
    }
    case "oauth2_client_credentials": {
      const editing = Boolean(
        form.tokenUrl.trim() || form.clientId.trim() || form.clientSecret || form.scope.trim(),
      );
      if (editing) {
        return Boolean(form.tokenUrl.trim() && form.clientId.trim() && form.clientSecret);
      }
      return hasSavedSecret;
    }
    default:
      return false;
  }
}

/**
 * Builds the write-only `authConfig` payload for an HTTP catalog source, mirroring
 * the masked-password sentinel:
 *
 *   - `none`            → null when a config is already stored (the backend drops it
 *                         on save), else an empty object so a fresh save is explicit.
 *   - any other method  → when the method's secret field is blank AND a config is
 *                         already stored FOR THIS METHOD, return null (keep the
 *                         stored secret). Otherwise return the entered values.
 *
 * `hasSavedSecret` MUST be the method-matched check ({@link hasSavedAuthSecretForMethod}),
 * never the raw `hasAuthConfig` flag — see that helper for the method-switch footgun.
 * Only the fields the selected method uses are emitted — never cross-method bleed.
 */
export function buildAuthConfigPayload(
  form: CatalogAuthFormState,
  hasSavedSecret: boolean,
): CatalogHttpAuthConfig | null {
  switch (form.authMethod) {
    case "none":
      // 'none' carries no secret. The backend clears any stored config for 'none'
      // regardless; send null when one was stored, an empty object on a fresh save.
      return hasSavedSecret ? null : {};
    case "apikey": {
      if (!form.apiKeyValue && hasSavedSecret) return null; // keep stored
      return {
        apiKeyHeader: form.apiKeyHeader.trim() || "X-Api-Key",
        apiKeyValue: form.apiKeyValue,
      };
    }
    case "bearer": {
      if (!form.bearerToken && hasSavedSecret) return null;
      return { bearerToken: form.bearerToken };
    }
    case "basic": {
      if (!form.basicPassword && hasSavedSecret) return null;
      return { basicUsername: form.basicUsername.trim(), basicPassword: form.basicPassword };
    }
    case "oauth2_client_credentials": {
      if (!form.clientSecret && hasSavedSecret) return null;
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
      // `lastSyncError` is whatever the catalog endpoint returned, so it can be an HTML error page
      // — and it is INTERPOLATED into the sentence below, which is how a whole document ends up
      // mid-prose. `serverReasonOrNull` returns the readable text inside it, or null when there is
      // none, in which case the line says only that the sync failed. See src/lib/serverText.ts.
      const msg = serverReasonOrNull(source.lastSyncError);
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
