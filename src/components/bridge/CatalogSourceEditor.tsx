"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Trash2, Zap, AlertTriangle } from "lucide-react";
import {
  deleteCatalogSource,
  getCatalogSource,
  testFetchCatalogSource,
  upsertCatalogSource,
} from "@/lib/api/catalogSources";
import type {
  CatalogSource,
  CatalogSourceProtocol,
  CatalogSourceTestResult,
} from "@/lib/api/catalogSources";
import { defaultPortForProtocol, formatLastSync } from "./catalogSourceHelpers";

const INPUT_STYLE = { border: "1px solid #D5DAEA", color: "#0B1A2F" } as const;

// FTPS first to default-discourage plaintext FTP.
const PROTOCOLS: Array<{ id: CatalogSourceProtocol; label: string }> = [
  { id: "sftp", label: "SFTP" },
  { id: "ftps", label: "FTPS" },
  { id: "ftp", label: "FTP" },
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

  const [protocol, setProtocol] = useState<CatalogSourceProtocol>("sftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [schedule, setSchedule] = useState<number | "">(24);
  const [isEnabled, setIsEnabled] = useState(false);

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
    setRemotePath(s.path);
    setSchedule(s.schedule || 24);
    setIsEnabled(s.isEnabled);
    setPassword("");
  }

  function markEdited() {
    setTestResult(null);
    setError(null);
    setNotice(null);
  }

  const hasPassword = savedSource?.hasPassword ?? false;
  const usernameRequired = protocol === "sftp" || protocol === "ftps";
  const passwordRequired = protocol === "sftp" || protocol === "ftps";

  // Password write-only: "" sentinel means keep when one is already stored.
  function passwordPayload(): string | null {
    if (password.length > 0) return password; // set new
    if (hasPassword) return null; // keep stored
    return ""; // none / clear
  }

  const canSave =
    Boolean(host.trim()) &&
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
        host: host.trim(),
        port: Number(port) || defaultPortForProtocol(protocol),
        path: remotePath.trim(),
        username: usernameRequired ? username.trim() : username.trim() || null,
        password: passwordPayload(),
        schedule: Number(schedule) || 24,
        isEnabled,
      });
      setSavedSource(result.source);
      hydrate(result.source);
      setNotice(result.syncEnqueued ? "Saved — sync queued." : "Import source saved.");
      invalidateCatalogCaches();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save import source.";
      // Surface the backend's billing/SSRF gates as plain language.
      if (msg.includes("catalog_sync_requires_integration")) {
        setError("Automatic catalog sync is included from any paid plan. Upgrade from Pilot to enable polling.");
      } else if (msg.includes("host_not_allowed")) {
        setError("That host is not allowed — private, loopback, and link-local addresses are blocked.");
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
      setProtocol("sftp");
      setHost("");
      setPort(22);
      setUsername("");
      setPassword("");
      setRemotePath("");
      setSchedule(24);
      setIsEnabled(false);
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

  return (
    <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <div
        className="flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: isEnabled ? "#2E8E3A" : "var(--ink-faint)" }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Pull from a file server</h3>
          <p className="text-[11px]" style={{ color: "#56627A" }}>
            ProcuLink fetches the supplier&apos;s catalog file on a schedule and upserts products by code.
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
          <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>Protocol</p>
          <div className="grid gap-2">
            {PROTOCOLS.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setProtocol(item.id);
                  setPort((prev) => (prev === "" ? defaultPortForProtocol(item.id) : prev));
                  markEdited();
                }}
                className="flex h-9 items-center justify-between rounded-[6px] px-3 text-[12px] font-semibold"
                style={{
                  border: protocol === item.id ? "1px solid #2E8E3A" : "1px solid #D5DAEA",
                  background: protocol === item.id ? "#E2F1E2" : "#FFFFFF",
                  color: "#0B1A2F",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-[6px] p-3" style={{ background: "#F0F7F1", border: "1px solid #CBE8CE" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#1F6F2A" }}>What gets imported</p>
            <p className="mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
              CSV/XLSX columns are auto-detected: code (required), name, unit, price, currency, barcode.
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

              {/* ── Credentials ───────────────────────────────────────────── */}
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
        <button onClick={testFetch} disabled={!savedSource || testing} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF", opacity: !savedSource ? 0.55 : 1 }}>
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
