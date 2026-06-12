"use client";

// Supplier Dock Profile — /library/suppliers/[id]
// §5.8 — Header + tabs: Overview · Mappings · PO Mapping · Delivery · Acceptance

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Trash2, Info, Clock, Link2, Truck, Plus, ShieldCheck, GitBranch } from "lucide-react";
import { PoMappingEditor } from "./PoMappingEditor";
import { DeliveryConfigEditor } from "./DeliveryConfigEditor";
import { upsertPoMapping, deletePoMapping } from "@/lib/api/mapping";
import { apiClient, isApiMockMode, getAcceptanceProfile, saveAcceptanceProfile, activateAcceptanceVersion, applyPoMappingTemplate, getSupplierCatalog, importSupplierCatalog, clearSupplierCatalog, getSupplierRuleBindings, listConnections, type SupplierRuleBinding } from "@/lib/api-client";
import { StandardsRefList, hasStandardsRefs } from "./StandardsRefList";
import { statusLabel } from "./UnifiedStatusBadge";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { PageShell } from "./layout/PageShell";
import { useTabParamSync } from "@/lib/tab-param-sync";
import type { PoMappingConfig } from "@/lib/api/types";
import type { AcceptanceRule, AcceptanceProfile, SupplierMapping } from "@/types/procurement";

type Tab = "overview" | "mappings" | "catalog" | "po-mapping" | "delivery" | "acceptance";

// ── Design tokens (ported from tokens.css / globals.css) ─────────────────────
// Buyer side = blue (#1E66C9, also the ACTIVE accent), supplier side = forest green.
// These map 1:1 to the CSS custom properties so the screen matches screen-supplier.jsx.

// Forest-green supplier palette — avatar tile, supplier codes, "imported" pills, deep text.
// (Solid --brand-green #2E8E3A is supplied by the ported .pill/.toggle/.conf classes, so it
// isn't declared here; this component only needs the deep-text + soft-tile tones.)
const GREEN_DEEP  = "#1E6D29";  // --brand-green-deep (supplier code + deep-green text)
const GREEN_SOFT  = "#E2F1E2";  // --brand-green-soft (avatar tile + confidence/imported pill bg)
const GREEN_TEXT  = GREEN_DEEP; // alias retained for readability at call sites

// Buyer blue — the ACTIVE affordance (tab underline), record-id links, "inherited" provenance.
const BLUE        = "#1E66C9";  // --brand-blue       (ACTIVE accent + record-id links)
const BLUE_DEEP   = "#0F4FA8";  // --brand-blue-deep
const BLUE_SOFT   = "#E3EDFB";  // --brand-blue-soft  (inherited pill bg / selected row)

// Ink + chrome.
const INK         = "#0B1A2F";  // --ink
const MUTED       = "#56627A";  // --ink-muted  (body labels, card-header glyphs)
const FAINT       = "var(--ink-faint)";  // --ink-faint  (eyebrows, secondary mono)
const LINE        = "#E2E6EE";  // --border     (one hairline for every divider/border)
const BORDER_STRONG = "#C6CDDA";// --border-strong (button outlines)
const SURFACE     = "#FFFFFF";  // --surface
const SURFACE_2   = "#EFF2F7";  // --surface-2  (neutral chip bg)
const BG          = "#F6F7FA";  // --bg

// Semantic. (Amber tones are carried by the ported .conf-mid / .pill-review classes.)
const DANGER      = "#C53A3A";  // --danger
const AI          = "#6F4FCE";  // --ai      (AI provenance pill fg)
const AI_SOFT     = "#EEE7FB";  // --ai-soft (AI provenance pill bg)

const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";
const MONO    = "'JetBrains Mono', ui-monospace, monospace";

// Demo data — only rendered when isApiMockMode is true (dev, never production)
const DEMO_MOCK = {
  id:            "s1",
  name:          "Acme Components",
  code:          "ACME",
  health:        97,
  totalOrders:   1284,
  avgCycle:      "1m 38s",
  exceptionRate: "2.1%",
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
  { id: "catalog",     label: "Catalog"           },
  { id: "po-mapping",  label: "PO Mapping"        },
  { id: "delivery",    label: "Delivery"          },
  { id: "acceptance",  label: "Validation rules"  },
];

// Module-scope so useTabParamSync's effect deps stay referentially stable.
const isTab = (v: string | null | undefined): v is Tab =>
  v != null && TABS.some((t) => t.id === v);

// Source-pill palette for the SKU mappings table (provenance colour-coding, from design).
const SOURCE_PILL: Record<string, { bg: string; fg: string }> = {
  AI:        { bg: AI_SOFT,    fg: AI         },   // violet — AI provenance
  Manual:    { bg: SURFACE_2,  fg: MUTED      },   // neutral slate
  Inherited: { bg: BLUE_SOFT,  fg: BLUE_DEEP  },   // blue — inherited from another supplier
  Imported:  { bg: GREEN_SOFT, fg: GREEN_DEEP },   // green — imported from a file
};

// Confidence-chip class selector — maps a percentage to the ported .conf-* classes
// (.conf-hi green / .conf-mid amber / .conf-lo danger), matching design ConfidenceChip.
function confClass(pct: number): string {
  if (pct >= 90) return "conf-hi";
  if (pct >= 75) return "conf-mid";
  return "conf-lo";
}

// ── Operator and severity constants used in AcceptanceTab ─────────────────────

const OPERATORS: AcceptanceRule["operator"][] = [
  "required", "equals", "not_equals", "in", "contains",
  "greater_than", "less_than", "min", "max", "max_length",
];

// Human-readable operator labels (the raw operator ids are developer jargon).
const OPERATOR_LABELS: Record<AcceptanceRule["operator"], string> = {
  required: "Must have a value",
  equals: "Must equal",
  not_equals: "Must not equal",
  in: "Is one of (comma list)",
  contains: "Must contain",
  greater_than: "Must be greater than",
  less_than: "Must be less than",
  min: "At least (≥)",
  max: "At most (≤)",
  max_length: "Max length",
};

const SEVERITY_DOT: Record<AcceptanceRule["severity"], string> = {
  error:   "#C53A3A",
  warning: "#C97A14",
};

// Field options are constrained PER SCOPE to only the paths the backend acceptance
// validator actually resolves (EvaluateOrderField / EvaluateLineField in
// SupplierAcceptanceService.cs). A free-text field path that the resolver doesn't know
// silently passes — a dead rule — so we only offer fields that exist. Adding a field here
// requires adding it to that resolver too.
const FIELD_OPTIONS: Record<AcceptanceRule["scope"], Array<{ value: string; label: string }>> = {
  order: [
    { value: "currency", label: "Currency" },
    { value: "buyerName", label: "Buyer name" },
  ],
  line: [
    { value: "supplierItemCode", label: "Supplier item code" },
    { value: "buyerItemCode", label: "Buyer item code" },
    { value: "description", label: "Description" },
    { value: "quantity", label: "Quantity" },
    { value: "unitPrice", label: "Unit price" },
  ],
};

function firstFieldFor(scope: AcceptanceRule["scope"]): string {
  return FIELD_OPTIONS[scope][0].value;
}

// One-click templates so a user never has to learn field paths/operators cold.
// Every template uses a resolvable field path (see FIELD_OPTIONS).
const QUICK_RULES: Array<{ label: string; rule: AcceptanceRule }> = [
  { label: "Currency must be EUR",           rule: { scope: "order", fieldPath: "currency",         operator: "equals",       expectedValue: "EUR", severity: "error",   blockOnFail: true } },
  { label: "Every line has a supplier code", rule: { scope: "line",  fieldPath: "supplierItemCode", operator: "required",     expectedValue: "",    severity: "error",   blockOnFail: true } },
  { label: "Quantity greater than 0",        rule: { scope: "line",  fieldPath: "quantity",         operator: "greater_than", expectedValue: "0",   severity: "error",   blockOnFail: true } },
  { label: "Unit price is required",         rule: { scope: "line",  fieldPath: "unitPrice",        operator: "required",     expectedValue: "",    severity: "error",   blockOnFail: true } },
  { label: "Every line has a description",   rule: { scope: "line",  fieldPath: "description",      operator: "required",     expectedValue: "",    severity: "warning", blockOnFail: false } },
];

// ── SupplierRuleBindingsPanel (Group V4) ──────────────────────────────────────
// Read-only view of this supplier's ACTIVE-profile rule bindings joined to their
// reusable definitions. Surfaces the standards references (UBL/EDIFACT/X12/cXML)
// via the binding's definition. count 0 is normal (a supplier with no acceptance
// rules) → a clean empty state, NOT an error.
// Endpoint: GET /api/suppliers/{supplierId}/rule-bindings → SupplierRuleBinding[].

function bindingSeverityColor(severity: string): string {
  const s = (severity ?? "").toLowerCase();
  if (s === "error") return DANGER;
  if (s === "warning") return "#C97A14";
  return BLUE;
}

function SupplierRuleBindingsPanel({ supplierId }: { supplierId: string }) {
  const queryEnabled = useQueriesEnabled();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<SupplierRuleBinding[]>({
    queryKey: ["rule-bindings", supplierId],
    queryFn: () => getSupplierRuleBindings(supplierId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });

  const showLoading = !queryEnabled || (isLoading && data === undefined);
  const bindings = data ?? [];

  return (
    <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex items-center gap-2">
          <Link2 size={14} strokeWidth={2} color={MUTED} />
          <span className="text-[13px] font-semibold" style={{ color: INK }}>Active rule bindings</span>
          {!showLoading && !isError && (
            <span className="text-[11.5px]" style={{ color: FAINT }}>{bindings.length}</span>
          )}
        </div>
        <span className="text-[11px]" style={{ color: FAINT }}>with standards mapping</span>
      </div>

      {showLoading && (
        <div className="px-5 py-6 text-[12.5px]" style={{ color: FAINT }}>Loading rule bindings…</div>
      )}

      {!showLoading && isError && (
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <span className="text-[12.5px]" style={{ color: DANGER }}>Couldn&apos;t load rule bindings.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[7px] px-3 text-[12px] font-medium"
            style={{ height: 30, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {/* count 0 is normal — clean empty state, not an error. */}
      {!showLoading && !isError && bindings.length === 0 && (
        <p className="px-5 py-6 text-[12.5px]" style={{ color: MUTED }}>
          No active rule bindings for this supplier. Add and activate rules above to bind them here — each binding shows the standard it maps to.
        </p>
      )}

      {!showLoading && !isError && bindings.length > 0 && (
        <div className="flex flex-col divide-y" style={{ borderColor: LINE }}>
          {bindings.map((b) => {
            const def = b.definition;
            const refs = {
              ublRef: def?.ublRef ?? null,
              edifactRef: def?.edifactRef ?? null,
              x12Ref: def?.x12Ref ?? null,
              cxmlRef: def?.cxmlRef ?? null,
            };
            const showRefs = hasStandardsRefs(refs);
            const open = openId === b.ruleId;
            const sevColor = bindingSeverityColor(b.severity);
            return (
              <div key={b.ruleId}>
                <div className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-semibold" style={{ color: INK }}>
                        {def?.title ?? b.ruleCode ?? "Unlinked rule"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold capitalize" style={{ color: sevColor }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: sevColor, display: "inline-block", flexShrink: 0 }} />
                        {b.severity}
                      </span>
                      {b.blockOnFail && (
                        <span className="text-[11px]" style={{ color: MUTED }}>· blocks delivery</span>
                      )}
                      {!def && (
                        <span className="inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]" style={{ background: SURFACE_2, color: FAINT }}>
                          Legacy
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px]" style={{ color: MUTED }}>
                      {b.fieldPath} {b.operator}{b.expectedValue ? ` ${b.expectedValue}` : ""}
                    </div>
                  </div>
                  {showRefs && (
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : b.ruleId)}
                      aria-expanded={open}
                      aria-label={open ? "Hide standards mapping" : "Show standards mapping"}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-medium"
                      style={{ height: 28, border: `1px solid ${LINE}`, background: open ? SURFACE_2 : SURFACE, color: MUTED, cursor: "pointer" }}
                    >
                      <Info size={12} strokeWidth={2} />
                      Standards
                    </button>
                  )}
                </div>
                {open && showRefs && (
                  <div className="px-5 pb-3.5">
                    <div className="rounded-[8px] px-3.5 py-3" style={{ background: SURFACE_2, border: `1px solid ${LINE}` }}>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: FAINT }}>Maps to</div>
                      <StandardsRefList refs={refs} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── LiveEditNotice ────────────────────────────────────────────────────────────
// Honest revision-context line shown atop the three editor tabs (PO Mapping,
// Delivery, Validation rules). These editors write the LIVE loose config tables
// directly — they do NOT edit a connection revision — so say exactly that, and
// point at the versioned Connection when one exists (link hidden otherwise).

function LiveEditNotice({ connectionId, nounLower }: { connectionId: string | null; nounLower: string }) {
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-[7px] px-3 py-2.5 text-[12px] leading-relaxed"
      style={{ background: SURFACE_2, border: `1px solid ${LINE}`, color: MUTED }}
    >
      <Info size={13} strokeWidth={2} color={MUTED} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <span>
        Edits here apply immediately to live processing.
        {connectionId && (
          <>
            {" "}Versioned snapshots live in this {nounLower}&rsquo;s{" "}
            <Link
              href={`/connections/${connectionId}`}
              style={{ color: BLUE_DEEP, fontWeight: 600 }}
            >
              Connection
            </Link>
            .
          </>
        )}
      </span>
    </div>
  );
}

// ── AcceptanceTab ─────────────────────────────────────────────────────────────

function AcceptanceTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const [editRules, setEditRules] = useState<AcceptanceRule[] | null>(null);
  const [editProtocol, setEditProtocol] = useState("");
  const [editOutputFormat, setEditOutputFormat] = useState("");
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const { data: profile, isLoading, isError } = useQuery<AcceptanceProfile | null>({
    queryKey: ["acceptance-profile", supplierId],
    queryFn: () => getAcceptanceProfile(supplierId),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (body: { protocol?: string; outputFormat?: string; rules: AcceptanceRule[] }) =>
      saveAcceptanceProfile(supplierId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acceptance-profile", supplierId] });
      setEditRules(null);
      setSaveNotice("Rules saved as draft — click “Activate rules” to make them live.");
      setTimeout(() => setSaveNotice(null), 3000);
    },
    onError: (err: Error) => setSaveNotice(`Save failed: ${err.message}`),
  });

  const activateMutation = useMutation({
    mutationFn: (versionNo: number) => activateAcceptanceVersion(supplierId, versionNo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acceptance-profile", supplierId] });
      setSaveNotice("Version activated.");
      setTimeout(() => setSaveNotice(null), 3000);
    },
    onError: (err: Error) => setSaveNotice(`Activate failed: ${err.message}`),
  });

  // Derive the edit rules — start from live profile when first opening the editor
  const rules: AcceptanceRule[] = editRules ?? profile?.rules ?? [];

  function startEdit() {
    setEditRules(profile?.rules ? [...profile.rules] : []);
    setEditProtocol(profile?.protocol ?? "");
    setEditOutputFormat(profile?.outputFormat ?? "");
  }

  function addRule() {
    const blank: AcceptanceRule = {
      scope: "order",
      fieldPath: "currency",
      operator: "required",
      expectedValue: "",
      severity: "error",
      blockOnFail: true,
    };
    setEditRules(prev => [...(prev ?? []), blank]);
  }

  function addQuickRule(rule: AcceptanceRule) {
    setEditRules(prev => [...(prev ?? []), { ...rule }]);
  }

  function updateRule(idx: number, patch: Partial<AcceptanceRule>) {
    setEditRules(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function removeRule(idx: number) {
    setEditRules(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
  }

  function handleSave() {
    saveMutation.mutate({
      protocol: editProtocol || undefined,
      outputFormat: editOutputFormat || undefined,
      rules,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10" style={{ color: FAINT, fontSize: 13 }}>
        Loading acceptance profile…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-10" style={{ color: DANGER, fontSize: 13 }}>
        Failed to load acceptance profile.
      </div>
    );
  }

  const isEditing = editRules !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Notice */}
      {saveNotice && (
        <div
          className="rounded-[7px] px-3 py-2 text-[12.5px]"
          style={{ background: "#ECFDF3", border: "1px solid #A6E9BE", color: "#1E6D29" }}
        >
          {saveNotice}
        </div>
      )}

      {/* Profile header card */}
      <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} strokeWidth={2} color={MUTED} />
            <h3 className="text-[13px] font-semibold" style={{ color: INK }}>Supplier validation rules</h3>
            {profile && (
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{
                  background: profile.status === "active" ? "#E2F1E2" : "#FAEFD6",
                  color: profile.status === "active" ? GREEN_DEEP : "#C97A14",
                }}
              >
                v{profile.versionNo} · {profile.status === "active" ? "live" : profile.status === "draft" ? "draft — not live yet" : profile.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {profile && profile.status === "draft" && !isEditing && (
              <button
                type="button"
                onClick={() => activateMutation.mutate(profile.versionNo)}
                disabled={activateMutation.isPending}
                className="rounded-[7px] px-3 text-[12px] font-semibold"
                style={{ height: 32, background: GREEN_SOFT, color: GREEN_DEEP, border: `1px solid #B8DDB8`, cursor: "pointer" }}
              >
                {activateMutation.isPending ? "Activating…" : "Activate rules"}
              </button>
            )}
            {!isEditing ? (
              <button
                type="button"
                onClick={startEdit}
                className="rounded-[7px] px-3 text-[12px] font-medium"
                style={{ height: 32, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
              >
                {profile ? "Edit rules" : "Add profile"}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditRules(null)}
                  className="rounded-[7px] px-3 text-[12px] font-medium"
                  style={{ height: 32, border: `1px solid ${LINE}`, background: SURFACE, color: MUTED, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="rounded-[7px] px-3 text-[12px] font-semibold"
                  style={{ height: 32, background: INK, color: "#FFFFFF", border: "none", cursor: "pointer" }}
                >
                  {saveMutation.isPending ? "Saving…" : "Save rules"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Protocol + output format now live on the Delivery tab — the single source of truth. */}

        {/* Empty state */}
        {!profile && !isEditing && (
          <p className="px-5 py-6 text-[13px]" style={{ color: MUTED }}>
            No validation rules yet. Add rules to define what this supplier requires on every order — e.g. currency must be EUR, every line needs a supplier code.
          </p>
        )}

        {/* Summary row when not editing */}
        {profile && !isEditing && (
          <div className="flex flex-wrap gap-6 px-5 py-3.5">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>Rules</div>
              <div className="mt-0.5 text-[12.5px] font-medium" style={{ color: INK }}>{profile.rules.length}</div>
            </div>
          </div>
        )}
      </div>

      <div
        className="flex gap-2.5 rounded-[8px] px-3.5 py-3"
        style={{ background: BLUE_SOFT, border: "1px solid #C5DAF5" }}
      >
        <Info size={16} strokeWidth={2} color={BLUE_DEEP} style={{ flexShrink: 0, marginTop: 1 }} />
        <div className="text-[12.5px] leading-relaxed" style={{ color: INK }}>
          <span className="font-semibold">How validation works.</span>{" "}
          Before an order is sent to this supplier, ProcuLink checks it against these rules.{" "}
          <strong style={{ color: DANGER }}>Error</strong> rules block delivery until they’re fixed;{" "}
          <strong style={{ color: "#C97A14" }}>Warning</strong> rules only flag and never block.{" "}
          Validation never changes the order — it’s a gate.
          <span className="mt-1 block" style={{ color: MUTED }}>
            e.g. <em>Currency must be EUR</em> (error) · <em>Every line needs a supplier code</em> (error).
          </span>
        </div>
      </div>

      {/* Rules table / editor */}
      <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
          <span className="text-[13px] font-semibold" style={{ color: INK }}>Rules</span>
          {isEditing && (
            <div className="flex items-center gap-2">
              <select
                value=""
                onChange={(e) => {
                  const t = QUICK_RULES[Number(e.target.value)];
                  if (t) addQuickRule(t.rule);
                  e.currentTarget.value = "";
                }}
                className="rounded-[7px] px-2.5 text-[12px] font-medium"
                style={{ height: 30, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
              >
                <option value="">+ Add common rule…</option>
                {QUICK_RULES.map((q, i) => (
                  <option key={i} value={i}>{q.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addRule}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-medium"
                style={{ height: 30, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
              >
                <Plus size={13} strokeWidth={2.2} />
                Add rule
              </button>
            </div>
          )}
        </div>

        {rules.length === 0 ? (
          <p className="px-5 py-5 text-[12.5px]" style={{ color: MUTED }}>
            {isEditing ? "No rules yet — click \"Add rule\" to start." : "No rules defined."}
          </p>
        ) : isEditing ? (
          /* Edit mode: form rows */
          <div className="flex flex-col divide-y" style={{ borderColor: LINE }}>
            {rules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 md:grid-cols-3">
                <select
                  value={rule.scope}
                  onChange={e => {
                    const scope = e.target.value as AcceptanceRule["scope"];
                    updateRule(idx, { scope, fieldPath: firstFieldFor(scope) });
                  }}
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE, cursor: "pointer" }}
                >
                  <option value="order">Order</option>
                  <option value="line">Line</option>
                </select>
                <select
                  value={rule.fieldPath}
                  onChange={e => updateRule(idx, { fieldPath: e.target.value })}
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE, cursor: "pointer" }}
                >
                  {FIELD_OPTIONS[rule.scope].map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={rule.operator}
                  onChange={e => updateRule(idx, { operator: e.target.value as AcceptanceRule["operator"] })}
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE, cursor: "pointer" }}
                >
                  {OPERATORS.map(op => (
                    <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={rule.expectedValue ?? ""}
                  onChange={e => updateRule(idx, { expectedValue: e.target.value })}
                  placeholder="value"
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE }}
                />
                <select
                  value={rule.severity}
                  onChange={e => updateRule(idx, { severity: e.target.value as AcceptanceRule["severity"] })}
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE, cursor: "pointer" }}
                >
                  <option value="error">Error</option>
                  <option value="warning">Warning</option>
                </select>
                <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: MUTED }}>
                  <input
                    type="checkbox"
                    checked={rule.blockOnFail}
                    onChange={e => updateRule(idx, { blockOnFail: e.target.checked })}
                    style={{ accentColor: INK, cursor: "pointer" }}
                  />
                  Blocks delivery
                </label>
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="w-full rounded-[5px] px-2 text-[11px] font-medium sm:col-span-2 sm:w-auto sm:justify-self-end md:col-span-3"
                  style={{ height: 28, background: "#FBE3E3", color: DANGER, border: "none", cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Read mode: compact table */
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                    {["Scope", "Field path", "Operator", "Value", "Severity", "Blocks"].map((h, i) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                        style={{ color: MUTED, textAlign: i === 5 ? "center" : "left" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, i) => (
                    <tr key={i} style={{ borderBottom: i < rules.length - 1 ? `1px solid ${LINE}` : undefined }}>
                      <td className="px-4 py-3 text-[12px] font-medium capitalize" style={{ color: MUTED }}>{rule.scope}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold" style={{ color: INK, fontFamily: "'JetBrains Mono',monospace" }}>{rule.fieldPath}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: MUTED }}>{rule.operator}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: MUTED, fontFamily: "'JetBrains Mono',monospace" }}>{rule.expectedValue ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold capitalize" style={{ color: SEVERITY_DOT[rule.severity] }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: SEVERITY_DOT[rule.severity], display: "inline-block", flexShrink: 0 }} />
                          {rule.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-[12px]" style={{ color: rule.blockOnFail ? INK : FAINT }}>
                        {rule.blockOnFail ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile rule cards */}
            <div className="sm:hidden flex flex-col divide-y" style={{ borderColor: LINE }}>
              {rules.map((rule, i) => (
                <div key={i} className="flex flex-col gap-1.5 px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] font-semibold capitalize" style={{ color: INK, fontFamily: "'JetBrains Mono',monospace" }}>{rule.fieldPath}</span>
                    <span className="text-[11px] capitalize" style={{ color: MUTED }}>{rule.scope}</span>
                  </div>
                  <div className="text-[12px]" style={{ color: MUTED }}>{rule.operator}{rule.expectedValue ? ` → ${rule.expectedValue}` : ""}</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold capitalize" style={{ color: SEVERITY_DOT[rule.severity] }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: SEVERITY_DOT[rule.severity], display: "inline-block" }} />
                      {rule.severity}
                    </span>
                    {rule.blockOnFail && <span className="text-[11px]" style={{ color: MUTED }}>· blocks</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Active rule bindings (Group V4) — read-only, with standards refs. */}
      <SupplierRuleBindingsPanel supplierId={supplierId} />
    </div>
  );
}

// ── LiveMappingsTab ───────────────────────────────────────────────────────────
// Real saved SKU mappings for a supplier, fetched from
// GET /api/suppliers/{id}/mappings (apiClient.getSupplierMappings). The mock
// branch above renders a richly-styled table from DEMO_MOCK; this is its live
// twin. The real DTO carries { buyerItemCode, supplierItemCode, confidence,
// source } only — there is NO description field on the backend, so the
// Description column the mock shows is intentionally dropped here (offer↔works).
// The "Add mapping" affordance lives in the shared card header above; the full
// create/edit flow is the Mapping Editor (linked there), so this is read-only.

// Maps the backend's lowercase source strings ("manual" | "imported" |
// "suggested") to a display label + the existing SOURCE_PILL colour key. AI
// suggestions are surfaced as the violet "AI" pill to match the mock vocabulary.
function normalizeSource(source?: string): { label: string; pillKey: string } {
  switch ((source ?? "").toLowerCase()) {
    case "imported":  return { label: "Imported",  pillKey: "Imported" };
    case "suggested": return { label: "AI",        pillKey: "AI" };
    case "inherited": return { label: "Inherited", pillKey: "Inherited" };
    case "manual":    return { label: "Manual",    pillKey: "Manual" };
    default:          return { label: source ? source : "Manual", pillKey: "Manual" };
  }
}

// Backend confidence is a 0–1 float; render as a whole-number percentage.
function confPct(confidence?: number): number {
  if (confidence == null) return 100;
  return Math.round(confidence * 100);
}

function LiveMappingsTab({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  // Gate the query like every other live query in the app: in mock mode the
  // parent never renders this branch, but keep the canonical guard so the query
  // doesn't fire before Clerk is ready (which would 401).
  const queryEnabled = useQueriesEnabled();

  const { data: mappings = [], isLoading, isError } = useQuery<SupplierMapping[]>({
    queryKey: ["supplier-mappings", supplierId],
    queryFn: () => apiClient.getSupplierMappings(supplierId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 800,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6 sm:px-5">
        <div className="flex flex-col gap-2.5" role="status" aria-busy="true">
          <span className="sr-only">Loading mappings…</span>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-3.5 w-24 rounded animate-pulse" style={{ background: SURFACE_2 }} />
              <div className="h-3.5 w-24 rounded animate-pulse" style={{ background: SURFACE_2 }} />
              <div className="ml-auto h-3.5 w-16 rounded animate-pulse" style={{ background: "#F2F4F9" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: DANGER }}>
        Couldn’t load mappings for {supplierName}. Check your connection and try refreshing.
      </p>
    );
  }

  if (mappings.length === 0) {
    return (
      <div className="px-4 py-8 text-center sm:px-5">
        <p className="text-[13px] font-medium" style={{ color: INK }}>No saved SKU mappings yet</p>
        <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] leading-5" style={{ color: MUTED }}>
          Mappings link this supplier’s item codes to your buyer codes. They’re saved automatically
          when you resolve an order, or add them in the{" "}
          <a href="/library/mappings" style={{ color: GREEN_TEXT, fontWeight: 500 }}>Mapping Editor</a>.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet: real table (≥sm). */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 560 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${LINE}` }}>
              {["Buyer code", "Supplier code", "Source", "Confidence"].map((h, i) => (
                <th
                  key={h}
                  className="px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                  style={{ color: MUTED, textAlign: i === 3 ? "right" : "left" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => {
              const src = normalizeSource(m.source);
              const pill = SOURCE_PILL[src.pillKey] ?? SOURCE_PILL.Manual;
              const pct = confPct(m.confidence);
              return (
                <tr key={m.id} style={{ borderBottom: i < mappings.length - 1 ? `1px solid ${LINE}` : undefined }}>
                  <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: INK, fontFamily: MONO }}>{m.buyerItemCode}</td>
                  <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: GREEN_DEEP, fontFamily: MONO }}>{m.supplierItemCode}</td>
                  <td className="px-5 py-3" style={{ textAlign: "left" }}>
                    <span className="chip" style={{ background: pill.bg, color: pill.fg }}>{src.label}</span>
                  </td>
                  <td className="px-5 py-3" style={{ textAlign: "right" }}>
                    <span className={`conf ${confClass(pct)} tabular-nums`}>{pct}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones (<sm): stacked row-cards. */}
      <div className="sm:hidden">
        {mappings.map((m, i) => {
          const src = normalizeSource(m.source);
          const pill = SOURCE_PILL[src.pillKey] ?? SOURCE_PILL.Manual;
          const pct = confPct(m.confidence);
          return (
            <div
              key={m.id}
              className="flex flex-col gap-2 px-4 py-3.5"
              style={{ borderBottom: i < mappings.length - 1 ? `1px solid ${LINE}` : undefined }}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ fontFamily: MONO }}>
                <span style={{ color: INK }}>{m.buyerItemCode}</span>
                <span style={{ color: BORDER_STRONG }}>→</span>
                <span style={{ color: GREEN_DEEP }}>{m.supplierItemCode}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="chip" style={{ background: pill.bg, color: pill.fg }}>{src.label}</span>
                <span className={`conf ${confClass(pct)} tabular-nums`}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── CatalogTab ────────────────────────────────────────────────────────────────
// The supplier's product catalog = ground truth for AI suggestions. Importing it
// lets the AI suggest ONLY real codes (catalog-grounded + allow-list guard) and
// powers the manual-entry typeahead. Import CSV/XLSX (columns: code, name, unit,
// price, barcode, external_id — auto-detected).
function CatalogTab({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const queryEnabled = useQueriesEnabled();
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-catalog", supplierId, q],
    queryFn: () => getSupplierCatalog(supplierId, q || undefined, 200),
    enabled: queryEnabled,
    staleTime: 15_000,
  });
  // Besides this tab's own list key, refresh the review screen's shared
  // ["supplier-catalog-codes"] probe (typeahead + CatalogHintCard self-resolve)
  // and — on import — the onboarding status (hasCatalog can flip step 2).
  const invalidateCatalogCaches = () => {
    void qc.invalidateQueries({ queryKey: ["supplier-catalog", supplierId] });
    void qc.invalidateQueries({ queryKey: ["supplier-catalog-codes", supplierId] });
  };
  const importMut = useMutation({
    mutationFn: (file: File) => importSupplierCatalog(supplierId, file),
    onSuccess: (r) => { setNotice(`Imported ${r.created} new, ${r.updated} updated, ${r.skipped} skipped — ${r.total} products total.`); invalidateCatalogCaches(); void invalidateOnboardingStatus(qc); },
    onError: (e) => setNotice(e instanceof Error ? e.message : "Import failed."),
  });
  const clearMut = useMutation({
    mutationFn: () => clearSupplierCatalog(supplierId),
    onSuccess: (r) => { setNotice(`Cleared ${r.deleted} products.`); invalidateCatalogCaches(); void invalidateOnboardingStatus(qc); },
  });

  const items = data?.items ?? [];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Product catalog{data ? ` · ${data.total}` : ""}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            The supplier&apos;s valid product codes. With a catalog, the AI suggests only real codes and unknown codes are flagged.
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importMut.mutate(f); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={importMut.isPending}
          style={{ minHeight: 36, padding: "0 14px", border: "none", background: "#2E8E3A", color: "#FFFFFF", borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: importMut.isPending ? 0.6 : 1 }}>
          {importMut.isPending ? "Importing…" : "Import CSV / XLSX"}
        </button>
        {!!data?.total && (
          <button type="button" onClick={() => { if (confirm("Clear the entire catalog for this supplier?")) clearMut.mutate(); }} disabled={clearMut.isPending}
            style={{ minHeight: 36, padding: "0 12px", border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#C53A3A", borderRadius: 6, fontSize: 12.5, cursor: "pointer" }}>
            Clear
          </button>
        )}
      </div>

      {notice && <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, padding: "8px 10px", background: "#F6F7FA", border: "1px solid #E2E6EE", borderRadius: 6 }}>{notice}</div>}

      {(data?.total ?? 0) > 0 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code / name / barcode"
          style={{ width: "100%", maxWidth: 360, minHeight: 36, border: "1px solid #C6CDDA", borderRadius: 6, padding: "5px 10px", fontSize: 12.5, marginBottom: 10 }} />
      )}

      {isLoading ? (
        <div style={{ fontSize: 12, color: MUTED }}>Loading catalog…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, padding: "18px 14px", background: "#F6F7FA", border: "1px dashed #C6CDDA", borderRadius: 8, textAlign: "center" }}>
          {q ? "No products match." : "No products yet. Import a CSV/XLSX (columns: code, name, unit, price, barcode) so the AI suggests only real supplier codes."}
        </div>
      ) : (
        <div style={{ border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
          <table className="w-full border-collapse" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#F6F7FA", color: MUTED, textAlign: "left" }}>
                <th style={{ padding: "7px 10px", fontWeight: 700 }}>Code</th>
                <th style={{ padding: "7px 10px", fontWeight: 700 }}>Name</th>
                <th style={{ padding: "7px 10px", fontWeight: 700 }}>Unit</th>
                <th style={{ padding: "7px 10px", fontWeight: 700, textAlign: "right" }}>Price</th>
                <th style={{ padding: "7px 10px", fontWeight: 700 }}>Barcode</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #EEF0F4" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "'JetBrains Mono',monospace", color: INK }}>{p.code}</td>
                  <td style={{ padding: "6px 10px", color: INK }}>{p.name ?? "—"}</td>
                  <td style={{ padding: "6px 10px", color: MUTED }}>{p.unit ?? "—"}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: MUTED }}>{p.price != null ? p.price : "—"}</td>
                  <td style={{ padding: "6px 10px", fontFamily: "'JetBrains Mono',monospace", color: MUTED }}>{p.barcode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > items.length && (
            <div style={{ padding: "6px 10px", fontSize: 11, color: MUTED, borderTop: "1px solid #EEF0F4" }}>Showing {items.length} of {data.total}. Refine with search.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function SupplierDockProfile({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  // Direction-aware party labels so an inbound org's profile isn't a split-brain
  // "Supplier" UI while its list reads "Customers".
  const { labels } = useOrderDirection();
  const partyNoun = labels.counterpartyNoun;            // "Supplier" | "Customer"
  const partyNounLower = partyNoun.toLowerCase();        // "supplier" | "customer"
  const partyPluralLower = labels.counterpartyPlural.toLowerCase(); // "suppliers" | "customers"
  // Initial tab honours a `?tab=` deep-link (e.g. the onboarding checklist's
  // "Add item codes" → ?tab=catalog and "Set up delivery" → ?tab=delivery
  // CTAs). Validated against the Tab union via TABS; falls back to "overview".
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get("tab");
  const [tab, setTab] = useState<Tab>(isTab(requestedTab) ? requestedTab : "overview");
  // ?tab= changes while MOUNTED (e.g. help-slideover guide links like
  // "?tab=catalog" on this page) must also switch tabs; manual tab clicks
  // don't write the URL back, so the sync fires only when the param VALUE
  // itself changes.
  useTabParamSync<Tab>(requestedTab, isTab, setTab);
  const [poMappingConfig, setPoMappingConfig] = useState<PoMappingConfig | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // Keep the active tab visible when the strip overflows horizontally (mobile).
  // DOM-only UI side-effect — not data fetching.
  useEffect(() => {
    const el = tabRefs.current[tab];
    el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [tab]);

  async function doDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteSupplier(id);
      await qc.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/library/suppliers");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : `Could not delete ${partyNounLower}.`);
      setDeleting(false);
    }
  }

  const { data: supplierList, isLoading, error } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: !isApiMockMode,
  });

  // Resolve this supplier's versioned Connection (if one exists) so the header
  // can link to it and the editor tabs can point at the versioned snapshots.
  // No connection yet → links stay hidden (a connection is created the first
  // time the supplier is configured).
  const connectionsEnabled = useQueriesEnabled();
  const { data: connectionList } = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: connectionsEnabled,
    staleTime: 60_000,
    retry: 1,
  });
  const connectionId = connectionList?.find((c) => c.supplierId === id)?.id ?? null;

  // In mock mode: all fields come from DEMO_MOCK.
  // In real mode: only name comes from the API; metrics show honest placeholders.
  const realSupplier = !isApiMockMode
    ? (supplierList?.find(s => s.id === id) ?? null)
    : null;

  const name = isApiMockMode ? DEMO_MOCK.name : (realSupplier?.name ?? "");
  const code = isApiMockMode ? DEMO_MOCK.code : (realSupplier ? deriveCode(realSupplier.name) : "—");

  if (!isApiMockMode && isLoading) {
    return (
      <PageShell variant="wide" className="flex items-center justify-center">
        <span style={{ fontSize: 13, color: FAINT }}>Loading {partyNounLower}…</span>
      </PageShell>
    );
  }

  if (!isApiMockMode && error) {
    return (
      <PageShell variant="wide" className="flex flex-col items-center justify-center gap-3">
        <span style={{ fontSize: 13, color: DANGER }}>Failed to load {partyNounLower}</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to {partyPluralLower}
        </button>
      </PageShell>
    );
  }

  if (!isApiMockMode && !isLoading && realSupplier === null) {
    return (
      <PageShell variant="wide" className="flex flex-col items-center justify-center gap-3">
        <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{partyNoun} not found</span>
        <button
          onClick={() => router.push("/library/suppliers")}
          style={{ fontSize: 12.5, color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer" }}
        >
          ← Back to {partyPluralLower}
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell variant="wide" className="flex flex-col">
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(11,26,47,0.45)" }}
          onClick={() => { if (!deleting) { setConfirmDelete(false); setDeleteError(null); } }}
        >
          <div
            className="w-full max-w-[420px] rounded-[12px] p-5"
            style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: "0 12px 40px rgba(11,26,47,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold" style={{ color: INK, fontFamily: DISPLAY }}>
              Delete {name || `this ${partyNounLower}`}?
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
              This removes it from your {partyNounLower} list. Past orders are kept for audit. This can’t be undone here.
            </p>
            {deleteError && (
              <div className="mt-3 rounded-[6px] px-3 py-2 text-[12px]" style={{ background: "#FBE3E3", color: DANGER, border: "1px solid #F0C2C2" }}>
                {deleteError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                disabled={deleting}
                className="rounded-[7px] px-3 text-[12.5px] font-medium"
                style={{ height: 34, border: `1px solid ${LINE}`, background: SURFACE, color: MUTED, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={deleting}
                className="rounded-[7px] px-3 text-[12.5px] font-semibold"
                style={{ height: 34, border: "none", background: DANGER, color: "#FFFFFF", cursor: "pointer", opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? "Deleting…" : `Delete ${partyNounLower}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header — bespoke detail header (back link + avatar + meta + actions) on the
          grey canvas; PageHeader's string-title API can't carry the avatar/meta row. */}
      <div className="flex flex-col gap-3.5 pb-4 flex-shrink-0">
        <button
          onClick={() => router.push("/library/suppliers")}
          className="inline-flex items-center gap-1 self-start text-[12.5px] font-medium"
          style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
        >
          <ChevronLeft size={14} strokeWidth={2.2} />
          {labels.counterpartyPlural}
        </button>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            {/* Supplier avatar */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: GREEN_SOFT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Truck size={22} strokeWidth={2} color={GREEN_DEEP} />
            </div>

            <div className="min-w-0">
              <h1
                className="text-[24px] leading-none font-semibold tracking-[-0.02em] sm:text-[26px]"
                style={{ fontFamily: DISPLAY, color: INK }}
              >
                {name}
              </h1>
              {/* Inline meta row — code · required format chip · delivery channel chip · auto-process pill */}
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {code && code !== "—" && (
                  <span className="text-[11.5px]" style={{ color: FAINT, fontFamily: MONO }}>
                    {code}
                  </span>
                )}
                {isApiMockMode && (
                  <>
                    <SrcChip type={DEMO_MOCK.summary.requiredFormat} />
                    <span className="chip" style={{ background: SURFACE_2, color: MUTED }}>
                      {DEMO_MOCK.summary.deliveryChannel}
                    </span>
                    <span className={`pill ${DEMO_MOCK.autoProcess ? "pill-ready" : "pill-new"}`}>
                      <span className="dot" />
                      Auto-process: {DEMO_MOCK.autoProcess ? "ON" : "OFF"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:ml-auto sm:self-center">
            {/* Versioned Connection — draft → test → publish snapshots for this supplier.
                Hidden when no connection exists yet. */}
            {connectionId && (
              <Link
                href={`/connections/${connectionId}`}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium no-underline"
                style={{ height: 34, border: `1px solid ${BORDER_STRONG}`, background: SURFACE, color: INK }}
              >
                <GitBranch size={14} strokeWidth={2} color={MUTED} />
                Connection
              </Link>
            )}
            {/* Destructive action — soft-deletes the supplier (past orders retained for audit) */}
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium"
              style={{ height: 34, border: "1px solid #E9C4C4", background: SURFACE, color: DANGER, cursor: "pointer" }}
            >
              <Trash2 size={14} strokeWidth={2} color={DANGER} />
              Delete {partyNounLower}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="relative flex-shrink-0">
        <div
          className="flex items-center gap-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ borderBottom: `1px solid ${LINE}`, height: 44 }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              id={t.id === "delivery" ? "supplier-tab-delivery" : undefined}
              onClick={() => setTab(t.id)}
              className="h-full shrink-0 px-4 text-[13px] font-medium transition-colors relative"
              style={{
                color: tab === t.id ? INK : MUTED,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                borderBottom: tab === t.id ? `2px solid ${BLUE}` : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Subtle right-edge fade signalling more tabs are scrollable off-screen. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 w-8"
          style={{ height: 43, background: `linear-gradient(to right, rgba(246,247,250,0), ${BG})` }}
        />
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-0 overflow-auto pt-4">
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
                  className="monument rounded-[10px] px-4 py-4"
                  style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
                >
                  <div className="m-label">{label}</div>
                  <div
                    className="m-value"
                    style={{ fontSize: 30, color: isApiMockMode ? INK : BORDER_STRONG }}
                  >
                    {value}
                  </div>
                  <div className="m-sub" style={{ color: subAccent ? GREEN_DEEP : FAINT }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Summary + recent deliveries */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Delivery summary */}
              <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <Info size={15} strokeWidth={2} color={MUTED} />
                  <h3 className="text-[13px] font-semibold" style={{ color: INK }}>Delivery summary</h3>
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
                        <span className="flex-shrink-0 text-[12px]" style={{ color: MUTED }}>{k}</span>
                        <span
                          className="min-w-0 truncate text-right text-[12px] font-medium"
                          style={{ color: INK, fontFamily: mono ? MONO : undefined }}
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
              <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <Clock size={15} strokeWidth={2} color={MUTED} />
                  <h3 className="text-[13px] font-semibold" style={{ color: INK }}>Recent deliveries</h3>
                </div>
                {isApiMockMode ? (
                  <div className="px-4 py-1 sm:px-5">
                    {DEMO_MOCK.recent.map((r, i) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2.5 py-2.5 sm:gap-3"
                        style={{ borderBottom: i < DEMO_MOCK.recent.length - 1 ? `1px solid ${LINE}` : undefined }}
                      >
                        <span className="flex-shrink-0 text-[12px] font-semibold" style={{ color: BLUE_DEEP, fontFamily: MONO }}>{r.id}</span>
                        <span className="ml-auto min-w-0 truncate text-right text-[11.5px]" style={{ color: FAINT, fontFamily: MONO }}>{r.amount}</span>
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
          <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Card header */}
            <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-5 sm:flex-row sm:items-center" style={{ borderBottom: `1px solid ${LINE}` }}>
              <Link2 size={17} strokeWidth={2} color={MUTED} className="flex-shrink-0" />
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold" style={{ color: INK }}>Saved SKU mappings</h3>
                <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                  {isApiMockMode ? `${DEMO_MOCK.summary.savedMappings.toLocaleString()} buyer → supplier item codes` : "Buyer → supplier item codes"}
                </p>
              </div>
              <a
                href="/library/mappings"
                className="inline-flex items-center gap-1.5 self-stretch justify-center rounded-[7px] px-3 text-[12.5px] font-medium sm:ml-auto sm:self-center"
                style={{ height: 34, border: `1px solid ${BORDER_STRONG}`, background: SURFACE, color: INK, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                <Plus size={14} strokeWidth={2.2} color={MUTED} />
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
                            <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: INK, fontFamily: MONO }}>{m.buyer}</td>
                            <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: GREEN_DEEP, fontFamily: MONO }}>{m.supplier}</td>
                            <td className="px-5 py-3 text-[12.5px]" style={{ color: MUTED }}>{m.desc}</td>
                            <td className="px-5 py-3" style={{ textAlign: "left" }}>
                              <span className="chip" style={{ background: pill.bg, color: pill.fg }}>
                                {m.source}
                              </span>
                            </td>
                            <td className="px-5 py-3" style={{ textAlign: "right" }}>
                              <span className={`conf ${confClass(m.conf)} tabular-nums`}>{m.conf}%</span>
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
                        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ fontFamily: MONO }}>
                          <span style={{ color: INK }}>{m.buyer}</span>
                          <span style={{ color: BORDER_STRONG }}>→</span>
                          <span style={{ color: GREEN_DEEP }}>{m.supplier}</span>
                        </div>
                        {/* Description */}
                        <div className="text-[12.5px]" style={{ color: MUTED }}>{m.desc}</div>
                        {/* Source + confidence pills */}
                        <div className="flex items-center gap-2">
                          <span className="chip" style={{ background: pill.bg, color: pill.fg }}>
                            {m.source}
                          </span>
                          <span className={`conf ${confClass(m.conf)} tabular-nums`}>{m.conf}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <LiveMappingsTab supplierId={id} supplierName={name} />
            )}
          </div>
        )}

        {tab === "po-mapping" && (
          <>
          <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} />
          <PoMappingEditor
            supplierId={id}
            initialConfig={poMappingConfig}
            saving={savingMapping}
            supplierName={name}
            onApplyTemplate={async (templateId) => {
              // Persists the template server-side and refreshes the editor from
              // the saved config. The PO mapping config is held in local state
              // (not a TanStack query), so updating it here IS the refresh.
              const saved = await applyPoMappingTemplate(id, templateId);
              setPoMappingConfig(saved);
              return saved;
            }}
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
          </>
        )}

        {tab === "catalog" && <CatalogTab supplierId={id} />}

        {tab === "delivery" && (
          <>
            <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} />
            <DeliveryConfigEditor supplierId={id} />
          </>
        )}

        {tab === "acceptance" && (
          <>
            <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} />
            <AcceptanceTab supplierId={id} />
          </>
        )}

        {/* Rules / Output templates / Connectors / History are managed globally (Library +
            Operations); supplier-scoped versions aren't built yet, so we don't surface empty
            placeholder tabs here. Re-add a tab once its supplier-scoped feature ships. */}
      </div>
    </PageShell>
  );
}

/* -------- SrcChip — format/source badge (.src-chip + .src-{TYPE}, ported design class) -------- */
function SrcChip({ type }: { type: string }) {
  // Normalise to the class suffixes defined in globals.css (.src-PDF/.src-XLSX/.src-CSV/
  // .src-cXML/.src-XML/.src-EDI/.src-EMAIL/.src-API/.src-JSON/.src-UBL). Default = neutral CSV tone.
  const known = ["PDF", "XLSX", "CSV", "cXML", "XML", "EDI", "EDIFACT", "EMAIL", "API", "JSON", "UBL"];
  const match = known.find((k) => k.toLowerCase() === type.toLowerCase());
  const suffix = match === "EDIFACT" ? "EDI" : (match ?? "CSV");
  return <span className={`src-chip src-${suffix}`}>{type}</span>;
}

/* -------- MiniStatusPill — compact status badge for the recent-deliveries list -------- */
/* Uses the ported .pill / .pill-* classes so colours match the design StatusPill exactly.
   Labels come from the canonical statusLabel() map (UnifiedStatusBadge) so this pill
   never drifts from the unified vocabulary (e.g. ready → "Normalized", sent → "Delivered"). */
function MiniStatusPill({ status }: { status: "review" | "ready" | "sent" }) {
  const PILL_CLS: Record<string, string> = {
    review: "pill-review",
    ready:  "pill-ready",
    sent:   "pill-sent",
  };
  return (
    <span className={`pill ${PILL_CLS[status]}`}>
      <span className="dot" />
      {statusLabel(status)}
    </span>
  );
}
