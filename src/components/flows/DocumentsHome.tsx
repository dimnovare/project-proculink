"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listDocuments, type DocumentSummary } from "@/lib/api/documents";
import { apiClient } from "@/lib/api-client";
import { pagePopulation } from "@/components/bridge/orderCountContract";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { DocumentList } from "./DocumentList";
import { Quiet } from "./states";

const FILTERS: { label: string; test: (d: DocumentSummary) => boolean }[] = [
  { label: "All", test: () => true },
  { label: "Needs you", test: (d) => documentStatus(d.status, d.statusReason).needsYou },
  { label: "In progress", test: (d) => documentStatus(d.status, d.statusReason).tone === "working" },
  { label: "Sent", test: (d) => d.status === "sent" },
  { label: "Couldn't send or read", test: (d) => documentStatus(d.status, d.statusReason).tone === "error" },
];

const Retry = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" size="sm" onClick={onClick}>Retry</Button>
);

export function DocumentsHome() {
  const engine = useDocumentEngine();
  const [filter, setFilter] = useState(0);
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const docs = useQuery({
    queryKey: ["documents", { take: 100 }],
    queryFn: () => listDocuments({ take: 100 }),
    enabled: engine === "on",
    refetchInterval: (q) => (q.state.data?.some((d) => documentStatus(d.status, d.statusReason).tone === "working") ? 2000 : false),
  });
  const anyOldOrders = useQuery({
    queryKey: ["archive-any"],
    queryFn: () => apiClient.getOrders({ page: 1, pageSize: 1 }),
    enabled: useTenantQueriesEnabled(),
  });
  const shown = docs.data?.filter(FILTERS[filter].test) ?? [];

  let body;
  if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (flows.isError) {
    body = (
      <StatusNotice tone="error" action={<Retry onClick={() => flows.refetch()} />}>
        {documentRefusalMessage(flows.error)}
      </StatusNotice>
    );
  } else if (engine === "unknown" || !flows.data) {
    body = <Quiet>Loading flows…</Quiet>;
  } else {
    body = (
      <section aria-label="Recent documents" className="flex flex-col gap-3">
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recent documents</h2>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f, i) => (
            <Button
              key={f.label}
              size="sm"
              variant={i === filter ? "primary" : "secondary"}
              aria-pressed={i === filter}
              onClick={() => setFilter(i)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {docs.isError ? (
          <StatusNotice tone="error" action={<Retry onClick={() => docs.refetch()} />}>
            {documentRefusalMessage(docs.error)}
          </StatusNotice>
        ) : !docs.data ? (
          <Quiet>Loading documents…</Quiet>
        ) : shown.length === 0 ? (
          <Quiet>No documents here.</Quiet>
        ) : (
          <Card flush>
            <DocumentList documents={shown} showFlow />
          </Card>
        )}
        {pagePopulation(anyOldOrders.data).rows > 0 && <Link href="/archive" className="text-[13px]">Old orders</Link>}
      </section>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader titleHidden title="Documents" />
      {body}
    </PageShell>
  );
}
