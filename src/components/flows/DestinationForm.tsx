"use client";

import { cloneElement, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/bridge/DSPrimitives";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { TestOutcome } from "@/components/destinations/TestOutcome";
import { createDestination, testDestination, updateDestination } from "@/lib/api/documents";
import type { Destination, DestinationRequest } from "@/lib/api/documents";
import { MANAGED_CONFIG_KEYS } from "@/lib/deliveryConfigKeys";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { GoogleTargetFields, useLinkedAccounts } from "./GoogleTargetFields";

type Kind = "text" | "number" | "check" | "method" | "environment";
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
  nip: ["NIP", "text"],
  environment: ["KSeF environment", "environment"],
  // No attachmentFileName box: a flow send always names the attachment after the document.
};

/** The common places first; the server kinds are grouped under "A server or another system" (plan 16a R17). */
const PROTOCOLS = {
  email: "Email", google_drive: "Google Drive", google_sheets: "Google Sheets", microsoft_onedrive: "OneDrive",
  sftp: "SFTP", ftps: "FTPS", s3: "S3 bucket", http: "Web address (API)", ksef: "KSeF",
} as const;
const SERVER = new Set(["sftp", "ftps", "s3", "http", "ksef"]);
type Protocol = keyof typeof PROTOCOLS;
const isGoogle = (p: string): p is "google_drive" | "google_sheets" => p === "google_drive" || p === "google_sheets";
/** Sends through a connected account (Google, or Microsoft for OneDrive), so it has no login of its own. */
const isLinked = (p: string): p is "google_drive" | "google_sheets" | "microsoft_onedrive" => isGoogle(p) || p === "microsoft_onedrive";
const DEFAULTS: Record<Protocol, Record<string, unknown>> = {
  http: { method: "POST", timeoutSeconds: 30 },
  sftp: { port: 22, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  ftps: { port: 21, makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  email: {},
  s3: {},
  google_drive: {},
  google_sheets: {},
  microsoft_onedrive: {},
  ksef: { environment: "test" },
};
/** Production is offered only on an edit; an unknown or absent environment checks no option (plan 33). */
const KSEF_ENVIRONMENTS = {
  test: "Test: fictitious data, no legal effect",
  demo: "Demo: your own token, fictitious invoices, no legal effect",
  production: "Production: real invoices with legal effect",
};
const ISSUER_TICK = "I confirm that every invoice sent from this destination is issued in KSeF in my company's name. My company is the issuer and is responsible for each invoice's content and for checking it before it is sent. Each one is sent only when a person confirms it.";
const KSEF_TOKEN_HELP = "Paste a KSeF token made for this NIP in Aplikacja Podatnika KSeF, with permission to issue invoices. We keep it encrypted and use it only to test the sign-in and to send invoices a person confirms. It is never shown again. Tokens expire; when yours does, sends stop with a message and you paste a new one. If you give your buyer a printed or PDF copy of an invoice issued in KSeF, it must carry the KSeF QR code; ProcuLink doesn't add it.";

type CredField = [key: string, label: string];
const LOGIN: CredField[] = [["username", "Username"], ["password", "Password"]];
const SFTP_LOGIN: CredField[] = [...LOGIN, ["privateKey", "Private key (instead of password)"], ["privateKeyPassphrase", "Key passphrase (optional)"]];
const HTTP_AUTH: Record<string, CredField[]> = {
  bearer: [["token", "Token"]],
  apikey: [["header", "Header name"], ["value", "Key"]],
  basic: LOGIN,
};
const S3_SECRET: CredField[] = [["secretKey", "Secret access key"]];
const KSEF_TOKEN: CredField[] = [["token", "KSeF token"]];
const AUTH_LABEL = { bearer: "Bearer token", apikey: "API key", basic: "Username and password" };
/** Secrets: with a login saved, the box asks for a new one. */
const SECRETS = new Set(["password", "token", "value", "secretKey", "privateKey"]);

/** What is rarely changed sits behind "More options"; the hint says what is there. */
const FOLDED = new Set(["port", "timeoutSeconds", "makeDirectories", "overwriteExisting", "allowInvalidCertificate", "method",
  "replyTo", "subjectTemplate", "bodyTemplate", "region", "serviceUrl", "privateKey", "privateKeyPassphrase"]);
const FOLD_HINT: Record<string, string> = {
  sftp: "port, private key, folder and file rules", ftps: "port, certificate, folder and file rules",
  http: "request method, time limit", email: "reply-to address, subject, message", s3: "region, endpoint",
};
const FILES = "The test file's name starts with TEST_, so it is easy to spot.";
const TEST_NOTE: Record<string, string> = {
  sftp: FILES, ftps: FILES, s3: FILES, google_drive: FILES, microsoft_onedrive: FILES,
  email: "The test email's subject starts with [TEST], so it is easy to spot.",
  http: "The test request carries the header X-ProcuLink-Test, so it is easy to spot.",
  google_sheets: "The test checks that ProcuLink can open the spreadsheet and the tab you chose. It adds no rows.",
  ksef: "A test only signs in to KSeF with your token. It never sends an invoice.",
};

export const INPUT_BASE = "w-full rounded-md border border-border-strong bg-surface px-3 text-[14px] font-medium text-ink";
export const INPUT = `h-10 ${INPUT_BASE}`;
export const ICON_BUTTON = "inline-flex h-10 w-10 flex-none items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink max-sm:h-11 max-sm:w-11";
// Imported here, beside the one component that uses them, so this change stays one hunk.
/**
 * `look`: the sentence under the control when a value needs a look; it also gives the control an amber edge.
 * It sits outside the label and describes the control, so a screen reader names the box by its label alone (R22).
 * `hideLabel`: the label is for screen readers only (a table cell).
 */
export const Field = ({ label, look, hideLabel, children }: { label: string; look?: React.ReactNode; hideLabel?: boolean; children: React.ReactElement<{ "aria-describedby"?: string }> }) => {
  const id = useId();
  const field = (
    <label className="block">
      <span className={hideLabel ? "sr-only" : "mb-1.5 block text-[13px] font-semibold text-ink-muted"}>{label}</span>
      {look ? cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") }) : children}
    </label>
  );
  if (!look) return field;
  return (
    <div className="plk-look">
      {field}
      <p id={id} className="mt-1.5 text-[12.5px] font-medium text-amber-text">{look}</p>
    </div>
  );
};

export function DestinationForm({ destination, preset, inline, testAfterSave, chosen, onSaved, onCancel }: {
  destination?: Destination; /** Seeds a new web-address destination. */ preset?: { url: string; method?: string; authType?: string };
  /** No card: the fields sit in the panel's grid. */ inline?: boolean;
  /** One "Save and send a test" instead of "Save" and "Send a test". */ testAfterSave?: boolean;
  /** First run (14.5): the protocols it may save ("Send by" hidden for one), the name it saves under instead of a Name box,
   *  and each finished test of the saved destination. After a save, or with `outlined` (the step's own button is filled), its button is outlined. */
  chosen?: { protocols: readonly string[]; name: string; onTested(outcome: { destinationId: string; ok: boolean }): void; outlined?: boolean };
  onSaved(d: Destination): void; onCancel(): void;
}) {
  const qc = useQueryClient();
  // Filled on the flow page too: the changes bar, the page's other filled button, hides while this form is open (globals.css).
  const filled = "primary";
  const [current, setCurrent] = useState(destination);
  const [name, setName] = useState(destination?.name ?? chosen?.name ?? "");
  const first = (chosen?.protocols[0] ?? (preset ? "http" : "email")) as Protocol;
  const [protocol, setProtocol] = useState<Protocol>((destination?.protocol as Protocol) ?? first);
  const [config, setConfig] = useState<Record<string, unknown>>(
    destination?.config ?? { ...DEFAULTS[first], ...(preset && { url: preset.url, ...(preset.method && { method: preset.method.toUpperCase() }) }) });
  const [auth, setAuth] = useState(preset?.authType && Object.hasOwn(HTTP_AUTH, preset.authType) ? preset.authType : "bearer");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const hintId = useId();
  const [saved, setSaved] = useState(false);
  // Google kinds are offered only when the server says so; a failed list counts as "not available".
  const linked = useLinkedAccounts().data;
  const googleOn = linked?.available === true;
  const microsoftOn = linked?.microsoftAvailable === true;
  const ksefOn = linked?.ksefAvailable === true;
  const [issuer, setIssuer] = useState(false);

  const credFields: CredField[] =
    protocol === "http" ? HTTP_AUTH[auth] : protocol === "email" || isLinked(protocol) ? [] : protocol === "s3" ? S3_SECRET : protocol === "ksef" ? KSEF_TOKEN : protocol === "sftp" ? SFTP_LOGIN : LOGIN;
  const keys = MANAGED_CONFIG_KEYS[protocol] ?? [];

  const typed = Object.fromEntries(credFields.filter(([k]) => creds[k]?.trim()).map(([k]) => [k, creds[k]]));
  if (typed.privateKey) delete typed.password;
  // Saving replaces the stored login wholesale, so a half-filled one must never be sent.
  const required = protocol === "http" || protocol === "s3" || protocol === "ksef" ? credFields.map(([k]) => k) : typed.privateKey ? ["username", "privateKey"] : ["username", "password"];
  const loginIncomplete = Object.keys(typed).length > 0 && required.some((k) => !typed[k]);
  // Switching a KSeF destination to Production needs the issuer tick, which the save carries (plan 33, C5.4).
  const toProduction = protocol === "ksef" && config.environment === "production" && current?.config?.environment !== "production";

  const test = useMutation({
    mutationFn: (id: string) => testDestination(id),
    onSuccess: (r, id) => chosen?.onTested({ destinationId: id, ok: r.success }),
    onError: (_e, id) => chosen?.onTested({ destinationId: id, ok: false }),
    // The list shows each destination's last send, and a test is one.
    onSettled: () => qc.invalidateQueries({ queryKey: ["destinations"] }),
  });
  // Held from the press itself, so a second press before the next render saves nothing more.
  const busy = useRef(false);
  const save = useMutation({
    mutationFn: (body: DestinationRequest) => (current ? updateDestination(current.id, body) : createDestination(body)),
    onSettled: () => { busy.current = false; },
    // Clearing the typed login keeps the saved credentials write-only: they are never shown again.
    onSuccess: (d) => {
      setCurrent(d); setCreds({}); setProblem(null); setSaved(true); test.reset(); onSaved(d);
      if (protocol === "microsoft_onedrive") setConfig(d.config); // the pasted link is gone; the resolved folder shows
      if (testAfterSave) test.mutate(d.id);
    },
    onError: (e) => setProblem(documentRefusalMessage(e)),
  });

  function submit() {
    if (busy.current || save.isPending || test.isPending) return;
    if (!name.trim()) return setProblem("Give this destination a name.");
    if (loginIncomplete)
      return setProblem("Fill in every login field, or leave them all blank to keep the saved login.");
    const credentials = Object.keys(typed).length ? (protocol === "http" ? { type: auth, ...typed } : typed) : null;
    // A kind this build does not know: the form owns none of its keys, so they go back as they were read.
    const kept = Object.hasOwn(PROTOCOLS, protocol)
      ? Object.fromEntries(Object.entries(config).filter(([k, v]) => v !== "" && (keys.includes(k) || !(k in CONFIG_FIELDS))))
      : config;
    if (toProduction && !issuer) return;
    busy.current = true;
    save.mutate({ name: name.trim(), protocol, config: toProduction ? { ...kept, acceptedIssuerTerms: true } : kept, credentials });
  }

  // A passed test belongs to the settings it tested: any edit after a save un-tests it until it is saved and tested again.
  const edited = () => { if (chosen && current) { chosen.onTested({ destinationId: current.id, ok: false }); setSaved(false); } };
  const setValue = (key: string, value: unknown) => { edited(); setConfig((c) => ({ ...c, [key]: value })); };
  const configField = (key: string) => {
    const [label, kind] = CONFIG_FIELDS[key];
    const value = config[key];
    if (kind === "environment")
      return (
        <fieldset key={key} className="col-span-full grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-muted">{label}</legend>
          {Object.entries(KSEF_ENVIRONMENTS).filter(([id]) => id !== "production" || current).map(([id, text]) => (
            <label key={id} className="flex items-center gap-2 text-[13px] text-ink">
              <input type="radio" name={`${hintId}-${key}`} checked={value === id} onChange={() => { setIssuer(false); setValue(key, id); }} />
              {text}
            </label>
          ))}
          {toProduction && (
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="checkbox" className="mt-0.5" checked={issuer} onChange={(e) => setIssuer(e.target.checked)} />
              {ISSUER_TICK}
            </label>
          )}
        </fieldset>
      );
    if (kind === "check")
      return (
        <label key={key} className="flex items-center gap-2 text-[13px] text-ink">
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
          <span id="dest-service-url-help" className="text-[13px] text-ink-muted">Only for R2, MinIO or another S3-compatible service</span>
        )}
      </div>
    );
  };
  const credField = ([key, label]: CredField) => {
    const props = {
      value: creds[key] ?? "",
      placeholder: current?.hasCredentials ? "Leave blank to keep the saved one" : "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        edited();
        setCreds((c) => ({ ...c, [key]: e.target.value }));
      },
    };
    return (
      <Field key={key} label={current?.hasCredentials && SECRETS.has(key) ? `New ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}>
        {key === "privateKey" ? (
          // A key needs its line breaks, which a one-line input strips from a paste.
          <textarea {...props} rows={4} spellCheck={false} autoComplete="off"
            className={`${INPUT_BASE} py-2 font-mono`} />
        ) : (
          <input {...props} className={INPUT} type="password" autoComplete="new-password" />
        )}
      </Field>
    );
  };
  const fields = keys.filter((k) => k in CONFIG_FIELDS);
  const folded = [...fields.filter((k) => FOLDED.has(k)).map(configField), ...credFields.filter(([k]) => FOLDED.has(k)).map(credField)];
  const note = TEST_NOTE[protocol];
  const offered = Object.entries(PROTOCOLS).filter(([id]) => (chosen ? chosen.protocols.includes(id)
    : (isGoogle(id) ? googleOn : id === "microsoft_onedrive" ? microsoftOn : id !== "ksef" || ksefOn) || id === protocol));

  const body = (
    // Not a <form>: this sits inside the output and draft-review forms, and a nested form's Save
    // either submits the outer form too or, with a password manager installed, reloads the page.
    <div data-plk-destform className={inline ? "grid min-w-0 max-w-[840px] grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3" : "grid gap-3"}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); submit(); } }}>
      {chosen ? <p className="col-span-full m-0 text-[14px] text-ink">We&apos;ll save this destination as {chosen.name}.</p> : (
        <Field label="Name">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {!destination && (chosen?.protocols.length ?? 2) > 1 && (
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
            {offered.filter(([id]) => chosen || !SERVER.has(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            {/* The first run already chose the server tile, so its two kinds need no group of their own. */}
            {!chosen && offered.some(([id]) => SERVER.has(id)) && (
              <optgroup label="A server or another system">
                {offered.filter(([id]) => SERVER.has(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
      )}
      {fields.filter((k) => !FOLDED.has(k)).map(configField)}
      {isLinked(protocol) && (
        <GoogleTargetFields protocol={protocol} config={config} onChange={(patch) => { edited(); setConfig((c) => ({ ...c, ...patch })); }} />
      )}
      {protocol === "http" && (
        <Field label="Sign in with">
          <select className={INPUT} value={auth} onChange={(e) => { edited(); setAuth(e.target.value); setCreds({}); }}>
            {Object.entries(AUTH_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
      )}
      {credFields.filter(([k]) => !FOLDED.has(k)).map(credField)}
      {protocol === "http" && <p className="col-span-full text-[13px] text-ink-muted">Leave blank if the address needs no login.</p>}
      {protocol === "ksef" && <p className="col-span-full text-[13px] text-ink-muted">{KSEF_TOKEN_HELP}</p>}
      {current?.hasCredentials && credFields.length > 0 && (
        <p className="col-span-full text-[13px] text-ink-muted">A login is saved. Leave the login boxes blank to keep it.</p>
      )}
      {folded.length > 0 && (
        <button type="button" aria-expanded={more} aria-label="More options" aria-describedby={hintId} onClick={() => setMore((m) => !m)}
          className="col-span-full inline-flex items-center gap-2 justify-self-start text-[13px] font-semibold text-ink">
          More options <span id={hintId} className="font-normal text-ink-muted">{FOLD_HINT[protocol]}</span>
        </button>
      )}
      {more && folded}
      {problem && <StatusNotice tone="error" className="col-span-full">{problem}</StatusNotice>}
      <div className="col-span-full flex flex-wrap gap-2">
        {testAfterSave ? (
          <Button type="button" variant={chosen && (saved || chosen.outlined) ? "secondary" : filled} loading={save.isPending || test.isPending} onClick={submit}>Save and send a test</Button>
        ) : (
          <Button type="button" variant={filled} loading={save.isPending} disabled={toProduction && !issuer} onClick={submit}>Save</Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>{saved ? "Close" : "Cancel"}</Button>
        {!testAfterSave && (
          <Button type="button" variant="secondary" disabled={!current} loading={test.isPending} onClick={() => test.mutate(current!.id)}>
            Send a test
          </Button>
        )}
      </div>
      {(note || !testAfterSave) && (
        <p className="col-span-full text-[13px] text-ink-muted">
          {[!testAfterSave && "A test sends the saved settings, so save your changes first.", note].filter(Boolean).join(" ")}
        </p>
      )}
      {current && (test.data || test.isError) && (
        <div className="col-span-full">
          <TestOutcome destinationId={current.id} protocol={protocol} result={test.data ?? null} error={test.error}
            at={test.submittedAt} place="form" />
        </div>
      )}
    </div>
  );
  return inline ? body : <Card edge="green" title={current ? "Edit destination" : "New destination"}>{body}</Card>;
}
