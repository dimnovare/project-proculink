"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building, Copy, Database, Euro, HardDrive, Key, Mail, Plug, Plus, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BillingSection } from "@/components/bridge/BillingSection";
import { SettingsGroup } from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/bridge/DSPrimitives";
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
import { useTabParamSync } from "@/lib/tab-param-sync";
import { isOrgAdminRefusal, orgAdminMessage } from "@/lib/planGate";
import { PLAN_BY_ID, planDisplayName, planName } from "@/lib/plans";
import { minimumPlanId } from "@/lib/gatedCapabilities";
import { SftpPullSettings, S3PullSettings } from "@/components/settings/PullIngressSettings";
import { InboundAddressSection } from "@/components/settings/InboundAddressSection";
import { pollingHealthLine, type PollingHealthTone } from "@/components/settings/pollingHealth";
import { webhookHealth, type WebhookHealthTone } from "@/components/settings/webhookHealth";
import { formatDateTime } from "@/lib/format-date";

type SettingsTab = "org" | "billing" | "email" | "sftp" | "s3" | "api" | "connectors";

// WP-25 (DESIGN-DB-1 §6.3): the tab IDs are code and are UNCHANGED, so every
// `?tab=` deep link (onboarding CTAs, help slideover, checklist) still opens the
// same panel. Only the words moved:
//   org        → "Workspace"                  (one of the nine nouns)
//   billing    → "Plan & billing"             (the plan is what they came for)
//   sftp/s3    → "… folder"                   ("pull" is our verb, not theirs)
//   connectors → "Notifications"              (it sends events to other systems)
const TABS: Array<{ id: SettingsTab; label: string; Icon: React.ElementType }> = [
  { id: "org",        label: "Workspace",                  Icon: Building   },
  { id: "billing",    label: "Plan & billing",             Icon: Euro       },
  { id: "email",      label: "Email intake",               Icon: Mail       },
  { id: "sftp",       label: "SFTP folder",                Icon: HardDrive  },
  { id: "s3",         label: "Cloud folder (S3 or R2)",    Icon: Database   },
  { id: "api",        label: "API keys",                   Icon: Key        },
  { id: "connectors", label: "Notifications",              Icon: Plug       },
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
  // card's "Set up email intake" → ?tab=email and "Create an API key" →
  // ?tab=api). Validated against the SettingsTab union; falls back to "org".
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
            {tab === "org"        && <OrgSection />}
            {tab === "billing"    && <BillingSectionWrapper />}
            {tab === "email"      && <EmailSettingsSection />}
            {tab === "sftp"       && <SftpPullSettings />}
            {tab === "s3"         && <S3PullSettings />}
            {tab === "api"        && <ApiKeysSection />}
            {tab === "connectors" && <ConnectorsSection />}
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
 * cannot fix (matching `actionErrorCopy` in InboundAddressSection, the same pattern
 * one section up on this screen).
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
                <Link href="/security" style={{ color: "inherit" }}>EU-region</Link>
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
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    staleTime: 300_000,
  });
  const current: OrderDirection = data?.direction ?? "outbound";
  // A FAILED read must not render the "outbound" fallback as the saved answer:
  // a checked, enabled radio here asserts a choice this screen never fetched,
  // and clicking the shown option early-returns as "already saved". While the
  // read has failed (and no cached answer exists) the radios are withheld.
  const readFailed = isError && data === undefined;
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

  // Roving-tabindex + arrow-key navigation so the radiogroup is keyboard
  // operable like a native radio group: only the checked option is tabbable,
  // and Arrow keys move (and select) between options.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (isLoading || mutation.isPending) return;
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const currentIndex = DIRECTION_OPTIONS.findIndex((o) => o.value === current);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const nextIndex =
      (currentIndex + (forward ? 1 : -1) + DIRECTION_OPTIONS.length) % DIRECTION_OPTIONS.length;
    const next = DIRECTION_OPTIONS[nextIndex];
    choose(next.value);
    // Move focus to the newly selected radio (which becomes the tabbable one).
    requestAnimationFrame(() => {
      const el = document.getElementById(`direction-radio-${next.value}`);
      el?.focus();
    });
  }

  return (
    <SettingsGroup
      title="How do you use ProcuLink?"
      sub="This sets how parties are labelled across your inbox, dashboard, and suppliers."
    >
      {readFailed ? (
        <div
          role="alert"
          data-testid="direction-load-failed"
          style={{ borderRadius: 8, border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", background: "var(--surface)", padding: "12px 14px" }}
        >
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
            We couldn&rsquo;t load this setting just now, so we can&rsquo;t show which option is
            currently active. Your saved choice is unchanged.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refetch()}
            disabled={isFetching}
            style={{ marginTop: 10 }}
          >
            {isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      ) : (
      <div
        role="radiogroup"
        aria-label="How do you use ProcuLink?"
        onKeyDown={handleKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        {DIRECTION_OPTIONS.map((opt) => {
          const selected = current === opt.value;
          const pending = mutation.isPending && mutation.variables === opt.value;
          return (
            <button
              key={opt.value}
              id={`direction-radio-${opt.value}`}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
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
                background: selected ? "rgba(46,142,58,0.06)" : "var(--surface)",
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
                  border: `2px solid ${selected ? "var(--brand-green)" : "var(--border)"}`,
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
      )}
      {feedback && (
        <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 500, color: feedback.kind === "ok" ? "var(--brand-green-deep)" : "var(--danger)" }}>
          {feedback.text}
        </div>
      )}
    </SettingsGroup>
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

// ── Email settings (full shipped Group H IMAP form — KEEP) ─────────────────

// Colour follows the READING, not the setting. `stale` and `unverified` are the two states the
// old "Checking every 5 minutes" sentence used to swallow, so neither of them is allowed to look
// like the resting grey of a healthy row.
const POLL_TONE_COLOR: Record<PollingHealthTone, string> = {
  unsaved: "var(--amber-text)",
  off: "var(--ink-faint)",
  unverified: "var(--amber-text)",
  healthy: "var(--ink-faint)",
  stale: "var(--danger)",
};

function EmailSettingsSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["email-settings"],
    queryFn: getEmailSettings,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: billing, isLoading: billingLoading } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    retry: false,
  });
  // `retry: false` means ONE failed request would otherwise decide the rest of
  // this page's life — so the failure must be distinguishable from an org with
  // zero suppliers, which is a settled answer this screen acts on.
  const {
    data: suppliers = [],
    isError: suppliersFailed,
    refetch: refetchSuppliers,
    isFetching: suppliersFetching,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    retry: false,
  });
  // Org slug → the hosted inbound address card at the top of this tab.
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    staleTime: 300_000,
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

  const seededRef = useRef(false);
  // `seeded` mirrors the ref as STATE because the status line below has to know whether `form`
  // is the user's edit or still the pre-seed default. The ref alone cannot tell them apart, and
  // reading the default as an edit would flash "Not saved yet" on every load.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!settings || seededRef.current) return;
    seededRef.current = true;
    setForm(settings);
    setSeeded(true);
    setPassword("");
    setPasswordTouched(false);
  }, [settings]);

  // Pilot is the only tier without email ingestion (decoupled to all paid plans).
  const canEnable = !!billing && billing.plan !== "pilot";

  // The tier that unlocks this switch, and what it costs — DERIVED, never typed. The gate
  // table (src/lib/gatedCapabilities.ts, mirroring PlanConstants.MinimumPlan) chooses the
  // tier; the ladder (src/lib/plans.ts) supplies its name and its price. Same shape as
  // requiresPlan() on the help pages. Note this is a capability MINIMUM, not the tier above
  // the reader's own — `PLAN_BY_ID[plan].next` would be the wrong pointer here.
  const emailUnlock = PLAN_BY_ID[minimumPlanId("emailIngestion")];

  // The status line under the switch. Driven by `lastPolledAt` — a stamp the Worker writes only
  // after a poll fully succeeded — NOT by `enabled`, which is only what the operator asked for.
  // See src/components/settings/pollingHealth.ts for why each state reads the way it does.
  const savedEnabled = settings?.enabled ?? false;
  const pollHealth = pollingHealthLine({
    savedEnabled,
    pendingEnabled: seeded ? form.enabled : savedEnabled,
    lastPolledAt: settings?.lastPolledAt,
  });
  // The exact instant, for whoever is comparing against a mail server log. Omitted entirely when
  // there is no readable stamp — "not run yet" used to be printed there, and that was a claim
  // about a poll never happening that this screen has no way to make.
  const lastPollExact = settings?.lastPolledAt ? formatDateTime(settings.lastPolledAt) : "—";

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
      <Card pad={22} radius={12} role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <div style={{ marginBottom: 16, height: 16, width: 160, borderRadius: 4, background: "var(--border)" }} />
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3,1fr)" }}>
          <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
          <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
          <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <div style={{ borderRadius: 12, background: "var(--surface)", padding: "20px 22px", border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", boxShadow: "var(--shadow-card)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>Email settings are unavailable</h2>
        <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-muted)" }}>
          Your saved settings are safe — this is a temporary connection issue, so email polling settings can&rsquo;t be loaded or changed right now. Retry in a moment.
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ marginTop: 14, height: 32, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
        >
          {isFetching ? "Checking..." : "Retry connection"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <SettingsGroup title="Email intake" sub="Ingest orders that arrive by email — IMAP polling every 5 minutes.">
        {/* The zero-setup intake path first: the hosted address needs none of the
            IMAP config below. Shown here as well as on the API-keys tab so the
            Email tab answers "where do I send orders?" on its own. */}
        <InboundAddressSection />
        <p style={{ fontSize: 12, color: "var(--ink-muted)", margin: "-6px 0 18px", lineHeight: 1.55 }}>
          This address needs no setup — anything sent to it is imported automatically. Share it with
          the people who email you orders, or add a forwarding rule in your own mailbox. The IMAP
          polling below is only for reading a mailbox you already own.{" "}
          <Link href="/help/order-intake-options" style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>
            See all order intake options
          </Link>.
        </p>

        {/* Enable row + billing gate notice.

            Two arms, because `!canEnable` is true for TWO different reasons and only one of
            them is a plan. `canEnable` is `!!billing && billing.plan !== "pilot"`, so it is
            also false while the billing query has no data — and that query is `retry: false`,
            so a single failed request leaves it undefined for the rest of the page's life.
            This banner used to answer both cases with "the Pilot plan doesn't include it" and
            an "Upgrade to Growth (€149/mo)" link, which is how a Distributor workspace whose
            billing lookup failed got told it was on Pilot and offered a €1,350/month
            downgrade. A plan is named here only when the server named one.

            The loading arm renders nothing at all: during the first fetch we do not yet know
            which of the two sentences is true, and neither is worth flashing. */}
        {!canEnable && !billingLoading && (
          <div
            data-testid="email-plan-gate"
            style={{ marginBottom: 16, borderRadius: 8, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.5, border: "1px solid var(--amber-soft)", background: "var(--amber-soft)", color: "var(--amber-text)" }}
          >
            {billing ? (
              <>
                Email ingestion is included on every paid plan. You can set it up here, but turning on polling needs a paid plan — the {planName(billing.plan)} plan doesn&rsquo;t include it.{" "}
                <Link
                  href="/settings?tab=billing"
                  style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}
                >
                  Upgrade to {emailUnlock.name} ({emailUnlock.billingPriceLabel})
                </Link>{" "}
                to switch it on.
              </>
            ) : (
              <>
                Email ingestion is included on every paid plan. We couldn&rsquo;t check which plan this workspace is on just now, so if it isn&rsquo;t on a paid plan, turning polling on will be refused.{" "}
                <Link
                  href="/settings?tab=billing"
                  style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}
                >
                  Open plan &amp; billing
                </Link>{" "}
                to check yours.
              </>
            )}
          </div>
        )}

        {/* Polling status + enable toggle row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "4px 0 16px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>Poll inbox for orders</div>
            <div style={{ fontSize: 12.5, color: POLL_TONE_COLOR[pollHealth.tone], marginTop: 2, maxWidth: 460, lineHeight: 1.45 }}>
              {pollHealth.text}
            </div>
          </div>
          <ToggleSwitch
            checked={form.enabled}
            // `suppliers.length === 0` disables only when it is a SETTLED zero —
            // a failed fetch must not freeze this toggle (the save path still
            // validates that a default supplier is chosen before enabling).
            disabled={(!canEnable && !form.enabled) || (suppliers.length === 0 && !suppliersFailed && !form.enabled)}
            onChange={(v) => update("enabled", v)}
            ariaLabel="Poll inbox for orders"
          />
        </div>

        {/* IMAP config fields — canonical section framing, full form preserved (Group H) */}
        <div style={{ marginTop: 14 }}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2" style={{ marginBottom: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Mail size={15} color="var(--brand-green)" strokeWidth={1.75} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>IMAP mailbox</span>
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.4 }}>— unseen messages with CSV, XLSX, or PDF attachments are imported.</span>
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
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Your provider&apos;s IMAP server — imap.gmail.com (Gmail), imap-mail.outlook.com (Outlook), or ask your IT team.</span>
            </FormField>
            <FormField label="Port">
              <input type="number" value={form.port} onChange={(event) => update("port", Number(event.target.value))} style={inputStyle} />
            </FormField>
            <FormField label="Security">
              <label style={{ display: "flex", height: 40, alignItems: "center", gap: 8, borderRadius: 8, padding: "0 12px", fontSize: 13, border: "1px solid var(--border)", color: "var(--ink)", cursor: "pointer", background: "var(--surface)" }}>
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
              {/* flex-col/sm:flex-row as classes — the previous inline flexDirection
                  style overrode sm:flex-row at every width (inline beats class). */}
              <div className="flex flex-col gap-1.5 sm:flex-row">
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
                    style={{ height: 36, borderRadius: 5, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #E9B8B8", color: "var(--danger)", background: "var(--surface)", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Gmail and Outlook need an app-specific password, not your normal login. Generate one in your email provider&apos;s security settings.</span>
            </FormField>
          </div>

          <div className="grid gap-4 md:grid-cols-2" style={{ marginBottom: 4 }}>
            <FormField label="Folder">
              <input value={form.folder} onChange={(event) => update("folder", event.target.value)} placeholder="INBOX" style={inputStyle} />
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>Usually INBOX. Enter another folder name to poll it instead.</span>
            </FormField>
            <FormField label="Default supplier" required>
              {suppliersFailed && suppliers.length === 0 ? (
                /* The list REQUEST failed — not an empty list. "No suppliers yet —
                   add one first →" here sent operators with real suppliers off to
                   create a duplicate. */
                <div
                  role="alert"
                  data-testid="default-supplier-load-failed"
                  style={{ borderRadius: 8, border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", background: "var(--surface)", padding: "10px 12px", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5 }}
                >
                  We couldn&rsquo;t load your suppliers just now — this doesn&rsquo;t mean you have none.{" "}
                  <button
                    type="button"
                    // FormField wraps this field in a <label>, which would swallow
                    // the button's name into the label text — name it explicitly.
                    aria-label="Try again"
                    onClick={() => void refetchSuppliers()}
                    disabled={suppliersFetching}
                    className="bg-transparent"
                    style={{ border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "var(--brand-blue)", cursor: suppliersFetching ? "wait" : "pointer", textDecoration: "underline" }}
                  >
                    {suppliersFetching ? "Trying again…" : "Try again"}
                  </button>
                </div>
              ) : suppliers.length === 0 ? (
                <div style={{ borderRadius: 8, border: "1px dashed var(--border)", background: "var(--surface-2)", padding: "10px 12px", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5 }}>
                  No suppliers yet —{" "}
                  <Link href="/library/suppliers" style={{ color: "var(--brand-green-deep)", fontWeight: 600 }}>add one first →</Link>
                </div>
              ) : (
                <select
                  value={form.defaultSupplierId ?? ""}
                  onChange={(event) => update("defaultSupplierId", event.target.value || null)}
                  style={{ ...inputStyle, background: "var(--surface)" }}
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

        {/* Footer: security note + save. flex-col/sm:flex-row as classes — the
            previous inline flexDirection style overrode sm:flex-row at every width. */}
        <div className="mt-4 flex flex-col gap-2.5 border-t border-border pt-3.5 sm:flex-row sm:items-center">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <ShieldCheck size={15} color="var(--brand-green)" strokeWidth={1.75} />
            <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
              Passwords are stored encrypted.
              {lastPollExact !== "—" ? ` Last successful check: ${lastPollExact}.` : ""}
            </span>
          </div>
          {validationError && (
            <span role="alert" style={{ fontSize: 12, fontWeight: 500, color: "var(--danger)" }}>{validationError}</span>
          )}
          {mutation.error && !validationError && (
            <span role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>{(mutation.error as Error).message}</span>
          )}
          {saved && !mutation.error && !validationError && (
            <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brand-green-deep)" }}>Email settings saved.</span>
          )}
          <Button variant="primary" size="lg" onClick={save} disabled={mutation.isPending}>
            <Save size={14} strokeWidth={2} />
            {mutation.isPending ? "Saving..." : "Save email"}
          </Button>
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
          background: "var(--surface)",
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
        {required && <span style={{ color: "var(--danger)", marginLeft: 3 }} aria-hidden>*</span>}
      </span>
      {children}
    </label>
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

// Connector list row — bordered card, icon tile + name/desc + right action (matches design)
const connectorRow: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "14px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "var(--surface)",
};

// Neutral soft icon tile used in connector rows (matches design's grey plug tiles)
const connectorTile: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 9,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
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
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)", padding: "14px 16px", marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", margin: 0 }}>Your order intake URL</p>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted)", margin: "3px 0 10px", lineHeight: 1.5 }}>
        {/* The endpoint binds a JSON body (IngressController.CreateOrder takes
            [FromBody] IngressOrderRequest) — it does not accept a file upload.
            The previous "POST order files here" sent integrators to build the
            wrong request; files belong on upload, email, or SFTP/S3 pull. */}
        POST structured orders here as JSON, from your own system, Zapier, or Make.com. Order
        <em> files</em> go through upload, email, or SFTP/S3 pull instead.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: endpoint ? "var(--ink)" : "var(--ink-faint)", wordBreak: "break-all" }}
        >
          {endpoint ?? `${apiBaseUrl}/api/ingress/`}
          {!endpoint && <span style={{ fontStyle: "italic" }}>generating…</span>}
          {!endpoint && "/orders"}
        </code>
        <button
          onClick={copy}
          disabled={!endpoint}
          className="sm:flex-none"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, height: 36, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: endpoint ? "var(--ink)" : "var(--ink-faint)", fontSize: 12.5, fontWeight: 600, cursor: endpoint ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
        >
          <Copy size={13} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-muted)", margin: "10px 0 0", lineHeight: 1.5 }}>
        Authenticate with the header{" "}
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px", color: "var(--ink)" }}>
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

        {/* Where to send orders — slug + endpoint + auth header */}
        <IngressEndpointRow slug={orgSettings?.slug} />

        {/* Where to email orders — the org's issued addresses (CF MX → Postmark → parse) */}
        <InboundAddressSection />

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
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "13px 12px", borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "—"}
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

// ── Connectors Section ────────────────────────────────────────────────────

// The backend-accepted event types, and what each one means in plain language.
// This is the only list of them on this screen: the event dropdown is built from
// it, and the saved-endpoint rows read their description from it. The literal
// code (`order.created`) stays on screen next to the description, because that is
// what the payload carries and what the help article documents — a developer
// wiring up an integration needs to be able to correlate the two.
const EVENT_LABELS: Record<string, string> = {
  "order.created":   "New PO uploaded or received",
  "order.delivered": "PO delivered to supplier",
  // "Couldn't send" is the shipped label for delivery_failed (orderStatusManifest);
  // the retired "Delivery failed" must not come back in through this door.
  "order.failed":    "Couldn't send to the supplier",
};

const PLATFORM_LABELS: Record<string, string> = {
  zapier: "Zapier", make: "Make.com", custom: "Custom",
};

// No green, and no status dot. Green-with-a-dot is the visual grammar for "we checked and it is
// fine", and nothing on this row was ever checked — see src/components/settings/webhookHealth.ts.
// `unverified` gets buyer-blue: informational, plainly not a health signal.
const WEBHOOK_TONE_STYLE: Record<WebhookHealthTone, { background: string; color: string }> = {
  paused:     { background: "var(--surface-2)",       color: "var(--ink-muted)"        },
  failing:    { background: "var(--danger-soft)",     color: "var(--danger)"           },
  unverified: { background: "var(--brand-blue-soft)", color: "var(--brand-blue-deep)"  },
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

  // Both of these are read by their absence of protest too: the button label and the
  // badge are driven by server data, so a failed toggle/delete leaves a row that looks
  // exactly like one nobody touched. Each line names the state the subscription is
  // still in, so "paused" can never be confused with "we could not reach the server".
  const rowFailureFor = (sub: IntegrationSubscription): string | null => {
    if (toggle.isError && toggle.variables === sub.id) {
      return writeFailureCopy(
        toggle.error,
        sub.isActive
          ? "Still active — this webhook was not paused. Events are still being sent to this URL."
          : "Still paused — this webhook was not resumed. Events are still not being sent to this URL.",
      );
    }
    if (remove.isError && remove.variables === sub.id) {
      return writeFailureCopy(
        remove.error,
        sub.isActive
          ? "Still here — this webhook was not deleted, and events are still being sent to this URL."
          : "Still here — this webhook was not deleted.",
      );
    }
    return null;
  };

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
              <Plug size={18} color="var(--ink-muted)" strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", margin: 0 }}>API &amp; events</p>
              <p style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.5, margin: "3px 0 0" }}>
                Post orders to your order intake URL and receive real-time events at any URL — works with
                Zapier, Make.com, n8n, or your own backend today. Create a key on the API keys tab, then add a
                webhook below.
              </p>
            </div>
          </div>

          {/* Native apps — coming soon, no dead links */}
          <div className="connector-row" style={{ ...connectorRow, background: "var(--surface-2)" }}>
            <div style={connectorTile}>
              <Zap size={18} color="var(--ink-faint)" strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-muted)", margin: 0 }}>
                Native Zapier &amp; Make.com apps
              </p>
              <p style={{ fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.5, margin: "3px 0 0" }}>
                One-click published apps are coming soon. In the meantime, point a Zapier/Make webhook step at a
                subscription below.
              </p>
            </div>
            <span
              className="connector-action"
              /* --ink-muted, not --ink-faint: #667085 on --surface-2 (#F1F3F7) is
                 4.4781:1 at 11.5px/600 — a marginal AA fail. #5E6779 is 5.1199:1.
                 --ink-faint stays fine on --bg (4.6439:1); it is the PAIRING with
                 --surface-2 that fails, not the token. */
              style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted)", padding: "6px 10px", borderRadius: 999, background: "var(--surface-2)", whiteSpace: "nowrap" }}
            >
              Coming soon
            </span>
          </div>
        </div>

        {/* Webhook subscriptions */}
        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ flexWrap: "wrap", marginBottom: 14, paddingTop: 4, borderTop: "1px solid var(--border)" }}
        >
          <div style={{ paddingTop: 14, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", margin: 0 }}>Where we send events</p>
            <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: 3 }}>
              Receive ProcuLink events at any URL — Zapier, Make.com, or custom.
            </p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="w-full sm:w-auto"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            <Plus size={14} /> Add webhook
          </button>
        </div>

        {showForm && (
          <Card pad={16} radius={8} style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 14 }}>New webhook subscription</p>

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
                  {Object.entries(EVENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{value} — {label}</option>
                  ))}
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
                style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: !targetUrl.startsWith("http") || create.isPending ? "#CBD5E1" : "var(--brand-green-btn)", color: "var(--surface)", fontSize: 13, fontWeight: 600, cursor: !targetUrl.startsWith("http") || create.isPending ? "not-allowed" : "pointer" }}
              >
                {create.isPending ? "Saving…" : "Save webhook"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
            {create.isError && (
              <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>
                {(create.error as Error).message || "Failed to save webhook."}
              </p>
            )}
          </Card>
        )}

        {/* Error state — was missing before */}
        {isError && (
          <div style={{ borderRadius: 8, padding: "14px 16px", border: "1px solid var(--danger-soft)", borderLeft: "3px solid var(--danger)", background: "var(--surface)", marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>Webhooks unavailable</p>
            <p style={{ fontSize: 12.5, color: "var(--ink-muted)", margin: 0 }}>
              Could not load webhook subscriptions. Your existing subscriptions are unaffected.
            </p>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              style={{ marginTop: 10, height: 30, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: isFetching ? "not-allowed" : "pointer" }}
            >
              {isFetching ? "Checking..." : "Retry"}
            </button>
          </div>
        )}

        {isLoading && <p style={{ fontSize: 13, color: "var(--ink-faint)" }}>Loading webhooks…</p>}

        {!isLoading && !isError && subs.length === 0 && !showForm && (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "36px 20px", textAlign: "center" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-muted)" }}>No webhooks yet</p>
            <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4, maxWidth: 420, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
              Add a webhook to receive real-time order events at any URL — your own backend, or a Zapier/Make.com
              webhook step.
            </p>
            <Button variant="primary" size="lg" className="mt-3.5" onClick={() => setShowForm(true)}>
              <Plus size={14} strokeWidth={2} />
              Add webhook
            </Button>
          </div>
        )}

        <div data-testid="webhook-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subs.map(sub => {
          const health = webhookHealth(sub);
          return (
            <Card
              key={sub.id}
              pad="13px 16px"
              radius={10}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "var(--surface-2)", color: "var(--ink-muted)" }}>
                    {PLATFORM_LABELS[sub.platform] ?? sub.platform}
                  </span>
                  <code style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", color: "var(--brand-green-deep)" }}>
                    {sub.eventType}
                  </code>
                  {/* ONE badge, always present. The old three-way ternary had a `null` arm for
                      `isActive && failureCount > 0`, so a failing subscription — the state most
                      worth naming — showed no badge at all. */}
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, ...WEBHOOK_TONE_STYLE[health.tone] }}>
                    {health.badge}
                  </span>
                </div>
                {EVENT_LABELS[sub.eventType] ? (
                  <p style={{ fontSize: 12.5, color: "var(--ink)", margin: "0 0 3px" }}>
                    {EVENT_LABELS[sub.eventType]}
                  </p>
                ) : null}
                <p style={{ fontSize: 11.5, color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }} title={sub.targetUrl}>
                  {sub.targetUrl}
                </p>
                {/* What is actually known about this URL. `failureCount === 0` is a streak of
                    zero, not a delivery — so on that arm this line says so out loud rather than
                    letting the badge imply events are arriving. */}
                <p style={{ fontSize: 11.5, lineHeight: 1.45, margin: "4px 0 0", color: WEBHOOK_TONE_STYLE[health.tone].color }}>
                  {health.text}
                </p>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
                <button
                  onClick={() => toggle.mutate(sub.id)}
                  style={{ minHeight: "var(--tap-min)", height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--ink-muted)", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
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
                      style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "var(--ink-faint)" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                />
              </div>
              </div>
              {rowFailureFor(sub) && <WriteFailure>{rowFailureFor(sub)}</WriteFailure>}
            </Card>
          );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}
