"use client";

import { useEffect, useState } from "react";
import type { SourceLocation } from "@/lib/api/documents";
import { SourceHighlight, SpotButtons } from "./SourceHighlight";
import { RegionPicker } from "./RegionPicker";
import type { SourcePick } from "./SourceDocumentBody";

/** A photo or scan as the original. */
export function ImageDocumentView({ blob, contentType, filename, highlight, marks, onPick, zoom = null }: { blob: Blob; contentType: string; filename: string; highlight?: SourceLocation | null; /** Values that need a look. */ marks?: readonly SourceLocation[]; onPick?(p: SourcePick): void; /** null: the picture's own size, never wider than its pane. A number: that share of the pane's width (1 fits it). */ zoom?: number | null }) {
  const [url, setUrl] = useState<string | null>(null);
  // Created and revoked in the same effect so a StrictMode remount gets a fresh URL.
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([blob], { type: contentType === "image/jpeg" ? "image/jpeg" : "image/png" })); // fixed image type: never html/svg on our origin
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, contentType]);
  return (
    <div className={zoom === null ? "relative inline-block max-w-full" : "relative mx-auto block"} style={zoom === null ? undefined : { width: `${zoom * 100}%` }}>
      {url && <img src={url} alt={filename} className={zoom === null ? "block h-auto max-w-full" : "block h-auto w-full"} />}
      {marks?.map((m, i) => m.box && (m.page == null || m.page === 1) && <SourceHighlight key={i} box={m.box} tone="look" />)}
      {highlight?.box && <SourceHighlight box={highlight.box} />}
      <SpotButtons page={1} />
      {onPick && <RegionPicker page={1} onBox={(box) => onPick({ page: 1, box })} />}
    </div>
  );
}
