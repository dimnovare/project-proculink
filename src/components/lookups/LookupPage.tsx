"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { Quiet } from "@/components/flows/states";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteLookup, getLookup, updateLookup, type Lookup, type LookupCandidate, type LookupEntry } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { saveBlob } from "@/lib/saveBlob";
import { exportLookupCsv, importCandidateCsv, importLookupCsv } from "@/lib/lookupCsv";

const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

function LookupEditor({ lookup }: { lookup: Lookup }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(lookup.name);
  const [entries, setEntries] = useState<LookupEntry[]>(lookup.entries);
  const [candidates, setCandidates] = useState<LookupCandidate[]>(lookup.candidates ?? []);
  const [headings, setHeadings] = useState(true);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: () => updateLookup(lookup.id, { name: name.trim(), entries: entries.filter((e) => e.from.trim() || e.to.trim()),
        ...(lookup.suggestionsOn ? { candidates } : {}),
      }),
    onSuccess: () => {
      setNote({ tone: "success", text: "Saved." });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.invalidateQueries({ queryKey: ["lookup", lookup.id] });
      qc.removeQueries({ queryKey: ["lookup-suggestions"] });
    },
    onError: () => setNote(null),
  });
  const remove = useMutation({
    mutationFn: () => deleteLookup(lookup.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lookups"] });
      router.push("/lookups");
    },
  });

  // Any edit makes "Saved." / the import note stale.
  const edit = (fn: (es: LookupEntry[]) => LookupEntry[]) => {
    setNote(null);
    setEntries(fn);
  };
  const setCell = (i: number, patch: Partial<LookupEntry>) =>
    edit((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // lets the same file be chosen again
    if (!file) return;
    try {
      const r = importLookupCsv(await readText(file), entries, headings);
      setEntries(r.entries);
      setNote({ tone: "success", text: `Imported ${r.added + r.changed} ${r.added + r.changed === 1 ? "row" : "rows"}: ${r.added} new, ${r.changed} changed.` });
    } catch {
      setNote({ tone: "error", text: "We couldn't read that file." });
    }
  };

  const onListFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const list = importCandidateCsv(await readText(file), headings);
      setCandidates(list);
      setNote({ tone: "success", text: `Imported ${list.length === 1 ? "1 value" : `${list.length} values`}.` });
    } catch {
      setNote({ tone: "error", text: "We couldn't read that file." });
    }
  };

  const download = () => saveBlob(new Blob([exportLookupCsv(entries)], { type: "text/csv" }), `${name || "lookup"}.csv`);

  const refusal = save.error ?? remove.error;
  return (
    <PageShell variant="wide">
      <PageHeader titleHidden title={lookup.name} />
      <div className="flex flex-col gap-3">
        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <input className={INPUT} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[13px] font-medium text-ink">
                <span className="mr-2">Import CSV</span>
                <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target)} />
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                <input type="checkbox" checked={headings} onChange={(e) => setHeadings(e.target.checked)} />
                The first row is headings
              </label>
              <Button variant="secondary" size="sm" onClick={download}>Export CSV</Button>
            </div>
            {lookup.suggestionsOn && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <h2 className="text-[13px] font-semibold text-ink">Values to choose from</h2>
                <p className="text-[12px] text-ink-muted">
                  AI suggestions only pick from this list — for example, your supplier&apos;s product list. Column 1 is the value; any other columns describe it.
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="text-ink-muted">
                    {candidates.length === 0 ? "No list yet." : candidates.length === 1 ? "1 value" : `${candidates.length} values`}
                  </span>
                  <label className="font-medium text-ink">
                    <span className="mr-2">Import list (CSV)</span>
                    <input type="file" accept=".csv,text/csv" onChange={(e) => onListFile(e.target)} />
                  </label>
                  {candidates.length > 0 && (
                    <Button variant="secondary" size="sm" onClick={() => { setNote(null); setCandidates([]); }}>Clear list</Button>
                  )}
                </div>
              </div>
            )}
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-muted"><th>From</th><th>To</th><th /></tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td className="pb-1 pr-2"><input aria-label="From" className={INPUT} value={e.from} onChange={(ev) => setCell(i, { from: ev.target.value })} /></td>
                    <td className="pb-1 pr-2"><input aria-label="To" className={INPUT} value={e.to} onChange={(ev) => setCell(i, { to: ev.target.value })} /></td>
                    <td className="pb-1">
                      <Button variant="ghost" size="sm" aria-label="Remove row" onClick={() => edit((es) => es.filter((_, j) => j !== i))}>✕</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => edit((es) => [...es, { from: "", to: "" }])}>Add row</Button>
              <Button variant="primary" size="md" disabled={!name.trim() || save.isPending} onClick={() => { remove.reset(); save.mutate(); }}>Save</Button>
            </div>
          </div>
        </Card>
        {note && <StatusNotice tone={note.tone}>{note.text}</StatusNotice>}
        {refusal && <StatusNotice tone="error">{documentRefusalMessage(refusal)}</StatusNotice>}
        {confirming ? (
          <StatusNotice
            tone="warning"
            action={
              <div className="flex gap-2">
                <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete lookup</Button>
                <Button variant="secondary" size="sm" onClick={() => { remove.reset(); setConfirming(false); }}>Keep it</Button>
              </div>
            }
          >
            {`Delete “${lookup.name}”? This can't be undone.`}
          </StatusNotice>
        ) : (
          <div><Button variant="danger" size="sm" onClick={() => { save.reset(); setConfirming(true); }}>Delete lookup</Button></div>
        )}
      </div>
    </PageShell>
  );
}

export function LookupPage({ lookupId }: { lookupId: string }) {
  const lookup = useQuery({ queryKey: ["lookup", lookupId], queryFn: () => getLookup(lookupId), enabled: useTenantQueriesEnabled() });
  if (lookup.isError) {
    return <PageShell variant="wide"><StatusNotice tone="error">{documentRefusalMessage(lookup.error)}</StatusNotice></PageShell>;
  }
  if (!lookup.data) return <PageShell variant="wide"><Quiet>Loading lookup…</Quiet></PageShell>;
  return <LookupEditor lookup={lookup.data} />;
}
