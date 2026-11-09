"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";

/** A drop zone with a hidden file input. Refuses the wrong type or an oversize file before `onFile`; `error` is the caller's own refusal to show. */
export function FileDrop({ accept, maxBytes, prompt, busyLabel, busy, error, onFile }: {
  accept: string; maxBytes: number; prompt: string; busyLabel?: string; busy?: boolean; error?: string | null; onFile(file: File): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file || busy) return;
    if (!accept.split(",").some((ext) => file.name.toLowerCase().endsWith(ext)))
      return setProblem(documentRefusalMessage(new ApiHttpError("unsupported", 415, { error: "unsupported_format" })));
    if (file.size > maxBytes) return setProblem(documentRefusalMessage(new ApiHttpError("too large", 413, { error: "file_too_large" })));
    setProblem(null);
    onFile(file);
  }

  return (
    <div className="grid gap-3">
      <div
        className={`grid justify-items-center gap-2 rounded-card border border-dashed p-6 text-center ${over ? "border-brand-blue" : "border-borderStrong"}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      >
        <p className="text-[13px] text-ink-muted">{busy && busyLabel ? busyLabel : prompt}</p>
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          Choose a file
        </Button>
        <input ref={input} type="file" hidden accept={accept} aria-label="Choose a file"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {(problem ?? error) && <StatusNotice tone="error">{problem ?? error}</StatusNotice>}
    </div>
  );
}
