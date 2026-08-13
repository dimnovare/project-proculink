// sheetPreview — turn CSV bytes or an XLSX workbook into plain rows of strings the review
// screen can lay out as a grid.
//
// WHY NOT A SPREADSHEET LIBRARY. The only thing this needs to answer is "what does cell F14 of
// the document say", so the operator can check it against the value we extracted. SheetJS would
// bring a large surface (and a long CVE history) for a read that is: unzip, three XML parts,
// one number-format decision. `fflate` does the inflate; `DOMParser` — already in the browser
// and in jsdom — does the XML. Nothing is evaluated, nothing is executed.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not reproduce Excel's display formatting. A stored
// `1234.5` renders as `1234.5`, not `€1,234.50`. Two exceptions are made, because there the raw
// value would actively MISLEAD someone checking the document: date serials (a purchase order's
// delivery date is stored as `45678`) and percentages (a 15% discount is stored as `0.15`).
// Everywhere else the stored value is shown, because a formatter that guesses is how a review
// screen ends up lying about the paperwork it is supposed to be showing.

import { unzipSync, strFromU8 } from "fflate";

/** Rows are capped so a 50,000-row export cannot lock the tab up. */
export const MAX_PREVIEW_ROWS = 500;
export const MAX_PREVIEW_COLS = 60;
/** Workbooks with more tabs than this have the rest listed but not parsed. */
export const MAX_PREVIEW_SHEETS = 12;

export interface SheetTable {
  name: string;
  /** Row-major, already capped. Ragged rows are padded to the widest row. */
  rows: string[][];
  /** True when the sheet had more rows / columns than the caps above. */
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export interface SheetWorkbook {
  tables: SheetTable[];
  /** Names of sheets present but not parsed because of MAX_PREVIEW_SHEETS. */
  omittedSheetNames: string[];
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Pick the separator by counting candidates OUTSIDE quoted spans across the first few lines.
 * Counting inside quotes is how a European address field ("Berlin, DE") turns a semicolon file
 * into a comma file. Ties resolve to comma.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64_000);
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < sample.length && lines < 20; i++) {
    const ch = sample[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a terminator.
      if (inQuotes && sample[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n") {
      lines++;
      continue;
    }
    if (counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const c = counts.get(d) ?? 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/** RFC 4180 reader: quoted fields, doubled quotes, embedded newlines, CRLF or LF. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
      if (rows.length >= MAX_PREVIEW_ROWS + 1) break;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  // A trailing newline must not manufacture an empty final row, but a file with no trailing
  // newline must keep its last one.
  if (field.length > 0 || row.length > 0) endRow();
  else if (!sawAnyChar) return [];

  return rows;
}

export function parseCsvTable(text: string, name = "Sheet 1"): SheetTable {
  // Strip a UTF-8 BOM — Excel writes one on every CSV export and it would otherwise become
  // part of the first header cell.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = parseCsvRows(body, detectDelimiter(body));
  return finalizeTable(name, all);
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

/**
 * Excel's day 0 is 1899-12-30 once its non-existent 1900-02-29 is accounted for: serial 60 is a
 * date that never happened, so every serial from 61 (1900-03-01) upward — which is every serial
 * a purchase order can carry — converts correctly from this epoch. The known price is that
 * serials 1–59 land one day early, and no delivery date is in January 1900.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
/** Built-in number-format ids that are dates or times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// OOXML parts carry a DEFAULT namespace, so every element's qualified name equals its local
// name. `getElementsByTagName` therefore matches reliably in both browsers and jsdom, while CSS
// type selectors through `querySelectorAll` behave inconsistently across XML implementations —
// which is why this file uses tag-name lookups throughout.
function parseXml(xml: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName === "parsererror" || root.getElementsByTagName("parsererror").length) {
    return null;
  }
  return doc;
}

/** Direct children of `parent` with the given tag — the `a > b` combinator, portably. */
function childrenNamed(parent: Element | Document, tag: string): Element[] {
  const out: Element[] = [];
  const kids = (parent as Element).children ?? [];
  for (const el of Array.from(kids)) if (el.tagName === tag) out.push(el);
  return out;
}

/** "BC12" → 54 (0-based). Returns -1 when the reference has no column letters. */
export function columnIndexFromRef(ref: string): number {
  let n = 0;
  let seen = false;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      n = n * 26 + (code - 64);
      seen = true;
    } else if (code >= 97 && code <= 122) {
      n = n * 26 + (code - 96);
      seen = true;
    } else break;
  }
  return seen ? n - 1 : -1;
}

/**
 * Does a number-format code render a date? Quoted literals and `[…]` condition/colour blocks
 * are removed first, so a currency format like `"kr"#,##0.00` cannot be read as having a `d`
 * in it — the exact false positive that turns every price in a Norwegian workbook into 1970.
 */
export function formatCodeIsDate(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[ymd]/i.test(bare);
}

function formatCodeIsPercent(code: string): boolean {
  return code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").includes("%");
}

/** Excel serial → `YYYY-MM-DD`, plus ` HH:MM` when the value carries a time. */
export function excelSerialToDisplay(serial: number): string {
  const ms = EXCEL_EPOCH_UTC + Math.round(serial * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hasTime = Math.abs(serial % 1) > 1e-9;
  return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

type CellKind = "date" | "percent" | "plain";

/** cellXfs index → how that style renders a number. */
function readStyleKinds(stylesXml: string | undefined): CellKind[] {
  if (!stylesXml) return [];
  const doc = parseXml(stylesXml);
  if (!doc) return [];

  const custom = new Map<number, string>();
  Array.from(doc.getElementsByTagName("numFmt")).forEach((el) => {
    const id = Number(el.getAttribute("numFmtId"));
    const code = el.getAttribute("formatCode") ?? "";
    if (Number.isFinite(id)) custom.set(id, code);
  });

  // `xf` appears under BOTH cellStyleXfs and cellXfs; only the latter is what a cell's `s=`
  // index addresses, so this must not be a document-wide tag sweep.
  const cellXfs = doc.getElementsByTagName("cellXfs")[0];
  const kinds: CellKind[] = [];
  if (!cellXfs) return kinds;
  childrenNamed(cellXfs, "xf").forEach((xf) => {
    const id = Number(xf.getAttribute("numFmtId") ?? "0");
    const code = custom.get(id);
    if (code !== undefined) {
      kinds.push(formatCodeIsDate(code) ? "date" : formatCodeIsPercent(code) ? "percent" : "plain");
    } else if (BUILTIN_DATE_FMT_IDS.has(id)) {
      kinds.push("date");
    } else if (id >= 9 && id <= 10) {
      kinds.push("percent");
    } else {
      kinds.push("plain");
    }
  });
  return kinds;
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  if (!doc) return [];
  // `<si>` is either a single `<t>` or a run of `<r><t>` fragments; concatenating every
  // descendant `<t>` handles both without branching.
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    Array.from(si.getElementsByTagName("t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
}

function decodePart(files: Record<string, Uint8Array>, path: string): string | undefined {
  const bytes = files[path];
  return bytes ? strFromU8(bytes) : undefined;
}

/** Workbook order + rId → part path, so sheets come back in the order the tabs appear. */
function readSheetPlan(files: Record<string, Uint8Array>): { name: string; path: string }[] {
  const wbXml = decodePart(files, "xl/workbook.xml");
  const relsXml = decodePart(files, "xl/_rels/workbook.xml.rels");
  const wb = wbXml ? parseXml(wbXml) : null;
  const rels = relsXml ? parseXml(relsXml) : null;

  const RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const target = new Map<string, string>();
  if (rels) {
    Array.from(rels.getElementsByTagName("Relationship")).forEach((r) => {
      const id = r.getAttribute("Id");
      const t = r.getAttribute("Target");
      if (id && t) target.set(id, t.replace(/^\/?xl\//, "").replace(/^\//, ""));
    });
  }

  const plan: { name: string; path: string }[] = [];
  if (wb) {
    Array.from(wb.getElementsByTagName("sheet")).forEach((s, i) => {
      const name = s.getAttribute("name") || `Sheet ${i + 1}`;
      // `r:id` is namespaced. getAttributeNS is the correct read; the prefixed qualified name
      // is kept as a fallback for parsers that expose only that.
      const rid = s.getAttributeNS(RELS_NS, "id") ?? s.getAttribute("r:id") ?? "";
      const rel = target.get(rid);
      const path = rel ? `xl/${rel}` : `xl/worksheets/sheet${i + 1}.xml`;
      plan.push({ name, path });
    });
  }

  if (plan.length === 0) {
    // No readable workbook part — fall back to whatever worksheet parts are in the zip so a
    // slightly non-standard writer still previews.
    Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort()
      .forEach((path, i) => plan.push({ name: `Sheet ${i + 1}`, path }));
  }
  return plan;
}

function readSheetRows(xml: string, shared: string[], styleKinds: CellKind[]): string[][] {
  const doc = parseXml(xml);
  if (!doc) return [];
  const rows: string[][] = [];

  const sheetData = doc.getElementsByTagName("sheetData")[0];
  const rowEls = sheetData ? childrenNamed(sheetData, "row") : [];
  for (const rowEl of rowEls) {
    if (rows.length >= MAX_PREVIEW_ROWS) break;
    const cells: string[] = [];
    for (const c of childrenNamed(rowEl, "c")) {
      const ref = c.getAttribute("r") ?? "";
      const col = columnIndexFromRef(ref);
      const index = col >= 0 ? col : cells.length;
      if (index >= MAX_PREVIEW_COLS) continue;
      while (cells.length < index) cells.push("");
      cells[index] = readCell(c, shared, styleKinds);
    }
    rows.push(cells);
  }
  return rows;
}

function readCell(c: Element, shared: string[], styleKinds: CellKind[]): string {
  const type = c.getAttribute("t") ?? "n";
  if (type === "inlineStr") {
    return Array.from(c.getElementsByTagName("t"))
      .map((t) => t.textContent ?? "")
      .join("");
  }
  const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
  if (v === "") return "";
  if (type === "s") {
    const i = Number(v);
    return Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : "";
  }
  if (type === "str" || type === "e") return v;
  if (type === "b") return v === "1" ? "TRUE" : "FALSE";

  const num = Number(v);
  if (!Number.isFinite(num)) return v;
  const styleIndex = Number(c.getAttribute("s") ?? "0");
  const kind = styleKinds[styleIndex] ?? "plain";
  if (kind === "date") return excelSerialToDisplay(num);
  // 15% is stored as 0.15; trimming the float tail keeps 0.07*100 from reading as 7.000000001.
  if (kind === "percent") return `${Number((num * 100).toPrecision(12))}%`;
  return v;
}

/** Pad ragged rows, apply the column cap, and report what was cut. */
function finalizeTable(name: string, all: string[][]): SheetTable {
  const truncatedRows = all.length > MAX_PREVIEW_ROWS;
  const rows = all.slice(0, MAX_PREVIEW_ROWS);
  const widest = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const truncatedCols = widest > MAX_PREVIEW_COLS;
  const width = Math.min(widest, MAX_PREVIEW_COLS);
  return {
    name,
    rows: rows.map((r) => {
      const cut = r.slice(0, width);
      while (cut.length < width) cut.push("");
      return cut;
    }),
    truncatedRows,
    truncatedCols,
  };
}

/**
 * Read an XLSX workbook into preview tables. Throws when the bytes are not a readable OOXML
 * zip — the caller turns that into the honest "we can't display this one" state rather than
 * pretending the sheet is empty.
 */
export function parseXlsxWorkbook(bytes: Uint8Array): SheetWorkbook {
  const files = unzipSync(bytes);
  const shared = readSharedStrings(decodePart(files, "xl/sharedStrings.xml"));
  const styleKinds = readStyleKinds(decodePart(files, "xl/styles.xml"));
  const plan = readSheetPlan(files);

  const tables: SheetTable[] = [];
  for (const { name, path } of plan.slice(0, MAX_PREVIEW_SHEETS)) {
    const xml = decodePart(files, path);
    tables.push(finalizeTable(name, xml ? readSheetRows(xml, shared, styleKinds) : []));
  }
  return {
    tables,
    omittedSheetNames: plan.slice(MAX_PREVIEW_SHEETS).map((p) => p.name),
  };
}
