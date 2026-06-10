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

// ── Internal helpers ──────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5223";

const USE_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === "true" &&
  process.env.NODE_ENV !== "production";

async function authHeader(): Promise<Record<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await (window as any).Clerk?.session?.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
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
  return [...MOCK_MANIFESTS];
}

async function mockGetConnectorManifest(key: DeliveryProtocol): Promise<ConnectorManifest> {
  const m = MOCK_BY_KEY.get(key);
  if (!m) throw new Error(`Connector manifest not found: ${key}`);
  return { ...m };
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
  return apiFetch<ConnectorManifest[]>("/connector-manifests");
}

async function realGetConnectorManifest(key: DeliveryProtocol): Promise<ConnectorManifest> {
  return apiFetch<ConnectorManifest>(`/connector-manifests/${encodeURIComponent(key)}`);
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
