"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AiSuggestion, Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { INPUT } from "@/components/flows/DestinationForm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { addLookupEntry, listLookups, suggestLookupMatches } from "@/lib/api/documents";
import type { LookupMiss, LookupSuggestion } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

const missesByLookup = (misses: LookupMiss[]) =>
  misses.reduce<Record<string, LookupMiss[]>>((by, m) => ((by[m.lookupId] ??= []).push(m), by), {});

const same = (a: LookupSuggestion, b: LookupSuggestion) => a.lookupId === b.lookupId && a.value === b.value;

function SuggestionCard({ s, busy, onAccept, onReject }: {
  s: LookupSuggestion; busy: boolean; onAccept(to: string): void; onReject(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(s.to);
  return (
    <AiSuggestion confidence={s.confidence === null ? null : Math.round(s.confidence * 100)} title={`${s.value} → ${s.to}`}
      description={s.description ?? undefined}
      actions={editing ? (
        <>
          <input aria-label="Swap to" autoFocus className={`${INPUT} min-w-32 flex-1`} value={to} onChange={(e) => setTo(e.target.value)} />
          <Button type="button" size="sm" variant="primary" loading={busy} disabled={!to.trim()} onClick={() => onAccept(to.trim())}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setTo(s.to); }}>Cancel</Button>
        </>
      ) : (
        <>
          <Button type="button" size="sm" variant="primary" loading={busy} onClick={() => onAccept(s.to)}>Accept</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onReject}>Reject</Button>
        </>
      )} />
  );
}

export function LookupMisses({ documentId, outputId, misses, onChanged }: {
  documentId: string; outputId: string; misses: LookupMiss[]; onChanged(): void;
}) {
  const qc = useQueryClient();
  const enabled = useTenantQueriesEnabled();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled });
  // In the query cache, not local state: accepting re-previews, which unmounts this component and must not lose the rest.
  const key = ["lookup-suggestions", documentId, outputId];
  const suggest = useQuery({
    queryKey: key, queryFn: () => suggestLookupMatches(documentId, outputId), enabled: false, staleTime: Infinity, retry: false,
  });
  const drop = (s: LookupSuggestion) => {
    const left = (qc.getQueryData<LookupSuggestion[]>(key) ?? []).filter((x) => !same(x, s));
    if (left.length) qc.setQueryData(key, left);
    else qc.resetQueries({ queryKey: key }); // back to the button, not "No suggestions"
  };
  const suggestions = suggest.data?.filter((s) => misses.some((m) => m.lookupId === s.lookupId && m.value === s.value));
  const accept = useMutation({
    scope: { id: "lookup-entry" },
    mutationFn: ({ s, to }: { s: LookupSuggestion; to: string }) => addLookupEntry(s.lookupId, { from: s.value, to }),
    onSuccess: async (_, { s }) => {
      drop(s);
      await Promise.all([qc.invalidateQueries({ queryKey: ["lookups"] }), qc.invalidateQueries({ queryKey: ["lookup", s.lookupId] })]);
      onChanged();
    },
  });
  const grouped = Object.entries(missesByLookup(misses));
  const canSuggest = grouped.some(([id]) => {
    const l = lookups.data?.find((x) => x.id === id);
    return !!l && l.suggestionsOn && l.hasCandidates;
  });
  return (
    <div className="grid gap-2">
      {grouped.map(([id, rows]) => (
        <p key={id} className="m-0 text-[12px] text-ink-muted">
          Not in “{lookups.data?.find((l) => l.id === id)?.name ?? "this lookup"}”: {rows.map((m) => m.value).join(", ")}.
        </p>
      ))}
      {canSuggest && (
        <div><Button type="button" size="sm" variant="ai" loading={suggest.isFetching} onClick={() => suggest.refetch()}>Suggest matches</Button></div>
      )}
      {suggest.isError && <StatusNotice tone="error">{documentRefusalMessage(suggest.error)}</StatusNotice>}
      {accept.isError && <StatusNotice tone="error">{documentRefusalMessage(accept.error)}</StatusNotice>}
      {suggestions?.length === 0 && <p className="m-0 text-[12px] text-ink-muted">No suggestions for these values.</p>}
      {suggestions?.map((s) => (
        <SuggestionCard key={`${s.lookupId}\u0000${s.value}`} s={s} busy={accept.isPending && !!accept.variables && same(accept.variables.s, s)}
          onAccept={(to) => accept.mutate({ s, to })} onReject={() => { accept.reset(); drop(s); }} />
      ))}
    </div>
  );
}
