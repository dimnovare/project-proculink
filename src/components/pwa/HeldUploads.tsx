"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { addTarget, canRetryUpload, uploadRefusalMessage, useUploadQueue } from "@/components/flows/UploadQueue";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";

/** "2 shared files are waiting on this phone: a.pdf and b.jpg." — the first three names, then "and N more". */
export function sharedLine(names: readonly string[]): string {
  const n = names.length;
  if (n === 1) return `1 shared file is waiting on this phone: ${names[0]}.`;
  const list = n > 3 ? `${names.slice(0, 3).join(", ")} and ${n - 3} more` : `${names.slice(0, -1).join(", ")} and ${names[n - 1]}`;
  return `${n} shared files are waiting on this phone: ${list}.`;
}

/**
 * Files shared to this phone wait here, on every app screen, until the person presses Add
 * them or Discard: any site can post a "share", so nothing goes up without that press.
 * Hidden until the device was read, while there are none, and while the target is unknown.
 */
export function SharedWaiting() {
  const { shared, addShared, discardShared } = useUploadQueue();
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() && !!shared?.length });
  const target = addTarget(flows.data);
  if (!shared?.length || !target) return null;
  // The keys of the files this render names: the buttons act on exactly these.
  const keys = shared.map((f) => f.key);
  return (
    <div className="px-4 pt-4 md:px-6">
      <StatusNotice
        tone="warning"
        action={
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => addShared(target, keys)}>Add them</Button>
            <Button variant="ghost" size="sm" onClick={() => discardShared(keys)}>Discard</Button>
          </span>
        }
      >
        <span className="break-words">{sharedLine(shared.map((f) => f.name))}</span>
      </StatusNotice>
    </div>
  );
}

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
