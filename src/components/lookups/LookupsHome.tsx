"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Upload } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { ActionBar } from "@/components/bridge/layout/ActionBar";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { Failed, Loading } from "@/components/flows/states";
import { flowsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { createLookup, deleteLookup, getLookup, listLookups } from "@/lib/api/documents";
import { AppNotFound } from "@/components/bridge/AppNotFound";
import { isNotFoundFailure } from "@/lib/apiFailure";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { usedByLine } from "@/lib/lookupUses";
import { LookupPage } from "./LookupPage";
import { importRefusal, LookupNoticeBanner, markNewLookup, showLookupNotice, useLookupStore } from "./lookupNotice";

const rows = (n: number) => (n === 1 ? "1 row" : `${n} rows`);
const PAD = "px-[18px] py-[14px]";
const HINT = "CSV or Excel, with headings in the first row. The first column becomes From, the second becomes To.";

export function LookupsHome({ lookupId }: { lookupId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const engine = useDocumentEngine();
  // Same key and options as useDocumentEngine, so the two share one request.
  const flows = useQuery({ ...flowsQuery, enabled: useTenantQueriesEnabled() });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: engine === "on" });
  // The open lookup's own query (shared with its panel), read here so an unknown id is the not-found page.
  const one = useQuery({ queryKey: ["lookup", lookupId], queryFn: () => getLookup(lookupId!), enabled: engine === "on" && !!lookupId });
  const { newIds } = useLookupStore();
  const fileInput = useRef<HTMLInputElement>(null);

  const importTable = useMutation({
    mutationFn: async (file: File) => {
      const { lookupFileEntries, tableName } = await import("@/lib/lookupCsv");   // the spreadsheet reader loads now
      const entries = await lookupFileEntries(file);
      return { lookup: await createLookup(tableName(file.name), entries), count: entries.length };
    },
    onError: (e, file) => showLookupNotice(importRefusal(file, e)),
    onSuccess: ({ lookup: { id, name }, count }, file) => {
      markNewLookup(id);
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      showLookupNotice({
        tone: "success",
        text: `${file.name} imported. ${rows(count)} saved as a new lookup, named after the file.`,
        undo: async () => {
          await deleteLookup(id);
          void qc.invalidateQueries({ queryKey: ["lookups"] });
          router.push("/lookups");
          return `Import undone. ${name} was deleted.`;
        },
      });
      router.push(`/lookups/${id}`);
    },
  });
  const startNew = useMutation({
    mutationFn: () => createLookup("New lookup"),
    onError: (e) => showLookupNotice({ tone: "error", text: `Couldn't start a new lookup. ${documentRefusalMessage(e)}` }),
    onSuccess: ({ id }) => {
      markNewLookup(id, { rename: true });
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      router.push(`/lookups/${id}`);
    },
  });
  const chooseFile = () => fileInput.current?.click();
  const importButton = (className?: string) => (
    <Button variant="secondary" className={className} loading={importTable.isPending} onClick={chooseFile}>
      <Upload size={16} aria-hidden />
      Import a table
    </Button>
  );

  const current = lookups.data?.find((l) => l.id === lookupId);
  let list;
  if (lookups.isError && !lookups.data) {
    list = <div className={PAD}><Failed error={lookups.error} retry={() => lookups.refetch()} /></div>;
  } else if (!lookups.data) {
    list = <div className={PAD}><Loading>Loading lookups…</Loading></div>;
  } else {
    const n = lookups.data.length;
    list = (
      <>
        <p className={`m-0 text-[13px] text-ink-muted ${PAD}`}>{n === 0 ? "No lookups yet." : n === 1 ? "1 lookup" : `${n} lookups`}</p>
        {lookups.data.map((l) => (
          <Link
            key={l.id}
            href={`/lookups/${l.id}`}
            aria-current={l.id === lookupId ? "page" : undefined}
            className={`flex !min-h-[60px] flex-col justify-center gap-0.5 border-t border-border px-[18px] py-2.5 ${l.id === lookupId ? "bg-surface-2" : ""}`}
          >
            <span className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink [overflow-wrap:anywhere]">
              {l.name}
              {newIds.has(l.id) && <Pill tone="blue">New</Pill>}
            </span>
            <span className="text-[13px] text-ink-muted">
              {[`${rows(l.count)}.`, usedByLine(l.usedBy?.map((u) => u.flowName))].filter(Boolean).join(" ")}
            </span>
          </Link>
        ))}
      </>
    );
  }

  if (lookupId && one.isError && isNotFoundFailure(one.error)) return <AppNotFound />;

  let body;
  if (engine === "off") {
    body = <StatusNotice tone="warning">{documentRefusalMessage(flows.error)}</StatusNotice>;
  } else if (flows.isError && !flows.data) {
    body = <Failed error={flows.error} retry={() => flows.refetch()} />;
  } else {
    body = (
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card flush className={`lg:w-[340px] lg:flex-none${lookupId ? " hidden lg:block" : ""}`}>
          <nav aria-label="All lookups">{list}</nav>
        </Card>
        {lookupId ? (
          <div className="min-w-0 flex-1">
            <Link href="/lookups" className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand-blue lg:hidden">
              <ChevronLeft size={18} aria-hidden />
              All lookups
            </Link>
            <LookupPage lookupId={lookupId} usedBy={current?.usedBy?.map((u) => u.flowName)} />
          </div>
        ) : (
          <Card className="hidden min-w-0 flex-1 lg:block">
            <p className="m-0 text-[14px] text-ink-muted">
              {lookups.data?.length === 0
                ? "Import a table to make your first lookup, or start a new empty one."
                : "Choose a lookup to see its rows."}
            </p>
          </Card>
        )}
      </div>
    );
  }

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Lookups"
        sub="Tables that swap one value for another, for example a supplier's item code for your own."
        actions={engine === "on" ? (
          // A phone with one lookup open shows only that lookup: no header actions, hint or Import bar.
          <div className={`flex-col items-start gap-1 sm:items-end ${lookupId ? "hidden md:flex" : "flex"}`}>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                className="min-h-[44px] text-[14px] font-semibold text-brand-blue"
                disabled={startNew.isPending}
                onClick={() => startNew.mutate()}
              >
                New empty lookup
              </button>
              {importButton("hidden md:inline-flex")}
            </div>
            <p className="m-0 hidden text-[13px] text-ink-muted md:block">{HINT}</p>
            <input
              ref={fileInput}
              type="file"
              hidden
              data-testid="import-table-input"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) importTable.mutate(file);
              }}
            />
          </div>
        ) : undefined}
      />
      <LookupNoticeBanner />
      {body}
      {engine === "on" && !lookupId && (
        <>
          {/* Phones: the hint sits right above the sticky Import, at the foot of the page. */}
          <p className="m-0 mt-4 text-[13px] text-ink-muted md:hidden">{HINT}</p>
          <ActionBar>{importButton()}</ActionBar>
        </>
      )}
    </PageShell>
  );
}
