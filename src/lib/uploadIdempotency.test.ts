import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "@/lib/api-client";
import { uploadIdempotencyKey } from "@/lib/uploadIdempotency";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, VERBATIM.
//
// `realUploadPurchaseOrder` posted the file and nothing else:
//
//     const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/upload`, {
//       method: "POST", headers: await authHeader(), body: formData,
//     }, 60000);
//
// `OrdersController.Upload` reads an `Idempotency-Key` header and, when it finds
// one, returns the order it already created instead of making a second. The
// browser never sent one. So the single ingest path a human drives by hand was
// the ONLY one with no duplicate protection — REST ingress, SFTP, S3 and IMAP all
// dedupe — and a second press of Send, or a retry after a dropped connection,
// produced a second order. Orders are what get sent to suppliers, which is why
// this is the finding that can reach a third party.
//
// WHAT THIS GUARD PINS
//
//   1. The header goes out. An upload that carries no `Idempotency-Key` is the
//      defect, restored.
//   2. The key is stable per FILE SELECTION. This is the half that a plausible
//      "fix" gets wrong: minting a key inside the request function, or at click
//      time, sends a FRESH key on every attempt, which dedupes nothing while
//      looking like it does. Two sends of one selection must carry one key.
//   3. Choosing again is a new order. A content hash would pass (1) and (2) and
//      still be wrong — it would swallow a deliberate re-send of the same
//      document inside the server's 24-hour window and report the OLD order as
//      though the new send had happened.
//
// (2) and (3) are asserted against each other on purpose: a key stable enough to
// satisfy (2) is one press away from being too stable for (3).
// ─────────────────────────────────────────────────────────────────────────────

const SUPPLIER = "3f9a1c22-88de-4c1a-9a77-1b0e5d6f4c30";
const OTHER_SUPPLIER = "a1b2c3d4-0000-4444-8888-99887766aabb";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s before giving up; a loaded
  // stub with no session short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ order: { id: "ord-1", lines: [] }, validationMessages: [] }),
    text: async () => "{}",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

/** A distinct File instance — what the browser mints on each pick or drop. */
function pick(name = "po.csv", body = "poNumber,qty\nPO-1,2\n"): File {
  return new File([body], name, { type: "text/csv" });
}

/** The `Idempotency-Key` sent on the Nth fetch call (0-indexed). */
function keySentOn(call: number): string | undefined {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
}

describe("browser upload carries an idempotency key", () => {
  it("sends an Idempotency-Key header at all", async () => {
    await apiClient.uploadPurchaseOrder(pick(), SUPPLIER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Anti-vacuity: assert we really inspected an upload request, so a future
    // refactor that stops calling fetch fails here rather than passing silently.
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/orders/upload");
    expect(keySentOn(0)).toBeTruthy();
  });

  it("keeps the Authorization header it already sent", async () => {
    // The header object is spread, not replaced. A fix that assigned
    // `headers: { "Idempotency-Key": ... }` would sign every upload out.
    (window as unknown as { Clerk: unknown }).Clerk = {
      loaded: true,
      session: { getToken: async () => "tok-123" },
    };

    await apiClient.uploadPurchaseOrder(pick(), SUPPLIER);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("sends the SAME key when one selection is sent twice", async () => {
    // The double-click, and the batch loop's rate-limit retry (which re-sends the
    // identical File instance). A per-request or per-click key fails here.
    const file = pick();

    await apiClient.uploadPurchaseOrder(file, SUPPLIER);
    await apiClient.uploadPurchaseOrder(file, SUPPLIER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keySentOn(0)).toBeTruthy();
    expect(keySentOn(1)).toBe(keySentOn(0));
  });

  it("sends a DIFFERENT key when the same document is chosen again", async () => {
    // Byte-identical content and an identical filename — only the selection is
    // new. This must still be a new order: the operator meant to send it again.
    // A content-hash key fails here.
    await apiClient.uploadPurchaseOrder(pick("po.csv"), SUPPLIER);
    await apiClient.uploadPurchaseOrder(pick("po.csv"), SUPPLIER);

    expect(keySentOn(0)).toBeTruthy();
    expect(keySentOn(1)).not.toBe(keySentOn(0));
  });

  it("sends a DIFFERENT key when the supplier changes", async () => {
    // The stored claim is (org, key) → order, and an order is routed to exactly
    // one supplier. Replaying the first order back here would report success
    // while the newly chosen supplier received nothing.
    const file = pick();

    await apiClient.uploadPurchaseOrder(file, SUPPLIER);
    await apiClient.uploadPurchaseOrder(file, OTHER_SUPPLIER);

    expect(keySentOn(1)).not.toBe(keySentOn(0));
  });
});

describe("uploadIdempotencyKey", () => {
  it("is stable across calls for one File instance", () => {
    const file = pick();
    expect(uploadIdempotencyKey(file, SUPPLIER)).toBe(uploadIdempotencyKey(file, SUPPLIER));
  });

  it("distinguishes two File instances with identical content", () => {
    expect(uploadIdempotencyKey(pick(), SUPPLIER)).not.toBe(
      uploadIdempotencyKey(pick(), SUPPLIER),
    );
  });

  it("stays within the length the API accepts", () => {
    // OrdersController.ExtractIdempotencyKey DROPS a key longer than
    // MaxIdempotencyKeyLength — silently, back to no protection at all. Pinned
    // well under it so a longer prefix cannot disable dedupe without failing.
    expect(uploadIdempotencyKey(pick(), SUPPLIER).length).toBeLessThanOrEqual(200);
  });
});
