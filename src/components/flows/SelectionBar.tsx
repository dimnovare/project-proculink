"use client";

import { useRef, useState } from "react";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { eachDocument, fetchOriginal, saveOriginals, sendOne, type Each } from "@/lib/eachDocument";
import type { ListedDocument } from "./DocumentList";

/** The key every run of the bar (send or download) goes under; a row's own Send is busy while one is out. */
export const BULK_SEND_KEY = ["document-send", "bulk"] as const;

/** "Send", "Send both", "Send all 4", "Send the ready one", "Send the 3 ready"; null when no ticked row is ready. */
export function sendLabel(selected: number, ready: number): string | null {
  if (ready === 0) return null;
  if (ready < selected) return ready === 1 ? "Send the ready one" : `Send the ${ready} ready`;
  return selected === 1 ? "Send" : selected === 2 ? "Send both" : `Send all ${selected}`;
}

type Words = { verb: "sent" | "downloaded"; unit: "document" | "file" };
type Result = { lines: React.ReactNode; ok: boolean; ids: string };

const idsOf = (docs: readonly { id: string }[]) => docs.map((d) => d.id).sort().join(",");

/** What a run did, in the words the bar prints. `went` is the success sentence for what was done. */
function summary<R>(r: Each<ListedDocument, R>, w: Words, went: string): Pick<Result, "lines" | "ok"> {
  const ok = r.refused.length === 0 && !r.stopped;
  if (ok) return { ok, lines: went };
  const refusedOne = r.refused.length === 1 && r.refused[0];
  const left = r.stopped?.left ?? 0;
  return {
    ok,
    lines: (
      <>
        {r.done.length > 0 && `${went} `}
        {refusedOne && `${refusedOne.item.fileName} couldn't be ${w.verb}: ${documentRefusalMessage(refusedOne.error)} `}
        {r.refused.length > 1 && (
          <>
            {`${r.refused.length} couldn't be ${w.verb}:`}
            <ul className="m-0 mt-1 list-disc pl-5">
              {r.refused.map((x) => <li key={x.item.id}>{`${x.item.fileName}: ${documentRefusalMessage(x.error)}`}</li>)}
            </ul>
          </>
        )}
        {r.stopped && `${documentRefusalMessage(r.stopped.error)} ${left === 1 ? `1 ${w.unit} wasn't` : `${left} ${w.unit}s weren't`} ${w.verb}.`}
      </>
    ),
  };
}

const sentWords = (r: Each<ListedDocument, unknown>) =>
  r.refused.length || r.stopped ? `${r.done.length} sent.`
  : r.done.length === 1 ? `${r.done[0].item.fileName} is on its way.` : `${r.done.length} documents are on their way.`;
const downloadedWords = (n: number, first?: string) => (n === 1 ? `${first} downloaded.` : `${n} files downloaded in documents.zip.`);

export function SelectionBar({ selected, onSent, onClear }: {
  /** The ticked rows on screen, in list order. */
  selected: ListedDocument[];
  /** A document went: untick it at once. A download unticks nothing. */
  onSent: (id: string) => void;
  onClear: () => void;
}) {
  const qc = useQueryClient();
  // Held from the press itself, so a second press before the next render starts nothing.
  const busy = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  // A row whose own Send is still out is not sent again from here.
  const rowSending = useMutationState({
    filters: { mutationKey: ["document-send"], status: "pending" },
    select: (m) => String(m.options.mutationKey?.[1]),
  });
  const run = useMutation({
    mutationKey: BULK_SEND_KEY,
    mutationFn: (job: () => Promise<Result>) => job(),
    onSuccess: setResult,
    onSettled: () => {
      busy.current = false;
      for (const key of ["documents", "activity"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
  const start = (job: () => Promise<Result>) => {
    if (busy.current) return;
    busy.current = true;
    run.mutate(job);
  };
  const ready = selected.filter((d) => d.status === "ready" && !rowSending.includes(d.id));
  const label = sendLabel(selected.length, ready.length);
  const n = selected.length;
  const shown = result && result.ids === idsOf(selected) ? result : null;
  if (n === 0 && !shown) return null;

  const pressSend = () => start(async () => {
    const r = await eachDocument(ready, sendOne, (d) => onSent(d.id));
    const left = selected.filter((d) => !r.done.some((x) => x.item.id === d.id));
    return { ...summary(r, { verb: "sent", unit: "document" }, sentWords(r)), ids: idsOf(left) };
  });
  const pressDownload = () => start(async () => {
    const r = await eachDocument(selected, fetchOriginal);
    try {
      await saveOriginals(r.done.map((x) => x.value));
    } catch (e) {
      return { ok: false, lines: documentRefusalMessage(e), ids: idsOf(selected) };
    }
    return { ...summary(r, { verb: "downloaded", unit: "file" }, downloadedWords(r.done.length, r.done[0]?.item.fileName)), ids: idsOf(selected) };
  });

  const outlined = "!border-navy-muted !text-white hover:!bg-navy-surface";
  return (
    <div role="region" aria-label={n === 1 ? "1 document selected" : `${n} documents selected`}
      className="sticky bottom-6 z-sticky mx-auto flex w-full max-w-[640px] flex-wrap items-center gap-3 rounded-card-lg bg-navy px-4 py-3 text-[14px] text-white max-sm:gap-2.5 max-sm:p-3">
      {shown ? (
        <div key="result" role={shown.ok ? "status" : "alert"} className="min-w-0 flex-1 basis-full sm:basis-auto">{shown.lines}</div>
      ) : (
        <p className="m-0 min-w-0 flex-1 font-semibold max-sm:basis-1/2">{`${n} selected`}</p>
      )}
      {n > 0 && (
        <>
          {label && (
            <Button type="button" variant="send" loading={run.isPending} onClick={pressSend} className="max-sm:order-2 max-sm:flex-1 max-sm:basis-[40%]">
              {label}
            </Button>
          )}
          <Button type="button" variant="ghost" loading={run.isPending} onClick={pressDownload} className={`${outlined} max-sm:order-3 max-sm:flex-1 max-sm:basis-[40%]`}>
            {n === 1 ? "Download file" : "Download files"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClear} className={`${outlined} max-sm:order-1`}>Clear</Button>
        </>
      )}
    </div>
  );
}
