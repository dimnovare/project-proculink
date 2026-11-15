"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { useAutosave, type SaveState } from "@/hooks/useAutosave";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import type { FlowStep } from "@/lib/flowSteps";

/** Why flushAll() stopped: the first part, in the order the parts mounted, whose save was refused or failed. */
export class DraftPartFailed extends Error {
  constructor(readonly part: string, readonly step: FlowStep, readonly error: unknown) {
    super(`The draft part "${part}" couldn't be saved.`);
  }
}

type Entry = { step: FlowStep; flush: () => Promise<void>; drop: () => void };
type Registry = {
  parts: Map<string, Entry>;
  /** Every save on its way, a part's that has already left too. */
  saving: Set<Promise<unknown>>;
  /** Saves a part sent as it left that were refused after it was gone; flushAll reports the first, once. */
  leftFailed: DraftPartFailed[];
};
type Draft = {
  reg: React.MutableRefObject<Registry>;
  saved: () => void;
  flushAll: () => Promise<void>;
  discardAll: () => Promise<void>;
  revision: number;
  bump: () => void;
};

const DraftContext = createContext<Draft | null>(null);

const settled = async (r: Registry) => { while (r.saving.size) await Promise.allSettled([...r.saving]); };

/** Holds the flow page's draft parts (the values, each output): each saves on its own, and all are flushed together
 *  before publish, discard and a step switch. `revision` is what editors key on, so a publish, discard or restore
 *  replaces them, never a background refetch. */
export function FlowDraftProvider({ flowId, children }: { flowId: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const reg = useRef<Registry>({ parts: new Map(), saving: new Set(), leftFailed: [] });
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((n) => n + 1), []);
  // A saved draft changes the server's hasChanges, which only the flow itself carries.
  const saved = useCallback(() => { qc.invalidateQueries({ queryKey: ["flow", flowId] }); }, [qc, flowId]);

  const flushAll = useCallback(async () => {
    const r = reg.current;
    const parts = [...r.parts];
    const results = await Promise.allSettled(parts.map(([, p]) => p.flush()));
    await settled(r);
    const i = results.findIndex((x) => x.status === "rejected");
    if (i >= 0) throw new DraftPartFailed(parts[i][0], parts[i][1].step, (results[i] as PromiseRejectedResult).reason);
    const left = r.leftFailed.splice(0)[0];
    if (left) throw left;
  }, []);

  const discardAll = useCallback(async () => {
    const r = reg.current;
    r.parts.forEach((p) => p.drop());
    await settled(r);
    r.parts.forEach((p) => p.drop());   // a save that was on its way and failed has put its value back
    r.leftFailed.length = 0;
  }, []);

  const value = useMemo(() => ({ reg, saved, flushAll, discardAll, revision, bump }), [saved, flushAll, discardAll, revision, bump]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

function useDraft() {
  const d = useContext(DraftContext);
  if (!d) throw new Error("Flow draft parts need a FlowDraftProvider.");
  return d;
}

export function useFlowDraft() {
  const { flushAll, discardAll, revision, bump } = useDraft();
  return { flushAll, discardAll, revision, bump };
}

/** One part of the draft, saved through the shared useAutosave and registered under `part` until it unmounts. */
export function useDraftPart<T>(part: string, step: FlowStep, save: (value: T) => Promise<unknown>) {
  const { reg, saved } = useDraft();
  const entry = useRef<Entry | null>(null);
  const tracked = useCallback((value: T) => {
    const r = reg.current;
    const me = entry.current;
    const p = save(value);
    r.saving.add(p);
    p.then(
      () => { r.saving.delete(p); saved(); },
      (e: unknown) => { r.saving.delete(p); if (r.parts.get(part) !== me) r.leftFailed.push(new DraftPartFailed(part, step, e)); },
    );
    return p;
  }, [reg, saved, save, part, step]);
  const auto = useAutosave(tracked);
  // useAutosave's discard() leaves its state as it was; the state at that moment reads as "saved" until it moves on.
  const [droppedAt, setDroppedAt] = useState<SaveState | null>(null);
  const [changed, setChanged] = useState(false);
  const now = useRef(auto.state);
  now.current = auto.state;
  const { change: send, flush: sendNow, discard: dropValue } = auto;

  const drop = useCallback(() => { dropValue(); setDroppedAt(now.current); setChanged(false); }, [dropValue]);
  const change = useCallback((value: T) => { setDroppedAt(null); setChanged(true); send(value); }, [send]);
  const flush = useCallback(() => { setDroppedAt(null); return sendNow(); }, [sendNow]);

  useEffect(() => {
    const r = reg.current;
    const me: Entry = { step, flush: sendNow, drop };
    entry.current = me;
    r.parts.set(part, me);
    return () => { if (r.parts.get(part) === me) r.parts.delete(part); };
  }, [reg, part, step, sendNow, drop]);

  const state: SaveState = droppedAt !== null && auto.state === droppedAt ? "saved" : auto.state;
  return { state, error: auto.error, changed, change, flush, discard: drop };
}

/** Leaves the current view after every waiting draft change is saved; a refused one keeps the person where they are.
 *  `push` leaves the flow page (a new history entry); a view switch replaces the address. */
export const GoContext = createContext<((href: string, push?: boolean) => void) | null>(null);

/** A link inside the flow page. A plain click saves what is waiting first; a click with a modifier (new tab, new
 *  window) keeps the browser's own behaviour. */
export function FlowLink({ href, push, className, current, label, describedBy, children }: {
  href: string; push?: boolean; className?: string; current?: boolean; label?: string; describedBy?: string; children: React.ReactNode;
}) {
  const go = useContext(GoContext);
  return (
    <Link
      href={href} replace={!push} className={className} aria-current={current ? "page" : undefined} aria-label={label} aria-describedby={describedBy}
      onClick={(e) => {
        if (!go || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(href, push);
      }}
    >
      {children}
    </Link>
  );
}

/** What DraftState reads from a part: any useDraftPart<T>, whatever its T. */
export type DraftPart = Omit<ReturnType<typeof useDraftPart>, "change">;

/** What a draft part's last change came to: "Saving…", "Draft saved", or the refusal with a way on. */
export function DraftState({ part }: { part: DraftPart }) {
  const { bump } = useFlowDraft();
  const failed = part.state === "failed";
  const text = part.state === "saving" ? "Saving…" : failed ? documentRefusalMessage(part.error) : part.changed ? "Draft saved" : "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span aria-live="polite" className={failed ? "text-danger" : "text-ink-muted"}>{text}</span>
      {failed && (
        <>
          <Button size="sm" variant="secondary" onClick={() => { part.flush().catch(() => {}); }}>Try again</Button>
          <Button size="sm" variant="ghost" onClick={() => { part.discard(); bump(); }}>Undo my change</Button>
        </>
      )}
    </div>
  );
}
