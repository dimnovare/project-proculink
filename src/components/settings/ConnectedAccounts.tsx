"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useLinkedAccounts } from "@/components/flows/GoogleTargetFields";
import { Failed, Loading } from "@/components/flows/states";
import { deleteLinkedAccount } from "@/lib/api/linkedAccounts";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { SettingsPanel } from "./SettingsPrimitives";

/** A provider this build does not know is printed as the server sent it. */
const PROVIDER: Record<string, string> = { google: "Google", outlook: "Microsoft mailbox", microsoft: "Microsoft OneDrive" };

/** Settings › Workspace: every account the workspace has connected, each disconnected after an inline confirm. */
export function ConnectedAccounts() {
  const qc = useQueryClient();
  const linked = useLinkedAccounts();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const disconnect = useMutation({
    mutationFn: deleteLinkedAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["linked-accounts"] }),
    onError: (e, id) => setProblem({ id, text: documentRefusalMessage(e) }),
    onSettled: () => setConfirming(null),
  });

  let body: React.ReactNode;
  if (linked.isError && !linked.data) body = <Failed error={linked.error} retry={() => linked.refetch()} />;
  else if (!linked.data) body = <Loading>Loading accounts…</Loading>;
  else if (!linked.data.accounts.length)
    body = <p className="m-0 text-[14px] text-ink">No accounts connected. You connect one when you add a pickup or a destination.</p>;
  else
    body = (
      <ul data-testid="connected-accounts" className="m-0 grid list-none gap-3 p-0">
        {linked.data.accounts.map((a) => (
          <li key={a.id} className="grid gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="min-w-0 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{a.email}</span>
              <span className="text-[13px] text-ink-muted">{PROVIDER[a.provider] ?? a.provider}</span>
              {a.status === "reconnect" && <Pill tone="amber">Reconnect needed</Pill>}
              {confirming !== a.id && (
                <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-label={`Disconnect ${a.email}, ${PROVIDER[a.provider] ?? a.provider}`}
                  onClick={() => { setProblem(null); setConfirming(a.id); }}>Disconnect</Button>
              )}
            </div>
            {confirming === a.id && (
              <StatusNotice tone="warning" action={
                <span className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" loading={disconnect.isPending} className="border-danger text-danger"
                    onClick={() => disconnect.mutate(a.id)}>Disconnect</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>Keep connected</Button>
                </span>
              }>
                {`Disconnect ${a.email}? ProcuLink deletes its access now. You can also remove ProcuLink from the account's app permissions.`}
              </StatusNotice>
            )}
            {problem?.id === a.id && <StatusNotice tone="error">{problem.text}</StatusNotice>}
          </li>
        ))}
      </ul>
    );

  return (
    <SettingsPanel id="s-accounts" title="Connected accounts" sub="Google and Microsoft accounts your pickups and destinations use.">
      {body}
    </SettingsPanel>
  );
}
