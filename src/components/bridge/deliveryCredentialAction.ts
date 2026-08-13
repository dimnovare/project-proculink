// B8 — deciding what to do with the saved SFTP secret when the auth method changes.
//
// The backend never returns the saved SFTP auth shape (the GET delivery-config response
// only carries a protocol-agnostic `hasCredentials` boolean and a masked `********`
// display — see DeliveryConfig in lib/api/types). So the editor can't read "the saved
// secret is a password" from the server. What it CAN know is the auth method the editor
// LOADED with for an existing config (the shape the stored secret corresponds to).
//
// The bug this guards (founder-reported): a supplier saved with SFTP *password* auth; the
// user switches "Auth method" to *Private key*, leaves the key blank, and saves. The old
// editor returned `null` credentials (the keep-on-blank shortcut), so the backend kept the
// OLD PASSWORD — the auth-mode change was silently discarded while the editor still showed a
// green "saved" state. The fix: when the selected method differs from the saved shape and no
// new secret is entered, we must NOT silently keep the stale (wrong-shape) secret — block the
// save and ask for the new secret instead.

export type SftpAuthMode = "password" | "key";

export type CredentialAction =
  /** No saved secret applies to the selected method, but a fresh one was entered → save it. */
  | { kind: "replace" }
  /** Re-saving the SAME shape with no new secret → keep the stored one (existing behaviour). */
  | { kind: "keep" }
  /**
   * The selected method differs from the saved shape and no new secret was entered → the
   * stored secret is the wrong shape for the chosen method, so keeping it would silently
   * discard the auth-mode change. Block the save until the user enters the new secret.
   */
  | { kind: "block"; message: string };

export interface DecideSftpArgs {
  /** The auth method currently selected in the UI. */
  selected: SftpAuthMode;
  /**
   * The auth method the editor loaded with for the SAVED config (the shape the stored secret
   * corresponds to). Null when there is no saved config yet (a brand-new supplier).
   */
  loaded: SftpAuthMode | null;
  /** True when a fresh secret for the selected method was entered this session. */
  hasNewSecret: boolean;
  /** True when the backend reported a saved credential (DeliveryConfig.hasCredentials). */
  hasSavedCredentials: boolean;
}

/**
 * Pure decision for the SFTP credential write. Mirrors the existing keep/replace logic but
 * adds the missing "shape changed" guard so a stale secret of the wrong shape is never
 * silently kept.
 *
 *  • A fresh secret was entered            → replace (write it).
 *  • No saved credential at all            → replace (nothing to keep; an empty secret is the
 *                                            user's choice and the same-shape path handles it).
 *  • Same shape as saved, no new secret    → keep (the documented re-save-without-re-entering).
 *  • Different shape from saved, no secret  → block (don't keep the wrong-shape secret).
 */
export function decideSftpCredentialAction({
  selected,
  loaded,
  hasNewSecret,
  hasSavedCredentials,
}: DecideSftpArgs): CredentialAction {
  if (hasNewSecret) return { kind: "replace" };
  if (!hasSavedCredentials || loaded === null) return { kind: "replace" };
  if (loaded === selected) return { kind: "keep" };
  return {
    kind: "block",
    message:
      selected === "key"
        ? "Enter the private key for the new auth method — switching from password auth needs a new key."
        : "Enter the password for the new auth method — switching from key auth needs a new password.",
  };
}

// ── The same problem, one protocol over: HTTP / Erply header-style authentication ──────────
//
// SFTP (above) at least knows the shape it opened with, because there are only two shapes and
// the editor always opens a saved one in "password" mode. The HTTP auth selector has no such
// luck, and the consequences are worse.
//
// Everything the HTTP auth block collects — the auth type itself, the API-key HEADER NAME, the
// Basic username, and every OAuth2 field except the secret (token URL, client id, scope, grant
// type, token response field, request format, client auth style) — is written into the SAME
// encrypted `credentialsJson` blob as the secret. The GET response carries none of it back:
// `DeliveryConfig` exposes `hasCredentials: boolean` and `credentialsDisplay`, and the backend
// sets the latter to a CONSTANT mask (`hasCredentials ? "********" : null`,
// DeliveryConfigService.cs). There is no field on the contract that says which auth type is
// stored, or on which header, or against which token URL.
//
// So the editor opens a supplier saved with Bearer auth showing "Auth type: None" — beside a
// green "saved credential masked" note, which is the same screen asserting both that a
// credential exists and that there is no authentication. The display half of that is merely a
// lie. The write half corrupts data:
//
//   • A supplier authenticated by API key on a custom header (`Authorization`) is re-opened to
//     rotate the key. The header input shows its DEFAULT, `X-Api-Key`, because nothing filled
//     it in. The operator pastes the new key and saves — and the custom header is overwritten
//     with `X-Api-Key`. Delivery then presents the key on a header the supplier does not read.
//   • Worse for OAuth2: rotating only the client secret rewrites `tokenUrl`, `clientId` and
//     `scope` as empty strings, because those inputs were never filled in either. The token
//     fetch afterwards has no URL to call.
//   • Basic auth loses its username the same way.
//
// The frontend cannot fix this by restoring the saved values: they are not on the contract, and
// inventing them is exactly the failure this repo keeps paying for. What it CAN do is refuse to
// pretend. Two rules:
//
//   1. While the operator has not chosen an auth type this session, the saved shape is UNKNOWN.
//      Do not claim one, and write nothing — `credentialsJson: null` keeps whatever is stored.
//   2. Once they DO choose one for a supplier that already has a credential, they are replacing
//      the whole stored record, non-secret fields included. Require the fields that record
//      needs, rather than silently writing this form's defaults over them.

export type HttpAuthType = "none" | "apikey" | "bearer" | "basic" | "oauth2";

export interface DecideHttpArgs {
  /** The auth type currently selected in the UI. */
  selected: HttpAuthType;
  /**
   * False until the operator picks an auth type this session. False + a saved credential means
   * the stored shape is unknown, which is NOT the same as "none".
   */
  shapeChosen: boolean;
  /** True when the backend reported a saved credential (DeliveryConfig.hasCredentials). */
  hasSavedCredentials: boolean;
  /** The auth fields as typed, untrimmed. Only the ones the selected type needs are read. */
  fields: {
    apiKeyHeader: string;
    apiKeyValue: string;
    bearerToken: string;
    basicUsername: string;
    basicPassword: string;
    tokenUrl: string;
    oauthClientId: string;
    oauthClientSecret: string;
  };
}

/** The non-secret + secret inputs each auth type writes into the stored credential. */
const HTTP_AUTH_REQUIRED: Record<
  HttpAuthType,
  Array<{ key: keyof DecideHttpArgs["fields"]; label: string }>
> = {
  none: [],
  apikey: [
    { key: "apiKeyHeader", label: "Header" },
    { key: "apiKeyValue", label: "Value" },
  ],
  bearer: [{ key: "bearerToken", label: "Token" }],
  basic: [
    { key: "basicUsername", label: "Username" },
    { key: "basicPassword", label: "Password" },
  ],
  oauth2: [
    { key: "tokenUrl", label: "Token URL" },
    { key: "oauthClientId", label: "Client ID" },
    { key: "oauthClientSecret", label: "Client secret" },
  ],
};

/**
 * Pure decision for the HTTP / Erply credential write.
 *
 *  • Saved credential, no auth type chosen this session → keep (write null; shape unknown).
 *  • No saved credential                                → replace (first-time setup, nothing to lose).
 *  • Chosen type, saved credential, all fields present  → replace (a deliberate, complete rewrite).
 *  • Chosen type, saved credential, a field left blank  → block (that blank would overwrite a
 *                                                         stored value this screen cannot show).
 */
export function decideHttpCredentialAction({
  selected,
  shapeChosen,
  hasSavedCredentials,
  fields,
}: DecideHttpArgs): CredentialAction {
  if (hasSavedCredentials && !shapeChosen) return { kind: "keep" };
  if (!hasSavedCredentials) return { kind: "replace" };

  const missing = HTTP_AUTH_REQUIRED[selected]
    .filter(({ key }) => fields[key].trim() === "")
    .map(({ label }) => label);
  if (missing.length === 0) return { kind: "replace" };

  return {
    kind: "block",
    message:
      `Saving replaces this supplier's whole stored credential, and ${formatList(missing)} ` +
      `${missing.length === 1 ? "is" : "are"} still blank. Fill ${missing.length === 1 ? "it" : "them"} ` +
      `in, or change the auth type back to leave the saved credential untouched.`,
  };
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
