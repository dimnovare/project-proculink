"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { INPUT } from "@/components/flows/DestinationForm";
import { Quiet } from "@/components/flows/states";
import { useAutosave } from "@/hooks/useAutosave";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteLookup, getLookup, listFlows, updateLookup, type Lookup, type LookupCandidate } from "@/lib/api/documents";
import { flowAddress } from "@/lib/flowSteps";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";
import { exportLookupCsv } from "@/lib/lookupCsvLeaf";
import { LOOKUP_LIMITS } from "@/lib/lookupLimits";
import { usedByLine } from "@/lib/lookupUses";
import { saveBlob } from "@/lib/saveBlob";
import { ROWS_PER_PAGE, rowsLine, rowsPage, savable, toRows, type LookupRow } from "./lookupRowsModel";
import { dropLookupNotice, importRefusal, showLookupNotice, takeRenameOnOpen } from "./lookupNotice";

type Doc = { name: string; rows: LookupRow[]; candidates: LookupCandidate[] };
const docOf = (l: Lookup): Doc => ({ name: l.name, rows: toRows(l.entries), candidates: l.candidates ?? [] });

/** A server time as a moment in milliseconds: the save answers with 7 fraction digits, a later read the same moment with 6. */
const at = (time: string) => Date.parse(time.replace(/(\.\d{3})\d+/, "$1"));
const TABLE_TYPES = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const PAD = "px-[18px] py-[14px]";
const CELL =
  "h-10 w-full rounded-md border-2 border-transparent bg-transparent px-2 font-mono text-[14px] text-ink focus:border-brand-blue focus:outline-none max-sm:h-11 max-sm:text-base";
import { ICON_BUTTON } from "@/components/flows/DestinationForm";
const TEXT_BUTTON = "min-h-[44px] text-[14px] font-semibold text-brand-blue disabled:cursor-not-allowed disabled:opacity-50";

function LookupEditor({ lookup, lookupId, usedBy }: { lookup: Lookup; lookupId: string; usedBy: string[] | undefined }) {
  const qc = useQueryClient();
  // The update times this screen loaded or produced; any other one is a change made elsewhere (R4).
  const known = useRef(new Set([at(lookup.updatedAt)]));
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateLookup>[1]) => updateLookup(lookupId, body),
    onSuccess: (answer) => {
      known.current.add(at(answer.updatedAt));
      qc.setQueryData(["lookup", lookupId], answer);
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.removeQueries({ queryKey: ["lookup-suggestions"] });
    },
  });
  // From the moment a delete starts nothing is saved for the lookup, not even a value sent on leaving; a refused delete clears it.
  const gone = useRef(false);
  const autosave = useAutosave((body: Parameters<typeof updateLookup>[1]) => (gone.current ? Promise.resolve() : save.mutateAsync(body)));

  const [doc, setDoc] = useState(() => docOf(lookup));
  const current = useRef(doc);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);   // the name field while renaming
  const renaming = useRef(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  const { held } = useMemo(() => savable(doc.rows), [doc.rows]);
  // The workspace switch as the panel opened: a save's answer never takes the section away mid-edit.
  const [suggestionsOn] = useState(lookup.suggestionsOn);
  const bodyOf = (d: Doc) => ({ name: d.name, entries: savable(d.rows).entries, ...(suggestionsOn ? { candidates: d.candidates } : {}) });
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
    if (known.current.has(at(lookup.updatedAt)) || autosave.state !== "saved" || held.size) return;
    known.current.add(at(lookup.updatedAt));
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

  const fileInput = useRef<HTMLInputElement>(null);
  const replace = useMutation({
    // The spreadsheet reader loads when a file is chosen, not with the page.
    mutationFn: async (file: File) => (await import("@/lib/lookupCsv")).lookupFileEntries(file),
    onError: (e, file) => showLookupNotice({ ...importRefusal(file, e), owner: lookupId }),
    onSuccess: (entries, file) => {
      const before = current.current.rows;
      const m = before.length;
      edit({ rows: toRows(entries) }, true);
      setTerm("");
      setPage(1);
      showLookupNotice({
        tone: "success",
        owner: lookupId,
        text: `${file.name} imported. ${entries.length === 1 ? "1 row replaces" : `${entries.length} rows replace`} ${m === 1 ? "the 1 that was here" : `the ${m} that were here`}.`,
        // R3: the previous rows come back on screen at once and are saved through the same queue.
        undo: async () => {
          autosave.change(bodyOf(put({ rows: before })), true);
          await autosave.flush();
          return m === 1 ? "Import undone. The 1 row from before is back." : `Import undone. The ${m} rows from before are back.`;
        },
      });
    },
  });
  useEffect(() => () => dropLookupNotice(lookupId), [lookupId]);

  const [setup, setSetup] = useState(false);
  const [listNote, setListNote] = useState<string | null>(null);
  const onListFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";   // lets the same file be chosen again
    if (!file) return;
    try {
      const list = await (await import("@/lib/lookupCsv")).lookupFileCandidates(file);
      edit({ candidates: list }, true);
      setListNote(`Imported ${list.length === 1 ? "1 value" : `${list.length} values`}.`);
    } catch (e) {
      showLookupNotice({ ...importRefusal(file, e), owner: lookupId });
    }
  };

  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteLookup(lookupId),
    // The rows are about to go: a waiting save is dropped, not sent, and nothing typed meanwhile is sent either.
    // If the delete fails, what is on screen is saved after all.
    onMutate: () => {
      gone.current = true;
      autosave.discard();
    },
    onError: () => {
      gone.current = false;
      autosave.change(bodyOf(current.current), true);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      router.push("/lookups");
    },
  });
  const refused = remove.error
    ? [documentRefusalMessage(remove.error), refusalToken(remove.error) === "lookup_in_use" && usedBy?.length ? usedByLine(usedBy) : null].filter(Boolean).join(" ")
    : null;

  const searching = term.trim() !== "";
  const view = rowsPage(doc.rows, term, page);
  const n = doc.rows.length;
  const full = n >= LOOKUP_LIMITS.rows;
  const used = usedByLine(usedBy);
  const unused = used === "Not used yet.";
  // Only for an unused lookup: one link per flow to its We send step. Loading or failed draws no list.
  const flows = useQuery({ queryKey: ["flows"], queryFn: listFlows, enabled: useTenantQueriesEnabled() && unused });
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
              {unused ? `${used} To use it, open a flow, go to We send, open a file, choose More options and pick this lookup for a column.` : used}
            </p>
          )}
          {unused && !!flows.data?.length && (
            <ul aria-label="Your flows" className="m-0 flex list-none flex-wrap gap-x-4 p-0">
              {flows.data.map((f) => (
                <li key={f.id}><Link href={flowAddress(f.id, "send")} className="inline-flex min-h-[44px] items-center text-[14px] font-semibold">{f.name}</Link></li>
              ))}
            </ul>
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
          <Button variant="secondary" loading={replace.isPending} onClick={() => fileInput.current?.click()}>Replace from a file</Button>
          <Button
            variant="secondary"
            onClick={() => saveBlob(new Blob([exportLookupCsv(savable(doc.rows).entries)], { type: "text/csv" }), `${doc.name}.csv`)}
          >
            Export CSV
          </Button>
          <input
            ref={fileInput}
            type="file"
            hidden
            data-testid="replace-table-input"
            accept={TABLE_TYPES}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) replace.mutate(file);
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
            {full && <span className="text-[13px] text-ink-muted">{`A lookup holds at most ${LOOKUP_LIMITS.rows.toLocaleString("en")} rows.`}</span>}
          </div>
          {view.total > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-muted">{rowsLine(view.page, view.shown.length, view.total, searching)}</span>
              {view.page > 1 && <Button variant="secondary" size="sm" onClick={() => setPage(view.page - 1)}>Previous</Button>}
              {view.page < view.pages && <Button variant="secondary" size="sm" onClick={() => setPage(view.page + 1)}>Next</Button>}
            </div>
          )}
        </div>

        {suggestionsOn && (
          <div className={`flex flex-col items-start gap-2 border-t border-border ${PAD}`}>
            <p className="m-0 text-[13px] text-ink-muted">
              For a value that isn&apos;t in this lookup, AI can suggest a match from a list of your own codes. You accept each one.
            </p>
            <button type="button" aria-expanded={setup} aria-controls="lookup-suggestions" className={TEXT_BUTTON} onClick={() => setSetup(!setup)}>
              Set up suggestions
            </button>
            {setup && (
              <div id="lookup-suggestions" className="flex flex-col gap-2">
                <h3 className="m-0 text-[13px] font-semibold text-ink">Values to choose from</h3>
                <p className="m-0 text-[13px] text-ink-muted">
                  AI suggestions only pick from this list — for example, your supplier&apos;s product list. Column 1 is the value; any other columns describe it.
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="text-ink-muted">
                    {doc.candidates.length === 0 ? "No list yet." : doc.candidates.length === 1 ? "1 value" : `${doc.candidates.length} values`}
                  </span>
                  <label className="font-medium text-ink">
                    <span className="mr-2">Import list (CSV)</span>
                    <input type="file" data-testid="candidate-list-input" accept=".csv,text/csv" onChange={(e) => onListFile(e.target)} />
                  </label>
                  {doc.candidates.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setListNote(null);
                        edit({ candidates: [] }, true);
                      }}
                    >
                      Clear list
                    </Button>
                  )}
                </div>
                {listNote && <p role="status" className="m-0 text-[13px] text-ink-muted">{listNote}</p>}
              </div>
            )}
          </div>
        )}

        <div className={`flex flex-wrap items-center justify-end gap-3 border-t border-border ${PAD}`}>
          {asking ? (
            <>
              <p className="m-0 text-[14px] text-ink">{`Delete “${doc.name}”? This can't be undone.`}</p>
              <Button variant="secondary" className="text-danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete lookup</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  remove.reset();
                  setAsking(false);
                }}
              >
                Keep it
              </Button>
              {refused && <p role="alert" className="m-0 w-full text-right text-[13px] text-danger-text">{refused}</p>}
            </>
          ) : (
            <button type="button" className="min-h-[44px] text-[14px] font-semibold text-danger-text" onClick={() => setAsking(true)}>
              Delete lookup
            </button>
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
