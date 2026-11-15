"use client";

import { createContext, useContext, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary, Flow } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { acceptFor, fileRefusal } from "@/lib/fileKinds";
import { rememberFlow } from "@/lib/lastFlow";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import type { BillingStatus } from "@/types/procurement";

export type UploadState = "waiting" | "uploading" | "done" | "refused";
export interface UploadItem {
  key: string; file: File; flowId: string; flowName: string; state: UploadState;
  /** The server's answer, once accepted. */ document?: DocumentSummary;
  /** Why it was refused. */ error?: unknown;
}
export type UploadFlow = Pick<Flow, "id" | "name" | "scansOn" | "formatsOn">;

/** Refusals every later file would get too: the queue stops sending after one. */
export const STOP_CODES: ReadonlySet<string> = new Set([...LIMIT_CODES, "processing_paused"]);

/** Worth pressing "Try again": no answer, the server failing, or the speed limit (a 429 without a stop code). Never a kind, size, unreadable or plan refusal. */
export function canRetryUpload(error: unknown): boolean {
  return !(error instanceof ApiHttpError) || error.status >= 500 || (error.status === 429 && !STOP_CODES.has(refusalToken(error) ?? ""));
}

/** The row's sentence: the speed limit in its own words, otherwise documentRefusalMessage. */
export function uploadRefusalMessage(error: unknown): string {
  return error instanceof ApiHttpError && error.status === 429 && !STOP_CODES.has(refusalToken(error) ?? "")
    ? "Too many files at once. Wait a minute, then try this one again."
    : documentRefusalMessage(error);
}

type Queue = { items: readonly UploadItem[]; add(files: readonly File[], flow: UploadFlow): readonly string[]; retry(key: string): void };
const QueueContext = createContext<Queue | null>(null);

/** This visit's uploads, shared by every screen. Mounted once, in the app layout. */
export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const upload = useMutation({ mutationFn: ({ flowId, file }: { flowId: string; file: File }) => uploadDocument(flowId, file) });
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  // The ref is the truth the chain reads; the state only renders it. Nothing here starts by itself.
  const live = useRef<readonly UploadItem[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const counter = useRef(0);
  // A refusal about the workspace: new files are refused with it, at no request, while it holds.
  const stopped = useRef<{ error: unknown; at: number } | null>(null);

  const update = (change: (list: readonly UploadItem[]) => readonly UploadItem[]) => setItems((live.current = change(live.current)));
  const patch = (key: string, p: Partial<UploadItem>) => update((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  /** One at a time, in the order added. Skips an item no longer waiting (a stop refused it). */
  const enqueue = ({ key, flowId, file }: UploadItem) => {
    chain.current = chain.current.then(async () => {
      if (live.current.find((i) => i.key === key)?.state !== "waiting") return;
      patch(key, { state: "uploading" });
      try {
        patch(key, { state: "done", document: await upload.mutateAsync({ flowId, file }) });
        stopped.current = null;
        void qc.invalidateQueries({ queryKey: ["documents"] });
        void qc.invalidateQueries({ queryKey: ["flows"] });
      } catch (error) {
        const stop = STOP_CODES.has(refusalToken(error) ?? "");
        if (stop) stopped.current = { error, at: Date.now() };
        update((list) => list.map((i) => (i.key === key || (stop && i.state === "waiting") ? { ...i, state: "refused", error } : i)));
      }
    });
  };

  /** The stop refusal still in force: until an upload succeeds, or a billing status fetched after it says processing may go on. */
  const stopError = () => {
    const billing = qc.getQueryState<BillingStatus>(["billing-status"]);
    if (stopped.current && billing?.data?.canProcessOrders && billing.dataUpdatedAt > stopped.current.at) stopped.current = null;
    return stopped.current?.error;
  };

  const add = (files: readonly File[], flow: UploadFlow) => {
    rememberFlow(flow.id);
    const accept = acceptFor(flow);
    const stop = stopError();
    const added = files.map((file): UploadItem => {
      const error = fileRefusal(file, accept) ?? stop;
      return { key: `upload-${++counter.current}`, file, flowId: flow.id, flowName: flow.name, state: error ? "refused" : "waiting", ...(error ? { error } : {}) };
    });
    update((list) => [...added].reverse().concat(list));
    added.filter((i) => i.state === "waiting").forEach(enqueue);
    return added.map((i) => i.key);
  };

  const retry = (key: string) => {
    const item = live.current.find((i) => i.key === key);
    if (item?.state !== "refused" || !canRetryUpload(item.error)) return;
    patch(key, { state: "waiting", error: undefined });
    enqueue(item);
  };

  return <QueueContext.Provider value={{ items, add, retry }}>{children}</QueueContext.Provider>;
}

/** Items newest first; `add` answers the new items' keys. Throws outside the provider. */
export function useUploadQueue(): Queue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useUploadQueue is used outside UploadQueueProvider");
  return queue;
}
