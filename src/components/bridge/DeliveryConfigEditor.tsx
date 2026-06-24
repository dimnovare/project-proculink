"use client";

import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Send, Trash2 } from "lucide-react";
import { ConnectorRequirementsPanel } from "@/components/bridge/ConnectorRequirementsPanel";
import {
  deleteDeliveryConfig,
  getDeliveryConfig,
  testFireDelivery,
  upsertDeliveryConfig,
} from "@/lib/api/delivery";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { isArrowKey, rovingRadioNext } from "@/lib/roving-radio";
import { buildCxmlCredentials } from "@/lib/cxml-credentials";
import { decideSftpCredentialAction, type SftpAuthMode } from "@/components/bridge/deliveryCredentialAction";
import type { DeliveryConfig, DeliveryProtocol, DeliveryTestResult } from "@/lib/api/types";

type AuthType = "none" | "apikey" | "bearer" | "basic" | "oauth2";

interface DeliveryConfigEditorProps {
  supplierId: string;
}

const PROTOCOLS: Array<{ id: DeliveryProtocol; label: string; enabled: boolean }> = [
  { id: "http", label: "HTTP", enabled: true },
  { id: "sftp", label: "SFTP", enabled: true },
  { id: "ftps", label: "FTPS", enabled: true },
  { id: "smtp", label: "Email (SMTP)", enabled: true },
  { id: "erp_erply", label: "Erply ERP", enabled: true },
  { id: "erp_directo", label: "Directo ERP", enabled: true },
];

const URL_PROTOCOLS: DeliveryProtocol[] = ["http", "erp_erply", "erp_directo"];
const HOST_PROTOCOLS: DeliveryProtocol[] = ["sftp", "ftps", "smtp"];

function defaultPortFor(p: DeliveryProtocol): number | "" {
  if (p === "sftp") return 22;
  if (p === "ftps") return 21;
  if (p === "smtp") return 587;
  return "";
}

const INPUT_STYLE = { border: "1px solid #D5DAEA", color: "#0B1A2F" } as const;

export function DeliveryConfigEditor({ supplierId }: DeliveryConfigEditorProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // Test-fire nudge (task 8): true right after a successful save, until the
  // form is edited again or a test result lands — drives the success strip
  // with the "Send a test now" shortcut to the EXISTING test-fire flow.
  const [justSaved, setJustSaved] = useState(false);
  const [savedConfig, setSavedConfig] = useState<DeliveryConfig | null>(null);
  const [protocol, setProtocol] = useState<DeliveryProtocol>("http");
  const [autoDeliver, setAutoDeliver] = useState(false);
  const [outputFormat, setOutputFormat] = useState(""); // "" = not set (defaults to xml at transform time)

  // cXML network credentials (only meaningful when outputFormat === "cxml"). senderSharedSecret is
  // write-only: blank = keep the saved secret.
  const [cxmlFromDomain, setCxmlFromDomain] = useState("");
  const [cxmlFromIdentity, setCxmlFromIdentity] = useState("");
  const [cxmlToDomain, setCxmlToDomain] = useState("");
  const [cxmlToIdentity, setCxmlToIdentity] = useState("");
  const [cxmlSenderDomain, setCxmlSenderDomain] = useState("");
  const [cxmlSenderIdentity, setCxmlSenderIdentity] = useState("");
  const [cxmlSenderSharedSecret, setCxmlSenderSharedSecret] = useState("");
  // Configurable cXML <!DOCTYPE> DTD (T7) — free-text per supplier. Blank = no DOCTYPE.
  const [cxmlDtdSystemId, setCxmlDtdSystemId] = useState("");
  const [cxmlDtdPublicId, setCxmlDtdPublicId] = useState("");

  // URL-based (http / erp_*)
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [erplyClientCode, setErplyClientCode] = useState("");
  const [directoDatabase, setDirectoDatabase] = useState("");
  const [directoKey, setDirectoKey] = useState("");

  // Host-based (sftp / ftps / smtp)
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">("");
  const [remotePath, setRemotePath] = useState("");
  const [makeDirectories, setMakeDirectories] = useState(true);
  const [sftpAuthMode, setSftpAuthMode] = useState<SftpAuthMode>("password");
  // B8: the SFTP auth method the editor LOADED with for a saved config — the shape the
  // stored secret corresponds to. The backend never returns the saved auth shape (only a
  // protocol-agnostic hasCredentials), and the editor never hydrates sftpAuthMode, so a
  // saved SFTP config always presents in "password" mode. Recording this lets us detect a
  // cross-shape switch (password→key) and refuse to silently keep the wrong-shape secret.
  // Null = no saved SFTP config yet (brand-new supplier).
  const [loadedSftpAuthMode, setLoadedSftpAuthMode] = useState<SftpAuthMode | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [allowInvalidCertificate, setAllowInvalidCertificate] = useState(false);

  // Email (smtp)
  const [useSsl, setUseSsl] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [toAddresses, setToAddresses] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [attachmentFileName, setAttachmentFileName] = useState("");

  // Shared
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);

  // HTTP / ERP auth
  const [authType, setAuthType] = useState<AuthType>("none");
  const [apiKeyHeader, setApiKeyHeader] = useState("X-Api-Key");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");

  // OAuth2 (HTTP — fetch token first)
  const [tokenUrl, setTokenUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthGrantType, setOauthGrantType] = useState("client_credentials");
  const [oauthRequestStyle, setOauthRequestStyle] = useState<"form" | "json">("form");
  const [oauthAuthStyle, setOauthAuthStyle] = useState<"body" | "basic">("body");
  const [oauthTokenPath, setOauthTokenPath] = useState("access_token");

  const [testResult, setTestResult] = useState<DeliveryTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const config = await getDeliveryConfig(supplierId);
        if (cancelled) return;
        setSavedConfig(config);
        if (config) {
          setProtocol(config.protocol);
          setAutoDeliver(config.autoDeliver);
          setOutputFormat(config.outputFormat ?? "");
          if (config.protocol === "erp_directo") setAuthType("basic");
          // B8: the saved SFTP secret's shape. The backend can't tell us password-vs-key, and
          // the editor opens a saved SFTP config in "password" mode (sftpAuthMode is never
          // hydrated), so the loaded shape IS "password" when a saved SFTP credential exists.
          // Anything else (no saved credential / non-SFTP) → null = nothing to protect.
          setLoadedSftpAuthMode(
            config.protocol === "sftp" && config.hasCredentials ? "password" : null,
          );
          hydrateConfig(config.protocol, config.configJson);
          const cx = config.cxmlCredentials;
          setCxmlFromDomain(cx?.fromDomain ?? "");
          setCxmlFromIdentity(cx?.fromIdentity ?? "");
          setCxmlToDomain(cx?.toDomain ?? "");
          setCxmlToIdentity(cx?.toIdentity ?? "");
          setCxmlSenderDomain(cx?.senderDomain ?? "");
          setCxmlSenderIdentity(cx?.senderIdentity ?? "");
          setCxmlSenderSharedSecret(""); // write-only — never prefilled
          setCxmlDtdSystemId(cx?.dtdSystemId ?? "");
          setCxmlDtdPublicId(cx?.dtdPublicId ?? "");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load delivery config.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  const hasSavedCredentials = savedConfig?.hasCredentials ?? false;
  const hasCxmlSharedSecret = savedConfig?.cxmlCredentials?.hasSharedSecret ?? false;
  const isUrlProtocol = URL_PROTOCOLS.includes(protocol);

  // Shared by the click handler and the arrow-key radiogroup navigation.
  function selectProtocol(id: DeliveryProtocol) {
    setProtocol(id);
    if (id === "erp_erply" && authType === "basic") setAuthType("bearer");
    if (id === "erp_directo") setAuthType("basic");
    if (HOST_PROTOCOLS.includes(id)) setPort((prev) => (prev === "" ? defaultPortFor(id) : prev));
    markEdited();
  }

  // Roving-tabindex + arrow-key navigation so the protocol picker is keyboard
  // operable like a native radio group (only the checked option is tabbable;
  // Arrow keys move + select, skipping disabled "later" protocols).
  function handleProtocolKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isArrowKey(event.key)) return;
    event.preventDefault();
    const enabledIds = PROTOCOLS.filter((p) => p.enabled).map((p) => p.id);
    const nextId = rovingRadioNext(event.key, protocol, enabledIds);
    if (nextId === null) return;
    selectProtocol(nextId);
    requestAnimationFrame(() => document.getElementById(`delivery-protocol-${nextId}`)?.focus());
  }

  const configPreview = JSON.stringify(buildConfigObject(), null, 2);

  // B8: non-null when the SFTP auth method was switched away from the saved shape without a
  // new secret. Gates the Save button + drives an inline message in the auth section.
  const credentialBlock = sftpCredentialBlockMessage();

  const canSave =
    protocol === "sftp" || protocol === "ftps"
      ? Boolean(host)
      : protocol === "smtp"
        ? Boolean(host) && Boolean(fromAddress) && Boolean(toAddresses.trim())
        : Boolean(url) && (protocol !== "erp_directo" || Boolean(directoDatabase));

  function hydrateConfig(nextProtocol: DeliveryProtocol, configJson: string) {
    try {
      const p = JSON.parse(configJson) as Record<string, unknown>;
      setTimeoutSeconds(typeof p.timeoutSeconds === "number" ? p.timeoutSeconds : 30);
      // url-based
      setUrl(typeof p.url === "string" ? p.url : "");
      setMethod(typeof p.method === "string" ? p.method : "POST");
      setErplyClientCode(nextProtocol === "erp_erply" && typeof p.clientCode === "string" ? p.clientCode : "");
      setDirectoDatabase(nextProtocol === "erp_directo" && typeof p.database === "string" ? p.database : "");
      // host-based
      setHost(typeof p.host === "string" ? p.host : "");
      setPort(typeof p.port === "number" ? p.port : defaultPortFor(nextProtocol));
      setRemotePath(typeof p.remotePath === "string" ? p.remotePath : "");
      setMakeDirectories(typeof p.makeDirectories === "boolean" ? p.makeDirectories : true);
      setAllowInvalidCertificate(p.allowInvalidCertificate === true);
      // smtp
      setUseSsl(p.useSsl === true);
      setFromAddress(typeof p.fromAddress === "string" ? p.fromAddress : "");
      setToAddresses(
        Array.isArray(p.toAddresses)
          ? (p.toAddresses as string[]).join(", ")
          : typeof p.toAddresses === "string"
            ? p.toAddresses
            : "",
      );
      setSubjectTemplate(typeof p.subjectTemplate === "string" ? p.subjectTemplate : "");
      setBodyTemplate(typeof p.bodyTemplate === "string" ? p.bodyTemplate : "");
      setAttachmentFileName(typeof p.attachmentFileName === "string" ? p.attachmentFileName : "");
    } catch {
      setUrl("");
      setMethod("POST");
      setTimeoutSeconds(30);
      setErplyClientCode("");
      setDirectoDatabase("");
      setHost("");
      setPort(defaultPortFor(nextProtocol));
      setRemotePath("");
      setMakeDirectories(true);
      setAllowInvalidCertificate(false);
      setUseSsl(false);
      setFromAddress("");
      setToAddresses("");
      setSubjectTemplate("");
      setBodyTemplate("");
      setAttachmentFileName("");
    }
  }

  function markEdited() {
    setTestResult(null);
    setError(null);
    setJustSaved(false);
  }

  function buildConfigObject(): Record<string, unknown> {
    if (protocol === "erp_erply") return { url, clientCode: erplyClientCode, timeoutSeconds };
    if (protocol === "erp_directo") return { url, database: directoDatabase, timeoutSeconds };
    if (protocol === "sftp") return { host, port: Number(port) || 22, remotePath, makeDirectories, timeoutSeconds };
    if (protocol === "ftps")
      return { host, port: Number(port) || 21, remotePath, makeDirectories, timeoutSeconds, allowInvalidCertificate };
    if (protocol === "smtp")
      return {
        host,
        port: Number(port) || 587,
        useSsl,
        fromAddress,
        toAddresses,
        timeoutSeconds,
        ...(subjectTemplate ? { subjectTemplate } : {}),
        ...(bodyTemplate ? { bodyTemplate } : {}),
        ...(attachmentFileName ? { attachmentFileName } : {}),
      };
    return { url, method, timeoutSeconds }; // http
  }

  // B8: the new secret the SELECTED SFTP auth method needs (key text vs password).
  function sftpNewSecret(): string {
    return sftpAuthMode === "key" ? privateKey : basicPassword;
  }

  // B8: blocking message when the SFTP auth method was switched away from the saved shape
  // (e.g. password → private key) without entering the new secret. Null when there's nothing
  // to block. Drives the save gate + an inline message so the stale wrong-shape secret is
  // never silently kept.
  function sftpCredentialBlockMessage(): string | null {
    if (protocol !== "sftp") return null;
    const decision = decideSftpCredentialAction({
      selected: sftpAuthMode,
      loaded: loadedSftpAuthMode,
      hasNewSecret: sftpNewSecret().trim() !== "",
      hasSavedCredentials,
    });
    return decision.kind === "block" ? decision.message : null;
  }

  function buildCredentialsJson(): string | null {
    if (protocol === "sftp") {
      const decision = decideSftpCredentialAction({
        selected: sftpAuthMode,
        loaded: loadedSftpAuthMode,
        hasNewSecret: sftpNewSecret().trim() !== "",
        hasSavedCredentials,
      });
      // "keep" → null (preserve the stored secret of the SAME shape). "block" also returns
      // null defensively, but save() refuses to call upsert in that case so it never reaches
      // the backend (the stale wrong-shape secret is not kept silently).
      if (decision.kind === "keep" || decision.kind === "block") return null;
      if (sftpAuthMode === "key") {
        return JSON.stringify({ username: basicUsername, privateKey, privateKeyPassphrase });
      }
      return JSON.stringify({ username: basicUsername, password: basicPassword });
    }

    if (protocol === "ftps" || protocol === "smtp") {
      if (!basicPassword && hasSavedCredentials) return null;
      return JSON.stringify({ username: basicUsername, password: basicPassword });
    }

    if (protocol === "erp_directo") {
      if (!basicPassword && !directoKey && hasSavedCredentials) return null;
      return JSON.stringify({ user: basicUsername, password: basicPassword, key: directoKey });
    }

    // http (and erp_erply) use the header-style auth selector
    if (authType === "none") return hasSavedCredentials ? null : "{\"type\":\"none\"}";
    if (authType === "apikey") {
      if (!apiKeyValue && hasSavedCredentials) return null;
      return JSON.stringify({ type: "apikey", header: apiKeyHeader, value: apiKeyValue });
    }
    if (authType === "bearer") {
      if (!bearerToken && hasSavedCredentials) return null;
      return JSON.stringify({ type: "bearer", token: bearerToken });
    }
    if (authType === "oauth2") {
      if (!oauthClientSecret && hasSavedCredentials) return null;
      return JSON.stringify({
        type: "oauth2_client_credentials",
        tokenUrl,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        scope: oauthScope,
        grantType: oauthGrantType,
        authStyle: oauthAuthStyle,
        requestStyle: oauthRequestStyle,
        tokenResponsePath: oauthTokenPath,
      });
    }
    if (!basicPassword && hasSavedCredentials) return null;
    return JSON.stringify({ type: "basic", username: basicUsername, password: basicPassword });
  }

  async function save() {
    // B8: refuse to save when the SFTP auth method was switched away from the saved shape
    // without a new secret — otherwise the backend would keep the stale wrong-shape secret
    // and silently discard the auth-mode change. Surface the message; don't show "saved".
    const block = sftpCredentialBlockMessage();
    if (block) {
      setError(block);
      setJustSaved(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertDeliveryConfig(supplierId, {
        protocol,
        autoDeliver,
        configJson: JSON.stringify(buildConfigObject()),
        credentialsJson: buildCredentialsJson(),
        outputFormat: outputFormat || null,
        cxmlCredentials: buildCxmlCredentials(outputFormat, {
          fromDomain: cxmlFromDomain,
          fromIdentity: cxmlFromIdentity,
          toDomain: cxmlToDomain,
          toIdentity: cxmlToIdentity,
          senderDomain: cxmlSenderDomain,
          senderIdentity: cxmlSenderIdentity,
          senderSharedSecret: cxmlSenderSharedSecret,
          dtdSystemId: cxmlDtdSystemId,
          dtdPublicId: cxmlDtdPublicId,
        }),
      });
      setSavedConfig(saved);
      // B8: the just-saved SFTP shape becomes the new baseline so a later switch is detected
      // against what's now stored. Only meaningful when the saved config has a credential.
      setLoadedSftpAuthMode(saved.protocol === "sftp" && saved.hasCredentials ? sftpAuthMode : null);
      setApiKeyValue("");
      setBearerToken("");
      setBasicPassword("");
      setDirectoKey("");
      setPrivateKey("");
      setPrivateKeyPassphrase("");
      setOauthClientSecret("");
      setCxmlSenderSharedSecret(""); // clear the write-only secret after save
      setTestResult(null);
      setJustSaved(true);
      // hasDeliveryConfig just flipped — refresh the checklist/chip surfaces.
      void invalidateOnboardingStatus(queryClient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save delivery config.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (typeof window !== "undefined" && !window.confirm("Delete this supplier's delivery configuration and saved credentials? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDeliveryConfig(supplierId);
      setSavedConfig(null);
      setAutoDeliver(false);
      setUrl("");
      setErplyClientCode("");
      setDirectoDatabase("");
      setDirectoKey("");
      setHost("");
      setRemotePath("");
      setPrivateKey("");
      setPrivateKeyPassphrase("");
      setFromAddress("");
      setToAddresses("");
      setBasicPassword("");
      setOauthClientSecret("");
      setCxmlFromDomain("");
      setCxmlFromIdentity("");
      setCxmlToDomain("");
      setCxmlToIdentity("");
      setCxmlSenderDomain("");
      setCxmlSenderIdentity("");
      setCxmlSenderSharedSecret("");
      setCxmlDtdSystemId("");
      setCxmlDtdPublicId("");
      setAuthType("none");
      setLoadedSftpAuthMode(null); // B8: no saved credential anymore → nothing to protect.
      setTestResult(null);
      setJustSaved(false);
      // hasDeliveryConfig may have flipped back — refresh checklist surfaces.
      void invalidateOnboardingStatus(queryClient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete delivery config.");
    } finally {
      setSaving(false);
    }
  }

  async function testFire() {
    setTesting(true);
    setError(null);
    try {
      const result = await testFireDelivery(supplierId);
      setTestResult(result);
      setJustSaved(false); // the strip's job is done — the verbatim result takes over
      if (result.success) {
        // hasTestFired just flipped — checklist step 5 can complete.
        void invalidateOnboardingStatus(queryClient);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run delivery test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <div
        className="flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: autoDeliver ? "#2E8E3A" : "var(--ink-faint)" }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Supplier delivery</h3>
          <p className="text-[11px]" style={{ color: "#56627A" }}>
            Configure the channel used once an order is ready to send.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "#0B1A2F" }}>
          <input
            type="checkbox"
            checked={autoDeliver}
            onChange={(e) => {
              setAutoDeliver(e.target.checked);
              markEdited();
            }}
          />
          Auto-deliver
        </label>
      </div>

      <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="p-4" style={{ borderRight: "1px solid #E2E6EE", background: "#FBFCFE" }}>
          <p id="delivery-protocol-label" className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Protocol</p>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="delivery-protocol-label" onKeyDown={handleProtocolKeyDown}>
            {PROTOCOLS.map((item) => {
              const selected = protocol === item.id;
              return (
                <button
                  key={item.id}
                  id={`delivery-protocol-${item.id}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  disabled={!item.enabled}
                  onClick={() => selectProtocol(item.id)}
                  className="flex min-h-[44px] items-center justify-between rounded-[6px] px-3 text-[12px] font-semibold"
                  style={{
                    border: selected ? "1px solid #2E8E3A" : "1px solid #D5DAEA",
                    background: selected ? "#E2F1E2" : "#FFFFFF",
                    color: item.enabled ? "#0B1A2F" : "var(--ink-faint)",
                    cursor: item.enabled ? "pointer" : "not-allowed",
                  }}
                >
                  {item.label}
                  {!item.enabled && <span className="text-[10px] font-medium">later</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[6px] p-3" style={{ background: "#F0F7F1", border: "1px solid #CBE8CE" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#1F6F2A" }}>How sending works</p>
            <p className="mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
              Once an order is transformed, only this delivery setup can mark it as sent.
            </p>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-[13px]" style={{ color: "#56627A" }}>Loading delivery config...</p>
          ) : (
            <div className="grid gap-4">
              {/* ── Output format (what this supplier requires) ────────────── */}
              <div className="rounded-[7px] p-3" style={{ border: "1px solid #E2E6EE", background: "#FBFCFE" }}>
                <Field label="Output format — the format this supplier requires">
                  <select
                    value={outputFormat}
                    onChange={(e) => {
                      setOutputFormat(e.target.value);
                      markEdited();
                    }}
                    className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                    style={{ ...INPUT_STYLE, background: "#FFF" }}
                  >
                    <option value="">Not set — defaults to XML</option>
                    <option value="csv">CSV</option>
                    <option value="xml">XML (generic)</option>
                    <option value="cxml">cXML</option>
                    <option value="ubl">UBL 2.1 / Peppol</option>
                    <option value="x12">ANSI X12 850</option>
                    <option value="json">JSON</option>
                  </select>
                </Field>
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                  When set, an order is converted to this format right before it&rsquo;s sent to this supplier.
                </p>
              </div>

              {/* ── cXML network credentials (only for cXML output) ────────── */}
              {outputFormat === "cxml" && (
                <div className="rounded-[7px]" style={{ border: "1px solid #E2E6EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E2E6EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>cXML network credentials</span>
                    {hasCxmlSharedSecret && (
                      <span className="ml-auto text-[11px]" style={{ color: "#2E8E3A" }}>shared secret saved</span>
                    )}
                  </div>
                  <div className="grid gap-3 p-3">
                    <p className="text-[11px]" style={{ color: "#56627A" }}>
                      Written into the cXML <code>&lt;Header&gt;</code>. Leave blank to fall back to
                      ProcuLink&apos;s internal IDs. Example (Coupa): From <code>NetworkId</code> /{" "}
                      <code>Nasdaq_SE</code>, To <code>NetworkId</code> / <code>Markit_SE</code>.
                    </p>
                    <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)]">
                      <Field label="From domain">
                        <input value={cxmlFromDomain} onChange={(e) => { setCxmlFromDomain(e.target.value); markEdited(); }} placeholder="NetworkId" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                      <Field label="From identity (your sender ID)">
                        <input value={cxmlFromIdentity} onChange={(e) => { setCxmlFromIdentity(e.target.value); markEdited(); }} placeholder="Nasdaq_SE" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)]">
                      <Field label="To domain">
                        <input value={cxmlToDomain} onChange={(e) => { setCxmlToDomain(e.target.value); markEdited(); }} placeholder="NetworkId" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                      <Field label="To identity (supplier network ID)">
                        <input value={cxmlToIdentity} onChange={(e) => { setCxmlToIdentity(e.target.value); markEdited(); }} placeholder="Markit_SE" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)]">
                      <Field label="Sender domain">
                        <input value={cxmlSenderDomain} onChange={(e) => { setCxmlSenderDomain(e.target.value); markEdited(); }} placeholder="NetworkId" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                      <Field label="Sender identity">
                        <input value={cxmlSenderIdentity} onChange={(e) => { setCxmlSenderIdentity(e.target.value); markEdited(); }} placeholder="Nasdaq_SE" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    </div>
                    <Field label="Sender shared secret">
                      <input
                        value={cxmlSenderSharedSecret}
                        onChange={(e) => { setCxmlSenderSharedSecret(e.target.value); markEdited(); }}
                        placeholder={hasCxmlSharedSecret ? "******** (leave blank to keep saved secret)" : "Optional — supplier-issued shared secret"}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>

                    {/* cXML DOCTYPE / DTD (T7) — free-text per supplier so any cXML version works.
                        Persisted into the same cXML config (→ CxmlConfigJson) as dtdSystemId /
                        dtdPublicId. Blank = no DOCTYPE = byte-identical to today. */}
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <Field label="cXML DTD (SYSTEM id / URI)">
                        <input
                          value={cxmlDtdSystemId}
                          onChange={(e) => { setCxmlDtdSystemId(e.target.value); markEdited(); }}
                          list="cxml-dtd-suggestions"
                          placeholder="http://xml.cxml.org/schemas/cXML/1.2.024/cXML.dtd"
                          className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                          style={INPUT_STYLE}
                        />
                      </Field>
                      <Field label="Public id (optional)">
                        <input
                          value={cxmlDtdPublicId}
                          onChange={(e) => { setCxmlDtdPublicId(e.target.value); markEdited(); }}
                          placeholder="Optional — for the PUBLIC DOCTYPE form"
                          className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                          style={INPUT_STYLE}
                        />
                      </Field>
                    </div>
                    <datalist id="cxml-dtd-suggestions">
                      <option value="http://xml.cxml.org/schemas/cXML/1.2.024/cXML.dtd" />
                      <option value="http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd" />
                      <option value="http://xml.cxml.org/schemas/cXML/1.2.040/cXML.dtd" />
                    </datalist>
                    <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      Leave blank for no DOCTYPE. Set the exact DTD URI your supplier&apos;s cXML requires.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Connection ─────────────────────────────────────────────── */}
              {isUrlProtocol && (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_120px]">
                  <Field label="Endpoint URL">
                    <input
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        markEdited();
                      }}
                      placeholder={protocol === "erp_directo" ? "https://login.directo.ee/xmlcore" : "https://supplier.example/orders"}
                      className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                      style={INPUT_STYLE}
                    />
                  </Field>
                  {protocol === "http" && (
                    <Field label="Method">
                      <select
                        value={method}
                        onChange={(e) => {
                          setMethod(e.target.value);
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                        style={{ ...INPUT_STYLE, background: "#FFF" }}
                      >
                        <option>POST</option>
                        <option>PUT</option>
                      </select>
                    </Field>
                  )}
                  {protocol === "erp_erply" && (
                    <Field label="Client code">
                      <input
                        value={erplyClientCode}
                        onChange={(e) => {
                          setErplyClientCode(e.target.value);
                          markEdited();
                        }}
                        placeholder="ACME"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  )}
                  {protocol === "erp_directo" && (
                    <Field label="Database">
                      <input
                        value={directoDatabase}
                        onChange={(e) => {
                          setDirectoDatabase(e.target.value);
                          markEdited();
                        }}
                        placeholder="company_db"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  )}
                  <Field label="Timeout">
                    <input
                      type="number"
                      min={1}
                      value={timeoutSeconds}
                      onChange={(e) => {
                        setTimeoutSeconds(Number(e.target.value));
                        markEdited();
                      }}
                      className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                      style={INPUT_STYLE}
                    />
                  </Field>
                </div>
              )}

              {(protocol === "sftp" || protocol === "ftps") && (
                <div className="grid gap-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_110px_110px]">
                    <Field label="Host">
                      <input
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                          markEdited();
                        }}
                        placeholder="sftp.supplier.example"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        type="number"
                        min={1}
                        value={port}
                        onChange={(e) => {
                          setPort(e.target.value === "" ? "" : Number(e.target.value));
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Timeout">
                      <input
                        type="number"
                        min={1}
                        value={timeoutSeconds}
                        onChange={(e) => {
                          setTimeoutSeconds(Number(e.target.value));
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  </div>
                  <Field label="Remote path">
                    <input
                      value={remotePath}
                      onChange={(e) => {
                        setRemotePath(e.target.value);
                        markEdited();
                      }}
                      placeholder="/inbound/orders"
                      className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                      style={INPUT_STYLE}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-[12px]" style={{ color: "#0B1A2F" }}>
                    <input
                      type="checkbox"
                      checked={makeDirectories}
                      onChange={(e) => {
                        setMakeDirectories(e.target.checked);
                        markEdited();
                      }}
                    />
                    Create the remote directory if it does not exist
                  </label>
                  {protocol === "ftps" && (
                    <label className="flex items-start gap-2 text-[12px]" style={{ color: "#8A4B00" }}>
                      <input
                        type="checkbox"
                        checked={allowInvalidCertificate}
                        onChange={(e) => {
                          setAllowInvalidCertificate(e.target.checked);
                          markEdited();
                        }}
                      />
                      Allow invalid TLS certificate — only for a supplier with a self-signed or expired
                      cert. Leave OFF for servers with a public CA certificate.
                    </label>
                  )}
                </div>
              )}

              {protocol === "smtp" && (
                <div className="grid gap-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_110px_110px]">
                    <Field label="SMTP host">
                      <input
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                          markEdited();
                        }}
                        placeholder="smtp.supplier.example"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        type="number"
                        min={1}
                        value={port}
                        onChange={(e) => {
                          setPort(e.target.value === "" ? "" : Number(e.target.value));
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Timeout">
                      <input
                        type="number"
                        min={1}
                        value={timeoutSeconds}
                        onChange={(e) => {
                          setTimeoutSeconds(Number(e.target.value));
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Field label="From address">
                      <input
                        value={fromAddress}
                        onChange={(e) => {
                          setFromAddress(e.target.value);
                          markEdited();
                        }}
                        placeholder="orders@your-company.example"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label="Recipients (comma-separated)">
                      <input
                        value={toAddresses}
                        onChange={(e) => {
                          setToAddresses(e.target.value);
                          markEdited();
                        }}
                        placeholder="po@supplier.example, sales@supplier.example"
                        className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                        style={INPUT_STYLE}
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-[12px]" style={{ color: "#0B1A2F" }}>
                    <input
                      type="checkbox"
                      checked={useSsl}
                      onChange={(e) => {
                        setUseSsl(e.target.checked);
                        markEdited();
                      }}
                    />
                    Use SSL on connect (implicit TLS, e.g. port 465). Otherwise STARTTLS is used when available.
                  </label>
                  <details>
                    <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "#56627A" }}>
                      Advanced — subject / body / attachment
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <Field label="Subject template">
                        <input
                          value={subjectTemplate}
                          onChange={(e) => {
                            setSubjectTemplate(e.target.value);
                            markEdited();
                          }}
                          placeholder="Purchase Order {poNumber}"
                          className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                          style={INPUT_STYLE}
                        />
                      </Field>
                      <Field label="Body template">
                        <textarea
                          value={bodyTemplate}
                          onChange={(e) => {
                            setBodyTemplate(e.target.value);
                            markEdited();
                          }}
                          placeholder="Please find the attached purchase order ({fileName})."
                          rows={2}
                          className="w-full rounded-[5px] px-2.5 py-2 text-[12px]"
                          style={INPUT_STYLE}
                        />
                      </Field>
                      <Field label="Attachment file name">
                        <input
                          value={attachmentFileName}
                          onChange={(e) => {
                            setAttachmentFileName(e.target.value);
                            markEdited();
                          }}
                          placeholder="(defaults to the generated file name)"
                          className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                          style={INPUT_STYLE}
                        />
                      </Field>
                      <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                        Templates support <code>{"{poNumber}"}</code> and <code>{"{fileName}"}</code>.
                      </p>
                    </div>
                  </details>
                </div>
              )}

              {/* ── Authentication ─────────────────────────────────────────── */}
              <div className="rounded-[7px]" style={{ border: "1px solid #E2E6EE" }}>
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E2E6EE" }}>
                  <KeyRound size={14} color="#2E8E3A" />
                  <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Authentication</span>
                  {hasSavedCredentials && (
                    <span className="ml-auto text-[11px]" style={{ color: "#2E8E3A" }}>saved credential masked</span>
                  )}
                </div>

                {isUrlProtocol ? (
                  <div className="grid gap-3 p-3">
                    <Field label="Auth type">
                      <select
                        value={authType}
                        onChange={(e) => {
                          setAuthType(e.target.value as AuthType);
                          markEdited();
                        }}
                        className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                        style={{ ...INPUT_STYLE, background: "#FFF" }}
                      >
                        {protocol === "erp_directo" ? (
                          <option value="basic">Directo credentials</option>
                        ) : (
                          <>
                            <option value="none">None</option>
                            <option value="apikey">API key</option>
                            <option value="bearer">Bearer token (static)</option>
                            {protocol === "http" && <option value="oauth2">OAuth2 — fetch token first</option>}
                            <option value="basic">Basic auth</option>
                          </>
                        )}
                      </select>
                    </Field>

                    {authType === "apikey" && (
                      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                        <Field label="Header">
                          <input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                        </Field>
                        <Field label="Value">
                          <input value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} placeholder={hasSavedCredentials ? "********" : "sk-..."} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                        </Field>
                      </div>
                    )}

                    {authType === "bearer" && (
                      <Field label="Token">
                        <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} placeholder={hasSavedCredentials ? "********" : "Bearer token"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    )}

                    {authType === "oauth2" && protocol === "http" && (
                      <div className="grid gap-3">
                        <p className="text-[11px]" style={{ color: "#56627A" }}>
                          Before each delivery, ProcuLink calls the token URL with the client credentials, then
                          sends the returned token as <code>Authorization: Bearer</code>. The token is fetched
                          fresh each time and never stored.
                        </p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Token URL">
                            <input value={tokenUrl} onChange={(e) => { setTokenUrl(e.target.value); markEdited(); }} placeholder="https://supplier.example/oauth/token" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Scope (optional)">
                            <input value={oauthScope} onChange={(e) => { setOauthScope(e.target.value); markEdited(); }} placeholder="orders.write" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Field label="Client ID">
                            <input value={oauthClientId} onChange={(e) => { setOauthClientId(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                          <Field label="Client secret">
                            <input value={oauthClientSecret} onChange={(e) => { setOauthClientSecret(e.target.value); markEdited(); }} placeholder={hasSavedCredentials ? "********" : "client secret"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        </div>
                        <details>
                          <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "#56627A" }}>
                            Advanced — grant type / request format / token field
                          </summary>
                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <Field label="Grant type">
                              <input value={oauthGrantType} onChange={(e) => { setOauthGrantType(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                            </Field>
                            <Field label="Token response field">
                              <input value={oauthTokenPath} onChange={(e) => { setOauthTokenPath(e.target.value); markEdited(); }} placeholder="access_token" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                            </Field>
                            <Field label="Request format">
                              <select value={oauthRequestStyle} onChange={(e) => { setOauthRequestStyle(e.target.value as "form" | "json"); markEdited(); }} className="h-9 w-full rounded-[5px] px-2 text-[12px]" style={{ ...INPUT_STYLE, background: "#FFF" }}>
                                <option value="form">Form-encoded (standard)</option>
                                <option value="json">JSON</option>
                              </select>
                            </Field>
                            <Field label="Client auth">
                              <select value={oauthAuthStyle} onChange={(e) => { setOauthAuthStyle(e.target.value as "body" | "basic"); markEdited(); }} className="h-9 w-full rounded-[5px] px-2 text-[12px]" style={{ ...INPUT_STYLE, background: "#FFF" }}>
                                <option value="body">In request body (standard)</option>
                                <option value="basic">HTTP Basic header</option>
                              </select>
                            </Field>
                          </div>
                        </details>
                      </div>
                    )}

                    {authType === "basic" && (
                      <div className={protocol === "erp_directo" ? "grid gap-3 lg:grid-cols-3" : "grid gap-3 lg:grid-cols-2"}>
                        <Field label="Username">
                          <input value={basicUsername} onChange={(e) => setBasicUsername(e.target.value)} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                        </Field>
                        <Field label="Password">
                          <input value={basicPassword} onChange={(e) => setBasicPassword(e.target.value)} placeholder={hasSavedCredentials ? "********" : "Password"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                        </Field>
                        {protocol === "erp_directo" && (
                          <Field label="API key">
                            <input value={directoKey} onChange={(e) => setDirectoKey(e.target.value)} placeholder={hasSavedCredentials ? "********" : "Optional key"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                          </Field>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 p-3">
                    {protocol === "sftp" && (
                      <Field label="Auth method">
                        <select
                          value={sftpAuthMode}
                          onChange={(e) => {
                            setSftpAuthMode(e.target.value as "password" | "key");
                            markEdited();
                          }}
                          className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                          style={{ ...INPUT_STYLE, background: "#FFF" }}
                        >
                          <option value="password">Password</option>
                          <option value="key">Private key</option>
                        </select>
                      </Field>
                    )}
                    <Field label="Username">
                      <input value={basicUsername} onChange={(e) => { setBasicUsername(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                    </Field>
                    {protocol === "sftp" && sftpAuthMode === "key" ? (
                      <>
                        <Field label="Private key">
                          <textarea value={privateKey} onChange={(e) => { setPrivateKey(e.target.value); markEdited(); }} placeholder={hasSavedCredentials ? "******** (leave blank to keep saved key)" : "-----BEGIN OPENSSH PRIVATE KEY-----"} rows={4} className="w-full rounded-[5px] px-2.5 py-2 font-mono text-[11px]" style={INPUT_STYLE} />
                        </Field>
                        <Field label="Key passphrase (optional)">
                          <input value={privateKeyPassphrase} onChange={(e) => { setPrivateKeyPassphrase(e.target.value); markEdited(); }} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                        </Field>
                      </>
                    ) : (
                      <Field label="Password">
                        <input value={basicPassword} onChange={(e) => { setBasicPassword(e.target.value); markEdited(); }} placeholder={hasSavedCredentials ? "********" : "Password"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    )}
                    {/* B8: switched auth method away from the saved shape without a new secret —
                        we won't silently keep the old (wrong-shape) secret. Ask for the new one. */}
                    {credentialBlock && (
                      <p className="rounded-[6px] px-3 py-2 text-[12px]" role="alert" style={{ background: "#FFF6E5", color: "#8A4B00", border: "1px solid #F0D39A" }}>
                        {credentialBlock}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Connector requirements (V7, additive) ────────────────── */}
              <ConnectorRequirementsPanel
                supplierId={supplierId}
                protocol={protocol}
                buildConfig={buildConfigObject}
              />

              <pre className="rounded-[6px] p-3 text-[11px]" style={{ background: "#0B1A2F", color: "#DDE7F7", overflow: "auto" }}>
                {configPreview}
              </pre>

              {error && (
                <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}>
                  {error}
                </div>
              )}

              {/* Post-save nudge (task 8): config is saved but unproven — offer
                  the EXISTING test-fire flow right here. Hidden once a result
                  lands or the form is edited again. */}
              {justSaved && !testResult && (
                <div
                  className="flex flex-col items-start gap-2 rounded-[6px] px-3 py-2 sm:flex-row sm:items-center"
                  role="status"
                  style={{ background: "#F0F7F1", border: "1px solid #CBE8CE" }}
                >
                  <p className="m-0 min-w-0 flex-1 text-[12px] font-medium" style={{ color: "#1F6F2A" }}>
                    Delivery config saved. Prove the connection with a test payload.
                  </p>
                  <button
                    type="button"
                    onClick={testFire}
                    disabled={testing}
                    className="inline-flex h-8 flex-shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold"
                    style={{ border: "none", background: testing ? "var(--ink-faint)" : "#2E8E3A", color: "#FFF", cursor: testing ? "default" : "pointer" }}
                  >
                    <Send size={13} /> {testing ? "Testing..." : "Send a test now"}
                  </button>
                </div>
              )}

              {/* Verbatim test result (task 8): success/errorMessage/responseCode
                  exactly as the backend reported them, plus the honesty note —
                  a 2xx answer is NOT supplier business acceptance. */}
              {testResult && (
                <div
                  className="rounded-[6px] px-3 py-2 text-[12px]"
                  style={{
                    background: testResult.success ? "#F0F7F1" : "#FCEBEB",
                    color: testResult.success ? "#1F6F2A" : "#A52E2E",
                    border: `1px solid ${testResult.success ? "#CBE8CE" : "#F5C5C5"}`,
                  }}
                >
                  <p className="m-0 font-semibold">
                    {testResult.success ? "Test-fire succeeded" : "Test-fire failed"}
                    {testResult.responseCode != null ? ` · response code ${testResult.responseCode}` : ""}
                  </p>
                  {testResult.errorMessage && (
                    <p className="m-0 mt-1 font-medium">{testResult.errorMessage}</p>
                  )}
                  {testResult.success && (
                    <p className="m-0 mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
                      A successful test means their endpoint answered — it doesn&apos;t mean an order was accepted.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center" style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}>
        {savedConfig && (
          <button onClick={remove} disabled={saving} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF" }}>
            <Trash2 size={13} /> Delete
          </button>
        )}
        <div className="hidden flex-1 sm:block" />
        <button onClick={testFire} disabled={!savedConfig || testing} title={!savedConfig ? "Save the delivery setup first, then you can test it." : "Send a small test to check the connection."} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF", opacity: !savedConfig ? 0.55 : 1 }}>
          <Send size={13} /> {testing ? "Testing..." : "Test-fire"}
        </button>
        <button onClick={save} disabled={saving || !canSave || credentialBlock !== null} title={credentialBlock ?? (!canSave ? "Fill in the required fields first (e.g. Host for SFTP/FTPS, URL for HTTP, or SMTP host + sender for email)." : undefined)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "none", color: "#FFF", background: saving || !canSave || credentialBlock !== null ? "var(--ink-faint)" : "#0B1A2F" }}>
          <Save size={13} /> {saving ? "Saving..." : "Save delivery"}
        </button>
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
