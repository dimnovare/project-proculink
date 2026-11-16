"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Camera, FileText, Image as ImageIcon, X } from "lucide-react";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { acceptFor, PHOTO_ACCEPT } from "@/lib/fileKinds";
import { firstRunOf } from "@/lib/firstRun";
import { isOnline } from "@/lib/pwa/online";
import { PhotoCheck, useCamera } from "./PhotoCheck";
import { INBOX_TARGET, useUploadQueue } from "./UploadQueue";

/** The phone's "Add a document" sheet. Mounted only while open. A pick goes to the workspace (no flow; on a first run, to its first flow) through the upload queue, then the sheet closes and, online, /upload opens (R9). */
export function AddSheet({ onClose }: { onClose(): void }) {
  const router = useRouter();
  const { add } = useUploadQueue();
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const [photo, setPhoto] = useState<File | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const camera = useCamera(setPhoto, "sheet-camera-input");
  // What the workspace reads is set per workspace, so any flow carries it (R7); with no flow the sheet is not offered.
  // A workspace still on its first run sends to its first flow, as Welcome does: in the inbox the file would wait unseen.
  const run = firstRunOf(flows.data);
  const flow = run.state === "new" && run.flow ? run.flow : flows.data?.[0] && INBOX_TARGET(flows.data[0]);
  useDialogA11y({ open: !!flow && !photo, onClose, panelRef });
  if (!flow) return null;

  const pick = (files: readonly File[]) => {
    if (files.length === 0) return;
    add(files, flow);
    onClose();
    // Offline, /upload would load the offline page; the file shows in the strip on this screen instead.
    if (isOnline()) router.push("/upload");
  };
  const fromInput = (e: React.ChangeEvent<HTMLInputElement>) => { pick([...(e.target.files ?? [])]); e.target.value = ""; };
  const choices = [
    ...(flow.scansOn ? [{ label: "Take a photo", Icon: Camera, onClick: camera.open }] : []),
    { label: "Choose a file", Icon: FileText, onClick: () => fileInput.current?.click() },
    ...(flow.scansOn ? [{ label: "Choose from your photos", Icon: ImageIcon, onClick: () => photosInput.current?.click() }] : []),
  ];

  return (
    <>
      <input ref={fileInput} type="file" multiple accept={acceptFor(flow)} className="hidden" data-testid="sheet-file-input" onChange={fromInput} />
      <input ref={photosInput} type="file" multiple accept={PHOTO_ACCEPT} className="hidden" data-testid="sheet-photos-input" onChange={fromInput} />
      {camera.input}
      {photo ? (
        <PhotoCheck
          file={photo}
          onBack={() => setPhoto(null)} onRetake={() => { setPhoto(null); camera.open(); }} onUse={() => pick([photo])}
        />
      ) : (
        <>
          <div aria-hidden className="fixed inset-0 z-modal bg-navy/55" onClick={onClose} />
          <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className="fixed inset-x-0 bottom-0 z-modal rounded-t-[20px] bg-surface px-4 pt-2" style={{ paddingBottom: "max(26px, env(safe-area-inset-bottom))" }}>
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-border-strong" />
            <div className="flex h-14 items-center justify-between">
              <h2 id={titleId} className="m-0 text-[19px] font-semibold text-ink">Add a document</h2>
              <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 flex h-11 w-11 items-center justify-center text-ink-muted">
                <X size={22} aria-hidden />
              </button>
            </div>
            {choices.map(({ label, Icon, onClick }, i) => (
              <button key={label} type="button" onClick={onClick}
                className={`flex !min-h-[56px] w-full items-center gap-3.5 text-left text-base font-semibold text-ink ${i ? "border-t border-border" : ""}`}>
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${i === 0 && flow.scansOn ? "bg-brand-blue text-white" : "bg-brand-blue-soft text-brand-blue"}`}>
                  <Icon size={20} />
                </span>
                {label}
              </button>
            ))}
          </section>
        </>
      )}
    </>
  );
}
