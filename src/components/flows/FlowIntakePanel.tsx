"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton } from "@/components/bridge/CopyButton";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useConfirm } from "@/components/ui/confirm";
import { inboxQuery } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  createIntake, deleteIntake, flowApiEndpoint, listIntakes, newIntakeAddress, testIntake, updateIntake,
} from "@/lib/api/documents";
import type { Flow, FlowIntake, IntakeRequest } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { kindsLine } from "@/lib/fileKinds";
import { flowAddress } from "@/lib/flowSteps";
import { Field, INPUT } from "./DestinationForm";
import { PICKUP_KINDS, PickupForm } from "./PickupForm";
import { Failed, Quiet } from "./states";

/** One mutation shape for every action here: run it, refresh the list, say what the server refused. */
function useRun(flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intakes", flowId] }),
  });
}
type Run = ReturnType<typeof useRun>;

const Refused = ({ run }: { run: Run }) =>
  run.isError ? <StatusNotice tone="error">{documentRefusalMessage(run.error)}</StatusNotice> : null;

/** Only the two statuses the worker writes get a tone; anything else is printed plain. A toned run needs the person. */
const runTone = (i: FlowIntake) => (i.lastStatus === "paused" ? "warning" : i.lastStatus === "failed" ? "error" : null);
function LastRun({ intake }: { intake: FlowIntake }) {
  if (!intake.lastMessage) return null;
  const tone = runTone(intake);
  return tone ? <StatusNotice tone={tone}>{intake.lastMessage}</StatusNotice>
    : <p className="m-0 text-[12.5px] text-ink-muted">{intake.lastMessage}</p>;
}

const request = (i: FlowIntake, enabled: boolean): IntakeRequest => ({ kind: i.kind, config: i.config, credentials: null, enabled });

function OnOff({ intake, flowId, run }: { intake: FlowIntake; flowId: string; run: Run }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
      <input
        type="checkbox" checked={intake.isEnabled} disabled={run.isPending}
        onChange={(e) => run.mutate(() => updateIntake(flowId, intake.id, request(intake, e.target.checked)))}
      />
      On
    </label>
  );
}

/** This flow's own address: address and Copy, On, the last run, and a new address (asks first) or a first one (does not). */
function OwnAddress({ flowId, intake }: { flowId: string; intake: FlowIntake }) {
  const confirm = useConfirm();
  const run = useRun(flowId);
  const ask = async () => {
    if (await confirm({ title: "Get a new address", description: "The current address stops working at once.", confirmLabel: "Get a new address", danger: true }))
      run.mutate(() => newIntakeAddress(flowId, intake.id));
  };
  return (
    <div className="grid gap-3">
      {intake.address && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[13px]">{intake.address}</span>
          <CopyButton text={intake.address} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <OnOff intake={intake} flowId={flowId} run={run} />
        {intake.address
          ? <Button variant="secondary" size="sm" loading={run.isPending} onClick={ask}>Get a new address</Button>
          : <Button variant="secondary" size="sm" loading={run.isPending} onClick={() => run.mutate(() => newIntakeAddress(flowId, intake.id))}>Get an address</Button>}
      </div>
      <LastRun intake={intake} />
      <Refused run={run} />
    </div>
  );
}

function EmailCard({ flowId, intake }: { flowId: string; intake: FlowIntake }) {
  return (
    <Card edge="blue" title="Email">
      <div className="grid gap-3">
        <p className="m-0 text-[13px] text-ink-muted">
          Forward or send documents to this address. Each attached file we can read becomes a document in this flow.
        </p>
        <OwnAddress flowId={flowId} intake={intake} />
      </div>
    </Card>
  );
}

const SUMMARY = "flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden";

const useIntakes = (flowId: string) => {
  const enabled = useTenantQueriesEnabled();
  return useQuery({ queryKey: ["intakes", flowId], queryFn: () => listIntakes(flowId), enabled });
};

/** Just the address, for the end of New flow. */
export function FlowEmailCard({ flowId }: { flowId: string }) {
  const intakes = useIntakes(flowId);
  const email = intakes.data?.find((i) => i.kind === "email");
  if (intakes.isError && !intakes.data) return <Failed error={intakes.error} retry={() => intakes.refetch()} />;
  return email ? <EmailCard flowId={flowId} intake={email} /> : <Quiet>Loading address…</Quiet>;
}

function ApiCard({ flowId, intake }: { flowId: string; intake?: FlowIntake }) {
  const run = useRun(flowId);
  const endpoint = flowApiEndpoint(flowId);
  const [url, setUrl] = useState(String(intake?.config.webhookUrl ?? ""));
  const [secret, setSecret] = useState("");
  const test = useMutation({ mutationFn: (id: string) => testIntake(flowId, id) });
  // Saves, then sends a test to the web address when one is set (a test call carries no document).
  const save = () => {
    const hook = url.trim();
    const req: IntakeRequest = { kind: "api", config: { webhookUrl: hook }, credentials: secret ? { webhookSecret: secret } : null };
    test.reset();
    run.mutate(async () => {
      const saved = await (intake ? updateIntake(flowId, intake.id, req) : createIntake(flowId, req));
      setSecret("");
      if (hook) test.mutate(saved.id);
    });
  };
  return (
    <Card edge="blue" title="API address for this flow">
      <form onSubmit={(e) => { e.preventDefault(); if (!run.isPending && !test.isPending) save(); }} className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[13px]">{endpoint}</span>
          <CopyButton text={endpoint} label="Copy API address" />
        </div>
        <p className="m-0 text-[13px] text-ink-muted">
          Send a file as <code>file</code> in a multipart POST, with your key in the <code>X-ProcuLink-Key</code> header.
        </p>
        <Link href="/settings?tab=api" className="text-[13px] text-brand-blue underline">Create a key in Settings</Link>
        <Link href="/help/api-reference" className="text-[13px] text-brand-blue underline">API reference</Link>
        <Field label="Web address to call when a document is read or sent">
          <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Signing secret">
          <input
            className={INPUT} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder={intake?.hasCredentials ? "Leave blank to keep the saved one" : ""}
          />
        </Field>
        <div><Button type="submit" variant="secondary" loading={run.isPending || test.isPending}>{url.trim() ? "Save and send a test" : "Save"}</Button></div>
        <Refused run={run} />
        {test.isError && <StatusNotice tone="error">{documentRefusalMessage(test.error)}</StatusNotice>}
        {test.data && (
          <StatusNotice tone={test.data.success ? "success" : "error"}>
            {test.data.message ?? (test.data.success ? "The test went through." : "The test failed.")}
          </StatusNotice>
        )}
      </form>
    </Card>
  );
}

function PickupsCard({ flowId, pickups }: { flowId: string; pickups: FlowIntake[] }) {
  const confirm = useConfirm();
  const run = useRun(flowId);
  const [editing, setEditing] = useState<FlowIntake | "new" | null>(null);
  const remove = async (i: FlowIntake) => {
    if (await confirm({ title: "Remove pickup", description: "Files already picked up stay in the flow.", confirmLabel: "Remove", danger: true }))
      run.mutate(() => deleteIntake(flowId, i.id));
  };
  if (editing)
    return <PickupForm key={editing === "new" ? "new" : editing.id} flowId={flowId} intake={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />;
  return (
    <Card edge="blue" title="Collect from a mailbox or a server">
      <div className="grid gap-3">
        <p className="m-0 text-[13px] text-ink-muted">We collect new files from a mailbox, a server or an S3 bucket you already use, so nobody has to forward them.</p>
        {pickups.length === 0 && <Quiet>No pickups yet.</Quiet>}
        {pickups.map((i) => {
          const where = i.config.host ?? i.config.bucket;
          return (
            <div key={i.id} className="grid gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium">
                  {Object.hasOwn(PICKUP_KINDS, i.kind) ? PICKUP_KINDS[i.kind as keyof typeof PICKUP_KINDS] : i.kind}
                  {typeof where === "string" && <span className="ml-2 font-mono text-[12.5px] text-ink-muted">{where}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <OnOff intake={i} flowId={flowId} run={run} />
                  <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={run.isPending} onClick={() => remove(i)}>Remove</Button>
                </span>
              </div>
              <LastRun intake={i} />
            </div>
          );
        })}
        <Refused run={run} />
        <div><Button variant="secondary" size="sm" onClick={() => setEditing("new")}>Add a pickup</Button></div>
      </div>
    </Card>
  );
}

/** How to add a file by hand, in both layouts: under 768 there is no Upload in the top bar, only the round + at the bottom. */
const AddFileLine = ({ flowId }: { flowId: string }) => (
  <p className="m-0 text-[13px] text-ink-muted">
    <span className="hidden md:inline">
      Or drop a file on this flow&apos;s <Link href={flowAddress(flowId, "documents")} className="text-brand-blue underline">Documents</Link> page, or press Upload in the top bar.
    </span>
    <span className="md:hidden">Or add a file with the + button at the bottom of the screen.</span>
  </p>
);

/** The Arrives step: the workspace address when known (this flow's own folded under it), else this flow's email and upload; pickups; the API folded away for developers. Every button here is outlined:
 *  the publish bar under the step holds the one filled button. */
export function FlowIntakePanel({ flow }: { flow: Flow }) {
  const intakes = useIntakes(flow.id);
  const inbox = useQuery({ ...inboxQuery, staleTime: 60_000, enabled: useTenantQueriesEnabled() });
  // Only from an answer that has not failed since, and never this flow's own address folded under itself.
  const workspace = !inbox.isError && inbox.data?.address && inbox.data.flowId !== flow.id ? inbox.data.address : null;
  const body = () => {
    if (intakes.isError && !intakes.data) return <Failed error={intakes.error} retry={() => intakes.refetch()} />;
    if (!intakes.data) return <Quiet>Loading…</Quiet>;
    const email = intakes.data.find((i) => i.kind === "email");
    const api = intakes.data.find((i) => i.kind === "api");
    return (
      <>
        {email && workspace && (
          <details open={runTone(email) !== null}>
            <summary className={SUMMARY}>
              <ChevronRight size={16} aria-hidden data-disclosure-chevron />
              <span className="grid">
                This flow&apos;s own address
                <span className="text-[13px] font-normal text-ink-muted">Documents sent there skip the sorting and go straight into this flow.</span>
              </span>
            </summary>
            <div className="mt-2"><OwnAddress flowId={flow.id} intake={email} /></div>
          </details>
        )}
        <PickupsCard flowId={flow.id} pickups={intakes.data.filter((i) => i.kind !== "email" && i.kind !== "api")} />
        <details>
          <summary className={SUMMARY}><ChevronRight size={16} aria-hidden data-disclosure-chevron />For developers</summary>
          <div className="mt-2 grid gap-3">
            <p className="m-0 text-[13px] text-ink-muted">Send documents from another system, and be told when one is read or sent.</p>
            <ApiCard flowId={flow.id} intake={api} />
          </div>
        </details>
      </>
    );
  };
  const email = !workspace && intakes.data?.find((i) => i.kind === "email");
  return (
    <section aria-labelledby={`arrives-${flow.id}`} className="grid gap-4">
      <h2 id={`arrives-${flow.id}`} className="m-0 text-[16px] font-semibold text-ink">How documents arrive</h2>
      {workspace ? (
        <Card edge="blue">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-[14px] text-ink">Send any document to <span className="break-all font-mono">{workspace}</span></p>
              <CopyButton text={workspace} label="Copy address" />
            </div>
            <p className="m-0 text-[13px] text-ink-muted">We work out which flow each document belongs to.</p>
            <AddFileLine flowId={flow.id} />
            <p className="m-0 text-[13px] text-ink-muted">{kindsLine(flow)}</p>
          </div>
        </Card>
      ) : (
        <>
          {email && <EmailCard flowId={flow.id} intake={email} />}
          <Card title="Upload" sub="Always on. Nothing to set up.">
            <AddFileLine flowId={flow.id} />
            <p className="m-0 mt-1 text-[13px] text-ink-muted">{kindsLine(flow)}</p>
          </Card>
        </>
      )}
      {body()}
    </section>
  );
}
