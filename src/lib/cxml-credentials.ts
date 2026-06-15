import type { CxmlCredentialsInput } from "./api/types";

/** Editor field state for the cXML network credentials section. */
export interface CxmlCredentialsState {
  fromDomain: string;
  fromIdentity: string;
  toDomain: string;
  toIdentity: string;
  senderDomain: string;
  senderIdentity: string;
  senderSharedSecret: string;
}

const trimmedOrNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/**
 * Builds the cXML credentials payload for the delivery-config upsert.
 *
 * Returns `undefined` (→ omitted from the request → backend leaves any saved cXML credentials
 * untouched) for any non-cXML output format, so editing an HTTP/CSV supplier never clobbers cXML
 * credentials. The Sender shared secret is WRITE-ONLY: a blank field is omitted (the backend keeps
 * the saved secret), and only a freshly typed value is sent — mirroring the delivery-credentials
 * leave-blank-to-keep pattern.
 */
export function buildCxmlCredentials(
  outputFormat: string,
  state: CxmlCredentialsState,
): CxmlCredentialsInput | undefined {
  if (outputFormat !== "cxml") return undefined;

  const secret = state.senderSharedSecret.trim();
  return {
    fromDomain: trimmedOrNull(state.fromDomain),
    fromIdentity: trimmedOrNull(state.fromIdentity),
    toDomain: trimmedOrNull(state.toDomain),
    toIdentity: trimmedOrNull(state.toIdentity),
    senderDomain: trimmedOrNull(state.senderDomain),
    senderIdentity: trimmedOrNull(state.senderIdentity),
    // Omit when blank → JSON.stringify drops the key → backend keeps the saved secret.
    senderSharedSecret: secret === "" ? undefined : secret,
  };
}
