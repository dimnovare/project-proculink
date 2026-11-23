import type { DocumentCheck, DocumentDetail, SourceLocation } from "@/lib/api/documents";

/** Mirrors `DocumentChecks.ReviewConfidence` (pinned by backendMirror.test.ts). */
export const REVIEW_CONFIDENCE = 0.75;

export type EditTarget = { field: string } | { table: string; row: number; column: string };
/** "field:{key}" | "cell:{table}/{row}/{column}" — the one key for drafts and marks. */
export const editKey = (t: EditTarget) => ("field" in t ? `field:${t.field}` : `cell:${t.table}/${t.row}/${t.column}`);

export interface Look { kind: "missing" | "unsure"; text: string }
export interface ReviewMarks {
  looks: ReadonlyMap<string, Look>;
  count: number;
  /** Failed checks naming no shown field: no key, a table key, or a key not in the read. */
  unattached: DocumentCheck[];
  /** Where the marked values sit on the original (a page box or an address). */
  places: SourceLocation[];
  /** Every unmarked value has text (R11). */
  allClear: boolean;
}

const unsure = (confidence: number): Look => {
  const pct = Math.round(confidence * 100);
  return { kind: "unsure", text: pct === 0 ? "Check this one. We couldn't read it clearly." : `Check this one. We are ${pct}% sure of it.` };
};

const NOT_ON_PAGE: Look = { kind: "unsure", text: "Not in the page's text. Check it." };

type Value = { value: string | null; confidence: number; edited: boolean; location: SourceLocation | null };
const hasText = (v: Value) => !!v.value?.trim();
/** No check named it: only an unedited value we read with low confidence needs a look. An empty one says nothing. */
const byConfidence = (v: Value) => (!v.edited && hasText(v) && v.confidence < REVIEW_CONFIDENCE ? unsure(v.confidence) : null);

/** What on this document needs a person, in words. Nothing is marked once the values can no longer change. */
export function reviewMarks(detail: DocumentDetail, editable: boolean): ReviewMarks {
  const failed = detail.checks.filter((c) => !c.passed);
  const fieldKeys = new Set(detail.read.fields.map((f) => f.key));
  const looks = new Map<string, Look>();
  const places: SourceLocation[] = [];
  let allClear = true;

  const mark = (key: string, v: Value, look: Look | null) => {
    if (!look) { allClear &&= hasText(v); return; }
    looks.set(key, look);
    if (v.location && (v.location.box || v.location.address)) places.push(v.location);
  };

  for (const field of detail.read.fields) {
    const named = failed.filter((c) => c.fieldKey === field.key);
    const check = named.find((c) => c.code === "required_missing" || c.code === "not_on_page") ?? named.find((c) => c.code === "low_confidence") ?? named[0];
    const look = !editable ? null
      : check?.code === "required_missing" ? { kind: "missing" as const, text: "Not found on the page. Type it." }
      : check?.code === "not_on_page" ? NOT_ON_PAGE
      : check?.code === "low_confidence" ? unsure(field.confidence)
      : check ? { kind: "unsure" as const, text: `Check this one. ${check.message}` }
      : field.notOnPage && !field.edited ? NOT_ON_PAGE
      : byConfidence(field);
    mark(editKey({ field: field.key }), field, look);
  }
  // Cells are marked by confidence only: the server attaches no check to a cell (R13).
  for (const table of detail.read.tables)
    table.rows.forEach((row, r) => {
      for (const [column, cell] of Object.entries(row.cells))
        mark(editKey({ table: table.key, row: r, column }), cell, editable ? byConfidence(cell) : null);
    });

  return {
    looks, count: looks.size, places, allClear,
    unattached: editable ? failed.filter((c) => c.fieldKey == null || !fieldKeys.has(c.fieldKey)) : failed,
  };
}
