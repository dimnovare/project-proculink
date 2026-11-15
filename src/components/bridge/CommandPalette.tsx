"use client";

// CommandPalette — Ctrl/Cmd K: one search over documents (the server's, by file name or number), flows and
// lookups (filtered here from the lists the app already holds) and actions (plan 14.10 R1 to R8). Wired into
// BridgeTopbar, which opens it from the search button, the shortcut and openSearch().

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, Keyboard, LifeBuoy, Plus, Search, Settings, Table2, Upload, Workflow } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { flowsQuery } from "@/hooks/useDocumentEngine";
import { useApple } from "@/hooks/useShortcut";
import { isChord } from "@/lib/shortcuts";
import { listDocumentPage, listLookups, type DocumentRow, type Flow, type LookupSummary } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { documentHref } from "@/lib/reviewQueue";
import { pageTotal } from "@/lib/pageTotal";
import { rowNeed } from "@/components/flows/DocumentList";
import { Pill } from "./DSPrimitives";
import { buildMapperCommands, dispatchMapper } from "./mapper/mapperCommands";

const NAME = "Search documents, flows, lookups and actions";
/** R5: the same pause as Activity's search. */
const PAUSE_MS = 300;
/** R7: the first three actions show with or without a term. */
const ALWAYS = 3;
/** R3/R4: at most this many of each. */
const SHOWN = 5;
type Source = "documents" | "flows" | "lookups";
const FAILED: Record<Source, string> = {
  documents: "Documents couldn't be searched.", flows: "Flows couldn't be searched.", lookups: "Lookups couldn't be searched.",
};

/** Exported for its test: what each source answered for the term on screen. */
export function usePaletteSearch(text: string) {
  const enabled = useTenantQueriesEnabled();
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), PAUSE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const flowsQ = useQuery({ ...flowsQuery, enabled });
  const off = refusalToken(flowsQ.error) === "document_engine_not_enabled";
  // No placeholderData: while a term's answer is out, the previous term's rows are never drawn (R6).
  const docsQ = useQuery({
    queryKey: ["documents", "search", term], queryFn: () => listDocumentPage({ q: term, page: 1, pageSize: SHOWN }),
    enabled: enabled && !off && term !== "",
  });
  const lookupsQ = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: enabled && !off });
  const asked = text.trim() === term && term !== "" && !off;
  const queries = { documents: docsQ, flows: flowsQ, lookups: lookupsQ };
  const failed = asked ? (Object.keys(queries) as Source[]).filter((k) => queries[k].isError && !queries[k].data) : [];
  const named = <X extends { name: string }>(xs: X[] | undefined) =>
    asked && xs ? xs.filter((x) => x.name.toLowerCase().includes(term.toLowerCase())).slice(0, SHOWN) : null;
  const documents = asked && docsQ.data ? { rows: docsQ.data.items, total: pageTotal(docsQ.data) } : null;
  const flows = named<Flow>(flowsQ.data);
  const lookups = named<LookupSummary>(lookupsQ.data);
  const pending = text.trim() !== term || (asked && Object.values(queries).some((q) => !q.data && !q.isError));
  return {
    term, pending, documents, flows, lookups, failed,
    retry: (source: Source) => void queries[source].refetch(),
    // Only answers count: a source still out or failed is null here, never an empty list.
    allEmpty: asked && documents?.rows.length === 0 && flows?.length === 0 && lookups?.length === 0,
    /** The engine is off for this workspace: the words Documents already uses. */
    refused: off ? documentRefusalMessage(flowsQ.error) : null,
  };
}

/** `found`: a document, flow or lookup the term found, whose matched part is drawn bold. */
interface Option { id: string; label: string; found?: true; sub?: string; tag?: ReturnType<typeof rowNeed>; icon: ReactNode; href?: string; run?: () => void }
const icon = (I: typeof Upload) => <I size={17} strokeWidth={1.9} aria-hidden className="shrink-0 text-ink-muted" />;
const KEY = "inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-[5px] border border-b-2 border-border-strong bg-surface px-1.5 font-mono text-[12.5px] text-ink";
const count = (n: number, one: string, many: string, none: string) => (n === 0 ? none : n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The part of `text` the term matched, in bold (R26: bold, not tinted). */
function Marked({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<strong>{text.slice(at, at + term.length)}</strong>{text.slice(at + term.length)}</>;
}

export function CommandPalette({ onClose, onShortcuts }: { onClose: () => void; onShortcuts: () => void }) {
  const router = useRouter();
  const apple = useApple();
  const panelRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const s = usePaletteSearch(text);
  const typed = text.trim().toLowerCase();

  // R7: three actions always, the rest only when they match. Every address is a literal (the link guards read them).
  const actions: Option[] = [
    { id: "upload", label: "Upload a document", href: "/upload", icon: icon(Upload) },
    { id: "new-flow", label: "New flow", href: "/flows/new", icon: icon(Plus) },
    { id: "activity", label: "Open Activity", href: "/operations/log", icon: icon(Activity) },
    { id: "shortcuts", label: "Keyboard shortcuts", run: onShortcuts, icon: icon(Keyboard) },
    { id: "settings", label: "Settings", href: "/settings", icon: icon(Settings) },
    { id: "help", label: "Open help", href: "/help", icon: icon(LifeBuoy) },
    ...buildMapperCommands(dispatchMapper).map((c) => ({
      id: c.id, label: c.label, run: c.run, icon: <span aria-hidden className="w-[17px] shrink-0 text-center text-ink-muted">{c.icon}</span>,
    })),
  ].filter((a, i) => (typed ? a.label.toLowerCase().includes(typed) : i < ALWAYS));

  const groups: { heading: string; options: Option[] }[] = [];
  if (s.documents?.rows.length) {
    const { rows, total } = s.documents;
    groups.push({
      heading: total !== undefined && total > rows.length ? `Documents, the newest ${rows.length} of ${total}` : "Documents",
      options: rows.map((d: DocumentRow) => ({
        id: `doc-${d.id}`, found: true, label: d.fileName, href: documentHref(d), icon: icon(FileText), tag: rowNeed(d),
        sub: d.sender ? `From ${d.sender}, in ${d.flowName}` : `In ${d.flowName}`,
      })),
    });
  }
  if (s.flows?.length) groups.push({ heading: "Flows", options: s.flows.map((f) => ({
    id: `flow-${f.id}`, found: true, label: f.name, href: `/flows/${f.id}`, icon: icon(Workflow), sub: count(f.documentCount, "document", "documents", "No documents yet"),
  })) });
  if (s.lookups?.length) groups.push({ heading: "Lookups", options: s.lookups.map((l) => ({
    id: `lookup-${l.id}`, found: true, label: l.name, href: `/lookups/${l.id}`, icon: icon(Table2), sub: count(l.count, "row", "rows", "No rows yet"),
  })) });
  if (actions.length) groups.push({ heading: "Actions", options: actions });
  const options = groups.flatMap((g) => g.options);
  const current = Math.min(active, options.length - 1);
  const activeId = current >= 0 ? `palette-${options[current].id}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  // Escape, the Tab trap, focus back to what opened it, the scroll lock: the one dialog contract. The input focuses itself.
  useDialogA11y({ open: true, onClose, panelRef, autoFocus: false });

  const run = (o: Option) => {
    onClose();
    if (o.run) o.run();
    else if (o.href) router.push(o.href);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isChord(e.nativeEvent, "search", apple)) { e.preventDefault(); onClose(); return; }   // R11: Ctrl K closes it
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, Math.min(current + (e.key === "ArrowDown" ? 1 : -1), options.length - 1)));
    } else if (e.key === "Enter" && current >= 0) {
      e.preventDefault();
      run(options[current]);
    }
  };

  const status = s.refused
    ?? (s.pending && typed ? "Searching…" : s.allEmpty && !actions.length ? `Nothing found for “${s.term}”.` : "");
  let index = 0;

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-modal bg-navy/40" onClick={onClose} />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-label={NAME}
        className="fixed left-1/2 top-[12vh] z-modal w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-card-lg border border-border-strong bg-surface text-ink shadow-xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={18} strokeWidth={1.9} aria-hidden className="shrink-0 text-ink-muted" />
          <input
            autoFocus value={text} placeholder="Search by name or number"
            onChange={(e) => { setText(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
            role="combobox" aria-label="Search" aria-autocomplete="list" aria-expanded={options.length > 0}
            aria-controls="palette-listbox" aria-activedescendant={activeId}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-faint"
          />
          <kbd className={`${KEY} hidden sm:inline-flex`}>Esc</kbd>
        </div>
        <div role="status" className="px-4 text-[13.5px] text-ink-muted [&:not(:empty)]:py-3">{status}</div>
        {s.failed.length > 0 && (
          <div role="alert" className="px-4 pb-2 text-[13.5px] text-ink">
            {s.failed.map((f) => (
              <p key={f} className="flex min-h-11 items-center gap-3">
                {FAILED[f]}
                <button type="button" onClick={() => s.retry(f)} className="font-semibold text-brand-blue-deep underline">Try again</button>
              </p>
            ))}
          </div>
        )}
        {options.length > 0 && (
          <div id="palette-listbox" role="listbox" aria-label="Results" className="max-h-[min(420px,60vh)] overflow-y-auto px-1.5 pb-1.5">
            {groups.map((g) => (
              <div key={g.heading} role="group" aria-label={g.heading}>
                <div aria-hidden className="px-2.5 pb-1 pt-2.5 text-[12.5px] font-semibold text-ink-muted">{g.heading}</div>
                {g.options.map((o) => {
                  const i = index++;
                  const id = `palette-${o.id}`;
                  const on = i === current;
                  const described = [o.sub && `${id}-d`, o.tag && `${id}-t`].filter(Boolean).join(" ") || undefined;
                  const body = (
                    <>
                      {o.icon}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px]"><Marked text={o.label} term={o.found ? s.term : ""} /></span>
                        {o.sub && <span id={`${id}-d`} className="truncate text-[12.5px] text-ink-muted">{o.sub}</span>}
                      </span>
                      {o.tag && <Pill tone={o.tag.tone}><span id={`${id}-t`}>{o.tag.text}</span></Pill>}
                      {on && <kbd aria-hidden className={`${KEY} hidden sm:inline-flex`}>Enter</kbd>}
                    </>
                  );
                  const props = {
                    id, role: "option", "aria-selected": on, "aria-label": o.label, "aria-describedby": described, tabIndex: -1,
                    onMouseMove: () => setActive(i),
                    className: `flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-1 text-left text-ink no-underline ${on ? "bg-brand-blue-soft" : ""}`,
                  } as const;
                  // A result with an address is a real link, so a middle click and "open in a new tab" work.
                  return o.href ? (
                    <Link key={o.id} href={o.href} {...props}
                      onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) onClose(); }}>{body}</Link>
                  ) : (
                    <button key={o.id} type="button" {...props} onClick={() => run(o)}>{body}</button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div className="hidden flex-wrap items-center gap-x-[22px] gap-y-1.5 border-t border-border bg-bg px-[18px] py-2.5 text-[12.5px] text-ink-muted sm:flex">
          <span className="inline-flex items-center gap-1.5"><kbd className={KEY}>Enter</kbd> to open</span>
          <span className="inline-flex items-center gap-1.5"><kbd className={KEY}>Up and down arrows</kbd> to move</span>
          <span className="inline-flex items-center gap-1.5"><kbd className={KEY}>Esc</kbd> to close</span>
        </div>
      </div>
    </>
  );
}
