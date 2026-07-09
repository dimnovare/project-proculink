import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoCursor, MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * SETUP-GUIDE capture — "CSV & XLSX orders" (/upload + code overlays).
 *
 * Real UI: a real CSV dropped on the upload workbench ("Detected: CSV"),
 * supplier picked, Upload & review clicked into the parsed preview. The field
 * rules ride on branded code overlays; every rule mirrors the REAL parser
 * (CsvOrderParser: PrepareHeaderForMatch lowercases + strips non-alphanumeric,
 * unknown columns ignored, header fields = first non-empty row, nothing hard-
 * required per line; UTF-8 + BOM strip + newline normalise, NO legacy-codepage
 * detection; NumberParsing: both separators → last wins, ';' = European hint,
 * ambiguous → NeedsReview — CSV path only, which is why the VO says "a C S V
 * number"; XlsxOrderParser: first worksheet, input-only — no XLSX writer).
 *
 *   bun run demo:tools:capture capture-csv-xlsx-field-guide
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("csv-xlsx-field-guide");
const holds = holdBudgets(spec);

const SAMPLE_CSV =
  "PO Number,Order Date,Buyer Name,Currency,Buyer Item Code,Description,Quantity,Unit Price\n" +
  "PO-2026-00871,2026-07-01,Nordic Electronics,EUR,TB-CAP-100,Capacitor 100uF,200,0.35\n" +
  "PO-2026-00871,,,,TB-RES-220,Resistor 220 Ohm,500,0.02\n" +
  "PO-2026-00871,,,,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50\n";

const OVERLAYS: Record<string, string> = {
  required:
    '<b style="color:#3DBE6B;">PO Number,Order Date,Buyer Name,Currency,Buyer Item Code,Description,Quantity,Unit Price</b>\n' +
    "PO-2026-00871,2026-07-01,Nordic Electronics,EUR,TB-CAP-100,Capacitor 100uF,200,0.35\n" +
    'PO-2026-00871,<b style="color:#7E93B8;">,,,</b>TB-RES-220,Resistor 220 Ohm,500,0.02\n' +
    'PO-2026-00871,<b style="color:#7E93B8;">,,,</b>TB-WIRE-22,Wire 22AWG Black 100m,5,12.50\n\n' +
    '<div style="color:#7E93B8;">row 1 = headers &#183; header fields are read from the first row that has a value —\nlater rows can leave them empty</div>',
  headers:
    '"Buyer Item Code"   &#8594;  <b style="color:#3DBE6B;">buyeritemcode</b>\n' +
    '"buyerItemCode"     &#8594;  <b style="color:#3DBE6B;">buyeritemcode</b>\n' +
    '"BUYER_ITEM_CODE"   &#8594;  <b style="color:#3DBE6B;">buyeritemcode</b>\n\n' +
    '<div style="color:#7E93B8;">lowercased &#183; spaces + punctuation stripped &#183; matched by name</div>\n\n' +
    '"Internal Notes"    &#8594;  <b style="color:#E8B84B;">not recognised — column ignored</b>',
  encoding:
    'UTF-8 decode        <b style="color:#3DBE6B;">&#10003;</b>\n' +
    'byte-order mark     <b style="color:#3DBE6B;">stripped</b>\n' +
    'CRLF / LF endings   <b style="color:#3DBE6B;">normalised</b>\n\n' +
    '<div style="color:#7E93B8;">no legacy-codepage detection:</div>\n' +
    'CP1252 "Servomoteur 5&#8364;"  &#8594;  <b style="color:#E8B84B;">"Servomoteur 5&#65533;"  (garbled)</b>\n\n' +
    '<div style="color:#7E93B8;">&#8594; export as "CSV UTF-8"</div>',
  decimals:
    '1,234.56   &#8594;  <b style="color:#3DBE6B;">1234.56</b>\n' +
    '1.234,56   &#8594;  <b style="color:#3DBE6B;">1234.56</b>   <span style="color:#7E93B8;">(last separator = the decimal)</span>\n\n' +
    '<div style="color:#7E93B8;">semicolon-delimited file = European signal:</div>\n' +
    '73,22      &#8594;  <b style="color:#3DBE6B;">73.22</b>\n\n' +
    '"1-2-3"    &#8594;  <b style="color:#E8B84B;">ambiguous &#8594; line flagged for review</b>',
};

// Branded code overlay (static, author-controlled content only).
async function showOverlay(page: Page, title: string, key: string) {
  await page.evaluate(([t, html]) => {
    let el = document.getElementById("plk-code-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "plk-code-overlay";
      Object.assign(el.style, {
        position: "fixed", right: "60px", top: "50%", transform: "translateY(-50%)",
        width: "900px", background: "#0B1A2F", border: "1px solid #24406B",
        borderRadius: "12px", padding: "24px 28px", zIndex: "2147483000",
        fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: "16px",
        lineHeight: "1.62", color: "#DDE7F7", whiteSpace: "pre-wrap",
        boxShadow: "0 18px 60px rgba(11,26,47,0.45)",
        opacity: "0", transition: "opacity .35s ease",
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(el);
    }
    el.innerHTML =
      `<div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#3DBE6B;margin-bottom:14px;white-space:normal;">${t}</div>` + html;
    requestAnimationFrame(() => { (el as HTMLElement).style.opacity = "1"; });
  }, [title, OVERLAYS[key]]);
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

test("tool capture: csv-xlsx-field-guide", async ({ page }) => {
  test.setTimeout(420_000);

  const clock = new MarkerClock();
  const cursor = new DemoCursor(page);
  await prepareDemoPage(page);

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
  // domcontentloaded, NOT networkidle — mock long-polls never go idle and the
  // first take burned ~23s of pre-roll here (the v11 lesson).
  await soft("open", async () => {
    await page.goto(spec.route, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /upload an order/i }).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
  });

  // ── b1 — format chips + a real CSV drop ────────────────────────────────────
  await beat("b1-open", async () => {
    // The dropzone shows the accepted formats as CHIPS (CSV XLSX PDF … EDI) —
    // the old comma-separated line is gone (two silent 8s timeouts on the
    // first takes). Trace the chip row CSV → XLSX → EDI.
    await cursor.glideTo(page.getByText(/^CSV$/).first(), 800);
    await page.waitForTimeout(500);
    await cursor.glideTo(page.getByText(/^XLSX$/).first(), 600);
    await page.waitForTimeout(600);
    await cursor.glideTo(page.getByText(/^EDI$/).first(), 1200);
    await page.waitForTimeout(500);
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    await cursor.glideTo(browse, 700);
    await page.waitForTimeout(400);
    // Inject the file straight into the input — no filechooser dance: the mock
    // dropzone stages its own demo file on click and no chooser event fires
    // (the first take burned 6s waiting for one).
    await page.setInputFiles('input[type="file"]', {
      name: "orders_july.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV),
    });
    await page.waitForTimeout(900);
    await cursor.glideTo(page.getByText(/detected:/i).first(), 900);
  });

  // ── b2 — nothing rigidly required (overlay: the file itself) ───────────────
  await beat("b2-required", async () => {
    await showOverlay(page, "THE FILE, AS DROPPED", "required");
    await cursor.glideToPoint(1220, 420, 900);
  });

  // ── b3 — header aliases (overlay) ──────────────────────────────────────────
  await beat("b3-headers", async () => {
    await showOverlay(page, "HEADERS, NORMALISED", "headers");
    await cursor.glideToPoint(1200, 480, 900);
  });

  // ── b4 — encoding (overlay) ────────────────────────────────────────────────
  await beat("b4-encoding", async () => {
    await showOverlay(page, "ENCODING", "encoding");
    await cursor.glideToPoint(1200, 520, 900);
  });

  // ── b5 — decimal rules (overlay) ───────────────────────────────────────────
  await beat("b5-decimals", async () => {
    await showOverlay(page, "NUMBERS, LOCALE-AWARE", "decimals");
    await cursor.glideToPoint(1200, 500, 900);
    await page.waitForTimeout(2200);
    await cursor.glideToPoint(1240, 620, 1100);
  });

  // ── b6 — into review (real UI; overlay dismissed) ──────────────────────────
  // The default supplier ("Send to", first option) is kept — the VO names no
  // supplier. NOTE: the redesigned upload page has NO native <select> (custom
  // combobox), so earlier takes burned 8s on a dead locator here — the click
  // must fire immediately so the preview lands while this VO plays.
  await beat("b6-review", async () => {
    await hideOverlay(page);
    await cursor.click(page.getByRole("button", { name: /upload & review/i }).first(), 900);
    await page.waitForURL(/\/upload\/preview\//i, { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await cursor.glideToPoint(960, 560, 900);
  });

  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
