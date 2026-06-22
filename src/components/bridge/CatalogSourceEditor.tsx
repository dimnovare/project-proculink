"use client";

import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Trash2, Zap, AlertTriangle } from "lucide-react";
import {
  deleteCatalogSource,
  getCatalogSource,
  testFetchCatalogSource,
  upsertCatalogSource,
} from "@/lib/api/catalogSources";
import type {
  CatalogHttpAuthMethod,
  CatalogSource,
  CatalogSourceProtocol,
  CatalogSourceTestResult,
} from "@/lib/api/catalogSources";
import { isArrowKey, rovingRadioNext } from "@/lib/roving-radio";
import {
  buildAuthConfigPayload,
  defaultPortForProtocol,
  formatLastSync,
  hasSavedAuthSecretForMethod,
  httpAuthFormSatisfied,
  protocolUsesUrl,
  type CatalogAuthFormState,
} from "./catalogSourceHelpers";

const INPUT_STYLE = { border: "1px solid #D5DAEA", color: "#0B1A2F" } as const;

// HTTPS + FTPS/SFTP first to default-discourage plaintext FTP / cleartext HTTP.
const PROTOCOLS: Array<{ id: CatalogSourceProtocol; label: string }> = [
  { id: "https", label: "HTTPS API (encrypted)" },
  { id: "http", label: "HTTP API (not encrypted)" },
  { id: "sftp", label: "SFTP" },
  { id: "ftps", label: "FTPS" },
  { id: "ftp", label: "FTP" },
];

// Only the five auth methods the backend implements. Labels mirror DeliveryConfigEditor.
const AUTH_METHODS: Array<{ id: CatalogHttpAuthMethod; label: string }> = [
  { id: "none", label: "None" },
  { id: "apikey", label: "API key (header)" },
  { id: "bearer", label: "Bearer token" },
  { id: "basic", label: "Basic auth" },
  { id: "oauth2_client_credentials", label: "OAuth2 — client credentials" },
];

interface CatalogSourceEditorProps {
  supplierId: string;
}

export function CatalogSourceEditor({ supplierId }: CatalogSourceEditorProps) {
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedSource, setSavedSource] = useState<CatalogSource | null>(null);

  const [protocol, setProtocol] = useState<CatalogSourceProtocol>("https");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [schedule, setSchedule] = useState<number | "">(24);
  const [fileFormat, setFileFormat] = useState("auto");
  const [isEnabled, setIsEnabled] = useState(false);

  // HTTP/HTTPS — URL + auth method + per-method write-only credentials.
  const [url, setUrl] = useState("");
  const [authMethod, setAuthMethod] = useState<CatalogHttpAuthMethod>("none");
  const [apiKeyHeader, setApiKeyHeader] = useState("X-Api-Key");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState("");

  const [testResult, setTestResult] = useState<CatalogSourceTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const source = await getCatalogSource(supplierId);
        if (cancelled) return;
        setSavedSource(source);
        if (source) hydrate(source);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load import source.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  function hydrate(s: CatalogSource) {
    setProtocol(s.protocol);
    setHost(s.host);
    setPort(s.port || defaultPortForProtocol(s.protocol));
    setUsername(s.username ?? "");
    setRemotePath(s.remotePath);
    setSchedule(s.syncIntervalHours || 24);
    setFileFormat(s.fileFormat || "auto");
    setIsEnabled(s.isEnabled);
    setPassword("");
    // http/https
    setUrl(s.url ?? "");
    setAuthMethod(s.authMethod ?? "none");
    setApiKeyHeader("X-Api-Key");
    setApiKeyValue("");
    setBearerToken("");
    setBasicUsername("");
    setBasicPassword("");
    setTokenUrl("");
    setClientId("");
    setClientSecret("");
    setScope("");
  }

  function markEdited() {
    setTestResult(null);
    setError(null);
    setNotice(null);
  }

  const isUrlProtocol = protocolUsesUrl(protocol);
  const hasPassword = savedSource?.hasPassword ?? false;

  // Shared by the click handler and the arrow-key radiogroup navigation.
  function selectProtocol(id: CatalogSourceProtocol) {
    setProtocol(id);
    if (!protocolUsesUrl(id)) {
      setPort((prev) => (prev === "" || prev === 0 ? defaultPortForProtocol(id) : prev));
    }
    markEdited();
  }

  // Roving-tabindex + arrow-key navigation so the protocol picker is keyboard
  // operable like a native radio group (only the checked option is tabbable;
  // Arrow keys move + select between protocols).
  function handleProtocolKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isArrowKey(event.key)) return;
    event.preventDefault();
    const nextId = rovingRadioNext(event.key, protocol, PROTOCOLS.map((p) => p.id));
    if (nextId === null) return;
    selectProtocol(nextId);
    requestAnimationFrame(() => document.getElementById(`catalog-protocol-${nextId}`)?.focus());
  }
  const usernameRequired = protocol === "sftp" || protocol === "ftps";
  const passwordRequired = protocol === "sftp" || protocol === "ftps";

  // Password write-only: "" sentinel means keep when one is already stored.
  function passwordPayload(): string | null {
    if (password.length > 0) return password; // set new
    if (hasPassword) return null; // keep stored
    return ""; // none / clear
  }

  // The HTTP auth form state, shared by the save-gate and the write-only payload
  // builder so the two can never disagree on keep-vs-replace.
  const authForm: CatalogAuthFormState = {
    authMethod,
    apiKeyHeader,
    apiKeyValue,
    bearerToken,
    basicUsername,
    basicPassword,
    tokenUrl,
    clientId,
    clientSecret,
    scope,
  };
  // "Leave blank to keep" is only honest when the saved secret belongs to the SAME
  // method — the backend keeps the old encrypted blob (and applies ITS auth type at
  // fetch time) whenever authConfig is null, so a method switch must re-enter creds.
  const savedAuthSecretForMethod = hasSavedAuthSecretForMethod(savedSource, authMethod);
  const savedAuthMethodDiffers =
    isUrlProtocol &&
    (savedSource?.hasAuthConfig ?? false) &&
    authMethod !== "none" &&
    savedSource?.authMethod !== authMethod;

  const canSave = isUrlProtocol
    ? Boolean(url.trim()) && httpAuthFormSatisfied(authForm, savedAuthSecretForMethod)
    : Boolean(host.trim()) &&
      Boolean(remotePath.trim()) &&
      (!usernameRequired || Boolean(username.trim())) &&
      (!passwordRequired || password.length > 0 || hasPassword);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await upsertCatalogSource(supplierId, {
        protocol,
        host: isUrlProtocol ? "" : host.trim(),
        port: isUrlProtocol ? 0 : Number(port) || defaultPortForProtocol(protocol),
        remotePath: isUrlProtocol ? "" : remotePath.trim(),
        username: isUrlProtocol ? null : usernameRequired ? username.trim() : username.trim() || null,
        password: isUrlProtocol ? null : passwordPayload(),
        fileFormat,
        syncIntervalHours: Number(schedule) || 24,
        isEnabled,
        // http/https only:
        url: isUrlProtocol ? url.trim() : null,
        authMethod: isUrlProtocol ? authMethod : null,
        authConfig: isUrlProtocol ? buildAuthConfigPayload(authForm, savedAuthSecretForMethod) : null,
        httpMethod: isUrlProtocol ? "GET" : null,
      });
      setSavedSource(result.source);
      hydrate(result.source);
      setNotice(result.syncEnqueued ? "Saved — sync queued." : "Import source saved.");
      invalidateCatalogCaches();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save import source.";
      // Surface the backend's billing/SSRF/URL gates as plain language.
      if (msg.includes("catalog_sync_requires_integration")) {
        setError("Automatic catalog sync is included from any paid plan. Upgrade from Pilot to enable polling.");
      } else if (msg.includes("host_not_allowed")) {
        setError("That host is not allowed — private, loopback, and link-local addresses are blocked.");
      } else if (msg.includes("credentials_in_url_not_allowed")) {
        setError("Remove the username/password from the URL — store credentials in the auth fields instead.");
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this import source? Manual catalog upload still works.")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteCatalogSource(supplierId);
      setSavedSource(null);
      setProtocol("https");
      setHost("");
      setPort(22);
      setUsername("");
      setPassword("");
      setRemotePath("");
      setSchedule(24);
      setFileFormat("auto");
      setIsEnabled(false);
      setUrl("");
      setAuthMethod("none");
      setApiKeyHeader("X-Api-Key");
      setApiKeyValue("");
      setBearerToken("");
      setBasicUsername("");
      setBasicPassword("");
      setTokenUrl("");
      setClientId("");
      setClientSecret("");
      setScope("");
      setTestResult(null);
      setNotice("Import source deleted.");
      invalidateCatalogCaches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete import source.");
    } finally {
      setSaving(false);
    }
  }

  async function testFetch() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await testFetchCatalogSource(supplierId);
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not test the connection.");
    } finally {
      setTesting(false);
    }
  }

  function invalidateCatalogCaches() {
    void queryClient.invalidateQueries({ queryKey: ["supplier-catalog", supplierId] });
    void queryClient.invalidateQueries({ queryKey: ["supplier-catalog-codes", supplierId] });
  }

  const lastSync = formatLastSync(savedSource);
  // Cleartext warning: plain ftp leaks creds; plain http:// leaks the URL + any header/token.
  // Keyed on the URL's actual scheme (not the picker) — the scheme in the URL is what the
  // fetch uses, regardless of which API button is selected.
  const cleartextHttp = isUrlProtocol && url.trim().toLowerCase().startsWith("http://");

  return (
    <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <div
        className="flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: isEnabled ? "#2E8E3A" : "var(--ink-faint)" }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Pull from a file server or API</h3>
          <p className="text-[11px]" style={{ color: "#56627A" }}>
            ProcuLink fetches the supplier&apos;s catalog on a schedule and upserts products by code.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "#0B1A2F" }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => {
              setIsEnabled(e.target.checked);
              markEdited();
            }}
          />
          Enabled
        </label>
      </div>

      <div className="grid gap-0 lg:grid-cols-[200px_minmax(0,1fr)]">
        <div className="p-4" style={{ borderRight: "1px solid #E2E6EE", background: "#FBFCFE" }}>
          <p id="catalog-protocol-label" className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Protocol</p>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="catalog-protocol-label" onKeyDown={handleProtocolKeyDown}>
            {PROTOCOLS.map((item) => {
              const selected = protocol === item.id;
              return (
                <button
                  key={item.id}
                  id={`catalog-protocol-${item.id}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectProtocol(item.id)}
                  className="flex min-h-[44px] items-center justify-between rounded-[6px] px-3 text-[12px] font-semibold"
                  style={{
                    border: selected ? "1px solid #2E8E3A" : "1px solid #D5DAEA",
                    background: selected ? "#E2F1E2" : "#FFFFFF",
                    color: "#0B1A2F",
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[6px] p-3" style={{ background: "#F0F7F1", border: "1px solid #CBE8CE" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#1F6F2A" }}>What gets imported</p>
            <p className="mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
              CSV/XLSX/JSON columns are auto-detected: code (required), name, unit, price, currency, barcode.
            </p>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-[13px]" style={{ color: "#56627A" }}>Loading import source...</p>
          ) : (
            <div className="grid gap-4">
              {protocol === "ftp" && (
                <div
                  className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                  style={{ background: "#FFF8EA", border: "1px solid #F0D39A", color: "#7A4D0B" }}
                >
                  <AlertTriangle size={15} className="mt-px flex-shrink-0" />
                  <span>
                    Plain FTP sends the username and password unencrypted. Prefer SFTP or FTPS when the
                    supplier supports it.
                  </span>
                </div>
              )}

              {cleartextHttp && (
                <div
                  className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                  style={{ background: "#FFF8EA", border: "1px solid #F0D39A", color: "#7A4D0B" }}
                >
                  <AlertTriangle size={15} className="mt-px flex-shrink-0" />
                  <span>
                    Plain <code>http://</code> sends the request — including any API key, token, or
                    Basic password — unencrypted. Prefer an <code>https://</code> URL when the supplier
                    supports it.
                  </span>
                </div>
              )}

              {/* ── Connection: URL (http/https) OR host+port+path (sftp/ftp) ── */}
              {isUrlProtocol ? (
                <Field label="Catalog URL (full request URL)">
                  <input
                    value={url}
                    onChange={(e) => {
                      const next = e.target.value;
                      setUrl(next);
                      // Keep the picker honest: the URL's scheme is what the fetch uses,
                      // so the selected API protocol follows it.
                      const lower = next.trim().toLowerCase();
                      if (lower.startsWith("http://")) setProtocol("http");
                      else if (lower.startsWith("https://")) setProtocol("https");
                      markEdited();
                    }}
                    placeholder="https://api.supplier.example/v1/catalog.csv"
                    className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                    style={INPUT_STYLE}
                  />
                </Field>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_110px]">
                    <Field label="Host">
                      <input
                        value={host}
                        onChange={(e) => { setHost(e.target.value); markEdited(); }}
                        placeholder="files.supplier.example"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        type="number"
                        min={1}
                        value={port}
                        onChange={(e) => { setPort(e.target.value === "" ? "" : Number(e.target.value)); markEdited(); }}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  </div>

                  <Field label="Remote file path">
                    <input
                      value={remotePath}
                      onChange={(e) => { setRemotePath(e.target.value); markEdited(); }}
                      placeholder="/exports/catalog.csv"
                      className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                      style={INPUT_STYLE}
                    />
                  </Field>
                </>
              )}

              {/* ── File format ───────────────────────────────────────────── */}
              <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                <Field label="File format">
                  <select
                    value={fileFormat}
                    onChange={(e) => { setFileFormat(e.target.value); markEdited(); }}
                    className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                    style={{ ...INPUT_STYLE, background: "#FFF" }}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="csv">CSV</option>
                    <option value="xlsx">XLSX</option>
                    <option value="json">JSON</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    Leave on auto-detect unless the supplier&apos;s file has no clear extension.
                  </p>
                </div>
              </div>

              {/* ── Credentials: file-server password OR HTTP auth ─────────── */}
              {isUrlProtocol ? (
                <div className="rounded-[7px]" style={{ border: "1px solid #E2E6EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E2E6EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Authentication</span>
                    {savedAuthSecretForMethod && (
                      <span className="ml-auto text-[11px]" style={{ color: "#2E8E3A" }}>saved · masked</span>
                    )}
                  </div>
                  <div className="grid gap-3 p-3">
                    <Field label="Auth method">
                      <select
                        value={authMethod}
                        onChange={(e) => { setAuthMethod(e.target.value as CatalogHttpAuthMethod); markEdited(); }}
                        className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                        style={{ ...INPUT_STYLE, background: "#FFF" }}
                      >
                        {AUTH_METHODS.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </Field>

                    {savedAuthMethodDiffers && (
                      <p className="m-0 text-[11px]" style={{ color: "#7A4D0B" }}>
                        The saved credential is for a different auth method — enter this
                        method&apos;s credentials to switch.
                      </p>
                    )}

                    {authMethod === "apikey" && (
                      <div className="grid gap-2">
                        <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                          <Field label="Header name">
                            <input value={apiKeyHeader} onChange={(e) => { setApiKeyHeader(e.target.value); markEdited(); }} placeholder="X-Api-Key" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Value">
                            <input type="password" value={apiKeyValue} onChange={(e) => { setApiKeyValue(e.target.value); markEdited(); }} placeholder={savedAuthSecretForMethod ? "******** (leave blank to keep)" : "Key value"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        {savedAuthSecretForMethod && (
                          <p className="m-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                            Leave the value blank to keep the saved header and key. To change the
                            header, re-enter the value too — they are stored together.
                          </p>
                        )}
                      </div>
                    )}

                    {authMethod === "bearer" && (
                      <Field label="Bearer token">
                        <input type="password" value={bearerToken} onChange={(e) => { setBearerToken(e.target.value); markEdited(); }} placeholder={savedAuthSecretForMethod ? "******** (leave blank to keep)" : "Token"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    )}

                    {authMethod === "basic" && (
                      <div className="grid gap-2">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Username">
                            <input value={basicUsername} onChange={(e) => { setBasicUsername(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Password">
                            <input type="password" value={basicPassword} onChange={(e) => { setBasicPassword(e.target.value); markEdited(); }} placeholder={savedAuthSecretForMethod ? "******** (leave blank to keep)" : "Password"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        {savedAuthSecretForMethod && (
                          <p className="m-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                            Leave both fields blank to keep the saved credentials. Anything you
                            enter replaces both — they are stored together.
                          </p>
                        )}
                      </div>
                    )}

                    {authMethod === "oauth2_client_credentials" && (
                      <div className="grid gap-3">
                        <p className="text-[11px]" style={{ color: "#56627A" }}>
                          Before each fetch, ProcuLink calls the token URL with the client credentials, then
                          sends the returned token as <code>Authorization: Bearer</code>. The client secret is
                          stored encrypted; the token is fetched fresh and never stored.
                        </p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Token URL">
                            <input value={tokenUrl} onChange={(e) => { setTokenUrl(e.target.value); markEdited(); }} placeholder="https://api.supplier.example/oauth/token" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Scope (optional)">
                            <input value={scope} onChange={(e) => { setScope(e.target.value); markEdited(); }} placeholder="catalog.read" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Client ID">
                            <input value={clientId} onChange={(e) => { setClientId(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Client secret">
                            <input type="password" value={clientSecret} onChange={(e) => { setClientSecret(e.target.value); markEdited(); }} placeholder={savedAuthSecretForMethod ? "******** (leave blank to keep)" : "Client secret"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        {savedAuthSecretForMethod && (
                          <p className="m-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                            Leave all fields blank to keep the saved OAuth settings (token URL,
                            client ID, secret, scope). To change any of them, re-enter all of
                            them — they are stored together.
                          </p>
                        )}
                      </div>
                    )}

                    {authMethod === "none" && (
                      <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                        No authentication — the catalog URL is fetched anonymously.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-[7px]" style={{ border: "1px solid #E2E6EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E2E6EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Credentials</span>
                    {hasPassword && (
                      <span className="ml-auto text-[11px]" style={{ color: "#2E8E3A" }}>saved · masked</span>
                    )}
                  </div>
                  <div className="grid gap-3 p-3 lg:grid-cols-2">
                    <Field label={usernameRequired ? "Username" : "Username (anonymous if blank)"}>
                      <input
                        value={username}
                        onChange={(e) => { setUsername(e.target.value); markEdited(); }}
                        placeholder={protocol === "ftp" ? "anonymous" : ""}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Password">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); markEdited(); }}
                        placeholder={hasPassword ? "******** (leave blank to keep)" : "Password"}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-[150px_minmax(0,1fr)]">
                <Field label="Every (hours)">
                  <input
                    type="number"
                    min={1}
                    max={336}
                    value={schedule}
                    onChange={(e) => { setSchedule(e.target.value === "" ? "" : Number(e.target.value)); markEdited(); }}
                    className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                    style={INPUT_STYLE}
                  />
                </Field>
                <div className="flex items-end">
                  <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    ProcuLink checks this often and only re-imports when the file has changed.
                  </p>
                </div>
              </div>

              {/* ── Last-sync status ──────────────────────────────────────── */}
              {savedSource && (
                <div
                  className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                  style={{
                    background: lastSync.tone === "failed" ? "#FCEBEB" : "#F6F7FA",
                    border: `1px solid ${lastSync.tone === "failed" ? "#F5C5C5" : "#E2E6EE"}`,
                    color: lastSync.tone === "failed" ? "#A52E2E" : "#56627A",
                  }}
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      background:
                        lastSync.tone === "ok"
                          ? "#2E8E3A"
                          : lastSync.tone === "failed"
                            ? "#C53A3A"
                            : lastSync.tone === "running"
                              ? "#1E66C9"
                              : "var(--ink-faint)",
                    }}
                  />
                  <span className="min-w-0 flex-1 break-words">{lastSync.text}</span>
                </div>
              )}

              {error && (
                <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}>
                  {error}
                </div>
              )}
              {notice && !error && (
                <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#F0F7F1", color: "#1F6F2A", border: "1px solid #CBE8CE" }} role="status">
                  {notice}
                </div>
              )}

              {/* ── Test connection & preview report ──────────────────────── */}
              {testResult && <TestReport result={testResult} />}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center" style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}>
        {savedSource && (
          <button onClick={remove} disabled={saving} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF" }}>
            <Trash2 size={13} /> Delete
          </button>
        )}
        <div className="hidden flex-1 sm:block" />
        <button onClick={testFetch} disabled={!savedSource || testing} title={!savedSource ? "Save the source first, then you can test the connection." : "Fetch a preview to check the connection."} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF", opacity: !savedSource ? 0.55 : 1 }}>
          <Zap size={13} /> {testing ? "Testing..." : "Test connection & preview"}
        </button>
        <button onClick={save} disabled={saving || !canSave} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "none", color: "#FFF", background: saving || !canSave ? "var(--ink-faint)" : "#0B1A2F" }}>
          <Save size={13} /> {saving ? "Saving..." : "Save source"}
        </button>
      </div>
    </div>
  );
}

function TestReport({ result }: { result: CatalogSourceTestResult }) {
  if (!result.ok) {
    return (
      <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}>
        <p className="m-0 font-semibold">Could not fetch the file</p>
        {result.error && <p className="m-0 mt-1">{result.error}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-[7px]" style={{ border: "1px solid #CBE8CE", background: "#F8FCF8" }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12px]" style={{ borderBottom: "1px solid #DCEEDC", color: "#1F6F2A" }}>
        <span className="font-semibold">Connected.</span>
        {result.fileName && <span>{result.fileName}</span>}
        {result.detectedFormat && <span>format: {result.detectedFormat.toUpperCase()}</span>}
        {result.bytes != null && <span>{result.bytes.toLocaleString()} bytes</span>}
        {result.parsedRows != null && <span>{result.parsedRows} rows</span>}
        {result.rowsWithCode != null && <span>{result.rowsWithCode} with a code</span>}
      </div>
      <div className="grid gap-3 p-3">
        {result.mappedFields.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Mapped columns</p>
            <div className="overflow-hidden rounded-[6px]" style={{ border: "1px solid #E2E6EE" }}>
              <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F6F7FA", color: "#56627A", textAlign: "left" }}>
                    <th style={{ padding: "5px 9px", fontWeight: 700 }}>Their column</th>
                    <th style={{ padding: "5px 9px", fontWeight: 700 }}>Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mappedFields.map((m) => (
                    <tr key={m.field} style={{ borderTop: "1px solid #EEF0F4" }}>
                      <td style={{ padding: "5px 9px", fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F" }}>{m.column}</td>
                      <td style={{ padding: "5px 9px", color: "#0B1A2F" }}>{m.field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result.unmappedColumns.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Ignored columns</p>
            <div className="flex flex-wrap gap-1.5">
              {result.unmappedColumns.map((c) => (
                <span key={c} className="rounded-[4px] px-2 py-0.5 text-[11px]" style={{ background: "#EFF2F7", color: "#56627A", fontFamily: "'JetBrains Mono',monospace" }}>{c}</span>
              ))}
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "var(--ink-faint)" }}>ProcuLink reads only the mapped columns above.</p>
          </div>
        )}

        {result.sampleRows.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>
              Sample rows (first {result.sampleRows.length})
            </p>
            <div className="overflow-x-auto rounded-[6px]" style={{ border: "1px solid #E2E6EE" }}>
              <table className="w-full border-collapse" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: "#F6F7FA", color: "#56627A", textAlign: "left" }}>
                    {result.headerColumns.map((h) => (
                      <th key={h} style={{ padding: "5px 9px", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.sampleRows.map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #EEF0F4" }}>
                      {result.headerColumns.map((h) => (
                        <td key={h} style={{ padding: "5px 9px", color: "#0B1A2F", whiteSpace: "nowrap" }}>{row[h] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="m-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
          This is a read-only preview — it connects, reads the file, and shows what would be imported. It does
          not save anything.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>{label}</span>
      {children}
    </label>
  );
}
