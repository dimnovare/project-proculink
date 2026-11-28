"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { createIntake, testIntake, updateIntake } from "@/lib/api/documents";
import type { FlowIntake } from "@/lib/api/documents";
import { startOutlookConnect } from "@/lib/api/linkedAccounts";
import { settingsAddress } from "@/lib/settingsTabs";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import { Field, INPUT } from "./DestinationForm";
import { connectAccount, useGoogleConnectRefresh, useLinkedAccounts } from "./GoogleTargetFields";

export const PICKUP_KINDS = {
  imap: "Mailbox (IMAP)", sftp: "SFTP", ftps: "FTPS", ftp: "FTP", s3: "S3 bucket", outlook: "Outlook or Microsoft 365 mailbox",
} as const;
type Kind = keyof typeof PICKUP_KINDS;

// Config keys and defaults mirror FlowIntakeService.Keys on the backend. hostKeyFingerprints and useSsl are
// left out on purpose: the server learns the first and keeps the saved value of a key a request omits.
const SERVER: [string, string][] = [["host", "Server"], ["port", "Port"], ["username", "User name"]];
const FIELDS: Record<Kind, [key: string, label: string][]> = {
  imap: [...SERVER, ["folder", "Folder"], ["fromFilter", "Only from (comma-separated)"], ["subjectFilter", "Subject contains"]],
  sftp: [...SERVER, ["directory", "Folder"]],
  ftps: [...SERVER, ["directory", "Folder"]],
  ftp: [...SERVER, ["directory", "Folder"]],
  s3: [
    ["bucket", "Bucket"], ["prefix", "Prefix"], ["region", "Region"],
    ["serviceUrl", "Custom S3 address (for R2 or MinIO)"], ["accessKeyId", "Access key ID"],
  ],
  // accountId renders as the Microsoft account picker, not a text box.
  outlook: [["accountId", "Microsoft account"], ["folder", "Folder"], ["fromFilter", "Only from (comma-separated)"], ["subjectFilter", "Subject contains"]],
};
const DEFAULTS: Record<Kind, Record<string, string>> = {
  imap: { port: "993", folder: "INBOX" },
  sftp: { port: "22", directory: "/" },
  ftps: { port: "21", directory: "/" },
  ftp: { port: "21", directory: "/" },
  s3: { region: "us-east-1" },
  outlook: { folder: "Inbox" },
};

const isKind = (k: string): k is Kind => Object.hasOwn(PICKUP_KINDS, k);
const startValues = (kind: string, config?: Record<string, unknown>) =>
  Object.fromEntries(
    (isKind(kind) ? FIELDS[kind] : []).map(([k]) => [k, config ? String(config[k] ?? "") : (DEFAULTS[kind as Kind][k] ?? "")]),
  );

export function PickupForm({ flowId, intake, onDone }: { flowId: string; intake?: FlowIntake; onDone(): void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(intake);
  const [kind, setKind] = useState(intake?.kind ?? "sftp");
  const [values, setValues] = useState(() => startValues(kind, intake?.config));
  const [secret, setSecret] = useState("");
  // The Microsoft mailbox is offered only where the backend says so; a saved one always shows its own kind.
  const microsoft = useLinkedAccounts().data?.microsoftAvailable === true;

  const secretKey = kind === "s3" ? "secretKey" : "password";
  const test = useMutation({ mutationFn: () => testIntake(flowId, current!.id) });
  const save = useMutation({
    mutationFn: () => {
      const config = Object.fromEntries(
        FIELDS[kind as Kind].map(([k]) => [k, k === "port" ? Number(values[k] || DEFAULTS[kind as Kind].port) : values[k]]),
      );
      const req = { kind, config, credentials: secret ? { [secretKey]: secret } : null };
      return current ? updateIntake(flowId, current.id, req) : createIntake(flowId, req);
    },
    onSuccess: (saved) => {
      setCurrent(saved);
      setSecret("");
      test.reset();
      qc.invalidateQueries({ queryKey: ["intakes", flowId] });
    },
  });

  return (
    <Card edge="blue" title={current ? "Edit pickup" : "Add a pickup"}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-3">
        <Field label="Type">
          <select
            className={INPUT} value={kind} disabled={!!current}
            onChange={(e) => { setKind(e.target.value); setValues(startValues(e.target.value)); setSecret(""); }}
          >
            {!isKind(kind) && <option value={kind}>{kind}</option>}
            {Object.entries(PICKUP_KINDS)
              .filter(([id]) => id !== "outlook" || microsoft || kind === "outlook")
              .map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        {kind === "ftp" && (
          <StatusNotice tone="warning">FTP sends your password unencrypted. Use FTPS or SFTP if the server supports them.</StatusNotice>
        )}
        {isKind(kind) && (
          <>
            {FIELDS[kind].map(([key, label]) => key === "accountId" ? (
              <MicrosoftAccountField key={key} value={values.accountId ?? ""} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
            ) : (
              <Fragment key={key}>
                <Field label={label}>
                  <input
                    className={INPUT} type={key === "port" ? "number" : "text"} value={values[key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </Field>
                {kind === "outlook" && key === "folder" && (
                  <p className="m-0 -mt-1 text-[12.5px] text-ink-muted">Leave it as Inbox, or type the name of another folder. Folders inside Inbox work too.</p>
                )}
              </Fragment>
            ))}
            {kind !== "outlook" && (
              <Field label={kind === "s3" ? "Secret access key" : "Password"}>
                <input
                  className={INPUT} type="password" autoComplete="new-password" value={secret}
                  placeholder={current?.hasCredentials ? "Leave blank to keep the saved one" : ""}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
            )}
          </>
        )}
        <p className="m-0 text-[12.5px] text-ink-muted">
          {kind === "outlook"
            ? "We check every five minutes for unread emails, pick up their files, and mark each email read. Your Microsoft 365 admin may need to approve ProcuLink first."
            : "Each file is picked up once. A file that changes is picked up again. Files stay where they are. We check every five minutes."}
        </p>
        {save.isError && <StatusNotice tone="error">{documentRefusalMessage(save.error)}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={!isKind(kind)} loading={save.isPending}>Save</Button>
          <Button type="button" variant="secondary" disabled={!current} loading={test.isPending} onClick={() => test.mutate()}>
            Test connection
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>Done</Button>
        </div>
        {test.isError && <StatusNotice tone="error">{documentRefusalMessage(test.error)}</StatusNotice>}
        {test.data && (
          <StatusNotice tone={test.data.success ? "success" : "error"}>
            {test.data.message ?? (test.data.success ? "Connected." : "The connection failed.")}
          </StatusNotice>
        )}
      </form>
    </Card>
  );
}

/** The org's Microsoft mailbox accounts (never its Google ones), with connect; they are removed in Settings. */
function MicrosoftAccountField({ value, onChange }: { value: string; onChange(id: string): void }) {
  const linked = useLinkedAccounts();
  const [problem, setProblem] = useState<string | null>(null);
  useGoogleConnectRefresh();
  const fail = (e: unknown) => setProblem(documentRefusalMessage(e));

  const accounts = (linked.data?.accounts ?? []).filter((a) => a.provider === "outlook");
  const account = accounts.find((a) => a.id === value);
  return (
    <div className="grid gap-2">
      {value && linked.data && !account && <StatusNotice tone="warning">{COPY.account_not_found}</StatusNotice>}
      {accounts.length > 0 && (
        <Field label="Microsoft account">
          <select className={INPUT} value={account ? value : ""} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.status === "active" ? a.email : `${a.email} (Reconnect needed)`}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="secondary"
          onClick={() => { setProblem(null); connectAccount(startOutlookConnect, "outlook-connect").catch(fail); }}>
          Connect a Microsoft mailbox
        </Button>
        {/* Accounts are shared by every destination and pickup, so they are removed in one place only. */}
        <Link href={settingsAddress("org")} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline">
          Manage accounts in Workspace › Connected accounts
        </Link>
      </div>
      {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
    </div>
  );
}
