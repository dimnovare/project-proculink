"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listFlows, listDocuments, type DocumentSummary } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { documentStatus } from "@/lib/documentStatusManifest";
import { DocumentList } from "./DocumentList";

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

const Quiet = ({ children }: { children: string }) => (
  <p role="status" style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>{children}</p>
);

export function FlowsHome() {
  const router = useRouter();
  const engine = useDocumentEngine();
  const [filter, setFilter] = useState(0);
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({
    queryKey: ["flows"],
    queryFn: listFlows,
    enabled: useTenantQueriesEnabled(),
    retry: false,
    staleTime: 300_000,
  });
  const docs = useQuery({
    queryKey: ["documents", { take: 100 }],
    queryFn: () => listDocuments({ take: 100 }),
    enabled: engine === "on",
  });
  const newFlow = () => router.push("/flows/new");
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
      <div className="flex flex-col gap-6">
        <section aria-label="Flows" className="flex flex-col gap-2">
          {flows.data.length === 0 ? (
            <Card>
              <EmptyState
                compact
                title="Set up your first flow"
                sub="A flow tells us what to read from your documents and where to send it."
                action={{ label: "New flow", onClick: newFlow }}
              />
            </Card>
          ) : (
            flows.data.map((f) => (
              <Link key={f.id} href={`/flows/${f.id}`} className="block">
                <Card dense>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium" style={{ fontSize: 13.5 }}>{f.name}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                      {f.documentCount} {f.documentCount === 1 ? "document" : "documents"} ·{" "}
                      {f.automation === "auto" ? "Sends automatically" : "Review first"}
                    </span>
                  </div>
                </Card>
              </Link>
            ))
          )}
        </section>
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
        </section>
      </div>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        titleHidden
        title="Flows"
        actions={engine === "on" ? <Button variant="primary" size="md" onClick={newFlow}>New flow</Button> : undefined}
      />
      {body}
    </PageShell>
  );
}
