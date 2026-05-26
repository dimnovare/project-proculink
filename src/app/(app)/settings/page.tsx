"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Save, ShieldCheck } from "lucide-react";
import { BillingSection } from "@/components/bridge/BillingSection";
import {
  apiClient,
  getBillingStatus,
  getEmailSettings,
  updateEmailSettings,
} from "@/lib/api-client";
import type { EmailSettings, UpdateEmailSettingsPayload } from "@/types/procurement";

type SettingsTab = "workspace" | "billing" | "email" | "team" | "api";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "workspace", label: "Workspace"   },
  { id: "billing",   label: "Billing"     },
  { id: "email",     label: "Email polling"},
  { id: "team",      label: "Team"        },
  { id: "api",       label: "API keys"    },
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

          {(tab === "team" || tab === "api") && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 32px", textAlign: "center", color: "#8A93A5" }}>
              <span style={{ fontSize: 32, marginBottom: 12 }}>⊘</span>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginBottom: 4 }}>{TABS.find(t=>t.id===tab)?.label} settings</p>
              <p style={{ fontSize: 13 }}>Coming in Phase 4 Groups E–H.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailSettingsSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["email-settings"],
    queryFn: getEmailSettings,
  });
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
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
    return <div className="text-[13px]" style={{ color: "#56627A" }}>Loading email settings...</div>;
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
