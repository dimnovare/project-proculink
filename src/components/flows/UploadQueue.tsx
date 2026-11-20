"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { addDocument, uploadDocument } from "@/lib/api/documents";
import type { DocumentSummary, Flow } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { acceptFor, fileRefusal } from "@/lib/fileKinds";
import { firstRunOf } from "@/lib/firstRun";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { canHoldMore, HeldRefusal, heldStore, type HeldRecord, type HeldStore } from "@/lib/pwa/heldUploads";
import { isOnline } from "@/lib/pwa/online";
import type { DeviceOwner } from "@/hooks/useDeviceOwner";
import type { BillingStatus } from "@/types/procurement";

export type UploadState = "waiting" | "held" | "uploading" | "done" | "refused";
export interface UploadItem {
  key: string; file: File; flowId: string; state: UploadState;
  /** The server's answer, once accepted. */ document?: DocumentSummary;
  /** Why it was refused. */ error?: unknown;
  /** Was kept on this device while offline: listed on every screen until it has gone up or is removed. */ wasHeld?: boolean;
}
export type UploadFlow = Pick<Flow, "id" | "name" | "scansOn" | "formatsOn">;
/** The target for "no flow": the workspace inbox. `id: ""` is sent with addDocument (R5). */
export const INBOX_TARGET = (s: { scansOn?: boolean; formatsOn?: boolean }): UploadFlow => ({ id: "", name: "", scansOn: s.scansOn, formatsOn: s.formatsOn });
/**
 * Where an added file goes: the workspace inbox, or, on a first run, the first flow (as Welcome does: in the
 * inbox the file would wait unseen). What the workspace reads is set per workspace, so any flow carries it (R7).
 * undefined while the flows are loading, or with no flow yet.
 */
export function addTarget(flows: readonly Flow[] | undefined): UploadFlow | undefined {
  const run = firstRunOf(flows);
  return run.state === "new" && run.flow ? run.flow : flows?.[0] && INBOX_TARGET(flows[0]);
}

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
  /** A document was removed, from any screen: its item leaves Just added. */
  dropDocument(documentId: string): void;
  /** The files shared to this phone that wait for a press, oldest first; null until the device was read (or with no store or owner). */
  shared: readonly SharedFile[] | null;
  /** Binds the shared files with these keys (the ones on screen, and no other) to this person, workspace and `target`; then they go the ordinary held way. */
  addShared(target: UploadFlow, keys: readonly string[]): void;
  /** Deletes the shared files with these keys from this phone. */
  discardShared(keys: readonly string[]): void;
};
export type SharedFile = { key: string; name: string };
const QueueContext = createContext<Queue | null>(null);
const byHeldAt = (a: HeldRecord, b: HeldRecord) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : 0);

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
  const upload = useMutation({ mutationFn: ({ flowId, file }: { flowId: string; file: File }) => (flowId ? uploadDocument(flowId, file) : addDocument(file)) });
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  // The ref is the truth the chain reads; the state only renders it. Nothing here starts by itself.
  const live = useRef<readonly UploadItem[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // A refusal about the workspace: new files are refused with it, at no request, while it holds.
  const stopped = useRef<{ error: unknown; at: number } | null>(null);
  // Who each item was chosen for (bound when chosen, R9), and which items still have a copy on this device.
  const bound = useRef(new Map<string, DeviceOwner>());
  const kept = useRef(new Set<string>());
  // The Web Locks this tab holds on kept files.
  const claims = useRef(new Map<string, () => void>());
  // Files shared to this phone that wait for a press, and, only during Add them, where the pressed ones go.
  const [shared, setShared] = useState<readonly SharedFile[] | null>(null);
  const take = useRef<{ target: UploadFlow; keys: readonly string[] } | null>(null);
  const showShared = (records: HeldRecord[]) => setShared(records.sort(byHeldAt).map((r) => ({ key: r.key, name: r.file.name })));

  const update = (change: (list: readonly UploadItem[]) => readonly UploadItem[]) => setItems((live.current = change(live.current)));
  const patch = (key: string, p: Partial<UploadItem>) => update((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const drop = (key: string) => update((list) => list.filter((i) => i.key !== key));
  const release = (key: string) => {
    claims.current.get(key)?.();
    claims.current.delete(key);
  };
  /** Takes this file's lock unless this tab has it; false when another tab owns it. */
  const own = async (key: string) => {
    if (claims.current.has(key)) return true;
    const r = await store?.claim(key).catch(() => null);
    if (r) claims.current.set(key, r);
    return !!r;
  };
  /** A server answered (or Remove): the device copy goes first, then the lock. */
  const forget = async (key: string) => {
    kept.current.delete(key);
    await store?.remove(key).catch(() => {});
    release(key);
  };

  /** Keeps the file on this device, or refuses it in words. Never kept only in memory. */
  const hold = async ({ key, file, flowId }: UploadItem) => {
    const who = bound.current.get(key);
    try {
      if (!store || !who) throw new HeldRefusal("held_unavailable");
      if (!kept.current.has(key)) {
        // Exact within a tab (the chain holds one file at a time); two tabs offline at once can each pass at the edge.
        const limit = canHoldMore(await store.all().catch(() => { throw new HeldRefusal("held_unavailable"); }), file);
        if (limit) throw limit;
        await store.put({ key, ...who, flowId, file, heldAt: new Date().toISOString() }).catch(() => { throw new HeldRefusal("held_no_room"); });
        kept.current.add(key);
      }
      // Another tab took it between the write and the lock: that tab shows and sends it.
      if (!(await own(key))) return drop(key);
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
      if (kept.current.has(key)) {
        // A copy on this device is sent only by the tab that owns it, and only under the person and workspace it was chosen for.
        if (!sameOwner(bound.current.get(key), ownerNow.current)) return patch(key, { state: "held" });
        if (!(await own(key))) return drop(key);
      }
      patch(key, { state: "uploading" });
      try {
        const document = await upload.mutateAsync({ flowId: item.flowId, file: item.file });
        if (kept.current.has(key)) await forget(key);
        patch(key, { state: "done", document });
        stopped.current = null;
        void qc.invalidateQueries({ queryKey: ["documents"] });
        void qc.invalidateQueries({ queryKey: ["flows"] });
      } catch (error) {
        if (!(error instanceof ApiHttpError) && !isOnline()) return hold({ ...item, state: "waiting" });
        if (kept.current.has(key) && error instanceof ApiHttpError) await forget(key);
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
    // After a workspace switch in this tab, every item chosen for another owner leaves the list (unless it is
    // going up right now); a copy on this device stays there for its own workspace.
    for (const i of live.current) {
      const chosenFor = bound.current.get(i.key);
      if (chosenFor && !sameOwner(chosenFor, who) && i.state !== "uploading") {
        release(i.key);
        kept.current.delete(i.key);
        drop(i.key);
      }
    }
    const records = (await store.all().catch(() => [])).sort(byHeldAt);
    const left: HeldRecord[] = [];
    for (let r of records) {
      // Shared to this phone (any site can post a share): no owner until Add them, and then only the files that press saw.
      if (r.userId === "") {
        if (!take.current?.keys.includes(r.key) || !(await own(r.key))) {
          left.push(r);
          continue;
        }
        r = { ...r, userId: who.userId, orgId: who.orgId, flowId: take.current.target.id };
        // Safe to swallow: the file is sent from memory below; if the tab dies first, the device copy stays ownerless and asks again.
        await store.put(r).catch(() => {});
      }
      if (r.userId !== who.userId) {
        await store.remove(r.key).catch(() => {});
        continue;
      }
      if (r.orgId !== who.orgId || live.current.some((i) => i.key === r.key)) continue;
      if (!(await own(r.key))) continue; // another tab owns it
      bound.current.set(r.key, { userId: r.userId, orgId: r.orgId });
      kept.current.add(r.key);
      update((list) => [{ key: r.key, file: r.file, flowId: r.flowId, state: "held" as const, wasHeld: true }, ...list]);
    }
    showShared(left);
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
    const accept = acceptFor(flow);
    const stop = stopError();
    const added = files.map((file): UploadItem => {
      const error = fileRefusal(file, accept) ?? stop;
      // A stable key: a held file's record carries it, ready for an idempotency header.
      return { key: crypto.randomUUID(), file, flowId: flow.id, state: error ? "refused" : "waiting", ...(error ? { error } : {}) };
    });
    if (ownerNow.current) for (const i of added) bound.current.set(i.key, ownerNow.current);
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
    drop(key);
    if (kept.current.has(key)) void forget(key);
  };

  const dropDocument = (documentId: string) => update((list) => list.filter((i) => i.document?.id !== documentId));

  // Both act only on the keys the press saw: a file that arrived since, or a second tap, never rides along. A key already bound or gone is a no-op.
  const addShared = (target: UploadFlow, keys: readonly string[]) => {
    chain.current = chain.current.then(async () => {
      take.current = { target, keys };
      try {
        await sync();
      } finally {
        take.current = null;
      }
    });
  };

  const discardShared = (keys: readonly string[]) => {
    chain.current = chain.current.then(async () => {
      const left: HeldRecord[] = [];
      for (const r of (await store?.all().catch(() => [])) ?? []) {
        if (r.userId !== "") continue;
        if (keys.includes(r.key) && (await own(r.key))) await forget(r.key);
        else left.push(r); // not on screen at the press, or another tab holds it
      }
      showShared(left);
    });
  };

  return <QueueContext.Provider value={{ items, add, retry, remove, dropDocument, shared, addShared, discardShared }}>{children}</QueueContext.Provider>;
}

/** The queue, or null outside the provider (a screen tested on its own). */
export const useUploadQueueIfMounted = (): Queue | null => useContext(QueueContext);

/** Items newest first; `add` answers the new items' keys. Throws outside the provider. */
export function useUploadQueue(): Queue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useUploadQueue is used outside UploadQueueProvider");
  return queue;
}
