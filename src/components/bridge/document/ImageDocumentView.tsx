"use client";

import { useEffect, useMemo } from "react";

/** A photo or scan as the original. */
export function ImageDocumentView({ blob, filename }: { blob: Blob; filename: string; highlight?: unknown }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([blob], { type: blob.type === "image/jpeg" ? "image/jpeg" : "image/png" })), // fixed image type: never html/svg on our origin
    [blob],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative inline-block max-w-full">
      <img src={url} alt={filename} className="block h-auto max-w-full" />
    </div>
  );
}
