"use client";

import { useEffect, useState } from "react";
import type { SourceLocation } from "@/lib/api/documents";
import { SourceHighlight } from "./SourceHighlight";

/** A photo or scan as the original. */
export function ImageDocumentView({ blob, contentType, filename, highlight }: { blob: Blob; contentType: string; filename: string; highlight?: SourceLocation | null }) {
  const [url, setUrl] = useState<string | null>(null);
  // Created and revoked in the same effect so a StrictMode remount gets a fresh URL.
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([blob], { type: contentType === "image/jpeg" ? "image/jpeg" : "image/png" })); // fixed image type: never html/svg on our origin
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, contentType]);
  return (
    <div className="relative inline-block max-w-full">
      {url && <img src={url} alt={filename} className="block h-auto max-w-full" />}
      {highlight?.box && <SourceHighlight box={highlight.box} />}
    </div>
  );
}
