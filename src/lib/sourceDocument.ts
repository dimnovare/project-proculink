// sourceDocument — the pure model behind "show the operator the file they are correcting".
//
// `GET /api/orders/{id}/source` (backend PR 189) streams the original upload. It answers with
// bytes, or with one of four refusals that are ORDINARY STATES rather than errors. This module
// owns three decisions and nothing else, so they can be tested without a network or a DOM:
//
//   1. What renderer a served document gets — from the SERVER'S `Content-Type`, never from a
//      filename or a storage key. That direction is the whole point: `sourceTypeFromKey()` used
//      to split a value on "." and switch on the extension, was handed an order id, and so
//      returned `undefined` on every render without ever failing. A type derived from a name is
//      a guess that reads as a fact.
//   2. What the operator is told when there is no document to show.
//   3. Which of the two "What we received" bodies the left column shows.
//
// The media types this can receive are a CLOSED allowlist on the server
// (`ProcuLink.Core/Services/Detection/SourceDocumentMediaType.cs`): pdf → application/pdf,
// csv → text/csv, xlsx → the OOXML spreadsheet type, cxml|ubl|xml → application/xml,
// edifact|x12 → text/plain, and everything else → application/octet-stream. Nothing in it can
// produce text/html or image/svg+xml, which is why we can render what it sends. We still treat
// anything unlisted as opaque rather than assuming, so a future server type cannot silently
// acquire a renderer here.

/** Which viewer a served document gets. `opaque` = we will not guess; offer the bytes instead. */
export type SourceDocumentRender = "pdf" | "sheet" | "text" | "opaque";

/** A document the server actually served. */
export interface SourceDocument {
  blob: Blob;
  /** The server's `Content-Type`, lowercased with any parameters stripped. */
  contentType: string;
  /** Parsed out of `Content-Disposition` when present. Display only — never a type source. */
  filename: string | null;
}

/**
 * Everything the review screen can learn about the source file, as one closed union.
 *
 * `none` and `purged` are NOT failures: a practice or sample order never had a file, and a
 * retained order may have had its blob removed on schedule while the order record, hashes and
 * audit trail stayed. Both get their own sentence rather than an error toast.
 */
export type SourceDocumentState =
  | { kind: "document"; document: SourceDocument }
  /** 204 — no source file key, unreadable in storage, empty, or over the server's serve cap. */
  | { kind: "none" }
  /** 410 — the blob was purged under the org's data-retention policy. */
  | { kind: "purged"; message: string }
  /** 404 — unknown order, or another organisation's. Deliberately indistinguishable. */
  | { kind: "missing" }
  /** 429 — the shared document-download budget. */
  | { kind: "throttled"; retryAfterSeconds: number | null }
  /** Anything else, including a network failure. */
  | { kind: "error" };

/** `application/xml; charset=utf-8` → `application/xml`. Blank/absent → "". */
export function normalizeContentType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0].trim().toLowerCase();
}

const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
      return "text";
    default:
      return "opaque";
  }
}

/**
 * The short tag shown in the pane header (the existing `SourceTypeChip` vocabulary).
 *
 * `application/xml` covers cXML, UBL and plain XML, and `text/plain` covers EDIFACT and X12 —
 * the server collapses each pair on purpose, so this says only what the media type actually
 * establishes. Naming a specific dialect here would re-introduce the guess this replaced.
 * `null` → no chip, which is what an unrecognised type earns.
 */
export function sourceFormatLabel(contentType: string): string | null {
  switch (normalizeContentType(contentType)) {
    case "application/pdf":
      return "PDF";
    case "text/csv":
      return "CSV";
    case XLSX_MEDIA_TYPE:
      return "XLSX";
    case "application/xml":
      return "XML";
    case "text/plain":
      return "TEXT";
    default:
      return null;
  }
}

/** The `filename="…"` / `filename*=UTF-8''…` value from a `Content-Disposition`, if any. */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  // RFC 5987 form wins when both are present — it is the one that survives non-ASCII.
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim()) || null;
    } catch {
      /* a malformed percent-escape is not worth failing a download over */
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return quoted[1].trim() || null;
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() || null : null;
}

/**
 * What the operator reads when the document cannot be shown — plain procurement language, no
 * status codes, no jargon. `null` when a document IS available (nothing to explain).
 *
 * These strings are the packet's honest answer to "what if it cannot be rendered": the field
 * list the screen has always had, plus one line saying why the paper is not next to it.
 */
export function sourceUnavailableMessage(state: SourceDocumentState): string | null {
  switch (state.kind) {
    case "document":
      return null;
    case "none":
      return "No original document is stored for this order, so there is nothing to display. The values below are what we captured.";
    case "purged":
      return state.message;
    case "missing":
      return "We could not find this order's document. If you have just switched workspace, reopen the order from your inbox.";
    case "throttled":
      return "Too many document requests just now. Wait a moment, then reload the order.";
    case "error":
      return "We couldn't load the original document just now. The captured values below are unaffected.";
  }
}

/**
 * The default 410 sentence, used when the server's own explanation does not come through (a
 * proxy ate the body, or the response was not JSON). The server sends the authoritative text —
 * `RetentionConstants.BlobPurgedError` — and we prefer it whenever it arrives.
 */
export const SOURCE_PURGED_FALLBACK_MESSAGE =
  "This file has been removed under your organisation's data-retention policy. The order record, content hashes and audit trail are kept.";

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
