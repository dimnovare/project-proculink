/* =============================================================================
 * ProcuLink LIVE inbound-email harness (Postmark webhook channel)
 * -----------------------------------------------------------------------------
 * Exercises the hosted inbound-email ingress by POSTing a valid Postmark Inbound
 * payload to:   POST /api/inbound-email/postmark   (header: X-Postmark-Server-Token).
 * Each message carries a small CSV PO as a base64 attachment named "order.csv",
 * just as Postmark delivers a real inbound email with an attachment.
 *
 * This is the PUBLIC webhook — it does NOT use a Clerk session. Auth is the shared
 * token compared against the backend config key `Inbound:Postmark:WebhookToken`.
 * On Railway that secret is the env var `Inbound__Postmark__WebhookToken` set on
 * BOTH the API and the Worker services. Pass it here as PLK_POSTMARK_TOKEN.
 *
 * The `To` address selects the tenant: orders@{org-slug}.proculink.eu (or whatever
 * inbound alias the org configured). Pass it as PLK_INBOUND_TO.
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────
 * Default target is the LOCAL API (http://localhost:5223):
 *   PLK_POSTMARK_TOKEN=<Inbound__Postmark__WebhookToken> \
 *   PLK_INBOUND_TO="orders@your-org-slug.proculink.eu" \
 *   PLK_COUNT=3 \
 *     bun scripts/live-matrix/inbound-email-harness.mjs
 *
 * Production must be named AND opted into on the command line (see ./target.mjs).
 * PLK_INBOUND_TO is tenant ROUTING, not a target — it does not select a deployment.
 *   PLK_API=https://api.proculink.eu \
 *   PLK_POSTMARK_TOKEN=<Inbound__Postmark__WebhookToken> \
 *   PLK_INBOUND_TO="orders@your-org-slug.proculink.eu" \
 *   PLK_COUNT=3 \
 *     bun scripts/live-matrix/inbound-email-harness.mjs --allow-production
 *
 * (node also works: `node scripts/live-matrix/inbound-email-harness.mjs`.)
 *
 * Honest scope: a 200 here means the webhook accepted + routed the message and
 * created order(s). It does NOT prove downstream parse/transform/delivery — poll
 * GET /api/orders/{id} (e.g. with format-upload-harness.mjs style polling) for that.
 * A 401 = bad/missing token; a 422 = unprocessable (unknown tenant slug, blocked
 * org, etc.) — both are reported verbatim so the failure is legible.
 * ========================================================================== */

import { resolveTargetOrExit } from "./target.mjs";

const { api: API } = resolveTargetOrExit("inbound-email-harness.mjs");
const TOKEN = process.env.PLK_POSTMARK_TOKEN;
const TO = process.env.PLK_INBOUND_TO;
const FROM = process.env.PLK_INBOUND_FROM || "buyer@example-buyer.test";
const COUNT = parseInt(process.env.PLK_COUNT || "3", 10);

if (!TOKEN || !TO) {
  console.error(
    "Set PLK_POSTMARK_TOKEN (= Railway Inbound__Postmark__WebhookToken) and " +
      "PLK_INBOUND_TO (= orders@<org-slug>.proculink.eu).",
  );
  process.exit(1);
}

/** Build a small CSV PO. The header aliases match CsvOrderParser's accepted set. */
function buildCsv(i) {
  const stamp = Date.now();
  const lineCount = 1 + (i % 3); // 1..3 lines, varied
  const rows = ["po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency"];
  for (let n = 1; n <= lineCount; n++) {
    rows.push(
      `EMAIL-${stamp}-${i},Inbound Email Buyer,${n},IE-${i}-${n},Widget ${n},${10 + n},${(5.5 + n).toFixed(2)},EUR`,
    );
  }
  return rows.join("\n");
}

/** A minimal-but-valid Postmark Inbound JSON envelope with one CSV attachment. */
function buildPostmarkPayload(i) {
  const csv = buildCsv(i);
  const contentB64 = Buffer.from(csv, "utf8").toString("base64");
  return {
    From: FROM,
    FromName: "Inbound Email Buyer",
    To: TO,
    ToFull: [{ Email: TO, Name: "ProcuLink Orders" }],
    OriginalRecipient: TO,
    Subject: `Purchase order EMAIL-${Date.now()}-${i}`,
    MessageID: `harness-${Date.now()}-${i}@example-buyer.test`,
    TextBody: "Please find our purchase order attached as a CSV.",
    HtmlBody: "<p>Please find our purchase order attached as a CSV.</p>",
    Attachments: [
      {
        Name: "order.csv",
        Content: contentB64,
        ContentType: "text/csv",
        ContentLength: csv.length,
        ContentID: "",
      },
    ],
  };
}

async function postOne(i) {
  const body = JSON.stringify(buildPostmarkPayload(i));
  try {
    const res = await fetch(`${API}/api/inbound-email/postmark`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": TOKEN,
      },
      body,
    });
    const txt = await res.text();
    let json = null;
    try {
      json = JSON.parse(txt);
    } catch {
      /* non-JSON body */
    }
    const createdOrderIds = json && (json.createdOrderIds || json.CreatedOrderIds || []);
    return {
      i,
      status: res.status,
      ok: res.ok,
      orgId: json && (json.orgId || json.OrgId),
      createdOrderIds: createdOrderIds || [],
      error: res.ok ? null : (json && (json.error || json.Error)) || txt.slice(0, 200),
    };
  } catch (e) {
    return { i, status: "fetch-fail", ok: false, error: e && e.message };
  }
}

(async () => {
  console.log(`[inbound-email] POST ${API}/api/inbound-email/postmark x${COUNT} to ${TO}`);
  const allCreated = [];
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < COUNT; i++) {
    const r = await postOne(i);
    if (r.ok) {
      ok++;
      if (Array.isArray(r.createdOrderIds)) allCreated.push(...r.createdOrderIds);
    } else {
      fail++;
    }
    console.log(
      `  #${i} → ${r.status} ${r.ok ? "OK" : "FAIL"}` +
        (r.createdOrderIds && r.createdOrderIds.length ? ` orders=${JSON.stringify(r.createdOrderIds)}` : "") +
        (r.error ? ` error=${r.error}` : ""),
    );
    // Gentle pacing — the postmark endpoint shares the "upload" rate-limit policy.
    await new Promise((res) => setTimeout(res, 500));
  }
  console.log(
    `[inbound-email] DONE ok=${ok} fail=${fail} createdOrders=${allCreated.length}` +
      (allCreated.length ? ` ids=${JSON.stringify(allCreated)}` : ""),
  );
  if (fail > 0) process.exitCode = 1;
})();
