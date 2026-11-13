// sourceDocument — the pure model behind "show the operator the file they are correcting".
//
// `GET /api/orders/{id}/source` (backend PR 189) streams the original upload. It answers with
// bytes, or with one of four refusals that are ORDINARY STATES rather than errors. This module
// owns two decisions and nothing else, so they can be tested without a network or a DOM:
//
//   1. What renderer a served document gets — from the SERVER'S `Content-Type`, never from a
//      filename or a storage key. That direction is the whole point: `sourceTypeFromKey()` used
//      to split a value on "." and switch on the extension, was handed an order id, and so
//      returned `undefined` on every render without ever failing. A type derived from a name is
//      a guess that reads as a fact.
//   2. Which of the two "What we received" bodies the left column shows.
//
// Order sources get their media type from a CLOSED allowlist on the server
// (`ProcuLink.Core/Services/Detection/SourceDocumentMediaType.cs`); flow documents are typed
// from the file extension (`DocumentScreen.tsx`), which also gives the png/jpeg photos. The
// server allowlist: pdf → application/pdf,
// csv → text/csv, xlsx → the OOXML spreadsheet type, cxml|ubl|xml → application/xml,
// edifact|x12|txt|edi → text/plain, json → application/json, docx → the Word type (a
// download), png/jpg → image/*, and everything else → application/octet-stream. Nothing in it can
// produce text/html or image/svg+xml, which is why we can render what it sends. We still treat
// anything unlisted as opaque rather than assuming, so a future server type cannot silently
// acquire a renderer here.

/** Which viewer a served document gets. `opaque` = we will not guess; offer the bytes instead. */
export type SourceDocumentRender = "pdf" | "sheet" | "text" | "image" | "opaque";

/** A document the server actually served. */
export interface SourceDocument {
  blob: Blob;
  /** The server's `Content-Type`, lowercased with any parameters stripped. */
  contentType: string;
  /** Parsed out of `Content-Disposition` when present. Display only — never a type source. */
  filename: string | null;
}

/** `application/xml; charset=utf-8` → `application/xml`. Blank/absent → "". */
export function normalizeContentType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0].trim().toLowerCase();
}

const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The renderer for a media type. Unlisted → `opaque`, always. There is no fallback that
 * guesses: an unrecognised type means the server could not identify the bytes either, and
 * showing a spreadsheet grid over an unknown blob would be an invention.
 */
export function sourceRenderFor(contentType: string): SourceDocumentRender {
  switch (normalizeContentType(contentType)) {
    case "application/pdf":
      return "pdf";
    case "text/csv":
    case XLSX_MEDIA_TYPE:
      return "sheet";
    case "application/xml":
    case "text/plain":
    case "application/json":
      return "text";
    case "image/png":
    case "image/jpeg":
      return "image";
    default:
      return "opaque";
  }
}

export interface DecodedSourceText {
  text: string;
  /** True when UTF-8 did not decode cleanly and Windows-1252 was used instead. */
  fellBackToLatin: boolean;
}

/**
 * Decode text bytes without pretending to know the encoding.
 *
 * The server deliberately declares no charset — it identifies a FORMAT, and an EDIFACT
 * interchange is routinely ISO-8859-1 while an ERP-exported CSV is routinely Windows-1252, so
 * stamping `charset=utf-8` would be a guess presented as a measurement. That leaves the guess
 * to us, and the honest version of it is: try UTF-8 strictly; if the bytes are not valid UTF-8,
 * fall back to Windows-1252 (which cannot fail) and SAY SO on screen. Silently emitting U+FFFD
 * where an umlaut belongs is the failure mode worth avoiding — an operator checking
 * "Schrauben, verzinkt" against our extraction must not be shown "Schr�uben".
 */
export function decodeSourceText(bytes: ArrayBuffer | Uint8Array): DecodedSourceText {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), fellBackToLatin: false };
  } catch {
    try {
      return { text: new TextDecoder("windows-1252").decode(view), fellBackToLatin: true };
    } catch {
      // No windows-1252 table in this runtime — lossy UTF-8 is still better than nothing.
      return { text: new TextDecoder().decode(view), fellBackToLatin: true };
    }
  }
}

/** Which body the left "What we received" column shows. */
export type IncomingView = "document" | "fields";

/**
 * Resolve the REQUESTED view against what actually exists.
 *
 * The document is the default because it is the ground truth the field list was derived from —
 * but the request is never allowed to produce an empty pane. When there is no document to show,
 * the column falls back to the field list it has always had, WITHOUT rewriting the stored
 * preference: open the next order, which does have a file, and the document is there again.
 */
export function resolveIncomingView(
  requested: IncomingView,
  documentAvailable: boolean,
): IncomingView {
  return requested === "document" && documentAvailable ? "document" : "fields";
}
