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
  attachmentFileName: ["Attachment file name", "text"],
};

const PROTOCOLS = { http: "Web address (API)", sftp: "SFTP", ftps: "FTPS", email: "Email" } as const;
type Protocol = keyof typeof PROTOCOLS;
const DEFAULTS: Record<Protocol, Record<string, unknown>> = {
  http: { method: "POST", timeoutSeconds: 30 },
  sftp: { port: 22, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  ftps: { port: 21, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  email: {},
};

type CredField = [key: string, label: string];
const LOGIN: CredField[] = [["username", "Username"], ["password", "Password"]];
const SFTP_LOGIN: CredField[] = [...LOGIN, ["privateKey", "Private key (instead of password)"], ["privateKeyPassphrase", "Key passphrase (optional)"]];
const HTTP_AUTH: Record<string, CredField[]> = {
  bearer: [["token", "Token"]],
  apikey: [["header", "Header name"], ["value", "Key"]],
  basic: LOGIN,
};
const AUTH_LABEL = { bearer: "Bearer token", apikey: "API key", basic: "Username and password" };

const INPUT = "h-9 w-full rounded border border-border bg-surface px-2.5 text-[13px] text-ink";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-[12px] font-medium text-ink-muted">
    <span className="mb-1 block">{label}</span>
    {children}
  </label>
);

export function DestinationForm({ destination, onSaved, onCancel }: {
  destination?: Destination; onSaved(d: Destination): void; onCancel(): void;
}) {
  const [current, setCurrent] = useState(destination);
  const [name, setName] = useState(destination?.name ?? "");
  const [protocol, setProtocol] = useState<Protocol>((destination?.protocol as Protocol) ?? "http");
  const [config, setConfig] = useState<Record<string, unknown>>(destination?.config ?? DEFAULTS.http);
  const [auth, setAuth] = useState("bearer");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const credFields: CredField[] =
    protocol === "http" ? HTTP_AUTH[auth] : protocol === "email" ? [] : protocol === "sftp" ? SFTP_LOGIN : LOGIN;

  const typed = Object.fromEntries(credFields.filter(([k]) => creds[k]?.trim()).map(([k]) => [k, creds[k]]));
  if (typed.privateKey) delete typed.password;
  // Saving replaces the stored login wholesale, so a half-filled one must never be sent.
  const required = protocol === "http" ? credFields.map(([k]) => k) : typed.privateKey ? ["username", "privateKey"] : ["username", "password"];
  const loginIncomplete = Object.keys(typed).length > 0 && required.some((k) => !typed[k]);

  const test = useMutation({ mutationFn: () => testDestination(current!.id) });
  const save = useMutation({
    mutationFn: (body: DestinationRequest) => (current ? updateDestination(current.id, body) : createDestination(body)),
    onSuccess: (d) => { setCurrent(d); setProblem(null); test.reset(); onSaved(d); },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
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
      <form onSubmit={submit} className="grid gap-3">
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
            {Object.entries(PROTOCOLS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
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
            <Field key={key} label={label}>
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
                  onChange={(e) =>
                    setValue(key, kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)
                  }
                />
              )}
            </Field>
          );
        })}
        {protocol === "http" && (
          <Field label="Sign in with">
            <select className={INPUT} value={auth} onChange={(e) => { setAuth(e.target.value); setCreds({}); }}>
              {Object.entries(AUTH_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        )}
        {credFields.map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className={INPUT}
              type="password"
              autoComplete="new-password"
              value={creds[key] ?? ""}
              placeholder={current?.hasCredentials ? "Leave blank to keep the saved one" : ""}
              onChange={(e) => setCreds((c) => ({ ...c, [key]: e.target.value }))}
            />
          </Field>
        ))}
        {protocol === "http" && <p className="text-[12px] text-ink-muted">Leave blank if the address needs no login.</p>}
        {current?.hasCredentials && credFields.length > 0 && <p className="text-[12px] text-ink-muted">Saved</p>}
        {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={!current} loading={test.isPending} onClick={() => test.mutate()}>
            Send a test
          </Button>
        </div>
        <p className="text-[12px] text-ink-muted">
          A test sends the saved settings, so save your changes first. It is marked as a test: the file name starts
          with TEST_, an email subject starts with [TEST], and web requests carry a test header.
        </p>
        {test.isError && <StatusNotice tone="error">{documentRefusalMessage(test.error)}</StatusNotice>}
        {result && (
          <StatusNotice tone={result.success ? "success" : "error"}>
            {result.message ?? (result.success ? "The test went through." : "The test failed.")}
          </StatusNotice>
        )}
      </form>
    </Card>
  );
}
