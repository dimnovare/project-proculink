"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { createDestination, testDestination, updateDestination } from "@/lib/api/documents";
import type { Destination, DestinationRequest } from "@/lib/api/documents";
import { MANAGED_CONFIG_KEYS } from "@/lib/deliveryConfigKeys";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { GoogleTargetFields, useLinkedAccounts } from "./GoogleTargetFields";

type Kind = "text" | "number" | "check" | "method";
const CONFIG_FIELDS: Record<string, [label: string, kind: Kind]> = {
  url: ["Web address", "text"],
  method: ["Request method", "method"],
  timeoutSeconds: ["Give up after (seconds)", "number"],
  host: ["Server", "text"],
  port: ["Port", "number"],
  remotePath: ["Folder on the server", "text"],
  makeDirectories: ["Create the folder if it is missing", "check"],
  overwriteExisting: ["Replace a file with the same name", "check"],
  allowInvalidCertificate: ["Accept an untrusted certificate", "check"],
  toAddresses: ["Send to (separate addresses with commas)", "text"],
  replyTo: ["Reply-to address", "text"],
  subjectTemplate: ["Subject", "text"],
  bodyTemplate: ["Message", "text"],
  bucket: ["Bucket", "text"],
  prefix: ["Folder", "text"],
  region: ["Region", "text"],
  serviceUrl: ["Endpoint URL", "text"],
  accessKeyId: ["Access key ID", "text"],
  // No attachmentFileName box: a flow send always names the attachment after the document.
};

const PROTOCOLS = {
  http: "Web address (API)", sftp: "SFTP", ftps: "FTPS", email: "Email", s3: "S3 bucket",
  google_drive: "Google Drive", google_sheets: "Google Sheets",
} as const;
type Protocol = keyof typeof PROTOCOLS;
const isGoogle = (p: string): p is "google_drive" | "google_sheets" => p === "google_drive" || p === "google_sheets";
const DEFAULTS: Record<Protocol, Record<string, unknown>> = {
  http: { method: "POST", timeoutSeconds: 30 },
  sftp: { port: 22, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  ftps: { port: 21, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  email: {},
  s3: {},
  google_drive: {},
  google_sheets: {},
};

type CredField = [key: string, label: string];
const LOGIN: CredField[] = [["username", "Username"], ["password", "Password"]];
const SFTP_LOGIN: CredField[] = [...LOGIN, ["privateKey", "Private key (instead of password)"], ["privateKeyPassphrase", "Key passphrase (optional)"]];
const HTTP_AUTH: Record<string, CredField[]> = {
  bearer: [["token", "Token"]],
  apikey: [["header", "Header name"], ["value", "Key"]],
  basic: LOGIN,
};
const S3_SECRET: CredField[] = [["secretKey", "Secret access key"]];
const AUTH_LABEL = { bearer: "Bearer token", apikey: "API key", basic: "Username and password" };

export const INPUT = "h-9 w-full rounded border border-border bg-surface px-2.5 text-[13px] text-ink";
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-[12px] font-medium text-ink-muted">
    <span className="mb-1 block">{label}</span>
    {children}
  </label>
);

export function DestinationForm({ destination, preset, onSaved, onCancel }: {
  destination?: Destination; /** Seeds a new web-address destination. */ preset?: { url: string; method?: string; authType?: string }; onSaved(d: Destination): void; onCancel(): void;
}) {
  const [current, setCurrent] = useState(destination);
  const [name, setName] = useState(destination?.name ?? "");
  const [protocol, setProtocol] = useState<Protocol>((destination?.protocol as Protocol) ?? "http");
  const [config, setConfig] = useState<Record<string, unknown>>(
    destination?.config ?? { ...DEFAULTS.http, ...(preset && { url: preset.url, ...(preset.method && { method: preset.method.toUpperCase() }) }) });
  const [auth, setAuth] = useState(preset?.authType && Object.hasOwn(HTTP_AUTH, preset.authType) ? preset.authType : "bearer");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // Google kinds are offered only when the server says so; a failed list counts as "not available".
  const googleOn = useLinkedAccounts().data?.available === true;

  const credFields: CredField[] =
    protocol === "http" ? HTTP_AUTH[auth] : protocol === "email" || isGoogle(protocol) ? [] : protocol === "s3" ? S3_SECRET : protocol === "sftp" ? SFTP_LOGIN : LOGIN;

  const typed = Object.fromEntries(credFields.filter(([k]) => creds[k]?.trim()).map(([k]) => [k, creds[k]]));
  if (typed.privateKey) delete typed.password;
  // Saving replaces the stored login wholesale, so a half-filled one must never be sent.
  const required = protocol === "http" || protocol === "s3" ? credFields.map(([k]) => k) : typed.privateKey ? ["username", "privateKey"] : ["username", "password"];
  const loginIncomplete = Object.keys(typed).length > 0 && required.some((k) => !typed[k]);

  const test = useMutation({ mutationFn: () => testDestination(current!.id) });
  const save = useMutation({
    mutationFn: (body: DestinationRequest) => (current ? updateDestination(current.id, body) : createDestination(body)),
    // Clearing the typed login keeps the saved credentials write-only: they are never shown again.
    onSuccess: (d) => { setCurrent(d); setCreds({}); setProblem(null); test.reset(); onSaved(d); },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function submit() {
    if (!name.trim()) return setProblem("Give this destination a name.");
    if (loginIncomplete)
      return setProblem("Fill in every login field, or leave them all blank to keep the saved login.");
    const credentials = Object.keys(typed).length ? (protocol === "http" ? { type: auth, ...typed } : typed) : null;
    const keys = MANAGED_CONFIG_KEYS[protocol];
    const kept = Object.fromEntries(
      Object.entries(config).filter(([k, v]) => v !== "" && (keys.includes(k) || !(k in CONFIG_FIELDS))),
    );
    save.mutate({ name: name.trim(), protocol, config: kept, credentials });
  }

  const setValue = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }));
  const result = test.data;

  return (
    <Card edge="green" title={current ? "Edit destination" : "New destination"}>
      {/* Not a <form>: this sits inside the output and draft-review forms, and a nested form's Save
          either submits the outer form too or, with a password manager installed, reloads the page. */}
      <div className="grid gap-3"
        onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); submit(); } }}>
        <Field label="Name">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Send by">
          <select
            className={INPUT}
            value={protocol}
            disabled={!!current}
            onChange={(e) => {
              const next = e.target.value as Protocol;
              setProtocol(next);
              setConfig(DEFAULTS[next]);
              setCreds({});
            }}
          >
            {!Object.hasOwn(PROTOCOLS, protocol) && <option value={protocol}>{protocol}</option>}
            {Object.entries(PROTOCOLS).filter(([id]) => googleOn || !isGoogle(id) || id === protocol)
              .map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        {MANAGED_CONFIG_KEYS[protocol].filter((k) => k in CONFIG_FIELDS).map((key) => {
          const [label, kind] = CONFIG_FIELDS[key];
          const value = config[key];
          if (kind === "check")
            return (
              <label key={key} className="flex items-center gap-2 text-[12px] text-ink">
                <input type="checkbox" checked={value === true} onChange={(e) => setValue(key, e.target.checked)} />
                {label}
              </label>
            );
          return (
            <div key={key} className="grid gap-1">
            <Field label={label}>
              {kind === "method" ? (
                <select className={INPUT} value={String(value ?? "POST")} onChange={(e) => setValue(key, e.target.value)}>
                  <option>POST</option>
                  <option>PUT</option>
                </select>
              ) : (
                <input
                  className={INPUT}
                  type={kind === "number" ? "number" : "text"}
                  value={String(value ?? "")}
                  aria-describedby={key === "serviceUrl" ? "dest-service-url-help" : undefined}
                  onChange={(e) =>
                    setValue(key, kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)
                  }
                />
              )}
            </Field>
            {key === "serviceUrl" && (
              <span id="dest-service-url-help" className="text-[11px] text-ink-muted">Only for R2, MinIO or another S3-compatible service</span>
            )}
            </div>
          );
        })}
        {isGoogle(protocol) && (
          <GoogleTargetFields protocol={protocol} config={config} onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))} />
        )}
        {protocol === "http" && (
          <Field label="Sign in with">
            <select className={INPUT} value={auth} onChange={(e) => { setAuth(e.target.value); setCreds({}); }}>
              {Object.entries(AUTH_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        )}
        {credFields.map(([key, label]) => {
          const props = {
            value: creds[key] ?? "",
            placeholder: current?.hasCredentials ? "Leave blank to keep the saved one" : "",
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setCreds((c) => ({ ...c, [key]: e.target.value })),
          };
          return (
            <Field key={key} label={label}>
              {key === "privateKey" ? (
                // A key needs its line breaks, which a one-line input strips from a paste.
                <textarea {...props} rows={4} spellCheck={false} autoComplete="off"
                  className={INPUT.replace("h-9", "py-2 font-mono")} />
              ) : (
                <input {...props} className={INPUT} type="password" autoComplete="new-password" />
              )}
            </Field>
          );
        })}
        {protocol === "http" && <p className="text-[12px] text-ink-muted">Leave blank if the address needs no login.</p>}
        {current?.hasCredentials && credFields.length > 0 && <p className="text-[12px] text-ink-muted">Saved</p>}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={!current} loading={test.isPending} onClick={() => test.mutate()}>
            Send a test
          </Button>
        </div>
        <p className="text-[12px] text-ink-muted">
          A test sends the saved settings, so save your changes first. It is marked as a test: the file name starts
          with TEST_, an email subject starts with [TEST], and web requests carry a test header.
          {protocol === "google_sheets" && " This checks that ProcuLink can open the spreadsheet and the tab you chose. It adds no rows."}
        </p>
        {test.isError && <StatusNotice tone="error">{documentRefusalMessage(test.error)}</StatusNotice>}
        {result && (
          <StatusNotice tone={result.success ? "success" : "error"}>
            {result.message ?? (result.success ? "The test went through." : "The test failed.")}
          </StatusNotice>
        )}
      </div>
    </Card>
  );
}
