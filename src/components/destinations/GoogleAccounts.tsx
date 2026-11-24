"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { connectGoogle, useGoogleConnectRefresh, useLinkedAccounts } from "@/components/flows/GoogleTargetFields";
import { useConfirm } from "@/components/ui/confirm";
import type { Destination } from "@/lib/api/documents";
import { deleteLinkedAccount } from "@/lib/api/linkedAccounts";
import { documentRefusalMessage, refusalToken } from "@/lib/documentRefusals";

const LINK = "inline-flex items-center text-[13px] font-semibold text-ink underline";

/** "a", "a and b", "a, b and c". */
const joinNames = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Nothing unless the server says Google is available. `destinations` undefined = not known yet: use is not said. */
export function GoogleAccounts({ destinations }: { destinations: Destination[] | undefined }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const heading = useId();
  const linked = useLinkedAccounts();
  useGoogleConnectRefresh();
  // Where a refusal is said: an account's row, or the block (`at: null`) for "Connect".
  const [problem, setProblem] = useState<{ at: string | null; text: string } | null>(null);
  const start = (at: string | null) => {
    setProblem(null);
    connectGoogle().catch((e) => setProblem({ at, text: documentRefusalMessage(e) }));
  };
  const disconnect = useMutation({
    mutationFn: deleteLinkedAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["linked-accounts"] }),
    onError: (e, at) => {
      setProblem({ at, text: documentRefusalMessage(e) });
      // A destination saved since the list loaded: ask again, so the use line names it.
      if (refusalToken(e) === "account_in_use") void qc.invalidateQueries({ queryKey: ["destinations"] });
    },
  });

  if (!linked.data?.available) return null;
  const accounts = linked.data.accounts.filter((a) => a.provider === "google");
  const said = (at: string | null) => problem?.at === at && <StatusNotice tone="error">{problem.text}</StatusNotice>;

  async function remove(id: string, email: string) {
    const yes = await confirm({
      title: "Disconnect Google account",
      description: `Disconnect ${email}? ProcuLink deletes its access now. You can also remove ProcuLink from your Google account's third-party access.`,
      confirmLabel: "Disconnect", cancelLabel: "Keep connected", danger: true,
    });
    if (yes) { setProblem(null); disconnect.mutate(id); }
  }

  return (
    <Card as="section" aria-labelledby={heading} flush>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id={heading} className="m-0 text-[15px] font-semibold text-ink">Google accounts</h2>
        <Button type="button" variant="secondary" onClick={() => start(null)}>
          {accounts.length ? "Connect another account" : "Connect a Google account"}
        </Button>
      </div>
      <div className="grid gap-3 p-4">
        {said(null)}
        {accounts.length ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {accounts.map((a) => {
              const names = destinations?.filter((d) => d.config.accountId === a.id).map((d) => d.name);
              return (
                <li key={a.id} className="grid gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-0 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{a.email}</span>
                    {names && (
                      <span className="text-[13px] text-ink-muted">
                        {names.length ? `Used by ${joinNames(names)}` : "Not used by a destination yet."}
                      </span>
                    )}
                    {/* A status this build does not know gets no tag: unknown is never "Connected". */}
                    {a.status === "reconnect" ? (
                      <Pill tone="amber">Reconnect needed</Pill>
                    ) : a.status === "active" && (
                      <Pill tone="green" icon={<Check aria-hidden size={13} />}>Connected</Pill>
                    )}
                    <span className="ml-auto flex gap-4">
                      <button type="button" className={LINK} aria-label={`Reconnect ${a.email}`} onClick={() => start(a.id)}>Reconnect</button>
                      <button type="button" className={LINK} aria-label={`Disconnect ${a.email}`}
                        disabled={disconnect.isPending} onClick={() => remove(a.id, a.email)}>Disconnect</button>
                    </span>
                  </div>
                  {said(a.id)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-[14px] text-ink">No Google account is connected.</p>
        )}
        <p className="m-0 rounded-card bg-surface-2 p-3 text-[13px] text-ink-muted">
          When you connect, Google lists what ProcuLink may do. Keep the Google Drive box ticked, or we can&apos;t save files or add
          rows. We only see the files and folders you pick here, nothing else in your Drive.
        </p>
      </div>
    </Card>
  );
}
