"use client";

import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Trash2, Zap, AlertTriangle, Download, RefreshCw } from "lucide-react";
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
  CatalogCanonicalField,
} from "@/lib/api/catalogSources";
import { CATALOG_CANONICAL_FIELDS } from "@/lib/api/catalogSources";
import { isArrowKey, rovingRadioNext } from "@/lib/roving-radio";
import {
  buildAuthConfigPayload,
  defaultPortForProtocol,
  formatLastSync,
  hasSavedAuthSecretForMethod,
  httpAuthFormSatisfied,
  protocolIsVendor,
  protocolUsesUrl,
  LAST_SYNC_DOT,
  type CatalogAuthFormState,
} from "./catalogSourceHelpers";
import { useConfirm } from "@/components/ui/confirm";
import { isPlanGateError, planGateMessage } from "@/lib/planGate";
import { inspectOutboundUrl, isRefusal, OUTBOUND_URL_ERRORS } from "@/lib/outboundUrlPolicy";
import { NUMBER_LOCALE } from "@/lib/format-number";

const INPUT_STYLE = { border: "1px solid #D5DAEA", color: "#0B1A2F" } as const;

// Fixed canonical columns the test-fetch preview renders (matches CatalogSampleRow).
const SAMPLE_COLUMNS: Array<{ key: keyof import("@/lib/api/catalogSources").CatalogSampleRow; label: string }> = [
  { key: "code", label: "code" },
  { key: "name", label: "name" },
  { key: "unit", label: "unit" },
  { key: "price", label: "price" },
  { key: "currency", label: "currency" },
  { key: "barcode", label: "barcode" },
  { key: "externalId", label: "external_id" },
];

function formatSampleCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// Client-side canonical catalog CSV template — header + 2 example rows. Generated in the
// browser (Blob + download), no backend. Lets a non-technical user see the exact shape
// ProcuLink reads before they hunt for their supplier's export.
const CATALOG_TEMPLATE_CSV =
  "code,name,unit,price,currency,barcode\n" +
  "ACME-001,Widget A,each,12.50,EUR,5901234123457\n" +
  "ACME-002,Widget B,box,24.00,EUR,5901234123464\n";

function downloadCatalogTemplate() {
  const blob = new Blob([CATALOG_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = "proculink-catalog-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

// Human labels for the canonical mapping targets.
const CANONICAL_FIELD_LABELS: Record<CatalogCanonicalField, string> = {
  code: "code (required)",
  name: "name",
  unit: "unit",
  price: "price",
  currency: "currency",
  barcode: "barcode",
  external_id: "external ID",
};

// HTTPS + FTPS/SFTP first to default-discourage plaintext FTP / cleartext HTTP.
// "aes2fa" names an AUTH MECHANISM, not a transport: a vendor connector whose per-call
// AES 2FA signing bypasses the generic HTTP auth path via the backend fetcher seam. It is
// filtered out of the picker for new setups (see visibleProtocols) and kept here only so a
// source already saved with it stays renderable/editable.
const PROTOCOLS: Array<{ id: CatalogSourceProtocol; label: string }> = [
  { id: "https", label: "HTTPS API (encrypted)" },
  { id: "http", label: "HTTP API (not encrypted)" },
  { id: "sftp", label: "SFTP" },
  { id: "ftps", label: "FTPS" },
  { id: "ftp", label: "FTP" },
  { id: "aes2fa", label: "AES 2FA signed API" },
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
  const confirm = useConfirm();

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

  // AES 2FA signed-API vendor credentials (write-only).
  const [aes2faCustomerId, setAes2faCustomerId] = useState("");
  const [aes2faConsumerKey, setAes2faConsumerKey] = useState("");
  const [aes2faConsumerSecret, setAes2faConsumerSecret] = useState("");
  const [aes2faAccessTokenKey, setAes2faAccessTokenKey] = useState("");
  const [aes2faCurrency, setAes2faCurrency] = useState("EUR");

  // Per-source column mapping (advanced, collapsed by default). Rows of source-column →
  // canonical field. Directive rows (__noheader__/__encoding__) are edited via dedicated toggles.
  const [showMapping, setShowMapping] = useState(false);
  const [mappingRows, setMappingRows] = useState<Array<{ column: string; field: CatalogCanonicalField }>>([]);
  const [noHeader, setNoHeader] = useState(false);
  const [encodingHint, setEncodingHint] = useState("");

  const [testResult, setTestResult] = useState<CatalogSourceTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Distinguishes a FAILED INITIAL LOAD (getCatalogSource threw) from save/test errors that
  // reuse `error`. The banner alone was not enough: it appeared ABOVE a complete, enabled form
  // whose every field had fallen back to its "nothing configured" default, and `savedSource`
  // stayed null. Saving from there is a write, and the write is the danger — `passwordPayload()`
  // returns "" when `hasPassword` is false, which CLEARS the stored secret, alongside a blank
  // `columnMapping` and a reset 24h schedule. So a source that exists but could not be read
  // must block, not render as a source that does not exist. `reloadNonce` re-runs the loader.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setLoadFailed(false);
      try {
        const source = await getCatalogSource(supplierId);
        if (cancelled) return;
        setSavedSource(source);
        if (source) hydrate(source);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load import source.");
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supplierId, reloadNonce]);

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
    // AES 2FA vendor creds are write-only — never hydrated; only "saved · masked" is shown.
    setAes2faCustomerId("");
    setAes2faConsumerKey("");
    setAes2faConsumerSecret("");
    setAes2faAccessTokenKey("");
    setAes2faCurrency("EUR");
    // Column mapping IS echoed back (not a secret) — hydrate the editable rows + directives.
    const mapping = s.columnMapping ?? {};
    setNoHeader(String(mapping["__noheader__"] ?? "").toLowerCase() === "true");
    setEncodingHint(mapping["__encoding__"] ?? "");
    const rows = Object.entries(mapping)
      .filter(([k]) => k !== "__noheader__" && k !== "__encoding__")
      .filter(([, v]) => (CATALOG_CANONICAL_FIELDS as readonly string[]).includes(v))
      .map(([column, field]) => ({ column, field: field as CatalogCanonicalField }));
    setMappingRows(rows);
    setShowMapping(rows.length > 0);
  }

  function markEdited() {
    setTestResult(null);
    setError(null);
    setNotice(null);
  }

  const isUrlProtocol = protocolUsesUrl(protocol);
  const isVendorProtocol = protocolIsVendor(protocol);
  const isHttpProtocol = protocol === "http" || protocol === "https";
  const hasPassword = savedSource?.hasPassword ?? false;
  // Vendor creds saved (write-only) only counts when the SAVED source is also aes2fa.
  const aes2faHasSavedCreds =
    isVendorProtocol && (savedSource?.hasAuthConfig ?? false) && savedSource?.protocol === "aes2fa";

  // The AES 2FA connector is never OFFERED for a new setup — but a source already
  // saved with it must not become invisible/uneditable, so the tile renders while
  // the saved source (or the current, not-yet-saved selection) still uses it.
  // "aes2fa" is hidden as a vendor connector; "http" is hidden because the API now refuses a
  // cleartext feed URL, so offering it would be an option that can only fail. Both stay visible
  // when that is what is already saved, so an existing source remains renderable and editable.
  const visibleProtocols = PROTOCOLS.filter((p) => {
    if (p.id === "aes2fa") return protocol === "aes2fa" || savedSource?.protocol === "aes2fa";
    if (p.id === "http") return protocol === "http" || savedSource?.protocol === "http";
    return true;
  });

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
    const nextId = rovingRadioNext(event.key, protocol, visibleProtocols.map((p) => p.id));
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

  // aes2fa: all four creds provided together, OR saved creds kept (all fields blank).
  const aes2faFormSatisfied = (() => {
    const anyTyped =
      aes2faCustomerId.trim() || aes2faConsumerKey.trim() ||
      aes2faConsumerSecret || aes2faAccessTokenKey;
    if (anyTyped) {
      return Boolean(
        aes2faCustomerId.trim() && aes2faConsumerKey.trim() &&
        aes2faConsumerSecret && aes2faAccessTokenKey,
      );
    }
    return aes2faHasSavedCreds;
  })();

  // The API refuses a cleartext feed URL outright. This mirror exists so the operator is told
  // at the point of typing rather than after a round trip; loopback stays allowed for local dev.
  const urlVerdict = isUrlProtocol && url.trim() ? inspectOutboundUrl(url, "Catalog URL") : null;
  const urlProblem = urlVerdict && isRefusal(urlVerdict) ? urlVerdict.message : null;

  const canSave = isVendorProtocol
    ? Boolean(url.trim()) && !urlProblem && aes2faFormSatisfied
    : isHttpProtocol
      ? Boolean(url.trim()) && !urlProblem && httpAuthFormSatisfied(authForm, savedAuthSecretForMethod)
      : Boolean(host.trim()) &&
        Boolean(remotePath.trim()) &&
        (!usernameRequired || Boolean(username.trim())) &&
        (!passwordRequired || password.length > 0 || hasPassword);

  // Build the write-only vendorConfig payload (null = keep, object = set).
  function vendorConfigPayload() {
    if (!isVendorProtocol) return null;
    const anyTyped =
      aes2faCustomerId.trim() || aes2faConsumerKey.trim() ||
      aes2faConsumerSecret || aes2faAccessTokenKey;
    if (!anyTyped && aes2faHasSavedCreds) return null; // keep stored
    return {
      customerId: aes2faCustomerId.trim(),
      consumerKey: aes2faConsumerKey.trim(),
      consumerSecret: aes2faConsumerSecret,
      accessTokenKey: aes2faAccessTokenKey,
      currency: aes2faCurrency.trim() || "EUR",
    };
  }

  // Build the columnMapping payload from the rows + directives. Always sent (not a secret) so
  // clearing all rows clears the stored mapping ({} on the wire).
  function columnMappingPayload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of mappingRows) {
      const col = r.column.trim();
      if (col) out[col] = r.field;
    }
    if (noHeader) out["__noheader__"] = "true";
    if (encodingHint.trim()) out["__encoding__"] = encodingHint.trim();
    return out;
  }

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
        // http/https/aes2fa (url) — auth method/config only for http; vendor config for aes2fa:
        url: isUrlProtocol ? url.trim() : null,
        authMethod: isHttpProtocol ? authMethod : null,
        authConfig: isHttpProtocol ? buildAuthConfigPayload(authForm, savedAuthSecretForMethod) : null,
        httpMethod: isUrlProtocol ? "GET" : null,
        vendorConfig: isVendorProtocol ? vendorConfigPayload() : null,
        // Column mapping applies to every protocol (always sent so clearing rows clears it).
        columnMapping: columnMappingPayload(),
      });
      setSavedSource(result.source);
      hydrate(result.source);
      setNotice(result.syncEnqueued ? "Saved — sync queued." : "Import source saved.");
      invalidateCatalogCaches();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save import source.";
      // Surface the backend's billing/SSRF/URL gates as plain language.
      // Matched by SHAPE, not by the full literal: the 403's plan segment is derived
      // server-side from the gate table, so it changes if catalog sync is ever re-tiered.
      // The old check hardcoded `catalog_sync_requires_integration` and would have stopped
      // matching the moment the backend started naming the plan it really requires.
      if (isPlanGateError(msg)) {
        setError(`Automatic catalog sync is not available on your plan. ${planGateMessage(msg)}`);
      } else if (msg.includes("host_not_allowed")) {
        setError("That host is not allowed — private, loopback, and link-local addresses are blocked.");
      } else if (msg.includes("credentials_in_url_not_allowed")) {
        setError("Remove the username/password from the URL — store credentials in the auth fields instead.");
      } else if (msg.includes(OUTBOUND_URL_ERRORS.insecureTransport)) {
        setError(
          "That URL uses plain http, which sends the feed and any API key or token unencrypted. " +
            "Use the supplier's https:// address instead.",
        );
      } else if (msg.includes(OUTBOUND_URL_ERRORS.schemeNotAllowed)) {
        setError("That URL scheme is not supported. Use an https:// address.");
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete import source",
      description: "Delete this import source? Manual catalog upload still works.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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
      setAes2faCustomerId("");
      setAes2faConsumerKey("");
      setAes2faConsumerSecret("");
      setAes2faAccessTokenKey("");
      setAes2faCurrency("EUR");
      setMappingRows([]);
      setNoHeader(false);
      setEncodingHint("");
      setShowMapping(false);
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

  // Initial-load failure — a blocking state with a retry, NOT the form. The form's fields all
  // read "nothing is configured", and the Save button below them sits in the footer outside the
  // `loading` branch, so it stays live: one click writes those defaults over a source that may
  // be perfectly healthy and merely unreadable this second, clearing its stored password on the
  // way through. Same shape as DeliveryConfigEditor's load-failure card, for the same reason.
  // Save/test errors keep using `error` inside the form.
  if (loadFailed && !loading) {
    // Tokens, not the hex literals the rest of this (baselined) file still uses — new code does
    // not add to that debt.
    return (
      <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center" role="alert">
          <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Couldn&apos;t load this import source</p>
          <p className="max-w-[380px] text-[12px] leading-5" style={{ color: "var(--ink-muted)" }}>
            {error ?? "Something went wrong loading this supplier's import source."} That is not the
            same as &ldquo;no import source&rdquo; — one may already be saved and syncing. Nothing has
            been changed. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-surface px-3 text-[12px] font-medium"
            style={{ minHeight: 36, border: "1px solid var(--border-strong)", color: "var(--ink)", cursor: "pointer" }}
          >
            <RefreshCw size={13} strokeWidth={2} aria-hidden /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E5E8EE", background: "#FFFFFF" }}>
      <div
        className="flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center"
        style={{ borderBottom: "1px solid #E5E8EE", background: "#F6F7FA" }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: isEnabled ? "#2E8E3A" : "var(--ink-faint)" }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Pull from a file server or API</h3>
          <p className="text-[11px]" style={{ color: "#5E6779" }}>
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
        <div className="p-4" style={{ borderRight: "1px solid #E5E8EE", background: "#FBFCFE" }}>
          <p id="catalog-protocol-label" className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Protocol</p>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="catalog-protocol-label" onKeyDown={handleProtocolKeyDown}>
            {visibleProtocols.map((item) => {
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
                  className="flex min-h-[44px] items-center rounded-[6px] px-3 text-left text-[12px] font-semibold"
                  style={{
                    border: selected ? "1px solid #2E8E3A" : "1px solid #D5DAEA",
                    background: selected ? "#E9F1EA" : "#FFFFFF",
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
              CSV / XLSX / JSON / XML / CIF columns are auto-detected: code (required), name, unit, price,
              currency, barcode. ZIP archives are unpacked automatically. When a column isn&apos;t recognised,
              map it below.
            </p>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-[13px]" style={{ color: "#5E6779" }}>Loading import source...</p>
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

              {urlProblem && (
                <div
                  className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[12px]"
                  style={{ background: "#FCEBEB", border: "1px solid #F5C5C5", color: "#A52E2E" }}
                  role="alert"
                >
                  <AlertTriangle size={15} className="mt-px flex-shrink-0" />
                  <span>{urlProblem}</span>
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
                      // Keep the picker honest: for the plain http/https API the URL scheme is what
                      // the fetch uses. Vendor connectors (aes2fa) keep their protocol regardless.
                      if (!isVendorProtocol) {
                        const lower = next.trim().toLowerCase();
                        if (lower.startsWith("http://")) setProtocol("http");
                        else if (lower.startsWith("https://")) setProtocol("https");
                      }
                      markEdited();
                    }}
                    placeholder={isVendorProtocol
                      ? "https://api.supplier.example/catalog"
                      : "https://api.supplier.example/v1/catalog.csv"}
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
                    <option value="xml">XML (cXML Index / vendor XML)</option>
                    <option value="cif">CIF (Ariba 3.0)</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    Leave on auto-detect unless the supplier&apos;s file has no clear extension.
                  </p>
                </div>
              </div>

              {/* ── What we read + a downloadable template (helps non-technical users) ── */}
              <div className="flex flex-col gap-2 rounded-[6px] p-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: "#FBFCFE", border: "1px solid #E5E8EE" }}>
                <p className="m-0 min-w-0 flex-1 text-[11px] leading-[1.5]" style={{ color: "#5E6779" }}>
                  These are the columns we read from your catalog. <code>code</code> is the supplier&apos;s own
                  item number — we match your order lines to it. Only <code>code</code> is required.
                </p>
                <button
                  type="button"
                  onClick={downloadCatalogTemplate}
                  className="inline-flex h-8 flex-shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold"
                  style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF" }}
                >
                  <Download size={13} /> Download CSV template
                </button>
              </div>
              <HelpLink href="/help/catalog-csv-field-guide" label="catalog CSV guide" />

              {/* ── Credentials: HTTP auth OR AES 2FA vendor creds OR file-server password ── */}
              {isVendorProtocol ? (
                <div className="rounded-[7px]" style={{ border: "1px solid #E5E8EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E5E8EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>AES 2FA credentials</span>
                    {aes2faHasSavedCreds && (
                      <span
                        className="ml-auto text-[11px]"
                        // #1E6D29 not #2E8E3A: 11px TEXT on the white card is
                        // 4.1613:1 with green, 6.4128:1 with green-deep. The
                        // KeyRound icon beside it stays green — non-text, 3:1.
                        style={{ color: "#1E6D29" }}
                      >
                        saved · masked
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 p-3">
                    <p className="text-[11px]" style={{ color: "#5E6779" }}>
                      This connector signs each request with your credentials (AES 2FA). Enter the
                      four keys the vendor issued; they are stored encrypted and never shown again.
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Field label="Customer ID">
                        <input value={aes2faCustomerId} onChange={(e) => { setAes2faCustomerId(e.target.value); markEdited(); }} placeholder={aes2faHasSavedCreds ? "•••• (leave blank to keep)" : "Your customer number"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                      <Field label="Currency">
                        <input value={aes2faCurrency} onChange={(e) => { setAes2faCurrency(e.target.value); markEdited(); }} placeholder="EUR" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    </div>
                    <Field label="Consumer key">
                      {/* Masked like its siblings below: all four keys live in the same encrypted auth blob. */}
                      <input type="password" value={aes2faConsumerKey} onChange={(e) => { setAes2faConsumerKey(e.target.value); markEdited(); }} placeholder={aes2faHasSavedCreds ? "•••• (leave blank to keep)" : "ConsumerKey"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                    </Field>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <Field label="Consumer secret">
                        <input type="password" value={aes2faConsumerSecret} onChange={(e) => { setAes2faConsumerSecret(e.target.value); markEdited(); }} placeholder={aes2faHasSavedCreds ? "••••" : "ConsumerSecret"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                      <Field label="Access-token key">
                        <input type="password" value={aes2faAccessTokenKey} onChange={(e) => { setAes2faAccessTokenKey(e.target.value); markEdited(); }} placeholder={aes2faHasSavedCreds ? "••••" : "AccessTokenKey (32 chars)"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
                      </Field>
                    </div>
                    {aes2faHasSavedCreds && (
                      <p className="m-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                        Leave all four blank to keep the saved credentials. To change any, re-enter all four —
                        they are stored together.
                      </p>
                    )}
                  </div>
                </div>
              ) : isHttpProtocol ? (
                <div className="rounded-[7px]" style={{ border: "1px solid #E5E8EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E5E8EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Authentication</span>
                    {savedAuthSecretForMethod && (
                      <span
                        className="ml-auto text-[11px]"
                        // #1E6D29 not #2E8E3A: 11px TEXT on the white card is
                        // 4.1613:1 with green, 6.4128:1 with green-deep. The
                        // KeyRound icon beside it stays green — non-text, 3:1.
                        style={{ color: "#1E6D29" }}
                      >
                        saved · masked
                      </span>
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
                        <p className="text-[11px]" style={{ color: "#5E6779" }}>
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
                <div className="rounded-[7px]" style={{ border: "1px solid #E5E8EE" }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E5E8EE" }}>
                    <KeyRound size={14} color="#2E8E3A" />
                    <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Credentials</span>
                    {hasPassword && (
                      <span
                        className="ml-auto text-[11px]"
                        // #1E6D29 not #2E8E3A: 11px TEXT on the white card is
                        // 4.1613:1 with green, 6.4128:1 with green-deep. The
                        // KeyRound icon beside it stays green — non-text, 3:1.
                        style={{ color: "#1E6D29" }}
                      >
                        saved · masked
                      </span>
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

              {/* ── Advanced: per-source column mapping (collapsed; opens when test-fetch found unmapped columns) ── */}
              <ColumnMappingPanel
                open={showMapping}
                onToggle={() => setShowMapping((v) => !v)}
                rows={mappingRows}
                setRows={(r) => { setMappingRows(r); markEdited(); }}
                noHeader={noHeader}
                setNoHeader={(v) => { setNoHeader(v); markEdited(); }}
                encodingHint={encodingHint}
                setEncodingHint={(v) => { setEncodingHint(v); markEdited(); }}
                unmappedColumns={testResult?.ok ? testResult.unmappedColumns : []}
              />

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
                    border: `1px solid ${lastSync.tone === "failed" ? "#F5C5C5" : "#E5E8EE"}`,
                    color: lastSync.tone === "failed" ? "#A52E2E" : "#5E6779",
                  }}
                >
                  {/* Colour comes from the exhaustive LAST_SYNC_DOT record, not a ternary
                      chain: the chain's trailing branch is what a new tone would inherit,
                      and the sibling defect (an unrecognised STATUS inheriting the "ok"
                      arm of formatLastSync's switch) is the whole reason this line moved. */}
                  <span
                    data-testid="catalog-last-sync-dot"
                    data-tone={lastSync.tone}
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: LAST_SYNC_DOT[lastSync.tone] }}
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

      <div className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center" style={{ borderTop: "1px solid #E5E8EE", background: "#F6F7FA" }}>
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
        {result.bytes != null && <span>{result.bytes.toLocaleString(NUMBER_LOCALE)} bytes</span>}
        {result.parsedRows != null && <span>{result.parsedRows} rows</span>}
        {result.rowsWithCode != null && <span>{result.rowsWithCode} with a code</span>}
      </div>
      <div className="grid gap-3 p-3">
        {Object.keys(result.mappedFields).length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Mapped columns</p>
            <div className="overflow-hidden rounded-[6px]" style={{ border: "1px solid #E5E8EE" }}>
              <table className="w-full border-collapse" style={{ fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F6F7FA", color: "#5E6779", textAlign: "left" }}>
                    <th style={{ padding: "5px 9px", fontWeight: 700 }}>Their column</th>
                    <th style={{ padding: "5px 9px", fontWeight: 700 }}>Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.mappedFields).map(([column, field]) => (
                    <tr key={column} style={{ borderTop: "1px solid #EEF0F4" }}>
                      <td style={{ padding: "5px 9px", fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F" }}>{column}</td>
                      <td style={{ padding: "5px 9px", color: "#0B1A2F" }}>{field}</td>
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
                <span key={c} className="rounded-[4px] px-2 py-0.5 text-[11px]" style={{ background: "#F1F3F7", color: "#5E6779", fontFamily: "'JetBrains Mono',monospace" }}>{c}</span>
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
            {/* Render the FIXED canonical columns the backend actually returns (CatalogSampleRow),
                not the raw source headers — the previous row[header] lookup rendered blank cells. */}
            <div className="overflow-x-auto rounded-[6px]" style={{ border: "1px solid #E5E8EE" }}>
              <table className="w-full border-collapse" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: "#F6F7FA", color: "#5E6779", textAlign: "left" }}>
                    {SAMPLE_COLUMNS.map((c) => (
                      <th key={c.key} style={{ padding: "5px 9px", fontWeight: 700, whiteSpace: "nowrap" }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.sampleRows.map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #EEF0F4" }}>
                      {SAMPLE_COLUMNS.map((c) => (
                        <td key={c.key} style={{ padding: "5px 9px", color: "#0B1A2F", whiteSpace: "nowrap" }}>
                          {formatSampleCell(row[c.key])}
                        </td>
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

// Small, quiet "Need help?" link to the matching /help article. Opens in a new
// tab (the help centre is a marketing route). Muted to match nearby helper text.
function HelpLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px]"
      style={{ color: "var(--ink-muted)", textDecoration: "underline", textUnderlineOffset: 2 }}
    >
      Need help? See the {label} →
    </Link>
  );
}

/**
 * Advanced per-source column mapping (plan 2026-07-02 7.3). Collapsed by default and kept off the
 * happy path — the backend auto-detects common column names. When the last test-fetch reported
 * unmapped columns, they are surfaced as one-click chips to prefill a mapping row. Supports the
 * two directives for headerless / non-UTF-8 feeds (Ingram/Also): "first row is data" and encoding.
 */
function ColumnMappingPanel({
  open,
  onToggle,
  rows,
  setRows,
  noHeader,
  setNoHeader,
  encodingHint,
  setEncodingHint,
  unmappedColumns,
}: {
  open: boolean;
  onToggle: () => void;
  rows: Array<{ column: string; field: CatalogCanonicalField }>;
  setRows: (rows: Array<{ column: string; field: CatalogCanonicalField }>) => void;
  noHeader: boolean;
  setNoHeader: (v: boolean) => void;
  encodingHint: string;
  setEncodingHint: (v: string) => void;
  unmappedColumns: string[];
}) {
  const hasUnmapped = unmappedColumns.length > 0;
  const configured = rows.length > 0 || noHeader || encodingHint.trim().length > 0;

  function addRow(column = "") {
    setRows([...rows, { column, field: "code" }]);
  }
  function updateRow(i: number, patch: Partial<{ column: string; field: CatalogCanonicalField }>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="rounded-[7px]" style={{ border: "1px solid #E5E8EE" }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        style={{ background: "#F6F7FA" }}
        aria-expanded={open}
      >
        <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Map columns (advanced)</span>
        {(hasUnmapped || configured) && (
          <span
            className="ml-auto text-[11px]"
            // #1E6D29 not #2E8E3A: this count is 11px TEXT on the #F6F7FA
            // header, where green is 3.8846:1 and green-deep is 5.9863:1.
            style={{ color: hasUnmapped ? "#7A4D0B" : "#1E6D29" }}
          >
            {configured ? `${rows.length} mapped` : `${unmappedColumns.length} unmapped column${unmappedColumns.length === 1 ? "" : "s"}`}
          </span>
        )}
      </button>

      {open && (
        <div className="grid gap-3 p-3">
          <p className="m-0 text-[11px]" style={{ color: "#5E6779" }}>
            Only needed when the supplier&apos;s column names aren&apos;t recognised. Map their column (or a
            0-based position for a file with no header row) to a ProcuLink field.
          </p>

          {hasUnmapped && (
            <div>
              <p className="mb-1 text-[11px]" style={{ color: "var(--ink-faint)" }}>From the last preview — click to map:</p>
              <div className="flex flex-wrap gap-1.5">
                {unmappedColumns.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => addRow(c)}
                    className="rounded-[4px] px-2 py-0.5 text-[11px]"
                    style={{ background: "#FFF3E0", color: "#7A4D0B", border: "1px solid #F0D39A", fontFamily: "'JetBrains Mono',monospace" }}
                  >
                    + {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <Field label="Their column (or index)">
                <input
                  value={r.column}
                  onChange={(e) => updateRow(i, { column: e.target.value })}
                  placeholder='e.g. "Id" or 3'
                  className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label="ProcuLink field">
                <select
                  value={r.field}
                  onChange={(e) => updateRow(i, { field: e.target.value as CatalogCanonicalField })}
                  className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                  style={{ ...INPUT_STYLE, background: "#FFF" }}
                >
                  {CATALOG_CANONICAL_FIELDS.map((f) => (
                    <option key={f} value={f}>{CANONICAL_FIELD_LABELS[f]}</option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="inline-flex h-9 items-center justify-center rounded-[5px] px-2 text-[12px]"
                style={{ border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF" }}
                aria-label="Remove mapping row"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => addRow()}
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold"
            style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF" }}
          >
            + Add column mapping
          </button>

          <div className="grid gap-2 rounded-[6px] p-3" style={{ background: "#FBFCFE", border: "1px solid #E5E8EE" }}>
            <label className="flex items-center gap-2 text-[12px]" style={{ color: "#0B1A2F" }}>
              <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)} />
              This file has no header row (map by column position, starting at 0)
            </label>
            <Field label="File encoding (optional)">
              <input
                value={encodingHint}
                onChange={(e) => setEncodingHint(e.target.value)}
                placeholder="e.g. windows-1252 (leave blank for UTF-8)"
                className="h-9 w-full rounded-[5px] px-2.5 text-[12px] lg:max-w-[280px]"
                style={INPUT_STYLE}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
