"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary, Flow } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { acceptFor, fileRefusal } from "@/lib/fileKinds";
import { rememberFlow } from "@/lib/lastFlow";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { canHoldMore, HeldRefusal, heldStore, type HeldStore } from "@/lib/pwa/heldUploads";
import { isOnline } from "@/lib/pwa/online";
import type { DeviceOwner } from "@/hooks/useDeviceOwner";
import type { BillingStatus } from "@/types/procurement";

export type UploadState = "waiting" | "held" | "uploading" | "done" | "refused";
export interface UploadItem {
  key: string; file: File; flowId: string; flowName: string; state: UploadState;
  /** The server's answer, once accepted. */ document?: DocumentSummary;
  /** Why it was refused. */ error?: unknown;
  /** Kept on this device while offline: its record goes when the server answers, or on Remove. */ wasHeld?: boolean;
}
export type UploadFlow = Pick<Flow, "id" | "name" | "scansOn" | "formatsOn">;

/** Refusals every later file would get too: the queue stops sending after one. */
export const STOP_CODES: ReadonlySet<string> = new Set([...LIMIT_CODES, "processing_paused"]);

/** Worth pressing "Try again": no answer, the server failing, the speed limit (a 429 without a stop code), or a file this device could not keep. Never a kind, size, unreadable or plan refusal. */
export function canRetryUpload(error: unknown): boolean {
  return !(error instanceof ApiHttpError) || error.status >= 500 || (error.status === 429 && !STOP_CODES.has(refusalToken(error) ?? ""));
}

/** The row's sentence: a device refusal or the speed limit in its own words, otherwise documentRefusalMessage. */
export function uploadRefusalMessage(error: unknown): string {
  if (error instanceof HeldRefusal) return error.message;
  return error instanceof ApiHttpError && error.status === 429 && !STOP_CODES.has(refusalToken(error) ?? "")
    ? "Too many files at once. Wait a minute, then try this one again."
    : documentRefusalMessage(error);
}

type Queue = {
  items: readonly UploadItem[];
  add(files: readonly File[], flow: UploadFlow): readonly string[];
  retry(key: string): void;
  /** Drops a held or refused item, and its copy on this device. */
  remove(key: string): void;
};
const QueueContext = createContext<Queue | null>(null);

const sameOwner = (a: DeviceOwner | null | undefined, b: DeviceOwner | null) => !!a && !!b && a.userId === b.userId && a.orgId === b.orgId;

/**
 * This visit's uploads, shared by every screen. Mounted once, in the app layout.
 * Offline, a file waits on the device (bound to its person, workspace and flow) and goes
 * up when the connection returns. `owner` is who files are kept for (the layout passes
 * useDeviceOwner(); none means nothing is kept or sent from the device). `store` is for tests.
 */
export function UploadQueueProvider({ children, owner = null, store: given }: { children: React.ReactNode; owner?: DeviceOwner | null; store?: HeldStore | null }) {
  const store = given === undefined ? heldStore() : given;
  const ownerNow = useRef(owner);
  ownerNow.current = owner;
  const qc = useQueryClient();
  const upload = useMutation({ mutationFn: ({ flowId, file }: { flowId: string; file: File }) => uploadDocument(flowId, file) });
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  // The ref is the truth the chain reads; the state only renders it. Nothing here starts by itself.
  const live = useRef<readonly UploadItem[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // A refusal about the workspace: new files are refused with it, at no request, while it holds.
  const stopped = useRef<{ error: unknown; at: number } | null>(null);
  // Held files this tab owns: the Web Lock's release, and who the file belongs to.
  const claims = useRef(new Map<string, { release: () => void; owner: DeviceOwner }>());

  const update = (change: (list: readonly UploadItem[]) => readonly UploadItem[]) => setItems((live.current = change(live.current)));
  const patch = (key: string, p: Partial<UploadItem>) => update((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const release = (key: string) => {
    claims.current.get(key)?.release();
    claims.current.delete(key);
  };
  /** A server answered: the device copy goes first, then the lock. */
  const forget = async (key: string) => {
    await store?.remove(key).catch(() => {});
    release(key);
  };

  /** Keeps the file on this device, or refuses it in words. Never kept only in memory. */
  const hold = async ({ key, file, flowId, flowName, wasHeld }: UploadItem) => {
    const who = ownerNow.current;
    try {
      if (!store || !who) throw new HeldRefusal("held_unavailable");
      if (!wasHeld) {
        const limit = canHoldMore(await store.all().catch(() => { throw new HeldRefusal("held_unavailable"); }), file);
        if (limit) throw limit;
        await store.put({ key, ...who, flowId, flowName, file, heldAt: new Date().toISOString() }).catch(() => { throw new HeldRefusal("held_no_room"); });
      }
      if (!claims.current.has(key)) {
        const r = await store.claim(key);
        if (r) claims.current.set(key, { release: r, owner: who });
      }
      patch(key, { state: "held", wasHeld: true, error: undefined });
    } catch (e) {
      patch(key, { state: "refused", error: e instanceof HeldRefusal ? e : new HeldRefusal("held_unavailable") });
    }
  };

  /** One at a time, in the order added. Skips an item no longer waiting (a stop refused it). */
  const enqueue = ({ key }: UploadItem) => {
    chain.current = chain.current.then(async () => {
      const item = live.current.find((i) => i.key === key);
      if (item?.state !== "waiting") return;
      if (!isOnline()) return hold(item);
      if (item.wasHeld) {
        // Sent only by the tab that owns it, and only under the person and workspace it was chosen for.
        if (!claims.current.has(key) && store && ownerNow.current) {
          const r = await store.claim(key);
          if (r) claims.current.set(key, { release: r, owner: ownerNow.current });
        }
        if (!sameOwner(claims.current.get(key)?.owner, ownerNow.current)) return patch(key, { state: "held" });
      }
      patch(key, { state: "uploading" });
      try {
        const document = await upload.mutateAsync({ flowId: item.flowId, file: item.file });
        if (item.wasHeld) await forget(key);
        patch(key, { state: "done", document });
        stopped.current = null;
        void qc.invalidateQueries({ queryKey: ["documents"] });
        void qc.invalidateQueries({ queryKey: ["flows"] });
      } catch (error) {
        if (!(error instanceof ApiHttpError) && !isOnline()) return hold({ ...item, state: "waiting" });
        if (item.wasHeld && error instanceof ApiHttpError) await forget(key);
        const stop = STOP_CODES.has(refusalToken(error) ?? "");
        if (stop) stopped.current = { error, at: Date.now() };
        update((list) => list.map((i) => (i.key === key || (stop && i.state === "waiting") ? { ...i, state: "refused", error } : i)));
      }
    });
  };

  /**
   * Adopts this person's held files for this workspace, deletes another person's unsent,
   * leaves another workspace's and another tab's alone, and, online, sends what it holds.
   */
  const sync = async () => {
    const who = ownerNow.current;
    if (!store || !who) return;
    // Held items of another person or workspace (a switch in this tab) leave the list; their files stay on the device.
    for (const i of live.current) {
      if (i.state === "held" && !sameOwner(claims.current.get(i.key)?.owner, who)) {
        release(i.key);
        update((list) => list.filter((x) => x.key !== i.key));
      }
    }
    const records = await store.all().catch(() => []);
    for (const r of records) {
      if (r.userId !== who.userId) {
        await store.remove(r.key).catch(() => {});
        continue;
      }
      if (r.orgId !== who.orgId || live.current.some((i) => i.key === r.key)) continue;
      const claimed = await store.claim(r.key);
      if (!claimed) continue; // another tab owns it
      claims.current.set(r.key, { release: claimed, owner: who });
      update((list) => [{ key: r.key, file: r.file, flowId: r.flowId, flowName: r.flowName, state: "held" as const, wasHeld: true }, ...list]);
    }
    if (!isOnline()) return;
    for (const i of live.current.filter((x) => x.state === "held")) {
      patch(i.key, { state: "waiting" });
      enqueue(i);
    }
  };

  // Device work only, never a fetch of its own: on start once the person is known, and when the connection returns.
  useEffect(() => {
    if (!owner) return;
    const run = () => {
      chain.current = chain.current.then(sync);
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, store]);

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
      // A stable key: a held file's record carries it, ready for an idempotency header.
      return { key: crypto.randomUUID(), file, flowId: flow.id, flowName: flow.name, state: error ? "refused" : "waiting", ...(error ? { error } : {}) };
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

  const remove = (key: string) => {
    const item = live.current.find((i) => i.key === key);
    if (item?.state !== "held" && item?.state !== "refused") return;
    update((list) => list.filter((i) => i.key !== key));
    if (item.wasHeld) void forget(key);
  };

  return <QueueContext.Provider value={{ items, add, retry, remove }}>{children}</QueueContext.Provider>;
}

/** Items newest first; `add` answers the new items' keys. Throws outside the provider. */
export function useUploadQueue(): Queue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useUploadQueue is used outside UploadQueueProvider");
  return queue;
}
