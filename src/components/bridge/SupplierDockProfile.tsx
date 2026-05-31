"use client";

// Supplier Dock Profile — /library/suppliers/[id]
// §5.8 — Header + tabs: Overview · Mappings · PO Mapping · Delivery

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Settings, Info, Clock, Link2, Truck, Plus } from "lucide-react";
import { PoMappingEditor } from "./PoMappingEditor";
import { DeliveryConfigEditor } from "./DeliveryConfigEditor";
import { upsertPoMapping, deletePoMapping } from "@/lib/api/mapping";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { PoMappingConfig } from "@/lib/api/types";

type Tab = "overview" | "mappings" | "po-mapping" | "delivery";

// Brand accent — emerald green. Reserved for *active* affordances only:
// tab underline, status dots, toggles, the primary CTA fill (matches design + active-nav).
const GREEN = "#28C55E";
const GREEN_DEEP = "#1DAF50";

// Design-sampled greens (from the 1920px renders). The product's soft-green TINT and its
// deep-green TEXT are forest-toned, distinct from the bright accent above:
//   tile/pill background  #E2F1E2   ·   supplier-code / "deep" text  #1E6D29
const GREEN_SOFT = "#E2F1E2";   // sampled avatar tile + confidence/imported pill bg
const GREEN_TEXT = "#1E6D29";   // sampled supplier-code + deep-green pill/label text

// Indigo / blue — "Inherited" provenance pills, selected-row tint, record-id links.
// All sampled from the design: inherited pill #E3EDFB/#0F4FBA, selected row #E3EDFB.
const INDIGO = "#3E63DD";
const INDIGO_SOFT = "#E3EDFB";
const INDIGO_DEEP = "#0F4FBA";

// Muted icon/label tone for card-header glyphs (design uses neutral slate, not green).
const MUTED = "#8A93A5";

// One consistent hairline for every card border, header divider, and row separator.
// Sampled #E2E6EE across the whole design — the earlier #F0F2F6/#F4F5F8 read too faint.
const LINE = "#E2E6EE";

// Demo data — only rendered when isApiMockMode is true (dev, never production)
const DEMO_MOCK = {
  id:            "s1",
  name:          "Acme Components",
  code:          "ACME",
  health:        97,
  totalOrders:   1284,
  avgCycle:      "1m 38s",
  exceptionRate: "2.1%",
  formats:       ["cXML", "HTTP"] as string[],
  autoProcess:   true,
  summary: {
    requiredFormat:    "cXML",
    deliveryChannel:   "HTTP",
    endpoint:          "sftp://vanderberg.example/in",
    standardsProfile:  "EDIFACT D.96A ORDERS",
    savedMappings:     1612,
    lastDelivery:      "26m ago · accepted",
  },
  recent: [
    { id: "PO-2026-008412", amount: "€71,240.00", status: "review"  as const },
    { id: "SH-PO-44120",    amount: "€9,418.00",  status: "ready"   as const },
    { id: "WST-2026-7741",  amount: "€2,140.00",  status: "sent"    as const },
  ],
  mappings: [
    { buyer: "HX-4410", supplier: "ACM-PL-22", desc: "Hydraulic seal kit",     source: "AI"       as const, conf: 95  },
    { buyer: "HX-4412", supplier: "ACM-FL-08", desc: "Flange coupling 80mm",   source: "Manual"   as const, conf: 100 },
    { buyer: "HX-5500", supplier: "ACM-BR-55", desc: "Bracket assembly",       source: "Inherited" as const, conf: 100 },
    { buyer: "HX-3301", supplier: "ACM-NT-33", desc: "Lock nut M12",           source: "Imported" as const, conf: 100 },
  ],
};

function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview",    label: "Overview"          },
  { id: "mappings",    label: "Mappings"          },
  { id: "po-mapping",  label: "PO Mapping"        },
  { id: "delivery",    label: "Delivery"          },
];

// Source-pill palette for the SKU mappings table (provenance colour-coding, all sampled).
const SOURCE_PILL: Record<string, { bg: string; fg: string }> = {
  AI:        { bg: "#EEE7FB",     fg: "#6F4FCE"    },   // violet — AI provenance
  Manual:    { bg: "#EFF2F7",     fg: "#56627A"    },   // neutral slate
  Inherited: { bg: INDIGO_SOFT,   fg: INDIGO_DEEP  },   // blue — inherited from another supplier
  Imported:  { bg: GREEN_SOFT,    fg: GREEN_TEXT   },   // green — imported from a file
};

// Soft-pill background tint that pairs with confColor() for confidence badges.
function confPillBg(pct: number): string {
  if (pct >= 90) return GREEN_SOFT;
  if (pct >= 75) return "#FAEFD6";
  return "#FBE3E3";
}

function confColor(pct: number): string {
  if (pct >= 90) return GREEN_TEXT;
  if (pct >= 75) return "#C97A14";
  return "#C53A3A";
}

export function SupplierDockProfile({ id }: { id: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [poMappingConfig, setPoMappingConfig] = useState<PoMappingConfig | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);

  const { data: supplierList, isLoading, error } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: !isApiMockMode,
  });

  // In mock mode: all fields come from DEMO_MOCK.
  // In real mode: only name comes from the API; metrics show honest placeholders.
  const realSupplier = !isApiMockMode
    ? (supplierList?.find(s => s.id === id) ?? null)
    : null;

  const name = isApiMockMode ? DEMO_MOCK.name : (realSupplier?.name ?? "");
  const code = isApiMockMode ? DEMO_MOCK.code : (realSupplier ? deriveCode(realSupplier.name) : "—");

  if (!isApiMockMode && isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 13, color: "#8A93A5" }}>Loading supplier…</span>
      </div>
    );
  }

  if (!isApiMockMode && error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 13, color: "#C53A3A" }}>Failed to load supplier</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to suppliers
        </button>
      </div>
    );
  }

  if (!isApiMockMode && !isLoading && realSupplier === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ background: "#F6F7FA" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F" }}>Supplier not found</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to suppliers
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 flex-shrink-0"
        style={{ borderBottom: `1px solid ${LINE}`, background: "#FFFFFF" }}
      >
        <button
          onClick={() => router.push("/library/suppliers")}
          className="inline-flex items-center gap-1 self-start text-[12.5px] font-medium"
          style={{ color: "#8A93A5", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <ChevronLeft size={14} strokeWidth={2.2} />
          Suppliers
        </button>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3.5">
            {/* Supplier avatar */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 11,
                background: GREEN_SOFT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Truck size={20} strokeWidth={2} color={GREEN_TEXT} />
            </div>

            <div className="min-w-0">
              <h1
                className="text-[24px] leading-none font-semibold tracking-[-0.02em] sm:text-[32px]"
                style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
              >
                {name}
              </h1>
              {/* Inline meta row — code label · format pills · auto-process status */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2">
                {code && code !== "—" && (
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.04em]"
                    style={{ color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {code}
                  </span>
                )}
                {(isApiMockMode ? DEMO_MOCK.formats : []).map((f) => {
                  const isStandard = /xml|edi|peppol|x12/i.test(f);
                  return (
                    <span
                      key={f}
                      className="text-[10.5px] font-semibold rounded px-1.5 py-0.5"
                      style={{
                        background: isStandard ? "#EEE7FB" : "#EFF2F7",
                        color: isStandard ? "#6F4FCE" : "#56627A",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {f}
                    </span>
                  );
                })}
                {isApiMockMode && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: DEMO_MOCK.autoProcess ? GREEN_TEXT : MUTED }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: DEMO_MOCK.autoProcess ? GREEN : MUTED, display: "inline-block" }} />
                    Auto-process: {DEMO_MOCK.autoProcess ? "ON" : "OFF"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Settings action — opens delivery configuration */}
          <button
            onClick={() => setTab("delivery")}
            className="inline-flex items-center gap-1.5 self-start rounded-[7px] px-3 text-[12.5px] font-medium sm:ml-auto sm:self-center"
            style={{ height: 34, border: "1px solid #C6CDDA", background: "#FFFFFF", color: "#0B1A2F", cursor: "pointer" }}
          >
            <Settings size={14} strokeWidth={2} color="#56627A" />
            Supplier settings
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-0 overflow-x-auto px-4 sm:px-6 flex-shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderBottom: `1px solid ${LINE}`, background: "#FFFFFF", height: 42 }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="h-full shrink-0 px-4 text-[12.5px] font-medium transition-colors relative"
            style={{
              color: tab === t.id ? "#0B1A2F" : "#56627A",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderBottom: tab === t.id ? `2px solid ${GREEN}` : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {tab === "overview" && (
          <div className="flex flex-col gap-4">
            {/* KPI stat cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              {(isApiMockMode
                ? [
                    { label: "Total orders",    value: DEMO_MOCK.totalOrders.toLocaleString(), sub: "all time",        subAccent: false },
                    { label: "Avg cycle time",  value: DEMO_MOCK.avgCycle,                     sub: "−14% vs prev",     subAccent: true  },
                    { label: "Exception rate",  value: DEMO_MOCK.exceptionRate,                sub: "within target",    subAccent: true  },
                    { label: "Acceptance",      value: `${DEMO_MOCK.health}%`,                 sub: "last 30 days",     subAccent: true  },
                  ]
                : [
                    { label: "Total orders",    value: "—", sub: "no data yet", subAccent: false },
                    { label: "Avg cycle time",  value: "—", sub: "no data yet", subAccent: false },
                    { label: "Exception rate",  value: "—", sub: "no data yet", subAccent: false },
                    { label: "Acceptance",      value: "—", sub: "no data yet", subAccent: false },
                  ]
              ).map(({ label, value, sub, subAccent }) => (
                <div
                  key={label}
                  className="rounded-[10px] px-4 py-4"
                  style={{ background: "#FFFFFF", border: `1px solid ${LINE}`, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>{label}</div>
                  <div
                    className="mt-2 tracking-[-0.02em]"
                    style={{
                      fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                      fontSize: 30,
                      lineHeight: 1,
                      fontWeight: 700,
                      color: isApiMockMode ? "#0B1A2F" : "#C6CDDA",
                    }}
                  >
                    {value}
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium" style={{ color: subAccent ? GREEN_TEXT : MUTED }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Summary + recent deliveries */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Delivery summary */}
              <div style={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <Info size={15} strokeWidth={2} color={MUTED} />
                  <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Delivery summary</h3>
                </div>
                {isApiMockMode ? (
                  <div className="px-4 py-1 sm:px-5">
                    {([
                      ["Required format",   DEMO_MOCK.summary.requiredFormat,   true ],
                      ["Delivery channel",  DEMO_MOCK.summary.deliveryChannel,  true ],
                      ["Endpoint",          DEMO_MOCK.summary.endpoint,         true ],
                      ["Standards profile", DEMO_MOCK.summary.standardsProfile, true ],
                      ["Saved SKU mappings", DEMO_MOCK.summary.savedMappings.toLocaleString(), false],
                      ["Last delivery",     DEMO_MOCK.summary.lastDelivery,     false],
                    ] as Array<[string, string, boolean]>).map(([k, v, mono], i, arr) => (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-3 py-2.5 sm:gap-4"
                        style={{ borderBottom: i < arr.length - 1 ? `1px solid ${LINE}` : undefined }}
                      >
                        <span className="flex-shrink-0 text-[12px]" style={{ color: "#56627A" }}>{k}</span>
                        <span
                          className="min-w-0 truncate text-right text-[12px] font-medium"
                          style={{ color: "#0B1A2F", fontFamily: mono ? "'JetBrains Mono', monospace" : undefined }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
                    Configure this supplier in the{" "}
                    <button
                      onClick={() => setTab("delivery")}
                      style={{ color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13, fontWeight: 500 }}
                    >
                      Delivery
                    </button>{" "}
                    tab to populate this summary.
                  </p>
                )}
              </div>

              {/* Recent deliveries */}
              <div style={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <Clock size={15} strokeWidth={2} color={MUTED} />
                  <h3 className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Recent deliveries</h3>
                </div>
                {isApiMockMode ? (
                  <div className="px-4 py-1 sm:px-5">
                    {DEMO_MOCK.recent.map((r, i) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2.5 py-2.5 sm:gap-3"
                        style={{ borderBottom: i < DEMO_MOCK.recent.length - 1 ? `1px solid ${LINE}` : undefined }}
                      >
                        <span className="flex-shrink-0 text-[12px] font-medium" style={{ color: INDIGO, fontFamily: "'JetBrains Mono', monospace" }}>{r.id}</span>
                        <span className="ml-auto min-w-0 truncate text-right text-[12px]" style={{ color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{r.amount}</span>
                        <span className="flex-shrink-0"><MiniStatusPill status={r.status} /></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
                    No deliveries yet for this supplier.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "mappings" && (
          <div style={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Card header */}
            <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-5 sm:flex-row sm:items-center" style={{ borderBottom: `1px solid ${LINE}` }}>
              <Link2 size={17} strokeWidth={2} color={MUTED} className="flex-shrink-0" />
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Saved SKU mappings</h3>
                <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                  {isApiMockMode ? `${DEMO_MOCK.summary.savedMappings.toLocaleString()} buyer → supplier item codes` : "Buyer → supplier item codes"}
                </p>
              </div>
              <a
                href="/library/mappings"
                className="inline-flex items-center gap-1.5 self-stretch justify-center rounded-[7px] px-3 text-[12.5px] font-medium sm:ml-auto sm:self-center"
                style={{ height: 36, border: `1px solid #C6CDDA`, background: "#FFFFFF", color: "#0B1A2F", textDecoration: "none", whiteSpace: "nowrap" }}
              >
                <Plus size={14} strokeWidth={2.2} color="#465161" />
                Add mapping
              </a>
            </div>

            {isApiMockMode ? (
              <>
                {/* Desktop / tablet: real table (≥sm). Hidden on phones. */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full border-collapse" style={{ minWidth: 640 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                        {["Buyer code", "Supplier code", "Description", "Source", "Confidence"].map((h, i) => (
                          <th
                            key={h}
                            className="px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                            style={{ color: MUTED, textAlign: i === 4 ? "right" : "left" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DEMO_MOCK.mappings.map((m, i) => {
                        const pill = SOURCE_PILL[m.source];
                        return (
                          <tr key={m.buyer} style={{ borderBottom: i < DEMO_MOCK.mappings.length - 1 ? `1px solid ${LINE}` : undefined }}>
                            <td className="px-5 py-3 text-[12px] font-medium" style={{ color: "#0B1A2F", fontFamily: "'JetBrains Mono', monospace" }}>{m.buyer}</td>
                            <td className="px-5 py-3 text-[12px] font-medium" style={{ color: GREEN_TEXT, fontFamily: "'JetBrains Mono', monospace" }}>{m.supplier}</td>
                            <td className="px-5 py-3 text-[12.5px]" style={{ color: "#56627A" }}>{m.desc}</td>
                            <td className="px-5 py-3" style={{ textAlign: "left" }}>
                              <span
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                                style={{ background: pill.bg, color: pill.fg }}
                              >
                                {m.source}
                              </span>
                            </td>
                            <td className="px-5 py-3" style={{ textAlign: "right" }}>
                              <span
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                                style={{ background: confPillBg(m.conf), color: confColor(m.conf), fontFamily: "'JetBrains Mono', monospace" }}
                              >
                                {m.conf}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Phones (<sm): stacked row-cards — no horizontal overflow. */}
                <div className="sm:hidden">
                  {DEMO_MOCK.mappings.map((m, i) => {
                    const pill = SOURCE_PILL[m.source];
                    return (
                      <div
                        key={m.buyer}
                        className="flex flex-col gap-2 px-4 py-3.5"
                        style={{ borderBottom: i < DEMO_MOCK.mappings.length - 1 ? `1px solid ${LINE}` : undefined }}
                      >
                        {/* Buyer → supplier code line */}
                        <div className="flex items-center gap-2 text-[13px] font-medium" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                          <span style={{ color: "#0B1A2F" }}>{m.buyer}</span>
                          <span style={{ color: "#C6CDDA" }}>→</span>
                          <span style={{ color: GREEN_TEXT }}>{m.supplier}</span>
                        </div>
                        {/* Description */}
                        <div className="text-[12.5px]" style={{ color: "#56627A" }}>{m.desc}</div>
                        {/* Source + confidence pills */}
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                            style={{ background: pill.bg, color: pill.fg }}
                          >
                            {m.source}
                          </span>
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                            style={{ background: confPillBg(m.conf), color: confColor(m.conf), fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {m.conf}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: "#56627A" }}>
                Showing mappings for {name}. See the full{" "}
                <a href="/library/mappings" style={{ color: GREEN_TEXT, fontWeight: 500 }}>Mapping Editor</a>{" "}
                for all supplier pairs.
              </p>
            )}
          </div>
        )}

        {tab === "po-mapping" && (
          <PoMappingEditor
            supplierId={id}
            initialConfig={poMappingConfig}
            saving={savingMapping}
            onSave={async (config) => {
              setSavingMapping(true);
              try {
                const saved = await upsertPoMapping(id, config);
                setPoMappingConfig(saved);
              } finally {
                setSavingMapping(false);
              }
            }}
            onDelete={
              poMappingConfig
                ? async () => {
                    await deletePoMapping(id);
                    setPoMappingConfig(null);
                  }
                : undefined
            }
          />
        )}

        {tab === "delivery" && <DeliveryConfigEditor supplierId={id} />}

        {/* Rules / Output templates / Connectors / History are managed globally (Library +
            Operations); supplier-scoped versions aren't built yet, so we don't surface empty
            placeholder tabs here. Re-add a tab once its supplier-scoped feature ships. */}
      </div>
    </div>
  );
}

/* -------- MiniStatusPill — compact status badge for the recent-deliveries list -------- */
function MiniStatusPill({ status }: { status: "review" | "ready" | "sent" }) {
  const MAP: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
    review: { bg: "#FAEFD6", fg: "#C97A14",   dot: "#C97A14", label: "Needs review" },
    ready:  { bg: GREEN_SOFT, fg: GREEN_TEXT,  dot: GREEN,     label: "Ready"        },
    sent:   { bg: GREEN_SOFT, fg: GREEN_TEXT,  dot: GREEN,     label: "Delivered"    },
  };
  const s = MAP[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {s.label}
    </span>
  );
}
