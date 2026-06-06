"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useOrganization } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Copy, Database, Euro, HardDrive, Key, Mail, Plug, Plus, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
import { BillingSection } from "@/components/bridge/BillingSection";
import {
  apiClient,
  apiBaseUrl,
  getBillingStatus,
  getEmailSettings,
  updateEmailSettings,
  getOrgSettings,
  updateOrgSettings,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getIntegrations,
  createIntegration,
  toggleIntegration,
  deleteIntegration,
} from "@/lib/api-client";
import type { EmailSettings, UpdateEmailSettingsPayload, OrderDirection } from "@/types/procurement";
import type { ApiKey, IntegrationSubscription } from "@/lib/api-client";
import { SftpPullSettings, S3PullSettings } from "@/components/settings/PullIngressSettings";

type SettingsTab = "org" | "billing" | "email" | "sftp" | "s3" | "api" | "connectors";

const TABS: Array<{ id: SettingsTab; label: string; Icon: React.ElementType }> = [
  { id: "org",        label: "Organization",    Icon: Building   },
  { id: "billing",    label: "Billing & plan",  Icon: Euro       },
  { id: "email",      label: "Email intake",    Icon: Mail       },
  { id: "sftp",       label: "SFTP pull",       Icon: HardDrive  },
  { id: "s3",         label: "S3 / R2 pull",    Icon: Database   },
  { id: "api",        label: "API keys",        Icon: Key        },
  { id: "connectors", label: "Connectors",      Icon: Plug       },
];

const PLAN_LABELS: Record<string, string> = {
  pilot: "Pilot plan", growth: "Growth plan", operations: "Operations plan",
  integration: "Integration plan", enterprise: "Enterprise",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("org");
  const { organization } = useOrganization();
  const { data: billing } = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000 });
  const orgName   = organization?.name ?? "…";
  const planLabel = billing ? (PLAN_LABELS[billing.plan] ?? billing.plan) : "…";

  return (
    <div style={{ height: "100%", minHeight: 0, overflowY: "auto", background: "#F6F7FA" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "26px 34px 64px" }} className="settings-shell">
        {/* Page header — matches design .page-title / .page-sub */}
        <header className="settings-header" style={{ marginBottom: 18 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.1, margin: 0, color: "var(--ink)" }}>
            Settings
          </h1>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 5 }}>
            {orgName} · {planLabel}
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
            {tab === "sftp"       && <SftpPullSettings />}
            {tab === "s3"         && <S3PullSettings />}
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
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// Inline two-button confirm — replaces native confirm()/alert for destructive
// actions so they stay on-brand. Renders the trigger; on click swaps to a
// "Confirm / Cancel" pair scoped to the row.
function InlineConfirm({
  onConfirm,
  trigger,
  confirmLabel = "Confirm",
  prompt,
  danger = true,
  fullWidth = false,
}: {
  onConfirm: () => void;
  trigger: (open: () => void) => ReactNode;
  confirmLabel?: string;
  prompt?: string;
  danger?: boolean;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <>{trigger(() => setOpen(true))}</>;
  return (
    <div
      role="group"
      aria-label={prompt ?? "Confirm action"}
      style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: fullWidth ? "100%" : undefined }}
    >
      {prompt && <span style={{ fontSize: 12, color: "#56627A", marginRight: 2 }}>{prompt}</span>}
      <button
        onClick={() => { setOpen(false); onConfirm(); }}
        className={fullWidth ? "flex-1" : undefined}
        style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "none", background: danger ? "#C53A3A" : "var(--brand-green)", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        {confirmLabel}
      </button>
      <button
        onClick={() => setOpen(false)}
        className={fullWidth ? "flex-1" : undefined}
        style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #D5DAE5", background: "#FFFFFF", color: "#56627A", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Cancel
      </button>
    </div>
  );
}

// ── Organization section ───────────────────────────────────────────────────

function OrgSection() {
  const { organization } = useOrganization();
  const orgName = organization?.name ?? "";
  const [name, setName] = useState(orgName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // Keep the field in sync once Clerk hydrates the organization.
  useEffect(() => { setName(orgName); }, [orgName]);

  // Real member count from Clerk — never a hardcoded number.
  const memberCount = organization?.membersCount;
  const membersHint =
    memberCount == null
      ? "Loading members…"
      : `${memberCount} ${memberCount === 1 ? "person has" : "people have"} access.`;

  async function handleSave() {
    if (!organization) return;
    const trimmed = name.trim();
    if (!trimmed) { setFeedback({ text: "Workspace name can't be empty.", kind: "err" }); return; }
    if (trimmed === orgName) { setFeedback({ text: "No changes to save.", kind: "ok" }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await organization.update({ name: trimmed });
      setFeedback({ text: "Workspace name updated.", kind: "ok" });
    } catch (err) {
      setFeedback({ text: (err as Error).message || "Could not save changes.", kind: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SettingsGroup title="Organization" sub="Your workspace identity across the product.">
        <div style={{ marginBottom: 18 }}>
          <label style={fieldLabelStyle}>Workspace name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!organization}
            style={{ ...inputStyle, maxWidth: 420 }}
          />
        </div>

        {/* Members row — real count from Clerk. */}
        <SettingsRow label="Members" hint={membersHint} />

        {/* About this workspace — fixed (non-editable) facts grouped together so
            they don't read as editable fields the user can change. Currency is
            fixed to EUR and region to EU until org-level settings endpoints
            exist; presenting them as a labelled info block (not input rows)
            keeps the offer↔works honesty rule. */}
        <div style={{ marginTop: 18, border: "1px solid var(--border)", borderRadius: 8, background: "#F8FAFC", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>About this workspace</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8A93A5", border: "1px solid #E2E6EE", borderRadius: 999, padding: "1px 8px", background: "#FFFFFF" }}>
              Fixed
            </span>
          </div>
          <dl style={{ display: "grid", gap: 6, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
              <dt style={{ color: "#56627A" }}>Default currency</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>EUR — Euro</dd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
              <dt style={{ color: "#56627A" }}>Workspace region</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>EU (Frankfurt)</dd>
            </div>
          </dl>
        </div>

        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={handleSave}
            disabled={saving || !organization}
            style={{ ...primaryGreenButton, background: saving || !organization ? "#8A93A5" : "var(--brand-green)", cursor: saving || !organization ? "not-allowed" : "pointer" }}
          >
            <Save size={14} strokeWidth={2} />
            {saving ? "Saving…" : "Save changes"}
          </button>
          {feedback && (
            <span style={{ fontSize: 12.5, fontWeight: 500, color: feedback.kind === "ok" ? "var(--brand-green-deep)" : "#A52E2E" }}>
              {feedback.text}
            </span>
          )}
        </div>
      </SettingsGroup>

      <OrderDirectionSetting />
    </div>
  );
}

// ── Order direction setting ─────────────────────────────────────────────────
// One control that flips how parties are labelled across the app. Persists via
// getOrgSettings/updateOrgSettings; invalidating ["org-settings"] relabels every
// component that reads useOrderDirection() immediately. DISPLAY-ONLY — no entity
// or behaviour change.

const DIRECTION_OPTIONS: Array<{ value: OrderDirection; title: string }> = [
  { value: "outbound", title: "We send purchase orders to our suppliers" },
  { value: "inbound", title: "We receive purchase orders from our customers" },
];

function OrderDirectionSetting() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    staleTime: 300_000,
  });
  const current: OrderDirection = data?.direction ?? "outbound";
  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const mutation = useMutation({
    mutationFn: (direction: OrderDirection) => updateOrgSettings(direction),
    onSuccess: (saved) => {
      queryClient.setQueryData(["org-settings"], saved);
      // Relabel the whole app immediately.
      void queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      setFeedback({ text: "Saved. Labels updated across the app.", kind: "ok" });
    },
    onError: (err: Error) => {
      setFeedback({ text: err.message || "Could not save changes.", kind: "err" });
    },
  });

  function choose(direction: OrderDirection) {
    setFeedback(null);
    if (direction === current) return;
    mutation.mutate(direction);
  }

  return (
    <SettingsGroup
      title="How do you use ProcuLink?"
      sub="This sets how parties are labelled across your inbox, dashboard, and suppliers."
    >
      <div role="radiogroup" aria-label="How do you use ProcuLink?" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {DIRECTION_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          const pending = mutation.isPending && mutation.variables === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isLoading || mutation.isPending}
              onClick={() => choose(opt.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                padding: "13px 15px",
                borderRadius: 8,
                border: `1.5px solid ${selected ? "var(--brand-green)" : "var(--border)"}`,
                background: selected ? "rgba(46,142,58,0.06)" : "#FFFFFF",
                cursor: isLoading || mutation.isPending ? "default" : "pointer",
                transition: "border-color 150ms, background 150ms",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: `2px solid ${selected ? "var(--brand-green)" : "#C6CDDA"}`,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selected && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--brand-green)" }} />}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{opt.title}</span>
              {pending && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-muted)" }}>Saving…</span>}
            </button>
          );
        })}
      </div>
      {feedback && (
        <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 500, color: feedback.kind === "ok" ? "var(--brand-green-deep)" : "#A52E2E" }}>
          {feedback.text}
        </div>
      )}
    </SettingsGroup>
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
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setForm(settings);
    setPassword("");
    setPasswordTouched(false);
  }, [settings]);

  // Pilot is the only tier without email ingestion (decoupled to all paid plans).
  const canEnable = !!billing && billing.plan !== "pilot";

  const mutation = useMutation({
    mutationFn: (payload: UpdateEmailSettingsPayload) => updateEmailSettings(payload),
    onSuccess: (savedSettings) => {
      queryClient.setQueryData(["email-settings"], savedSettings);
      setPassword("");
      setPasswordTouched(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    },
  });

  function update<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setValidationError(null);
  }

  function save() {
    setValidationError(null);
    setSaved(false);
    // Client-side validation mirroring the backend so the user gets an inline
    // message instead of a 400 round-trip. Connection fields are only required
    // when polling is actually being enabled.
    if (form.enabled) {
      if (!form.host.trim()) { setValidationError("IMAP host is required to enable polling."); return; }
      if (!form.username.trim()) { setValidationError("Username is required to enable polling."); return; }
      if (!form.defaultSupplierId) { setValidationError("Choose a default supplier to enable polling."); return; }
      if (!form.hasPassword && !(passwordTouched && password)) {
        setValidationError("A password is required to enable polling."); return;
      }
    }
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
      <div style={{ borderRadius: 12, background: "#FFFFFF", padding: 22, border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }} role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
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
            Email ingestion is included from any paid plan. You can prepare the configuration here, but enabling polling requires upgrading from Pilot.
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
            disabled={(!canEnable && !form.enabled) || (suppliers.length === 0 && !form.enabled)}
            onChange={(v) => update("enabled", v)}
            ariaLabel="Poll inbox for orders"
          />
        </div>

        {/* IMAP config fields — canonical section framing, full form preserved (Group H) */}
        <div style={{ marginTop: 14 }}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2" style={{ marginBottom: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Mail size={15} color="var(--brand-green)" strokeWidth={1.75} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>IMAP mailbox</span>
            </span>
            <span style={{ fontSize: 11.5, color: "#56627A", lineHeight: 1.4 }}>— unseen messages with CSV, XLSX, or PDF attachments are imported.</span>
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
            <FormField label="IMAP host" required>
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
            <FormField label="Username" required>
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
            <FormField label="Default supplier" required>
              {suppliers.length === 0 ? (
                <div style={{ borderRadius: 8, border: "1px dashed #C6CDDA", background: "#F8FAFC", padding: "10px 12px", fontSize: 12, color: "#56627A", lineHeight: 1.5 }}>
                  No suppliers yet —{" "}
                  <Link href="/library/suppliers" style={{ color: "var(--brand-green-deep)", fontWeight: 600 }}>add one first →</Link>
                </div>
              ) : (
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
              )}
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
          {validationError && (
            <span role="alert" style={{ fontSize: 12, fontWeight: 500, color: "#A52E2E" }}>{validationError}</span>
          )}
          {mutation.error && !validationError && (
            <span role="alert" style={{ fontSize: 12, color: "#A52E2E" }}>{(mutation.error as Error).message}</span>
          )}
          {saved && !mutation.error && !validationError && (
            <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brand-green-deep)" }}>Email settings saved.</span>
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
function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={fieldLabelStyle}>
        {label}
        {required && <span style={{ color: "#A52E2E", marginLeft: 3 }} aria-hidden>*</span>}
      </span>
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

// ── Ingress endpoint row ───────────────────────────────────────────────────
// Read-only "where do I send orders" block on the API-keys tab. Builds the
// inbound URL from the normalised public API base + the org slug, plus the
// required auth header. Handles the slug being absent (older API / still
// generating) with a "generating…" placeholder rather than a broken URL.

function IngressEndpointRow({ slug }: { slug: string | undefined }) {
  const [copied, setCopied] = useState(false);
  const endpoint = slug ? `${apiBaseUrl}/api/ingress/${slug}/orders` : null;

  const copy = async () => {
    if (!endpoint) return;
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be blocked
    }
  };

  return (
    <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, background: "#F8FAFC", padding: "14px 16px", marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>Your ingress endpoint</p>
      <p style={{ fontSize: 11.5, color: "#56627A", margin: "3px 0 10px", lineHeight: 1.5 }}>
        POST order files here to import them via the REST API, Zapier, or Make.com.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 6, padding: "9px 11px", color: endpoint ? "#0B1A2F" : "#8A93A5", wordBreak: "break-all" }}
        >
          {endpoint ?? `${apiBaseUrl}/api/ingress/`}
          {!endpoint && <span style={{ fontStyle: "italic" }}>generating…</span>}
          {!endpoint && "/orders"}
        </code>
        <button
          onClick={copy}
          disabled={!endpoint}
          className="sm:flex-none"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, height: 36, padding: "0 14px", border: "1px solid #D5DAE5", borderRadius: 6, background: "#FFFFFF", color: endpoint ? "#0B1A2F" : "#8A93A5", fontSize: 12.5, fontWeight: 600, cursor: endpoint ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
        >
          <Copy size={13} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "#56627A", margin: "10px 0 0", lineHeight: 1.5 }}>
        Authenticate with the header{" "}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, background: "#EFF2F7", borderRadius: 4, padding: "1px 5px", color: "#0B1A2F" }}>
          X-ProcuLink-Key: &lt;your key&gt;
        </code>{" "}
        using a key created below.
      </p>
    </div>
  );
}

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

  // Org slug → inbound ingress endpoint. Customers need this URL + the
  // X-ProcuLink-Key header to POST orders; without it a created key is useless.
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    staleTime: 300_000,
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

        {/* Where to send orders — slug + endpoint + auth header */}
        <IngressEndpointRow slug={orgSettings?.slug} />

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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="status" aria-busy="true">
            <span className="sr-only">Loading…</span>
            {[1, 2].map(i => <div key={i} style={{ height: 52, borderRadius: 6, background: "#EFF2F7" }} />)}
          </div>
        )}

        {!isLoading && keys.length === 0 && !showCreate && (
          <div style={{ border: "1px dashed #C6CDDA", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
            <Key size={28} color="#C6CDDA" style={{ margin: "0 auto 10px" }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: "#56627A" }}>No API keys yet</p>
            <p style={{ fontSize: 12, color: "#8A93A5", marginTop: 4 }}>
              Create a key to post orders to the REST API or a custom webhook integration.
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
                      <div style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                        <InlineConfirm
                          onConfirm={() => revoke.mutate(key.id)}
                          confirmLabel="Revoke"
                          prompt="Break any integration using it?"
                          trigger={(open) => (
                            <button
                              onClick={open}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#56627A", padding: "4px 2px", fontSize: 12.5, fontWeight: 600 }}
                              title="Revoke key"
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#C53A3A"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "#56627A"; }}
                            >
                              Revoke
                            </button>
                          )}
                        />
                      </div>
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
                  <div style={{ marginTop: 10 }}>
                    <InlineConfirm
                      onConfirm={() => revoke.mutate(key.id)}
                      confirmLabel="Revoke"
                      prompt="Break any integration using it?"
                      fullWidth
                      trigger={(open) => (
                        <button
                          onClick={open}
                          style={{ width: "100%", height: 40, borderRadius: 8, border: "1px solid #E9B8B8", background: "#FFFFFF", color: "#A52E2E", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                        >
                          Revoke
                        </button>
                      )}
                    />
                  </div>
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
                placeholder='e.g. "Production integration" or "Staging webhook"'
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

        {/* How to connect — lead with the working REST/webhook path. The native
            Zapier/Make.com apps aren't published yet, so we don't link out to
            unpublished listings (they 404); we say they're coming instead. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {/* REST + webhook (the working path) */}
          <div className="connector-row" style={connectorRow}>
            <div style={connectorTile}>
              <Plug size={18} color="#56627A" strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>REST API &amp; webhooks</p>
              <p style={{ fontSize: 12, color: "#56627A", lineHeight: 1.5, margin: "3px 0 0" }}>
                Post orders to your ingress endpoint and receive real-time events at any URL — works with
                Zapier, Make.com, n8n, or your own backend today. Create a key on the API keys tab, then add a
                webhook below.
              </p>
            </div>
          </div>

          {/* Native apps — coming soon, no dead links */}
          <div className="connector-row" style={{ ...connectorRow, background: "#F8FAFC" }}>
            <div style={connectorTile}>
              <Zap size={18} color="#8A93A5" strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#56627A", margin: 0 }}>
                Native Zapier &amp; Make.com apps
              </p>
              <p style={{ fontSize: 12, color: "#8A93A5", lineHeight: 1.5, margin: "3px 0 0" }}>
                One-click published apps are coming soon. In the meantime, point a Zapier/Make webhook step at a
                subscription below.
              </p>
            </div>
            <span
              className="connector-action"
              style={{ fontSize: 11.5, fontWeight: 600, color: "#8A93A5", padding: "6px 10px", borderRadius: 999, background: "#EFF2F7", whiteSpace: "nowrap" }}
            >
              Coming soon
            </span>
          </div>
        </div>

        {/* Webhook subscriptions */}
        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ flexWrap: "wrap", marginBottom: 14, paddingTop: 4, borderTop: "1px solid #EDF0F5" }}
        >
          <div style={{ paddingTop: 14, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", margin: 0 }}>Webhook subscriptions</p>
            <p style={{ fontSize: 12.5, color: "#56627A", marginTop: 3 }}>
              Receive ProcuLink events at any URL — Zapier, Make.com, or custom.
            </p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="w-full sm:w-auto"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 38, padding: "0 14px", border: "1px solid #D5DAE5", borderRadius: 8, background: "#FFFFFF", color: "#0B1A2F", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            <Plus size={14} /> Add webhook
          </button>
        </div>

        {showForm && (
          <div style={{ border: "1px solid #C6CDDA", borderRadius: 8, background: "#FFFFFF", padding: 16, marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F", marginBottom: 14 }}>New webhook subscription</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" style={{ marginBottom: 12 }}>
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
                <InlineConfirm
                  onConfirm={() => remove.mutate(sub.id)}
                  confirmLabel="Delete"
                  prompt="Delete this webhook?"
                  trigger={(open) => (
                    <button
                      onClick={open}
                      aria-label="Delete webhook subscription"
                      title="Delete webhook subscription"
                      style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "#8A93A5" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
