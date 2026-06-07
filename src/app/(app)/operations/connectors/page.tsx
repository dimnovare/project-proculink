"use client";

// §5.9 Connectors — icon-card grid matching canonical ConnectorsScreen
import { EmptyState } from "@/components/bridge/EmptyState";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSuppliers, testFireDeliveryConfig, isApiMockMode } from "@/lib/api-client";

// ── Mock fallback (used when USE_MOCK = true) ─────────────────────────────────

const MOCK_CONNECTORS = [
  { id: "c1", type: "cXML PunchOut", name: "SAP Ariba",             status: "connected",  desc: "ERP connector · cXML in/out", docks: 2,  direction: "out" },
  { id: "c2", type: "ERP (REST)",    name: "Coupa",                  status: "connected",  desc: "ERP connector · cXML",        docks: 1,  direction: "out" },
  { id: "c3", type: "ERP (REST)",    name: "Microsoft Dynamics 365", status: "available",  desc: "ERP connector · OData",       docks: 0,  direction: "out" },
  { id: "c4", type: "EDI (SFTP)",    name: "Generic SFTP",           status: "connected",  desc: "File delivery",               docks: 3,  direction: "out" },
  { id: "c5", type: "Email (IMAP)",  name: "Email (IMAP)",           status: "connected",  desc: "Inbound order polling",       docks: 1,  direction: "in"  },
  { id: "c6", type: "ERP — Erply",   name: "Erply",                  status: "available",  desc: "Retail ERP",                  docks: 0,  direction: "out" },
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
  // Canonical design pills (screen-buyers.jsx ConnectorsScreen):
  //   Connected → .pill-ready  (bg --brand-green-soft #E2F1E2, text --brand-green-deep #1E6D29, dot --brand-green #2E8E3A)
  //   Available → .pill-new    (bg --surface-2 #EFF2F7,        text --ink-muted #56627A,        dot --ink-faint #8A93A5)
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
          <span style={{ fontSize: 11.5, color: "var(--ink-faint,#8A93A5)" }}>
            {connector.docks > 0 ? `${connector.docks} supplier${connector.docks > 1 ? "s" : ""}` : "Not in use"}
          </span>
        ) : (
          <span />
        )}
        {connected ? (
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
            Connect
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
          sub={`ERP and channel integrations · ${connectedCount} connected`}
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
            sub="Add a connector to start routing purchase orders to suppliers via API, SFTP, email, ERP, or cXML PunchOut."
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

// ── ConnectorPanel (inline slideover — functionality preserved) ───────────────

function ConnectorPanel({
  connector,
  onClose,
}: {
  connector: Connector;
  onClose: () => void;
}) {
  const isNew = connector.id === "new";
  const [testResult, setTestResult] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);

  const handleTestFire = async () => {
    if (connector.id === "new") {
      setTestResult("Save the connector first before test-firing.");
      return;
    }
    setFiring(true);
    setTestResult(null);
    try {
      const result = await testFireDeliveryConfig(connector.id);
      setTestResult(result.success ? `${result.message}` : `Failed — ${result.message}`);
    } catch (err) {
      setTestResult(`Test fire failed — ${(err as Error).message}`);
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
              color: "var(--ink-faint,#8A93A5)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            ×
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

          {testResult && (
            <div
              style={{
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border,#E2E6EE)",
                borderLeft: "3px solid var(--brand-green,#2E8E3A)",
                background: "var(--brand-green-soft,#E2F1E2)",
                color: "var(--brand-green-deep,#1E6D29)",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {testResult}
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
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid var(--brand-green-soft,#E2F1E2)", background: "var(--surface,#FFFFFF)", color: firing ? "var(--ink-faint,#8A93A5)" : "var(--brand-green-deep,#1E6D29)", fontSize: 12.5, fontWeight: 600, cursor: firing ? "default" : "pointer" }}
          >
            {firing ? "Firing…" : "Test fire"}
          </button>
          <Link
            href={isNew || connector.id === "new" ? "/library/suppliers" : `/library/suppliers/${connector.id}`}
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
