"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  GOOGLE_CONNECT_CHANNEL, deleteLinkedAccount, getGooglePicker, listLinkedAccounts, startGoogleConnect, startMicrosoftConnect, type GoogleStart,
} from "@/lib/api/linkedAccounts";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { openGooglePicker } from "@/lib/googlePicker";
import { Field, INPUT } from "./DestinationForm";
import { useOnFlowPage } from "./flowDraft";

const KEY = ["linked-accounts"];

/** Shared by the form (are the Google kinds offered?) and the fields below. A failed list means "not available". */
export const useLinkedAccounts = () =>
  useQuery({ queryKey: KEY, queryFn: listLinkedAccounts, enabled: useTenantQueriesEnabled(), retry: false });

/**
 * Opens the popup synchronously in the click, so a blocker allows it. A popup needs no way back — the callback
 * closes it — so only the full-page fallback sends `returnTo`.
 */
export async function connectAccount(
  start: (origin: string, returnTo?: string) => Promise<GoogleStart>, popupName: string,
): Promise<void> {
  const popup = window.open("about:blank", popupName, "width=520,height=640");
  try {
    const { authorizeUrl } = await start(location.origin, popup ? undefined : location.pathname + location.search);
    if (popup) popup.location.href = authorizeUrl;
    else location.assign(authorizeUrl);
  } catch (e) {
    popup?.close();
    throw e;
  }
}

export const connectGoogle = () => connectAccount(startGoogleConnect, "google-connect");

/** Refreshes the account list when the callback page says an account was saved. */
export function useGoogleConnectRefresh(): void {
  const qc = useQueryClient();
  // A BroadcastChannel, not window.opener: Google's sign-in pages can sever the opener (COOP).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(GOOGLE_CONNECT_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "connected") void qc.invalidateQueries({ queryKey: KEY });
    };
    return () => channel.close();
  }, [qc]);
}

export function GoogleTargetFields({ protocol, config, onChange }: {
  protocol: "google_drive" | "google_sheets" | "microsoft_onedrive"; config: Record<string, unknown>; onChange(patch: Record<string, unknown>): void;
}) {
  const qc = useQueryClient();
  const filled = useOnFlowPage() ? "secondary" : "primary";
  const linked = useLinkedAccounts();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const drive = protocol === "google_drive";
  // OneDrive (plan 30 Part B): a pasted sharing link instead of Google's Picker; the server resolves it and keeps the folder.
  const ms = protocol === "microsoft_onedrive";
  const who = ms ? "Microsoft" : "Google";
  const [idKey, nameKey] = ms ? ["itemId", "itemName"] : drive ? ["folderId", "folderName"] : ["spreadsheetId", "spreadsheetName"];

  useGoogleConnectRefresh();

  const fail = (e: unknown) => setProblem(documentRefusalMessage(e));
  const start = () => { setProblem(null); (ms ? connectAccount(startMicrosoftConnect, "microsoft-connect") : connectGoogle()).catch(fail); };
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
  const accounts = linked.data.accounts.filter((a) => a.provider === (ms ? "microsoft" : "google"));
  const saved = typeof config.accountId === "string" && config.accountId ? config.accountId : null;
  // A saved account that is no longer connected is said so, never shown as another account's email.
  const account = saved ? accounts.find((a) => a.id === saved) : accounts[0];
  const lost = saved && !account && <StatusNotice tone="warning">{COPY.account_not_found}</StatusNotice>;
  const notice = problem && <StatusNotice tone="error">{problem}</StatusNotice>;
  if (!accounts.length)
    return (
      <div className="grid gap-2">
        {lost}
        <Button type="button" variant="secondary" onClick={start}>{ms ? "Connect a Microsoft account" : "Connect a Google account"}</Button>
        {notice}
      </div>
    );

  const reconnect = account?.status === "reconnect";
  const picked = account && typeof config[nameKey] === "string" && config[nameKey] ? String(config[nameKey]) : null;
  return (
    <div className="grid gap-3">
      {lost}
      {accounts.length > 1 || !account ? (
        <Field label={`${who} account`}>
          <select className={INPUT} value={account?.id ?? ""}
            onChange={(e) => onChange({ accountId: e.target.value, [idKey]: "", [nameKey]: "" })}>
            {!account && <option value="" disabled>Choose an account</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </Field>
      ) : (
        <div className="text-[12.5px]">
          <span className="mb-1 block font-medium text-ink-muted">{who} account</span>
          <span className="text-ink">{account.email}</span>
        </div>
      )}
      {reconnect && <StatusNotice tone="warning">{ms ? "Microsoft access was removed. Reconnect the Microsoft account." : COPY.account_reconnect}</StatusNotice>}
      <div className="flex flex-wrap gap-2">
        {reconnect && <Button type="button" variant={filled} onClick={start}>Reconnect</Button>}
        <Button type="button" variant="ghost" onClick={start}>Connect another account</Button>
        {account && !confirming && <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Disconnect</Button>}
      </div>
      {account && confirming && (
        <StatusNotice tone="warning" action={
          <span className="flex gap-2">
            <Button type="button" variant={filled === "primary" ? "danger" : "secondary"} size="sm" loading={disconnect.isPending}
              className={filled === "primary" ? undefined : "border-danger text-danger"}
              onClick={() => disconnect.mutate(account.id)}>Disconnect</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep connected</Button>
          </span>
        }>
          {ms
            ? "Disconnect this Microsoft account? ProcuLink deletes its access now. You can also remove ProcuLink from your Microsoft account's app permissions."
            : "Disconnect this Google account? ProcuLink deletes its access now. You can also remove ProcuLink from your Google account's third-party access."}
        </StatusNotice>
      )}
      {ms ? (
        <div className="grid gap-1">
          <Field label="Folder link">
            <input className={INPUT} value={String(config.link ?? "")} aria-describedby="dest-link-help"
              onChange={(e) => onChange({ link: e.target.value, ...(account && { accountId: account.id }) })} />
          </Field>
          <span id="dest-link-help" className="text-[13px] text-ink-muted">
            {picked && !config.link
              ? `Folder: ${picked} · Paste a new link to change it.`
              : "In OneDrive, open the folder's Share menu, choose Copy link, and paste it here."}
          </span>
        </div>
      ) : account && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={reconnect} loading={pick.isPending}
            onClick={() => { setProblem(null); pick.mutate(account.id); }}>
            {drive ? "Choose folder" : "Choose spreadsheet"}
          </Button>
          {picked && <span className="text-[13px] text-ink">{picked}</span>}
        </div>
      )}
      {protocol === "google_sheets" && (
        <div className="grid gap-1">
          <Field label="Tab (optional)">
            <input className={INPUT} value={String(config.sheetName ?? "")} aria-describedby="dest-sheet-help"
              onChange={(e) => onChange({ sheetName: e.target.value })} />
          </Field>
          <span id="dest-sheet-help" className="text-[13px] text-ink-muted">
            Leave empty to add rows to the first tab. Use a CSV file with a header row — each send adds its rows to the end.
          </span>
        </div>
      )}
      {notice}
    </div>
  );
}
