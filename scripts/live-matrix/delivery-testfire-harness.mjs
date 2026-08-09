/* =============================================================================
 * ProcuLink LIVE delivery test-fire harness (outbound delivery channel)
 * -----------------------------------------------------------------------------
 * Configures HTTP delivery for a supplier against a catcher URL (e.g. a
 * https://webhook.site/<uuid> endpoint you control), then fires the SAFE
 * test-fire so you can confirm a real outbound POST lands at the catcher:
 *
 *   PUT  /api/suppliers/{id}/delivery-config           (set protocol=http + url)
 *   POST /api/suppliers/{id}/delivery-config/test-fire (sends a sample payload)
 *
 * Auth: a Clerk JWT in PLK_CLERK_TOKEN. Clerk JWTs are SHORT-LIVED (~60 s) — grab
 * a fresh one from a signed-in browser tab's console:
 *
 *     await window.Clerk.session.getToken()
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────
 * Default target is the LOCAL API (http://localhost:5223):
 *   PLK_CLERK_TOKEN="<fresh Clerk JWT>" \
 *   PLK_SUPPLIER_ID="<supplier uuid>" \
 *   PLK_CATCHER_URL="https://webhook.site/<your-uuid>" \
 *     bun scripts/live-matrix/delivery-testfire-harness.mjs
 *
 * Production must be named AND opted into on the command line (see ./target.mjs).
 * Note what that means HERE: this harness overwrites a supplier's delivery config,
 * so against production it overwrites a REAL supplier's endpoint.
 *   PLK_API=https://api.proculink.eu \
 *   PLK_CLERK_TOKEN="<fresh Clerk JWT>" \
 *   PLK_SUPPLIER_ID="<supplier uuid>" \
 *   PLK_CATCHER_URL="https://webhook.site/<your-uuid>" \
 *     bun scripts/live-matrix/delivery-testfire-harness.mjs --allow-production
 *
 * If PLK_SUPPLIER_ID is omitted, the harness GETs /api/suppliers and uses the
 * first one. It reports the DeliveryTestResult ({ success, errorMessage,
 * responseCode }) verbatim.
 *
 * SAFETY: test-fire sends a synthetic sample payload — it does NOT deliver a real
 * order and does NOT change any order's state. autoDeliver is forced false so the
 * normal pipeline never auto-pushes to this catcher.
 *
 * NOTE on overwriting config: this harness OVERWRITES the supplier's delivery
 * config with the catcher URL. If the supplier already had a production endpoint,
 * pass PLK_RESTORE=1 to capture + restore it afterwards (best-effort; credentials
 * are write-only on the API and cannot be read back, so a credentialed config is
 * restored without its secret — re-enter it in the UI). Prefer a THROWAWAY
 * supplier for test-fire drills.
 * ========================================================================== */

import { resolveTargetOrExit } from "./target.mjs";

const { api: API } = resolveTargetOrExit("delivery-testfire-harness.mjs");
const TOKEN = process.env.PLK_CLERK_TOKEN;
let SUPPLIER_ID = process.env.PLK_SUPPLIER_ID;
const CATCHER = process.env.PLK_CATCHER_URL;
const RESTORE = process.env.PLK_RESTORE === "1";

if (!TOKEN || !CATCHER) {
  console.error(
    "Set PLK_CLERK_TOKEN (fresh `await window.Clerk.session.getToken()`) and " +
      "PLK_CATCHER_URL (e.g. https://webhook.site/<uuid>). PLK_SUPPLIER_ID is optional.",
  );
  process.exit(1);
}

function authHeaders(extra) {
  return { Authorization: `Bearer ${TOKEN}`, ...(extra || {}) };
}

async function json(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

async function resolveSupplierId() {
  if (SUPPLIER_ID) return SUPPLIER_ID;
  const res = await fetch(`${API}/api/suppliers`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET /api/suppliers failed (${res.status})`);
  const list = await res.json();
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) throw new Error("No suppliers exist for this org — create one first.");
  return first.id || first.Id;
}

async function getConfig(id) {
  const res = await fetch(`${API}/api/suppliers/${id}/delivery-config`, { headers: authHeaders() });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`GET delivery-config failed (${res.status})`);
  return res.json();
}

async function putHttpConfig(id) {
  const res = await fetch(`${API}/api/suppliers/${id}/delivery-config`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      protocol: "http",
      autoDeliver: false,
      configJson: JSON.stringify({ url: CATCHER, method: "POST", timeoutSeconds: 15 }),
      credentialsJson: JSON.stringify({ type: "none" }),
    }),
  });
  return { status: res.status, ok: res.ok, body: await json(res) };
}

async function testFire(id) {
  const res = await fetch(`${API}/api/suppliers/${id}/delivery-config/test-fire`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  return { status: res.status, ok: res.ok, body: await json(res) };
}

async function restoreConfig(id, previous) {
  if (previous == null) {
    const res = await fetch(`${API}/api/suppliers/${id}/delivery-config`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    return { status: res.status };
  }
  const res = await fetch(`${API}/api/suppliers/${id}/delivery-config`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      protocol: previous.protocol || previous.Protocol,
      autoDeliver: previous.autoDeliver ?? previous.AutoDeliver ?? false,
      configJson: previous.configJson || previous.ConfigJson || "{}",
      credentialsJson: null, // secrets are write-only — cannot be read back / restored
    }),
  });
  return { status: res.status };
}

(async () => {
  try {
    SUPPLIER_ID = await resolveSupplierId();
    console.log(`[delivery-testfire] supplier=${SUPPLIER_ID} catcher=${CATCHER}`);

    const previous = RESTORE ? await getConfig(SUPPLIER_ID) : null;
    if (RESTORE) console.log(`[delivery-testfire] captured previous config: ${previous ? "yes" : "none"}`);

    const put = await putHttpConfig(SUPPLIER_ID);
    console.log(`[delivery-testfire] PUT config → ${put.status} ${put.ok ? "OK" : "FAIL"}`);
    if (!put.ok) {
      console.error("  body:", JSON.stringify(put.body));
      process.exitCode = 1;
      return;
    }

    const fire = await testFire(SUPPLIER_ID);
    const r = fire.body || {};
    const success = r.success ?? r.Success;
    const responseCode = r.responseCode ?? r.ResponseCode;
    const errorMessage = r.errorMessage ?? r.ErrorMessage;
    console.log(
      `[delivery-testfire] test-fire → http ${fire.status} | success=${success} ` +
        `responseCode=${responseCode ?? "—"}` +
        (errorMessage ? ` errorMessage="${errorMessage}"` : ""),
    );
    console.log("  → Check your catcher URL — the test payload should have arrived there.");

    if (RESTORE) {
      const restored = await restoreConfig(SUPPLIER_ID, previous);
      console.log(
        `[delivery-testfire] restored previous config → ${restored.status}` +
          (previous && (previous.hasCredentials ?? previous.HasCredentials)
            ? " (NOTE: credentials are write-only and were NOT restored — re-enter the secret in the UI)"
            : ""),
      );
    }

    if (success === false) process.exitCode = 1;
  } catch (e) {
    console.error("[delivery-testfire] ERROR:", e && e.message);
    process.exitCode = 1;
  }
})();

/* -----------------------------------------------------------------------------
 * COMMENTED TEMPLATES — other delivery protocols (need REAL endpoints/credentials)
 * -----------------------------------------------------------------------------
 * The backend accepts these protocol values. Each needs a real endpoint and (most)
 * real credentials, so they are left as copy-paste templates rather than run here.
 * Swap the PUT body in putHttpConfig() with one of these to drive that channel.
 *
 * SFTP:
 *   {
 *     protocol: "sftp",
 *     autoDeliver: false,
 *     configJson: JSON.stringify({ host: "sftp.supplier.example", port: 22,
 *                                  remotePath: "/inbound/", fileNamePattern: "{po}.xml" }),
 *     credentialsJson: JSON.stringify({ username: "proculink",
 *                                       password: "<secret>" }),  // or privateKey: "<pem>"
 *   }
 *
 * FTPS:
 *   {
 *     protocol: "ftps",
 *     autoDeliver: false,
 *     configJson: JSON.stringify({ host: "ftps.supplier.example", port: 21,
 *                                  remotePath: "/inbound/", explicitTls: true }),
 *     credentialsJson: JSON.stringify({ username: "proculink", password: "<secret>" }),
 *   }
 *
 * SMTP (email-out delivery):
 *   {
 *     protocol: "smtp",
 *     autoDeliver: false,
 *     configJson: JSON.stringify({ host: "smtp.supplier.example", port: 587,
 *                                  fromAddress: "orders@yourbuyer.example",
 *                                  toAddress: "po-intake@supplier.example",
 *                                  subjectTemplate: "PO {po}" }),
 *     credentialsJson: JSON.stringify({ username: "smtp-user", password: "<secret>" }),
 *   }
 *
 * ERP — Erply:
 *   {
 *     protocol: "erp_erply",
 *     autoDeliver: false,
 *     configJson: JSON.stringify({ clientCode: "123456", mode: "sandbox" }),
 *     credentialsJson: JSON.stringify({ apiKey: "<erply-api-key>",
 *                                       username: "<user>", password: "<pass>" }),
 *   }
 *
 * ERP — Directo:
 *   {
 *     protocol: "erp_directo",
 *     autoDeliver: false,
 *     configJson: JSON.stringify({ companyCode: "yourco", baseUrl: "https://directo.gate.ee" }),
 *     credentialsJson: JSON.stringify({ apiKey: "<directo-api-key>" }),
 *   }
 *
 * Exact configJson/credentialsJson field names are validated server-side per
 * protocol (see ConnectorManifests + the per-protocol dispatchers). Use the
 * supplier Delivery tab's ConnectorRequirementsPanel ("Check configuration") in
 * the UI to confirm the required fields for each protocol before a real fire.
 * --------------------------------------------------------------------------- */
