"use client";

import { useEffect, useState } from "react";
import type { SourceLocation } from "@/lib/api/documents";
import { SourceHighlight } from "./SourceHighlight";
import { RegionPicker } from "./RegionPicker";
import type { SourcePick } from "./SourceDocumentBody";

/** A photo or scan as the original. */
export function ImageDocumentView({ blob, contentType, filename, highlight, marks, onPick }: { blob: Blob; contentType: string; filename: string; highlight?: SourceLocation | null; /** Values that need a look. */ marks?: readonly SourceLocation[]; onPick?(p: SourcePick): void }) {
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
      {marks?.map((m, i) => m.box && (m.page == null || m.page === 1) && <SourceHighlight key={i} box={m.box} tone="look" />)}
      {highlight?.box && <SourceHighlight box={highlight.box} />}
      {onPick && <RegionPicker page={1} onBox={(box) => onPick({ page: 1, box })} />}
    </div>
  );
}
