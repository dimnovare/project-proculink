"use client";

// Owner / platform-admin area (/admin).
//
// SECURITY: this page is UX only. The real gate is the backend — every
// /api/admin endpoint returns 401 (signed out) or 403 (not on the server-side
// admin allowlist). We surface those as a clean "no access" view via
// AdminAccessError. The middleware additionally redirects signed-out users to
// /sign-in before they ever reach this client component. The admin allowlist is
// never sent to the browser, so showing the nav link leaks nothing.
//
// Sections:
//   1. Overview headline cards — MRR / ARR / account-status counts / new orgs /
//      trial→paid %, with an honest DB-vs-Stripe MRR reconcile note.
//   2. Customers table (sortable; mobile → stacked cards) with a Stripe link.
//   3. "Create invoice" modal (org picker + line items → POST /api/admin/invoices).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAdminOverview,
  getAdminOrganisations,
  AdminAccessError,
  type AdminOverview,
  type AdminOrganisation,
} from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { CreateInvoiceModal } from "./CreateInvoiceModal";
import { AdjustLimitsModal } from "./AdjustLimitsModal";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";

// Stripe is currently in TEST mode — links go to the /test/ dashboard.
// TODO: drop "/test" once the account is switched to live mode at go-live.
const STRIPE_CUSTOMER_BASE = "https://dashboard.stripe.com/test/customers/";

// ── Formatting ──────────────────────────────────────────────────────────────
function eur(n: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}
function eurCents(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IE", { year: "numeric", month: "short", day: "numeric" });
}

// ── Account-status presentation ──────────────────────────────────────────────
// These are org/plan statuses (NOT order lifecycle) — keep local badge, tokenize colors.
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  trialing:      { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", label: "Trialing" },
  active:        { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)", label: "Active" },
  trial_expired: { bg: "var(--amber-soft)", fg: "var(--amber)", label: "Trial expired" },
  past_due:      { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Past due" },
  read_only:     { bg: "var(--surface-2)", fg: "var(--ink-muted)", label: "Read-only" },
  cancelled:     { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Cancelled" },
};
function orgStatusLabel(raw: string): string {
  return STATUS_STYLE[raw]?.label ?? raw.replace(/_/g, " ");
}
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: "var(--surface-2)", fg: "var(--ink-muted)", label: orgStatusLabel(status) };
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.03em]"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
function PlanBadge({ plan }: { plan: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.03em]"
      style={{ background: "var(--surface-2)", color: "var(--ink)" }}
    >
      {plan}
    </span>
  );
}

// ── Sorting ──────────────────────────────────────────────────────────────────
type SortKey = "name" | "plan" | "accountStatus" | "mrrContribution" | "createdAt" | "lastOrderActivity";
type SortDir = "asc" | "desc";

function sortOrgs(rows: AdminOrganisation[], key: SortKey, dir: SortDir): AdminOrganisation[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "mrrContribution":
        cmp = a.mrrContribution - b.mrrContribution;
        break;
      case "createdAt":
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "lastOrderActivity": {
        const at = a.lastOrderActivity ? new Date(a.lastOrderActivity).getTime() : 0;
        const bt = b.lastOrderActivity ? new Date(b.lastOrderActivity).getTime() : 0;
        cmp = at - bt;
        break;
      }
      default:
        cmp = String(a[key]).localeCompare(String(b[key]));
    }
    return cmp * mult;
  });
}

export default function AdminPage() {
  const queryEnabled = useQueriesEnabled();

  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceOrgId, setInvoiceOrgId] = useState<string | null>(null);
  const [limitsOrg, setLimitsOrg] = useState<AdminOrganisation | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("mrrContribution");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const overviewQ = useQuery<AdminOverview>({
    queryKey: ["admin-overview"],
    queryFn: getAdminOverview,
    enabled: queryEnabled,
    retry: (count, err) => !(err instanceof AdminAccessError) && count < 1,
    staleTime: 30_000,
  });

  const orgsQ = useQuery<AdminOrganisation[]>({
    queryKey: ["admin-organisations"],
    queryFn: getAdminOrganisations,
    enabled: queryEnabled,
    retry: (count, err) => !(err instanceof AdminAccessError) && count < 1,
    staleTime: 30_000,
  });

  const accessError =
    (overviewQ.error instanceof AdminAccessError && overviewQ.error) ||
    (orgsQ.error instanceof AdminAccessError && orgsQ.error) ||
    null;

  const sortedOrgs = useMemo(
    () => sortOrgs(orgsQ.data ?? [], sortKey, sortDir),
    [orgsQ.data, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Money/dates default to descending (most recent / highest first); text ascending.
      setSortDir(key === "name" || key === "plan" || key === "accountStatus" ? "asc" : "desc");
    }
  }

  // ── Access gate ─────────────────────────────────────────────────────────────
  if (accessError) {
    return (
      <PageShell variant="wide">
        <PageHeader title="Admin" sub="Revenue, customer health, and manual invoicing for the platform owner." />
        <div
          className="mx-auto mt-6 max-w-[480px] rounded-[14px] px-6 py-8 text-center"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--surface-2)" }}
          >
            <span style={{ fontSize: 22 }}>🔒</span>
          </div>
          <h2 className="text-[18px] font-semibold" style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}>
            {accessError.status === 401 ? "Please sign in" : "You don't have access to the admin area."}
          </h2>
          <p className="mx-auto mt-2 max-w-[360px] text-[13px]" style={{ color: "var(--ink-muted)" }}>
            {accessError.status === 401
              ? "Your session expired. Sign in again to continue."
              : "The admin area is restricted to platform owners. If you believe this is a mistake, contact the team."}
          </p>
          <Link
            href={accessError.status === 401 ? "/sign-in" : "/bridge"}
            className="mt-5 inline-flex items-center rounded-[8px] px-4 py-2 text-[13px] font-semibold"
            style={{ background: "var(--brand-blue)", color: "white", textDecoration: "none" }}
          >
            {accessError.status === 401 ? "Go to sign-in" : "Back to dashboard"}
          </Link>
        </div>
      </PageShell>
    );
  }

  // ── Loading gate ────────────────────────────────────────────────────────────
  if (!queryEnabled || overviewQ.isLoading) {
    return (
      <PageShell variant="wide">
        <PageHeader title="Admin" sub="Revenue, customer health, and manual invoicing for the platform owner." />
        <div style={{ color: "var(--ink-muted)", fontSize: 14 }}>Loading admin overview…</div>
      </PageShell>
    );
  }

  // ── Non-access error gate ───────────────────────────────────────────────────
  if (overviewQ.isError || overviewQ.data === undefined) {
    return (
      <PageShell variant="wide">
        <PageHeader title="Admin" sub="Revenue, customer health, and manual invoicing for the platform owner." />
        <div
          className="rounded-[12px] px-5 py-4 text-[14px]"
          style={{ background: "var(--surface)", border: "1px solid var(--danger-soft)", color: "var(--danger)" }}
        >
          Could not load the admin overview. The API may be unavailable — retry shortly.
        </div>
      </PageShell>
    );
  }

  const o = overviewQ.data;
  const counts = o.countsByAccountStatus ?? {};
  const orgsForModal = orgsQ.data ?? [];

  // Reconcile note: stripeMrr null → unavailable; present & differs → highlight mismatch.
  const reconcile =
    o.stripeMrr == null
      ? { tone: "muted" as const, text: "Stripe reconcile unavailable" }
      : o.reconciled
        ? { tone: "ok" as const, text: `Reconciled with Stripe (${eur(o.stripeMrr)})` }
        : { tone: "warn" as const, text: `DB ${eur(o.mrr)} vs Stripe ${eur(o.stripeMrr)} — mismatch` };

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Admin"
        sub="Revenue, customer health, and manual invoicing for the platform owner."
        actions={
          <Button
            variant="blue"
            size="md"
            onClick={() => {
              setInvoiceOrgId(null);
              setShowInvoice(true);
            }}
            disabled={orgsForModal.length === 0}
          >
            + Create invoice
          </Button>
        }
      />

      {/* ── Overview cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="MRR" value={eur(o.mrr)} sub={reconcile.text} subTone={reconcile.tone} />
        <MetricCard label="ARR" value={eur(o.arr)} sub="mrr × 12" />
        <MetricCard label="Active" value={String(counts.active ?? 0)} sub="paying orgs" />
        <MetricCard
          label="Trialing"
          value={String(counts.trialing ?? 0)}
          sub={`${counts.past_due ?? 0} past due · ${counts.cancelled ?? 0} cancelled`}
        />
        <MetricCard label="Trial expired" value={String(counts.trial_expired ?? 0)} sub="read-only soon" />
        <MetricCard label="Read-only" value={String(counts.read_only ?? 0)} sub="expired trials" />
        <MetricCard label="New orgs (mo)" value={String(o.newOrgsThisMonth)} sub="this month" />
        <MetricCard label="Trial → paid" value={pct(o.trialToPaidConversion)} sub="conversion" />
      </div>

      {/* ── Customers ───────────────────────────────────────────────────────── */}
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            className="text-[18px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)", margin: 0 }}
          >
            Customers
          </h2>
          <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
            {orgsQ.isLoading ? "Loading…" : `${(orgsQ.data ?? []).length} orgs`}
          </span>
        </div>

        {orgsQ.isError && !(orgsQ.error instanceof AdminAccessError) ? (
          <div
            className="rounded-[12px] px-5 py-4 text-[13.5px]"
            style={{ background: "var(--surface)", border: "1px solid var(--danger-soft)", color: "var(--danger)" }}
          >
            Could not load organisations.
          </div>
        ) : (orgsQ.data ?? []).length === 0 ? (
          <div
            className="rounded-[12px] px-5 py-6 text-[13.5px]"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-muted)" }}
          >
            No organisations yet.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div
              className="hidden md:block"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}
            >
              <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg)", color: "var(--ink-muted)", textAlign: "left" }}>
                    <SortableTh label="Organisation" col="name" {...{ sortKey, sortDir, toggleSort }} />
                    <SortableTh label="Plan" col="plan" {...{ sortKey, sortDir, toggleSort }} />
                    <SortableTh label="Status" col="accountStatus" {...{ sortKey, sortDir, toggleSort }} />
                    <SortableTh label="MRR" col="mrrContribution" align="right" {...{ sortKey, sortDir, toggleSort }} />
                    <th style={{ ...th, textAlign: "right" }}>30d orders</th>
                    <th style={{ ...th, textAlign: "right" }}>Suppliers</th>
                    <SortableTh label="Created" col="createdAt" {...{ sortKey, sortDir, toggleSort }} />
                    <SortableTh label="Last activity" col="lastOrderActivity" {...{ sortKey, sortDir, toggleSort }} />
                    <th style={{ ...th, textAlign: "right" }}>Stripe</th>
                    <th style={{ ...th, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrgs.map((org) => (
                    <tr key={org.id} style={{ borderTop: "1px solid var(--surface-2)" }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{org.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{org.slug}</div>
                      </td>
                      <td style={td}><PlanBadge plan={org.plan} /></td>
                      <td style={td}><StatusBadge status={org.accountStatus} /></td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {eurCents(org.mrrContribution)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-muted)" }}>
                        {org.orderVolume30d}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-muted)" }}>
                        {org.supplierCount}
                      </td>
                      <td style={{ ...td, color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{shortDate(org.createdAt)}</td>
                      <td style={{ ...td, color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{relativeTime(org.lastOrderActivity)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {org.stripeCustomerId ? (
                          <a
                            href={`${STRIPE_CUSTOMER_BASE}${org.stripeCustomerId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--brand-blue-deep)", fontWeight: 600, textDecoration: "none" }}
                          >
                            View ↗
                          </a>
                        ) : (
                          <span style={{ color: "var(--ink-faint)" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button variant="secondary" size="sm" onClick={() => setLimitsOrg(org)}>
                          Adjust limits
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards — MobileListRow */}
            <div className="md:hidden flex flex-col gap-3">
              {sortedOrgs.map((org) => (
                <MobileListRow key={org.id}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{org.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{org.slug}</div>
                    </div>
                    <StatusBadge status={org.accountStatus} />
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12.5, color: "var(--ink-muted)" }}>
                    <span><PlanBadge plan={org.plan} /></span>
                    <span><strong style={{ color: "var(--ink)" }}>{eurCents(org.mrrContribution)}</strong> MRR</span>
                    <span>{org.orderVolume30d} orders/30d</span>
                    <span>{org.supplierCount} suppliers</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                    Created {shortDate(org.createdAt)} · last activity {relativeTime(org.lastOrderActivity)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                    <Button variant="secondary" size="sm" onClick={() => setLimitsOrg(org)}>
                      Adjust limits / extend pilot
                    </Button>
                    {org.stripeCustomerId && (
                      <a
                        href={`${STRIPE_CUSTOMER_BASE}${org.stripeCustomerId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--brand-blue-deep)", fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}
                      >
                        View in Stripe ↗
                      </a>
                    )}
                  </div>
                </MobileListRow>
              ))}
            </div>
          </>
        )}
      </section>

      {showInvoice && (
        <CreateInvoiceModal
          organisations={orgsForModal}
          defaultOrganisationId={invoiceOrgId}
          onClose={() => setShowInvoice(false)}
        />
      )}

      {limitsOrg && (
        <AdjustLimitsModal
          org={limitsOrg}
          onClose={() => setLimitsOrg(null)}
          onSaved={() => orgsQ.refetch()}
        />
      )}
    </PageShell>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, subTone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "muted" | "ok" | "warn";
}) {
  const subColor =
    subTone === "ok" ? "var(--brand-green-deep)" :
    subTone === "warn" ? "var(--danger)" :
    "var(--ink-faint)";
  return (
    <Card dense>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-faint)" }}>
        {label}
      </div>
      <div className="mt-1 text-[24px] font-bold leading-tight" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[11.5px]" style={{ color: subColor }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── Sortable table header cell ────────────────────────────────────────────────
function SortableTh({
  label, col, align = "left", sortKey, sortDir, toggleSort,
}: {
  label: string;
  col: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th style={{ ...th, textAlign: align }}>
      <button
        onClick={() => toggleSort(col)}
        className="inline-flex items-center gap-1"
        style={{
          background: "transparent", border: 0, cursor: "pointer", padding: 0,
          font: "inherit", color: active ? "var(--ink)" : "var(--ink-faint)", textTransform: "uppercase",
          letterSpacing: "0.05em", fontSize: 10.5, fontWeight: 700,
        }}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden style={{ fontSize: 9, opacity: active ? 1 : 0.4 }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

const th: React.CSSProperties = { padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 14px", color: "var(--ink)", verticalAlign: "middle" };
