"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { fileRefusal } from "@/lib/fileKinds";

/** A drop zone with a hidden file input. Refuses the wrong type or an oversize file before `onFile`; `error` is the caller's own refusal to show. */
export function FileDrop({ accept, maxBytes, prompt, busyLabel, busy, error, onFile, variant = "secondary" }: {
  accept: string; maxBytes: number; prompt: string; busyLabel?: string; busy?: boolean; error?: string | null; onFile(file: File): void;
  /** The button's look: "blue" where choosing a file is the screen's one filled action. */
  variant?: "secondary" | "blue";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file || busy) return;
    const refusal = fileRefusal(file, accept, maxBytes);
    if (refusal) return setProblem(documentRefusalMessage(refusal));
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
        <Button type="button" variant={variant} loading={busy} onClick={() => input.current?.click()}>
          Choose a file
        </Button>
        <input ref={input} type="file" hidden accept={accept} aria-label="Choose a file"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {(problem ?? error) && <StatusNotice tone="error">{problem ?? error}</StatusNotice>}
    </div>
  );
}
