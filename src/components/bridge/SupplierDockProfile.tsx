"use client";

// Supplier Dock Profile — /library/suppliers/[id]
// §5.8 — Header + tabs: Overview · Mappings · PO Mapping · Delivery · Acceptance

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Trash2, Info, Clock, Link2, Truck, Plus, ShieldCheck, GitBranch, RefreshCw } from "lucide-react";
import { PoMappingEditor } from "./PoMappingEditor";
import { DeliveryConfigEditor } from "./DeliveryConfigEditor";
import { DeliveryGuidedSetup } from "./DeliveryGuidedSetup";
import { CatalogSourceEditor } from "./CatalogSourceEditor";
import { SupplierHistoryTab } from "@/components/connections/SupplierHistoryTab";
import { getPoMapping, upsertPoMapping, deletePoMapping } from "@/lib/api/mapping";
import { getDeliveryConfig } from "@/lib/api/delivery";
import { getOrgSettings } from "@/lib/api/settings";
import { API_BASE_URL } from "@/lib/api/core";
import { apiClient, isApiMockMode, getAcceptanceProfile, saveAcceptanceProfile, activateAcceptanceVersion, applyPoMappingTemplate, getSupplierCatalog, importSupplierCatalog, clearSupplierCatalog, getSupplierRuleBindings, listConnections, type SupplierRuleBinding } from "@/lib/api-client";
import { StandardsRefList, hasStandardsRefs } from "./StandardsRefList";
import { FileChip } from "./FileChip";
import { confidenceTier } from "@/lib/ds-tokens";
import { statusLabel, UnifiedStatusBadge } from "./UnifiedStatusBadge";
import { formatMoney } from "./review/orderDisplay";
import { pagePopulation, practiceOrderNote } from "./orderCountContract";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { PageShell } from "./layout/PageShell";
import { SupplierIdentityCard } from "./SupplierIdentityCard";
import { useTabParamSync } from "@/lib/tab-param-sync";
import { useConfirm } from "@/components/ui/confirm";
import type { DeliveryConfig, PoMappingConfig } from "@/lib/api/types";
import type { AcceptanceRule, AcceptanceProfile, SupplierMapping, OrdersPage } from "@/types/procurement";
import { isPlanGate, PlanGateNotice } from "@/components/bridge/PlanGateNotice";

type Tab = "overview" | "mappings" | "catalog" | "po-mapping" | "delivery" | "acceptance" | "history";

// ── Design tokens (ported from tokens.css / globals.css) ─────────────────────
// Buyer side = blue (#1E66C9, also the ACTIVE accent), supplier side = forest green.
// These map 1:1 to the CSS custom properties so the screen matches screen-supplier.jsx.

// Forest-green supplier palette — avatar tile, supplier codes, "imported" pills, deep text.
// (Solid --brand-green #2E8E3A is supplied by the ported .pill/.toggle/.conf classes, so it
// isn't declared here; this component only needs the deep-text + soft-tile tones.)
const GREEN_DEEP  = "#1E6D29";  // --brand-green-deep (supplier code + deep-green text)
const GREEN_SOFT  = "#E9F1EA";  // --brand-green-soft (avatar tile + confidence/imported pill bg)
const GREEN_TEXT  = GREEN_DEEP; // alias retained for readability at call sites

// Buyer blue — the ACTIVE affordance (tab underline), record-id links, "inherited" provenance.
const BLUE        = "#1E66C9";  // --brand-blue       (ACTIVE accent + record-id links)
const BLUE_DEEP   = "#0F4FA8";  // --brand-blue-deep
const BLUE_SOFT   = "#EAF0F8";  // --brand-blue-soft  (inherited pill bg / selected row)

// Ink + chrome.
const INK         = "#0B1A2F";  // --ink
const MUTED       = "#5E6779";  // --ink-muted  (body labels, card-header glyphs)
const FAINT       = "var(--ink-faint)";  // --ink-faint  (eyebrows, secondary mono)
const LINE        = "#E5E8EE";  // --border     (one hairline for every divider/border)
const BORDER_STRONG = "#CBD0DA";// --border-strong (button outlines)
const SURFACE     = "#FFFFFF";  // --surface
const SURFACE_2   = "#F1F3F7";  // --surface-2  (neutral chip bg)
const BG          = "#F6F7FA";  // --bg

// Semantic. (Amber tones are carried by the ported .conf-mid / .pill-review classes.)
const DANGER      = "#B43838";  // --danger
const AI          = "#6F4FCE";  // --ai      (AI provenance pill fg)
const AI_SOFT     = "#F0EAFB";  // --ai-soft (AI provenance pill bg)

// The KPI cards' hairline lift, declared once. It was inline in the single stat-card
// map; splitting that map into a mock strip and a fetched card would have made it a
// second copy of the same rgba literal.
const CARD_SHADOW = "0 1px 2px rgba(11,26,47,0.04)";

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

// WP-25 (DESIGN-DB-1 §6.2): the tab IDs are code and are UNCHANGED, so every
// existing `?tab=` deep link (checklist CTAs, help slideover, onboarding) still
// resolves to the same panel. Only the words moved:
//   mappings   → "Item codes"    (a buyer-code → supplier-code lookup)
//   po-mapping → "Order layout"  (which column holds which field)
//   acceptance → "Rules"         ("validation" is ours, not theirs)
//   history    → "Changes"       ("History" read as PAST ORDERS, which is what
//                                 Overview's recent-orders list already is; this
//                                 tab is the version history of the SETUP)
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview",    label: "Overview"     },
  { id: "mappings",    label: "Item codes"   },
  { id: "catalog",     label: "Catalog"      },
  { id: "po-mapping",  label: "Order layout" },
  { id: "delivery",    label: "Delivery"     },
  { id: "acceptance",  label: "Rules"        },
  // STRUCT-1: the versioned-connection history view (was the standalone
  // /connections page; that route still resolves) now lives as a supplier tab.
  { id: "history",     label: "Changes"      },
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

/**
 * The provenance a row gets when the backend did not give it one, or gave one
 * this frontend has never heard of. Deliberately NOT a member of SOURCE_PILL:
 * an unattributed row is rendered as plain text rather than as a chip, the same
 * way `MappingConfidence` renders an unscored row, so it cannot be mistaken for
 * one of the four provenances we can actually vouch for.
 */
const UNATTRIBUTED_SOURCE = "unattributed";

// Confidence-chip class selector — maps a percentage to the ported .conf-* classes
// (.conf-hi green / .conf-mid amber / .conf-lo danger). The thresholds come from
// confidenceTier() rather than being restated here (WP-30): four places used to
// carry their own copy and three of them disagreed.
function confClass(pct: number): string {
  const tier = confidenceTier(pct);
  return tier === "ok" ? "conf-hi" : tier === "warn" ? "conf-mid" : "conf-lo";
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
  error:   "#B43838",
  warning: "#B36D14",
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

// The dot AND the word beside it are painted with this colour, and the severity
// string is a free-text column on the backend (`SupplierAcceptanceRule.Severity`),
// so a value this frontend has not heard of DOES reach here. It used to fall
// through to BLUE — the calm "info" tone — which reads as "we looked at this and
// it is the mildest kind". The truth is that we could not classify it at all, so
// an unrecognised severity now gets the neutral ink used for text we are not
// making a claim about. "info" keeps its blue because it is a real tone, not the
// bucket everything unknown lands in.
function bindingSeverityColor(severity: string): string {
  const s = (severity ?? "").toLowerCase();
  if (s === "error") return DANGER;
  if (s === "warning") return "#B36D14";
  if (s === "info") return BLUE;
  return MUTED;
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
          <span className="text-[13px] font-semibold" style={{ color: INK }}>Rules in use</span>
          {!showLoading && !isError && (
            <span className="text-[11.5px]" style={{ color: FAINT }}>{bindings.length}</span>
          )}
        </div>
        <span className="text-[11px]" style={{ color: FAINT }}>with standards mapping</span>
      </div>

      {showLoading && (
        <div className="px-5 py-6 text-[12.5px]" style={{ color: FAINT }}>Loading rules…</div>
      )}

      {!showLoading && isError && (
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <span className="text-[12.5px]" style={{ color: DANGER }}>Couldn&apos;t load these rules.</span>
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
          No rules are in use for this supplier yet. Add and switch on a rule above and it appears here, with the standard it maps to.
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
                      style={{ minHeight: "var(--tap-min)", height: 28, border: `1px solid ${LINE}`, background: open ? SURFACE_2 : SURFACE, color: MUTED, cursor: "pointer" }}
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

function LiveEditNotice({
  connectionId,
  nounLower,
  onOpenHistory,
}: {
  connectionId: string | null;
  nounLower: string;
  // STRUCT-1: switch to the in-page History tab instead of routing to the
  // standalone /connections page (still resolvable, just out of the launch nav).
  onOpenHistory: () => void;
}) {
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-[7px] px-3 py-2.5 text-[12px] leading-relaxed"
      style={{ background: SURFACE_2, border: `1px solid ${LINE}`, color: MUTED }}
    >
      <Info size={13} strokeWidth={2} color={MUTED} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <span>
        Edits here take effect right away.
        {connectionId && (
          <>
            {" "}Every saved version is kept in this {nounLower}&rsquo;s{" "}
            <button
              type="button"
              onClick={onOpenHistory}
              style={{ color: BLUE_DEEP, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", textDecoration: "underline" }}
            >
              version history
            </button>
            , where you can review or roll back.
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
  // Typed, because this notice carries FAILURES too — it used to be a bare string painted in
  // the success green, so "Save failed: …" read as a confirmation.
  const [saveNotice, setSaveNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // `refetch` is bound to the failure state below — the same retry the rule-
  // bindings panel in this file already ships, so the two failure paths on this
  // tab behave alike instead of one being a dead end.
  const { data: profile, isLoading, isError, refetch } = useQuery<AcceptanceProfile | null>({
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
      setSaveNotice({ kind: "ok", text: "Rules saved as draft — click “Activate rules” to make them live." });
      setTimeout(() => setSaveNotice(null), 3000);
    },
    onError: (err: Error) => setSaveNotice({ kind: "err", text: `Save failed: ${err.message}` }),
  });

  const activateMutation = useMutation({
    mutationFn: (versionNo: number) => activateAcceptanceVersion(supplierId, versionNo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acceptance-profile", supplierId] });
      setSaveNotice({ kind: "ok", text: "Version activated." });
      setTimeout(() => setSaveNotice(null), 3000);
    },
    onError: (err: Error) => setSaveNotice({ kind: "err", text: `Activate failed: ${err.message}` }),
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

  // A failed READ is not a failed profile. The GET is the only thing that broke,
  // so say what is actually known — this screen has nothing to show, and nothing
  // was saved, edited or switched off — and hand back the retry.
  //
  // What we deliberately do NOT say: whether these rules are still being applied
  // to orders in flight. Validation runs server-side at send time, on a path this
  // component never observes; a browser fetch failing here is not evidence either
  // way, so claiming "your rules are still active" (or that they are not) would be
  // a guess printed as fact to the one person who would act on it.
  if (isError) {
    return (
      <div
        className="flex flex-col items-start gap-3 rounded-[10px] px-5 py-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ background: SURFACE, border: `1px solid ${LINE}` }}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: DANGER }}>
            Couldn’t load this supplier’s validation rules.
          </p>
          <p className="mt-1 text-[12.5px] leading-5" style={{ color: MUTED }}>
            Only reading them failed — nothing was changed, and any saved rules are still stored as
            they were. This screen can’t confirm whether they’re being applied to orders right now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex-shrink-0 rounded-[7px] px-3 text-[12px] font-medium"
          style={{ height: 30, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  const isEditing = editRules !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Notice. Custom rules are plan-gated on BOTH save and activate
          (`custom_supplier_rules_requires_enterprise`), so a refusal becomes the upsell;
          every other failure is red, and only a real success is green. */}
      {saveNotice && saveNotice.kind === "err" && isPlanGate(saveNotice.text) && (
        <PlanGateNotice error={saveNotice.text} capability="Custom supplier validation rules" />
      )}

      {saveNotice && !(saveNotice.kind === "err" && isPlanGate(saveNotice.text)) && (
        <div
          role="status"
          className="rounded-[7px] px-3 py-2 text-[12.5px]"
          style={
            saveNotice.kind === "ok"
              ? { background: "#ECFDF3", border: "1px solid #A6E9BE", color: "#1E6D29" }
              : { background: "#FBE3E3", border: "1px solid #F5B8B8", color: "#B43838" }
          }
        >
          {saveNotice.text}
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
                  background: profile.status === "active" ? "#E9F1EA" : "#FAF1DD",
                  color: profile.status === "active" ? GREEN_DEEP : "#8A5310",
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
          <strong style={{ color: "#8A5310" }}>Warning</strong> rules only flag and never block.{" "}
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
                  aria-label={`Rule ${idx + 1} scope`}
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
                  aria-label={`Rule ${idx + 1} field`}
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
                  aria-label={`Rule ${idx + 1} operator`}
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
                  aria-label={`Rule ${idx + 1} expected value`}
                  className="w-full rounded-[5px] px-2 text-[12px]"
                  style={{ height: 30, border: `1px solid ${LINE}`, color: INK, background: SURFACE }}
                />
                <select
                  aria-label={`Rule ${idx + 1} severity`}
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
                  style={{ minHeight: "var(--tap-min)", height: 28, background: "#FBE3E3", color: DANGER, border: "none", cursor: "pointer" }}
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
    // Neither absence nor non-recognition is "Manual".
    //
    // This arm used to label an unattributed row "Manual" — the HIGHEST-trust
    // provenance in this product's vocabulary, the one an operator reads as "a
    // human typed this and stands behind it", sitting in the same table as the
    // violet AI pill they are trained to double-check. It is the identical
    // defect `MappingConfidence` two functions below was already fixed for, one
    // column to the right: absence of evidence displayed as maximum evidence.
    //
    // A source string we do not recognise is echoed verbatim, because the raw
    // word is more informative than any bucket we would invent for it, and it
    // is still not a provenance we can vouch for. A missing one says so.
    default:          return { label: source || "Source not recorded", pillKey: UNATTRIBUTED_SOURCE };
  }
}

// One mapping row's provenance. Mirrors `MappingConfidence` below: a value we
// can vouch for gets its coloured chip, and an unattributed one gets neutral
// plain text — no chip, no colour, nothing that could be read as one of the
// four known provenances.
function MappingSource({ source }: { source?: string }) {
  const src = normalizeSource(source);
  if (src.pillKey === UNATTRIBUTED_SOURCE) {
    return (
      <span className="text-[10.5px] font-medium" style={{ color: MUTED }}>
        {src.label}
      </span>
    );
  }
  const pill = SOURCE_PILL[src.pillKey] ?? SOURCE_PILL.Manual;
  return <span className="chip" style={{ background: pill.bg, color: pill.fg }}>{src.label}</span>;
}

// Backend confidence is a 0–1 float; render as a whole-number percentage.
// `null` means the row carries no score at all — see MappingConfidence.
function confPct(confidence?: number): number | null {
  if (confidence == null) return null;
  return Math.round(confidence * 100);
}

// One mapping row's confidence.
//
// `SupplierMapping.confidence` is optional, and this used to default a missing
// score to 100 — which rendered a green chip reading "100%" for a row nobody
// had ever scored. That is the inverse of the truth in the one table an
// operator opens specifically to judge item-code quality: absence of evidence
// was displayed as maximum evidence.
//
// A scored row keeps the usual .conf-* chip. An unscored row gets a neutral
// "Not scored" marker — no percentage, no tier colour — matching OrderPassport,
// which only renders a confidence chip when the field actually carries one. The
// column header says "Confidence", so an empty cell would read as a rendering
// failure rather than a deliberate absence; the words are worth the width.
function MappingConfidence({ confidence }: { confidence?: number }) {
  const pct = confPct(confidence);
  if (pct === null) {
    return (
      <span className="text-[10.5px] font-medium" style={{ color: MUTED }}>
        Not scored
      </span>
    );
  }
  return <span className={`conf ${confClass(pct)} tabular-nums`}>{pct}%</span>;
}

function LiveMappingsTab({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  // Gate the query like every other live query in the app: in mock mode the
  // parent never renders this branch, but keep the canonical guard so the query
  // doesn't fire before Clerk is ready (which would 401).
  const queryEnabled = useQueriesEnabled();

  const { data: mappings = [], isLoading, isError, refetch } = useQuery<SupplierMapping[]>({
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

  // Same failure shape as the rule-bindings panel above: one plain sentence plus
  // the retry the query can genuinely perform. "Check your connection and try
  // refreshing" sent the operator to a browser reload for one GET — and a reload
  // of this page drops them back on Overview, losing the tab they were reading.
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <span className="text-[13px]" style={{ color: DANGER }}>
          Couldn’t load mappings for {supplierName}.
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex-shrink-0 rounded-[7px] px-3 text-[12px] font-medium"
          style={{ height: 30, border: `1px solid ${LINE}`, background: SURFACE, color: INK, cursor: "pointer" }}
        >
          ↻ Retry
        </button>
      </div>
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
              return (
                <tr key={m.id} style={{ borderBottom: i < mappings.length - 1 ? `1px solid ${LINE}` : undefined }}>
                  <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: INK, fontFamily: MONO }}>{m.buyerItemCode}</td>
                  <td className="px-5 py-3 text-[12px] font-semibold" style={{ color: GREEN_DEEP, fontFamily: MONO }}>{m.supplierItemCode}</td>
                  <td className="px-5 py-3" style={{ textAlign: "left" }}>
                    <MappingSource source={m.source} />
                  </td>
                  <td className="px-5 py-3" style={{ textAlign: "right" }}>
                    <MappingConfidence confidence={m.confidence} />
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
                <MappingSource source={m.source} />
                <MappingConfidence confidence={m.confidence} />
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
  const confirm = useConfirm();
  const queryEnabled = useQueriesEnabled();
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["supplier-catalog", supplierId, q],
    queryFn: () => getSupplierCatalog(supplierId, q || undefined, 200),
    enabled: queryEnabled,
    staleTime: 15_000,
    retry: 1,
  });
  // `isError` was never destructured here, and `getSupplierCatalog` throws on a
  // non-ok response — so a failed fetch left `data === undefined`, fell through
  // the `?? []` below, and told a supplier with 8,000 imported products that it
  // had none and should go upload a file. The `!queryEnabled` half is the milder
  // case the same branch had: a query that has not been allowed to run yet also
  // reports no items, which is not the same as a catalog that is empty.
  const showLoading = !queryEnabled || (isLoading && data === undefined);
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
          style={{ minHeight: 36, padding: "0 14px", border: "none", background: "#297F34", color: "#FFFFFF", borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: importMut.isPending ? 0.6 : 1 }}>
          {importMut.isPending ? "Importing…" : "Import CSV / XLSX"}
        </button>
        {!!data?.total && (
          <button type="button" onClick={async () => { const ok = await confirm({ title: "Clear catalog", description: "Clear the entire catalog for this supplier? This removes every imported product.", confirmLabel: "Clear catalog", danger: true }); if (ok) clearMut.mutate(); }} disabled={clearMut.isPending}
            style={{ minHeight: 36, padding: "0 12px", border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#B43838", borderRadius: 6, fontSize: 12.5, cursor: "pointer" }}>
            Clear
          </button>
        )}
      </div>

      {notice && <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, padding: "8px 10px", background: "#F6F7FA", border: "1px solid #E5E8EE", borderRadius: 6 }}>{notice}</div>}

      {(data?.total ?? 0) > 0 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code / name / barcode"
          aria-label="Search catalog"
          style={{ width: "100%", maxWidth: 360, minHeight: 36, border: "1px solid #CBD0DA", borderRadius: 6, padding: "5px 10px", fontSize: 12.5, marginBottom: 10 }} />
      )}

      {/* Branch order is the load-bearing part, and it follows the dead-letter
          list on /operations/health: loading and error each resolve AHEAD of
          empty, because "we could not look" must never render as "there is
          nothing". `items` is `data?.items ?? []`, and that default is a render
          convenience only now that both cases it used to swallow are branched
          on above it. */}
      {showLoading ? (
        <div style={{ fontSize: 12, color: MUTED }}>Loading catalog…</div>
      ) : isError ? (
        <div role="alert" style={{ padding: "18px 14px", background: BG, border: `1px solid ${LINE}`, borderRadius: 8 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: INK }}>
            We couldn&apos;t load this catalog
          </p>
          <p style={{ margin: "4px 0 0", maxWidth: 440, fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
            That is not the same as &ldquo;empty&rdquo; — any products already imported are still
            here, and nothing has been deleted. Importing again is not necessary.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="bg-surface"
            style={{ marginTop: 12, minHeight: "var(--tap-min)", height: 34, padding: "0 12px", border: `1px solid ${BORDER_STRONG}`, color: INK, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: isFetching ? "default" : "pointer", opacity: isFetching ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={13} strokeWidth={2} color={MUTED} aria-hidden />
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        /* 2px dashed, not 1px: this box rendered with a missing TOP edge. Verified: no
           element overlaps it (12px clear gap above), but at Windows 125% scaling
           (dpr 1.25) Chromium computes the declared 1px as a 0.8px hairline — sub-device-
           pixel edges can rasterize to zero rows at fractional offsets. 2px stays >=2
           device pixels on every edge. Same weight as the UploadWorkbench drop zone. */
        <div style={{ fontSize: 12.5, color: MUTED, padding: "18px 14px", background: "#F6F7FA", border: "2px dashed #CBD0DA", borderRadius: 8, textAlign: "center" }}>
          {q ? "No products match." : "No products yet. Upload this supplier's product list (CSV or XLSX). ProcuLink uses it so AI only suggests real supplier codes and flags unknown ones. Only \"code\" is required; name, unit, price, barcode are optional. Example: ACM-PL-22, Hydraulic seal kit, box, 24.50."}
        </div>
      ) : (
        <div style={{ border: "1px solid #E5E8EE", borderRadius: 8, overflow: "hidden" }}>
          {/* Five columns, two of them mono — this table cannot fit a phone. It used to be wrapped
              in `overflow: hidden`, which clipped the last columns off with no way to reach them.
              Same treatment as every other table on this screen: a real table that scrolls from sm
              up, stacked cards below. The scroll container is focusable so the columns past the
              fold are reachable by keyboard, not just by trackpad. */}
          <div
            className="hidden sm:block overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Product catalog"
          >
            <table className="w-full border-collapse" style={{ fontSize: 12, minWidth: 560 }}>
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
          </div>

          {/* Phone: the same rows, stacked. Code leads because it is what the operator is looking
              for; unit, price and barcode only appear when the catalog actually carries them. */}
          <ul className="m-0 list-none p-0 sm:hidden">
            {items.map((p) => (
              <li key={p.id} className="px-2.5 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="text-[12px] font-semibold" style={{ color: INK, fontFamily: MONO }}>{p.code}</div>
                {p.name && <div className="mt-0.5 text-[12px]" style={{ color: INK }}>{p.name}</div>}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: MUTED }}>
                  {p.unit && <span>Unit {p.unit}</span>}
                  {p.price != null && <span style={{ fontFamily: MONO }}>Price {p.price}</span>}
                  {p.barcode && <span style={{ fontFamily: MONO }}>Barcode {p.barcode}</span>}
                </div>
              </li>
            ))}
          </ul>

          {data && data.total > items.length && (
            <div style={{ padding: "6px 10px", fontSize: 11, color: MUTED, borderTop: "1px solid #EEF0F4" }}>Showing {items.length} of {data.total}. Refine with search.</div>
          )}
        </div>
      )}

      {/* ── Automatic import sources (additive — manual upload above stays primary) ── */}
      <details style={{ marginTop: 18, border: "1px solid #E5E8EE", borderRadius: 8, background: "#FBFCFE" }}>
        <summary style={{ cursor: "pointer", listStyle: "none", padding: "11px 14px", fontSize: 13, fontWeight: 700, color: INK, display: "flex", alignItems: "center", gap: 8 }}>
          <ChevronRight size={15} data-disclosure-chevron style={{ color: MUTED }} aria-hidden />
          Keep the catalog in sync automatically
          <span style={{ fontSize: 11.5, fontWeight: 500, color: MUTED }}>
            Pull on a schedule or let the supplier push — instead of uploading by hand
          </span>
        </summary>
        <div style={{ display: "grid", gap: 14, padding: "0 14px 14px" }}>
          <CatalogSourceEditor supplierId={supplierId} />
          <CatalogPushCard supplierId={supplierId} />
        </div>
      </details>
    </div>
  );
}

// ── CatalogPushCard ───────────────────────────────────────────────────────────
// Read-only display of the API-key push endpoint for this supplier. The FE only
// shows the copyable URL + points to the API-keys docs; the push itself is
// machine-to-machine (API-key auth) and not called from the browser.
function CatalogPushCard({ supplierId }: { supplierId: string }) {
  const queryEnabled = useQueriesEnabled();
  const [copied, setCopied] = useState(false);

  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: getOrgSettings,
    enabled: queryEnabled,
    staleTime: 60_000,
  });
  const orgSlug = orgSettings?.slug ?? null;
  const url = orgSlug
    ? `${API_BASE_URL}/api/ingress/${orgSlug}/catalog/${supplierId}`
    : `${API_BASE_URL}/api/ingress/{your-org-slug}/catalog/${supplierId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the URL is still visible to copy by hand */
    }
  }

  return (
    <div style={{ border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF" }}>
      <div style={{ padding: "11px 14px", borderBottom: "1px solid #E5E8EE", background: "#F6F7FA" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Push from your system</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
          POST a CSV or XLSX to this URL with your API key. Re-sending a product code updates that product instead of adding a duplicate.
        </div>
      </div>
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap" }}>
          <code style={{ flex: 1, minWidth: 220, fontFamily: MONO, fontSize: 11.5, color: INK, background: "#0B1A2F0A", border: "1px solid #E5E8EE", borderRadius: 6, padding: "8px 10px", wordBreak: "break-all", display: "flex", alignItems: "center" }}>
            POST {url}
          </code>
          <button type="button" onClick={copy}
            style={{ minHeight: 36, padding: "0 14px", border: "1px solid #CBD0DA", background: "#FFFFFF", color: INK, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {!orgSlug && (
          <div style={{ fontSize: 11.5, color: MUTED }}>
            Replace <code style={{ fontFamily: MONO }}>{"{your-org-slug}"}</code> with your workspace slug (Settings).
          </div>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          Authenticate with an API key from{" "}
          <Link href="/settings?tab=api" style={{ color: BLUE, fontWeight: 600 }}>Settings → API keys</Link>.{" "}
          See the{" "}
          <Link href="/help/api-and-integrations" style={{ color: BLUE, fontWeight: 600 }}>API &amp; integrations guide</Link>.
        </div>
      </div>
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
  const [savingMapping, setSavingMapping] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Bumped when the opt-in guided setup saves a config, so the DeliveryConfigEditor
  // below remounts and reloads the freshly-saved delivery config from the API.
  const [deliveryReloadNonce, setDeliveryReloadNonce] = useState(0);
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
  const {
    data: connectionList,
    isLoading: connectionsLoading,
    isError: connectionsError,
    isFetching: connectionsFetching,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: connectionsEnabled,
    staleTime: 60_000,
    retry: 1,
  });
  const connectionId = connectionList?.find((c) => c.supplierId === id)?.id ?? null;
  // A failed or not-yet-answered `["connections"]` fetch collapses to the same
  // `null` as "this supplier has no connection", and that null was read as a
  // fact in three places at once: the History tab printed "No versions yet", the
  // header's History button disappeared, and LiveEditNotice dropped its
  // version-history link. Nothing on screen said the lookup had failed. Keep the
  // null for the two places that merely hide an affordance, and carry the reason
  // separately so the tab — the one that makes a CLAIM — can tell them apart.
  const connectionsUnresolved = !connectionsEnabled || (connectionsLoading && connectionList === undefined);

  // This supplier's SAVED order layout.
  //
  // It used to live in `useState<PoMappingConfig | null>(null)`, written only by
  // an in-session save, and `PoMappingEditor` does not fetch it either — so a
  // supplier with a column layout saved months ago got a blank editor on every
  // fresh load, and `onDelete` stayed `undefined`, hiding the delete control for
  // exactly the suppliers that had something to delete. `GET /suppliers/{id}/po-mapping`
  // has existed the whole time (204 when there is none, hence `| null`).
  const poMappingQuery = useQuery<PoMappingConfig | null>({
    queryKey: ["supplier-po-mapping", id],
    queryFn: () => getPoMapping(id),
    enabled: connectionsEnabled,
    staleTime: 30_000,
    retry: 1,
  });
  const savedPoMapping = poMappingQuery.data ?? null;
  const poMappingLoading = !connectionsEnabled || (poMappingQuery.isLoading && poMappingQuery.data === undefined);
  // The saved config IS the editor's seed, and the editor reads `initialConfig`
  // only in its useState initialisers — so the seed has to be settled before it
  // mounts. It is: the tab body branches on loading/error above the editor.
  const setSavedPoMapping = (config: PoMappingConfig | null) =>
    qc.setQueryData(["supplier-po-mapping", id], config);

  // In mock mode: all fields come from DEMO_MOCK.
  // In real mode: only name comes from the API; metrics show honest placeholders.
  const realSupplier = !isApiMockMode
    ? (supplierList?.find(s => s.id === id) ?? null)
    : null;

  const name = isApiMockMode ? DEMO_MOCK.name : (realSupplier?.name ?? "");
  // Mock-mode only. `Supplier` has no `code` field, and this used to synthesise
  // initials from the name (`deriveCode`) and render them unlabelled, in mono, in
  // the exact slot mock mode fills with a real registered supplier code — so
  // "Nordmark Handel GmbH" printed a confident `NHG` that exists in no system an
  // operator could look it up in. There is nothing to show, so nothing is shown.
  const code = isApiMockMode ? DEMO_MOCK.code : null;

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
                {code && (
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
            {/* Versioned history — draft → test → publish snapshots for this supplier.
                STRUCT-1: switches to the in-page History tab (was a link to the
                standalone /connections page, still resolvable but out of the launch
                nav). Hidden when no connection exists yet. */}
            {connectionId && (
              <button
                type="button"
                onClick={() => setTab("history")}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium"
                style={{ minHeight: "var(--tap-min)", height: 34, border: `1px solid ${BORDER_STRONG}`, background: SURFACE, color: INK, cursor: "pointer" }}
              >
                <GitBranch size={14} strokeWidth={2} color={MUTED} />
                History
              </button>
            )}
            {/* Destructive action — soft-deletes the supplier (past orders retained for audit) */}
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium"
              style={{ minHeight: "var(--tap-min)", height: 34, border: "1px solid #E9C4C4", background: SURFACE, color: DANGER, cursor: "pointer" }}
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
      <div
        className="flex-1 min-h-0 overflow-auto pt-4"
        tabIndex={0}
        role="region"
        aria-label="Supplier profile details"
      >
        {tab === "overview" && (
          <div className="flex flex-col gap-4">
            {/* KPI stat cards.
                Real orgs used to get four of these reading "—" captioned "no data
                yet" — Total orders, Avg cycle time, Issue rate, Acceptance — and
                NO supplier-metrics query existed anywhere in the file to fill
                them. The caption was not a placeholder, it was an assertion about
                this supplier's history that nothing had checked, and once the
                recent-orders panel below it started printing a real "412 total"
                the same screen was contradicting itself.
                Three of the four have no endpoint behind them — there is no
                per-supplier metrics route on the API, and none of avg cycle time,
                issue rate or acceptance rate is derivable from what is exposed —
                so those claims are gone rather than invented. Total orders IS
                fetchable, from the same order page the panel below already reads,
                so it is fetched. */}
            {isApiMockMode ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                {[
                  { label: "Total orders",   value: DEMO_MOCK.totalOrders.toLocaleString(), sub: "all time",     subAccent: false },
                  { label: "Avg cycle time", value: DEMO_MOCK.avgCycle,                     sub: "−14% vs prev", subAccent: true  },
                  { label: "Issue rate",     value: DEMO_MOCK.exceptionRate,                sub: "within target", subAccent: true  },
                  { label: "Acceptance",     value: `${DEMO_MOCK.health}%`,                 sub: "last 30 days", subAccent: true  },
                ].map(({ label, value, sub, subAccent }) => (
                  <div
                    key={label}
                    className="monument rounded-[10px] px-4 py-4"
                    style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: CARD_SHADOW }}
                  >
                    <div className="m-label">{label}</div>
                    <div className="m-value" style={{ fontSize: 30, color: INK }}>{value}</div>
                    <div className="m-sub" style={{ color: subAccent ? GREEN_DEEP : FAINT }}>{sub}</div>
                  </div>
                ))}
              </div>
            ) : (
              <OrderVolumeCard supplierId={id} nounLower={partyNounLower} />
            )}

            {/* Identifiers — what an unrouted document gets matched against. */}
            <SupplierIdentityCard supplierId={id} />

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
                      ["Code translations",  DEMO_MOCK.summary.savedMappings.toLocaleString(), false],
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
                  <DeliverySummaryBody
                    supplierId={id}
                    nounLower={partyNounLower}
                    onOpenDeliveryTab={() => setTab("delivery")}
                  />
                )}
              </div>

              {/* Recent orders — demo list in mock mode, a real query otherwise. */}
              {isApiMockMode ? (
                <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
                  <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                    <Clock size={15} strokeWidth={2} color={MUTED} />
                    <h3 className="text-[13px] font-semibold" style={{ color: INK }}>Recent orders</h3>
                  </div>
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
                </div>
              ) : (
                <RecentOrdersPanel supplierId={id} nounLower={partyNounLower} />
              )}
            </div>
          </div>
        )}

        {tab === "mappings" && (
          <>
          {/* Helper eyebrow: explains what saved SKU mappings are and why they matter. */}
          <p className="mb-3 max-w-[560px] text-[12px] leading-5" style={{ color: MUTED }}>
            Saved translations between your buyer codes and this {partyNounLower}&apos;s codes. Once saved,
            ProcuLink applies them automatically on every future order. Mappings are internal — never sent to the {partyNounLower}.
          </p>
          <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Card header */}
            <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-5 sm:flex-row sm:items-center" style={{ borderBottom: `1px solid ${LINE}` }}>
              <Link2 size={17} strokeWidth={2} color={MUTED} className="flex-shrink-0" />
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold" style={{ color: INK }}>Code translations</h3>
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
          </>
        )}

        {tab === "po-mapping" && (
          <>
          {/* Sub-label for the "Order layout" tab (column → field layout of the
              order file). It no longer has to point at the Item codes tab: the two
              tabs are now named for the different things they do, so the apology
              this copy used to carry (a pointer to the other tab) is gone. */}
          <div className="mb-3 flex items-start gap-2.5">
            <GitBranch size={16} strokeWidth={2} color={MUTED} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold" style={{ color: INK }}>Order layout</h3>
              <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                Tell ProcuLink how to read this {partyNounLower}&apos;s order files — e.g. if column A is the PO number
                and column C is quantity, connect each one. Set this up after uploading a sample order.
              </p>
            </div>
          </div>
          <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} onOpenHistory={() => setTab("history")} />
          {/* Loading and error resolve ahead of the editor for the same reason
              they resolve ahead of every empty state on this screen: an editor
              rendered with no layout in it is a claim that this supplier has no
              saved layout, and neither "still asking" nor "the ask failed" is
              evidence of that. */}
          {poMappingLoading ? (
            <p className="text-[13px]" style={{ color: MUTED }}>
              Loading this {partyNounLower}&apos;s saved order layout…
            </p>
          ) : poMappingQuery.isError ? (
            <div role="alert" className="rounded-[8px] px-4 py-4" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
              <p className="m-0 text-[13px] font-semibold" style={{ color: INK }}>
                We couldn&apos;t load this {partyNounLower}&apos;s saved order layout
              </p>
              <p className="mt-1 max-w-[460px] text-[12.5px] leading-5" style={{ color: MUTED }}>
                Opening the editor now would show an empty layout, which is not the same as
                not having one — so it stays closed until we can read what is saved. Nothing
                has changed.
              </p>
              <button
                type="button"
                onClick={() => void poMappingQuery.refetch()}
                disabled={poMappingQuery.isFetching}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[7px] bg-surface px-3 text-[12.5px] font-medium"
                style={{ minHeight: "var(--tap-min)", height: 34, border: `1px solid ${BORDER_STRONG}`, color: INK, cursor: poMappingQuery.isFetching ? "default" : "pointer", opacity: poMappingQuery.isFetching ? 0.6 : 1 }}
              >
                <RefreshCw size={13} strokeWidth={2} color={MUTED} aria-hidden />
                Try again
              </button>
            </div>
          ) : (
            <PoMappingEditor
              supplierId={id}
              initialConfig={savedPoMapping}
              saving={savingMapping}
              supplierName={name}
              onApplyTemplate={async (templateId) => {
                // Persists the template server-side, then writes the saved config
                // straight into the query cache so the editor and the delete
                // control both see it without a second round trip.
                const saved = await applyPoMappingTemplate(id, templateId);
                setSavedPoMapping(saved);
                return saved;
              }}
              onSave={async (config) => {
                setSavingMapping(true);
                try {
                  const saved = await upsertPoMapping(id, config);
                  setSavedPoMapping(saved);
                } finally {
                  setSavingMapping(false);
                }
              }}
              onDelete={
                savedPoMapping
                  ? async () => {
                      await deletePoMapping(id);
                      setSavedPoMapping(null);
                    }
                  : undefined
              }
            />
          )}
          </>
        )}

        {tab === "catalog" && <CatalogTab supplierId={id} />}

        {tab === "delivery" && (
          <>
            <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} onOpenHistory={() => setTab("history")} />
            {/* Opt-in guided setup — an additive, on-brand stepper for non-technical
                users. The single-form editor below stays the default; this is a quiet
                entry point that produces the SAME saved config via the SAME APIs. On
                save it bumps deliveryReloadNonce so the editor reloads what it wrote. */}
            <FirstTimeDeliveryOffer
              supplierId={id}
              nounLower={partyNounLower}
              onSaved={() => setDeliveryReloadNonce((n) => n + 1)}
            />
            <DeliveryConfigEditor key={deliveryReloadNonce} supplierId={id} />
          </>
        )}

        {tab === "acceptance" && (
          <>
            <LiveEditNotice connectionId={connectionId} nounLower={partyNounLower} onOpenHistory={() => setTab("history")} />
            <AcceptanceTab supplierId={id} />
          </>
        )}

        {/* STRUCT-1: the versioned-connection history view, relocated here from
            the standalone /connections page. Renders the IDENTICAL view (version
            list + lifecycle controls + live config + replay). A connection is
            created the first time a supplier is configured, so until then we show
            an honest empty state rather than an empty tab. */}
        {tab === "history" && (
          connectionId ? (
            <SupplierHistoryTab connectionId={connectionId} />
          ) : connectionsUnresolved ? (
            <div
              className="rounded-[10px] px-6 py-12 text-center"
              style={{ border: `1px dashed ${BORDER_STRONG}`, background: SURFACE }}
            >
              <p className="text-[13px]" style={{ color: MUTED }}>Checking for saved versions…</p>
            </div>
          ) : connectionsError ? (
            /* "No versions yet" was the ONLY thing this tab could say, and it was
               reached by `connectionId ?? null` — so a failed /api/connections
               fetch rendered a confident "nothing has ever been published here",
               beside an instruction to go and configure a connection that may
               already exist. Error resolves ahead of empty. */
            <div
              role="alert"
              className="rounded-[10px] px-6 py-10 text-center"
              style={{ border: `1px solid ${LINE}`, background: SURFACE }}
            >
              <p className="text-[14px] font-semibold" style={{ color: INK }}>
                We couldn&apos;t load this {partyNounLower}&rsquo;s versions
              </p>
              <p className="mx-auto mt-1 max-w-[440px] text-[12.5px] leading-5" style={{ color: MUTED }}>
                That is not the same as &ldquo;none&rdquo; — there may well be saved versions here.
                Nothing has been lost and no version has changed.
              </p>
              <button
                type="button"
                onClick={() => void refetchConnections()}
                disabled={connectionsFetching}
                className="mt-4 inline-flex items-center gap-1.5 rounded-[7px] bg-surface px-3 text-[12.5px] font-medium"
                style={{ minHeight: "var(--tap-min)", height: 34, border: `1px solid ${BORDER_STRONG}`, color: INK, cursor: connectionsFetching ? "default" : "pointer", opacity: connectionsFetching ? 0.6 : 1 }}
              >
                <RefreshCw size={13} strokeWidth={2} color={MUTED} aria-hidden />
                Try again
              </button>
            </div>
          ) : (
            <div
              className="rounded-[10px] px-6 py-12 text-center"
              style={{ border: "1px dashed #CBD0DA", background: SURFACE }}
            >
              <p className="text-[14px] font-semibold" style={{ color: INK }}>No versions yet</p>
              <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] leading-5" style={{ color: MUTED }}>
                Configure this {partyNounLower}&rsquo;s mapping and delivery and a versioned connection is created automatically.
              </p>
            </div>
          )
        )}

        {/* Connectors are managed globally (Operations); a supplier-scoped
            version isn't built yet, so we don't surface an empty placeholder tab
            here. Re-add a tab once its supplier-scoped feature ships. (Rules and
            output format are already supplier-scoped — the Validation rules and
            Delivery tabs above; their org-wide pages were retired 2026-07.) */}
      </div>
    </PageShell>
  );
}

/* -------- SrcChip — thin alias over the one format chip (WP-30) --------
   This used to be a second local implementation driving the `.src-chip .src-*`
   CSS classes, which were themselves a third copy of the format palette. Both
   are gone; FileChip carries the AA-clean colours. EDIFACT still folds onto EDI,
   which is the only mapping this wrapper ever added.                          */
function SrcChip({ type }: { type: string }) {
  return <FileChip type={/^edifact$/i.test(type) ? "EDI" : type} />;
}

/* -------- RecentOrdersPanel — this supplier's real order history ------------
 *
 * WHY THIS IS A QUERY AND NOT A SENTENCE
 *
 * Until this component existed, the overview panel rendered exactly one thing
 * to every non-mock user, unconditionally:
 *
 *     No deliveries yet for this supplier.
 *
 * The page never asked the API a question. A supplier with 400 orders behind it
 * was told, flatly, that it had none — and this is the configuration screen
 * every trial walks through. It is the strongest form of this codebase's
 * signature defect: not an unknown value misread as a confident answer, but a
 * confident answer with no value behind it at all.
 *
 * The empty sentence is now the LAST branch of a real query, and the branch
 * ORDER is the load-bearing part: error and loading each resolve ahead of it,
 * because "we could not look" must never be rendered as "there is nothing".
 * That is the ordering `/operations/health` uses for its dead-letter list, and
 * the `?? []` below is a render convenience only — the two cases it would
 * otherwise swallow (failed fetch, first load) are both branched on above it.
 *
 * The panel deliberately does NOT filter to delivered orders. Filtering one
 * page client-side would reintroduce the original defect one level down: a
 * first page holding no delivered rows is not evidence that the supplier has
 * none. Every order is listed with its real status instead, which answers the
 * two questions an operator actually arrives with — has anything gone out, and
 * has anything failed.
 */
const RECENT_ORDERS_LIMIT = 6;

/**
 * The one order read this screen makes, shared by the panel below and by the
 * order-volume KPI above it. Same key, same queryFn, so TanStack serves both
 * from one cache entry and one request — the KPI is not a second fetch, and the
 * two surfaces cannot disagree about how many orders this supplier has.
 */
function useSupplierOrdersPage(supplierId: string) {
  const queryEnabled = useQueriesEnabled();
  const query = useQuery<OrdersPage>({
    queryKey: ["supplier-recent-orders", supplierId],
    queryFn: () => apiClient.getOrders({ supplierId, page: 1, pageSize: RECENT_ORDERS_LIMIT }),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });
  // A query that is not enabled yet reports `isLoading: true` with no data, so
  // "not ready to ask" resolves as loading — never as an error, and never as a
  // supplier with no orders.
  return { ...query, showLoading: !queryEnabled || (query.isLoading && query.data === undefined) };
}

/**
 * Total orders for this supplier — the one KPI on this screen with a real
 * source behind it.
 *
 * The card it replaces read "—" under the caption "no data yet", and so did
 * three siblings (Avg cycle time, Issue rate, Acceptance). None of the four was
 * connected to anything: the file contained no supplier-metrics query, so the
 * caption was a statement about this supplier's history that had never been
 * checked. The other three are gone because the API exposes no per-supplier
 * metrics route to connect them to; inventing an endpoint, or leaving the
 * caption up, were the two options this deliberately does not take.
 */
function OrderVolumeCard({ supplierId, nounLower }: { supplierId: string; nounLower: string }) {
  const { data, isError, isFetching, refetch, showLoading } = useSupplierOrdersPage(supplierId);
  // Same contract as the panel below: the printed number is the METERED
  // population and the practice split is stated, both owned by orderCountContract.
  const population = pagePopulation(data);
  const practiceNote = practiceOrderNote(population.practice);

  return (
    <div
      className="monument rounded-[10px] px-4 py-4 sm:max-w-[300px]"
      style={{ background: SURFACE, border: `1px solid ${LINE}`, boxShadow: CARD_SHADOW }}
    >
      <div className="m-label">Total orders</div>
      {showLoading ? (
        <>
          <div className="m-value" style={{ fontSize: 30, color: BORDER_STRONG }} aria-hidden>—</div>
          <div className="m-sub" style={{ color: FAINT }}>Counting this {nounLower}&apos;s orders…</div>
        </>
      ) : isError ? (
        <div role="alert">
          <div className="m-value" style={{ fontSize: 30, color: BORDER_STRONG }} aria-hidden>—</div>
          {/* Not "no data yet". We asked and could not hear the answer, which is
              a different sentence from "there is nothing to count". */}
          <div className="m-sub" style={{ color: MUTED }}>We couldn&apos;t count them just now</div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-2 inline-flex items-center gap-1.5 rounded-[7px] bg-surface px-2.5 text-[12px] font-medium"
            style={{ minHeight: "var(--tap-min)", height: 30, border: `1px solid ${BORDER_STRONG}`, color: INK, cursor: isFetching ? "default" : "pointer", opacity: isFetching ? 0.6 : 1 }}
          >
            <RefreshCw size={12} strokeWidth={2} color={MUTED} aria-hidden />
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="m-value" style={{ fontSize: 30, color: INK }}>
            {population.metered.toLocaleString()}
          </div>
          <div className="m-sub" style={{ color: FAINT }}>{practiceNote ?? "all time"}</div>
        </>
      )}
    </div>
  );
}

/**
 * The Delivery summary card's body for real orgs.
 *
 * It used to be one sentence — "Configure this supplier in the Delivery tab to
 * populate this summary." — rendered unconditionally, with no delivery-config
 * fetch anywhere on the tab. A supplier with a live endpoint, an output format
 * and credentials already saved was told to go and set them up. The instruction
 * survives, but only as the last branch, and only once a completed read has
 * established that there is genuinely nothing saved.
 *
 * The rows are the fields `DeliveryConfig` actually carries. The endpoint URL
 * lives inside the protocol-specific `configJson` blob and is deliberately not
 * guessed at here: a summary that mis-parses a blob is the same defect wearing
 * a different hat, and the Delivery tab shows the real thing.
 */
/**
 * The "First time setting up delivery?" entry point, offered only when it is true.
 *
 * It used to render unconditionally, so a supplier with a working, tested delivery setup was
 * asked every visit whether this was their first time — and the wizard behind it builds a config
 * from scratch rather than carrying the saved values through, so accepting the offer on a
 * configured supplier is how you lose a working one.
 *
 * Reuses the delivery-config query the Overview summary already runs (same key, same cache, no
 * extra request). The offer needs a definite "nothing is configured": while the answer is loading
 * or the request failed, we do not know, and an unknown must not render as a confident "you have
 * not set this up yet".
 */
function FirstTimeDeliveryOffer({
  supplierId,
  nounLower,
  onSaved,
}: {
  supplierId: string;
  nounLower: string;
  onSaved: () => void;
}) {
  const queryEnabled = useQueriesEnabled();
  const { data, isLoading, isError } = useQuery<DeliveryConfig | null>({
    queryKey: ["supplier-delivery-config", supplierId],
    queryFn: () => getDeliveryConfig(supplierId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });

  // `null` is the real answer for "nothing saved" (the API returns 204); `undefined` is "no
  // answer yet". Only the former earns the offer.
  const nothingConfigured = data === null;
  if (!queryEnabled || isLoading || isError || !nothingConfigured) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] px-4 py-2.5" style={{ border: "1px solid #E5E8EE", background: "#FBFCFE" }}>
      <p className="m-0 text-[12px]" style={{ color: "#5E6779" }}>
        Setting up delivery for this {nounLower}? We can walk you through it.
      </p>
      <DeliveryGuidedSetup supplierId={supplierId} nounLower={nounLower} onSaved={onSaved} />
    </div>
  );
}

function DeliverySummaryBody({
  supplierId,
  nounLower,
  onOpenDeliveryTab,
}: {
  supplierId: string;
  nounLower: string;
  onOpenDeliveryTab: () => void;
}) {
  const queryEnabled = useQueriesEnabled();
  const { data, isLoading, isError, isFetching, refetch } = useQuery<DeliveryConfig | null>({
    queryKey: ["supplier-delivery-config", supplierId],
    queryFn: () => getDeliveryConfig(supplierId),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });
  // `null` is a real answer here (the API returns 204 when nothing is saved),
  // so only `undefined` counts as "no answer yet".
  const showLoading = !queryEnabled || (isLoading && data === undefined);

  if (showLoading) {
    return (
      <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
        Checking this {nounLower}&apos;s delivery setup…
      </p>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="px-4 py-5 sm:px-5">
        <p className="text-[13px] font-semibold" style={{ color: INK }}>
          We couldn&apos;t load this {nounLower}&apos;s delivery setup
        </p>
        <p className="mt-1 max-w-[440px] text-[12.5px] leading-5" style={{ color: MUTED }}>
          That is not the same as &ldquo;not configured&rdquo; — delivery may already be set up and
          working. Nothing has changed, and orders already on their way are unaffected.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[7px] bg-surface px-3 text-[12.5px] font-medium"
          style={{ minHeight: "var(--tap-min)", height: 34, border: `1px solid ${BORDER_STRONG}`, color: INK, cursor: isFetching ? "default" : "pointer", opacity: isFetching ? 0.6 : 1 }}
        >
          <RefreshCw size={13} strokeWidth={2} color={MUTED} aria-hidden />
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
        Nothing is configured yet. Set this {nounLower} up in the{" "}
        <button
          onClick={onOpenDeliveryTab}
          style={{ color: GREEN_DEEP, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13, fontWeight: 500 }}
        >
          Delivery
        </button>{" "}
        tab and this summary fills in.
      </p>
    );
  }

  const rows: Array<[string, string, boolean]> = [
    ["Delivery channel", data.protocol, true],
    ["Output format", data.outputFormat || "Not set", Boolean(data.outputFormat)],
    ["Send automatically", data.autoDeliver ? "On" : "Off", false],
    [
      "Credentials",
      data.hasCredentials ? (data.credentialsDisplay || "Stored") : "None stored",
      Boolean(data.hasCredentials && data.credentialsDisplay),
    ],
  ];

  return (
    <div className="px-4 py-1 sm:px-5">
      {rows.map(([k, v, mono], i) => (
        <div
          key={k}
          className="flex items-center justify-between gap-3 py-2.5 sm:gap-4"
          style={{ borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : undefined }}
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
      {data.insecureTransportWarning && (
        <p className="pb-2.5 pt-1 text-[11.5px] leading-5" style={{ color: DANGER }}>
          {data.insecureTransportWarning}
        </p>
      )}
    </div>
  );
}

function RecentOrdersPanel({ supplierId, nounLower }: { supplierId: string; nounLower: string }) {
  const { data, isError, isFetching, refetch, showLoading } = useSupplierOrdersPage(supplierId);
  const orders = data?.items ?? [];
  // The printed number is the METERED population, and the practice split is stated
  // rather than left for the reader to notice — `orderCountContract` owns both, so
  // this panel does not become a third screen deriving the split for itself.
  const population = pagePopulation(data);
  const practiceNote = practiceOrderNote(population.practice);

  return (
    /* A named region, because the order-volume KPI above now reads the SAME query
       and therefore carries its own copy of this panel's loading, error and retry
       surfaces. Naming the panel is what lets a reader — assistive tech or a test
       — say which of the two it is looking at. */
    <div
      role="region"
      aria-labelledby="supplier-recent-orders-heading"
      style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}
    >
      <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
        <Clock size={15} strokeWidth={2} color={MUTED} />
        <h3 id="supplier-recent-orders-heading" className="text-[13px] font-semibold" style={{ color: INK }}>Recent orders</h3>
        {/* The count is rendered only once a query has actually returned one. */}
        {!showLoading && !isError && population.metered > 0 && (
          <span className="ml-auto text-[11.5px]" style={{ color: FAINT }}>
            {population.metered.toLocaleString()} total
          </span>
        )}
      </div>

      {showLoading ? (
        <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
          Checking this {nounLower}&apos;s orders…
        </p>
      ) : isError ? (
        <div role="alert" className="px-4 py-5 sm:px-5">
          <p className="text-[13px] font-semibold" style={{ color: INK }}>
            We couldn&apos;t load this {nounLower}&apos;s orders
          </p>
          <p className="mt-1 max-w-[440px] text-[12.5px] leading-5" style={{ color: MUTED }}>
            That is not the same as &ldquo;none&rdquo; — this {nounLower} may well have orders.
            Nothing has been lost and no order has changed.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium"
            style={{
              minHeight: "var(--tap-min)",
              height: 34,
              border: `1px solid ${BORDER_STRONG}`,
              background: SURFACE,
              color: INK,
              cursor: isFetching ? "default" : "pointer",
              opacity: isFetching ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} strokeWidth={2} color={MUTED} aria-hidden />
            Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <p className="px-4 py-5 text-[13px] sm:px-5" style={{ color: MUTED }}>
          No orders for this {nounLower} yet.
        </p>
      ) : (
        <div className="px-4 py-1 sm:px-5">
          {orders.map((o, i) => {
            const amount =
              o.totalValue != null && Number.isFinite(o.totalValue)
                ? formatMoney(o.currency ?? "", o.totalValue)
                : null;
            return (
              <Link
                key={o.id}
                href={`/inbox/${o.id}`}
                className="flex items-center gap-2.5 py-2.5 sm:gap-3"
                style={{
                  borderBottom: i < orders.length - 1 ? `1px solid ${LINE}` : undefined,
                  textDecoration: "none",
                }}
              >
                <span
                  className="flex-shrink-0 text-[12px] font-semibold"
                  style={{ color: BLUE_DEEP, fontFamily: MONO }}
                >
                  {o.poNumber}
                </span>
                {amount && (
                  <span
                    className="ml-auto min-w-0 truncate text-right text-[11.5px]"
                    style={{ color: FAINT, fontFamily: MONO }}
                  >
                    {amount}
                  </span>
                )}
                <span className={amount ? "flex-shrink-0" : "ml-auto flex-shrink-0"}>
                  <UnifiedStatusBadge status={o.status} />
                </span>
              </Link>
            );
          })}
          {practiceNote && (
            <p className="pb-2.5 pt-1 text-[11.5px]" style={{ color: FAINT }}>
              {practiceNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------- MiniStatusPill — compact status badge for the demo recent-orders list -------- */
/* Uses the ported .pill / .pill-* classes so colours match the design StatusPill exactly.
   Labels come from the canonical statusLabel() map (UnifiedStatusBadge) so this pill
   never drifts from the unified vocabulary (e.g. ready → "Ready to send", sent → "Delivered"). */
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
