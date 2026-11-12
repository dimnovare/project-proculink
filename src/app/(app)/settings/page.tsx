"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building, Copy, Euro, Key, Plug, Plus, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BillingSection } from "@/components/bridge/BillingSection";
import { SettingsGroup } from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/bridge/DSPrimitives";
import {
  getBillingStatus,
  getApiKeys,
  createApiKey,
  revokeApiKey,
} from "@/lib/api-client";
import type { ApiKey } from "@/lib/api-client";
import { useTabParamSync } from "@/lib/tab-param-sync";
import { isOrgAdminRefusal, orgAdminMessage } from "@/lib/planGate";
import { planDisplayName } from "@/lib/plans";
import { NotificationEmailSection } from "@/components/flows/NotificationEmailSection";
import { formatDate } from "@/lib/format-date";

type SettingsTab = "org" | "billing" | "api" | "connectors";

// The tab IDs are code. Only the words are user-facing:
//   org           → "Workspace"
//   billing       → "Plan & billing"
//   connectors    → "Notifications" (id kept so old ?tab=connectors links still land)
const TABS: Array<{ id: SettingsTab; label: string; Icon: React.ElementType }> = [
  { id: "org",           label: "Workspace",      Icon: Building },
  { id: "billing",       label: "Plan & billing", Icon: Euro     },
  { id: "api",           label: "API keys",       Icon: Key      },
  { id: "connectors",    label: "Notifications",  Icon: Plug     },
];

// The plan label is DERIVED from the ladder in src/lib/plans.ts. This file used to keep
// its own `PLAN_LABELS` map, and it listed five of the six tiers — Distributor, a live
// self-serve tier with live Stripe prices, was missing. The lookup fell through to
// `?? billing.plan`, so a customer paying €1,499/month read `Acme · distributor` in their
// own Settings header. A hand-kept copy of a list that lives somewhere else will miss the
// next tier the same way; there is nothing to miss now.

// Module-scope so useTabParamSync's effect deps stay referentially stable.
const isSettingsTab = (v: string | null | undefined): v is SettingsTab =>
  v != null && TABS.some((t) => t.id === v);

export default function SettingsPage() {
  // Initial tab honours a `?tab=` deep-link (e.g. the onboarding completion
  // card's "Create an API key" → ?tab=api). Validated against the SettingsTab union; falls back to "org".
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get("tab");
  const [tab, setTab] = useState<SettingsTab>(isSettingsTab(requestedTab) ? requestedTab : "org");
  // ?tab= changes while MOUNTED (e.g. help-slideover guide links on /settings)
  // must also switch tabs; manual tab clicks don't write the URL back, so the
  // sync fires only when the param VALUE itself changes.
  useTabParamSync<SettingsTab>(requestedTab, isSettingsTab, setTab);
  const { organization } = useOrganization();
  const { data: billing, isError: billingFailed } = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000 });
  const orgName   = organization?.name ?? "…";
  // On a failed billing read the header shows a neutral "—", not an eternal "…":
  // the ellipsis is a loading claim, and a dead endpoint would leave it there for
  // the rest of the page's life.
  const planLabel = billing ? planDisplayName(billing.plan) : billingFailed ? "—" : "…";

  return (
    <PageShell className="settings-shell">
        {/* Page header */}
        <PageHeader title="Settings" sub={`${orgName} · ${planLabel}`} />

        {/* Responsive grid as classes (1-col mobile / 200px nav + content ≥md) — the
            previous inline gridTemplateColumns forced the media query below to use
            !important to win over it. */}
        <div className="settings-grid grid grid-cols-1 items-start gap-4 md:gap-7 md:[grid-template-columns:200px_minmax(0,1fr)]">
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
            {tab === "org"           && <OrgSection />}
            {tab === "billing"       && <BillingSectionWrapper />}
            {tab === "api"           && <ApiKeysSection />}
            {tab === "connectors" && <NotificationEmailSection />}
          </div>
        </div>

      <style>{`
        .settings-nav-item:not([aria-current="page"]):hover {
          background: var(--surface-2);
          color: var(--ink);
        }
        @media (max-width: 767px) {
          /* Mobile uses a compact command grid instead of a horizontal scroller:
             every settings area is visible at once, which is faster for thumb use. */
          .settings-nav {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            background: var(--surface-2);
            border: 1px solid var(--border);
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
    </PageShell>
  );
}

// ── Settings group card — canonical section framing ────────────────────────

// SettingsGroup lives in @/components/settings/SettingsPrimitives
// (shared; a Next page module may not export non-default symbols).

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
      {prompt && <span style={{ fontSize: 12, color: "var(--ink-muted)", marginRight: 2 }}>{prompt}</span>}
      <button
        onClick={() => { setOpen(false); onConfirm(); }}
        className={fullWidth ? "flex-1" : undefined}
        style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "none", background: danger ? "var(--danger)" : "var(--brand-green-btn)", color: "var(--surface)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        {confirmLabel}
      </button>
      <button
        onClick={() => setOpen(false)}
        className={fullWidth ? "flex-1" : undefined}
        style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Cancel
      </button>
    </div>
  );
}

// ── Failed write, said out loud ─────────────────────────────────────────────

/**
 * Copy for a Settings write that did not land.
 *
 * `stillTrue` leads, and it names the state the user is STILL IN — not the fact that
 * something went wrong. A revoke, a pause and a delete are all read by their absence
 * of protest: someone who clicks Revoke on a leaked key and sees nothing concludes the
 * key is dead. So does someone who sees a neutral "something went wrong". The lead-in
 * has to close that door before the reason is given.
 *
 * The org-admin refusal is checked first because it is the one cause that retrying
 * cannot fix (the same pattern
 * as the other Settings writes on this screen).
 */
function writeFailureCopy(error: unknown, stillTrue: string): string {
  const why = isOrgAdminRefusal(error)
    ? orgAdminMessage()
    : "We could not complete the change — try again in a moment.";
  return `${stillTrue} ${why}`;
}

/** Inline, row-scoped failure line. `role="alert"` — this is never ambient information. */
function WriteFailure({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      role="alert"
      style={{
        margin: "8px 0 0",
        fontSize: 11.5,
        lineHeight: 1.5,
        fontWeight: 500,
        color: "var(--danger)",
        textAlign: "left",
        ...style,
      }}
    >
      {children}
    </p>
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

  const trimmedName = name.trim();
  // Disable Save when there's nothing to save (empty / unchanged) or in-flight.
  const canSave = !!organization && !saving && trimmedName.length > 0 && trimmedName !== orgName;

  async function handleSave() {
    if (!organization) return;
    const trimmed = name.trim();
    if (!trimmed) { setFeedback({ text: "Workspace name can't be empty.", kind: "err" }); return; }
    if (trimmed === orgName) { setFeedback({ text: "No changes to save.", kind: "ok" }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await organization.update({ name: trimmed });
      // The user has now taken ownership of the name — retire the auto-name
      // nudge so it never reappears for this (or any) workspace.
      try { localStorage.removeItem("ws-autonamed"); } catch { /* storage may be blocked */ }
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
            aria-label="Workspace name"
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
        <div style={{ marginTop: 18, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>About this workspace</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-faint)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", background: "var(--surface)" }}>
              Fixed
            </span>
          </div>
          <dl style={{ display: "grid", gap: 6, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
              <dt style={{ color: "var(--ink-muted)" }}>Default currency</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>EUR — Euro</dd>
            </div>
            {/* This row said "Workspace region — EU", inside a block badged Fixed and
                sitting next to a genuinely fixed fact (currency), which lent it the same
                standing. There IS no per-workspace region: nothing configures one, nothing
                stores one, and the claim it was really making — where order data lives —
                is a whole-product claim with named US subprocessors on the other side of
                it. Renamed to what it actually describes and linked to the page that
                qualifies it, which is the same rule the marketing footers follow. */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
              <dt style={{ color: "var(--ink-muted)" }}>Order storage</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>
                <Link href="/security" className="inline-flex min-h-[24px] items-center" style={{ color: "inherit" }}>EU-region</Link>
              </dd>
            </div>
          </dl>
        </div>

        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button variant="primary" size="lg" onClick={handleSave} disabled={!canSave}>
            <Save size={14} strokeWidth={2} />
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {feedback && (
            <span style={{ fontSize: 12.5, fontWeight: 500, color: feedback.kind === "ok" ? "var(--brand-green-deep)" : "var(--danger)" }}>
              {feedback.text}
            </span>
          )}
        </div>
      </SettingsGroup>

    </div>
  );
}

// Shared primary CTA — brand green (matches design "Save changes" / primary actions):
// <Button variant="primary" size="lg"> from @/components/bridge/DSPrimitives.

// Shared neutral secondary button — white, bordered (matches design "Manage" / "Change plan")
const secondaryNeutralButton: CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--ink)",
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

const fieldLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--ink-muted)",
  display: "block",
};

// WP-31: `minHeight` rather than `height` so the touch floors in globals.css
// (44px hit area, 16px font) can clamp this up without fighting a fixed height.
// The `.settings-shell` mobile font-size rule above predates the global floor and
// is now redundant for widths ≤639px; it is kept because it also covers 640–767px.
const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 40,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 13,
  color: "var(--ink)",
  background: "var(--surface)",
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

  // A failed revoke is the one failure on this screen that is dangerous to misread.
  // Someone revoking a leaked credential and seeing silence walks away believing the
  // key is dead; so does someone shown a neutral "that didn't work". The line has to
  // put the key's live status first, and it points at the ONE thing that would prove
  // the revoke landed — the row flipping to "Revoked" — so the reader has a test
  // rather than a reassurance.
  const revokeFailureFor = (keyId: string): string | null =>
    revoke.isError && revoke.variables === keyId
      ? writeFailureCopy(
          revoke.error,
          "Still active — do not assume this key is revoked. Anyone holding it can still use the API " +
            "until this row shows Revoked.",
        )
      : null;

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
      <div style={{ borderRadius: 12, background: "var(--surface)", padding: "20px 22px", border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", boxShadow: "var(--shadow-card)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>API keys unavailable</h2>
        <p style={{ margin: 0, maxWidth: 520, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
          Could not reach the API keys endpoint. Your keys are not affected — this is a temporary connectivity issue.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, height: 32, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* "REST API", not "REST + webhook API": a key authenticates orders coming
          IN. Outbound webhooks are signed by us and need no key from you. */}
      <SettingsGroup title="API keys" sub="Authenticate the ProcuLink REST API. Each key is shown once at creation.">

        {/* One-time API key reveal — a focus-trapped modal (Esc / ✕ / backdrop close).
            The secret is shown ONCE and cannot be retrieved again after dismissal. */}
        <Dialog open={!!newKey} onOpenChange={(open) => { if (!open) setNewKey(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} style={{ color: "var(--amber-text)" }} aria-hidden />
                Copy your new API key now
              </DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. It cannot be retrieved again after you close this dialog — store it somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", color: "var(--ink)", wordBreak: "break-all" }}>
                {newKey}
              </code>
              <button
                onClick={() => newKey && handleCopy(newKey)}
                style={{ display: "flex", alignItems: "center", gap: 5, height: 38, padding: "0 14px", border: "1px solid var(--brand-green-btn)", borderRadius: 7, background: "var(--brand-green-btn)", color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <Copy size={13} />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <DialogFooter>
              <button
                onClick={() => setNewKey(null)}
                style={{ height: 36, padding: "0 14px", border: "1px solid var(--border-strong)", borderRadius: 7, background: "var(--surface)", color: "var(--ink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                I&apos;ve saved it
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Keys table */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="status" aria-busy="true">
            <span className="sr-only">Loading…</span>
            {[1, 2].map(i => <div key={i} style={{ height: 52, borderRadius: 6, background: "var(--surface-2)" }} />)}
          </div>
        )}

        {!isLoading && keys.length === 0 && !showCreate && (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
            <Key size={28} color="var(--border)" style={{ margin: "0 auto 10px" }} />
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-muted)" }}>No API keys yet</p>
            <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>
              Create a key so your ERP, Zapier, or Make can post orders to the REST API.
            </p>
          </div>
        )}

        {/* Desktop: dense table (hidden on mobile to avoid horizontal overflow) */}
        {keys.length > 0 && (
          <table data-testid="api-keys-table" className="hidden md:table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Key", "Created", "Last used", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-faint)", padding: "0 12px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map(key => (
                <tr key={key.id} style={{ opacity: key.isActive ? 1 : 0.55 }}>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{key.label}</td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <code style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--ink-muted)" }}>{key.keyPrefix}…</code>
                  </td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                    {formatDate(key.createdAt)}
                  </td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                    {formatDate(key.lastUsedAt)}
                  </td>
                  <td style={{ padding: "11px 12px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                    {key.isActive ? (
                      <>
                        <div style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                          <InlineConfirm
                            onConfirm={() => revoke.mutate(key.id)}
                            confirmLabel="Revoke"
                            prompt="Break any integration using it?"
                            trigger={(open) => (
                              <button
                                onClick={open}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px 2px", fontSize: 12.5, fontWeight: 600 }}
                                title="Revoke key"
                                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ink-muted)"; }}
                              >
                                Revoke
                              </button>
                            )}
                          />
                        </div>
                        {revokeFailureFor(key.id) && (
                          <WriteFailure style={{ textAlign: "right", maxWidth: 340, marginLeft: "auto" }}>
                            {revokeFailureFor(key.id)}
                          </WriteFailure>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "var(--surface-2)", color: "var(--ink-muted)" }}>Revoked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Mobile: each key as a stacked row-card (no horizontal scroll) */}
        {keys.length > 0 && (
          <div data-testid="api-keys-cards" className="flex flex-col gap-2 md:hidden">
            {keys.map(key => (
              <Card
                key={key.id}
                pad="12px 14px"
                radius={10}
                style={{ opacity: key.isActive ? 1 : 0.6 }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{key.label}</span>
                  {!key.isActive && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "var(--surface-2)", color: "var(--ink-muted)", flexShrink: 0 }}>Revoked</span>
                  )}
                </div>
                <code style={{ display: "block", marginTop: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "var(--ink-muted)" }}>{key.keyPrefix}…</code>
                <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--ink-faint)" }}>
                  Created {formatDate(key.createdAt)}
                  {" · Last used "}
                  {formatDate(key.lastUsedAt)}
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
                          style={{ width: "100%", height: 40, borderRadius: 8, border: "1px solid #E9B8B8", background: "var(--surface)", color: "var(--danger)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                        >
                          Revoke
                        </button>
                      )}
                    />
                    {revokeFailureFor(key.id) && (
                      <WriteFailure>{revokeFailureFor(key.id)}</WriteFailure>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Create key — disclosure form (revealed by the Create key button) */}
        {showCreate && (
          <Card pad={16} radius={8} style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>Create new key</p>
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
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: !newLabel.trim() || create.isPending ? "#CBD5E1" : "var(--brand-green-btn)", color: "var(--surface)", fontSize: 13, fontWeight: 600, cursor: !newLabel.trim() || create.isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                >
                  <Plus size={14} />
                  {create.isPending ? "Creating…" : "Create key"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewLabel(""); }}
                  className="flex-1 sm:flex-none"
                  style={{ height: 40, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
            {create.isError && (
              <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>
                {(create.error as Error).message || "Failed to create API key."}
              </p>
            )}
          </Card>
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
