"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { EmptyState } from "@/components/bridge/EmptyState";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import { Quiet } from "@/components/flows/states";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { createLookup, listLookups } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";

export function LookupsHome() {
  const router = useRouter();
  const engine = useDocumentEngine();
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: engine === "on" });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => createLookup(name.trim()),
    onSuccess: (l) => router.push(`/lookups/${l.id}`),
  });
  const startNew = () => setCreating(true);

  let body;
  if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (lookups.isError) {
    body = <StatusNotice tone="error">{documentRefusalMessage(lookups.error)}</StatusNotice>;
  } else if (!lookups.data) {
    body = <Quiet>Loading lookups…</Quiet>;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {creating && (
          <Card dense>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <div className="min-w-[200px] flex-1">
                <Field label="Name">
                  <input className={INPUT} value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="primary" size="md" disabled={!name.trim() || create.isPending}>Create</Button>
            </form>
            {create.isError && <StatusNotice tone="error">{documentRefusalMessage(create.error)}</StatusNotice>}
          </Card>
        )}
        {lookups.data.length === 0 ? (
          !creating && (
            <Card>
              <EmptyState
                compact
                title="No lookups yet"
                sub="Create one, then import its rows from a CSV file."
                action={{ label: "New lookup", onClick: startNew }}
              />
            </Card>
          )
        ) : (
          lookups.data.map((l) => (
            <Link key={l.id} href={`/lookups/${l.id}`} className="block">
              <Card dense>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium" style={{ fontSize: 13.5 }}>{l.name}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{l.count} rows</span>
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        titleHidden
        title="Lookups"
        sub="Tables that swap one value for another, for example your item code for the code a recipient uses."
        actions={engine === "on" ? <Button variant="primary" size="md" onClick={startNew}>New lookup</Button> : undefined}
      />
      {body}
    </PageShell>
  );
}
