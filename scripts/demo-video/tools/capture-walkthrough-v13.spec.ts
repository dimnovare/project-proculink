import { test, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MarkerClock, holdBudgets, loadToolSpec, prepareDemoPage, soft } from "./demo-helpers";

/**
 * FULL WALKTHROUGH v13 capture — the ENTERPRISE master.
 *
 * Hybrid structure (founder-approved): one end-to-end PO journey (the spine,
 * beats s1–s7) + a fast enterprise capability montage (s8–s10) + brand outro.
 *
 * Inherits v12's accepted discipline (the founder's named v11 defect was
 * synthetic cursor drift — "the voice speaks while the mouse is just hovering"):
 *
 *   1. NO SYNTHETIC CURSOR MOTION. The cursor is hidden and STILL by default
 *      (gated by body[data-plk-cursor]). It appears only in the ~0.5s window
 *      around a real click, glides straight to the click target, clicks, then
 *      hides and parks. It never drifts, hovers, or wanders to "point at" copy.
 *   2. REAL MOTION ONLY — a real click, real typing, or a real UI state change
 *      (Generating→Sent→Delivered, a tab switch, a route change). Never invented.
 *   3. Cross-screen navigation happens BEFORE the beat is marked (in a soft()
 *      pre-step + settlePage), so a beat's VO never starts over a loading screen.
 *
 * Same real-UI mock-mode pipeline as v9–v12 (port 8090, placeholder Clerk key),
 * same Daniel voice, fresh enterprise music bed, brand intro/outro cards.
 *
 *   bun run demo:tools:capture capture-walkthrough-v13
 */

const here = dirname(fileURLToPath(import.meta.url));
const spec = loadToolSpec("walkthrough-v13");
// small cut pad — the VO governs each beat length; a touch of breath for an
// enterprise/calm feel, but no dead-air drift.
const holds = holdBudgets(spec, 250);

const ORDER_PO = /PO-2024-005678/i; // the one order we follow, end to end

const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2026-004417,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2026-004417,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2026-004417,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

test("tool capture: full walkthrough v13 (enterprise, still cursor)", async ({ page }) => {
  test.setTimeout(900_000);

  const clock = new MarkerClock();
  // "Acme Manufacturing" — the Full-document SOURCE-FIELDS mapping helper renders
  // a generic placeholder schema (buyer "Acme Manufacturing") that contradicts
  // this order's real buyer (Nordic Electronics) in the same frame; hide just the
  // contradictory buyer value (layout-stable visibility hide).
  await prepareDemoPage(page, { hideTexts: ["Failed to fetch", "Loading members", "Acme Manufacturing"] });

  // ── STILL-CURSOR control (verbatim from v12) ───────────────────────────────
  await page.addInitScript(() => {
    const apply = () => {
      const c = document.getElementById("plk-demo-cursor");
      if (!c) return;
      const on = document.body?.getAttribute("data-plk-cursor") === "on";
      c.style.display = on ? "block" : "none";
      if (!on) c.style.opacity = "0";
    };
    const obs = new MutationObserver(apply);
    const start = () => {
      document.body.setAttribute("data-plk-cursor", "off");
      obs.observe(document.body, { attributes: true, attributeFilter: ["data-plk-cursor"], childList: true, subtree: true });
      apply();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  });

  const cursorOn = () => page.evaluate(() => document.body.setAttribute("data-plk-cursor", "on")).catch(() => {});
  const cursorOff = () => page.evaluate(() => document.body.setAttribute("data-plk-cursor", "off")).catch(() => {});

  let cx = 960, cy = 600;

  const glideToPoint = async (tx: number, ty: number, ms = 520) => {
    const frames = Math.max(8, Math.round(ms / 16));
    const x0 = cx, y0 = cy;
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      await page.mouse.move(x0 + (tx - x0) * e, y0 + (ty - y0) * e);
      await page.waitForTimeout(14);
    }
    cx = tx; cy = ty;
  };

  // The ONLY thing that moves the cursor: a real click.
  const realClick = async (loc: Locator, glideMs = 520): Promise<boolean> => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    const tx = box.x + box.width / 2;
    const ty = box.y + box.height / 2;
    await cursorOn();
    await glideToPoint(tx, ty, glideMs);
    await page.waitForTimeout(180);
    await page.mouse.down();
    await page.waitForTimeout(110);
    await page.mouse.up();
    await page.waitForTimeout(360);
    await cursorOff();
    return true;
  };

  const realType = async (input: Locator, text: string) => {
    await input.click().catch(() => {});
    // CLEAR first — the manual supplier-code field is an autocomplete combobox;
    // typing without clearing appended to an existing value and produced a
    // garbled code (e.g. "ES-WIRE-22BK-1ES-WIRE-22BK-100") that then polluted the
    // supplier-output XML. Select-all + delete guarantees a clean typed value.
    await page.keyboard.press("Control+a").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await page.keyboard.type(text, { delay: 55 });
    await page.waitForTimeout(150);
    await cursorOff();
  };

  // Brand the ingress endpoint host for the demo: the mock renders the dev API
  // base (http://localhost:5223); swap it to the prod-style branded host so the
  // enterprise cut doesn't show "localhost". The /api/ingress/{slug}/orders path
  // and the capability are real; only the host string is cosmetically prod-ified.
  const brandIngressHost = () =>
    page.evaluate(() => {
      const fix = (s: string) => s.replace(/https?:\/\/localhost:5223/g, "https://api.proculink.eu");
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const n of nodes) if (n.nodeValue && n.nodeValue.includes("localhost:5223")) n.nodeValue = fix(n.nodeValue);
      for (const inp of Array.from(document.querySelectorAll("input"))) {
        if (inp.value && inp.value.includes("localhost:5223")) inp.value = fix(inp.value);
      }
    }).catch(() => {});

  const beat = async (id: string, actions?: () => Promise<void>) => {
    clock.mark(id);
    if (actions) await soft(id, actions);
    const left = holds[id] - clock.since(id);
    if (left > 0) await page.waitForTimeout(left);
  };

  // Re-seed cookie consent + wait out first-paint flashes so no cut lands on a
  // consent banner, a "Loading…" workspace, or a "Checking plan limits…" stub.
  const settlePage = async () => {
    await page.evaluate(() => {
      try {
        window.localStorage.setItem("proculink_cookie_consent_v1", "functional-only");
        window.dispatchEvent(new CustomEvent("proculink:cookie-consent", { detail: "functional-only" }));
      } catch { /* ignore */ }
    }).catch(() => {});
    await page.getByText(/We don't use advertising/i).first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
    await page.getByText(/Checking plan limits/i).first().waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
    await page.getByText(/^Loading\.\.\.$/).first().waitFor({ state: "hidden", timeout: 6_000 }).catch(() => {});
  };

  // Brand lower-third (honest capability label for the no-egress security beat —
  // there is no self-serve toggle to film). Injected DOM, removed on next nav.
  const showLowerThird = (text: string) =>
    page.evaluate((t) => {
      let el = document.getElementById("plk-lower-third");
      if (!el) {
        el = document.createElement("div");
        el.id = "plk-lower-third";
        document.body.appendChild(el);
      }
      el.textContent = t;
      Object.assign(el.style, {
        position: "fixed", left: "50%", bottom: "70px", transform: "translateX(-50%)",
        background: "rgba(11,26,47,0.93)", color: "#FFFFFF",
        font: "600 27px 'Segoe UI', system-ui, sans-serif", letterSpacing: "-0.2px",
        padding: "17px 30px", borderRadius: "14px",
        border: "1px solid #1C2F49", borderLeft: "4px solid #3DBE6B",
        boxShadow: "0 10px 34px rgba(0,0,0,0.38)", zIndex: "2147483646",
        pointerEvents: "none", opacity: "0", transition: "opacity .45s ease",
        whiteSpace: "nowrap",
      });
      requestAnimationFrame(() => { (el as HTMLElement).style.opacity = "1"; });
    }, text).catch(() => {});

  // ── warmup: compile EVERY route we use so no mid-video nav stalls on a dev
  //    first-compile (the assembler trims all of this before the first beat). ──
  for (const r of ["/upload", "/inbox/ord-002", "/settings", "/connections"]) {
    await soft(`warmup ${r}`, async () => {
      await page.goto(r, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(900);
    });
  }

  // ════════════════ SPINE — one PO journey ════════════════════════════════════

  // s1-upload — open /upload, drop a CSV, settle STILL on the auto-detect result.
  await soft("nav-upload", async () => {
    await page.goto("/upload", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /upload an order/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
  });
  await beat("s1-upload", async () => {
    const browse = page.getByRole("button", { name: /browse files/i }).first();
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 6_000 }).catch(() => null);
    await realClick(browse, 560);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles({ name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV) });
    } else {
      await page.setInputFiles('input[type="file"]', {
        name: "orders_june.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV),
      }).catch(() => {});
    }
    await page.getByText(/detected:/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
    // mid-beat REAL state change (breaks the otherwise-static tail of this long
    // opening beat + ties the upload to the supplier we then follow): route this
    // upload to ElectroSupply Co — the "routes to …" line updates live on camera.
    await page.locator("select").first().selectOption({ label: "ElectroSupply Co" }).catch(() => {});
    await page.getByText(/routes to/i).first().waitFor({ timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(300); // settle STILL on the detect pill + routed supplier
  });

  // s2-review — cut to the parsed order in review; settle STILL.
  await soft("nav-inbox", async () => {
    await page.goto("/inbox/ord-002", { waitUntil: "domcontentloaded" });
    await page.getByText(ORDER_PO).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.getByRole("list", { name: /open issues/i }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
    await page.waitForTimeout(300);
  });
  await beat("s2-review");

  // s3-accept — accept the AI suggestion on line 2.
  await beat("s3-accept", async () => {
    const accept = page.getByRole("button", { name: /accept ai suggestion for line 2/i }).first();
    await realClick(accept, 560);
    await page.waitForTimeout(300); // queue advances (real state change)
  });

  // s4-type — manual entry on line 4, type the code, save.
  await beat("s4-type", async () => {
    const manual = page.getByRole("button", { name: /enter a supplier code manually for line 4/i }).first();
    await realClick(manual, 520);
    const input = page.getByLabel(/supplier code for line 4/i).first();
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    await cursorOn();
    await realType(input, "ES-WIRE-22BK-100");
    await realClick(page.getByRole("button", { name: /^save$/i }).first(), 460);
    await page.waitForTimeout(300);
  });

  // s5-validate — settle STILL on the send-readiness card (scroll Send into view
  //   so the readiness card above it is in frame; NO click — pure narration).
  await beat("s5-validate", async () => {
    await page.getByRole("button", { name: /^send to supplier$/i }).first()
      .scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
  });

  // s6-convert — toggle Full document: source / canonical / supplier output.
  await beat("s6-convert", async () => {
    const fullDoc = page.getByRole("button", { name: /full document/i }).first();
    if (await fullDoc.isVisible().catch(() => false)) {
      await realClick(fullDoc, 540);
      await page.waitForTimeout(500); // the triptych builds (real state change)
    }
  });

  // s7-deliver — back to Triage, Send → Generating → Sent → Delivered; settle on
  //   the Delivered/audit STILL frame.
  await beat("s7-deliver", async () => {
    await soft("back-to-triage", async () => {
      const triage = page.getByRole("button", { name: /^triage(\s*\(\d+\))?$/i }).first();
      if (await triage.isVisible().catch(() => false)) await realClick(triage, 460);
    });
    await realClick(page.getByRole("button", { name: /^send to supplier$/i }).first(), 540);
    await page.locator("#confirm-check").waitFor({ timeout: 6_000 }).catch(() => {});
    await realClick(page.locator("#confirm-check"), 380);
    await realClick(page.getByRole("button", { name: /send to supplier/i }).last(), 380);
    await page.getByText(/generating|sending|sent/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.getByText(/delivered/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await cursorOff();
    await page.waitForTimeout(200);
  });

  // ════════════════ MONTAGE — enterprise capabilities ═════════════════════════

  // s8-integrations — /settings → API Keys: create a one-time plk_ key.
  await soft("nav-settings", async () => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByText(/how do you use proculink/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
  });
  await beat("s8-integrations", async () => {
    await realClick(page.getByRole("button", { name: /api keys/i }).first(), 620);
    await page.getByText(/ingress endpoint/i).first().waitFor({ timeout: 6_000 }).catch(() => {});
    await brandIngressHost(); // localhost:5223 → api.proculink.eu (cosmetic, host only)
    await realClick(page.getByRole("button", { name: /create key/i }).first(), 560);
    await page.waitForTimeout(300);
    await cursorOn();
    await page.keyboard.type("ERP integration", { delay: 55 });
    await cursorOff();
    await page.waitForTimeout(300);
    await realClick(page.getByRole("button", { name: /create key/i }).first(), 460);
    await page.getByText(/api key created/i).first().waitFor({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(300); // settle STILL on the one-time key
  });

  // s9-security — client-side switch to SFTP pull tab (real "secrets are
  //   encrypted" copy) + an honest brand lower-third for the no-egress option.
  await beat("s9-security", async () => {
    await realClick(page.getByRole("button", { name: /sftp pull/i }).first(), 600);
    await page.getByText(/secrets are encrypted/i).first().waitFor({ timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(200);
    await showLowerThird("AES-GCM encrypted credentials  ·  Self-hosted, no-egress option");
    await page.waitForTimeout(300); // hold STILL with the lower-third up
  });

  // s10-versioned — /connections: versioned revisions + the rollback affordance.
  await soft("nav-connections", async () => {
    await page.goto("/connections", { waitUntil: "domcontentloaded" });
    await page.getByText("FastParts Inc").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await settlePage();
  });
  await beat("s10-versioned", async () => {
    await realClick(page.getByText("FastParts Inc").first(), 600);
    await page.waitForURL(/\/connections\/conn-/i, { timeout: 10_000 }).catch(() => {});
    await page.getByText(/live revision/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.getByText(/revision history/i).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300); // settle STILL on the versioned detail
  });

  // s11-close — VO plays over the assembler's outro card; nothing on-UI.
  clock.mark("s11-close");

  // ── save markers + deterministic footage path ─────────────────────────────
  clock.save(spec.id);
  const dest = resolve(here, "out", spec.id, "capture.webm");
  mkdirSync(dirname(dest), { recursive: true });
  await page.close();
  await page.video()?.saveAs(dest);
  console.log(`[tool-demo] footage → ${dest}`);
});
