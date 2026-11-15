"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { TableFileRefusal } from "@/lib/lookupCsv";

// One store for the Lookups screen, kept in the module so it outlives a route change between
// /lookups and /lookups/[id] (each route mounts its own LookupsHome). It lives for the page's life.

export type LookupNotice = {
  tone: "success" | "error"; text: string;
  /** Resolves to the sentence that replaces the notice; rejects with the error to explain. */
  undo?: () => Promise<string>;
  /** The lookup whose panel owns the Undo; its panel clears the notice when it closes. Absent for a new lookup. */
  owner?: string;
};

type Store = { notice: LookupNotice | null; newIds: ReadonlySet<string>; renameOnOpen: string | null };
let store: Store = { notice: null, newIds: new Set(), renameOnOpen: null };
const listeners = new Set<() => void>();
const set = (next: Partial<Store>) => {
  store = { ...store, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => store;

export const showLookupNotice = (notice: LookupNotice | null) => set({ notice });

/** Clears the notice when `owner`'s panel owns it (the panel is closing). */
export const dropLookupNotice = (owner: string) => {
  if (store.notice?.owner === owner) set({ notice: null });
};

/** "Couldn't import {file}. {reason}": the file's own refusal, or the server's sentence. */
export const importRefusal = (file: File, e: unknown): LookupNotice => ({
  tone: "error",
  text: `Couldn't import ${file.name}. ${e instanceof TableFileRefusal ? e.message : documentRefusalMessage(e)}`,
});

export const markNewLookup = (id: string, opts?: { rename?: boolean }) =>
  set({ newIds: new Set(store.newIds).add(id), renameOnOpen: opts?.rename ? id : store.renameOnOpen });

export const useLookupStore = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/** True once for the id marked with rename. */
export function takeRenameOnOpen(id: string): boolean {
  if (store.renameOnOpen !== id) return false;
  set({ renameOnOpen: null });
  return true;
}

/** The notice with its Undo: busy while undoing; on failure "Couldn't undo. {documentRefusalMessage(e)}" with Undo kept. */
export function LookupNoticeBanner() {
  const { notice } = useLookupStore();
  const [busy, setBusy] = useState(false);
  if (!notice) return null;
  const { undo } = notice;
  // Only the notice that was undone is replaced: a newer one shown meanwhile stays.
  const replace = (next: LookupNotice) => {
    if (store.notice === notice) showLookupNotice(next);
  };
  const run = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      replace({ tone: "success", text: await undo() });
    } catch (e) {
      replace({ ...notice, tone: "error", text: `Couldn't undo. ${documentRefusalMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <StatusNotice
      tone={notice.tone}
      className="mb-4"
      action={undo && <Button variant="secondary" size="sm" loading={busy} onClick={run}>Undo</Button>}
    >
      {notice.text}
    </StatusNotice>
  );
}
