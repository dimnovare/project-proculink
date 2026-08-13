// What "Send a test now" actually does at the supplier — said per channel, before it is clicked.
//
// The UI promised only "Send a small test to check the connection." and "This sends one tiny sample
// file to the address you configured." Both describe the request and neither describes what the
// test LEAVES. It leaves something on every channel, and nothing cleans it up:
//
//   • SFTP / FTPS — a file lands in the supplier's live order directory and stays there. Nothing
//     deletes it. The dispatcher already knows this: a repeat test on an overwrite-off connection
//     refuses with "a file named '…' is already on the supplier's server — left by an earlier
//     test". That sentence is the system admitting the side effect AFTER the fact; this says it
//     first.
//   • Email / SMTP — a message arrives in a real inbox, at the address the supplier reads orders
//     at.
//   • HTTP / ERP — a request hits the supplier's live endpoint, which may record it.
//
// One sentence cannot be true of all three, which is why this is a table and not a paragraph. A
// generic "this sends a small test" is how the SFTP operator never learns a file is still sitting
// in the supplier's directory.
//
// The wording is deliberately consistent with the SFTP repeat-test refusal in the backend
// (SftpDeliveryDispatcher.RefusedTestFileExists) — an operator should meet the same fact in the
// same words whether they read it before the test or after it.
//
// NOT covered here, deliberately: deleting the artifact afterwards. A delete is a second operation
// that can fail on its own, may need permissions the account lacks, and a failed cleanup is a new
// confusing state. The product's answer is disclosure, not cleanup.

import type { DeliveryProtocol } from "@/lib/api/types";

/** The fixed name the backend's test artifact travels under, on every channel. */
export const TEST_ARTIFACT_FILENAME = "proculink-test.csv";

/** The subject line an email/SMTP test fire arrives under. Mirrors DeliveryTestArtifact.EmailSubject. */
export const TEST_ARTIFACT_EMAIL_SUBJECT =
  "ProcuLink connection test — this is not a purchase order";

export interface DeliveryTestDisclosure {
  /** What the test does at the supplier, and what it leaves behind. Always shown. */
  effect: string;
  /**
   * Where the test deliberately behaves differently from a real send, so an operator is not
   * surprised later. Null when there is no such difference on this channel.
   */
  caveat: string | null;
}

/**
 * Every protocol in the union, including `smtp`. `smtp` is retired from both pickers but is still
 * a member of `DeliveryProtocol` and still has saved configs in the wild, so it gets the real
 * sentence rather than a fallback — a retired channel that still sends is still sending.
 */
export const DELIVERY_TEST_DISCLOSURE: Record<DeliveryProtocol, DeliveryTestDisclosure> = {
  sftp: {
    effect:
      `This uploads a small sample file called ${TEST_ARTIFACT_FILENAME} to the folder you configured, ` +
      "on the supplier's own server. It is not an order, but nothing removes it afterwards — it stays " +
      "in that folder until someone deletes it.",
    caveat: null,
  },
  ftps: {
    effect:
      `This uploads a small sample file called ${TEST_ARTIFACT_FILENAME} to the folder you configured, ` +
      "on the supplier's own server. It is not an order, but nothing removes it afterwards — it stays " +
      "in that folder until someone deletes it.",
    caveat: null,
  },
  email: {
    effect:
      "This sends a real email to the addresses you configured, so it arrives in the supplier's inbox. " +
      `It is addressed "${TEST_ARTIFACT_EMAIL_SUBJECT}" and carries a small sample file, so whoever ` +
      "opens it can see straight away that no order is attached.",
    caveat:
      "The test does not use the subject and message you configured — those are kept for real orders.",
  },
  smtp: {
    effect:
      "This sends a real email to the addresses you configured, so it arrives in the supplier's inbox. " +
      `It is addressed "${TEST_ARTIFACT_EMAIL_SUBJECT}" and carries a small sample file, so whoever ` +
      "opens it can see straight away that no order is attached.",
    caveat:
      "The test does not use the subject and message you configured — those are kept for real orders.",
  },
  http: {
    effect:
      "This sends a real request to the URL you configured — the supplier's live endpoint, not a " +
      "practice one. It carries a small sample file rather than an order, but their system receives " +
      "it and may keep a record of it.",
    caveat: null,
  },
  erp_erply: {
    effect:
      "This sends a real request into the Erply account you configured — the supplier's live system, " +
      "not a practice one. It carries a small sample file rather than an order, but their system " +
      "receives it and may keep a record of it.",
    caveat: null,
  },
  erp_directo: {
    effect:
      "This sends a real request into the Directo account you configured — the supplier's live system, " +
      "not a practice one. It carries a small sample file rather than an order, but their system " +
      "receives it and may keep a record of it.",
    caveat: null,
  },
};

/**
 * The disclosure for a protocol. Accepts a bare string because saved configs carry whatever
 * protocol they were written with.
 *
 * Returns null for an unrecognised protocol rather than inventing a reassuring sentence. A channel
 * this file has not been taught about is one whose side effect nobody has established, and guessing
 * would be the same failure as the generic sentence this replaces — the caller renders nothing and
 * the operator is not told something untrue.
 */
export function deliveryTestDisclosure(protocol: string): DeliveryTestDisclosure | null {
  return DELIVERY_TEST_DISCLOSURE[protocol as DeliveryProtocol] ?? null;
}
