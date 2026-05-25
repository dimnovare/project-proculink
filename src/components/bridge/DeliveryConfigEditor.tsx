"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { KeyRound, Save, Send, Trash2 } from "lucide-react";
import {
  deleteDeliveryConfig,
  getDeliveryConfig,
  testFireDelivery,
  upsertDeliveryConfig,
} from "@/lib/api/delivery";
import type { DeliveryConfig, DeliveryProtocol, DeliveryTestResult } from "@/lib/api/types";

type AuthType = "none" | "apikey" | "bearer" | "basic";

interface DeliveryConfigEditorProps {
  supplierId: string;
}

const PROTOCOLS: Array<{ id: DeliveryProtocol; label: string; enabled: boolean }> = [
  { id: "http", label: "HTTP", enabled: true },
  { id: "sftp", label: "SFTP", enabled: false },
  { id: "ftp", label: "FTP", enabled: false },
];

export function DeliveryConfigEditor({ supplierId }: DeliveryConfigEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedConfig, setSavedConfig] = useState<DeliveryConfig | null>(null);
  const [protocol, setProtocol] = useState<DeliveryProtocol>("http");
  const [autoDeliver, setAutoDeliver] = useState(false);
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [authType, setAuthType] = useState<AuthType>("none");
  const [apiKeyHeader, setApiKeyHeader] = useState("X-Api-Key");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
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
          hydrateHttpConfig(config.configJson);
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

  const configPreview = useMemo(
    () =>
      JSON.stringify(
        {
          url,
          method,
          timeoutSeconds,
        },
        null,
        2
      ),
    [method, timeoutSeconds, url]
  );

  function hydrateHttpConfig(configJson: string) {
    try {
      const parsed = JSON.parse(configJson) as {
        url?: string;
        method?: string;
        timeoutSeconds?: number;
      };
      setUrl(parsed.url ?? "");
      setMethod(parsed.method ?? "POST");
      setTimeoutSeconds(parsed.timeoutSeconds ?? 30);
    } catch {
      setUrl("");
      setMethod("POST");
      setTimeoutSeconds(30);
    }
  }

  function markEdited() {
    setTestResult(null);
    setError(null);
  }

  function buildCredentialsJson(): string | null {
    if (authType === "none") return "{\"type\":\"none\"}";
    if (authType === "apikey") {
      if (!apiKeyValue && hasSavedCredentials) return null;
      return JSON.stringify({ type: "apikey", header: apiKeyHeader, value: apiKeyValue });
    }
    if (authType === "bearer") {
      if (!bearerToken && hasSavedCredentials) return null;
      return JSON.stringify({ type: "bearer", token: bearerToken });
    }
    if (!basicPassword && hasSavedCredentials) return null;
    return JSON.stringify({ type: "basic", username: basicUsername, password: basicPassword });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertDeliveryConfig(supplierId, {
        protocol,
        autoDeliver,
        configJson: JSON.stringify({ url, method, timeoutSeconds }),
        credentialsJson: buildCredentialsJson(),
      });
      setSavedConfig(saved);
      setApiKeyValue("");
      setBearerToken("");
      setBasicPassword("");
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save delivery config.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await deleteDeliveryConfig(supplierId);
      setSavedConfig(null);
      setAutoDeliver(false);
      setUrl("");
      setAuthType("none");
      setTestResult(null);
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
      setTestResult(await testFireDelivery(supplierId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run delivery test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: autoDeliver ? "#2E8E3A" : "#8A93A5" }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Supplier delivery</h3>
          <p className="text-[11px]" style={{ color: "#56627A" }}>
            Configure the channel used after an order reaches ready_to_deliver.
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

      <div className="grid gap-0" style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}>
        <div className="p-4" style={{ borderRight: "1px solid #E2E6EE", background: "#FBFCFE" }}>
          <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>Protocol</p>
          <div className="grid gap-2">
            {PROTOCOLS.map((item) => (
              <button
                key={item.id}
                disabled={!item.enabled}
                onClick={() => {
                  setProtocol(item.id);
                  markEdited();
                }}
                className="flex h-9 items-center justify-between rounded-[6px] px-3 text-[12px] font-semibold"
                style={{
                  border: protocol === item.id ? "1px solid #1E66C9" : "1px solid #D5DAEA",
                  background: protocol === item.id ? "#EEF5FF" : "#FFFFFF",
                  color: item.enabled ? "#0B1A2F" : "#8A93A5",
                  cursor: item.enabled ? "pointer" : "not-allowed",
                }}
              >
                {item.label}
                {!item.enabled && <span className="text-[10px] font-medium">later</span>}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-[6px] p-3" style={{ background: "#F0F7F1", border: "1px solid #CBE8CE" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#1F6F2A" }}>Delivery state boundary</p>
            <p className="mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
              Transform creates an artifact. Only this delivery workflow can mark it delivered.
            </p>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-[13px]" style={{ color: "#56627A" }}>Loading delivery config...</p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 120px 120px" }}>
                <Field label="Endpoint URL">
                  <input
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      markEdited();
                    }}
                    placeholder="https://supplier.example/orders"
                    className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
                    style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }}
                  />
                </Field>
                <Field label="Method">
                  <select
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value);
                      markEdited();
                    }}
                    className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                    style={{ border: "1px solid #D5DAEA", background: "#FFF", color: "#0B1A2F" }}
                  >
                    <option>POST</option>
                    <option>PUT</option>
                  </select>
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
                    style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }}
                  />
                </Field>
              </div>

              <div className="rounded-[7px]" style={{ border: "1px solid #E2E6EE" }}>
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #E2E6EE" }}>
                  <KeyRound size={14} color="#1E66C9" />
                  <span className="text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>Authentication</span>
                  {hasSavedCredentials && (
                    <span className="ml-auto text-[11px]" style={{ color: "#2E8E3A" }}>saved credential masked</span>
                  )}
                </div>
                <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "160px minmax(0, 1fr)" }}>
                  <Field label="Auth type">
                    <select
                      value={authType}
                      onChange={(e) => {
                        setAuthType(e.target.value as AuthType);
                        markEdited();
                      }}
                      className="h-9 w-full rounded-[5px] px-2 text-[12px]"
                      style={{ border: "1px solid #D5DAEA", background: "#FFF", color: "#0B1A2F" }}
                    >
                      <option value="none">None</option>
                      <option value="apikey">API key</option>
                      <option value="bearer">Bearer token</option>
                      <option value="basic">Basic auth</option>
                    </select>
                  </Field>

                  {authType === "apikey" && (
                    <div className="grid gap-3" style={{ gridTemplateColumns: "180px 1fr" }}>
                      <Field label="Header">
                        <input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }} />
                      </Field>
                      <Field label="Value">
                        <input value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} placeholder={hasSavedCredentials ? "********" : "sk-..."} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }} />
                      </Field>
                    </div>
                  )}

                  {authType === "bearer" && (
                    <Field label="Token">
                      <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} placeholder={hasSavedCredentials ? "********" : "Bearer token"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }} />
                    </Field>
                  )}

                  {authType === "basic" && (
                    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <Field label="Username">
                        <input value={basicUsername} onChange={(e) => setBasicUsername(e.target.value)} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }} />
                      </Field>
                      <Field label="Password">
                        <input value={basicPassword} onChange={(e) => setBasicPassword(e.target.value)} placeholder={hasSavedCredentials ? "********" : "Password"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }} />
                      </Field>
                    </div>
                  )}
                </div>
              </div>

              <pre className="rounded-[6px] p-3 text-[11px]" style={{ background: "#0B1A2F", color: "#DDE7F7", overflow: "auto" }}>
                {configPreview}
              </pre>

              {error && (
                <div className="rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}>
                  {error}
                </div>
              )}

              {testResult && (
                <div
                  className="rounded-[6px] px-3 py-2 text-[12px] font-medium"
                  style={{
                    background: testResult.success ? "#F0F7F1" : "#FCEBEB",
                    color: testResult.success ? "#1F6F2A" : "#A52E2E",
                    border: `1px solid ${testResult.success ? "#CBE8CE" : "#F5C5C5"}`,
                  }}
                >
                  {testResult.success ? "Test-fire accepted" : testResult.errorMessage ?? "Test-fire failed"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}>
        {savedConfig && (
          <button onClick={remove} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF" }}>
            <Trash2 size={13} /> Delete
          </button>
        )}
        <div className="flex-1" />
        <button onClick={testFire} disabled={!savedConfig || testing} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", background: "#FFF", opacity: !savedConfig ? 0.55 : 1 }}>
          <Send size={13} /> {testing ? "Testing..." : "Test-fire"}
        </button>
        <button onClick={save} disabled={saving || !url} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "none", color: "#FFF", background: saving || !url ? "#8A93A5" : "#0B1A2F" }}>
          <Save size={13} /> {saving ? "Saving..." : "Save delivery"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
