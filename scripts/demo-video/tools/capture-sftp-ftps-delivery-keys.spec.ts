import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "SFTP & FTPS delivery" (supplier Delivery tab).
 *
 * A SAVED SFTP config (masked credential on camera) → password vs private-key
 * auth → OpenSSH key pasted in → key-format note card (overlay) → remote path
 * + create-directory toggle → FTPS certificate toggle → enabled Test-fire
 * rested on with the delivered-file ≠ accepted caveat.
 *
 * Honesty notes: the ".ppk is rejected" claim from the draft script was
 * DROPPED — SSH.NET (2024.2.0) parses .ppk, there is no rejection in the
 * product; the VO recommends the documented OpenSSH/PEM form instead.
 * The write-only/keep-on-blank claims are backend-verified
 * (DeliveryConfigService: CredentialsJson null = keep).
 *
 * Mock plumbing: getDeliveryConfig answered with a real-shaped SAVED SFTP
 * config (200) so the masked-credential state ("saved credential masked",
 * "********", enabled Test-fire) is genuinely on camera. Save/Test-fire never
 * clicked (no mock backend).
 *
 *   bun run demo:tools:capture capture-sftp-ftps-delivery-keys
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("sftp-ftps-delivery-keys");
const holds = holdBudgets(spec);

// Real-shaped saved config — exactly what GET /delivery-config returns for a
// configured SFTP supplier (shape: src/lib/api/types.ts DeliveryConfig).
const SAVED_SFTP_CONFIG = {
  supplierId: "22222222-2222-2222-2222-222222222222",
  protocol: "sftp",
  autoDeliver: false,
  configJson: JSON.stringify({
    host: "sftp.electrosupply.example",
    port: 22,
    remotePath: "/inbound/orders",
    makeDirectories: true,
    timeoutSeconds: 30,
  }),
  outputFormat: "csv",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-06-20T09:00:00Z",
  updatedAt: "2026-07-01T09:00:00Z",
  cxmlCredentials: null,
};

const SAMPLE_OPENSSH_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
  "b3BlbnNzaC1rZXktdjEAAAAADEMO0NOT0A0REAL0KEY0AAAACmRlbW8ta2V5LW5v\n" +
  "dC1yZWFsLWp1c3QtZm9yLXRoZS12aWRlbwAAAAtkZW1vLXNhbXBsZQ==\n" +
  "-----END OPENSSH PRIVATE KEY-----";

// Branded in-frame note card (the sanctioned code-overlay technique) — used
// for the one thing the form itself cannot show: the key-format contrast.
async function showKeyFormatsCard(page: Page) {
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "plk-code-overlay";
    el.innerHTML =
      '<div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#3DBE6B;margin-bottom:14px;">KEY FORMATS</div>' +
      '<div style="margin-bottom:16px;"><span style="color:#3DBE6B;font-weight:700;">expected</span>' +
      '<pre style="margin:6px 0 0;color:#DDE7F7;">-----BEGIN OPENSSH PRIVATE KEY-----</pre></div>' +
      '<div><span style="color:#E8B84B;font-weight:700;">convert first (PuTTYgen → export OpenSSH key)</span>' +
      '<pre style="margin:6px 0 0;color:#7E93B8;">PuTTY-User-Key-File-3: ssh-ed25519  (.ppk)</pre></div>';
    Object.assign(el.style, {
      position: "fixed", right: "70px", top: "50%", transform: "translateY(-50%)",
      width: "660px", background: "#0B1A2F", border: "1px solid #24406B",
      borderRadius: "12px", padding: "24px 28px", zIndex: "2147483000",
      fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: "16px",
      lineHeight: "1.6", boxShadow: "0 18px 60px rgba(11,26,47,0.45)",
      opacity: "0", transition: "opacity .35s ease",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; });
  });
}

async function hideOverlay(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById("plk-code-overlay");
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  });
  await page.waitForTimeout(450);
}

test("tool capture: sftp-ftps-delivery-keys", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page, { hideTexts: ["Loading connector requirements", "Failed to fetch"] });
  await page.route("**/api/suppliers/*/delivery-config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SAVED_SFTP_CONFIG) }),
  );

  const beat = async (id: string, actions?: () => Promise<void>) => {
    const b = spec.beats.find((x) => x.id === id)!;
    clock.mark(id);
    if (actions) {
      if (b.actionLeadMs) await page.waitForTimeout(b.actionLeadMs);
      await soft(id, actions);
    }
    const left = holds[id] - clock.since(id);
    if (left > 0) await page.waitForTimeout(left);
  };

  // ── open ───────────────────────────────────────────────────────────────────
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByText(/output format — the format/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — saved SFTP setup: host / port / username ──────────────────────────
  await beat("b1-open", async () => {
    await cursor.glideTo(page.getByText(/^SFTP$/).first(), 900);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByLabel(/^host$/i).first(), 800);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByLabel(/^port$/i).first(), 600);
    await page.waitForTimeout(600);
    await cursor.click(page.getByLabel(/^username$/i).first(), 700);
    await page.keyboard.type("proculink-drop", { delay: 46 });
  });

  // ── b2 — the masked saved password (write-only secrets) ────────────────────
  await beat("b2-password", async () => {
    await cursor.glideTo(page.getByLabel(/auth method/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByLabel(/^password$/i).first(), 800);
    await page.waitForTimeout(1100);
    await cursor.glideTo(page.getByText(/saved credential masked/i).first(), 900);
  });

  // ── b3 — switch to private key + paste an OpenSSH-form key ─────────────────
  await beat("b3-key", async () => {
    const authMode = page.getByLabel(/auth method/i).first();
    await cursor.glideTo(authMode, 700);
    await page.waitForTimeout(400);
    await authMode.selectOption("key").catch(() => {});
    await page.waitForTimeout(900);
    // The key textarea is the only <textarea> on the SFTP form — target it
    // directly (getByLabel proved flaky here: first take typed into the void)
    // and type INTO the element so focus can't drift.
    const keyArea = page.locator("textarea").first();
    await cursor.click(keyArea, 700);
    await keyArea.pressSequentially(SAMPLE_OPENSSH_KEY, { delay: 4 });
  });

  // ── b4 — key-format note card + the passphrase field ───────────────────────
  await beat("b4-convert", async () => {
    await showKeyFormatsCard(page);
    await cursor.glideToPoint(1180, 460, 900);
    await page.waitForTimeout(9500); // the card carries most of this VO
    await hideOverlay(page);
    await cursor.glideTo(page.getByLabel(/key passphrase/i).first(), 900);
  });

  // ── b5 — remote path, create-directory, FTPS cert toggle ───────────────────
  await beat("b5-dir-cert", async () => {
    await cursor.glideTo(page.getByLabel(/remote path/i).first(), 900);
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/create the remote directory/i).first(), 700);
    await page.waitForTimeout(1100);
    // Protocol cards carry ids (delivery-protocol-<id>) — click the card
    // element itself (getByText missed it on the first take).
    await cursor.click(page.locator("#delivery-protocol-ftps"), 800);
    await page.waitForTimeout(800);
    await cursor.glideTo(page.getByText(/allow invalid tls certificate/i).first(), 800);
  });

  // ── b6 — back on SFTP; Test-fire rested on ─────────────────────────────────
  await beat("b6-test", async () => {
    await cursor.click(page.locator("#delivery-protocol-sftp"), 800);
    await page.waitForTimeout(700);
    await cursor.glideTo(page.getByRole("button", { name: /test-fire/i }).first(), 1100);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
