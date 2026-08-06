import { describe, it, expect } from "vitest";
import { ApiHttpError } from "@/lib/api/core";
import { describeUploadFailure } from "./UploadWorkbench";

/**
 * The upload banner reads `ApiHttpError.body`, not `.message` — so the constructor's cleaning does
 * not reach it.
 *
 * `serverAuthoredMessage` exists precisely to prefer what the BACKEND wrote over the client's own
 * "Upload failed: " prefix, and it does that by reading the parsed body. `realUploadPurchaseOrder`
 * stores the raw text as the body whenever the response is not `application/json`, so a 4xx
 * answered `text/html` by an edge proxy or a WAF arrives here as a whole page and is rendered
 * verbatim in the banner (`UploadWorkbench.tsx`, the `forbidden` and `default` arms).
 *
 * Found by asking, after the constructor fix, "what still reaches prose without passing it?" — the
 * answer was: anything that reads `.body`. This file pins the answer.
 */

const GATEWAY_HTML =
  "<!-- Tip: set Accept to application/json for errors in JSON. -->" +
  "<!DOCTYPE html><html><head><title>403 Forbidden</title></head>" +
  "<body><center><h1>403 Forbidden</h1></center><hr>edge-proxy</body></html>";

function expectNoMarkup(text: string) {
  expect(text).not.toContain("<!DOCTYPE");
  expect(text).not.toContain("<html");
  expect(text).not.toContain("<head");
  expect(text).not.toContain("<!--");
  expect(text).not.toContain("<h1>");
}

describe("the upload banner never shows the operator a proxy's error page", () => {
  it("cleans a raw HTML body on a 403", () => {
    const banner = describeUploadFailure(
      new ApiHttpError("Upload failed: Forbidden", 403, GATEWAY_HTML),
      "orders.csv",
    );
    expectNoMarkup(banner.message);
    // Anti-vacuity: the body really was consulted, and what it said survived.
    expect(banner.message).toContain("403 Forbidden");
  });

  it("cleans a raw HTML body on an ordinary 4xx", () => {
    const banner = describeUploadFailure(
      new ApiHttpError("Upload failed: Bad Request", 400, GATEWAY_HTML),
      "orders.csv",
    );
    expectNoMarkup(banner.message);
    // 5xx has its own hardcoded copy, so the `default` arm — every other 4xx — is the one that
    // renders the body. Anti-vacuity: it really did.
    expect(banner.message).toContain("403 Forbidden");
  });

  it("cleans markup that arrives inside a JSON error field", () => {
    const banner = describeUploadFailure(
      new ApiHttpError("Upload failed", 400, { error: `Rejected. ${GATEWAY_HTML}` }),
      "orders.csv",
    );
    expectNoMarkup(banner.message);
    expect(banner.message).toContain("Rejected.");
  });

  it("still passes the backend's own sentence through untouched", () => {
    // WP-36 forbids paraphrasing what the backend wrote for an operator. A plain sentence must
    // reach the banner exactly as sent — this is the behaviour the cleaning must not cost.
    const sentence = "That file type is not supported. Upload CSV, XLSX, PDF or XML.";
    const banner = describeUploadFailure(
      new ApiHttpError("Upload failed", 400, { error: sentence }),
      "orders.pptx",
    );
    expect(banner.message).toContain(sentence);
  });

  it("falls back to written copy when the body is nothing but chrome", () => {
    const banner = describeUploadFailure(
      new ApiHttpError("Upload failed: Bad Gateway", 502, "<html><head><style>a{}</style></head><body></body></html>"),
      "orders.csv",
    );
    expectNoMarkup(banner.message);
    expect(banner.message.length).toBeGreaterThan(10);
  });
});
