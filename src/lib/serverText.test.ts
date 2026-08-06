import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A server response body must never reach operator-facing prose as markup.
 *
 * WHY THIS FILE EXISTS. `docs/qa/2026-08-01-wp-39-authenticated-production-pass.md` §4.4: an
 * operator was shown `<!DOCTYPE html> <html> <head>` as the reason their order failed. FE #94 was
 * written to prevent exactly that and did not, because it wrapped one operand while the markup
 * arrived on another. FE #98 fixed that operand and, looking for more, found a THIRD door one click
 * away — this one:
 *
 *   `api-client.ts` builds `error ?? \`${fallback}: ${responseText}\``, and `parseApiErrorBody`
 *   only lifts a sentence when the body is JSON carrying a conventional field. A Railway or
 *   Vercel 502 answers with an HTML error page, so the raw markup lands in
 *   `ApiHttpError.message` — and ~80 call sites render that message to users.
 *
 * Two per-site fixes have now failed to close this defect class. So the guard here is on the
 * CONSTRUCTION boundary, not on any render site: an `ApiHttpError` cannot be built carrying
 * markup, whatever throw site builds it, including one written tomorrow.
 *
 * The companion file `src/components/bridge/serverBodyNeverRendered.test.tsx` pins that the render
 * sites really show the cleaned text — because a sanitiser nothing calls is how this survived twice.
 */

import { ApiHttpError } from "@/lib/api/core";
import { serverReason } from "@/lib/serverText";
import { isPlanGateError, planGateUpgradeUrl } from "@/lib/planGate";
import { isRequestTimeout } from "@/lib/apiFailure";
import {
  PRODUCTION_404_ERROR_MESSAGE,
} from "@/components/bridge/problem/__tests__/productionDefectStrings";

/**
 * A real gateway error page, not a tidied one.
 *
 * Railway and Vercel both answer a dead upstream with a full HTML document. The leading comment is
 * the part that matters: `<[^>]*>` stops at the FIRST `>`, and this comment contains one, so a
 * naive tag strip eats `<!-- Tip: … qty &gt;` and leaves the tail (`10 … -->`) on the operator's
 * screen. FE #98 found that leak; it is pinned explicitly below.
 */
const GATEWAY_502_HTML =
  "<!-- Tip: set the Accept header to application/json to get errors in JSON format. -->" +
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title>" +
  "<style>body { font-family: sans-serif }</style></head>" +
  "<body><center><h1>502 Bad Gateway</h1></center><hr><center>railway-edge</center></body></html>";

/** A comment whose body contains a literal `>` — the exact shape that leaked past the tag regex. */
const COMMENT_WITH_GT =
  "<!-- if qty > 10 then reject: SENTINEL_TAIL -->" +
  "<!DOCTYPE html><html><body><p>The upstream did not respond.</p></body></html>";

/** The same, entity-encoded — decoding runs after tag stripping, so this is a second way in. */
const COMMENT_WITH_ENTITY_GT =
  "<!-- if qty &gt; 10 then reject: SENTINEL_TAIL -->" +
  "<!DOCTYPE html><html><body><p>The upstream did not respond.</p></body></html>";

/** Every character a person must never be shown as an explanation. */
function expectNoMarkup(text: string) {
  expect(text).not.toContain("<!DOCTYPE");
  expect(text).not.toContain("<html");
  expect(text).not.toContain("<head");
  expect(text).not.toContain("<body");
  expect(text).not.toContain("<!--");
  expect(text).not.toContain("-->");
  expect(text).not.toContain("<p>");
  expect(text).not.toContain("SENTINEL_TAIL");
}

describe("ApiHttpError cannot be constructed carrying markup", () => {
  it("strips a gateway's HTML error page out of the message", () => {
    const err = new ApiHttpError(`We couldn't build the output file: ${GATEWAY_502_HTML}`, 502);
    expectNoMarkup(err.message);
    // Cleaned, not silenced — the operator still learns what came back.
    expect(err.message).toContain("502");
  });

  it("drops a comment whole, including the tail after a literal '>' inside it", () => {
    // The naive-regex leak. `<[^>]*>` would consume up to the FIRST '>' and leave the rest.
    const err = new ApiHttpError(`Upload failed: ${COMMENT_WITH_GT}`, 502);
    expectNoMarkup(err.message);
    expect(err.message).toContain("The upstream did not respond");
  });

  it("drops a comment whose '>' arrives as &gt;", () => {
    const err = new ApiHttpError(`Upload failed: ${COMMENT_WITH_ENTITY_GT}`, 502);
    expectNoMarkup(err.message);
    expect(err.message).toContain("The upstream did not respond");
  });

  it("shows the production string without its markup", () => {
    // The literal value order b56ddb85-5b14-4367-bcc1-6f62a391a6a5 put on screen.
    const err = new ApiHttpError(PRODUCTION_404_ERROR_MESSAGE, 404);
    expectNoMarkup(err.message);
    expect(err.message).toContain("HTTP 404");
    // A lead-in with nothing behind it reads as a broken screen.
    expect(err.message).not.toContain("Response summary");
  });

  it("never leaves a body that cleans to nothing legible sitting in the message", () => {
    // A page whose visible text is only chrome. Saying nothing beats saying markup, so the
    // constructor substitutes copy written for a human rather than passing the raw string.
    const err = new ApiHttpError("<html><head><style>.a{color:red}</style></head><body></body></html>", 503);
    expectNoMarkup(err.message);
    expect(err.message).toContain("503");
  });

  it("leaves a bare JSON body byte-for-byte, because planGateUpgradeUrl greps it", () => {
    // This assertion is the scar from writing the fix. An earlier version let the sanitiser lift
    // the `error` field out of a JSON message, which reads better in a toast — and deleted the
    // upgradeUrl that `planGateUpgradeUrl` pulls out of the raw text with a regex, breaking the
    // link on the upgrade banner. `src/lib/api-client.planGate.test.ts` went red and is the reason
    // the JSON case is now passed through untouched. Braces in a toast are the milder defect.
    const gate = '{"error":"advanced_audit_requires_operations","upgradeUrl":"/settings?tab=billing"}';
    const err = new ApiHttpError(gate, 403);
    expect(err.message).toBe(gate);
    expect(planGateUpgradeUrl(err.message)).toBe("/settings?tab=billing");
  });
});

describe("what the raw message is still allowed to carry", () => {
  // These are the strings other code PATTERN-MATCHES on. Sanitising them would trade a cosmetic
  // defect for a functional one, so each is pinned byte-for-byte.

  it("passes an ordinary sentence through byte-for-byte", () => {
    const plain = "Order is not ready to transform (status 'delivering'). Wait for the send to finish.";
    expect(new ApiHttpError(plain, 409).message).toBe(plain);
  });

  it("leaves a plan-gate code intact, so isPlanGateError still matches", () => {
    const err = new ApiHttpError("bulk_mapping_requires_operations", 403);
    expect(err.message).toBe("bulk_mapping_requires_operations");
    expect(isPlanGateError(err.message)).toBe(true);
  });

  it("leaves the timeout sentence intact, so isRequestTimeout still matches", () => {
    // apiFailure.ts anchors on this exactly: /^Request timed out after \d+ms$/
    const err = new ApiHttpError("Request timed out after 30000ms", 408);
    expect(isRequestTimeout(err)).toBe(true);
  });

  it("keeps the 'assign-supplier failed:' prefix AssignSupplierBanner strips", () => {
    // AssignSupplierBanner.tsx does `.replace(/^assign-supplier failed:\s*/i, "")`.
    const err = new ApiHttpError("assign-supplier failed: Supplier not found.", 400);
    expect(err.message.replace(/^assign-supplier failed:\s*/i, "")).toBe("Supplier not found.");
  });

  it("keeps the delivery-config sentence problemCopy branches on", () => {
    // problemCopy.isDeliveryConfigMissing matches this shape; a reworded message breaks the panel's
    // entire "add a delivery endpoint" arm.
    const s = "Supplier delivery config is missing. Add a delivery endpoint before sending this order.";
    expect(new ApiHttpError(s, 400).message).toBe(s);
  });

  it("leaves status, body and retryAfterSeconds untouched", () => {
    const err = new ApiHttpError("Too many requests", 429, { retryAfterSeconds: 12 });
    expect(err.status).toBe(429);
    expect(err.body).toEqual({ retryAfterSeconds: 12 });
    expect(err.retryAfterSeconds).toBe(12);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiHttpError");
  });
});

describe("serverReason — the render-boundary helper for server-authored data fields", () => {
  // order.errorMessage / deadLetter.lastError / catalogSource.lastSyncError are NOT
  // ApiHttpError.message. They are persisted fields that arrive on a 200, and logic elsewhere
  // (problemCopy.isDeliveryConfigMissing) matches on the raw value — so they are cleaned where
  // they become prose, never at the source.

  it("returns the readable text inside markup", () => {
    expect(serverReason(GATEWAY_502_HTML, "fallback")).toContain("502 Bad Gateway");
    expectNoMarkup(serverReason(GATEWAY_502_HTML, "fallback"));
  });

  it("returns the caller's own copy when nothing legible survives", () => {
    expect(serverReason("<html><head></head><body></body></html>", "Nothing came back.")).toBe("Nothing came back.");
  });

  it("returns the caller's own copy for null, undefined and whitespace", () => {
    expect(serverReason(null, "fb")).toBe("fb");
    expect(serverReason(undefined, "fb")).toBe("fb");
    expect(serverReason("   ", "fb")).toBe("fb");
  });

  it("passes a supplier's plain sentence through untouched", () => {
    const s = "Rejected: PO number already received on 2026-07-14.";
    expect(serverReason(s, "fb")).toBe(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The wiring, end to end: a real fetch response → the real api-client function →
// the message a component would render. A unit test on the sanitiser proves nothing about whether
// the code path that produced the production defect actually reaches it.
// ─────────────────────────────────────────────────────────────────────────────

describe("a real 502 from the API produces a clean message", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // `authHeader` waits up to 5s for `window.Clerk.loaded` outside mock/QA builds. Signed out but
    // loaded is the state under test — no token, request still goes out.
    (window as unknown as { Clerk?: unknown }).Clerk = { loaded: true, session: null };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(GATEWAY_502_HTML, {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("transformOrder: the HTML error page never reaches the thrown message", async () => {
    // `apiClient.transformOrder` is the REAL implementation here: USE_MOCK requires
    // NEXT_PUBLIC_USE_MOCK === "true", which the test env does not set. So this drives the exact
    // line the production defect came through — api-client's `error ?? \`${fallback}: ${text}\``.
    const { apiClient } = await import("@/lib/api-client");

    let thrown: unknown;
    try {
      await apiClient.transformOrder("ord-1");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiHttpError);
    const msg = (thrown as Error).message;
    expectNoMarkup(msg);
    expect(msg).toContain("502");
  });

  // The api layer does not throw ApiHttpError everywhere. Three `apiFetch` helpers throw a plain
  // Error built the same way — `API error ${status}: ${await res.text()}` — which skips the
  // constructor entirely. Their messages are rendered: delivery.ts feeds DeliveryConfigEditor's
  // error block, mapping.ts feeds PoMappingEditor's "Couldn't save — …" line. Found by asking
  // "what still reaches prose without passing the constructor?", not by reading the diff.

  it("delivery.ts apiFetch: DeliveryConfigEditor's error block gets no markup", async () => {
    const { getDeliveryConfig } = await import("@/lib/api/delivery");
    let thrown: unknown;
    try {
      await getDeliveryConfig("sup-1");
    } catch (e) {
      thrown = e;
    }
    const msg = (thrown as Error).message;
    expectNoMarkup(msg);
    expect(msg).toContain("502");
  });

  it("mapping.ts apiFetch: PoMappingEditor's save error gets no markup", async () => {
    const { deletePoMapping } = await import("@/lib/api/mapping");
    let thrown: unknown;
    try {
      await deletePoMapping("sup-1");
    } catch (e) {
      thrown = e;
    }
    const msg = (thrown as Error).message;
    expectNoMarkup(msg);
    expect(msg).toContain("502");
  });
});
