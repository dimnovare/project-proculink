"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { ApiHttpError } from "@/lib/api/core";
import { downloadDocument, getSortFlows, moveDocument, setUpDocument, type DocumentDetail, type DocumentSummary } from "@/lib/api/documents";
import { COPY, documentRefusalMessage, rateLimited, refusalToken } from "@/lib/documentRefusals";
import { kindWords } from "@/lib/documentKind";
import { firstRunAddress } from "@/lib/firstRun";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { saveBlob } from "@/lib/saveBlob";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { INPUT } from "./DestinationForm";

type Act = "set-up" | "xlsx" | "csv" | { move: string };
const FORMATS = [["xlsx", "Excel"], ["csv", "CSV"]] as const;
const byName = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
/** Someone or something got there first: the screen shows the document as it is now. */
const GONE = new Set(["not_movable", "not_in_inbox"]);
export const CHANGED = "This document changed while you were looking at it. This is how it is now.";
/** A stable ref callback, so focus moves once, when the element appears. */
const focusOnMount = (el: HTMLElement | null) => el?.focus();

/**
 * The three answers' one request at a time, and the flows a document can be moved to. Held by the review screen, so a refusal
 * outlives the panel it came from, and Send, Skip and Review next wait while one runs. `flush` saves a typed correction first.
 */
export function useAnswers(s: DocumentSummary | undefined, { enabled, flush }: { enabled: boolean; flush: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const router = useRouter();
  const flows = useQuery({ ...flowsQuery, enabled });
  // P1: the flows that take this kind come first; if that answer fails, every flow in name order.
  const fits = useQuery({ queryKey: ["sort-flows", s?.id], queryFn: () => getSortFlows(s!.id), enabled: enabled && s?.statusReason === "choose_flow" });
  const fitIds = new Set(fits.data?.map((f) => f.id));
  const list = [...byName(fits.data ?? []), ...byName((flows.data ?? []).filter((f) => !fitIds.has(f.id)))].filter((f) => f.id !== s?.flowId);
  const refresh = (keys: string[][]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  const docKey = ["document", s?.id ?? ""];
  // A 409 that moved the document under us: true once it is shown as it is now; the refusal itself when even that failed.
  const [gone, setGone] = useState<unknown>(null);
  const act = useMutation({
    mutationFn: async (a: Act) => {
      if (!s) return;
      await flush();
      if (a === "set-up") return router.push(firstRunAddress({ step: "send", flow: (await setUpDocument(s.id)).flowId, doc: s.id }));
      if (typeof a === "object") return router.replace(`/flows/${(await moveDocument(s.id, a.move)).flowId}/documents/${s.id}`);
      saveBlob(await downloadDocument(s.id, a), `${s.fileName.replace(/\.[^.]*$/, "")}.${a}`);
    },
    // The answer may hold the document as a duplicate rather than read it again: the refetched document says which.
    onSuccess: (_d, a) => refresh([docKey, ["documents"], ["document-history", s?.id ?? ""], ...(a === "set-up" ? [["flows"]] : [])]),
    onError: async (e) => {
      // A flow or the document went away: the list and the document are read again.
      if (e instanceof ApiHttpError && e.status === 404) await refresh([["flows"], docKey]);
      if (!GONE.has(refusalToken(e) ?? "")) return;
      await refresh([docKey, ["documents"]]);
      setGone(qc.getQueryState(docKey)?.status === "error" ? e : true);
    },
  });
  // A second press before the first re-renders sends nothing (the ref); every answer is disabled from the press on (the state),
  // because the mutation's own pending flag arrives a tick later. Set-up leaves this screen, so it stays pressed.
  const pressed = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  const clear = () => { setGone(null); act.reset(); };
  const press = (a: Act) => {
    if (pressed.current) return;
    pressed.current = true;
    clear();
    setRunning(typeof a === "object" ? "move" : a);
    act.mutate(a, {
      onSettled: (_d, e) => {
        if (a === "set-up" && !e) return;
        pressed.current = false;
        setRunning(null);
        // The pressed download button gets focus back once it is enabled again.
        const word = FORMATS.find(([f]) => f === a)?.[1];
        if (word) setTimeout(() => document.querySelector<HTMLElement>(`button[aria-label="Download what we read as ${word}"]`)?.focus(), 0);
      },
    });
  };
  const refused = GONE.has(refusalToken(act.error) ?? "") ? null : act.error;
  return { list, none: !!flows.data && list.length === 0, flows, press, clear, pending: running, busy: running !== null, error: refused, act: act.variables, gone };
}
export type Answers = ReturnType<typeof useAnswers>;

/** A refusal with its way on; the rate limiter's 429 is shown in its own words. Focus moves to it. */
function Refused({ a }: { a: Answers }) {
  const error = a.error;
  const t = refusalToken(error) ?? "";
  const plan = t === "processing_paused" || t === "flow_limit_reached" || LIMIT_CODES.has(t);
  const download = a.act === "xlsx" || a.act === "csv";
  const text = rateLimited(error) ? (t || (error as Error).message)
    : download && t === "output_invalid" ? "We couldn't make that file. Try the other format."
    : a.act === "set-up" && t === "invalid_name" ? COPY.invalid_fields
    : documentRefusalMessage(error);
  return (
    <div ref={focusOnMount} tabIndex={-1} className="outline-none">
      <StatusNotice tone="error" action={plan && <Link href="/settings?tab=billing" className={buttonClass("secondary", "sm")}>Open Plan &amp; billing</Link>}>
        {text}
      </StatusNotice>
    </div>
  );
}

/** Drawn by the review screen above its content: the document changed under a press. */
export const Changed = ({ a }: { a: Answers }) => a.gone ? (
  <div ref={focusOnMount} tabIndex={-1} className="outline-none">
    <StatusNotice tone="warning">{a.gone === true ? CHANGED : documentRefusalMessage(a.gone)}</StatusNotice>
  </div>
) : null;

function MoveTo({ a, label, filled }: { a: Answers; label: string; filled: boolean }) {
  const [to, setTo] = useState("");
  const id = useId();
  // A list with only "Choose a flow" would read as "you have no flow".
  if (a.flows.isError && !a.flows.data) return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[14px] text-ink">We couldn&apos;t load your flows.</span>
      <Button size="sm" variant="secondary" loading={a.flows.isFetching} onClick={() => a.flows.refetch()}>Try again</Button>
    </div>
  );
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">{label}</label>
      <div className="flex flex-wrap gap-2">
        <select id={id} className={`${INPUT} min-h-[44px] w-auto min-w-[180px] flex-1`} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="" disabled>Choose a flow</option>
          {a.list.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <Button variant={filled ? "primary" : "secondary"} disabled={!to || a.busy} loading={a.pending === "move"} onClick={() => a.press({ move: to })}>Move it</Button>
      </div>
      {!to && <p className="m-0 text-[12.5px] text-ink-muted">Choose a flow first.</p>}
    </div>
  );
}

const Downloads = ({ a }: { a: Answers }) => (
  <div className="flex gap-2">
    {FORMATS.map(([f, word]) => (
      <Button key={f} aria-label={`Download what we read as ${word}`} disabled={a.busy} loading={a.pending === f} onClick={() => a.press(f)}>{word}</Button>
    ))}
  </div>
);

/** Task 6: a document in the workspace's inbox, and what a person can do with it. */
export function InboxAnswers({ detail, a }: { detail: DocumentDetail; a: Answers }) {
  const { status, statusReason } = detail.summary;
  const k = detail.read.kindLabel?.trim();
  const kind = k && /[\p{L}\p{N}]/u.test(k) ? kindWords(k) : null;
  const several = statusReason === "choose_flow";
  const rows: [string, string, ReactNode][] = [
    ["Do the same every time", "Choose once where documents like this go. The next one is read and handled by itself.",
      <Button variant={several ? "secondary" : "primary"} disabled={a.busy} loading={a.pending === "set-up"} onClick={() => a.press("set-up")}>Set it up</Button>],
    ["Just this one", "Download what we read. Nothing is set up, and nothing is sent anywhere.", <Downloads a={a} />],
  ];
  // With no flow at all there is nothing to move it to. Several flows fit: moving it is the first answer.
  const move: [string, string, ReactNode] = ["It belongs with one you already have", "Handle it like the documents of another flow.", <MoveTo a={a} label="Flow it belongs with" filled={several} />];
  if (!a.none) { if (several) rows.unshift(move); else rows.push(move); }
  const [title, helper] = several
    ? [`Which flow does this ${kind ?? "document"} belong with?`, "More than one of your flows takes documents like this. Choose the one this belongs with."]
    : [kind ? `This is the first ${kind} here.` : "This is the first document like this here.", "We read it without any setup. What would you like to do with documents like this?"];
  return (
    <Card edge="none" as="section" aria-label="What to do with it" className="grid gap-4 max-lg:order-first">
      {status === "sent" ? (
        <div className="grid gap-3">
          <p className="m-0 text-[14px] text-ink">You downloaded what we read. Nothing was set up or sent.</p>
          <Downloads a={a} />
        </div>
      ) : (
        <>
          <div className="grid gap-1">
            <h2 className="m-0 font-display text-[24px] font-semibold text-ink">{title}</h2>
            <p className="m-0 text-[14px] text-ink-muted">{helper}</p>
          </div>
          {rows.map(([name, help, action], i) => (
            <div key={name} className={`grid gap-3 rounded-card p-3 ${i === 0 ? "border-2 border-navy" : "border border-border"}`}>
              <div className="grid gap-0.5">
                <h3 className="m-0 text-[14px] font-semibold text-ink">{name}</h3>
                <p className="m-0 text-[13px] text-ink-muted">{help}</p>
              </div>
              {action}
            </div>
          ))}
        </>
      )}
      {a.error && <Refused a={a} />}
    </Card>
  );
}

/** Task 7: a sort we were not sure of. Send stays the filled button, and sending confirms the sort. */
export function SortNotice({ detail, a }: { detail: DocumentDetail; a: Answers }) {
  return (
    <div className="grid gap-2">
      <StatusNotice tone="warning" action={!a.none && <MoveTo a={a} label="Another flow" filled={false} />}>
        {`We put this with ${detail.summary.flowName}. Check that is right.`}
      </StatusNotice>
      {a.error && <Refused a={a} />}
    </div>
  );
}
