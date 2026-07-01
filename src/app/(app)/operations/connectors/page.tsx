"use client";

// §5.9 Connectors — icon-card grid matching canonical ConnectorsScreen
import { EmptyState } from "@/components/bridge/EmptyState";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import Link from "next/link";
import { X } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSuppliers, testFireDeliveryConfig, isApiMockMode } from "@/lib/api-client";
import { getConnectorManifest } from "@/lib/api/connectors";
import type { DeliveryProtocol, ConnectorConfigField } from "@/lib/api/types";

// ── Mock fallback (used when USE_MOCK = true) ─────────────────────────────────

// offer<=>works: SAP Ariba and Coupa are not built connectors — mark them
// "coming_soon" so they are never presented as connected or ready to use.
// Generic SFTP and Email (IMAP) are real, implemented channels.
// Erply is a real delivery adapter (erp_erply protocol).
const MOCK_CONNECTORS = [
  { id: "c1", type: "cXML PunchOut", name: "SAP Ariba",             status: "coming_soon", desc: "ERP connector · cXML in/out", docks: 0,  direction: "out" },
  { id: "c2", type: "ERP (REST)",    name: "Coupa",                  status: "coming_soon", desc: "ERP connector · cXML",         docks: 0,  direction: "out" },
  { id: "c3", type: "ERP (REST)",    name: "Microsoft Dynamics 365", status: "coming_soon", desc: "ERP connector · OData",        docks: 0,  direction: "out" },
  { id: "c4", type: "EDI (SFTP)",    name: "Generic SFTP",           status: "connected",   desc: "File delivery",                                    docks: 3,  direction: "out" },
  { id: "c5", type: "Email (IMAP)",  name: "Email (IMAP)",           status: "connected",   desc: "Inbound order polling",                            docks: 1,  direction: "in"  },
  { id: "c6", type: "ERP — Erply",   name: "Erply",                  status: "available",   desc: "Retail ERP",                                       docks: 0,  direction: "out" },
];

type Connector = {
  id: string;
  type: string;
  name: string;
  status: string;       // "connected" | "available" | "ok" | "risk" | "down"
  desc: string;
  docks: number;
  direction: string;
};

// ── Icon SVG paths (Lucide-style, stroke 1.75) — plug icon ───────────────────

function PlugIcon({ size = 19, color = "var(--ink-muted,#56627A)" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22v-5"/>
      <path d="M9 8V2"/>
      <path d="M15 8V2"/>
      <path d="M18 8v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>
    </svg>
  );
}

function PlusIcon({ size = 15, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14"/><path d="M12 5v14"/>
    </svg>
  );
}

// ── Status-to-pill mapping (matches canonical pill-ready / pill-new) ──────────

function isConnected(status: string) {
  return status === "connected" || status === "ok";
}

function ConnectorStatusPill({ status }: { status: string }) {
  const connected = isConnected(status);
  const comingSoon = status === "coming_soon";
  // Canonical design pills (screen-buyers.jsx ConnectorsScreen):
  //   Connected   → .pill-ready  (bg --brand-green-soft #E2F1E2, text --brand-green-deep #1E6D29, dot --brand-green #2E8E3A)
  //   Available   → .pill-new    (bg --surface-2 #EFF2F7,        text --ink-muted #56627A,        dot --ink-faint #5B6980)
  //   Coming soon → inline style (muted amber) — not "connected", not "available to connect"
  if (comingSoon) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 20, padding: "2px 9px", background: "var(--amber-soft,#FFF4D6)", fontSize: 11.5, fontWeight: 600, color: "var(--amber-deep,#7A5700)", whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber,#D4900A)", flexShrink: 0, display: "inline-block" }} />
        Coming soon
      </span>
    );
  }
  return (
    <span className={connected ? "pill pill-ready" : "pill pill-new"}>
      <span className="dot" />
      {connected ? "Connected" : "Available"}
    </span>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonConnectorCard() {
  return (
    <div
      style={{
        background: "var(--surface,#FFFFFF)",
        border: "1px solid var(--border,#E2E6EE)",
        borderRadius: "var(--radius-md,8px)",
        padding: 20,
        animation: "skel-pulse 1.4s ease-in-out infinite",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md,8px)", background: "var(--surface-2,#EFF2F7)" }} />
        <div style={{ width: 72, height: 21, borderRadius: 11, background: "var(--surface-2,#EFF2F7)" }} />
      </div>
      <div style={{ height: 14, width: "60%", borderRadius: 4, background: "var(--surface-2,#EFF2F7)", marginBottom: 6 }} />
      <div style={{ height: 12, width: "80%", borderRadius: 4, background: "var(--surface-2,#EFF2F7)" }} />
    </div>
  );
}

// ── Connector card ────────────────────────────────────────────────────────────

function ConnectorCard({
  connector,
  onManage,
}: {
  connector: Connector;
  onManage: (c: Connector) => void;
}) {
  const connected = isConnected(connector.status);
  const comingSoon = connector.status === "coming_soon";

  return (
    <div
      style={{
        background: "var(--surface,#FFFFFF)",
        border: "1px solid var(--border,#E2E6EE)",
        borderRadius: "var(--radius-md,8px)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top row: icon tile + status pill */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-md,8px)",
            background: "var(--surface-2,#EFF2F7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <PlugIcon size={19} color="var(--ink-muted,#56627A)" />
        </div>
        <ConnectorStatusPill status={connector.status} />
      </div>

      {/* Name + description — canonical: name 14/600, desc muted 12 */}
      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink,#0B1A2F)", lineHeight: 1.3 }}>{connector.name}</div>
      <div style={{ fontSize: 12, color: "var(--ink-muted,#56627A)", marginTop: 3, lineHeight: 1.4 }}>{connector.desc}</div>

      {/* Footer: supplier count + single action (Manage = ghost text, Connect = bordered button) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border,#E2E6EE)",
        }}
      >
        {/* offer⇔works: only show a usage count when it's a REAL number.
            docks === -1 means "unknown" (live mode — the supplier list endpoint
            carries no per-connector usage signal), so we render nothing rather
            than a misleading "Not in use" / "0". A spacer keeps the action
            button right-aligned. */}
        {connector.docks >= 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--ink-faint,#5B6980)" }}>
            {connector.docks > 0 ? `${connector.docks} supplier${connector.docks > 1 ? "s" : ""}` : "Not in use"}
          </span>
        ) : (
          <span />
        )}
        {comingSoon ? (
          /* offer<=>works: connector is not built. Don't present a "Connect"
             button (it would imply it's connectable). Instead give a real,
             honest CTA — a mailto that registers interest and names the
             connector — so the tile isn't a dead end. */
          <a
            href={`mailto:sales@proculink.eu?subject=${encodeURIComponent(
              `Connector request: ${connector.name}`,
            )}&body=${encodeURIComponent(
              `I'd like to be notified when the ${connector.name} connector is available.`,
            )}`}
            className="connector-action"
            style={{
              height: 27,
              padding: "0 10px",
              borderRadius: "var(--radius,6px)",
              border: "1px solid var(--border-strong,#C6CDDA)",
              background: "var(--surface,#FFFFFF)",
              color: "var(--ink-muted,#56627A)",
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Request access
          </a>
        ) : connected ? (
          <button
            className="connector-action btn-ghost"
            onClick={() => onManage(connector)}
            style={{
              height: 27,
              padding: "0 10px",
              borderRadius: "var(--radius,6px)",
              border: "1px solid transparent",
              background: "none",
              color: "var(--ink-muted,#56627A)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Manage
          </button>
        ) : (
          <button
            className="connector-action btn-ghost"
            onClick={() => onManage(connector)}
            /* Opens the READ-ONLY review panel (per-supplier delivery is set up in
               the supplier's Delivery tab), so the verb is "Review", not "Connect"
               — the button never connects anything itself. */
            style={{
              height: 27,
              padding: "0 12px",
              borderRadius: "var(--radius,6px)",
              border: "1px solid var(--border-strong,#C6CDDA)",
              background: "var(--surface,#FFFFFF)",
              color: "var(--ink,#0B1A2F)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Review
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConnectorsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Connector | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Live data from suppliers
  const { data: suppliersRaw, isLoading, isError } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  // Derive connector rows: mock data (isApiMockMode) or real suppliers.
  //
  // offer⇔works: GET /api/suppliers returns ONLY { id, name } — it carries NO
  // delivery-config signal (protocol / hasDeliveryConfig). Delivery config
  // presence is only knowable via a PER-SUPPLIER GET /api/suppliers/{id}/delivery-config,
  // which is too expensive to fan out across a list. So we must NOT claim each
  // supplier is "connected" (the old hardcoded status:"connected" overstated the
  // count: 10 suppliers with 0 configs read "10 connected"). Until the list
  // endpoint exposes a delivery-config field, every live row is the truthful
  // neutral "available" (needs setup), and `docks` (real per-connector usage
  // count) is not derivable, so the "N suppliers / Not in use" footer line is
  // omitted entirely (docks:0 always read a wrong "Not in use").
  const connectors: Connector[] = isApiMockMode
    ? MOCK_CONNECTORS
    : (suppliersRaw ?? []).map((s) => ({
        id: s.id,
        type: "API (REST)",
        name: s.name,
        status: "available",
        desc: "Supplier delivery endpoint",
        docks: -1, // -1 = usage count unknown → hide the footer usage line (live mode)
        direction: "out",
      }));

  // Mock mode reports its hardcoded "connected" rows; live mode has no
  // delivery-config signal in the list payload, so we report 0 rather than a
  // fabricated count. (Becomes a real count once the list endpoint exposes
  // delivery-config presence — see summary follow-up.)
  const connectedCount = isApiMockMode
    ? connectors.filter((c) => isConnected(c.status)).length
    : 0;

  const handleManage = (c: Connector) => {
    setNotice(null);
    setSelected(c);
  };

  return (
    <>
      {/* Responsive grid breakpoints (PageShell owns the page gutter) */}
      <style>{`
        .connectors-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
        @media (max-width: 1100px) { .connectors-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 640px)  { .connectors-grid { grid-template-columns: 1fr; } }

        /* Footer actions: keep the desktop visual height but guarantee a >=40px
           touch target on phones via padding (the visible chrome is unchanged). */
        @media (max-width: 640px) {
          .connector-action { min-height: 40px; display: inline-flex; align-items: center; }
          /* Full-width primary CTA on its own row, comfortable 40px touch height */
          .connectors-addbtn { flex: 1 0 100%; width: 100%; height: 40px; }
        }
        @keyframes skel-pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      `}</style>

      <PageShell variant="wide">
        <PageHeader
          title="Connectors"
          /* offer⇔works: the live suppliers list carries no delivery-config signal,
             so a real "N connected" count is not derivable — it was always 0. Drop
             the misleading suffix in live mode (same honesty reason the per-card
             usage line is hidden); keep it only where a real count exists (mock). */
          sub={isApiMockMode ? `ERP and channel integrations · ${connectedCount} connected` : "ERP and channel integrations"}
          actions={
            <button
              className="connectors-addbtn"
              onClick={() => {
                setNotice(null);
                setSelected({ id: "new", type: "API (REST)", name: "", status: "available", desc: "", docks: 0, direction: "out" });
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                height: 32,
                padding: "0 14px",
                borderRadius: "var(--radius,6px)",
                border: "1px solid transparent",
                // In-app primary CTA = brand-green per the unified design system (in-app primary = green).
                background: "var(--brand-green,#2E8E3A)",
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <PlusIcon size={15} />
              Add connector
            </button>
          }
        />

        {/* Notice */}
        {notice && (
          <div
            style={{
              marginBottom: 16,
              borderRadius: "var(--radius-md,8px)",
              padding: "10px 14px",
              fontSize: 12.5,
              border: "1px solid var(--border,#E2E6EE)",
              borderLeft: "3px solid var(--brand-green,#2E8E3A)",
              background: "var(--brand-green-soft,#E2F1E2)",
              color: "var(--brand-green-deep,#1E6D29)",
            }}
          >
            {notice}
          </div>
        )}

        {/* Error state */}
        {isError && !isApiMockMode && (
          <div
            style={{
              marginBottom: 16,
              borderRadius: "var(--radius-md,8px)",
              padding: "10px 14px",
              fontSize: 12.5,
              border: "1px solid #F5B8B8",
              borderLeft: "3px solid var(--danger,#C53A3A)",
              background: "var(--danger-soft,#FBE3E3)",
              color: "#7B1C1C",
            }}
          >
            Failed to load connectors.{" "}
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["suppliers"] })}
              style={{ textDecoration: "underline", fontWeight: 600, background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading skeleton grid */}
        {isLoading && !isApiMockMode ? (
          <div className="connectors-grid">
            {[1, 2, 3].map((k) => <SkeletonConnectorCard key={k} />)}
          </div>
        ) : connectors.length === 0 ? (
          <EmptyState
            title="No connectors configured"
            sub="Add a connector to start routing purchase orders to suppliers via API, SFTP, email, or ERP."
            action={{ label: "Add connector", onClick: () => setSelected({ id: "new", type: "API (REST)", name: "", status: "available", desc: "", docks: 0, direction: "out" }) }}
          />
        ) : (
          /* Connector card grid */
          <div className="connectors-grid">
            {connectors.map((c) => (
              <ConnectorCard
                key={c.id}
                connector={c}
                onManage={handleManage}
              />
            ))}
          </div>
        )}
      </PageShell>

      {/* Panel */}
      {selected && (
        <ConnectorPanel
          connector={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ── Clerk-ready hook (mirrors ConnectorRequirementsPanel) ─────────────────────

function useClerkReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (isApiMockMode) { setReady(true); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clerk = (window as any).Clerk;
    if (clerk?.loaded) { setReady(true); return; }
    const handle = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Clerk?.loaded) { setReady(true); clearInterval(handle); }
    }, 100);
    return () => clearInterval(handle);
  }, []);
  return ready;
}

/**
 * Derive a DeliveryProtocol manifest key from the connector's free-text `type`
 * string (as stored in MOCK_CONNECTORS and derived from live suppliers).
 *
 * The type strings are internal — this mapping is intentionally conservative:
 * only return a key we are confident about; return null for unknown types so
 * the requirements section is silently omitted (no error shown).
 */
function resolveManifestKey(connector: Connector): DeliveryProtocol | null {
  const t = connector.type.toLowerCase();
  if (t.includes("sftp"))        return "sftp";
  if (t.includes("ftps"))        return "ftps";
  if (t.includes("smtp") || t.includes("email (smtp)")) return "smtp";
  if (t.includes("erply"))       return "erp_erply";
  if (t.includes("directo"))     return "erp_directo";
  // "API (REST)" / "ERP (REST)" / generic HTTP connectors
  if (t.includes("rest") || t.includes("http") || t.includes("api")) return "http";
  return null;
}

// ── ManifestRequirementsSection — read-only, additive, shown in ConnectorPanel ─

/**
 * Fetches and renders the manifest requirements for the given protocol key.
 * Uses the same visual language (Required/Secret/type pills, FieldRow look) as
 * ConnectorRequirementsPanel.  Secret fields are listed by NAME only — values
 * are never exposed.  If the manifest is unavailable or the key is null this
 * section renders nothing (silent degradation).
 *
 * ADDITIVE ONLY — does not affect save, test-fire, or any other behaviour.
 */
function ManifestRequirementsSection({ manifestKey }: { manifestKey: DeliveryProtocol }) {
  const clerkReady = useClerkReady();
  const enabled = isApiMockMode || clerkReady;

  const { data: manifest, isLoading } = useQuery({
    queryKey: ["connector-manifest", manifestKey],
    queryFn: () => getConnectorManifest(manifestKey),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (!enabled || (isLoading && !manifest)) {
    return (
      <div
        style={{
          borderRadius: "var(--radius-md,8px)",
          border: "1px solid var(--border,#E2E6EE)",
          background: "var(--surface-2,#EFF2F7)",
          padding: "10px 14px",
        }}
      >
        <p style={{ fontSize: 11.5, color: "var(--ink-faint,#5B6980)", margin: 0 }}>
          Loading connector requirements…
        </p>
      </div>
    );
  }

  // Silent degradation — no error shown if manifest is unavailable.
  if (!manifest) return null;

  const requiredFields = manifest.fields.filter((f) => f.required);
  const secretOnlyFields = manifest.fields.filter((f) => f.secret && !f.required);
  const optionalFields = manifest.fields.filter((f) => !f.required && !f.secret);

  return (
    <div
      style={{
        borderRadius: "var(--radius-md,8px)",
        border: "1px solid var(--border,#E2E6EE)",
        background: "var(--surface-2,#EFF2F7)",
        padding: "12px 14px",
        display: "grid",
        gap: 10,
      }}
    >
      <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted,#56627A)", margin: 0 }}>
        What this connector needs
        {manifest.authType && (
          <span style={{ fontWeight: 400, marginLeft: 6, color: "var(--ink-faint,#5B6980)" }}>
            · {manifest.authType}
          </span>
        )}
      </p>

      {/* Required fields */}
      {requiredFields.length > 0 && (
        <ManifestFieldGroup title="Required" fields={requiredFields} />
      )}

      {/* Credential-only (secret, not required) fields */}
      {secretOnlyFields.length > 0 && (
        <ManifestFieldGroup title="Credentials (stored encrypted)" fields={secretOnlyFields} />
      )}

      {/* Optional fields */}
      {optionalFields.length > 0 && (
        <ManifestFieldGroup title="Optional" fields={optionalFields} />
      )}

      {manifest.docsRef && (
        <p style={{ fontSize: 11, color: "var(--ink-faint,#5B6980)", margin: 0 }}>
          <a
            href={manifest.docsRef}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand-green-deep,#1E6D29)", textDecoration: "underline" }}
          >
            {manifest.displayName} documentation
          </a>
        </p>
      )}
    </div>
  );
}

function ManifestFieldGroup({
  title,
  fields,
}: {
  title: string;
  fields: ConnectorConfigField[];
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", color: "var(--ink-faint,#5B6980)", margin: 0 }}>
        {title}
      </p>
      {fields.map((field) => (
        <ManifestFieldRow key={field.name} field={field} />
      ))}
    </div>
  );
}

function ManifestFieldRow({ field }: { field: ConnectorConfigField }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: "2px 8px",
        borderRadius: 5,
        padding: "5px 8px",
        background: "var(--surface,#FFFFFF)",
        border: "1px solid var(--border,#E2E6EE)",
      }}
    >
      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "var(--ink,#0B1A2F)" }}>
        {field.name}
      </span>
      <span style={{ fontSize: 11, color: "var(--ink-muted,#56627A)", flex: 1 }}>
        {field.label}
      </span>
      <span style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
        {/* Required chip: #A56B00 on #FFF0E0 was 4.0:1 — below AA for 10px text; deepened amber reads 5.9:1. */}
        {field.required && (
          <span style={{ borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", background: "#FFF0E0", color: "var(--amber-deep,#7A5700)", border: "1px solid #F5DFA0" }}>
            Required
          </span>
        )}
        {field.secret && (
          <span style={{ borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", background: "#EDF2FF", color: "#2E5FAA", border: "1px solid #C7D8F5" }}>
            Secret
          </span>
        )}
        {/* Type chip: #2E8E3A on #F0F7F1 was 3.8:1 — below AA for 10px text; brand-green-deep reads 5.9:1. */}
        {field.type !== "string" && (
          <span style={{ borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 500, background: "#F0F7F1", color: "var(--brand-green-deep,#1E6D29)", border: "1px solid #CBE8CE" }}>
            {field.type}
          </span>
        )}
      </span>
    </div>
  );
}

// ── ConnectorPanel (inline slideover — functionality preserved) ───────────────

function ConnectorPanel({
  connector,
  onClose,
}: {
  connector: Connector;
  onClose: () => void;
}) {
  const isNew = connector.id === "new";
  // Carry an explicit success flag so the banner can style failure as danger,
  // not the hardcoded green that made a failed test-fire read as success. `ok:null`
  // = informational (the "configure per supplier" guidance) → neutral styling.
  const [testResult, setTestResult] = useState<{ ok: boolean | null; message: string } | null>(null);
  const [firing, setFiring] = useState(false);

  // Derive the manifest key from the connector's type string (null = no manifest shown)
  const manifestKey = resolveManifestKey(connector);

  const handleTestFire = async () => {
    if (connector.id === "new") {
      setTestResult({ ok: null, message: "Connectors are set up per supplier — open the supplier's Delivery tab to configure and test-fire delivery." });
      return;
    }
    setFiring(true);
    setTestResult(null);
    try {
      const result = await testFireDeliveryConfig(connector.id);
      setTestResult({ ok: result.success, message: result.success ? result.message : `Failed — ${result.message}` });
    } catch (err) {
      setTestResult({ ok: false, message: `Test fire failed — ${(err as Error).message}` });
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-6"
      style={{ background: "rgba(11,26,47,0.42)", backdropFilter: "blur(3px)" }}>
      <div
        className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] sm:max-w-[540px] sm:rounded-[10px]"
        style={{
          background: "var(--surface,#FFFFFF)",
          border: "1px solid var(--border,#E2E6EE)",
          boxShadow: "0 8px 24px rgba(11,26,47,0.10)",
        }}
      >
        {/* Head */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--border,#E2E6EE)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "var(--radius-md,8px)",
                background: "var(--brand-green-soft,#E2F1E2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <PlugIcon size={16} color="var(--brand-green-deep,#1E6D29)" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.015em", color: "var(--ink,#0B1A2F)" }}>
                {isNew ? "Add connector" : connector.name}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-muted,#56627A)" }}>Connector configuration</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius,6px)",
              background: "none",
              border: "none",
              color: "var(--ink-faint,#5B6980)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "grid", gap: 14 }}>
          {/* Honest guidance: delivery endpoints are configured per supplier, not here. */}
          <div
            style={{
              borderRadius: "var(--radius-md,8px)",
              border: "1px solid var(--border,#E2E6EE)",
              borderLeft: "3px solid var(--brand-blue,#1E66C9)",
              background: "var(--surface-2,#EFF2F7)",
              color: "var(--ink-muted,#56627A)",
              padding: "12px 14px",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Delivery endpoints and credentials are configured per supplier, in the
            supplier&apos;s <strong style={{ color: "var(--ink,#0B1A2F)" }}>Delivery</strong> tab.
            This panel is read-only — use it to review the connector and test-fire delivery.
          </div>

          <PanelField label="Connector type">
            <input
              readOnly
              value={connector.type}
              style={{
                height: 32,
                width: "100%",
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border-strong,#C6CDDA)",
                background: "var(--surface-2,#EFF2F7)",
                fontSize: 12.5,
                color: "var(--ink-muted,#56627A)",
                padding: "0 11px",
              }}
            />
          </PanelField>
          <PanelField label="Name or endpoint">
            <input
              readOnly
              value={connector.name || "—"}
              style={{
                height: 32,
                width: "100%",
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border-strong,#C6CDDA)",
                background: "var(--surface-2,#EFF2F7)",
                fontSize: 12.5,
                color: "var(--ink-muted,#56627A)",
                padding: "0 11px",
              }}
            />
          </PanelField>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <PanelField label="Direction">
              <input
                readOnly
                value={connector.direction === "in" ? "Input to ProcuLink" : "Output to supplier"}
                style={{
                  height: 32,
                  width: "100%",
                  borderRadius: "var(--radius,6px)",
                  border: "1px solid var(--border-strong,#C6CDDA)",
                  background: "var(--surface-2,#EFF2F7)",
                  fontSize: 12.5,
                  color: "var(--ink-muted,#56627A)",
                  padding: "0 11px",
                }}
              />
            </PanelField>
            <PanelField label="Status">
              <input
                readOnly
                value={isNew ? "Draft" : isConnected(connector.status) ? "Connected" : "Available"}
                style={{
                  height: 32,
                  width: "100%",
                  borderRadius: "var(--radius,6px)",
                  border: "1px solid var(--border-strong,#C6CDDA)",
                  background: "var(--surface-2,#EFF2F7)",
                  fontSize: 12.5,
                  color: "var(--ink-muted,#56627A)",
                  padding: "0 11px",
                }}
              />
            </PanelField>
          </div>

          {/* ── Additive: manifest requirements (read-only, no effect on save/test-fire) */}
          {manifestKey && <ManifestRequirementsSection manifestKey={manifestKey} />}

          {testResult && (
            <div
              role="status"
              aria-live="polite"
              style={{
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border,#E2E6EE)",
                // Failure → danger; success → green; informational (ok:null) → neutral blue.
                borderLeft: `3px solid ${
                  testResult.ok === false
                    ? "var(--danger,#C53A3A)"
                    : testResult.ok === true
                      ? "var(--brand-green,#2E8E3A)"
                      : "var(--brand-blue,#1E66C9)"
                }`,
                background:
                  testResult.ok === false
                    ? "var(--danger-soft,#FBE3E3)"
                    : testResult.ok === true
                      ? "var(--brand-green-soft,#E2F1E2)"
                      : "var(--surface-2,#EFF2F7)",
                color:
                  testResult.ok === false
                    ? "var(--danger,#C53A3A)"
                    : testResult.ok === true
                      ? "var(--brand-green-deep,#1E6D29)"
                      : "var(--ink-muted,#56627A)",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {testResult.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 18px",
            borderTop: "1px solid var(--border,#E2E6EE)",
            background: "var(--surface-2,#EFF2F7)",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={onClose}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid var(--border-strong,#C6CDDA)", background: "var(--surface,#FFFFFF)", color: "var(--ink-muted,#56627A)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            className="connector-action"
            onClick={handleTestFire}
            disabled={firing}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid var(--brand-green-soft,#E2F1E2)", background: "var(--surface,#FFFFFF)", color: firing ? "var(--ink-faint,#5B6980)" : "var(--brand-green-deep,#1E6D29)", fontSize: 12.5, fontWeight: 600, cursor: firing ? "default" : "pointer" }}
          >
            {firing ? "Firing…" : "Test fire"}
          </button>
          <Link
            href={isNew || connector.id === "new" ? "/library/suppliers" : `/library/suppliers/${connector.id}?tab=delivery`}
            onClick={onClose}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid transparent", background: "var(--brand-green,#2E8E3A)", color: "var(--surface,#FFFFFF)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}
          >
            Open supplier Delivery tab
          </Link>
        </div>
      </div>
    </div>
  );
}

function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label
        style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted,#56627A)", marginBottom: 6 }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
