"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton } from "@/components/bridge/CopyButton";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useConfirm } from "@/components/ui/confirm";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  createIntake, deleteIntake, flowApiEndpoint, listIntakes, newIntakeAddress, testIntake, updateIntake,
} from "@/lib/api/documents";
import type { FlowIntake, IntakeRequest } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
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

/** Only the two statuses the worker writes get a tone; anything else is printed plain. */
function LastRun({ intake }: { intake: FlowIntake }) {
  if (!intake.lastMessage) return null;
  const tone = intake.lastStatus === "paused" ? "warning" : intake.lastStatus === "failed" ? "error" : null;
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

function EmailCard({ flowId, intake }: { flowId: string; intake: FlowIntake }) {
  const confirm = useConfirm();
  const run = useRun(flowId);
  const ask = async () => {
    if (await confirm({ title: "Get a new address", description: "The current address stops working at once.", confirmLabel: "Get a new address", danger: true }))
      run.mutate(() => newIntakeAddress(flowId, intake.id));
  };
  return (
    <Card edge="blue" title="Email address">
      <div className="grid gap-3">
        <p className="m-0 text-[13px] text-ink-muted">
          Forward or send documents here. Each attached file we can read becomes a document in this flow.
        </p>
        {intake.address ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-[13px]">{intake.address}</span>
            <CopyButton text={intake.address} />
          </div>
        ) : <Quiet>This flow has no address right now.</Quiet>}
        <div className="flex flex-wrap items-center gap-3">
          <OnOff intake={intake} flowId={flowId} run={run} />
          <Button variant="secondary" size="sm" loading={run.isPending} onClick={ask}>Get a new address</Button>
        </div>
        <LastRun intake={intake} />
        <Refused run={run} />
      </div>
    </Card>
  );
}

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
  const test = useMutation({ mutationFn: () => testIntake(flowId, intake!.id) });
  const save = () => {
    const req: IntakeRequest = { kind: "api", config: { webhookUrl: url.trim() }, credentials: secret ? { webhookSecret: secret } : null };
    run.mutate(async () => { await (intake ? updateIntake(flowId, intake.id, req) : createIntake(flowId, req)); setSecret(""); test.reset(); });
  };
  return (
    <Card edge="blue" title="API">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[13px]">{endpoint}</span>
          <CopyButton text={endpoint} label="Copy API address" />
        </div>
        <p className="m-0 text-[13px] text-ink-muted">
          Send a file as <code>file</code> in a multipart POST, with your key in the <code>X-ProcuLink-Key</code> header.
        </p>
        <Link href="/settings?tab=api" className="text-[13px] text-brand-blue underline">Create a key in Settings</Link>
        <Link href="/help/api-reference" className="text-[13px] text-brand-blue underline">API reference</Link>
        <Field label="Web address to call when a document is read or sent (webhook)">
          <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Signing secret">
          <input
            className={INPUT} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder={intake?.hasCredentials ? "Leave blank to keep the saved one" : ""}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={run.isPending}>Save</Button>
          <Button type="button" variant="secondary" disabled={!intake} loading={test.isPending} onClick={() => test.mutate()}>Send a test</Button>
        </div>
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
    <Card edge="blue" title="Pickups">
      <div className="grid gap-3">
        <p className="m-0 text-[13px] text-ink-muted">Pick up documents from a folder on a server, a mailbox or an S3 bucket.</p>
        {pickups.length === 0 && <Quiet>No pickups yet.</Quiet>}
        {pickups.map((i) => {
          const where = i.config.host ?? i.config.bucket;
          return (
            <div key={i.id} className="grid gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium">
                  {Object.hasOwn(PICKUP_KINDS, i.kind) ? PICKUP_KINDS[i.kind as keyof typeof PICKUP_KINDS] : i.kind}
                  {typeof where === "string" && <span className="ml-2 font-mono text-[12px] text-ink-muted">{where}</span>}
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
        <div><Button variant="primary" size="sm" onClick={() => setEditing("new")}>Add a pickup</Button></div>
      </div>
    </Card>
  );
}

export function FlowIntakePanel({ flowId }: { flowId: string }) {
  const intakes = useIntakes(flowId);
  if (intakes.isError && !intakes.data) return <Failed error={intakes.error} retry={() => intakes.refetch()} />;
  if (!intakes.data) return <Quiet>Loading…</Quiet>;
  const email = intakes.data.find((i) => i.kind === "email");
  const api = intakes.data.find((i) => i.kind === "api");
  return (
    <div className="grid gap-4">
      {email && <EmailCard flowId={flowId} intake={email} />}
      <ApiCard key={api?.id} flowId={flowId} intake={api} />
      <PickupsCard flowId={flowId} pickups={intakes.data.filter((i) => i.kind !== "email" && i.kind !== "api")} />
    </div>
  );
}
