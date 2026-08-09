/* =============================================================================
 * ProcuLink LIVE headless ingest harness (API channel)
 * -----------------------------------------------------------------------------
 * Fills the inbox with N varied STRUCTURED purchase orders via the API-key
 * ingress channel:  POST /api/ingress/{slug}/orders  (header: X-ProcuLink-Key).
 *
 * Run (background) against the LOCAL API — the default target:
 *   PLK_KEY=plk_... PLK_SLUG=personal-workspace-xxxx PLK_SUPPLIER=<uuid> PLK_TARGET=2000 \
 *     node scripts/live-matrix/ingest-harness.mjs
 *
 * Against production, the target must be named AND opted into on the command line:
 *   PLK_API=https://api.proculink.eu PLK_KEY=... PLK_SLUG=... PLK_SUPPLIER=<uuid> \
 *     node scripts/live-matrix/ingest-harness.mjs --allow-production
 *
 * That opt-in exists because this script used to default to production: on
 * 2026-06-10 a run with no PLK_API wrote 2,000 orders (PO numbers E2E-API-00000
 * .. E2E-API-01999) into the live customer database in ~54 seconds. See
 * ./target.mjs for the rules.
 *
 * Honest scope: the ingress channel accepts ALREADY-STRUCTURED orders (it does
 * NOT exercise the file parsers — those need file uploads). This harness proves
 * the API ingest channel + canonical->review at volume, with widely varied data
 * (PO numbers, supplier, currency, line counts, qty/price incl. edge values,
 * order dates). Other channels (file-upload formats, inbound email) are driven
 * separately.
 *
 * Resumable: appends created order ids to ingest-results.ndjson; re-running
 * continues toward PLK_TARGET (counts existing lines). 429-aware (backs off).
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargetOrExit } from './target.mjs';

const { api: API } = resolveTargetOrExit('ingest-harness.mjs');
const KEY   = process.env.PLK_KEY;
const SLUG  = process.env.PLK_SLUG;
const SUP   = process.env.PLK_SUPPLIER;
const TARGET= parseInt(process.env.PLK_TARGET || '2000', 10);
const CONC  = parseInt(process.env.PLK_CONC || '8', 10);

// PLK_SUPPLIER is required, and deliberately has no default: the default used to be a
// real supplier's uuid, which made a production-shaped run the path of least resistance.
if (!KEY || !SLUG || !SUP) {
  console.error('Set PLK_KEY, PLK_SLUG and PLK_SUPPLIER (supplier uuid).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(__dirname, 'ingest-results.ndjson');
const PROGRESS= path.join(__dirname, 'ingest-progress.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(PROGRESS, line + '\n');
  console.log(line);
}

// ---- data variation ---------------------------------------------------------
const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'PLN'];
const BUYERS = ['Acme Corp', 'Northwind Trading OÜ', 'Globex GmbH', 'Initech BV', 'Umbrella SA', 'Stark Industries', 'Wayne Enterprises'];
const UNITS = ['EA', 'BOX', 'PCS', 'KG', 'PALLET'];
// deterministic pseudo-random from an index (no Math.random — reproducible)
function rng(seed) { let x = Math.sin(seed) * 10000; return x - Math.floor(x); }
function pick(arr, seed) { return arr[Math.floor(rng(seed) * arr.length) % arr.length]; }

function buildOrder(i) {
  const lineCount = 1 + Math.floor(rng(i * 7.1) * 8);          // 1..8 lines
  const cur = pick(CURRENCIES, i * 1.3);
  const lines = [];
  for (let n = 1; n <= lineCount; n++) {
    const qty   = 1 + Math.floor(rng(i * 3.7 + n) * 500);       // 1..500
    const price = +(0.5 + rng(i * 2.2 + n) * 999).toFixed(2);   // 0.5..999.5
    lines.push({
      lineNumber: n,
      buyerItemCode: `ITEM-${(i % 50) + 1}-${n}`,
      description: `Widget ${n} (batch ${i})`,
      quantity: qty,
      unit: pick(UNITS, i + n),
      unitPrice: price,
    });
  }
  return {
    supplierId: SUP,
    poNumber: `E2E-API-${String(i).padStart(5, '0')}`,
    orderDate: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    currency: cur,
    buyerName: pick(BUYERS, i),
    lines,
  };
}

async function postOne(i) {
  const body = JSON.stringify(buildOrder(i));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${API}/api/ingress/${SLUG}/orders`, {
        method: 'POST',
        headers: { 'X-ProcuLink-Key': KEY, 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-${i}` },
        body,
      });
      if (res.status === 429) {
        const wait = 2000 * (attempt + 1);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      const txt = await res.text();
      let j = null; try { j = JSON.parse(txt); } catch {}
      return { i, status: res.status, ok: res.ok, id: j && (j.id || j.Id), err: res.ok ? null : txt.slice(0, 120) };
    } catch (e) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return { i, status: 'fail', ok: false, err: 'exhausted retries' };
}

function alreadyDone() {
  if (!fs.existsSync(RESULTS)) return 0;
  return fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).length;
}

(async () => {
  const start = alreadyDone();
  log(`START ingest harness: target=${TARGET}, already=${start}, conc=${CONC}, slug=${SLUG}`);
  let done = start, ok = 0, fail = 0, statuses = {};
  let next = start;
  async function worker() {
    while (next < TARGET) {
      const i = next++;
      const r = await postOne(i);
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.ok) ok++; else fail++;
      fs.appendFileSync(RESULTS, JSON.stringify(r) + '\n');
      done++;
      if (done % 100 === 0) log(`progress ${done}/${TARGET} (ok=${ok} fail=${fail}) statuses=${JSON.stringify(statuses)}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  log(`DONE ingest harness: total=${done}/${TARGET} ok=${ok} fail=${fail} statuses=${JSON.stringify(statuses)}`);
})();
