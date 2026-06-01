"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Copy, Euro, ExternalLink, Key, Mail, Plug, Plus, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
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

type SettingsTab = "org" | "billing" | "email" | "api" | "connectors";

const TABS: Array<{ id: SettingsTab; label: string; Icon: React.ElementType }> = [
  { id: "org",        label: "Organization",    Icon: Building  },
  { id: "billing",    label: "Billing & plan",  Icon: Euro      },
  { id: "email",      label: "Email intake",    Icon: Mail      },
  { id: "api",        label: "API keys",        Icon: Key       },
  { id: "connectors", label: "Connectors",      Icon: Plug      },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("org");

  return (
    <div style={{ height: "100%", minHeight: 0, overflowY: "auto", background: "#F6F7FA" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "26px 34px 64px" }} className="settings-shell">
        {/* Page header — matches design .page-title / .page-sub */}
        <header className="settings-header" style={{ marginBottom: 18 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.1, margin: 0, color: "var(--ink)" }}>
            Settings
          </h1>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 5 }}>
            Nordic Distribution · Operations plan
          </div>
        </header>

        <div className="settings-grid" style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: 28, alignItems: "start" }}>
          {/* Left nav — active = white card + buyer-blue left accent bar + blue icon */}
          <nav
            className="settings-nav flex w-full overflow-x-auto gap-1 md:flex-col md:overflow-visible md:gap-1"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="settings-nav-item flex shrink-0 items-center gap-[10px] rounded-[6px] py-[9px] pr-3 text-left text-[13px] transition-colors md:w-full"
                  style={{
                    paddingLeft: 12,
                    color:      active ? "var(--ink)" : "var(--ink-muted)",
                    background: active ? "var(--surface)" : "transparent",
                    fontWeight: active ? 600 : 500,
                    border:      active ? "1px solid var(--border)" : "1px solid transparent",
                    borderLeft: `2px solid ${active ? "var(--brand-blue)" : "transparent"}`,
                    boxShadow:  active ? "var(--shadow-card)" : "none",
                    cursor: "pointer",
                  }}
                  aria-current={active ? "page" : undefined}
                >
                  <t.Icon size={16} color={active ? "var(--brand-blue)" : "var(--ink-faint)"} strokeWidth={1.75} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div style={{ minWidth: 0 }}>
            {tab === "org"        && <OrgSection />}
            {tab === "billing"    && <BillingSectionWrapper />}
            {tab === "email"      && <EmailSettingsSection />}
            {tab === "api"        && <ApiKeysSection />}
            {tab === "connectors" && <ConnectorsSection />}
          </div>
        </div>
      </div>

      <style>{`
        .settings-nav-item:not([aria-current="page"]):hover {
          background: #EEF1F6;
          color: #0B1A2F;
        }
        @media (max-width: 767px) {
          .settings-shell { padding: 24px 16px 48px; }
          .settings-grid { grid-template-columns: 1fr !important; gap: 16px !important; }
          .settings-header {
            padding: 2px 2px 0;
          }
          /* Mobile uses a compact command grid instead of a horizontal scroller:
             every settings area is visible at once, which is faster for thumb use. */
          .settings-nav {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            background: #EFF2F7;
            border: 1px solid #E2E6EE;
            border-radius: 12px;
            padding: 5px;
            gap: 4px;
            overflow: visible !important;
          }
          /* Comfortable tap targets + readable label sizing on mobile. */
          .settings-nav-item {
            min-height: 40px;
            font-size: 13px;
            justify-content: center;
            padding-left: 10px !important;
            padding-right: 10px !important;
            border-left-width: 1px !important;
            text-align: center;
          }
          .settings-nav-item:last-child:nth-child(odd) {
            grid-column: 1 / -1;
          }
          .settings-nav-item svg {
            flex-shrink: 0;
          }
          .settings-nav-item span {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .settings-shell input,
          .settings-shell select,
          .settings-shell textarea {
            font-size: 16px !important;
          }
          /* Platform connector rows stack so the action goes full-width. */
          .connector-row {
            flex-wrap: wrap;
            align-items: flex-start !important;
          }
          .connector-action {
            width: 100%;
            justify-content: center;
            min-height: 40px;
          }
          .settings-shell [style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
          .imap-connection-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Settings group card — canonical section framing ────────────────────────

function SettingsGroup({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 0, marginBottom: 16, overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-0.01em", color: "var(--ink)" }}>{title}</div>
        {sub && <div style={{ fontSize: 12, marginTop: 2, color: "var(--ink-muted)", lineHeight: 1.45 }}>{sub}</div>}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

// Row inside a settings group — canonical label/hint + right slot
function SettingsRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "11px 0", borderTop: "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Organization section ───────────────────────────────────────────────────

function OrgSection() {
  return (
    <div>
      <SettingsGroup title="Organization" sub="Your workspace identity across the product.">
        <div style={{ marginBottom: 18 }}>
          <label style={fieldLabelStyle}>Workspace name</label>
          <input defaultValue="Nordic Distribution" style={{ ...inputStyle, maxWidth: 420 }} />
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={fieldLabelStyle}>Default currency</label>
          <input defaultValue="EUR — Euro" style={{ ...inputStyle, maxWidth: 240 }} />
        </div>

        {/* Read-only Workspace region row */}
        <SettingsRow label="Workspace region" hint="Where order data is stored.">
          <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: "#EFF2F7", color: "#56627A" }}>
            EU (Frankfurt)
          </span>
        </SettingsRow>

        {/* Members row — matches design (label + access count + Manage) */}
        <SettingsRow label="Members" hint="6 people have access.">
          <button style={secondaryNeutralButton}>Manage</button>
        </SettingsRow>

        <div style={{ marginTop: 18 }}>
          <button style={primaryGreenButton}>
            <Save size={14} strokeWidth={2} />
            Save changes
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}

// Shared primary CTA — brand green (matches design "Save changes" / primary actions)
const primaryGreenButton: CSSProperties = {
  height: 38,
  padding: "0 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--brand-green)",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  boxShadow: "0 1px 2px rgba(11,26,47,0.06)",
};

// Shared neutral secondary button — white, bordered (matches design "Manage" / "Change plan")
const secondaryNeutralButton: CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid #D5DAE5",
  background: "#FFFFFF",
  color: "#0B1A2F",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
  whiteSpace: "nowrap",
};

// ── Billing wrapper ────────────────────────────────────────────────────────

function BillingSectionWrapper() {
  return (
    <div>
      <BillingSection />
    </div>
  );
}

// ── Email settings (full shipped Group H IMAP form — KEEP) ─────────────────

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

  // Derive initial form state from query data; avoid mirroring useEffect where possible.
  // We keep the useEffect here as the form is write-heavy and the sync is intentional;
  // the pattern is flagged but low-risk to change without further refactor scope.
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
      <div style={{ borderRadius: 12, background: "#FFFFFF", padding: 22, border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
        <div style={{ marginBottom: 16, height: 16, width: 160, borderRadius: 4, background: "#E2E6EE" }} />
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3,1fr)" }}>
          <div style={{ height: 36, borderRadius: 6, background: "#EFF2F7" }} />
          <div style={{ height: 36, borderRadius: 6, background: "#EFF2F7" }} />
          <div style={{ height: 36, borderRadius: 6, background: "#EFF2F7" }} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ borderRadius: 12, background: "#FFFFFF", padding: "20px 22px", border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "#0B1A2F", margin: "0 0 4px" }}>Email settings are unavailable</h2>
        <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.55, color: "#56627A" }}>
          The UI is working, but the API did not answer the email settings request. This prevents saving or loading IMAP polling configuration.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, height: 32, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry connection"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <SettingsGroup title="Email intake" sub="Ingest orders that arrive by email — IMAP polling every 5 minutes.">
        {/* Enable row + billing gate notice */}
        {!canEnable && (
          <div style={{ marginBottom: 16, borderRadius: 8, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.5, border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}>
            Email ingestion is included from the Integration plan. You can prepare the configuration here, but enabling polling requires an upgrade.
          </div>
        )}

        {/* Polling status + enable toggle row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "4px 0 16px", borderBottom: "1px solid #EDF0F5" }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F" }}>Poll inbox for orders</div>
            <div style={{ fontSize: 12.5, color: "#8A93A5", marginTop: 2 }}>
              {form.enabled ? "Checking every 5 minutes" : "Disabled"}
            </div>
          </div>
          <ToggleSwitch
            checked={form.enabled}
            disabled={!canEnable && !form.enabled}
            onChange={(v) => update("enabled", v)}
            ariaLabel="Poll inbox for orders"
          />
        </div>

        {/* IMAP config fields — canonical section framing, full form preserved (Group H) */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Mail size={15} color="var(--brand-green)" strokeWidth={1.75} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>IMAP mailbox</span>
            <span style={{ fontSize: 11.5, color: "#56627A" }}>— unseen messages with CSV, XLSX, or PDF attachments are imported.</span>
          </div>

          <div
            className="imap-connection-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px,1fr) 150px 150px",
              gap: 16,
              alignItems: "start",
              marginBottom: 14,
            }}
          >
            <FormField label="IMAP host">
              <input value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="imap.company.com" style={inputStyle} />
              <span style={{ fontSize: 11.5, color: "#8A93A5", marginTop: 2 }}>e.g. imap.gmail.com for Gmail</span>
            </FormField>
            <FormField label="Port">
              <input type="number" value={form.port} onChange={(event) => update("port", Number(event.target.value))} style={inputStyle} />
            </FormField>
            <FormField label="Security">
              <label style={{ display: "flex", height: 40, alignItems: "center", gap: 8, borderRadius: 8, padding: "0 12px", fontSize: 13, border: "1px solid #D5DAEA", color: "#0B1A2F", cursor: "pointer", background: "#FFFFFF" }}>
                <input type="checkbox" checked={form.useSsl} onChange={(event) => update("useSsl", event.target.checked)} />
                SSL
              </label>
            </FormField>
          </div>

          <div className="grid gap-4 md:grid-cols-2" style={{ marginBottom: 14 }}>
            <FormField label="Username">
              <input value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="orders@company.com" style={inputStyle} />
            </FormField>
            <FormField label="Password">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }} className="sm:flex-row">
                <input
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordTouched(true);
                  }}
                  placeholder={form.hasPassword ? "••••••••" : "App password"}
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
                    style={{ height: 36, borderRadius: 5, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #E9B8B8", color: "#A52E2E", background: "#FFF", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </FormField>
          </div>

          <div className="grid gap-4 md:grid-cols-2" style={{ marginBottom: 4 }}>
            <FormField label="Folder">
              <input value={form.folder} onChange={(event) => update("folder", event.target.value)} placeholder="INBOX" style={inputStyle} />
            </FormField>
            <FormField label="Default supplier">
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
            </FormField>
          </div>
        </div>

        {/* Footer: security note + save */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid #E2E6EE" }} className="sm:flex-row sm:items-center">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <ShieldCheck size={15} color="var(--brand-green)" strokeWidth={1.75} />
            <span style={{ fontSize: 11.5, color: "#56627A" }}>
              Passwords are stored encrypted. Last poll:{" "}
              {form.lastPolledAt ? new Date(form.lastPolledAt).toLocaleString() : "not run yet"}.
            </span>
          </div>
          {mutation.error && (
            <span style={{ fontSize: 12, color: "#A52E2E" }}>{(mutation.error as Error).message}</span>
          )}
          <button
            onClick={save}
            disabled={mutation.isPending}
            style={{ ...primaryGreenButton, background: mutation.isPending ? "#8A93A5" : "var(--brand-green)", cursor: mutation.isPending ? "not-allowed" : "pointer" }}
          >
            <Save size={14} strokeWidth={2} />
            {mutation.isPending ? "Saving..." : "Save email"}
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}

// Green pill toggle switch — matches design on/off control
function ToggleSwitch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position: "relative",
        width: 44,
        height: 26,
        flexShrink: 0,
        borderRadius: 999,
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--brand-green)" : "#CBD2DE",
        opacity: disabled ? 0.55 : 1,
        transition: "background 150ms ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FFFFFF",
          boxShadow: "0 1px 2px rgba(11,26,47,0.25)",
          transition: "left 150ms ease",
        }}
      />
    </button>
  );
}

// Lightweight field label wrapper used in Email section
function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "#3C465A",
  display: "block",
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: 40,
  border: "1px solid #D5DAE5",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 13,
  color: "#0B1A2F",
  outline: "none",
  background: "#FFFFFF",
};

// Connector list row — bordered card, icon tile + name/desc + right action (matches design)
const connectorRow: CSSProperties = {
  border: "1px solid #E2E6EE",
  borderRadius: 10,
  padding: "14px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "#FFFFFF",
};

// Neutral soft icon tile used in connector rows (matches design's grey plug tiles)
const connectorTile: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 9,
  background: "#EFF2F7",
  border: "1px solid #E2E6EE",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

// White bordered secondary action (connector "Open …" / "Connect") — matches design
const connectorActionLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  flexShrink: 0,
  fontSize: 12.5,
  fontWeight: 600,
  color: "#0B1A2F",
  border: "1px solid #D5DAE5",
  borderRadius: 8,
  padding: "8px 12px",
  background: "#FFFFFF",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

// ── API Keys Section ──────────────────────────────────────────────────────

function ApiKeysSection() {
  const qc = useQueryClient();
  const [newLabel, setNewLabel]   = useState("");
  const [newKey, setNewKey]       = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const { data: keys = [], isLoading, isError, refetch, isFetching } = useQuery<ApiKey[]>({
    queryKey: ["api-keys"],
    queryFn: getApiKeys,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (label: string) => createApiKey(label),
    onSuccess: (data) => {
      setNewKey(data.rawKey);
      setNewLabel("");
      setShowCreate(false);
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

  if (isError) {
    return (
      <div style={{ borderRadius: 12, background: "#FFFFFF", padding: "20px 22px", border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "#0B1A2F", margin: "0 0 4px" }}>API keys unavailable</h2>
        <p style={{ margin: 0, maxWidth: 520, fontSize: 12.5, lineHeight: 1.55, color: "#56627A" }}>
          Could not reach the API keys endpoint. Your keys are not affected — this is a temporary connectivity issue.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, height: 32, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <SettingsGroup title="API keys" sub="Authenticate the ProcuLink REST + webhook API. Each key is shown once at creation.">

        {/* New key banner */}
        {newKey && (
          <div style={{ border: "1px solid rgba(46,142,58,0.40)", background: "var(--brand-green-soft)", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brand-green-deep)", marginBottom: 4 }}>
              API key created — copy it now
            </p>
            <p style={{ fontSize: 11.5, color: "var(--brand-green-deep)", marginBottom: 10 }}>
              This key cannot be retrieved again after you dismiss this notice.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "#FFFFFF", border: "1px solid rgba(46,142,58,0.40)", borderRadius: 5, padding: "8px 10px", color: "var(--brand-green-deep)", wordBreak: "break-all" }}>
                {newKey}
              </code>
              <button
                onClick={() => handleCopy(newKey)}
                style={{ display: "flex", alignItems: "center", gap: 4, height: 34, padding: "0 12px", border: "1px solid var(--brand-green)", borderRadius: 6, background: "#FFFFFF", color: "var(--brand-green-deep)", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
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

        {/* Keys table */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2].map(i => <div key={i} style={{ height: 52, borderRadius: 6, background: "#EFF2F7" }} />)}
          </div>
        )}

        {!isLoading && keys.length === 0 && !showCreate && (
          <div style={{ border: "1px dashed #C6CDDA", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
            <Key size={28} color="#C6CDDA" style={{ margin: "0 auto 10px" }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: "#56627A" }}>No API keys yet</p>
            <p style={{ fontSize: 12, color: "#8A93A5", marginTop: 4 }}>
              Create a key to connect Zapier, Make.com, or your own integration.
            </p>
          </div>
        )}

        {/* Desktop: dense table (hidden on mobile to avoid horizontal overflow) */}
        {keys.length > 0 && (
          <table className="hidden md:table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Key", "Created", "Last used", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A93A5", padding: "0 12px 10px", borderBottom: "1px solid #E2E6EE", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map(key => (
                <tr key={key.id} style={{ opacity: key.isActive ? 1 : 0.55 }}>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid #EDF0F5", fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>{key.label}</td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid #EDF0F5", fontSize: 12 }}>
                    <code style={{ fontFamily: "'JetBrains Mono', monospace", color: "#56627A" }}>{key.keyPrefix}…</code>
                  </td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid #EDF0F5", fontSize: 12.5, color: "#8A93A5", whiteSpace: "nowrap" }}>
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid #EDF0F5", fontSize: 12.5, color: "#8A93A5", whiteSpace: "nowrap" }}>
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "11px 12px", borderBottom: "1px solid #EDF0F5", textAlign: "right" }}>
                    {key.isActive ? (
                      <button
                        onClick={() => { if (confirm(`Revoke "${key.label}"? This will immediately break any integration using it.`)) revoke.mutate(key.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#56627A", padding: "4px 2px", fontSize: 12.5, fontWeight: 600 }}
                        title="Revoke key"
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#C53A3A"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#56627A"; }}
                      >
                        Revoke
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#EFF2F7", color: "#56627A" }}>Revoked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Mobile: each key as a stacked row-card (no horizontal scroll) */}
        {keys.length > 0 && (
          <div className="flex flex-col gap-2 md:hidden">
            {keys.map(key => (
              <div
                key={key.id}
                style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FFFFFF", padding: "12px 14px", opacity: key.isActive ? 1 : 0.6 }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{key.label}</span>
                  {!key.isActive && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#EFF2F7", color: "#56627A", flexShrink: 0 }}>Revoked</span>
                  )}
                </div>
                <code style={{ display: "block", marginTop: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#56627A" }}>{key.keyPrefix}…</code>
                <div style={{ marginTop: 6, fontSize: 11.5, color: "#8A93A5" }}>
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {" · Last used "}
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "—"}
                </div>
                {key.isActive && (
                  <button
                    onClick={() => { if (confirm(`Revoke "${key.label}"? This will immediately break any integration using it.`)) revoke.mutate(key.id); }}
                    style={{ marginTop: 10, width: "100%", height: 40, borderRadius: 8, border: "1px solid #E9B8B8", background: "#FFFFFF", color: "#A52E2E", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create key — disclosure form (revealed by the Create key button) */}
        {showCreate && (
          <div style={{ marginTop: 16, border: "1px solid #C6CDDA", borderRadius: 8, background: "#FFFFFF", padding: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", marginBottom: 8 }}>Create new key</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
              <input
                type="text"
                placeholder='e.g. "Zapier production" or "Make.com staging"'
                value={newLabel}
                autoFocus
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newLabel.trim()) create.mutate(newLabel.trim()); }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => create.mutate(newLabel.trim())}
                  disabled={!newLabel.trim() || create.isPending}
                  className="flex-1 sm:flex-none"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: !newLabel.trim() || create.isPending ? "#CBD5E1" : "var(--brand-green)", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: !newLabel.trim() || create.isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                >
                  <Plus size={14} />
                  {create.isPending ? "Creating…" : "Create key"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewLabel(""); }}
                  className="flex-1 sm:flex-none"
                  style={{ height: 40, padding: "0 14px", border: "1px solid #D5DAE5", borderRadius: 8, background: "#FFFFFF", color: "#56627A", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
            {create.isError && (
              <p style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>
                {(create.error as Error).message || "Failed to create API key."}
              </p>
            )}
          </div>
        )}

        {/* Create key button — table-first affordance (matches design) */}
        {!showCreate && (
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setShowCreate(true)} style={secondaryNeutralButton}>
              <Plus size={14} strokeWidth={2} />
              Create key
            </button>
          </div>
        )}
      </SettingsGroup>
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

  const { data: subs = [], isLoading, isError, refetch, isFetching } = useQuery<IntegrationSubscription[]>({
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
    <div>
      <SettingsGroup title="Connectors" sub="ERP and channel integrations — send real-time events to Zapier, Make.com, or any webhook URL.">

        {/* Platform connector rows — neutral icon tile + name/desc + right-aligned action (matches design) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {/* Zapier */}
          <div className="connector-row" style={connectorRow}>
            <div style={connectorTile}>
              <Zap size={18} color="#56627A" strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>Zapier</p>
              <p style={{ fontSize: 12, color: "#56627A", lineHeight: 1.5, margin: "3px 0 0" }}>
                Connect ProcuLink to 6,000+ apps via the &ldquo;New Order Created&rdquo; or &ldquo;Order Delivered&rdquo; triggers.
              </p>
            </div>
            <a
              href="https://zapier.com/apps/proculink"
              target="_blank"
              rel="noopener noreferrer"
              className="connector-action"
              style={connectorActionLink}
            >
              Open Zapier <ExternalLink size={12} />
            </a>
          </div>

          {/* Make.com */}
          <div className="connector-row" style={connectorRow}>
            <div style={connectorTile}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#56627A" }}>M</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>Make.com</p>
              <p style={{ fontSize: 12, color: "#56627A", lineHeight: 1.5, margin: "3px 0 0" }}>
                Build visual automation flows with ProcuLink as a trigger or action module.
              </p>
            </div>
            <a
              href="https://make.com/en/integrations/proculink"
              target="_blank"
              rel="noopener noreferrer"
              className="connector-action"
              style={connectorActionLink}
            >
              Open Make.com <ExternalLink size={12} />
            </a>
          </div>
        </div>

        {/* Webhook subscriptions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, paddingTop: 4, borderTop: "1px solid #EDF0F5" }}>
          <div style={{ paddingTop: 14 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>Webhook subscriptions</p>
            <p style={{ fontSize: 12.5, color: "#56627A", marginTop: 3 }}>
              Receive ProcuLink events at any URL — Zapier, Make.com, or custom.
            </p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", border: "1px solid #D5DAE5", borderRadius: 8, background: "#FFFFFF", color: "#0B1A2F", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            <Plus size={14} /> Add webhook
          </button>
        </div>

        {showForm && (
          <div style={{ border: "1px solid #C6CDDA", borderRadius: 8, background: "#FFFFFF", padding: 16, marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", marginBottom: 14 }}>New webhook subscription</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>Platform</span>
                <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ ...inputStyle, height: 32 }}>
                  <option value="zapier">Zapier</option>
                  <option value="make">Make.com</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>Event</span>
                <select value={eventType} onChange={e => setEventType(e.target.value)} style={{ ...inputStyle, height: 32 }}>
                  <option value="order.created">order.created</option>
                  <option value="order.delivered">order.delivered</option>
                  <option value="order.failed">order.failed</option>
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 4, marginBottom: 10 }}>
              <span style={fieldLabelStyle}>Target URL <span style={{ fontWeight: 400 }}>*</span></span>
              <input
                type="url"
                placeholder="https://hooks.zapier.com/hooks/catch/…"
                value={targetUrl}
                onChange={e => setTargetUrl(e.target.value)}
                style={{ ...inputStyle, height: 32 }}
              />
            </label>

            <label style={{ display: "grid", gap: 4, marginBottom: 14 }}>
              <span style={fieldLabelStyle}>Signing secret <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></span>
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
                style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: !targetUrl.startsWith("http") || create.isPending ? "#CBD5E1" : "var(--brand-green)", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: !targetUrl.startsWith("http") || create.isPending ? "not-allowed" : "pointer" }}
              >
                {create.isPending ? "Saving…" : "Save webhook"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{ height: 38, padding: "0 14px", border: "1px solid #D5DAE5", borderRadius: 8, background: "#FFFFFF", color: "#56627A", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
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

        {/* Error state — was missing before */}
        {isError && (
          <div style={{ borderRadius: 8, padding: "14px 16px", border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", background: "#FFFFFF", marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", margin: "0 0 4px" }}>Webhooks unavailable</p>
            <p style={{ fontSize: 12.5, color: "#56627A", margin: 0 }}>
              Could not load webhook subscriptions. Your existing subscriptions are unaffected.
            </p>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              style={{ marginTop: 10, height: 30, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
            >
              {isFetching ? "Checking..." : "Retry"}
            </button>
          </div>
        )}

        {isLoading && <p style={{ fontSize: 13, color: "#8A93A5" }}>Loading webhooks…</p>}

        {!isLoading && !isError && subs.length === 0 && !showForm && (
          <div style={{ border: "1px dashed #C6CDDA", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#56627A" }}>No webhooks yet</p>
            <p style={{ fontSize: 12, color: "#8A93A5", marginTop: 4 }}>
              Add a webhook above, or connect via Zapier or Make.com.
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subs.map(sub => (
            <div
              key={sub.id}
              style={{ border: "1px solid #E2E6EE", borderRadius: 10, background: "#FFFFFF", padding: "13px 16px", display: "flex", alignItems: "flex-start", gap: 10, opacity: sub.isActive ? 1 : 0.6 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#EFF2F7", color: "#56627A" }}>
                    {PLATFORM_LABELS[sub.platform] ?? sub.platform}
                  </span>
                  <code style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", color: "var(--brand-green-deep)" }}>
                    {sub.eventType}
                  </code>
                  {sub.isActive && sub.failureCount === 0 ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand-green)" }} />
                      Active
                    </span>
                  ) : !sub.isActive ? (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#EFF2F7", color: "#56627A" }}>Paused</span>
                  ) : null}
                  {sub.failureCount > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "#FBE3E3", color: "#C53A3A" }}>
                      {sub.failureCount} failure{sub.failureCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11.5, color: "#56627A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }} title={sub.targetUrl}>
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
                  style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "#8A93A5" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
