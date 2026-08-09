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
 *   - formatLastSync: honest "Last synced / Last sync failed / Never synced" line,
 *     reading the recognised status set from src/lib/catalogSyncStatusManifest.ts so an
 *     unrecognised one can never inherit the success reading
 */

import type {
  CatalogHttpAuthConfig,
  CatalogHttpAuthMethod,
  CatalogSource,
  CatalogSourceProtocol,
} from "@/lib/api/catalogSources";
import { catalogSyncStatusFact } from "@/lib/catalogSyncStatusManifest";
import { serverReasonOrNull } from "@/lib/serverText";

/** Conventional default port per protocol (SFTP 22, FTP/FTPS 21; URL protocols 0). */
export function defaultPortForProtocol(protocol: CatalogSourceProtocol): number {
  if (protocol === "sftp") return 22;
  if (protocol === "ftp" || protocol === "ftps") return 21;
  return 0; // http/https/aes2fa are URL-based — port lives in the URL.
}

/** True for the URL-based protocols (http/https/aes2fa); false for the host-based file servers. */
export function protocolUsesUrl(protocol: CatalogSourceProtocol): boolean {
  return protocol === "http" || protocol === "https" || protocol === "aes2fa";
}

/** True for a vendor-connector protocol (custom auth via the backend fetcher seam). */
export function protocolIsVendor(protocol: CatalogSourceProtocol): boolean {
  return protocol === "aes2fa";
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

/**
 * How the last-sync line reads, and therefore what colour its dot is.
 *
 * `unknown` is NOT a spare slot — it is the reading for a `lastSyncStatus` that
 * src/lib/catalogSyncStatusManifest.ts has no row for. See {@link formatLastSync}.
 */
export type LastSyncTone = "ok" | "failed" | "running" | "unchanged" | "never" | "unknown";

export interface LastSyncLine {
  tone: LastSyncTone;
  text: string;
}

/**
 * Dot colour per tone. A Record, not the ternary chain the editor used to carry, for
 * one reason: a tone added to {@link LastSyncTone} without a colour here does not
 * compile, so a new tone can never inherit whichever branch happened to be last.
 *
 * `unknown` is amber — not green, and deliberately not the grey that `unchanged` and
 * `never` use. Grey would read as the same quiet "nothing to see here" as
 * "no change since last check", and a state nobody has classified is not reassuring;
 * it is the one that most wants an operator's eye. #C97A14 on the #F6F7FA container is
 * 3.12:1, over the 3:1 non-text floor (the dot carries no text, and the sentence beside
 * it stays #5E6779, unchanged).
 *
 * Asserted in catalogSourceHelpers.test.ts: only `ok` is ever the brand green.
 */
export const LAST_SYNC_DOT: Record<LastSyncTone, string> = {
  ok: "#2E8E3A",
  failed: "#B43838",
  running: "#1E66C9",
  unknown: "#C97A14",
  unchanged: "var(--ink-faint)",
  never: "var(--ink-faint)",
};

/**
 * A raw status is a TOKEN, not prose, so it is shown only when it looks like one:
 * word characters plus the few separators a backend actually uses, and short enough to
 * sit inside a sentence. Anything else — markup, a JSON blob, a paragraph — is named
 * generically instead.
 *
 * This is a shape gate, not a second sanitiser (see src/lib/serverText.ts on why there
 * is only ever one of those): `supplierReasonText` exists to make PROSE fit to read, and
 * would happily hand back a 320-character sentence, which is not a thing a status can be.
 */
const STATUS_TOKEN = /^[A-Za-z0-9 ._:-]{1,32}$/;

/**
 * The line for a status this build does not recognise.
 *
 * It says what the server reported and refuses the reading. Note what it does NOT do:
 * it never prints `lastSyncAt`. Printing a timestamp next to an outcome nobody has
 * classified is the other half of the original defect — the time was rendered as
 * "Last synced <rel>" regardless of whether the run behind it had succeeded.
 */
function unrecognisedSyncLine(raw: string): LastSyncLine {
  const named = STATUS_TOKEN.test(raw) ? `"${raw}"` : "an unrecognised state";
  return { tone: "unknown", text: `Sync reported ${named} — ProcuLink cannot tell whether it worked` };
}

/**
 * Honest last-sync status line. Never over-claims:
 *   - failed    → "Last sync failed: <msg>" (or generic if no message)
 *   - running   → "Syncing now…"
 *   - ok        → "Last synced <rel>"
 *   - unchanged → "Last checked <rel> — no change"
 *   - none      → "Never synced"
 *   - anything else → "Sync reported "<raw>" — ProcuLink cannot tell whether it worked"
 *
 * THE LAST ARM IS WHY THIS FUNCTION WAS REWRITTEN. `lastSyncStatus` is typed as the
 * four-member `CatalogSyncStatus` union, but that is a compile-time claim about a raw
 * JSON string, and this switch used to read `case "ok": default:` — one arm — so every
 * value the backend might add or rename came out as a green dot and "Last synced 3m
 * ago". The recognised set now lives in src/lib/catalogSyncStatusManifest.ts with its
 * backend provenance, and a status with no row there gets a reading that asserts
 * nothing.
 */
export function formatLastSync(
  source: Pick<CatalogSource, "lastSyncStatus" | "lastSyncAt" | "lastSyncError"> | null | undefined,
  now: number = Date.now(),
): LastSyncLine {
  // Trimmed: a blank or whitespace-only status is as absent as a null one.
  const raw = source?.lastSyncStatus?.trim() ?? "";
  if (!raw) {
    return { tone: "never", text: "Never synced" };
  }
  const fact = catalogSyncStatusFact(raw);
  if (!fact) return unrecognisedSyncLine(raw);

  const rel = relativeTime(source?.lastSyncAt, now);
  switch (fact.status) {
    case "failed": {
      // `lastSyncError` is whatever the catalog endpoint returned, so it can be an HTML error page
      // — and it is INTERPOLATED into the sentence below, which is how a whole document ends up
      // mid-prose. `serverReasonOrNull` returns the readable text inside it, or null when there is
      // none, in which case the line says only that the sync failed. See src/lib/serverText.ts.
      const msg = serverReasonOrNull(source?.lastSyncError);
      return { tone: "failed", text: msg ? `Last sync failed: ${msg}` : "Last sync failed" };
    }
    case "running":
      return { tone: "running", text: rel ? `Syncing (started ${rel})` : "Syncing now…" };
    case "unchanged":
      return { tone: "unchanged", text: rel ? `Last checked ${rel} — no change` : "No change since last check" };
    case "ok":
      return { tone: "ok", text: rel ? `Last synced ${rel}` : "Synced" };
    default:
      // Reachable only if the manifest gained a row and this switch did not. It fails
      // toward saying nothing rather than toward the success arm — the merge that put
      // a green dot on every unclassified state is not being reintroduced by omission.
      // catalogSourceHelpers.test.ts walks the manifest so this arm stays unreached.
      return unrecognisedSyncLine(fact.status);
  }
}
