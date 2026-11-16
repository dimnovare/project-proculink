"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { FileText } from "lucide-react";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { canRetryUpload, uploadRefusalMessage, useUploadQueue } from "@/components/flows/UploadQueue";

/**
 * After Remove the row is gone from under the focused button: focus moves to `target` (the
 * list or its heading) once the removal has drawn, or to the page's main region when the
 * whole list went with it — never back to the top of the document.
 */
export function focusAfterRemove(target: HTMLElement | null) {
  requestAnimationFrame(() => (target?.isConnected ? target : document.getElementById("main-content"))?.focus());
}

/**
 * Files added while offline, at the top of every app screen but Upload (which lists
 * them under "Just added"). A file that went up leaves; the lists refresh as usual.
 */
export function HeldUploads() {
  const path = usePathname();
  const { items, retry, remove } = useUploadQueue();
  const strip = useRef<HTMLElement>(null);
  const waiting = items.filter((i) => i.wasHeld && i.state !== "done");
  if (path === "/upload" || waiting.length === 0) return null;
  return (
    <section ref={strip} tabIndex={-1} aria-label="Files waiting to upload" data-testid="held-uploads" className="flex flex-col gap-2 px-4 pt-4 outline-none md:px-6">
      {waiting.map((item) => {
        const name = item.file.name;
        return (
          <Card key={item.key} edge="none" className="flex flex-wrap items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-blue-soft text-brand-blue">
              <FileText size={20} />
            </span>
            <div className="grid min-w-0 flex-[1_1_200px] gap-1">
              <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
              <span>
                {item.state === "held" ? <Pill tone="amber">Waiting for connection</Pill>
                  : item.state === "uploading" ? <Pill tone="blue">Uploading</Pill>
                  : item.state === "refused" ? <Pill tone="danger">Not uploaded</Pill>
                  : null}
              </span>
              {item.state === "held" && <p className="m-0 text-[13px] text-ink-muted">It uploads when you&apos;re back online.</p>}
              {item.state === "refused" && <p className="m-0 text-[13px] text-danger-text">{uploadRefusalMessage(item.error)}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {item.state === "refused" && canRetryUpload(item.error) && (
                <Button variant="secondary" size="sm" aria-label={`Try ${name} again`} onClick={() => retry(item.key)}>Try again</Button>
              )}
              {(item.state === "held" || item.state === "refused") && (
                <Button variant="secondary" size="sm" aria-label={`Remove ${name}`} onClick={() => { remove(item.key); focusAfterRemove(strip.current); }}>Remove</Button>
              )}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
