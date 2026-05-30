"use client";

// §5.9 Connectors — icon-card grid matching canonical ConnectorsScreen
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSuppliers, testFireDeliveryConfig, isApiMockMode } from "@/lib/api-client";

// ── Mock fallback (used when USE_MOCK = true) ─────────────────────────────────

const MOCK_CONNECTORS = [
  { id: "c1", type: "cXML PunchOut", name: "SAP Ariba",             status: "connected",  desc: "ERP connector · cXML in/out", docks: 2,  direction: "out" },
  { id: "c2", type: "ERP (REST)",    name: "Coupa",                  status: "connected",  desc: "ERP connector · cXML",        docks: 1,  direction: "out" },
  { id: "c3", type: "EDI (SFTP)",    name: "Generic SFTP",           status: "connected",  desc: "File delivery",               docks: 3,  direction: "out" },
  { id: "c4", type: "Email inbox",   name: "Email (IMAP)",           status: "connected",  desc: "Inbound order polling",       docks: 1,  direction: "in"  },
  { id: "c5", type: "ERP (REST)",    name: "Erply",                  status: "available",  desc: "Retail ERP",                  docks: 0,  direction: "out" },
  { id: "c6", type: "ERP (XML)",     name: "Directo",                status: "available",  desc: "Accounting ERP · XML",        docks: 0,  direction: "out" },
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
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 21,
        padding: "0 9px",
        borderRadius: 11,
        fontSize: 11,
        fontWeight: 600,
        background: connected ? "var(--brand-green-soft,#E2F1E2)" : "var(--surface-2,#EFF2F7)",
        color: connected ? "var(--brand-green-deep,#1E6D29)" : "var(--ink-muted,#56627A)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: connected ? "var(--brand-green,#2E8E3A)" : "var(--ink-faint,#8A93A5)",
          flexShrink: 0,
        }}
      />
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
        padding: 18,
        animation: "skel-pulse 1.4s ease-in-out infinite",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
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
  firingId,
  onManage,
  onTestFire,
}: {
  connector: Connector;
  firingId: string | null;
  onManage: (c: Connector) => void;
  onTestFire: (e: React.MouseEvent, id: string) => void;
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

      {/* Name + description */}
      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink,#0B1A2F)", lineHeight: 1.3 }}>{connector.name}</div>
      <div style={{ fontSize: 12, color: "var(--ink-muted,#56627A)", marginTop: 3, lineHeight: 1.4 }}>{connector.desc}</div>

      {/* Footer: dock count + action button */}
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
        <span style={{ fontSize: 11.5, color: "var(--ink-faint,#8A93A5)" }}>
          {connector.docks > 0 ? `${connector.docks} supplier${connector.docks > 1 ? "s" : ""}` : "Not in use"}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {connected && connector.id !== "new" && (
            <button
              onClick={(e) => onTestFire(e, connector.id)}
              disabled={firingId === connector.id}
              style={{
                height: 27,
                padding: "0 10px",
                borderRadius: "var(--radius,6px)",
                border: "1px solid #B8CFF5",
                background: "var(--surface,#FFFFFF)",
                color: firingId === connector.id ? "var(--ink-faint,#8A93A5)" : "var(--brand-blue-deep,#0F4FA8)",
                fontSize: 12,
                fontWeight: 600,
                cursor: firingId === connector.id ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {firingId === connector.id ? "Firing…" : "Test fire"}
            </button>
          )}
          <button
            onClick={() => onManage(connector)}
            style={{
              height: 27,
              padding: "0 10px",
              borderRadius: "var(--radius,6px)",
              border: "1px solid var(--border-strong,#C6CDDA)",
              background: "var(--surface,#FFFFFF)",
              color: "var(--ink,#0B1A2F)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {connected ? "Manage" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Responsive grid CSS (inline style + a helper) ─────────────────────────────
// We can't use the raw .g-3 class without importing tokens.css globally, so
// reproduce the same responsive grid with inline CSS-in-JS pattern.
const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 14,
};

// ── Main component ────────────────────────────────────────────────────────────

export default function ConnectorsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Connector | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [firingId, setFiringId] = useState<string | null>(null);

  // Live data from suppliers
  const { data: suppliersRaw, isLoading, isError } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  // Derive connector rows: mock data (isApiMockMode) or real suppliers
  const connectors: Connector[] = isApiMockMode
    ? MOCK_CONNECTORS
    : (suppliersRaw ?? []).map((s) => ({
        id: s.id,
        type: "API (REST)",
        name: s.name,
        status: "connected",
        desc: "Supplier delivery endpoint",
        docks: 0,
        direction: "out",
      }));

  const connectedCount = connectors.filter((c) => isConnected(c.status)).length;

  // Test-fire mutation
  const testFireMutation = useMutation({
    mutationFn: (supplierId: string) => testFireDeliveryConfig(supplierId),
    onMutate: (id) => setFiringId(id),
    onSettled: () => setFiringId(null),
    onSuccess: (result, id) => {
      const name = connectors.find((c) => c.id === id)?.name ?? id;
      setNotice(result.success
        ? `Test delivery to "${name}" succeeded — ${result.message}`
        : `Test delivery to "${name}" failed — ${result.message}`);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err: Error, id) => {
      const name = connectors.find((c) => c.id === id)?.name ?? id;
      setNotice(`Test fire to "${name}" failed — ${err.message}`);
    },
  });

  const handleTestFire = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotice(null);
    testFireMutation.mutate(id);
  };

  const handleManage = (c: Connector) => {
    setNotice(null);
    setSelected(c);
  };

  return (
    <>
      {/* Responsive grid breakpoints as a style tag (avoids needing global .g-3) */}
      <style>{`
        .connectors-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
        @media (max-width: 920px) { .connectors-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 540px) { .connectors-grid { grid-template-columns: 1fr; } }
        @keyframes skel-pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      `}</style>

      <div style={{ background: "var(--bg,#F6F7FA)", display: "flex", flexDirection: "column", minHeight: "100%" }}>
        {/* Page header */}
        <div
          style={{
            padding: "26px 34px 0",
            maxWidth: 1480,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px 24px",
              marginBottom: 22,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-display,'Bricolage Grotesque',Inter,sans-serif)",
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.1,
                  margin: 0,
                  color: "var(--ink,#0B1A2F)",
                  whiteSpace: "nowrap",
                }}
              >
                Connectors
              </h1>
              <div style={{ color: "var(--ink-muted,#56627A)", fontSize: 13, marginTop: 5 }}>
                ERP and channel integrations · {connectedCount} connected
              </div>
            </div>
            <button
              onClick={() => {
                setNotice(null);
                setSelected({ id: "new", type: "API (REST)", name: "", status: "available", desc: "", docks: 0, direction: "out" });
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 32,
                padding: "0 14px",
                borderRadius: "var(--radius,6px)",
                border: "1px solid transparent",
                background: "var(--brand-blue,#1E66C9)",
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
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, padding: "0 34px 64px", maxWidth: 1480, margin: "0 auto", width: "100%" }}>
          {/* Notice */}
          {notice && (
            <div
              style={{
                marginBottom: 16,
                borderRadius: "var(--radius-md,8px)",
                padding: "10px 14px",
                fontSize: 12.5,
                border: "1px solid var(--border,#E2E6EE)",
                borderLeft: "3px solid var(--brand-blue,#1E66C9)",
                background: "var(--brand-blue-soft,#E3EDFB)",
                color: "var(--brand-blue-deep,#0F4FA8)",
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
                  firingId={firingId}
                  onManage={handleManage}
                  onTestFire={handleTestFire}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel */}
      {selected && (
        <ConnectorPanel
          connector={selected}
          onClose={() => setSelected(null)}
          onSaved={(message) => {
            setNotice(message);
            setSelected(null);
          }}
        />
      )}
    </>
  );
}

// ── ConnectorPanel (inline slideover — functionality preserved) ───────────────

function ConnectorPanel({
  connector,
  onClose,
  onSaved,
}: {
  connector: Connector;
  onClose: () => void;
  onSaved: (message: string) => void;
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
                background: "var(--brand-blue-soft,#E3EDFB)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <PlugIcon size={16} color="var(--brand-blue-deep,#0F4FA8)" />
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
          <PanelField label="Connector type">
            <select
              defaultValue={connector.type}
              style={{
                height: 32,
                width: "100%",
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border-strong,#C6CDDA)",
                background: "var(--surface,#FFFFFF)",
                fontSize: 12.5,
                color: "var(--ink,#0B1A2F)",
                padding: "0 11px",
              }}
            >
              <option>API (REST)</option>
              <option>Email (IMAP)</option>
              <option>EDI (SFTP)</option>
              <option>cXML PunchOut</option>
              <option>ERP — Erply</option>
              <option>ERP — Directo</option>
            </select>
          </PanelField>
          <PanelField label="Name or endpoint">
            <input
              defaultValue={connector.name}
              placeholder="Supplier, mailbox, or endpoint name"
              style={{
                height: 32,
                width: "100%",
                borderRadius: "var(--radius,6px)",
                border: "1px solid var(--border-strong,#C6CDDA)",
                background: "var(--surface,#FFFFFF)",
                fontSize: 12.5,
                color: "var(--ink,#0B1A2F)",
                padding: "0 11px",
              }}
            />
          </PanelField>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <PanelField label="Direction">
              <select
                defaultValue={connector.direction}
                style={{
                  height: 32,
                  width: "100%",
                  borderRadius: "var(--radius,6px)",
                  border: "1px solid var(--border-strong,#C6CDDA)",
                  background: "var(--surface,#FFFFFF)",
                  fontSize: 12.5,
                  color: "var(--ink,#0B1A2F)",
                  padding: "0 11px",
                }}
              >
                <option value="in">Input to ProcuLink</option>
                <option value="out">Output to supplier</option>
              </select>
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
                borderLeft: "3px solid var(--brand-blue,#1E66C9)",
                background: "var(--brand-blue-soft,#E3EDFB)",
                color: "var(--brand-blue-deep,#0F4FA8)",
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
            onClick={handleTestFire}
            disabled={firing}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid #B8CFF5", background: "var(--surface,#FFFFFF)", color: firing ? "var(--ink-faint,#8A93A5)" : "var(--brand-blue-deep,#0F4FA8)", fontSize: 12.5, fontWeight: 600, cursor: firing ? "default" : "pointer" }}
          >
            {firing ? "Firing…" : "Test fire"}
          </button>
          <button
            onClick={() => onSaved(isNew ? "Connector draft prepared. Set delivery credentials in the supplier's Delivery tab." : "Connector configuration saved.")}
            style={{ height: 32, padding: "0 14px", borderRadius: "var(--radius,6px)", border: "1px solid transparent", background: "var(--brand-blue,#1E66C9)", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Save
          </button>
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
