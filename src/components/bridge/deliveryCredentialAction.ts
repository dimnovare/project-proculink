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
