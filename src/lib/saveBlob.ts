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
