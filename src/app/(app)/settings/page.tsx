"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Key, Mail, Plus, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
import { BillingSection } from "@/components/bridge/BillingSection";
import {
  apiClient,
  getBillingStatus,
  getEmailSettings,
  updateEmailSettings,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getIntegrations,
  createIntegration,
  toggleIntegration,
  deleteIntegration,
} from "@/lib/api-client";
import type { EmailSettings, UpdateEmailSettingsPayload } from "@/types/procurement";
import type { ApiKey, IntegrationSubscription } from "@/lib/api-client";

type SettingsTab = "workspace" | "billing" | "email" | "team" | "api" | "connectors";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "workspace",  label: "Workspace"    },
  { id: "billing",    label: "Billing"      },
  { id: "email",      label: "Email polling"},
  { id: "team",       label: "Team"         },
  { id: "api",        label: "API keys"     },
  { id: "connectors", label: "Connectors"   },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("workspace");

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="px-4 py-4 sm:px-6 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Settings</h1>
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Sidebar */}
        <nav
          className="flex w-full flex-shrink-0 gap-1 overflow-x-auto border-b border-[#E2E6EE] bg-white px-3 py-2 md:w-[200px] md:flex-col md:gap-0 md:overflow-visible md:border-b-0 md:border-r md:px-0 md:py-4"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex shrink-0 items-center rounded-[6px] px-3 py-2 text-left text-[13px] font-medium transition-colors md:w-full md:rounded-none md:px-4"
              style={{
                color: tab === t.id ? "#0B1A2F" : "#56627A",
                background: tab === t.id ? "#F0F2F7" : "transparent",
                border: "none",
                borderLeft: `2px solid ${tab === t.id ? "#1E66C9" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {tab === "workspace" && (
            <div style={{ maxWidth: 520 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0B1A2F", marginBottom: 20 }}>Workspace settings</h2>
              {[
                { label: "Organisation name", value: "Nordic Distribution", type: "text" },
                { label: "Workspace ID",       value: "nd-4f91a2",          type: "text", mono: true, readOnly: true },
                { label: "Default currency",   value: "EUR",                type: "text" },
              ].map((f) => (
                <div key={f.label} style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#56627A", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</label>
                  <input defaultValue={f.value} readOnly={f.readOnly} type={f.type} style={{ width: "100%", border: "1px solid #E2E6EE", borderRadius: 7, padding: "9px 12px", fontSize: 13, fontFamily: f.mono ? "'JetBrains Mono', monospace" : undefined, color: f.readOnly ? "#8A93A5" : "#0B1A2F", background: f.readOnly ? "#F6F7FA" : "#FFFFFF", outline: "none" }} />
                </div>
              ))}
              <button style={{ borderRadius: 7, padding: "9px 20px", fontSize: 13, fontWeight: 600, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: "pointer" }}>Save changes</button>
            </div>
          )}

          {tab === "billing" && (
            <div>
              <h2 className="text-[17px] font-semibold mb-1" style={{ color: "#0B1A2F" }}>Plan & billing</h2>
              <p className="text-[12.5px] mb-6" style={{ color: "#56627A" }}>Manage your ProcuLink plan and payment method.</p>
              <BillingSection />
            </div>
          )}

          {tab === "email" && <EmailSettingsSection />}

          {tab === "team" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 32px", textAlign: "center", color: "#8A93A5" }}>
              <span style={{ fontSize: 32, marginBottom: 12 }}>⊘</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>Team settings</p>
              <p style={{ fontSize: 13 }}>Team management coming soon.</p>
            </div>
          )}

          {tab === "api" && <ApiKeysSection />}

          {tab === "connectors" && <ConnectorsSection />}
        </div>
      </div>
    </div>
  );
}

function EmailSettingsSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["email-settings"],
    queryFn: getEmailSettings,
    retry: false,
  });
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    retry: false,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    retry: false,
  });

  const [form, setForm] = useState<EmailSettings>({
    enabled: false,
    host: "",
    port: 993,
    useSsl: true,
    username: "",
    folder: "INBOX",
    defaultSupplierId: null,
    hasPassword: false,
    passwordDisplay: null,
    lastPolledAt: null,
    updatedAt: null,
  });
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm(settings);
    setPassword("");
    setPasswordTouched(false);
  }, [settings]);

  const canEnable = billing?.plan === "integration" || billing?.plan === "enterprise";

  const mutation = useMutation({
    mutationFn: (payload: UpdateEmailSettingsPayload) => updateEmailSettings(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(["email-settings"], saved);
      setPassword("");
      setPasswordTouched(false);
    },
  });

  function update<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    mutation.mutate({
      enabled: form.enabled,
      host: form.host,
      port: form.port,
      useSsl: form.useSsl,
      username: form.username,
      password: passwordTouched ? password : null,
      folder: form.folder || "INBOX",
      defaultSupplierId: form.defaultSupplierId,
    });
  }

  if (isLoading) {
    return (
      <div className="max-w-[860px] rounded-[8px] bg-white p-4" style={{ border: "1px solid #E2E6EE" }}>
        <div className="mb-4 h-4 w-40 rounded bg-[#E2E6EE]" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-9 rounded bg-[#EFF2F7]" />
          <div className="h-9 rounded bg-[#EFF2F7]" />
          <div className="h-9 rounded bg-[#EFF2F7]" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-[860px] rounded-[8px] bg-white p-4 sm:p-5" style={{ border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A" }}>
        <h2 className="mb-1 text-[17px] font-semibold" style={{ color: "#0B1A2F" }}>Email settings are unavailable</h2>
        <p className="m-0 max-w-[560px] text-[12.5px] leading-6" style={{ color: "#56627A" }}>
          The UI is working, but the API did not answer the email settings request. This prevents saving or loading IMAP polling configuration.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="mt-4 h-8 rounded-[6px] px-3 text-[12px] font-semibold"
          style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry connection"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h2 className="text-[17px] font-semibold mb-1" style={{ color: "#0B1A2F" }}>Email polling</h2>
          <p className="text-[12.5px]" style={{ color: "#56627A" }}>
            Pull buyer order attachments from an IMAP inbox into the same parse and review pipeline as uploads.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold" style={{ background: form.enabled ? "#F0F7F1" : "#F0F2F7", color: form.enabled ? "#1F6F2A" : "#56627A" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: form.enabled ? "#2E8E3A" : "#8A93A5" }} />
          {form.enabled ? "Polling enabled" : "Polling paused"}
        </span>
      </div>

      {!canEnable && (
        <div className="mb-4 rounded-[7px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}>
          Email ingestion is included from the Integration plan. You can prepare the configuration here, but enabling polling requires an upgrade.
        </div>
      )}

      <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}>
          <Mail size={16} color="#1E66C9" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>IMAP mailbox</p>
            <p className="text-[11.5px]" style={{ color: "#56627A" }}>
              Unseen messages with CSV, XLSX, or PDF attachments are imported every 5 minutes.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "#0B1A2F" }}>
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={!canEnable && !form.enabled}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_120px_120px]">
          <Field label="IMAP host">
            <input value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="imap.company.com" style={inputStyle} />
          </Field>
          <Field label="Port">
            <input type="number" value={form.port} onChange={(event) => update("port", Number(event.target.value))} style={inputStyle} />
          </Field>
          <Field label="Security">
            <label className="flex h-9 items-center gap-2 rounded-[5px] px-2.5 text-[12px]" style={{ border: "1px solid #D5DAEA", color: "#0B1A2F" }}>
              <input type="checkbox" checked={form.useSsl} onChange={(event) => update("useSsl", event.target.checked)} />
              SSL
            </label>
          </Field>
        </div>

        <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
          <Field label="Username">
            <input value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="orders@company.com" style={inputStyle} />
          </Field>
          <Field label="Password">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordTouched(true);
                }}
                placeholder={form.hasPassword ? "********" : "App password"}
                type="password"
                style={inputStyle}
              />
              {form.hasPassword && (
                <button
                  onClick={() => {
                    setPassword("");
                    setPasswordTouched(true);
                    update("hasPassword", false);
                  }}
                  className="h-9 rounded-[5px] px-3 text-[12px] font-semibold"
                  style={{ border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF" }}
                >
                  Clear
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
          <Field label="Folder">
            <input value={form.folder} onChange={(event) => update("folder", event.target.value)} placeholder="INBOX" style={inputStyle} />
          </Field>
          <Field label="Default supplier">
            <select
              value={form.defaultSupplierId ?? ""}
              onChange={(event) => update("defaultSupplierId", event.target.value || null)}
              style={{ ...inputStyle, background: "#FFFFFF" }}
            >
              <option value="">Choose supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center" style={{ borderTop: "1px solid #E2E6EE", background: "#F6F7FA" }}>
          <ShieldCheck size={15} color="#2E8E3A" />
          <p className="flex-1 text-[11.5px]" style={{ color: "#56627A" }}>
            Passwords are stored encrypted. Last poll: {form.lastPolledAt ? new Date(form.lastPolledAt).toLocaleString() : "not run yet"}.
          </p>
          {mutation.error && (
            <span className="text-[12px]" style={{ color: "#A52E2E" }}>{mutation.error.message}</span>
          )}
          <button
            onClick={save}
            disabled={mutation.isPending}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold sm:w-auto"
            style={{ border: "none", color: "#FFF", background: mutation.isPending ? "#8A93A5" : "#0B1A2F" }}
          >
            <Save size={13} /> {mutation.isPending ? "Saving..." : "Save email"}
          </button>
        </div>
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

const inputStyle: CSSProperties = {
  width: "100%",
  height: 36,
  border: "1px solid #D5DAEA",
  borderRadius: 5,
  padding: "0 10px",
  fontSize: 12,
  color: "#0B1A2F",
  outline: "none",
};

// ── API Keys Section ──────────────────────────────────────────────────────

function ApiKeysSection() {
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey]     = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["api-keys"],
    queryFn: getApiKeys,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (label: string) => createApiKey(label),
    onSuccess: (data) => {
      setNewKey(data.rawKey);
      setNewLabel("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be blocked
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>API Keys</h2>
      <p style={{ fontSize: 12.5, color: "#56627A", marginBottom: 24 }}>
        Machine-to-machine access for Zapier, Make.com, and custom integrations.
        Each key is shown once at creation — store it securely.
      </p>

      {/* New key banner */}
      {newKey && (
        <div style={{ border: "1px solid #A7F3D0", background: "#F0FDF4", borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: "#15803D", marginBottom: 6 }}>
            API key created — copy it now
          </p>
          <p style={{ fontSize: 11.5, color: "#166534", marginBottom: 10 }}>
            This key cannot be retrieved again after you dismiss this notice.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "#FFFFFF", border: "1px solid #BBF7D0", borderRadius: 5, padding: "8px 10px", color: "#15803D", wordBreak: "break-all" }}>
              {newKey}
            </code>
            <button
              onClick={() => handleCopy(newKey)}
              style={{ display: "flex", alignItems: "center", gap: 4, height: 34, padding: "0 12px", border: "1px solid #22C55E", borderRadius: 6, background: "#FFFFFF", color: "#15803D", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <Copy size={13} />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            style={{ marginTop: 10, background: "none", border: "none", color: "#56627A", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            I&apos;ve saved it, dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: "16px", marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", marginBottom: 10 }}>Create new API key</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder='e.g. "Zapier production" or "Make.com staging"'
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newLabel.trim()) create.mutate(newLabel.trim()); }}
            style={{ ...inputStyle, flex: 1, height: 34 }}
          />
          <button
            onClick={() => create.mutate(newLabel.trim())}
            disabled={!newLabel.trim() || create.isPending}
            style={{ display: "flex", alignItems: "center", gap: 5, height: 34, padding: "0 14px", border: "none", borderRadius: 6, background: !newLabel.trim() || create.isPending ? "#CBD5E1" : "#0B1A2F", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, cursor: !newLabel.trim() || create.isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            <Plus size={13} />
            {create.isPending ? "Creating…" : "Create key"}
          </button>
        </div>
        {create.isError && (
          <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>
            {(create.error as Error).message || "Failed to create API key."}
          </p>
        )}
      </div>

      {/* Keys list */}
      {isLoading && <p style={{ fontSize: 13, color: "#8A93A5" }}>Loading…</p>}

      {!isLoading && keys.length === 0 && (
        <div style={{ border: "1px dashed #D5DAEA", borderRadius: 8, padding: "40px 20px", textAlign: "center" }}>
          <Key size={28} color="#CBD5E1" style={{ margin: "0 auto 10px" }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#64748B" }}>No API keys yet</p>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
            Create a key above to connect Zapier, Make.com, or your own integration.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {keys.map(key => (
          <div
            key={key.id}
            style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: key.isActive ? 1 : 0.55 }}
          >
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Key size={15} color="#64748B" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>{key.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: key.isActive ? "#DCFCE7" : "#F1F5F9", color: key.isActive ? "#15803D" : "#64748B" }}>
                  {key.isActive ? "Active" : "Revoked"}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "0 8px" }}>
                <span><code style={{ fontFamily: "'JetBrains Mono', monospace", color: "#64748B" }}>{key.keyPrefix}…</code></span>
                <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                {key.lastUsedAt && <span>Last used {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
              </div>
            </div>
            {key.isActive && (
              <button
                onClick={() => { if (confirm(`Revoke "${key.label}"? This will immediately break any integration using it.`)) revoke.mutate(key.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 4, display: "flex", alignItems: "center" }}
                title="Revoke key"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Connectors Section ────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  "order.created":   "order.created — new PO uploaded or received",
  "order.delivered": "order.delivered — PO delivered to supplier",
  "order.failed":    "order.failed — delivery failed after retries",
};

const PLATFORM_LABELS: Record<string, string> = {
  zapier: "Zapier", make: "Make.com", custom: "Custom",
};

function ConnectorsSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [platform, setPlatform]   = useState("custom");
  const [eventType, setEventType] = useState("order.created");
  const [targetUrl, setTargetUrl] = useState("");
  const [secret, setSecret]       = useState("");

  const { data: subs = [], isLoading } = useQuery<IntegrationSubscription[]>({
    queryKey: ["integrations"],
    queryFn: getIntegrations,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => createIntegration({ platform, eventType, targetUrl, secret: secret || undefined }),
    onSuccess: () => {
      setTargetUrl(""); setSecret(""); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (id: string) => toggleIntegration(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>Connectors &amp; Webhooks</h2>
      <p style={{ fontSize: 12.5, color: "#56627A", marginBottom: 24 }}>
        Send real-time events to Zapier, Make.com, or any webhook URL when orders are created or delivered.
      </p>

      {/* Platform cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 28 }}>
        {/* Zapier */}
        <div style={{ border: "1px solid #FCD34D60", background: "#FFFBEB", borderRadius: 9, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Zap size={16} color="#FFFFFF" />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#92400E", marginBottom: 4 }}>Zapier</p>
              <p style={{ fontSize: 11.5, color: "#78350F", lineHeight: 1.5, marginBottom: 10 }}>
                Connect ProcuLink to 6,000+ apps. Use the "New Order Created" or "Order Delivered" triggers.
              </p>
              <a
                href="https://zapier.com/apps/proculink"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#92400E", border: "1px solid #F59E0B", borderRadius: 5, padding: "4px 10px", background: "#FFFFFF", textDecoration: "none" }}
              >
                Open Zapier <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </div>

        {/* Make.com */}
        <div style={{ border: "1px solid #A5B4FC60", background: "#EEF2FF", borderRadius: 9, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#6366F1", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>M</span>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#3730A3", marginBottom: 4 }}>Make.com</p>
              <p style={{ fontSize: 11.5, color: "#3730A380", lineHeight: 1.5, marginBottom: 10 }}>
                Build visual automation flows with ProcuLink as a trigger or action module.
              </p>
              <a
                href="https://make.com/en/integrations/proculink"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#3730A3", border: "1px solid #6366F1", borderRadius: 5, padding: "4px 10px", background: "#FFFFFF", textDecoration: "none" }}
              >
                Open Make.com <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook subscriptions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>Webhook subscriptions</p>
          <p style={{ fontSize: 11.5, color: "#56627A", marginTop: 2 }}>
            Receive ProcuLink events at any URL — Zapier, Make.com, or custom.
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 12px", border: "1px solid #D5DAEA", borderRadius: 6, background: "#FFFFFF", color: "#0B1A2F", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Plus size={13} /> Add webhook
        </button>
      </div>

      {showForm && (
        <div style={{ border: "1px solid #C7D2FE", borderRadius: 8, background: "#FFFFFF", padding: "16px", marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", marginBottom: 14 }}>New webhook subscription</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.05em" }}>Platform</span>
              <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ ...inputStyle, height: 32 }}>
                <option value="zapier">Zapier</option>
                <option value="make">Make.com</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.05em" }}>Event</span>
              <select value={eventType} onChange={e => setEventType(e.target.value)} style={{ ...inputStyle, height: 32 }}>
                <option value="order.created">order.created</option>
                <option value="order.delivered">order.delivered</option>
                <option value="order.failed">order.failed</option>
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 4, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.05em" }}>Target URL *</span>
            <input
              type="url"
              placeholder="https://hooks.zapier.com/hooks/catch/…"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              style={{ ...inputStyle, height: 32 }}
            />
          </label>

          <label style={{ display: "grid", gap: 4, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A", textTransform: "uppercase", letterSpacing: "0.05em" }}>Signing secret <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></span>
            <input
              type="password"
              placeholder="Used to generate X-ProcuLink-Signature header"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              style={{ ...inputStyle, height: 32 }}
            />
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => create.mutate()}
              disabled={!targetUrl.startsWith("http") || create.isPending}
              style={{ height: 32, padding: "0 14px", border: "none", borderRadius: 6, background: !targetUrl.startsWith("http") || create.isPending ? "#CBD5E1" : "#0B1A2F", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, cursor: !targetUrl.startsWith("http") || create.isPending ? "not-allowed" : "pointer" }}
            >
              {create.isPending ? "Saving…" : "Save webhook"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{ height: 32, padding: "0 12px", border: "1px solid #E2E6EE", borderRadius: 6, background: "#FFFFFF", color: "#56627A", fontSize: 12.5, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
          {create.isError && (
            <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>
              {(create.error as Error).message || "Failed to save webhook."}
            </p>
          )}
        </div>
      )}

      {isLoading && <p style={{ fontSize: 13, color: "#8A93A5" }}>Loading webhooks…</p>}

      {!isLoading && subs.length === 0 && !showForm && (
        <div style={{ border: "1px dashed #D5DAEA", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#64748B" }}>No webhooks yet</p>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
            Add a webhook above, or connect via Zapier or Make.com.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {subs.map(sub => (
          <div
            key={sub.id}
            style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#FFFFFF", padding: "11px 14px", display: "flex", alignItems: "flex-start", gap: 10, opacity: sub.isActive ? 1 : 0.6 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#EEF2FF", color: "#3730A3" }}>
                  {PLATFORM_LABELS[sub.platform] ?? sub.platform}
                </span>
                <code style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", color: "#6366F1" }}>
                  {sub.eventType}
                </code>
                {!sub.isActive && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#F1F5F9", color: "#64748B" }}>Paused</span>
                )}
                {sub.failureCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#FEF2F2", color: "#DC2626" }}>
                    {sub.failureCount} failure{sub.failureCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub.targetUrl}>
                {sub.targetUrl}
              </p>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
              <button
                onClick={() => toggle.mutate(sub.id)}
                style={{ height: 28, padding: "0 10px", border: "1px solid #E2E6EE", borderRadius: 5, background: "#FFFFFF", color: "#56627A", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
              >
                {sub.isActive ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => { if (confirm("Delete this webhook subscription?")) remove.mutate(sub.id); }}
                style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "#94A3B8" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
