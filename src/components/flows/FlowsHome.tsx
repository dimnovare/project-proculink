"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button } from "@/components/bridge/DSPrimitives";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { deliveryModeLabel } from "@/lib/deliveryMode";
import { FirstFlowEmpty, Quiet } from "./states";

const Retry = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" size="sm" onClick={onClick}>Retry</Button>
);

export function FlowsHome() {
  const router = useRouter();
  const engine = useDocumentEngine();
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const newFlow = () => router.push("/flows/new");

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
            <FirstFlowEmpty />
          ) : (
            flows.data.map((f) => (
              <Link key={f.id} href={`/flows/${f.id}`} className="block">
                <Card dense>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium" style={{ fontSize: 13.5 }}>{f.name}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                      {f.documentCount} {f.documentCount === 1 ? "document" : "documents"} ·{" "}
                      {deliveryModeLabel(f.automation === "auto")}
                    </span>
                  </div>
                </Card>
              </Link>
            ))
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
