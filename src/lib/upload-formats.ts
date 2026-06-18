// upload-formats — single frontend source of truth for accepted order-upload
// file formats.
//
// ⚠ MIRRORS THE BACKEND WHITELIST in
//   ProcuLink.Api/Controllers/OrdersController.cs → Upload() extension guard
//   (the `extension != ".csv" && …` chain, ~lines 150-158).
// If the backend whitelist changes, update this file in the SAME change:
// the dropzone `accept` attribute, inline file validation, and all
// user-facing "supported formats" copy should read from here so the UI never
// offers a format the API rejects (offer ⇔ works).

/** Lowercase dot-prefixed extensions, exactly as the backend validates them. */
export const ACCEPTED_UPLOAD_EXTENSIONS = [
  ".csv",
  ".xlsx",
  ".pdf",
  ".xml",  // cXML, UBL/Peppol, SAP IDoc ORDERS05 — routed by content
  ".cxml", // explicit cXML
  ".edi",  // EDIFACT or X12 (content-sniffed)
  ".x12",  // explicit ANSI X12 850
  ".txt",  // EDIFACT/X12 sniffed from text
] as const;

export type AcceptedUploadExtension = (typeof ACCEPTED_UPLOAD_EXTENSIONS)[number];

export const ACCEPTED_UPLOAD_FORMATS = {
  /** The raw extension whitelist. */
  extensions: ACCEPTED_UPLOAD_EXTENSIONS,
  /** Human-readable list — matches the backend's 400 error copy. */
  humanList: "CSV, XLSX, PDF, XML (cXML/UBL/Peppol), EDI (EDIFACT/X12)",
  /** Value for a file input / dropzone `accept` attribute. */
  dropzoneAccept: ACCEPTED_UPLOAD_EXTENSIONS.join(","),
} as const;

/** True when the file name's extension is in the accepted whitelist. */
export function hasAcceptedUploadExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Whether a MIME type seen during a drag-over is UNAMBIGUOUSLY unsupported.
 *
 * Drag events only expose `DataTransferItem.type` (a MIME type) — the filename
 * (and thus the real extension) isn't available until drop. Many valid order
 * files report an empty or ambiguous MIME type (.edi / .x12 / .cxml / .xml
 * often come through as "" or "text/plain", and CSV varies by OS), so we must
 * NOT reject on an allow-list — that would false-flag genuine POs.
 *
 * Instead we only flag the obviously-wrong drops: images, audio, and video.
 * Empty / unknown / document MIME types fall through to the neutral drag state
 * so a real order file is never wrongly rejected mid-drag.
 */
export function isClearlyUnsupportedDragType(mimeType: string): boolean {
  const t = mimeType.toLowerCase();
  return t.startsWith("image/") || t.startsWith("audio/") || t.startsWith("video/");
}
