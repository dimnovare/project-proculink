import type { OutputPreview } from "./api/documents";

/** Hands a blob to the browser as a file download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = fileName;
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking on the next tick lets the navigation start before the URL is invalidated.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Saves a preview as the file it is: a binary type comes as base64, text as it reads (its byte-order mark put back). */
export function savePreview(p: OutputPreview): void {
  const body = p.base64 ? Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)) : `${p.byteOrderMark ? "\uFEFF" : ""}${p.content}`;
  saveBlob(new Blob([body], { type: p.contentType }), p.fileName);
}