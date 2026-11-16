"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/bridge/DSPrimitives";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { PHOTO_ACCEPT } from "@/lib/fileKinds";

const two = (n: number) => String(n).padStart(2, "0");

/** "photo-20261115-090307.jpg": a camera photo's name from the local time it was taken; ".png" for an image/png. */
export function photoName(at: Date, type: string): string {
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `photo-${day}-${time}.${type === "image/png" ? "png" : "jpg"}`;
}

/** A hidden camera input (accept PHOTO_ACCEPT, capture "environment"). Call open() inside a press.
 *  A JPEG or PNG is renamed with photoName before onPhoto; any other type keeps its own name, so the queue refuses it in words. */
export function useCamera(onPhoto: (file: File) => void, testId: string) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref} type="file" accept={PHOTO_ACCEPT} capture="environment" className="hidden" data-testid={testId}
      onChange={(e) => {
        const shot = e.target.files?.[0];
        e.target.value = "";
        if (shot) onPhoto(PHOTO_ACCEPT.split(",").includes(shot.type) ? new File([shot], photoName(new Date(), shot.type), { type: shot.type }) : shot);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/** "Check the photo", over the whole screen and the tab bar. onUse runs once however often it is pressed. */
export function PhotoCheck({ file, onBack, onRetake, onUse }: { file: File; onBack(): void; onRetake(): void; onUse(): void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y({ open: true, onClose: onBack, panelRef });
  const titleId = useId();
  const used = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  // Created and revoked in the same effect so a StrictMode remount gets a fresh URL (as ImageDocumentView does).
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-modal flex flex-col bg-surface">
      <div className="flex min-h-[52px] items-center gap-1 border-b border-border pl-1 pr-3">
        <button type="button" aria-label="Back" onClick={onBack} className="flex h-11 w-11 shrink-0 items-center justify-center text-ink">
          <ChevronLeft size={24} aria-hidden />
        </button>
        <h1 id={titleId} className="m-0 min-w-0 truncate font-display text-[19px] font-semibold text-ink">Check the photo</h1>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-navy p-4">
        {url && <img src={url} alt="The photo you took" className="min-h-0 max-h-full max-w-full rounded-[8px] object-contain" />}
        <p className="m-0 max-w-[300px] text-center text-[14.5px] text-navy-text">Make sure the whole page is in the picture and the text is sharp.</p>
      </div>
      <div className="flex gap-2.5 border-t border-border bg-surface px-4 pt-2.5" style={{ paddingBottom: "max(26px, env(safe-area-inset-bottom))" }}>
        <Button variant="secondary" className="!h-12 rounded-[10px] text-base" onClick={onRetake}>Retake</Button>
        <Button variant="blue" className="!h-12 flex-1 rounded-[10px] text-base"
          onClick={() => { if (used.current) return; used.current = true; onUse(); }}>Use this photo</Button>
      </div>
    </div>
  );
}
