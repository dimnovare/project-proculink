/* =============================================================================
 * ProcuLink LIVE per-format upload harness (file-parser ingest channel)
 * -----------------------------------------------------------------------------
 * Uploads ONE synthetic fixture per inbound FILE format, then polls the order
 * until it leaves a parsing state, reporting per-format parsed/lines/status. This
 * exercises the file PARSERS (CsvOrderParser, UblOrderParser, CxmlOrderParser,
 * IDocOrders05Parser, EdifactOrderParser, X12 850) — distinct from the API-ingress
 * harness, which accepts already-structured orders and bypasses the parsers.
 *
 *   POST /api/orders/upload            (multipart: file + supplierId)
 *   GET  /api/orders/{id}              (poll for parse status + line count)
 *
 * Text fixtures (CSV, UBL, cXML, IDoc ORDERS05, EDIFACT, X12 850) are synthesized
 * in-process — the SAME generators the browser-console runner.js uses, so they are
 * already known to parse on live prod. XLSX and PDF are BINARY — never fabricated;
 * pass base64 via PLK_XLSX_B64 / PLK_PDF_B64 to include them, else they are skipped.
 *
 * Auth: a Clerk JWT in PLK_CLERK_TOKEN. Clerk JWTs are SHORT-LIVED (~60 s) — grab a
 * fresh one from a signed-in browser tab's console:  await window.Clerk.session.getToken()
 * Uploading 6 text formats fits comfortably inside one token's lifetime.
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────
 *   PLK_API=https://api.proculink.eu \
 *   PLK_CLERK_TOKEN="<fresh Clerk JWT>" \
 *   PLK_SUPPLIER_ID="<supplier uuid>" \
 *     bun scripts/live-matrix/format-upload-harness.mjs
 *
 *   # include binaries:
 *   PLK_XLSX_B64="$(base64 -w0 order.xlsx)" PLK_PDF_B64="$(base64 -w0 order.pdf)" \
 *     PLK_CLERK_TOKEN=... PLK_SUPPLIER_ID=... bun scripts/live-matrix/format-upload-harness.mjs
 *
 * If PLK_SUPPLIER_ID is omitted, the first supplier from GET /api/suppliers is used.
 * Per-user upload limit is 20/60s; 6 text + 2 binary uploads stay well under it.
 * ========================================================================== */

const API = process.env.PLK_API || "https://api.proculink.eu";
const TOKEN = process.env.PLK_CLERK_TOKEN;
let SUPPLIER_ID = process.env.PLK_SUPPLIER_ID;
const XLSX_B64 = process.env.PLK_XLSX_B64;
const PDF_B64 = process.env.PLK_PDF_B64;

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

if (!TOKEN) {
  console.error("Set PLK_CLERK_TOKEN (fresh `await window.Clerk.session.getToken()`). PLK_SUPPLIER_ID optional.");
  process.exit(1);
}

function authHeaders(extra) {
  return { Authorization: `Bearer ${TOKEN}`, ...(extra || {}) };
}

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

// ─── Fixture generators (ported verbatim-in-spirit from runner.js) ────────────

function genCSV(seed) {
  const lines = 3;
  const po = `PO-CSV-${seed}`;
  const rows = ["po_number,buyer_name,line_no,item_code,description,quantity,unit,unit_price"];
  for (let i = 1; i <= lines; i++) {
    rows.push([po, "Acme", i, "ITEM-" + i, "Widget " + i, 10 + i, "EA", (5.99 + i).toFixed(2)].join(","));
  }
  return { content: rows.join("\n"), ext: ".csv", mime: "text/csv" };
}

function genUBL(seed) {
  const lines = 2;
  const po = `PO-UBL-${seed}`;
  let body = "";
  for (let i = 1; i <= lines; i++) {
    body +=
      "<cac:OrderLine><cac:LineItem>" +
      `<cbc:ID>${i}</cbc:ID>` +
      `<cbc:Quantity unitCode="EA">${10 + i}</cbc:Quantity>` +
      `<cac:Price><cbc:PriceAmount>${(5.99 + i).toFixed(2)}</cbc:PriceAmount></cac:Price>` +
      `<cac:Item><cbc:Name>Widget ${i}</cbc:Name>` +
      `<cac:SellersItemIdentification><cbc:ID>SUP-${pad(i)}</cbc:ID></cac:SellersItemIdentification>` +
      "</cac:Item></cac:LineItem></cac:OrderLine>";
  }
  const xml =
    '<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"' +
    ' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"' +
    ' xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">' +
    `<cbc:ID>${po}</cbc:ID>${body}</Order>`;
  return { content: xml, ext: ".xml", mime: "application/xml" };
}

function genCXML(seed) {
  const lines = 2;
  const po = `PO-CXML-${seed}`;
  let total = 0;
  let items = "";
  for (let i = 1; i <= lines; i++) {
    const qty = 10 + i;
    const price = +(5.99 + i).toFixed(2);
    total += qty * price;
    items +=
      `<ItemOut quantity="${qty}" lineNumber="${i}">` +
      `<ItemID><SupplierPartID>SUP-${pad(i)}</SupplierPartID></ItemID>` +
      `<ItemDetail><UnitPrice><Money currency="EUR">${price.toFixed(2)}</Money></UnitPrice>` +
      `<Description>Widget ${i}</Description></ItemDetail></ItemOut>`;
  }
  const xml =
    '<cXML><Request deploymentMode="production"><OrderRequest>' +
    `<OrderRequestHeader orderID="${po}" type="new">` +
    `<Total><Money currency="EUR">${total.toFixed(2)}</Money></Total></OrderRequestHeader>` +
    `${items}</OrderRequest></Request></cXML>`;
  return { content: xml, ext: ".xml", mime: "application/xml" };
}

function genIDoc(seed) {
  const lines = 2;
  const po = `PO-IDOC-${seed}`;
  let body = "";
  for (let i = 1; i <= lines; i++) {
    body +=
      `<E1EDP01><POSEX>${i}</POSEX><MENGE>${10 + i}</MENGE><MENEE>EA</MENEE>` +
      `<VPREI>${(5.99 + i).toFixed(2)}</VPREI>` +
      `<E1EDP19><QUALF>002</QUALF><IDTNR>ITEM-${i}</IDTNR></E1EDP19></E1EDP01>`;
  }
  const xml =
    "<ORDERS05><IDOC BEGIN=\"1\">" +
    "<EDI_DC40 SEGMENT=\"1\"><IDOCTYP>ORDERS05</IDOCTYP><MESTYP>ORDERS</MESTYP></EDI_DC40>" +
    "<E1EDK01><CURCY>EUR</CURCY></E1EDK01>" +
    `<E1EDK02><QUALF>001</QUALF><BELNR>${po}</BELNR></E1EDK02>` +
    `${body}</IDOC></ORDERS05>`;
  return { content: xml, ext: ".xml", mime: "application/xml" };
}

function genEDIFACT(seed) {
  const lines = 2;
  const po = `PO-EDI-${seed}`;
  const segs = [];
  segs.push("UNB+UNOC:3+SENDER+RECEIVER+260115:0900+1");
  segs.push("UNH+1+ORDERS:D:96A:UN");
  segs.push(`BGM+220+${po}+9`);
  segs.push("DTM+137:20260115:102");
  for (let i = 1; i <= lines; i++) {
    segs.push(`LIN+${i}++ITEM-${i}:IN`);
    segs.push(`QTY+21:${10 + i}:EA`);
    segs.push(`PRI+AAA:${(5.99 + i).toFixed(2)}`);
  }
  segs.push(`UNT+${lines * 3 + 4}+1`);
  segs.push("UNZ+1+1");
  return { content: segs.join("'") + "'", ext: ".edi", mime: "application/octet-stream" };
}

function genX12(seed) {
  const lines = 2;
  const po = `PO-X12-${seed}`;
  const segs = [];
  segs.push("ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*0900*U*00401*000000001*0*P*>");
  segs.push("GS*PO*SENDER*RECEIVER*20260115*0900*1*X*004010");
  segs.push("ST*850*0001");
  segs.push(`BEG*00*NE*${po}**20260115`);
  for (let i = 1; i <= lines; i++) {
    segs.push(`PO1*${i}*${10 + i}*EA*${(5.99 + i).toFixed(2)}**BP*ITEM-${i}`);
  }
  segs.push(`SE*${lines + 3}*0001`);
  segs.push("GE*1*1");
  segs.push("IEA*1*000000001");
  return { content: segs.join("~") + "~", ext: ".x12", mime: "application/octet-stream" };
}

// ─── Upload + poll ─────────────────────────────────────────────────────────

function b64ToBytes(b64) {
  return Buffer.from(b64, "base64");
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

async function uploadFixture(label, fixture, fileName) {
  const fd = new FormData();
  const blob = new Blob([fixture.content ?? fixture.bytes], { type: fixture.mime });
  fd.append("file", blob, fileName);
  fd.append("supplierId", SUPPLIER_ID);
  const res = await fetch(`${API}/api/orders/upload`, {
    method: "POST",
    headers: authHeaders(), // DO NOT set Content-Type — fetch sets the multipart boundary
    body: fd,
  });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    /* non-JSON */
  }
  const id = json && (json.id || json.orderId || json.Id || json.OrderId);
  return { status: res.status, ok: res.ok, id, raw: txt.slice(0, 200) };
}

function statusOf(order) {
  return (order && (order.status || order.Status) ? order.status || order.Status : "").toString().toLowerCase();
}
function lineCountOf(order) {
  if (!order) return 0;
  if (Array.isArray(order.lines)) return order.lines.length;
  if (Array.isArray(order.Lines)) return order.Lines.length;
  if (typeof order.lineCount === "number") return order.lineCount;
  return 0;
}
function isTerminal(s) {
  return s && !["parsing", "pending", "uploaded", "queued"].includes(s);
}
function parsedOk(s) {
  return isTerminal(s) && !["parse_failed", "failed", "error", "rejected", "invalid"].includes(s);
}

async function pollOrder(id) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/api/orders/${id}`, { headers: authHeaders() });
    if (res.ok) {
      last = await res.json();
      if (isTerminal(statusOf(last))) return last;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return last;
}

(async () => {
  try {
    SUPPLIER_ID = await resolveSupplierId();
    const seed = Date.now() % 100000;
    console.log(`[format-upload] API=${API} supplier=${SUPPLIER_ID}`);

    const jobs = [
      { label: "CSV", fixture: genCSV(seed), name: `harness-csv-${seed}.csv` },
      { label: "UBL", fixture: genUBL(seed), name: `harness-ubl-${seed}.xml` },
      { label: "cXML", fixture: genCXML(seed), name: `harness-cxml-${seed}.xml` },
      { label: "IDoc ORDERS05", fixture: genIDoc(seed), name: `harness-idoc-${seed}.xml` },
      { label: "EDIFACT", fixture: genEDIFACT(seed), name: `harness-edi-${seed}.edi` },
      { label: "X12 850", fixture: genX12(seed), name: `harness-x12-${seed}.x12` },
    ];
    if (XLSX_B64) {
      jobs.push({
        label: "XLSX",
        fixture: {
          bytes: b64ToBytes(XLSX_B64),
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        name: `harness-xlsx-${seed}.xlsx`,
      });
    } else {
      console.log("[format-upload] XLSX skipped (set PLK_XLSX_B64 to include it).");
    }
    if (PDF_B64) {
      jobs.push({
        label: "PDF",
        fixture: { bytes: b64ToBytes(PDF_B64), mime: "application/pdf" },
        name: `harness-pdf-${seed}.pdf`,
      });
    } else {
      console.log("[format-upload] PDF skipped (set PLK_PDF_B64 to include it).");
    }

    const results = [];
    for (const job of jobs) {
      const up = await uploadFixture(job.label, job.fixture, job.name);
      if (!up.ok || !up.id) {
        results.push({ format: job.label, uploadStatus: up.status, parsed: false, status: "(upload failed)", lines: 0, error: up.raw });
        console.log(`  ${job.label.padEnd(15)} upload=${up.status} FAIL ${up.raw}`);
        continue;
      }
      const order = await pollOrder(up.id);
      const s = statusOf(order);
      const ok = parsedOk(s);
      const lines = lineCountOf(order);
      results.push({ format: job.label, uploadStatus: up.status, orderId: up.id, parsed: ok, status: s || "(no status)", lines });
      console.log(`  ${job.label.padEnd(15)} upload=${up.status} order=${up.id} parsed=${ok} status=${s || "?"} lines=${lines}`);
    }

    const okCount = results.filter((r) => r.parsed).length;
    console.log(`[format-upload] DONE parsed ${okCount}/${results.length} formats.`);
    console.table(results.map((r) => ({ format: r.format, parsed: r.parsed, status: r.status, lines: r.lines })));
    if (okCount < results.length) process.exitCode = 1;
  } catch (e) {
    console.error("[format-upload] ERROR:", e && e.message);
    process.exitCode = 1;
  }
})();
