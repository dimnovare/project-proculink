"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  getBillingStatus,
  getSftpSettings,
  updateSftpSettings,
  getS3Settings,
  updateS3Settings,
} from "@/lib/api-client";
import { SettingsGroup } from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/bridge/DSPrimitives";
import { isPlanGateError, planGateMessage } from "@/lib/planGate";
import { PLAN_BY_ID, planName } from "@/lib/plans";
import { minimumPlanId, type GatedCapability } from "@/lib/gatedCapabilities";
import type { BillingStatus } from "@/types/procurement";

const INK = "var(--ink)";
const MUTED = "var(--ink-muted)";
const FAINT = "var(--ink-faint)";
const DANGER = "var(--danger)";

const PLAN_HINT = "Available on any paid plan. Secrets are encrypted and never shown again.";

const inputStyle: React.CSSProperties = {
  height: 36,
  width: "100%",
  border: `1px solid var(--border-strong)`,
  borderRadius: 6,
  padding: "0 10px",
  fontSize: 13,
  color: INK,
};

// Maps the backend's machine error codes (and any other failure) to a plain
// sentence so customers never see a raw `sftp_ingestion_requires_*` token.
function humanizeError(message: string): string {
  const code = message.trim().toLowerCase();
  // Shape-matched, so the sentence names whichever plan the backend derived rather than
  // asserting a tier of our own — the substring check this replaces would have kept
  // matching but the copy would have been guessing.
  if (isPlanGateError(code)) {
    return `Automated pull ingestion is not available on your plan. ${planGateMessage(code)}`;
  }
  if (code.includes("default supplier")) {
    return "Choose a default supplier before enabling this source.";
  }
  if (/host is required/i.test(message)) return "Enter the SFTP host before saving.";
  if (/username is required/i.test(message)) return "Enter a username before saving.";
  if (/bucket/i.test(message) && /required/i.test(message)) return "Enter a bucket name before saving.";
  if (/access key/i.test(message) && /required/i.test(message)) return "Enter the access key ID before saving.";
  // Everything else gets a sentence, not the raw message.
  //
  // This arm used to `return message`, and the message on this path is almost never
  // something a person wrote. `updateSftpSettings` / `updateS3Settings` throw
  // `readRefusal(res, "settings/sftp: <status>")` (src/lib/api/settings.ts:175, :192), whose
  // fallback is a label the CLIENT built with an HTTP number appended — so a 500 showed the
  // customer `settings/sftp: 500`. When the body DOES carry an `error` field it is a machine
  // token (`sftp_ingestion_requires_growth`), which the plan-gate branch above already claims.
  // Nothing left over is prose, so passing it through is a guess about a string that is never
  // a sentence.
  return "Could not save these settings. Please try again, or contact support if it keeps happening.";
}

// Small, quiet "Need help?" link to the matching /help article. Opens in a new
// tab (the help centre is a marketing route). Muted to match the plan hint text.
function HelpLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px]"
      style={{ color: MUTED, textDecoration: "underline", textUnderlineOffset: 2 }}
    >
      Need help? See the {label} →
    </Link>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>
        {label}
        {required && <span style={{ color: DANGER, marginLeft: 3 }} aria-hidden>*</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      className="flex items-center gap-2 text-[13px] font-medium"
      style={{ color: disabled ? FAINT : INK, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: () => apiClient.getSuppliers(), retry: false });
}

function useBilling() {
  return useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000, retry: false });
}

// Default supplier picker. When the org has no suppliers it dead-ends a new
// org (backend rejects enable with "Default supplier is required."), so we
// surface a "no suppliers yet" empty state linking to the suppliers page.
function SupplierSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { data: suppliers, isLoading } = useSuppliers();
  const list = suppliers ?? [];

  if (!isLoading && list.length === 0) {
    return (
      <Field label="Default supplier" required>
        <div
          className="rounded-[6px] px-3 py-2.5 text-[12.5px]"
          style={{ border: `1px dashed var(--border-strong)`, background: "#F8FAFC", color: MUTED, lineHeight: 1.5 }}
        >
          No suppliers yet — orders need a supplier to attribute to.{" "}
          <Link href="/library/suppliers" style={{ color: "var(--brand-green-deep, #1B6E2A)", fontWeight: 600 }}>
            Add a supplier first →
          </Link>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Default supplier" required>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...inputStyle, background: "#FFF" }}
      >
        <option value="">Select a supplier…</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>
        Orders from this source are attributed to this supplier.
      </span>
    </Field>
  );
}

// Use the canonical Settings card framing (same SettingsGroup shell +
// CSS-variable surface/border/shadow as Email, Organization, API keys, etc.)
// so the SFTP/S3 panels are visually consistent with the rest of Settings.
function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SettingsGroup title={title} sub={subtitle}>
      <div className="grid gap-4">{children}</div>
    </SettingsGroup>
  );
}

function Notice({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  const ok = msg.kind === "ok";
  return (
    <div
      role="status"
      className="rounded-[6px] px-3 py-2 text-[12.5px]"
      style={{
        background: ok ? "var(--brand-green-soft)" : "var(--danger-soft)",
        border: `1px solid ${ok ? "var(--brand-green)" : "var(--danger)"}`,
        color: ok ? "var(--brand-green-deep)" : DANGER,
      }}
    >
      {msg.text}
    </div>
  );
}

/**
 * Amber upgrade notice mirroring the Email section's proactive gate — and, now, its TWO ARMS.
 *
 * `canEnable` was `!!billing && billing.plan !== "pilot"`, and this notice rendered whenever it
 * was false. But that expression is false for two different reasons and only one of them is a
 * plan: `useBilling()` is `retry: false`, so a single failed `GET /api/billing/status` leaves
 * `billing` undefined for the rest of the page's life. A Distributor workspace whose billing
 * lookup blipped was told, as flat fact, that its "current plan doesn't include it" — about a
 * channel it pays €1,499/month for — and had the toggle taken away as well.
 *
 * The identical repair already shipped one tab over, on Email
 * (src/app/(app)/settings/page.tsx:782-811). A plan is named here only when the server named one.
 *
 * `render` is gated on `!billingLoading` by the caller: during the first fetch we do not yet know
 * which of the two sentences is true, and neither is worth flashing.
 */
function UpgradeNotice({
  label,
  capability,
  billing,
}: {
  label: string;
  capability: GatedCapability;
  billing: BillingStatus | undefined;
}) {
  const unlock = PLAN_BY_ID[minimumPlanId(capability)];
  return (
    <div
      data-testid={`pull-ingress-plan-gate-${capability}`}
      className="rounded-[8px] px-3.5 py-3 text-[12.5px]"
      style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B", lineHeight: 1.5 }}
    >
      {billing ? (
        <>
          {label} ingestion is included on every paid plan. You can set it up here, but turning on
          polling needs a paid plan — the {planName(billing.plan)} plan doesn&rsquo;t include it.{" "}
          <Link href="/settings?tab=billing" style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>
            Upgrade to {unlock.name} ({unlock.billingPriceLabel})
          </Link>{" "}
          to switch it on.
        </>
      ) : (
        <>
          {label} ingestion is included on every paid plan. We couldn&rsquo;t check which plan this
          workspace is on just now, so if it isn&rsquo;t on a paid plan, turning polling on will be
          refused.{" "}
          <Link href="/settings?tab=billing" style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>
            Open plan &amp; billing
          </Link>{" "}
          to check yours.
        </>
      )}
    </div>
  );
}

function SaveBar({
  onSave,
  saving,
  hint,
}: {
  onSave: () => void;
  saving: boolean;
  hint: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderTop: "1px solid var(--border)", marginTop: 2 }}
    >
      <span className="text-[11px]" style={{ color: FAINT }}>{hint}</span>
      {/* Shared brand-green Save button (matches Organization / Email "Save"). */}
      <Button variant="primary" size="lg" onClick={onSave} disabled={saving}>
        <Save size={14} strokeWidth={2} />
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

// Shared loading skeleton for the SFTP/S3 GET.
function LoadingShell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Shell title={title} subtitle={subtitle}>
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">Loading…</span>
        <div style={{ height: 16, width: 170, borderRadius: 4, background: "var(--border)" }} />
        <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
          <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
        </div>
        <div style={{ height: 36, borderRadius: 6, background: "var(--surface-2)" }} />
      </div>
    </Shell>
  );
}

// Shared API-unavailable panel for the SFTP/S3 GET.
function ErrorShell({
  title,
  onRetry,
  retrying,
}: {
  title: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  // Matches the canonical Email / API-keys "unavailable" panel (radius 12,
  // left danger rule, card shadow) so error states are consistent too.
  return (
    <div
      style={{ borderRadius: 12, background: "var(--surface)", padding: "20px 22px", border: "1px solid #F0D2D2", borderLeft: "3px solid var(--danger)", boxShadow: "var(--shadow-card)" }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 600, color: INK, margin: "0 0 4px" }}>{title} settings are unavailable</h2>
      <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>
        The UI is working, but the API did not answer the settings request. Your saved configuration is unaffected.
      </p>
      <button
        onClick={onRetry}
        disabled={retrying}
        style={{ marginTop: 14, height: 32, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: INK, fontSize: 12, fontWeight: 600, padding: "0 12px", cursor: retrying ? "not-allowed" : "pointer" }}
      >
        {retrying ? "Checking…" : "Retry connection"}
      </button>
    </div>
  );
}

// ── SFTP pull ─────────────────────────────────────────────────────────────────

export function SftpPullSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sftp-settings"],
    queryFn: getSftpSettings,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: billing, isLoading: billingLoading } = useBilling();
  const { data: suppliers, isLoading: suppliersLoading } = useSuppliers();

  // Pilot is the only tier without pull ingestion (decoupled to all paid plans).
  const canEnable = !!billing && billing.plan !== "pilot";
  // Only the SERVER may take the toggle away. `!canEnable` also covers "we never found out",
  // and disabling on that would stop a paying workspace configuring a channel it bought
  // because one status request failed — the same undefined that produced the wrong sentence.
  // When the plan is unknown the attempt is allowed and the backend decides; its plan-gate
  // refusal comes back through humanizeError with the tier the server derived.
  const planBlocks = !!billing && !canEnable;
  // Block enabling only once we know the org genuinely has zero suppliers
  // (not while the list is still loading, to avoid disabling a working toggle).
  const noSuppliers = !suppliersLoading && (suppliers ?? []).length === 0;

  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteDirectory, setRemoteDirectory] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled); setHost(data.host); setPort(data.port);
    setUsername(data.username); setRemoteDirectory(data.remoteDirectory);
    setDefaultSupplierId(data.defaultSupplierId);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateSftpSettings({
      enabled, host, port, username,
      password: password ? password : null, // blank → keep saved secret
      remoteDirectory, defaultSupplierId,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sftp-settings"] });
      setPassword("");
      setNotice({ kind: "ok", text: "SFTP pull settings saved." });
    },
    onError: (e: Error) => setNotice({ kind: "err", text: humanizeError(e.message) }),
  });

  function handleSave() {
    setNotice(null);
    // Client-side validation mirroring the backend so users get an inline
    // message instead of a 400 round-trip.
    if (enabled) {
      if (!host.trim()) { setNotice({ kind: "err", text: "Enter the SFTP host before enabling." }); return; }
      if (!username.trim()) { setNotice({ kind: "err", text: "Enter a username before enabling." }); return; }
      if (!defaultSupplierId) { setNotice({ kind: "err", text: "Choose a default supplier before enabling." }); return; }
    }
    save.mutate();
  }

  const title = "SFTP pull";
  const subtitle = "Poll a supplier/buyer SFTP folder for order files every few minutes and import them automatically.";

  if (isLoading) return <LoadingShell title={title} subtitle={subtitle} />;
  if (isError) return <ErrorShell title={title} onRetry={() => refetch()} retrying={isFetching} />;

  return (
    <Shell title={title} subtitle={subtitle}>
      {!canEnable && !billingLoading && (
        <UpgradeNotice label="SFTP" capability="sftpIngestion" billing={billing} />
      )}
      <Toggle
        checked={enabled}
        disabled={(planBlocks && !enabled) || (noSuppliers && !enabled)}
        onChange={setEnabled}
        label="Poll this SFTP folder for orders"
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Host" required><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="sftp.supplier.example" style={inputStyle} /></Field>
        <Field label="Port"><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 22)} style={inputStyle} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" required><input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={data?.hasPassword ? "•••••••• (leave blank to keep)" : "Password"} style={inputStyle} /></Field>
      </div>
      <Field label="Remote directory"><input value={remoteDirectory} onChange={(e) => setRemoteDirectory(e.target.value)} placeholder="/incoming/orders" style={inputStyle} /></Field>
      <SupplierSelect value={defaultSupplierId} onChange={setDefaultSupplierId} />
      <HelpLink href="/help/sftp-polling-setup" label="SFTP polling guide" />
      <Notice msg={notice} />
      <SaveBar onSave={handleSave} saving={save.isPending} hint={PLAN_HINT} />
    </Shell>
  );
}

// ── S3 / R2 pull ──────────────────────────────────────────────────────────────

export function S3PullSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["s3-settings"],
    queryFn: getS3Settings,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: billing, isLoading: billingLoading } = useBilling();
  const { data: suppliers, isLoading: suppliersLoading } = useSuppliers();

  // Same two-arm rule as SFTP above — see UpgradeNotice's header for why `!canEnable`
  // is not on its own a statement about anybody's plan.
  const canEnable = !!billing && billing.plan !== "pilot";
  const planBlocks = !!billing && !canEnable;
  const noSuppliers = !suppliersLoading && (suppliers ?? []).length === 0;

  const [enabled, setEnabled] = useState(false);
  const [bucketName, setBucketName] = useState("");
  const [keyPrefix, setKeyPrefix] = useState("");
  const [region, setRegion] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled); setBucketName(data.bucketName); setKeyPrefix(data.keyPrefix);
    setRegion(data.region); setServiceUrl(data.serviceUrl ?? ""); setAccessKeyId(data.accessKeyId);
    setDefaultSupplierId(data.defaultSupplierId);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateS3Settings({
      enabled, bucketName, keyPrefix, region, accessKeyId,
      secretKey: secretKey ? secretKey : null,
      serviceUrl: serviceUrl ? serviceUrl : null,
      defaultSupplierId,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["s3-settings"] });
      setSecretKey("");
      setNotice({ kind: "ok", text: "S3/R2 pull settings saved." });
    },
    onError: (e: Error) => setNotice({ kind: "err", text: humanizeError(e.message) }),
  });

  function handleSave() {
    setNotice(null);
    if (enabled) {
      if (!bucketName.trim()) { setNotice({ kind: "err", text: "Enter a bucket name before enabling." }); return; }
      if (!accessKeyId.trim()) { setNotice({ kind: "err", text: "Enter the access key ID before enabling." }); return; }
      if (!defaultSupplierId) { setNotice({ kind: "err", text: "Choose a default supplier before enabling." }); return; }
    }
    save.mutate();
  }

  const title = "S3 / R2 pull";
  const subtitle = "Watch an S3 or Cloudflare R2 bucket prefix for order files and import new objects automatically.";

  if (isLoading) return <LoadingShell title={title} subtitle={subtitle} />;
  if (isError) return <ErrorShell title={title} onRetry={() => refetch()} retrying={isFetching} />;

  return (
    <Shell title={title} subtitle={subtitle}>
      {!canEnable && !billingLoading && (
        <UpgradeNotice label="S3 / R2" capability="s3Ingestion" billing={billing} />
      )}
      <Toggle
        checked={enabled}
        disabled={(planBlocks && !enabled) || (noSuppliers && !enabled)}
        onChange={setEnabled}
        label="Watch this bucket for orders"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bucket name" required><input value={bucketName} onChange={(e) => setBucketName(e.target.value)} placeholder="orders-inbound" style={inputStyle} /></Field>
        <Field label="Key prefix (optional)"><input value={keyPrefix} onChange={(e) => setKeyPrefix(e.target.value)} placeholder="incoming/" style={inputStyle} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Region (use 'auto' for R2)"><input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eu-west-1" style={inputStyle} /></Field>
        <Field label="Access key ID" required><input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Endpoint URL (required for Cloudflare R2 / MinIO — leave blank for AWS S3)"><input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://<account-id>.r2.cloudflarestorage.com" style={inputStyle} /></Field>
      <Field label="Secret access key"><input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={data?.hasSecretKey ? "•••••••• (leave blank to keep)" : "Secret access key"} style={inputStyle} /></Field>
      <SupplierSelect value={defaultSupplierId} onChange={setDefaultSupplierId} />
      <HelpLink href="/help/s3-polling-setup" label="S3 polling guide" />
      <Notice msg={notice} />
      <SaveBar onSave={handleSave} saving={save.isPending} hint={PLAN_HINT} />
    </Shell>
  );
}
