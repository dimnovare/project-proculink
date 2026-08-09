/* =============================================================================
 * ProcuLink LIVE in×out format matrix runner  (browser-console / Claude-in-Chrome)
 * -----------------------------------------------------------------------------
 * PASTE THIS WHOLE FILE into the DevTools console of an AUTHENTICATED
 * https://proculink.eu (or app.proculink.eu) tab, then drive it with:
 *
 *     await window.__matrixRun();                       // one bounded batch
 *     // call it again (and again) across rate-limit windows until done:
 *     await window.__matrixRun();
 *
 * It NEVER hardcodes a token — it pulls a fresh Clerk JWT per request via
 * window.Clerk.session.getToken(). It talks to the API at https://api.proculink.eu.
 *
 * Strategy: parse-once / transform-to-many.
 *   - Upload a small set of procedurally-generated fixtures per inbound format.
 *   - For each PARSED order, hit the preview/transform endpoints for EVERY
 *     outbound format. One upload therefore yields (outboundFormats) combos.
 *   - Uploads are the only rate-limited verb, so we pace those (<=18 / 60s) and
 *     fan out transforms freely (they are not in the per-user upload window).
 *
 * Resumable: results accumulate on window.__matrix; combos already recorded are
 * skipped, and orders already uploaded (window.__matrix.orders) are reused so a
 * re-run does not burn the upload budget again.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- configuration ------------------------------------------------------
  // THIS FILE TARGETS PRODUCTION, DELIBERATELY AND ONLY.
  //
  // Unlike the .mjs harnesses in this folder — which now default to
  // http://localhost:5223 and refuse a proculink.eu target without an explicit
  // `--allow-production` flag (see ./target.mjs) — this runner has no target
  // switch, because it has no way to be run by accident: it is pasted into the
  // DevTools console of a tab that is ALREADY signed in to production, and it
  // borrows that tab's Clerk session. There is no node entry point, no argv and
  // no process.env, so CI and agent sessions cannot reach it at all.
  //
  // It WRITES: up to 20 real purchase orders per full pass, plus real
  // state-changing transforms on each. Do not add a node entry point to this
  // file — src/test/liveHarnessTarget.test.ts fails the build if you do, because
  // a shell-runnable version of this file reintroduces the hardcoded production
  // default that the .mjs harnesses just lost.
  var API_BASE = 'https://api.proculink.eu';
  var SUPPLIER_ID = '688a51ab-8125-4c00-be7d-a00807ce640b';

  // Per-user fixed upload window is 20 / 60s. Stay under it with headroom.
  var UPLOAD_LIMIT_PER_WINDOW = 18;
  var UPLOAD_WINDOW_MS = 60 * 1000;

  // Keep a single __matrixRun() invocation bounded so it returns quickly.
  var MAX_UPLOADS_PER_INVOCATION = 6;   // <=18/60s, leaves room for retries
  var INVOCATION_BUDGET_MS = 38 * 1000; // return in <40s

  var PARSE_POLL_INTERVAL_MS = 1500;
  var PARSE_POLL_TIMEOUT_MS = 25 * 1000;

  // Inbound formats we can synthesize text fixtures for in-page.
  // XLSX + PDF are BINARY — only run if caller supplies base64 (never fabricate).
  var TEXT_INBOUND = ['CSV', 'UBL', 'cXML', 'IDoc ORDERS05', 'EDIFACT', 'X12 850'];
  var BINARY_INBOUND = ['XLSX', 'PDF'];
  var ALL_INBOUND = TEXT_INBOUND.concat(BINARY_INBOUND);

  // Outbound formats. Preview endpoint only supports csv|json; everything else
  // goes through the real transform endpoint (which mutates order state, so we
  // run it last / tolerate 409 while a prior transform is in flight).
  var ALL_OUTBOUND = ['csv', 'json', 'xml', 'cxml', 'ubl', 'x12'];
  var PREVIEW_FORMATS = { csv: true, json: true };

  // ---- shared state -------------------------------------------------------
  if (!window.__matrix || typeof window.__matrix !== 'object') {
    window.__matrix = { combos: [], summary: {}, orders: {}, uploadTimestamps: [] };
  }
  var M = window.__matrix;
  M.combos = M.combos || [];
  M.orders = M.orders || {};            // key: inboundFormat+'#'+variantId -> { orderId, parseOk, parseLines, error }
  M.uploadTimestamps = M.uploadTimestamps || [];

  function comboKey(inFmt, variantId, outFmt) {
    return inFmt + '#' + variantId + '->' + outFmt;
  }
  function hasCombo(inFmt, variantId, outFmt) {
    var k = comboKey(inFmt, variantId, outFmt);
    return M._index && M._index[k];
  }
  function recordCombo(rec) {
    if (!M._index) M._index = {};
    var k = comboKey(rec.inboundFormat, rec.variantId, rec.outboundFormat);
    if (M._index[k]) return; // de-dupe within a session
    M._index[k] = true;
    M.combos.push(rec);
  }
  // Rebuild the de-dupe index from any pre-existing combos (resume across reloads).
  if (!M._index) {
    M._index = {};
    for (var i = 0; i < M.combos.length; i++) {
      var c = M.combos[i];
      M._index[comboKey(c.inboundFormat, c.variantId, c.outboundFormat)] = true;
    }
  }

  // ---- auth ---------------------------------------------------------------
  async function getToken() {
    if (!window.Clerk || !window.Clerk.session) {
      throw new Error('Clerk session not available — open an authenticated proculink.eu tab.');
    }
    var t = await window.Clerk.session.getToken();
    if (!t) throw new Error('Clerk.getToken() returned empty — are you signed in?');
    return t;
  }
  async function authHeaders(extra) {
    var t = await getToken();
    var h = { Authorization: 'Bearer ' + t };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  // ---- rate-limit pacing for uploads -------------------------------------
  function uploadsInWindow() {
    var cut = Date.now() - UPLOAD_WINDOW_MS;
    M.uploadTimestamps = M.uploadTimestamps.filter(function (ts) { return ts > cut; });
    return M.uploadTimestamps.length;
  }
  function canUploadNow() {
    return uploadsInWindow() < UPLOAD_LIMIT_PER_WINDOW;
  }
  function noteUpload() {
    M.uploadTimestamps.push(Date.now());
  }

  // ---- fixture generators (procedural, in-page) ---------------------------
  // Each returns { content:string, ext:string, mime:string }.
  // We parameterize line count, values, and (for CSV) locale to stress parsing.
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function genCSV(opts) {
    opts = opts || {};
    var lines = opts.lines || 3;
    var locale = opts.locale || 'en';                 // 'en' | 'eu'
    var delim = locale === 'eu' ? ';' : ',';
    var dec = locale === 'eu' ? ',' : '.';
    var price = function (v) { return dec === ',' ? String(v).replace('.', ',') : String(v); };
    var header = ['po_number', 'buyer_name', 'line_no', 'item_code', 'description', 'quantity', 'unit', 'unit_price'].join(delim);
    var rows = [header];
    var po = opts.po || ('PO-CSV-' + (opts.seed || 1));
    for (var i = 1; i <= lines; i++) {
      rows.push([po, 'Acme', i, 'ITEM-' + i, 'Widget ' + i, 10 + i, 'EA', price((5.99 + i).toFixed(2))].join(delim));
    }
    return { content: rows.join('\n'), ext: '.csv', mime: 'text/csv' };
  }

  function genUBL(opts) {
    opts = opts || {};
    var lines = opts.lines || 2;
    var po = opts.po || ('PO-UBL-' + (opts.seed || 1));
    var body = '';
    for (var i = 1; i <= lines; i++) {
      body +=
        '<cac:OrderLine><cac:LineItem>' +
        '<cbc:ID>' + i + '</cbc:ID>' +
        '<cbc:Quantity unitCode="EA">' + (10 + i) + '</cbc:Quantity>' +
        '<cac:Price><cbc:PriceAmount>' + (5.99 + i).toFixed(2) + '</cbc:PriceAmount></cac:Price>' +
        '<cac:Item><cbc:Name>Widget ' + i + '</cbc:Name>' +
        '<cac:SellersItemIdentification><cbc:ID>SUP-' + pad(i) + '</cbc:ID></cac:SellersItemIdentification>' +
        '</cac:Item></cac:LineItem></cac:OrderLine>';
    }
    var xml =
      '<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"' +
      ' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"' +
      ' xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">' +
      '<cbc:ID>' + po + '</cbc:ID>' + body + '</Order>';
    return { content: xml, ext: '.xml', mime: 'application/xml' };
  }

  function genCXML(opts) {
    opts = opts || {};
    var lines = opts.lines || 2;
    var po = opts.po || ('PO-CXML-' + (opts.seed || 1));
    var total = 0;
    var items = '';
    for (var i = 1; i <= lines; i++) {
      var qty = 10 + i, price = +(5.99 + i).toFixed(2);
      total += qty * price;
      items +=
        '<ItemOut quantity="' + qty + '" lineNumber="' + i + '">' +
        '<ItemID><SupplierPartID>SUP-' + pad(i) + '</SupplierPartID></ItemID>' +
        '<ItemDetail><UnitPrice><Money currency="EUR">' + price.toFixed(2) + '</Money></UnitPrice>' +
        '<Description>Widget ' + i + '</Description></ItemDetail></ItemOut>';
    }
    var xml =
      '<cXML><Request deploymentMode="production"><OrderRequest>' +
      '<OrderRequestHeader orderID="' + po + '" type="new">' +
      '<Total><Money currency="EUR">' + total.toFixed(2) + '</Money></Total></OrderRequestHeader>' +
      items + '</OrderRequest></Request></cXML>';
    return { content: xml, ext: '.xml', mime: 'application/xml' };
  }

  function genIDoc(opts) {
    opts = opts || {};
    var lines = opts.lines || 2;
    var po = opts.po || ('PO-IDOC-' + (opts.seed || 1));
    var body = '';
    for (var i = 1; i <= lines; i++) {
      body +=
        '<E1EDP01><POSEX>' + i + '</POSEX><MENGE>' + (10 + i) + '</MENGE><MENEE>EA</MENEE>' +
        '<VPREI>' + (5.99 + i).toFixed(2) + '</VPREI>' +
        '<E1EDP19><QUALF>002</QUALF><IDTNR>ITEM-' + i + '</IDTNR></E1EDP19></E1EDP01>';
    }
    var xml =
      '<ORDERS05><IDOC BEGIN="1">' +
      '<EDI_DC40 SEGMENT="1"><IDOCTYP>ORDERS05</IDOCTYP><MESTYP>ORDERS</MESTYP></EDI_DC40>' +
      '<E1EDK01><CURCY>EUR</CURCY></E1EDK01>' +
      '<E1EDK02><QUALF>001</QUALF><BELNR>' + po + '</BELNR></E1EDK02>' +
      body + '</IDOC></ORDERS05>';
    return { content: xml, ext: '.xml', mime: 'application/xml' };
  }

  function genEDIFACT(opts) {
    opts = opts || {};
    var lines = opts.lines || 2;
    var po = opts.po || ('PO-EDI-' + (opts.seed || 1));
    var segs = [];
    segs.push("UNB+UNOC:3+SENDER+RECEIVER+260115:0900+1");
    segs.push("UNH+1+ORDERS:D:96A:UN");
    segs.push("BGM+220+" + po + "+9");
    segs.push("DTM+137:20260115:102");
    for (var i = 1; i <= lines; i++) {
      segs.push("LIN+" + i + "++ITEM-" + i + ":IN");
      segs.push("QTY+21:" + (10 + i) + ":EA");
      segs.push("PRI+AAA:" + (5.99 + i).toFixed(2));
    }
    var segCount = segs.length - 1 + 1; // UNH..UNT inclusive count (approx; parser tolerant)
    segs.push("UNT+" + (lines * 3 + 4) + "+1");
    segs.push("UNZ+1+1");
    return { content: segs.join("'") + "'", ext: '.edi', mime: 'application/octet-stream' };
  }

  function genX12(opts) {
    opts = opts || {};
    var lines = opts.lines || 2;
    var po = opts.po || ('PO-X12-' + (opts.seed || 1));
    var segs = [];
    segs.push("ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*0900*U*00401*000000001*0*P*>");
    segs.push("GS*PO*SENDER*RECEIVER*20260115*0900*1*X*004010");
    segs.push("ST*850*0001");
    segs.push("BEG*00*NE*" + po + "**20260115");
    for (var i = 1; i <= lines; i++) {
      segs.push("PO1*" + i + "*" + (10 + i) + "*EA*" + (5.99 + i).toFixed(2) + "**BP*ITEM-" + i);
    }
    segs.push("SE*" + (lines + 3) + "*0001");
    segs.push("GE*1*1");
    segs.push("IEA*1*000000001");
    return { content: segs.join("~") + "~", ext: '.x12', mime: 'application/octet-stream' };
  }

  // Adversarial variants: malformed enough to exercise error handling without
  // being garbage. The matrix records parseOk=false but the run continues.
  function genAdversarial(format, seed) {
    switch (format) {
      case 'CSV':
        // Missing required columns + ragged rows.
        return { content: 'foo,bar\n1,2\n3', ext: '.csv', mime: 'text/csv' };
      case 'UBL':
        // Not-well-formed XML (unclosed tag).
        return { content: '<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"><cbc:ID>BROKEN', ext: '.xml', mime: 'application/xml' };
      case 'cXML':
        return { content: '<cXML><Request><OrderRequest></OrderRequest>', ext: '.xml', mime: 'application/xml' };
      case 'IDoc ORDERS05':
        // Well-formed XML but wrong root → factory should not route to IDoc parser.
        return { content: '<NotAnIdoc><foo>bar</foo></NotAnIdoc>', ext: '.xml', mime: 'application/xml' };
      case 'EDIFACT':
        return { content: "UNB+GARBAGE_NO_SEGMENT_TERMINATORS", ext: '.edi', mime: 'application/octet-stream' };
      case 'X12 850':
        return { content: "ISA*TOO*SHORT~ST*850~SE*1*0001~", ext: '.x12', mime: 'application/octet-stream' };
      default:
        return null;
    }
  }

  // Build the per-format variant list (valid + adversarial), parameterized.
  function buildVariants(format, perFormat) {
    perFormat = perFormat || 2;
    var variants = [];
    var gen = {
      'CSV': genCSV, 'UBL': genUBL, 'cXML': genCXML,
      'IDoc ORDERS05': genIDoc, 'EDIFACT': genEDIFACT, 'X12 850': genX12
    }[format];
    if (!gen) return variants; // binary formats handled separately

    // valid variants — vary line counts; for CSV also vary locale
    for (var v = 0; v < perFormat; v++) {
      var lines = 1 + v + (format === 'CSV' ? 2 : 1);
      var opts = { lines: lines, seed: v + 1, po: format.replace(/[^A-Z0-9]/gi, '') + '-' + (v + 1) };
      if (format === 'CSV') opts.locale = v % 2 === 0 ? 'en' : 'eu';
      var f = gen(opts);
      variants.push({ variantId: 'valid-' + (v + 1), expectValid: true, file: f });
    }
    // one adversarial variant
    var adv = genAdversarial(format, 1);
    if (adv) variants.push({ variantId: 'adv-1', expectValid: false, file: adv });
    return variants;
  }

  // Binary variants come ONLY from caller-supplied base64. Never fabricated.
  function buildBinaryVariants(format, b64) {
    if (!b64) return [];
    var ext = format === 'XLSX' ? '.xlsx' : '.pdf';
    var mime = format === 'XLSX'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';
    return [{ variantId: 'caller-b64', expectValid: true, b64: b64, ext: ext, mime: mime }];
  }

  // ---- file/body helpers --------------------------------------------------
  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }
  function textToBlob(text, mime) {
    return new Blob([text], { type: mime || 'text/plain' });
  }
  function fileNameFor(inFmt, variantId, ext) {
    return ('matrix-' + inFmt + '-' + variantId).replace(/[^A-Za-z0-9._-]/g, '_') + ext;
  }

  // ---- API calls (all wrapped by callers in try/catch) -------------------
  async function uploadFixture(inFmt, variant) {
    var blob, ext, mime;
    if (variant.b64) { blob = b64ToBlob(variant.b64, variant.mime); ext = variant.ext; mime = variant.mime; }
    else { blob = textToBlob(variant.file.content, variant.file.mime); ext = variant.file.ext; mime = variant.file.mime; }

    var fd = new FormData();
    fd.append('file', blob, fileNameFor(inFmt, variant.variantId, ext));
    fd.append('supplierId', SUPPLIER_ID);

    var res = await fetch(API_BASE + '/api/orders/upload', {
      method: 'POST',
      headers: await authHeaders(), // do NOT set Content-Type; browser sets multipart boundary
      body: fd
    });
    noteUpload();
    var txt = await res.text();
    var json = null; try { json = JSON.parse(txt); } catch (e) {}
    return { status: res.status, ok: res.ok, json: json, raw: txt };
  }

  async function pollParsed(orderId) {
    var deadline = Date.now() + PARSE_POLL_TIMEOUT_MS;
    var last = null;
    while (Date.now() < deadline) {
      var res = await fetch(API_BASE + '/api/orders/' + orderId, { headers: await authHeaders() });
      if (res.ok) {
        last = await res.json();
        var s = (last.status || last.Status || '').toString().toLowerCase();
        // Terminal-ish states: anything past "parsing"
        if (s && s !== 'pending' && s !== 'parsing' && s !== 'uploaded' && s !== 'queued') {
          return last;
        }
      }
      await sleep(PARSE_POLL_INTERVAL_MS);
    }
    return last; // may be null or still-parsing; caller decides parseOk
  }

  function lineCountOf(order) {
    if (!order) return 0;
    if (Array.isArray(order.lines)) return order.lines.length;
    if (Array.isArray(order.Lines)) return order.Lines.length;
    if (typeof order.lineCount === 'number') return order.lineCount;
    return 0;
  }
  function statusOf(order) {
    if (!order) return '';
    return (order.status || order.Status || '').toString().toLowerCase();
  }
  function isParsedOk(order) {
    var s = statusOf(order);
    if (!s) return false;
    // "needs_review"/"normalized"/"ready"/"mapped" etc. all count as parsed.
    var bad = ['parse_failed', 'failed', 'error', 'rejected', 'invalid'];
    if (bad.indexOf(s) !== -1) return false;
    if (s === 'parsing' || s === 'pending' || s === 'uploaded' || s === 'queued') return false;
    return true;
  }

  // Transform/preview into a single outbound format.
  async function transformOne(orderId, outFmt) {
    if (PREVIEW_FORMATS[outFmt]) {
      // Cheap, non-mutating preview path (csv|json only).
      var pres = await fetch(API_BASE + '/api/orders/' + orderId + '/mapping-override/preview?format=' + outFmt, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: '{}'
      });
      var ptxt = await pres.text();
      return { status: pres.status, ok: pres.ok, body: ptxt, via: 'preview' };
    }
    // Real transform for xml|cxml|ubl|x12. Mutates state; tolerate 409.
    var tres = await fetch(API_BASE + '/api/orders/' + orderId + '/transform?format=' + outFmt, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}'
    });
    var ttxt = await tres.text();
    return { status: tres.status, ok: tres.ok, body: ttxt, via: 'transform' };
  }

  // Cheap per-format validity check on the transform output body.
  function validateOutput(outFmt, body) {
    if (body == null) return false;
    var s = ('' + body).trim();
    if (!s.length) return false;
    try {
      switch (outFmt) {
        case 'json':
          JSON.parse(s); return true;
        case 'csv':
          // header + at least one data row, has a delimiter
          var rows = s.split(/\r?\n/).filter(Boolean);
          return rows.length >= 2 && /[,;\t]/.test(rows[0]);
        case 'xml':
        case 'ubl':
          return /<\?xml|<[A-Za-z]/.test(s) && /<\/[A-Za-z]/.test(s);
        case 'cxml':
          return /<cXML/i.test(s) && /<\/cXML>/i.test(s);
        case 'x12':
          return /(^|[~\n])(ST\*|BEG\*|ISA\*)/.test(s);
        default:
          return s.length > 0;
      }
    } catch (e) {
      return false;
    }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- the bounded, resumable driver -------------------------------------
  // opts: { inboundFormats?, outboundFormats?, perFormat?, xlsxB64?, pdfB64? }
  window.__matrixRun = async function (opts) {
    opts = opts || {};
    var inboundFormats = opts.inboundFormats || ALL_INBOUND;
    var outboundFormats = opts.outboundFormats || ALL_OUTBOUND;
    var perFormat = opts.perFormat || 2;
    var startedAt = Date.now();
    var uploadsThisCall = 0;
    var newCombos = 0;
    var skippedExisting = 0;
    var notes = [];

    function timeLeft() { return INVOCATION_BUDGET_MS - (Date.now() - startedAt); }

    // 1) Ensure we have a parsed order per (inboundFormat, variant), pacing uploads.
    for (var fi = 0; fi < inboundFormats.length; fi++) {
      var inFmt = inboundFormats[fi];
      var variants;
      if (BINARY_INBOUND.indexOf(inFmt) !== -1) {
        variants = buildBinaryVariants(inFmt, inFmt === 'XLSX' ? opts.xlsxB64 : opts.pdfB64);
        if (!variants.length) { notes.push('skip ' + inFmt + ': no caller base64 supplied'); continue; }
      } else {
        variants = buildVariants(inFmt, perFormat);
      }

      for (var vi = 0; vi < variants.length; vi++) {
        if (timeLeft() < 4000) { notes.push('time budget hit during uploads'); break; }
        var variant = variants[vi];
        var oKey = inFmt + '#' + variant.variantId;
        var ord = M.orders[oKey];

        if (!ord || (!ord.orderId && ord.parseOk !== false)) {
          // Need to upload. Respect rate limit + per-call cap.
          if (uploadsThisCall >= MAX_UPLOADS_PER_INVOCATION) { notes.push('per-call upload cap reached'); continue; }
          if (!canUploadNow()) { notes.push('upload window full (' + uploadsInWindow() + '/' + UPLOAD_LIMIT_PER_WINDOW + ') — call again later'); continue; }
          try {
            var up = await uploadFixture(inFmt, variant);
            uploadsThisCall++;
            var oid = up.json && (up.json.id || up.json.orderId || up.json.Id || up.json.OrderId);
            if (!up.ok || !oid) {
              M.orders[oKey] = { orderId: oid || null, parseOk: false, parseLines: 0, expectValid: variant.expectValid, error: 'upload ' + up.status + ' ' + (up.raw || '').slice(0, 200) };
              continue;
            }
            M.orders[oKey] = { orderId: oid, parseOk: null, parseLines: 0, expectValid: variant.expectValid, error: null };
            ord = M.orders[oKey];
          } catch (e) {
            M.orders[oKey] = { orderId: null, parseOk: false, parseLines: 0, expectValid: variant.expectValid, error: 'upload-exc ' + (e && e.message) };
            continue;
          }
        }

        // Poll for parse completion if not yet known.
        if (ord && ord.orderId && ord.parseOk === null) {
          if (timeLeft() < 4000) { notes.push('time budget hit before poll'); continue; }
          try {
            var parsed = await pollParsed(ord.orderId);
            ord.parseOk = isParsedOk(parsed);
            ord.parseLines = lineCountOf(parsed);
            ord.parseStatus = statusOf(parsed);
            if (!ord.parseOk && !ord.error) ord.error = 'parse-status ' + (ord.parseStatus || 'unknown');
          } catch (e) {
            ord.parseOk = false;
            ord.error = 'poll-exc ' + (e && e.message);
          }
        }
      }
    }

    // 2) Fan out transforms for every parsed order × every outbound format.
    //    This is NOT rate-limited; only bounded by the time budget.
    for (var ok in M.orders) {
      if (timeLeft() < 2500) { notes.push('time budget hit during transforms'); break; }
      var rec = M.orders[ok];
      var parts = ok.split('#');
      var inboundFormat = parts[0];
      var variantId = parts.slice(1).join('#');

      for (var oi = 0; oi < outboundFormats.length; oi++) {
        if (timeLeft() < 2500) { notes.push('time budget hit mid-transform'); break; }
        var outFmt = outboundFormats[oi];
        if (hasCombo(inboundFormat, variantId, outFmt)) { skippedExisting++; continue; }

        var base = {
          inboundFormat: inboundFormat,
          variantId: variantId,
          outboundFormat: outFmt,
          parseOk: !!rec.parseOk,
          parseLines: rec.parseLines || 0,
          transformOk: false,
          transformStatus: null,
          outLen: 0,
          validOut: false,
          via: null,
          error: null
        };

        // If parse failed, record the combo as parse-blocked (still a data point).
        if (!rec.parseOk) {
          base.error = rec.error || 'parse-not-ok';
          recordCombo(base);
          newCombos++;
          continue;
        }

        try {
          var t = await transformOne(rec.orderId, outFmt);
          base.transformStatus = t.status;
          base.via = t.via;
          base.transformOk = !!t.ok;
          base.outLen = t.body ? t.body.length : 0;
          base.validOut = t.ok ? validateOutput(outFmt, t.body) : false;
          if (!t.ok) base.error = 'http ' + t.status + ' ' + (t.body || '').slice(0, 160);
        } catch (e) {
          base.error = 'transform-exc ' + (e && e.message);
        }
        recordCombo(base);
        newCombos++;
      }
    }

    // 3) Summary.
    var combos = M.combos;
    var summary = {
      totalCombos: combos.length,
      parseOk: combos.filter(function (c) { return c.parseOk; }).length,
      transformOk: combos.filter(function (c) { return c.transformOk; }).length,
      validOut: combos.filter(function (c) { return c.validOut; }).length,
      ordersUploaded: Object.keys(M.orders).length,
      ordersParsedOk: Object.values(M.orders).filter(function (o) { return o.parseOk; }).length,
      uploadsThisCall: uploadsThisCall,
      uploadsInWindow: uploadsInWindow(),
      newCombosThisCall: newCombos,
      skippedExistingThisCall: skippedExisting,
      byInbound: {},
      byOutbound: {},
      notes: notes,
      elapsedMs: Date.now() - startedAt
    };
    combos.forEach(function (c) {
      summary.byInbound[c.inboundFormat] = summary.byInbound[c.inboundFormat] || { ok: 0, total: 0 };
      summary.byInbound[c.inboundFormat].total++;
      if (c.validOut) summary.byInbound[c.inboundFormat].ok++;
      summary.byOutbound[c.outboundFormat] = summary.byOutbound[c.outboundFormat] || { ok: 0, total: 0 };
      summary.byOutbound[c.outboundFormat].total++;
      if (c.validOut) summary.byOutbound[c.outboundFormat].ok++;
    });
    M.summary = summary;

    console.log('[matrix] +%d combos (%d valid out), %d uploads this call (%d/%d in window). Total combos=%d. %s',
      newCombos, summary.validOut, uploadsThisCall, summary.uploadsInWindow, UPLOAD_LIMIT_PER_WINDOW, combos.length,
      notes.length ? '| notes: ' + notes.join('; ') : '');
    console.log('[matrix] Call window.__matrixRun() again to continue. Inspect window.__matrix.summary / .combos.');
    return summary;
  };

  // Convenience: reset everything (does NOT clear the upload window — that is real).
  window.__matrixReset = function () {
    window.__matrix = { combos: [], summary: {}, orders: {}, uploadTimestamps: M.uploadTimestamps || [], _index: {} };
    console.log('[matrix] reset combos + orders (kept upload-window timestamps).');
  };

  console.log('[matrix] runner loaded. API=%s supplier=%s', API_BASE, SUPPLIER_ID);
  console.log('[matrix] run: await window.__matrixRun();  (repeat across rate-limit windows)');
  console.log('[matrix] binary: await window.__matrixRun({ xlsxB64: "<base64>", pdfB64: "<base64>" });');
})();
