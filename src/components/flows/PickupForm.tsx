"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { createIntake, testIntake, updateIntake } from "@/lib/api/documents";
import type { FlowIntake } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { Field, INPUT } from "./DestinationForm";

export const PICKUP_KINDS = {
  imap: "Mailbox (IMAP)", sftp: "SFTP", ftps: "FTPS", ftp: "FTP", s3: "S3 bucket",
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
};
const DEFAULTS: Record<Kind, Record<string, string>> = {
  imap: { port: "993", folder: "INBOX" },
  sftp: { port: "22", directory: "/" },
  ftps: { port: "21", directory: "/" },
  ftp: { port: "21", directory: "/" },
  s3: { region: "us-east-1" },
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
            {Object.entries(PICKUP_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        {kind === "ftp" && (
          <StatusNotice tone="warning">FTP sends your password unencrypted. Use FTPS or SFTP if the server supports them.</StatusNotice>
        )}
        {isKind(kind) && (
          <>
            {FIELDS[kind].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  className={INPUT} type={key === "port" ? "number" : "text"} value={values[key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                />
              </Field>
            ))}
            <Field label={kind === "s3" ? "Secret access key" : "Password"}>
              <input
                className={INPUT} type="password" autoComplete="new-password" value={secret}
                placeholder={current?.hasCredentials ? "Leave blank to keep the saved one" : ""}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          </>
        )}
        <p className="m-0 text-[12px] text-ink-muted">Each file is picked up once. A file that changes is picked up again. Files stay where they are. We check every five minutes.</p>
        {save.isError && <StatusNotice tone="error">{documentRefusalMessage(save.error)}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!isKind(kind)} loading={save.isPending}>Save</Button>
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
