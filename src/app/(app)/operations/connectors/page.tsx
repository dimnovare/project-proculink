"use client";

// §5.9 Connectors — wire-topology overview for connectors (email inboxes, SFTP, API, cXML PunchOut, webhooks)
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSuppliers, testFireDeliveryConfig, isApiMockMode } from "@/lib/api-client";

// ── Mock fallback (used when USE_MOCK = true) ─────────────────────────────────

const MOCK_CONNECTORS = [
  { id: "c1", type: "cXML PunchOut", name: "Acme Components",     status: "ok",   lastPoll: "30s",  errors24h: 0,  direction: "out" },
  { id: "c2", type: "API (REST)",    name: "Nordix Distribution",  status: "ok",   lastPoll: "1m",   errors24h: 0,  direction: "out" },
  { id: "c3", type: "EDI (SFTP)",    name: "MedicaSupply OY",      status: "risk", lastPoll: "12m",  errors24h: 3,  direction: "out" },
  { id: "c4", type: "Email inbox",   name: "orders@company.com",   status: "ok",   lastPoll: "5m",   errors24h: 0,  direction: "in"  },
  { id: "c5", type: "Email inbox",   name: "po@nordic.example",    status: "ok",   lastPoll: "5m",   errors24h: 0,  direction: "in"  },
  { id: "c6", type: "API (REST)",    name: "BoltWorks BV",         status: "down", lastPoll: "1h",   errors24h: 11, direction: "out" },
  { id: "c7", type: "cXML PunchOut", name: "VanDerBerg Metaal",    status: "ok",   lastPoll: "2m",   errors24h: 0,  direction: "out" },
];

type Connector = {
  id: string;
  type: string;
  name: string;
  status: string;
  lastPoll: string;
  errors24h: number;
  direction: string;
};

const STATUS_COLOR: Record<string, string> = { ok: "#2E8E3A", risk: "#C97A14", down: "#C53A3A" };
const STATUS_BG:    Record<string, string> = { ok: "#E2F1E2", risk: "#FAEFD6", down: "#FBE3E3" };
const DIR_COLOR: Record<string, string>    = { in: "#1E66C9", out: "#2E8E3A" };

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid #F0F2F6" }}>
      {[140, 80, 160, 60, 60, 40, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 animate-pulse rounded" style={{ width: w, background: "#E2E6EE" }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[8px] bg-white p-4 animate-pulse" style={{ border: "1px solid #E2E6EE" }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="h-4 w-16 rounded" style={{ background: "#E2E6EE" }} />
        <div className="h-4 w-12 rounded" style={{ background: "#E2E6EE" }} />
      </div>
      <div className="h-4 w-32 rounded mb-1" style={{ background: "#E2E6EE" }} />
      <div className="h-3 w-24 rounded" style={{ background: "#E2E6EE" }} />
    </div>
  );
}

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

  // Derive connector rows from real suppliers, fallback to mock data
  const connectors: Connector[] = isApiMockMode
    ? MOCK_CONNECTORS
    : (suppliersRaw ?? []).map((s) => ({
        id: s.id,
        type: "API (REST)",
        name: s.name,
        status: "ok",
        lastPoll: "—",
        errors24h: 0,
        direction: "out",
      }));

  // Test-fire mutation
  const testFireMutation = useMutation({
    mutationFn: (supplierId: string) => testFireDeliveryConfig(supplierId),
    onMutate: (id) => setFiringId(id),
    onSettled: () => setFiringId(null),
    onSuccess: (result, id) => {
      const name = connectors.find((c) => c.id === id)?.name ?? id;
      setNotice(result.success
        ? `✓ Test delivery to "${name}" succeeded — ${result.message}`
        : `✗ Test delivery to "${name}" failed — ${result.message}`);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err: Error, id) => {
      const name = connectors.find((c) => c.id === id)?.name ?? id;
      setNotice(`✗ Test fire to "${name}" failed — ${err.message}`);
    },
  });

  const handleTestFire = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotice(null);
    testFireMutation.mutate(id);
  };

  const ok   = connectors.filter((c) => c.status === "ok").length;
  const risk = connectors.filter((c) => c.status === "risk").length;
  const down = connectors.filter((c) => c.status === "down").length;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-end sm:gap-4 sm:px-6 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Connectors</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {ok} healthy
            {risk > 0 && <><span> · </span><span style={{ color: "#C97A14" }}>{risk} at risk</span></>}
            {down > 0 && <><span> · </span><span style={{ color: "#C53A3A" }}>{down} down</span></>}
          </p>
        </div>
        <button
          onClick={() => {
            setNotice(null);
            setSelected({ id: "new", type: "API (REST)", name: "", status: "ok", lastPoll: "never", errors24h: 0, direction: "out" });
          }}
          className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          + Add connector
        </button>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {/* Notice */}
        {notice && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={{
              border: notice.startsWith("✓") ? "1px solid #BDE0C1" : "1px solid #F5B8B8",
              borderLeft: notice.startsWith("✓") ? "3px solid #2E8E3A" : "3px solid #C53A3A",
              background: notice.startsWith("✓") ? "#F0F7F1" : "#FBF0F0",
              color: notice.startsWith("✓") ? "#1E6D29" : "#7B1C1C",
            }}
          >
            {notice}
          </div>
        )}

        {/* Error state */}
        {isError && !isApiMockMode && (
          <div className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #F5B8B8", borderLeft: "3px solid #C53A3A", background: "#FBF0F0", color: "#7B1C1C" }}>
            Failed to load connectors.{" "}
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ["suppliers"] })} className="underline font-semibold">Retry</button>
          </div>
        )}

        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Healthy",  value: ok,   color: "#2E8E3A", bg: "#E2F1E2" },
            { label: "At risk",  value: risk,  color: "#C97A14", bg: "#FAEFD6" },
            { label: "Down",     value: down,  color: "#C53A3A", bg: "#FBE3E3" },
          ].map((s) => (
            <div key={s.label} className="min-w-0" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: "16px clamp(10px, 3vw, 20px)", display: "flex", alignItems: "center", gap: 12, borderLeft: `3px solid ${s.color}` }}>
              <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: "clamp(24px, 8vw, 32px)", fontWeight: 700, color: s.value > 0 ? s.color : "#C6CDDA", lineHeight: 1 }}>{s.value}</span>
              <span className="min-w-0 leading-tight" style={{ fontSize: 13, color: "#56627A" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Connector list */}
        {isLoading && !isApiMockMode ? (
          <>
            <div className="hidden md:block" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
              <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["Status","Type","Name / Endpoint","Direction","Last poll","Errors 24h","",""].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRow /><SkeletonRow /><SkeletonRow />
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          </>
        ) : connectors.length === 0 ? (
          <EmptyState
            icon="⇄"
            title="No connectors configured"
            sub="Add a connector to start receiving orders from email inboxes, SFTP drops, APIs, or cXML PunchOut."
            action={{ label: "+ Add connector", onClick: () => {} }}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
              <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
                    {["Status","Type","Name / Endpoint","Direction","Last poll","Errors 24h","",""].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#8A93A5" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {connectors.map((c) => (
                    <tr key={c.id} className="group" style={{ borderBottom: "1px solid #F0F2F6", cursor: "pointer" }}
                      onClick={() => { setNotice(null); setSelected(c); }}
                      onMouseEnter={(e)=>((e.currentTarget as HTMLElement).style.background="#F6F7FA")}
                      onMouseLeave={(e)=>((e.currentTarget as HTMLElement).style.background="transparent")}
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_BG[c.status] ?? "#EFF2F7", color: STATUS_COLOR[c.status] ?? "#56627A" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[c.status] ?? "#56627A", flexShrink: 0, display: "inline-block" }} />
                          {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: "#56627A" }}>{c.type}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: "#0B1A2F" }}>{c.name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${DIR_COLOR[c.direction] ?? "#56627A"}18`, color: DIR_COLOR[c.direction] ?? "#56627A" }}>
                          {c.direction === "in" ? "← In" : "Out →"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: "#8A93A5" }}>{c.lastPoll !== "—" ? `${c.lastPoll} ago` : "—"}</td>
                      <td className="px-4 py-3 font-mono text-[12px]" style={{ color: c.errors24h > 0 ? "#C53A3A" : "#8A93A5" }}>{c.errors24h}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => handleTestFire(e, c.id)}
                          disabled={firingId === c.id}
                          className="opacity-0 group-hover:opacity-100 rounded px-2 py-1 text-[11.5px] font-medium transition-opacity"
                          style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: "#0F4FA8", minWidth: 66 }}
                          title="Send a test delivery to verify this connector"
                        >
                          {firingId === c.id ? "Firing…" : "Test fire"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setNotice(null); setSelected(c); }}
                          className="opacity-0 group-hover:opacity-100 rounded px-2 py-1 text-[11.5px] font-medium transition-opacity"
                          style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-3 md:hidden">
              {connectors.map((c) => (
                <div key={c.id} className="rounded-[8px] bg-white p-4" style={{ border: "1px solid #E2E6EE", borderLeft: `3px solid ${STATUS_COLOR[c.status] ?? "#C6CDDA"}` }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_BG[c.status] ?? "#EFF2F7", color: STATUS_COLOR[c.status] ?? "#56627A" }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[c.status] ?? "#56627A", flexShrink: 0, display: "inline-block" }} />
                      {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                    </span>
                    <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${DIR_COLOR[c.direction] ?? "#56627A"}18`, color: DIR_COLOR[c.direction] ?? "#56627A" }}>
                      {c.direction === "in" ? "Input" : "Output"}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>{c.name}</div>
                  <div className="mt-1 text-[12px]" style={{ color: "#56627A" }}>{c.type}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]" style={{ color: "#56627A" }}>
                    <span>Last poll: {c.lastPoll !== "—" ? `${c.lastPoll} ago` : "—"}</span>
                    <span>Errors: <strong style={{ color: c.errors24h > 0 ? "#C53A3A" : "#0B1A2F" }}>{c.errors24h}</strong></span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={(e) => handleTestFire(e, c.id)}
                      disabled={firingId === c.id}
                      className="flex-1 rounded-[5px] py-2 text-[12px] font-medium"
                      style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: "#0F4FA8" }}
                    >
                      {firingId === c.id ? "Firing…" : "Test fire"}
                    </button>
                    <button
                      onClick={() => { setNotice(null); setSelected(c); }}
                      className="flex-1 rounded-[5px] py-2 text-[12px] font-medium"
                      style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
                    >
                      Configure
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

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
    </div>
  );
}

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
      setTestResult(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
    } catch (err) {
      setTestResult(`✗ Test fire failed — ${(err as Error).message}`);
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[560px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#1E66C9" }}>Connector configuration</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "Add connector" : connector.name}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <FormField label="Connector type">
            <select defaultValue={connector.type} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
              <option>API (REST)</option>
              <option>Email inbox</option>
              <option>EDI (SFTP)</option>
              <option>cXML PunchOut</option>
            </select>
          </FormField>
          <FormField label="Name or endpoint">
            <input defaultValue={connector.name} placeholder="Supplier, mailbox, or endpoint name" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Direction">
              <select defaultValue={connector.direction} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                <option value="in">Input to ProcuLink</option>
                <option value="out">Output to supplier</option>
              </select>
            </FormField>
            <FormField label="Status">
              <input readOnly value={isNew ? "Draft" : connector.status} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] bg-[#F6F7FA] px-2 text-[12px] text-[#56627A]" />
            </FormField>
          </div>
          {testResult && (
            <div
              className="rounded-[7px] border p-3 text-[12px] leading-5"
              style={{
                borderColor: testResult.startsWith("✓") ? "#BDE0C1" : "#F5B8B8",
                background: testResult.startsWith("✓") ? "#F0F7F1" : "#FBF0F0",
                color: testResult.startsWith("✓") ? "#1E6D29" : "#7B1C1C",
              }}
            >
              {testResult}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button
            onClick={handleTestFire}
            disabled={firing}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: "1px solid #B8CFF5", background: "#FFFFFF", color: firing ? "#8A93A5" : "#0F4FA8" }}
          >
            {firing ? "Firing…" : "Test fire"}
          </button>
          <button
            onClick={() => onSaved(isNew ? "Connector draft prepared. Set delivery credentials in the supplier's Delivery tab." : "Connector configuration saved.")}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: 0, background: "#0B1A2F", color: "#FFFFFF" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
