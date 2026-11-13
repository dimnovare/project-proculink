"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { deleteLinkedAccount, getGooglePicker, listLinkedAccounts, startGoogleConnect } from "@/lib/api/linkedAccounts";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { openGooglePicker } from "@/lib/googlePicker";
import { Field, INPUT } from "./DestinationForm";

const KEY = ["linked-accounts"];
/** The callback page posts this to its opener once the account is saved (R9). */
const CONNECTED = "proculink:google-connected";

/** Shared by the form (are the Google kinds offered?) and the fields below. A failed list means "not available". */
export const useLinkedAccounts = () =>
  useQuery({ queryKey: KEY, queryFn: listLinkedAccounts, enabled: useTenantQueriesEnabled(), retry: false });

/** Opens the popup synchronously in the click, so a blocker allows it; without one, the whole page goes to Google. */
async function connect() {
  const popup = window.open("about:blank", "google-connect", "width=520,height=640");
  try {
    const { authorizeUrl } = await startGoogleConnect(location.origin, location.pathname + location.search);
    if (popup) popup.location.href = authorizeUrl;
    else location.assign(authorizeUrl);
  } catch (e) {
    popup?.close();
    throw e;
  }
}

export function GoogleTargetFields({ protocol, config, onChange }: {
  protocol: "google_drive" | "google_sheets"; config: Record<string, unknown>; onChange(patch: Record<string, unknown>): void;
}) {
  const qc = useQueryClient();
  const linked = useLinkedAccounts();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const drive = protocol === "google_drive";
  const [idKey, nameKey] = drive ? ["folderId", "folderName"] : ["spreadsheetId", "spreadsheetName"];

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === CONNECTED) void qc.invalidateQueries({ queryKey: KEY });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  const fail = (e: unknown) => setProblem(documentRefusalMessage(e));
  const start = () => { setProblem(null); connect().catch(fail); };
  const pick = useMutation({
    mutationFn: async (accountId: string) =>
      openGooglePicker({ kind: drive ? "folder" : "spreadsheet", ...(await getGooglePicker(accountId)) }),
    onSuccess: (doc, accountId) => doc && onChange({ accountId, [idKey]: doc.id, [nameKey]: doc.name }),
    onError: (e) => { fail(e); void qc.invalidateQueries({ queryKey: KEY }); }, // a removed grant shows as "reconnect"
  });
  const disconnect = useMutation({
    mutationFn: deleteLinkedAccount,
    onSuccess: (_v, id) => {
      if (config.accountId === id) onChange({ accountId: "", [idKey]: "", [nameKey]: "" });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: fail,
    onSettled: () => setConfirming(false),
  });

  if (!linked.data) return null;
  const accounts = linked.data.accounts;
  const account = accounts.find((a) => a.id === config.accountId) ?? accounts[0];
  const notice = problem && <StatusNotice tone="error">{problem}</StatusNotice>;
  if (!account)
    return (
      <div className="grid gap-2">
        <Button type="button" variant="secondary" onClick={start}>Connect a Google account</Button>
        {notice}
      </div>
    );

  const reconnect = account.status === "reconnect";
  const picked = typeof config[nameKey] === "string" && config[nameKey] ? String(config[nameKey]) : null;
  return (
    <div className="grid gap-3">
      {accounts.length > 1 ? (
        <Field label="Google account">
          <select className={INPUT} value={account.id}
            onChange={(e) => onChange({ accountId: e.target.value, [idKey]: "", [nameKey]: "" })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </Field>
      ) : (
        <div className="text-[12px]">
          <span className="mb-1 block font-medium text-ink-muted">Google account</span>
          <span className="text-ink">{account.email}</span>
        </div>
      )}
      {reconnect && <StatusNotice tone="warning">{COPY.account_reconnect}</StatusNotice>}
      <div className="flex flex-wrap gap-2">
        {reconnect && <Button type="button" variant="primary" onClick={start}>Reconnect</Button>}
        <Button type="button" variant="ghost" onClick={start}>Connect another account</Button>
        {!confirming && <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Disconnect</Button>}
      </div>
      {confirming && (
        <StatusNotice tone="warning" action={
          <span className="flex gap-2">
            <Button type="button" variant="danger" size="sm" loading={disconnect.isPending}
              onClick={() => disconnect.mutate(account.id)}>Disconnect</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep connected</Button>
          </span>
        }>
          Disconnect this Google account? ProcuLink deletes its access now. You can also remove ProcuLink from your
          Google account&apos;s third-party access.
        </StatusNotice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={reconnect} loading={pick.isPending}
          onClick={() => { setProblem(null); pick.mutate(account.id); }}>
          {drive ? "Choose folder" : "Choose spreadsheet"}
        </Button>
        {picked && <span className="text-[13px] text-ink">{picked}</span>}
      </div>
      {!drive && (
        <div className="grid gap-1">
          <Field label="Tab (optional)">
            <input className={INPUT} value={String(config.sheetName ?? "")} aria-describedby="dest-sheet-help"
              onChange={(e) => onChange({ sheetName: e.target.value })} />
          </Field>
          <span id="dest-sheet-help" className="text-[11px] text-ink-muted">
            Leave empty to add rows to the first tab. Use a CSV output — each send adds its rows to the end.
          </span>
        </div>
      )}
      {notice}
    </div>
  );
}
