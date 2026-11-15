"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getDocument, listDestinations, listOutputs, type Destination, type Flow } from "@/lib/api/documents";
import { destinationNameFor, firstRunAddress, foundSummary, keepsSummary } from "@/lib/firstRun";
import { DestinationForm, Field, INPUT } from "./DestinationForm";
import { useRunDocument } from "./CheckStep";
import { useLinkedAccounts } from "./GoogleTargetFields";
import { Failed } from "./states";

type NewTile = "email" | "google_drive" | "google_sheets" | "server" | "s3" | "http";
export type SendChoice =
  | { kind: "download" }
  | { kind: "existing"; destinationId: string | null }
  | { kind: "new"; tile: NewTile };

/** R16: exactly the kinds FlowDestinationService allows, in order; Google only when the server says it is available. */
const TILES: readonly { tile: NewTile; title: string; sub: string; protocols: readonly string[]; google?: true }[] = [
  { tile: "email", title: "Email", sub: "To one or more addresses", protocols: ["email"] },
  { tile: "google_drive", title: "Google Drive", sub: "A folder you choose", protocols: ["google_drive"], google: true },
  { tile: "google_sheets", title: "Google Sheets", sub: "New rows in a sheet", protocols: ["google_sheets"], google: true },
  { tile: "server", title: "SFTP or FTPS", sub: "A folder on a server", protocols: ["sftp", "ftps"] },
  { tile: "s3", title: "S3 bucket", sub: "Amazon S3 or compatible", protocols: ["s3"] },
  { tile: "http", title: "Web address", sub: "Posted to another system", protocols: ["http"] },
];
const WAY_ON = "inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand-blue sm:min-h-0";

function Tile({ id, title, sub, checked, onPick }: { id: string; title: string; sub: string; checked: boolean; onPick(): void }) {
  return (
    <button
      type="button" role="radio" aria-checked={checked} data-testid={`send-tile-${id}`} onClick={onPick}
      className={`grid min-h-[44px] content-start gap-0.5 rounded-card border px-3 py-2.5 text-left ${checked ? "border-navy bg-surface-2" : "border-border bg-surface"}`}
    >
      <span className="text-[14px] font-semibold text-ink">{title}</span>
      <span className="text-[12.5px] text-ink-muted">{sub}</span>
    </button>
  );
}

/** Step 3 of first run: where the file goes, from the kinds the server supports. */
export function SendStep({ flow, docId, first: _first }: { flow: Flow; docId: string | null; first: boolean }) {
  const enabled = useTenantQueriesEnabled();
  const run = useRunDocument(flow.id, docId);
  const id = run.docId ?? "";
  const google = useLinkedAccounts().data?.available === true;
  const outputs = useQuery({ queryKey: ["outputs", flow.id], queryFn: () => listOutputs(flow.id), enabled });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: listDestinations, enabled });
  const doc = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id), enabled: enabled && !!id });
  const output = outputs.data?.[0];
  const [picked, setPicked] = useState<SendChoice | null>(null);
  const [_saved, setSaved] = useState<Destination | null>(null);
  const [_tested, setTested] = useState<{ destinationId: string; ok: boolean } | null>(null);
  // R18: the output's saved destination, else Download.
  const choice: SendChoice = picked ?? (output?.destinationId ? { kind: "existing", destinationId: output.destinationId } : { kind: "download" });
  const pick = (c: SendChoice) => { setPicked(c); setSaved(null); setTested(null); };
  const tile = choice.kind === "new" ? TILES.find((t) => t.tile === choice.tile)! : null;

  const read = doc.data?.read;
  const fileName = run.row?.fileName ?? doc.data?.summary.fileName ?? "";
  const kept = read ? read.fields.filter((f) => flow.fields.fields.some((k) => k.key === f.key)).length : 0;

  return (
    <div className="grid gap-6">
      <Card as="section" aria-label="Finished steps">
        <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{fileName}</span>
          {read && <span className="text-[13px] text-ink-muted">was read: {foundSummary(read)}</span>}
          <Link href={firstRunAddress({ flow: flow.id })} className={WAY_ON}>Use another file</Link>
        </div>
        <div className="grid gap-0.5">
          <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{flow.name}</span>
          {read && <span className="text-[13px] text-ink-muted">{keepsSummary(kept, read.fields.length)}</span>}
          <Link href={firstRunAddress({ step: "check", flow: flow.id, doc: id })} className={WAY_ON}>Change values</Link>
        </div>
        </div>
      </Card>

      <section aria-labelledby="send-where" className="grid gap-3">
        <h2 id="send-where" className="m-0 text-[18px] font-semibold text-ink">Where should the file go?</h2>
        <div role="radiogroup" aria-labelledby="send-where" className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-2">
          <Tile id="download" title="Download" sub="No setup needed" checked={choice.kind === "download"} onPick={() => pick({ kind: "download" })} />
          {TILES.filter((t) => google || !t.google).map((t) => (
            <Tile key={t.tile} id={t.tile} title={t.title} sub={t.sub} checked={tile?.tile === t.tile} onPick={() => pick({ kind: "new", tile: t.tile })} />
          ))}
          {destinations.isError ? <Failed error={destinations.error} retry={() => destinations.refetch()} />
            : !!destinations.data?.length && (
              <Tile
                id="existing" title="Already set up" sub="A destination you saved before" checked={choice.kind === "existing"}
                onPick={() => pick({ kind: "existing", destinationId: choice.kind === "existing" ? choice.destinationId : destinations.data[0].id })}
              />
            )}
        </div>
        {choice.kind === "existing" && !!destinations.data?.length && (
          <div className="max-w-[420px]">
            <Field label="Destination">
              <select className={INPUT} value={choice.destinationId ?? ""} onChange={(e) => pick({ kind: "existing", destinationId: e.target.value })}>
                {destinations.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {tile && (
          <DestinationForm
            key={tile.tile} inline testAfterSave onSaved={setSaved} onCancel={() => pick({ kind: "download" })}
            chosen={{ protocols: tile.protocols, name: destinationNameFor(tile.protocols[0], flow.name), onTested: setTested }}
          />
        )}
      </section>
    </div>
  );
}
