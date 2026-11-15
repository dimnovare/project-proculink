"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Camera, ChevronRight, FileText, Image as ImageIcon, X } from "lucide-react";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { acceptFor, PHOTO_ACCEPT } from "@/lib/fileKinds";
import { chooseFlow, readLastFlow } from "@/lib/lastFlow";
import { isOnline } from "@/lib/pwa/online";
import { FlowChoice } from "./FlowChoice";
import { PhotoCheck, useCamera } from "./PhotoCheck";
import { useUploadQueue } from "./UploadQueue";

/** The phone's "Add a document" sheet. Mounted only while open. A pick goes into the upload queue, then the sheet closes and, online, /upload opens (R9). */
export function AddSheet({ onClose }: { onClose(): void }) {
  const router = useRouter();
  const { add } = useUploadQueue();
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const [lastId] = useState(readLastFlow);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const camera = useCamera(setPhoto, "sheet-camera-input");
  const list = flows.data ?? [];
  const flow = list.find((f) => f.id === flowId) ?? chooseFlow(list, lastId)?.flow;
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
  const isLast = flow.id === lastId;
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
          file={photo} flows={list} flowId={flow.id} lastUsedId={lastId} onFlow={setFlowId}
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
            <p className="m-0 mt-4 pb-2 text-[14px] font-semibold text-ink-muted">Goes to</p>
            <button type="button" aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}
              aria-label={`Goes to ${flow.name}${isLast ? ", last used" : ""}. Choose another flow`}
              className="flex !min-h-[60px] w-full items-center gap-3 rounded-xl border border-border-strong bg-surface px-4 text-left">
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-base font-semibold text-ink">{flow.name}</span>
                {isLast && <span className="text-[14px] text-ink-muted">Last used</span>}
              </span>
              <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-muted" />
            </button>
            {choosing && (
              <div className="mt-3 max-h-[40vh] overflow-auto">
                <FlowChoice compact flows={list} value={flow.id} lastUsedId={lastId} onChange={setFlowId} onDone={() => setChoosing(false)} />
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
