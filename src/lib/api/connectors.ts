/**
 * Group V7 — Connector Manifests API client.
 *
 * Three live endpoints:
 *   GET  /api/connector-manifests           → ConnectorManifest[]
 *   GET  /api/connector-manifests/{key}     → ConnectorManifest | 404
 *   POST /api/connector-manifests/{key}/validate-config
 *        body: Record<string,unknown>       → ValidateConnectorConfigResult
 *
 * Mock twins are provided for all six supported protocols so mock mode still
 * builds and renders without a running backend.
 */

import type {
  ConnectorManifest,
  ConnectorConfigField,
  ValidateConnectorConfigResult,
} from "./types";
import type { DeliveryProtocol } from "./types";
// D-2 fix: canonical authHeader (waits up to 5s for Clerk.loaded — the 48cea6e
// cold-mount fix) + base URL + USE_MOCK from core, replacing local copies whose
// authHeader read the token BEFORE Clerk loaded → 401 on a cold/hard page load.
import { authHeader, API_BASE_URL, USE_MOCK } from "./core";
import { serverReason } from "@/lib/serverText";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...auth,
      ...init?.headers,
    },
  });
  if (res.status === 404) throw new Error(`Not found: ${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ` + serverReason(text, res.statusText || `HTTP ${res.status}`));
  }
  return res.json() as Promise<T>;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

/** Static mock manifests covering all 6 real protocols. */
const MOCK_MANIFESTS: ConnectorManifest[] = [
  {
    key: "http",
    displayName: "HTTP / REST",
    transport: "http",
    authType: "None, API key, Bearer token, Basic, OAuth2",
    capabilities: "Synchronous POST or PUT to a supplier REST endpoint.",
    docsRef: null,
    fields: [
      { name: "url",            label: "Endpoint URL",    type: "url",    required: true,  secret: false, helpText: "Full HTTPS URL the dispatcher will POST/PUT to." },
      { name: "method",         label: "HTTP method",     type: "string", required: false, secret: false, helpText: "POST (default) or PUT." },
      { name: "timeoutSeconds", label: "Timeout (s)",     type: "number", required: false, secret: false, helpText: "Request timeout in seconds (default 30)." },
    ],
  },
  {
    key: "sftp",
    displayName: "SFTP",
    transport: "sftp",
    authType: "Password or private key",
    capabilities: "Upload the generated artifact to a remote SFTP server.",
    docsRef: null,
    fields: [
      { name: "host",            label: "Host",                    type: "string",  required: true,  secret: false, helpText: "SFTP server hostname or IP." },
      { name: "port",            label: "Port",                    type: "number",  required: false, secret: false, helpText: "Default 22." },
      { name: "remotePath",      label: "Remote path",             type: "string",  required: false, secret: false, helpText: "Destination directory on the server." },
      { name: "makeDirectories", label: "Create directories",      type: "bool",    required: false, secret: false, helpText: "Auto-create the remote directory if absent." },
      { name: "timeoutSeconds",  label: "Timeout (s)",             type: "number",  required: false, secret: false, helpText: "Connection timeout in seconds." },
      { name: "username",        label: "Username",                type: "string",  required: true,  secret: true,  helpText: "SFTP login username." },
      { name: "password",        label: "Password",                type: "secret",  required: false, secret: true,  helpText: "Password (leave blank when using a private key)." },
      { name: "privateKey",      label: "Private key (PEM)",       type: "secret",  required: false, secret: true,  helpText: "OpenSSH private key. Stored encrypted." },
    ],
  },
  {
    key: "ftps",
    displayName: "FTPS",
    transport: "ftps",
    authType: "Username / password",
    capabilities: "Upload via FTP over explicit TLS (FTPS).",
    docsRef: null,
    fields: [
      { name: "host",                   label: "Host",                       type: "string",  required: true,  secret: false, helpText: "FTPS server hostname or IP." },
      { name: "port",                   label: "Port",                       type: "number",  required: false, secret: false, helpText: "Default 21." },
      { name: "remotePath",             label: "Remote path",                type: "string",  required: false, secret: false, helpText: "Destination directory on the server." },
      { name: "makeDirectories",        label: "Create directories",         type: "bool",    required: false, secret: false, helpText: "Auto-create the remote directory if absent." },
      { name: "allowInvalidCertificate",label: "Allow invalid certificate",  type: "bool",    required: false, secret: false, helpText: "Only enable for suppliers with self-signed or expired certs." },
      { name: "timeoutSeconds",         label: "Timeout (s)",                type: "number",  required: false, secret: false, helpText: "Connection timeout in seconds." },
      { name: "username",               label: "Username",                   type: "string",  required: true,  secret: true,  helpText: "FTPS login username." },
      { name: "password",               label: "Password",                   type: "secret",  required: true,  secret: true,  helpText: "FTPS login password. Stored encrypted." },
    ],
  },
  {
    // The live, canonical email channel (Postmark over HTTPS) — "smtp" below is the
    // retired path, kept only because DeliveryProtocol still allows it. Sends FROM
    // ProcuLink's provider-verified sender, so there is no host/port/credentials to
    // configure. Mirrors ConnectorManifestCatalog.Email exactly.
    key: "email",
    displayName: "Email",
    transport: "email",
    authType: "none",
    capabilities: "Sends the artifact as an email attachment via a managed HTTP email API (HTTPS/443 — works where outbound SMTP is blocked); SPF/DKIM/DMARC handled by the provider; {poNumber} and {fileName} template placeholders; no SMTP server or credentials required.",
    docsRef: "https://docs.proculink.eu/connectors/email",
    fields: [
      { name: "toAddresses",        label: "Recipient(s)",       type: "string", required: true,  secret: false, helpText: "Supplier email address(es) — JSON array or comma-separated string." },
      { name: "replyTo",            label: "Reply-to",           type: "string", required: false, secret: false, helpText: "Buyer contact address set as Reply-To (optional)." },
      { name: "fromAddress",        label: "From address",       type: "string", required: false, secret: false, helpText: "Override the sender (optional; must be a provider-verified domain — defaults to ProcuLink's verified sender)." },
      { name: "subjectTemplate",    label: "Subject template",   type: "string", required: false, secret: false, helpText: "Email subject; supports {poNumber} and {fileName} placeholders." },
      { name: "bodyTemplate",       label: "Body template",      type: "string", required: false, secret: false, helpText: "Plain-text email body; supports {poNumber} and {fileName} placeholders." },
      { name: "attachmentFileName", label: "Attachment name",    type: "string", required: false, secret: false, helpText: "Override the attachment filename (default: the generated artifact filename)." },
    ],
  },
  {
    key: "smtp",
    displayName: "Email (SMTP)",
    transport: "smtp",
    authType: "Username / password",
    capabilities: "Send the generated artifact as an email attachment.",
    docsRef: null,
    fields: [
      { name: "host",               label: "SMTP host",                type: "string",  required: true,  secret: false, helpText: "SMTP server hostname." },
      { name: "port",               label: "Port",                     type: "number",  required: false, secret: false, helpText: "587 (STARTTLS, default) or 465 (SSL)." },
      { name: "fromAddress",        label: "From address",             type: "string",  required: true,  secret: false, helpText: "Sender email address." },
      { name: "toAddresses",        label: "Recipients",               type: "string",  required: true,  secret: false, helpText: "Comma-separated recipient email addresses." },
      { name: "useSsl",             label: "Use SSL",                  type: "bool",    required: false, secret: false, helpText: "Implicit TLS (port 465). Leave off for STARTTLS." },
      { name: "subjectTemplate",    label: "Subject template",         type: "string",  required: false, secret: false, helpText: "Supports {poNumber} and {fileName} placeholders." },
      { name: "bodyTemplate",       label: "Body template",            type: "string",  required: false, secret: false, helpText: "Email body text. Supports {poNumber} and {fileName}." },
      { name: "attachmentFileName", label: "Attachment file name",     type: "string",  required: false, secret: false, helpText: "Defaults to the generated artifact file name." },
      { name: "timeoutSeconds",     label: "Timeout (s)",              type: "number",  required: false, secret: false, helpText: "Connection timeout in seconds." },
      { name: "username",           label: "Username",                 type: "string",  required: false, secret: true,  helpText: "SMTP login username." },
      { name: "password",           label: "Password",                 type: "secret",  required: false, secret: true,  helpText: "SMTP login password. Stored encrypted." },
    ],
  },
  {
    key: "erp_erply",
    displayName: "Erply ERP",
    transport: "erp",
    authType: "Bearer token / API key",
    capabilities: "Submit POs directly to the Erply REST API.",
    docsRef: "https://learn.erply.com/",
    fields: [
      { name: "url",            label: "Erply API URL",    type: "url",    required: true,  secret: false, helpText: "Base API endpoint (e.g. https://YOURCODE.erply.com/api/)." },
      { name: "clientCode",     label: "Client code",      type: "string", required: true,  secret: false, helpText: "Erply account client code (e.g. ACME)." },
      { name: "timeoutSeconds", label: "Timeout (s)",      type: "number", required: false, secret: false, helpText: "Request timeout in seconds." },
    ],
  },
  {
    key: "erp_directo",
    displayName: "Directo ERP",
    transport: "erp",
    authType: "Basic auth + optional API key",
    capabilities: "Submit POs to the Directo XML API.",
    docsRef: "https://wiki.directo.ee/",
    fields: [
      { name: "url",            label: "Directo XML API URL", type: "url",    required: true,  secret: false, helpText: "e.g. https://login.directo.ee/xmlcore." },
      { name: "database",       label: "Database",            type: "string", required: true,  secret: false, helpText: "Directo company database name." },
      { name: "timeoutSeconds", label: "Timeout (s)",         type: "number", required: false, secret: false, helpText: "Request timeout in seconds." },
      { name: "user",           label: "Username",            type: "string", required: true,  secret: true,  helpText: "Directo login username." },
      { name: "password",       label: "Password",            type: "secret", required: true,  secret: true,  helpText: "Directo login password. Stored encrypted." },
      { name: "key",            label: "API key (optional)",  type: "secret", required: false, secret: true,  helpText: "Optional Directo API key for token-based auth." },
    ],
  },
];

const MOCK_BY_KEY = new Map<string, ConnectorManifest>(
  MOCK_MANIFESTS.map((m) => [m.key, m]),
);

// ── At-least-once resend caveat ──────────────────────────────────────────────
// Mirrors the backend's per-dispatcher ResendSafety tier (ProcuLink.Core.Services.
// Delivery.ResendSafety), which decides whether a crash-recovery re-drive with an
// unknown outcome is safe to re-send or must park the order (delivery_unconfirmed)
// instead. There is no wire field for this yet, so it is attached client-side to
// every manifest — mock AND live — rather than only ever appearing in mock mode.
const RESEND_CAVEATS: Partial<Record<DeliveryProtocol, string>> = {
  // Safe: the remote file name is fixed per order, so a repeat can never become a second document.
  // It does NOT always overwrite — with "replace existing files" off it refuses instead, and the
  // order is held for the operator rather than reported as a failure. The wording has to cover both,
  // because it renders on the LIVE manifests as well as the mock ones (see withResendCaveat).
  sftp: "A repeat send always uses the same file name for that order, so the supplier can never end up with two copies. If you switch off \"replace existing files\", a repeat won't overwrite either — it stops, and we ask you what to do rather than guess.",
  ftps: "A repeat send always uses the same file name for that order, so the supplier can never end up with two copies. If you switch off \"replace existing files\", a repeat won't overwrite either — it stops, and we ask you what to do rather than guess.",
  // BestEffort: a dedupe signal is sent (HTTP Idempotency-Key header), but honouring
  // it is the endpoint's choice — worded plainly here since this text renders in the UI.
  http: "We tag every request so an endpoint built to check for repeats can recognize and ignore one — but honouring that is the endpoint's choice, not something we control.",
  // Unsafe: no dedupe signal reaches the counterparty, so an unknown outcome parks
  // the order for a human instead of silently resending it.
  email: "We can't tell whether a repeat would arrive twice, so if a send's outcome is ever unknown, we ask you instead of resending it automatically.",
  smtp: "We can't tell whether a repeat would arrive twice, so if a send's outcome is ever unknown, we ask you instead of resending it automatically.",
  erp_erply: "We can't tell whether a repeat would arrive twice, so if a send's outcome is ever unknown, we ask you instead of resending it automatically.",
  erp_directo: "We can't tell whether a repeat would arrive twice, so if a send's outcome is ever unknown, we ask you instead of resending it automatically.",
};

/** Attaches the caveat above by protocol key. Applied to mock AND real manifests alike. */
function withResendCaveat(m: ConnectorManifest): ConnectorManifest {
  return { ...m, resendCaveat: RESEND_CAVEATS[m.key as DeliveryProtocol] ?? null };
}

/** Mock validate: checks that all required non-secret field names are present. */
function mockValidate(
  manifest: ConnectorManifest,
  config: Record<string, unknown>,
): ValidateConnectorConfigResult {
  const required = manifest.fields
    .filter((f): f is ConnectorConfigField => f.required && !f.secret)
    .map((f) => f.name);
  const allNonSecret = manifest.fields
    .filter((f) => !f.secret)
    .map((f) => f.name);
  const declared = new Set(allNonSecret);

  const missing = required.filter(
    (name) =>
      !(name in config) ||
      config[name] === null ||
      config[name] === undefined ||
      config[name] === "",
  );
  const unknown = Object.keys(config).filter((k) => !declared.has(k));

  return { valid: missing.length === 0 && unknown.length === 0, missing, unknown };
}

// ── Mock implementations ──────────────────────────────────────────────────────

async function mockListConnectorManifests(): Promise<ConnectorManifest[]> {
  return MOCK_MANIFESTS.map(withResendCaveat);
}

async function mockGetConnectorManifest(key: DeliveryProtocol): Promise<ConnectorManifest> {
  const m = MOCK_BY_KEY.get(key);
  if (!m) throw new Error(`Connector manifest not found: ${key}`);
  return withResendCaveat(m);
}

async function mockValidateConnectorConfig(
  key: DeliveryProtocol,
  configObject: Record<string, unknown>,
): Promise<ValidateConnectorConfigResult> {
  const m = MOCK_BY_KEY.get(key);
  if (!m) throw new Error(`Connector manifest not found: ${key}`);
  return mockValidate(m, configObject);
}

// ── Real implementations ──────────────────────────────────────────────────────

async function realListConnectorManifests(): Promise<ConnectorManifest[]> {
  // Backticked with nothing to interpolate, on purpose — see the note in
  // src/lib/api/inboundEmail.ts. The reachability sweep reads template literals only.
  const manifests = await apiFetch<ConnectorManifest[]>(`/connector-manifests`);
  return manifests.map(withResendCaveat);
}

async function realGetConnectorManifest(key: DeliveryProtocol): Promise<ConnectorManifest> {
  const manifest = await apiFetch<ConnectorManifest>(`/connector-manifests/${encodeURIComponent(key)}`);
  return withResendCaveat(manifest);
}

async function realValidateConnectorConfig(
  key: DeliveryProtocol,
  configObject: Record<string, unknown>,
): Promise<ValidateConnectorConfigResult> {
  return apiFetch<ValidateConnectorConfigResult>(
    `/connector-manifests/${encodeURIComponent(key)}/validate-config`,
    { method: "POST", body: JSON.stringify(configObject) },
  );
}

// ── Exported API functions ────────────────────────────────────────────────────

/**
 * List all connector manifests.
 * GET /api/connector-manifests → ConnectorManifest[]
 */
export const listConnectorManifests: () => Promise<ConnectorManifest[]> =
  USE_MOCK ? mockListConnectorManifests : realListConnectorManifests;

/**
 * Get the manifest for a single connector by its protocol key.
 * GET /api/connector-manifests/{key} → ConnectorManifest | 404
 */
export const getConnectorManifest: (key: DeliveryProtocol) => Promise<ConnectorManifest> =
  USE_MOCK ? mockGetConnectorManifest : realGetConnectorManifest;

/**
 * Validate a config object against the connector's manifest.
 * POST /api/connector-manifests/{key}/validate-config → ValidateConnectorConfigResult
 *
 * Advisory only — nothing is persisted and the save path is not affected.
 * Never include secret values in configObject; pass only the non-secret config keys.
 */
export const validateConnectorConfig: (
  key: DeliveryProtocol,
  configObject: Record<string, unknown>,
) => Promise<ValidateConnectorConfigResult> =
  USE_MOCK ? mockValidateConnectorConfig : realValidateConnectorConfig;
