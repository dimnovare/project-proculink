"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { INPUT } from "@/components/flows/DestinationForm";
import { Quiet } from "@/components/flows/states";
import { useAutosave } from "@/hooks/useAutosave";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getLookup, updateLookup, type Lookup, type LookupCandidate } from "@/lib/api/documents";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { LOOKUP_LIMITS } from "@/lib/lookupLimits";
import { usedByLine } from "@/lib/lookupUses";
import { ROWS_PER_PAGE, rowsLine, rowsPage, savable, toRows, type LookupRow } from "./lookupRowsModel";
import { showLookupNotice, takeRenameOnOpen } from "./lookupNotice";

type Doc = { name: string; rows: LookupRow[]; candidates: LookupCandidate[] };
const docOf = (l: Lookup): Doc => ({ name: l.name, rows: toRows(l.entries), candidates: l.candidates ?? [] });

const PAD = "px-[18px] py-[14px]";
const CELL =
  "h-10 w-full rounded-md border-2 border-transparent bg-transparent px-2 font-mono text-[14px] text-ink focus:border-brand-blue focus:outline-none max-sm:h-11 max-sm:text-base";
const ICON_BUTTON = "inline-flex h-10 w-10 flex-none items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink max-sm:h-11 max-sm:w-11";
const TEXT_BUTTON = "min-h-[44px] text-[14px] font-semibold text-brand-blue disabled:cursor-not-allowed disabled:opacity-50";

function LookupEditor({ lookup, lookupId, usedBy }: { lookup: Lookup; lookupId: string; usedBy: string[] | undefined }) {
  const qc = useQueryClient();
  // The update times this screen loaded or produced; any other one is a change made elsewhere (R4).
  const known = useRef(new Set([lookup.updatedAt]));
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateLookup>[1]) => updateLookup(lookupId, body),
    onSuccess: (answer) => {
      known.current.add(answer.updatedAt);
      qc.setQueryData(["lookup", lookupId], answer);
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.removeQueries({ queryKey: ["lookup-suggestions"] });
    },
  });
  const autosave = useAutosave(save.mutateAsync);

  const [doc, setDoc] = useState(() => docOf(lookup));
  const current = useRef(doc);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);   // the name field while renaming
  const renaming = useRef(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  const { held } = useMemo(() => savable(doc.rows), [doc.rows]);
  const bodyOf = (d: Doc) => ({ name: d.name, entries: savable(d.rows).entries, ...(lookup.suggestionsOn ? { candidates: d.candidates } : {}) });
  const put = (next: Partial<Doc>) => {
    const d = { ...current.current, ...next };
    current.current = d;
    setDoc(d);
    return d;
  };
  /** Every edit: the page changes, the import notice goes, and the whole table is queued to save. */
  const edit = (next: Partial<Doc>, now = false) => {
    showLookupNotice(null);
    autosave.change(bodyOf(put(next)), now);
  };
  const setCell = (key: number, field: "from" | "to", value: string) =>
    edit({ rows: current.current.rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)) });

  // R4: a newer table saved elsewhere replaces this one, but only while nothing typed here is unsaved.
  useEffect(() => {
    if (known.current.has(lookup.updatedAt) || autosave.state !== "saved" || held.size) return;
    known.current.add(lookup.updatedAt);
    const d = docOf(lookup);
    current.current = d;
    setDoc(d);
  }, [lookup, autosave.state, held.size]);

  useEffect(() => {
    if (!takeRenameOnOpen(lookupId)) return;
    renaming.current = true;
    setDraft(current.current.name);
  }, [lookupId]);

  const startRename = () => {
    renaming.current = true;
    setDraft(doc.name);
  };
  const confirmRename = (value: string) => {
    if (!renaming.current || !value.trim()) return;
    renaming.current = false;
    setDraft(null);
    if (value.trim() !== current.current.name) edit({ name: value.trim() }, true);
  };
  const cancelRename = () => {
    renaming.current = false;
    setDraft(null);
  };

  const addRow = () => {
    const rows = current.current.rows;
    const key = rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
    showLookupNotice(null);
    put({ rows: [...rows, { key, from: "", to: "" }] });   // a blank row changes nothing that is saved
    setTerm("");
    setPage(Math.ceil((rows.length + 1) / ROWS_PER_PAGE));
    setFocusKey(key);
  };

  const searching = term.trim() !== "";
  const view = rowsPage(doc.rows, term, page);
  const n = doc.rows.length;
  const full = n >= LOOKUP_LIMITS.rows;
  const used = usedByLine(usedBy);
  const failure = autosave.error && refusalToken(autosave.error) ? documentRefusalMessage(autosave.error) : "Your changes are kept on this page.";

  return (
    <Card flush>
      <section aria-labelledby="lookup-name">
        <div className={`flex flex-col gap-1 ${PAD}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {draft === null ? (
              <div className="flex min-w-0 items-center gap-1">
                <h2 id="lookup-name" className="m-0 text-[18px] font-semibold text-ink [overflow-wrap:anywhere]">{doc.name}</h2>
                <button type="button" aria-label="Rename this lookup" className={ICON_BUTTON} onClick={startRename}>
                  <Pencil size={16} aria-hidden />
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id="lookup-name" className="sr-only">{doc.name}</h2>
                <input
                  aria-label="Lookup name"
                  autoFocus
                  className={`${INPUT} max-w-[340px] max-sm:h-11 max-sm:text-base`}
                  maxLength={LOOKUP_LIMITS.nameLength}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={(e) => confirmRename(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmRename(e.currentTarget.value);
                    if (e.key === "Escape") cancelRename();
                  }}
                />
                {!draft.trim() && <p className="m-0 text-[13px] text-danger-text">A lookup needs a name.</p>}
              </div>
            )}
            <p role="status" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              {autosave.state === "saving" && <span>Saving…</span>}
              {autosave.state === "saved" && (held.size ? (
                <span className="text-amber-text">{`Saved, except ${held.size} ${held.size === 1 ? "row" : "rows"}`}</span>
              ) : (
                <>
                  <Check size={14} aria-hidden className="text-brand-green-deep" />
                  <span>Saved, edits save as you type</span>
                </>
              ))}
              {autosave.state === "failed" && (
                <>
                  <span role="alert" className="text-danger-text">{`Couldn't save. ${failure}`}</span>
                  <Button variant="ghost" size="sm" onClick={() => void autosave.flush()}>Try again</Button>
                </>
              )}
            </p>
          </div>
          {used && (
            <p className="m-0 text-[13px] text-ink-muted">
              {used === "Not used yet." ? `${used} To use it, open a flow's output and pick this lookup for a column.` : used}
            </p>
          )}
        </div>

        <div className={`flex flex-wrap items-center gap-3 border-t border-border ${PAD}`}>
          <input
            type="search"
            aria-label="Search rows"
            placeholder={n === 1 ? "Search 1 row" : `Search ${n} rows`}
            className={`${INPUT} max-w-[340px] max-sm:h-11 max-sm:text-base`}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {view.total > 0 ? (
          <table aria-label={`Rows of ${doc.name}`} className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-t border-border text-left">
                {[["From", "the value on the document"], ["To", "the value we send"]].map(([head, sub]) => (
                  <th key={head} scope="col" className="px-[18px] py-2 align-bottom font-normal">
                    <span className="block text-[13px] font-semibold text-ink">{head}</span>
                    <span className="block text-[13px] text-ink-muted">{sub}</span>
                  </th>
                ))}
                <td className="w-14" />
              </tr>
            </thead>
            <tbody>
              {view.shown.map((r) => {
                const i = doc.rows.indexOf(r) + 1;
                const from = r.from.trim();
                const note = held.get(r.key);
                return (
                  <Fragment key={r.key}>
                  <tr className="border-t border-border">
                    <td className="px-[10px] py-1 align-top">
                      <input
                        aria-label={`From value, row ${i}`}
                        aria-describedby={note ? `held-${r.key}` : undefined}
                        autoFocus={r.key === focusKey}
                        className={CELL}
                        maxLength={LOOKUP_LIMITS.valueLength}
                        value={r.from}
                        onChange={(e) => setCell(r.key, "from", e.target.value)}
                        onBlur={() => {
                          setFocusKey(null);
                          void autosave.flush();
                        }}
                      />
                    </td>
                    <td className="px-[10px] py-1 align-top">
                      <input
                        aria-label={from ? `To value for ${from}` : `To value, row ${i}`}
                        className={CELL}
                        maxLength={LOOKUP_LIMITS.valueLength}
                        value={r.to}
                        onChange={(e) => setCell(r.key, "to", e.target.value)}
                        onBlur={() => void autosave.flush()}
                      />
                    </td>
                    <td className="py-1 pr-[10px] align-top">
                      <button
                        type="button"
                        aria-label={from ? `Remove row ${from}` : `Remove row ${i}`}
                        className={ICON_BUTTON}
                        onClick={() => edit({ rows: current.current.rows.filter((x) => x.key !== r.key) }, true)}
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </td>
                  </tr>
                  {note && (
                    <tr>
                      <td colSpan={3} className="px-[18px] pb-2">
                        <p id={`held-${r.key}`} className="m-0 text-[13px] text-amber-text">{note}</p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className={`m-0 border-t border-border text-[14px] text-ink-muted ${PAD}`}>
            {n === 0 ? "No rows yet. Add a row, or replace from a file." : `No rows match “${term}”.`}
          </p>
        )}

        <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border ${PAD}`}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={TEXT_BUTTON} disabled={full} onClick={addRow}>Add a row</button>
            {full && <span className="text-[13px] text-ink-muted">A lookup holds at most 20,000 rows.</span>}
          </div>
          {view.total > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-muted">{rowsLine(view.page, view.shown.length, view.total, searching)}</span>
              {view.page > 1 && <Button variant="secondary" size="sm" onClick={() => setPage(view.page - 1)}>Previous</Button>}
              {view.page < view.pages && <Button variant="secondary" size="sm" onClick={() => setPage(view.page + 1)}>Next</Button>}
            </div>
          )}
        </div>
      </section>
    </Card>
  );
}

function LookupPanel({ lookupId, usedBy }: { lookupId: string; usedBy: string[] | undefined }) {
  // "always": the rows edited here come from a fetch made after the panel opened, never from a cached copy (R4).
  const query = useQuery({ queryKey: ["lookup", lookupId], queryFn: () => getLookup(lookupId), enabled: useTenantQueriesEnabled(), refetchOnMount: "always" });
  const [opened, setOpened] = useState(false);
  if (!opened && query.isSuccess && query.isFetchedAfterMount) setOpened(true);
  if (opened && query.data) return <LookupEditor lookup={query.data} lookupId={lookupId} usedBy={usedBy} />;
  if (query.isError) return <StatusNotice tone="error">{documentRefusalMessage(query.error)}</StatusNotice>;
  return <Quiet>Loading lookup…</Quiet>;
}

/** `usedBy`: the flow names from the list's summary; undefined while not known. */
export function LookupPage({ lookupId, usedBy }: { lookupId: string; usedBy: string[] | undefined }) {
  // One editor per lookup: opening another one starts from its own rows, and the last one's waiting save is still sent.
  return <LookupPanel key={lookupId} lookupId={lookupId} usedBy={usedBy} />;
}
