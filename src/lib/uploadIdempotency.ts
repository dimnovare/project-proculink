/**
 * Idempotency keys for browser purchase-order uploads.
 *
 * ## The defect this closes
 *
 * `POST /api/orders/upload` has honoured an `Idempotency-Key` header for a long
 * time — and the browser never sent one. So the one ingest path a human drives by
 * hand was the only one with no duplicate protection at all: a double-click, an
 * impatient second press while the spinner was up, or a retry after a flaky
 * connection each created a *separate* order, and each of those orders is
 * something a supplier can eventually be sent. Every automated path (REST
 * ingress, SFTP, S3, IMAP) already dedupes; the manual one did not.
 *
 * ## Why the key is minted per FILE SELECTION, not per click
 *
 * A key generated at click time is a fresh key on every click, which is the same
 * as no key: two clicks are two keys are two orders. The key has to be stable
 * across every attempt at sending *the same chosen file*, and it has to change
 * when the operator chooses again.
 *
 * The `File` object itself is exactly that boundary, so it is what we key on. A
 * `File` instance is minted by the browser when a file is picked or dropped and
 * held in React state from then on, so:
 *
 * - re-sending the same selection (a second click, the batch loop's rate-limit
 *   retry at `UploadWorkbench`'s `i--`) reuses the same instance → same key →
 *   the server returns the original order instead of creating a second one;
 * - picking a file again — even the byte-identical file, even the same path —
 *   produces a NEW `File` instance → new key → a new order, which is what a
 *   deliberate re-upload must do.
 *
 * That second half is why this is not a content hash. Hashing the bytes would
 * make a deliberate re-send of the same document within the server's 24-hour
 * window silently return the old order, which is a different bug pointing the
 * other way: the operator would believe they had sent something they had not.
 * "Same selection" is the intent we can actually observe, so it is the one we
 * encode.
 *
 * A `WeakMap` holds the association so a file the operator moved on from is not
 * retained; there is no cache to expire and nothing to clear on unmount.
 *
 * ## Why the supplier is part of the key
 *
 * The claim the server stores is `(org, key) → order`, and an order is routed to
 * exactly one supplier. If the key covered only the file, then changing the
 * supplier and re-sending the same selection would replay the FIRST order back —
 * reporting success while the newly chosen supplier received nothing. Scoping the
 * key to the supplier as well makes that a genuinely new order, and costs nothing
 * for the case this exists for (same file, same supplier, two presses).
 */

const keysByFile = new WeakMap<File, string>();

/** `crypto.randomUUID` where available, with a non-crypto fallback for old runtimes. */
function nonce(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // Fallback: only reached on runtimes without randomUUID. Uniqueness here does
  // not need to be unguessable — the key is scoped to one organisation and only
  // ever compared for equality — but it does need to not collide.
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The `Idempotency-Key` for sending `file` to `supplierId`.
 *
 * Stable for the lifetime of the `File` instance, so every retry of one selection
 * carries the same key. Returns a distinct key for a different file selection or
 * a different supplier.
 */
export function uploadIdempotencyKey(file: File, supplierId: string): string {
  let fileNonce = keysByFile.get(file);
  if (fileNonce === undefined) {
    fileNonce = nonce();
    keysByFile.set(file, fileNonce);
  }
  return `upload:${fileNonce}:${supplierId}`;
}
