"use client";

// PO Mapping Editor — "magic auto-map" connect view.
// Left panel: detected source columns from the supplier's sample file.
// Right panel: canonical ProcuLink order fields.
// SVG overlay: measured bezier wire connectors, confidence-colored.
// Accept / Edit / Reject per field. Persists via upsertPoMapping.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PoMappingConfig, FieldMappingEntry } from "@/lib/api/types";
import {
  getMappingSourceColumns,
  suggestMappingFields,
  type FieldSuggestion,
} from "@/lib/api/mapping";
import { getPoMappingTemplates, type StarterTemplate } from "@/lib/api-client";

// ─── Design tokens ────────────────────────────────────────────────────────────
const NAVY       = "#0B1A2F";
const BLUE       = "#1E66C9";
const BLUE_DEEP  = "#0F4FA8";
const BLUE_SOFT  = "#E3EDFB";
const GREEN      = "#2E8E3A";
const GREEN_DEEP = "#1E6D29";
const GREEN_SOFT = "#E2F1E2";
const BORDER     = "#E2E6EE";
const INPUT_BDR  = "#D5DAEA";
const MUTED      = "#56627A";
const FAINT      = "#8A93A5";
const BG         = "#F6F7FA";
const SURFACE    = "#FFFFFF";
const SURFACE2   = "#EFF2F7";
const AMBER      = "#C97A14";
const AMBER_SOFT = "#FAEFD6";
const AI         = "#6F4FCE";
const AI_SOFT    = "#EEE7FB";
const DANGER     = "#C53A3A";

const AUTO_ACCEPT_THRESHOLD = 0.85; // auto-accept on load when no saved config
const ADOPT_THRESHOLD       = 0.50; // minimum confidence to surface as a pending suggestion

// ─── Canonical field model ────────────────────────────────────────────────────
type Section = "header" | "lines";

interface CanonicalField {
  canonical: string;
  label: string;
  hint: string;
  required: boolean;
  section: Section;
  standard: string;
}

const ALL_CANONICAL: CanonicalField[] = [
  { canonical: "PoNumber",      label: "PO Number",       hint: "Purchase order number",     required: true,  section: "header", standard: "UBL cbc:ID · X12 BEG02 · EDIFACT BGM+220 · cXML orderID" },
  { canonical: "OrderDate",     label: "Order Date",      hint: "Order / document date",     required: true,  section: "header", standard: "UBL cbc:IssueDate · X12 BEG05 · EDIFACT DTM+137 · cXML @orderDate" },
  { canonical: "BuyerName",     label: "Buyer Name",      hint: "Ordering buyer or company", required: false, section: "header", standard: "UBL BuyerCustomerParty · X12 N1*BY · EDIFACT NAD+BY" },
  { canonical: "Currency",      label: "Currency",        hint: "ISO currency code",         required: false, section: "header", standard: "UBL DocumentCurrencyCode · X12 CUR01 · EDIFACT CUX · cXML @currency" },
  { canonical: "LineNumber",    label: "Line #",          hint: "Line position",             required: false, section: "lines",  standard: "UBL LineItem/cbc:ID · X12 PO101 · EDIFACT LIN · cXML @lineNumber" },
  { canonical: "BuyerItemCode", label: "Buyer Item Code", hint: "Buyer's item / SKU code",   required: true,  section: "lines",  standard: "UBL BuyersItemIdentification · X12 PO1(IN) · EDIFACT PIA+1 · cXML SupplierPartAuxID" },
  { canonical: "Description",   label: "Description",     hint: "Item description",          required: false, section: "lines",  standard: "UBL Item/cbc:Description · X12 PID05 · EDIFACT IMD+F · cXML Description" },
  { canonical: "Quantity",      label: "Quantity",        hint: "Quantity ordered",          required: true,  section: "lines",  standard: "UBL cbc:Quantity · X12 PO102 · EDIFACT QTY+21 · cXML @quantity" },
  { canonical: "Unit",          label: "Unit of Measure", hint: "Unit of measure",           required: false, section: "lines",  standard: "UBL Quantity/@unitCode · X12 PO103 · EDIFACT QTY(UoM) · cXML UnitOfMeasure" },
  { canonical: "UnitPrice",     label: "Unit Price",      hint: "Price per unit",            required: false, section: "lines",  standard: "UBL Price/cbc:PriceAmount · X12 PO104 · EDIFACT PRI+AAA · cXML UnitPrice/Money" },
];

const REQUIRED_FIELDS = ALL_CANONICAL.filter((f) => f.required).map((f) => f.canonical);

// ─── Types ────────────────────────────────────────────────────────────────────
interface WirePos {
  canonical: string;
  conf: number;      // 0–100
  accepted: boolean;
  x1: number; y1: number;
  x2: number; y2: number;
}

interface PoMappingEditorProps {
  supplierId: string;
  initialConfig: PoMappingConfig | null;
  onSave: (config: PoMappingConfig) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initAccepted(config: PoMappingConfig | null): Map<string, string> {
  const acc = new Map<string, string>();
  if (!config) return acc;
  for (const [field, entry] of Object.entries(config.header ?? {})) {
    if (entry?.externalField) acc.set(field, entry.externalField);
  }
  for (const [field, entry] of Object.entries(config.lines ?? {})) {
    if (entry?.externalField) acc.set(field, entry.externalField);
  }
  return acc;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function PoMappingEditor({
  supplierId,
  initialConfig,
  onSave,
  onDelete,
  saving = false,
}: PoMappingEditorProps) {
  // ── API queries ────────────────────────────────────────────────────────────
  const sourceQuery = useQuery({
    queryKey: ["po-mapping-source-columns", supplierId],
    queryFn: () => getMappingSourceColumns(supplierId),
    staleTime: 60_000,
  });
  const detectedColumns = useMemo(() => sourceQuery.data?.columns ?? [], [sourceQuery.data]);
  const sample = sourceQuery.data?.sample;
  const fmt = sourceQuery.data?.format ?? "";
  const sourceOrderId = sourceQuery.data?.sourceOrderId ?? null;

  const suggestQuery = useQuery({
    queryKey: ["po-mapping-suggest", supplierId, detectedColumns],
    queryFn: () => suggestMappingFields(supplierId, detectedColumns),
    enabled: detectedColumns.length > 0,
    staleTime: 60_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["po-mapping-templates"],
    queryFn: getPoMappingTemplates,
    staleTime: Infinity, // static data — never re-fetch
  });

  const suggestionByField = useMemo<Record<string, FieldSuggestion>>(() => {
    const map: Record<string, FieldSuggestion> = {};
    for (const s of suggestQuery.data ?? []) map[s.canonicalField] = s;
    return map;
  }, [suggestQuery.data]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [accepted,      setAccepted]    = useState<Map<string, string>>(() => initAccepted(initialConfig));
  const [rejected,      setRejected]    = useState<Set<string>>(() => new Set());
  const [editing,       setEditing]     = useState<string | null>(null);
  const [editDraft,     setEditDraft]   = useState("");
  const [justDrawn,     setJustDrawn]   = useState<string | null>(null);
  const [showStandards, setShowStd]     = useState(false);
  const [sourceOpts,    setSourceOpts]  = useState({
    hasHeaderRecord: initialConfig?.hasHeaderRecord ?? true,
    separator: initialConfig?.separator ?? ",",
  });
  const [saveState, setSaveState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({ status: "idle" });
  const [autoNote,    setAutoNote]   = useState<string | null>(null);
  const [autoSeeded,  setAutoSeeded] = useState(!!initialConfig);

  const autoNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashNote(msg: string) {
    setAutoNote(msg);
    if (autoNoteTimer.current) clearTimeout(autoNoteTimer.current);
    autoNoteTimer.current = setTimeout(() => setAutoNote(null), 4000);
  }

  useEffect(() => () => {
    if (autoNoteTimer.current) clearTimeout(autoNoteTimer.current);
  }, []);

  // ── Auto-accept high-confidence suggestions on first load ──────────────────
  useEffect(() => {
    if (autoSeeded || !suggestQuery.data || suggestQuery.data.length === 0) return;
    const next = new Map<string, string>();
    for (const sug of suggestQuery.data) {
      if (sug.confidence >= AUTO_ACCEPT_THRESHOLD && sug.suggestedColumn) {
        next.set(sug.canonicalField, sug.suggestedColumn);
      }
    }
    if (next.size > 0) setAccepted(next);
    setAutoSeeded(true);
  }, [suggestQuery.data, autoSeeded]);

  // ── SVG connector measurement ──────────────────────────────────────────────
  const wrapRef   = useRef<HTMLDivElement>(null);
  const leftRefs  = useRef<Record<string, HTMLElement | null>>({});
  const rightRefs = useRef<Record<string, HTMLElement | null>>({});
  const [positions, setPositions] = useState<WirePos[]>([]);

  const measure = useCallback(() => {
    if (!wrapRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    if (wrap.width < 80) { setPositions([]); return; }

    const lines: WirePos[] = [];
    for (const f of ALL_CANONICAL) {
      const accColumn = accepted.get(f.canonical);
      const sug = suggestionByField[f.canonical];
      const pendColumn =
        !accColumn && !rejected.has(f.canonical) && sug?.suggestedColumn && sug.confidence >= ADOPT_THRESHOLD
          ? sug.suggestedColumn
          : null;
      const colName = accColumn ?? pendColumn;
      if (!colName) continue;

      const le = leftRefs.current[colName];
      const re = rightRefs.current[f.canonical];
      if (!le || !re) continue;

      const lr = le.getBoundingClientRect();
      const rr = re.getBoundingClientRect();
      lines.push({
        canonical: f.canonical,
        conf: accColumn ? 100 : Math.round((sug?.confidence ?? 0) * 100),
        accepted: !!accColumn,
        x1: lr.right  - wrap.left,
        y1: lr.top    + lr.height / 2 - wrap.top,
        x2: rr.left   - wrap.left,
        y2: rr.top    + rr.height / 2 - wrap.top,
      });
    }
    setPositions(lines);
  }, [accepted, rejected, suggestionByField]);

  useLayoutEffect(() => { measure(); }, [measure]);

  // Re-measure when new query data arrives (new refs) or showStandards changes row heights.
  useEffect(() => {
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
  }, [sourceQuery.data, suggestQuery.data, showStandards, editing, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleAccept(canonical: string, column: string) {
    setAccepted((prev) => new Map(prev).set(canonical, column));
    setRejected((prev) => { const n = new Set(prev); n.delete(canonical); return n; });
    setEditing(null);
    setSaveState({ status: "idle" });
    setJustDrawn(canonical);
    setTimeout(() => setJustDrawn(null), 900);
  }

  function handleReject(canonical: string) {
    setRejected((prev) => new Set(prev).add(canonical));
    setAccepted((prev) => { const n = new Map(prev); n.delete(canonical); return n; });
    setSaveState({ status: "idle" });
  }

  function handleAcceptAll() {
    const next = new Map(accepted);
    let count = 0;
    for (const sug of suggestQuery.data ?? []) {
      if (
        sug.suggestedColumn &&
        sug.confidence >= ADOPT_THRESHOLD &&
        !rejected.has(sug.canonicalField)
      ) {
        if (!next.has(sug.canonicalField)) count++;
        next.set(sug.canonicalField, sug.suggestedColumn);
      }
    }
    setAccepted(next);
    setSaveState({ status: "idle" });
    flashNote(count ? `Accepted ${count} suggestion${count !== 1 ? "s" : ""}.` : "Nothing new to accept.");
  }

  function handleEditStart(canonical: string) {
    setEditing(canonical);
    setEditDraft(accepted.get(canonical) ?? "");
  }

  function handleEditConfirm() {
    if (editing && editDraft.trim()) handleAccept(editing, editDraft.trim());
    else setEditing(null);
  }

  // ── Build PoMappingConfig from accepted map ─────────────────────────────────
  function buildConfig(): PoMappingConfig {
    const header: Record<string, FieldMappingEntry> = {};
    const lines:  Record<string, FieldMappingEntry> = {};
    for (const [canonical, column] of accepted) {
      if (!column) continue;
      const f = ALL_CANONICAL.find((c) => c.canonical === canonical);
      if (!f) continue;
      const entry: FieldMappingEntry = { externalField: column };
      if (f.section === "header") header[canonical] = entry;
      else lines[canonical] = entry;
    }
    return { hasHeaderRecord: sourceOpts.hasHeaderRecord, separator: sourceOpts.separator, header, lines };
  }

  async function handleSave() {
    setSaveState({ status: "saving" });
    try {
      await onSave(buildConfig());
      setSaveState({ status: "saved" });
    } catch (e) {
      setSaveState({ status: "error", message: e instanceof Error ? e.message : "Save failed" });
    }
  }

  function handleLoadTemplate(tpl: StarterTemplate) {
    // Build accepted map from the template config's ExternalField values
    const next = new Map<string, string>();
    for (const [canonical, entry] of Object.entries(tpl.config.header ?? {})) {
      if (entry?.externalField) next.set(canonical, entry.externalField);
    }
    for (const [canonical, entry] of Object.entries(tpl.config.lines ?? {})) {
      if (entry?.externalField) next.set(canonical, entry.externalField);
    }
    setAccepted(next);
    setRejected(new Set());
    setSourceOpts({
      hasHeaderRecord: tpl.config.hasHeaderRecord,
      separator: tpl.config.separator,
    });
    setSaveState({ status: "idle" });
    flashNote(`Loaded the ${tpl.name} starter — check the column names against your export, then Save.`);
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isSaving      = saving || saveState.status === "saving";
  const reqMapped     = REQUIRED_FIELDS.every((f) => accepted.has(f));
  const hasSuggestions = (suggestQuery.data ?? []).some(
    (s) => s.suggestedColumn && s.confidence >= ADOPT_THRESHOLD && !rejected.has(s.canonicalField),
  );

  // Left panel: detected columns enriched with usage info
  const leftColumns = useMemo(() => {
    const accValues = new Set(accepted.values());
    const sugColumns = new Set(
      (suggestQuery.data ?? [])
        .filter((s) => s.suggestedColumn && s.confidence >= ADOPT_THRESHOLD)
        .map((s) => s.suggestedColumn as string),
    );
    return detectedColumns.map((name) => ({
      name,
      sample:      sample?.[name] ?? "",
      used:        accValues.has(name),
      hasSuggest:  sugColumns.has(name),
    }));
  }, [detectedColumns, sample, accepted, suggestQuery.data]);

  // Unique gradient ID for accepted connectors (horizontal, object bbox)
  const gradId = "pme-wire-grad";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, background: SURFACE, boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
    >
      {/* Bridge cross-section edge */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${BLUE}, ${GREEN})` }} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3.5 sm:px-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3
              className="text-[15px] font-semibold tracking-[-0.01em]"
              style={{ color: NAVY, fontFamily: "Bricolage Grotesque, sans-serif" }}
            >
              PO field mapping
            </h3>
            <p className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
              Connect this supplier&apos;s source columns to the canonical order.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 flex-shrink-0">
            {/* Start from template ▾ */}
            {templatesQuery.data && templatesQuery.data.length > 0 && (
              <TemplatePicker
                templates={templatesQuery.data}
                onSelect={handleLoadTemplate}
              />
            )}
            <SourceStatus
              loading={sourceQuery.isLoading}
              format={fmt}
              columnCount={detectedColumns.length}
              sourceOrderId={sourceOrderId}
              hint={detectedColumns.length === 0 ? sourceQuery.data?.hint : undefined}
              onRedetect={() => sourceQuery.refetch()}
            />
          </div>
        </div>
      </div>

      {/* ── AI banner ──────────────────────────────────────────────────────── */}
      {suggestQuery.data && suggestQuery.data.length > 0 && (
        <div
          className="px-4 py-3 sm:px-5"
          style={{ background: AI_SOFT, borderBottom: "1px solid #D9CEF6" }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {/* zap icon */}
              <div
                style={{
                  width: 32, height: 32, borderRadius: 7,
                  background: SURFACE, border: "1px solid #E0D5F8",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M9 2L4 9h5l-1.5 5L14 8H9l1-6z" fill={AI} />
                </svg>
              </div>
              <div className="min-w-0">
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                  We detected <strong>{detectedColumns.length}</strong> column{detectedColumns.length !== 1 ? "s" : ""}
                  {" "}and matched <strong>{accepted.size}</strong> automatically.
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                  {fmt && (
                    <span
                      className="mr-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase"
                      style={{ background: BLUE_SOFT, color: BLUE_DEEP, fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {fmt.toUpperCase()}
                    </span>
                  )}
                  {sourceOrderId ? `From order ${sourceOrderId} · ` : ""}
                  Review and accept before saving.
                </div>
                {autoNote && (
                  <span
                    className="mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: BLUE_SOFT, color: BLUE_DEEP }}
                  >
                    {autoNote}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => sourceQuery.refetch()}
                className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
                style={{ background: SURFACE, color: MUTED, border: `1px solid ${BORDER}`, cursor: "pointer" }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M8 1v4l2.5-2" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Re-detect
              </button>
              {hasSuggestions && (
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
                  style={{ background: AI, color: "#FFF", border: "none", cursor: "pointer" }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 6.5L5 9.5L10 3" stroke="#FFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Accept all
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Column label + standards toggle ───────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2 sm:px-5"
        style={{ background: BG, borderBottom: `1px solid ${BORDER}` }}
      >
        <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          Connect columns → ProcuLink fields
        </span>
        <button
          type="button"
          onClick={() => setShowStd((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold"
          style={{ background: "none", border: "none", color: BLUE_DEEP, cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
            <rect x="1" y="3" width="12" height="8" rx="1.5" stroke={BLUE_DEEP} strokeWidth="1.4" />
            <path d="M4 7h6M4 9.5h3.5" stroke={BLUE_DEEP} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {showStandards ? "Hide standards" : "Show standards"}
        </button>
      </div>

      {/* ── Connect view ───────────────────────────────────────────────────── */}
      {sourceQuery.isLoading ? (
        <div className="flex justify-center px-4 py-10">
          <span style={{ fontSize: 12.5, color: FAINT }}>Detecting columns…</span>
        </div>
      ) : detectedColumns.length === 0 ? (
        <div className="px-4 py-8 text-center sm:px-5">
          <p style={{ fontSize: 13, color: MUTED }}>
            {sourceQuery.data?.hint ?? "No source columns detected. Upload a PO to this supplier to enable auto-mapping."}
          </p>
          <button
            type="button"
            onClick={() => sourceQuery.refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
            style={{ background: SURFACE, color: BLUE, border: `1px solid ${BORDER}`, cursor: "pointer" }}
          >
            Re-detect columns
          </button>
        </div>
      ) : (
        /* The measured container — SVG overlay spans the full div */
        <div ref={wrapRef} style={{ position: "relative", display: "flex", overflow: "visible" }}>

          {/* SVG connector overlay */}
          <svg
            aria-hidden
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              pointerEvents: "none", zIndex: 1,
              overflow: "visible",
            }}
          >
            <defs>
              {/* Horizontal gradient shared by all accepted wires */}
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor={BLUE}  />
                <stop offset="100%" stopColor={GREEN} />
              </linearGradient>
              <style>{`
                @keyframes pme-draw {
                  from { stroke-dashoffset: 400; stroke-dasharray: 400; }
                  to   { stroke-dashoffset: 0;   stroke-dasharray: 400; }
                }
              `}</style>
            </defs>

            {positions.map((p) => {
              const cx  = p.x1 + (p.x2 - p.x1) * 0.5;
              const d   = `M ${p.x1} ${p.y1} C ${cx} ${p.y1} ${cx} ${p.y2} ${p.x2} ${p.y2}`;
              const isDrawing = justDrawn === p.canonical;
              const stroke =
                p.accepted
                  ? `url(#${gradId})`
                  : p.conf >= 75
                  ? AMBER
                  : DANGER;
              return (
                <g key={p.canonical}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={p.accepted ? 2 : 1.5}
                    strokeDasharray={
                      isDrawing   ? 400 :
                      !p.accepted ? "5 4" :
                      undefined
                    }
                    style={isDrawing ? { animation: "pme-draw 800ms ease-out forwards" } : {}}
                  />
                  {/* Source endpoint (blue) */}
                  <circle cx={p.x1} cy={p.y1} r="3.5" fill={BLUE} />
                  {/* Destination endpoint (green) */}
                  <circle cx={p.x2} cy={p.y2} r="3.5" fill={GREEN} />
                </g>
              );
            })}
          </svg>

          {/* ── Left: detected source columns ──────────────────────────────── */}
          <div
            style={{
              flex: "0 0 calc(50% - 60px)",
              padding: "12px 14px",
              borderRight: `1px solid ${BORDER}`,
              minWidth: 0,
            }}
          >
            <div
              className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide"
              style={{ color: FAINT }}
            >
              Detected columns
              {fmt && (
                <span className="ml-1.5 normal-case font-normal tracking-normal">
                  · {fmt.toUpperCase()}
                </span>
              )}
            </div>
            {leftColumns.map((col) => (
              <div
                key={col.name}
                ref={(el) => { leftRefs.current[col.name] = el; }}
                style={{
                  minHeight: 52,
                  marginBottom: 8,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: `1px solid ${col.used ? "#CBE5CB" : BORDER}`,
                  background: col.used ? GREEN_SOFT : SURFACE,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  transition: "background 200ms ease, border-color 200ms ease",
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: col.used ? GREEN_DEEP : NAVY,
                  }}
                >
                  {col.name}
                </div>
                {col.sample ? (
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10.5,
                      color: FAINT,
                      marginTop: 1,
                    }}
                  >
                    e.g. {col.sample}
                  </div>
                ) : !col.hasSuggest ? (
                  <div style={{ fontSize: 10, color: FAINT, marginTop: 1 }}>
                    No confident match · will be ignored
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Center spacer — connectors travel through here */}
          <div style={{ flex: "0 0 120px", flexShrink: 0 }} />

          {/* ── Right: canonical ProcuLink fields ──────────────────────────── */}
          <div
            style={{
              flex: "0 0 calc(50% - 60px)",
              padding: "12px 14px",
              borderLeft: `1px solid ${BORDER}`,
              minWidth: 0,
            }}
          >
            <div
              className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide"
              style={{ color: FAINT }}
            >
              ProcuLink fields
            </div>
            {ALL_CANONICAL.map((f) => {
              const accColumn  = accepted.get(f.canonical);
              const sug        = suggestionByField[f.canonical];
              const pendColumn =
                !accColumn && !rejected.has(f.canonical) && sug?.suggestedColumn && sug.confidence >= ADOPT_THRESHOLD
                  ? sug.suggestedColumn
                  : null;
              const isAcc     = !!accColumn;
              const isPend    = !!pendColumn;
              const isEditing = editing === f.canonical;
              const conf      = isAcc ? 100 : pendColumn ? Math.round((sug?.confidence ?? 0) * 100) : 0;
              const bg        = isAcc ? GREEN_SOFT : isPend ? AMBER_SOFT : SURFACE;
              const bdColor   = isAcc ? "#CBE5CB"  : isPend ? "#E8CFA0"  : BORDER;

              return (
                <div
                  key={f.canonical}
                  ref={(el) => { rightRefs.current[f.canonical] = el; }}
                  style={{
                    minHeight: 52,
                    marginBottom: 8,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${bdColor}`,
                    background: bg,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  {/* Field header row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: isAcc ? GREEN_DEEP : NAVY }}>
                        {f.label}
                        {f.required && <span style={{ color: DANGER, marginLeft: 2 }}>*</span>}
                      </span>
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: FAINT,
                          marginTop: 1,
                        }}
                      >
                        {f.canonical}
                      </div>
                    </div>
                    {(isAcc || isPend) ? (
                      <ConfidenceChip conf={conf} />
                    ) : (
                      <span style={{ fontSize: 10.5, color: FAINT, flexShrink: 0 }}>unmapped</span>
                    )}
                  </div>

                  {/* Accepted: show source column + change / remove */}
                  {isAcc && !isEditing && (
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10.5,
                          color: GREEN_DEEP,
                        }}
                      >
                        ← {accColumn}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => handleEditStart(f.canonical)}
                          style={{ background: "none", border: "none", fontSize: 10.5, color: FAINT, cursor: "pointer", padding: 0 }}
                        >
                          change
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(f.canonical)}
                          style={{ background: "none", border: "none", fontSize: 11, color: FAINT, cursor: "pointer", padding: 0, lineHeight: 1 }}
                          aria-label="Remove mapping"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Pending suggestion: Accept / Edit / Reject */}
                  {isPend && !isEditing && (
                    <div style={{ marginTop: 6 }}>
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10.5,
                          color: AMBER,
                          marginBottom: 5,
                        }}
                      >
                        ← {pendColumn}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => handleAccept(f.canonical, pendColumn)}
                          style={{
                            padding: "2px 9px", borderRadius: 4,
                            border: `1px solid ${GREEN}`, background: GREEN_SOFT,
                            color: GREEN_DEEP, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditStart(f.canonical)}
                          style={{
                            padding: "2px 9px", borderRadius: 4,
                            border: `1px solid ${BORDER}`, background: SURFACE,
                            color: MUTED, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(f.canonical)}
                          style={{
                            padding: "2px 9px", borderRadius: 4,
                            border: "none", background: "none",
                            color: FAINT, fontSize: 11, cursor: "pointer",
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Editing: column combobox + confirm / cancel */}
                  {isEditing && (
                    <div style={{ marginTop: 6 }}>
                      <ColumnCombobox
                        value={editDraft}
                        options={detectedColumns}
                        placeholder="Pick or type a column"
                        onChange={(v) => setEditDraft(v)}
                      />
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={handleEditConfirm}
                          disabled={!editDraft.trim()}
                          style={{
                            padding: "2px 9px", borderRadius: 4,
                            border: `1px solid ${editDraft.trim() ? GREEN : INPUT_BDR}`,
                            background: editDraft.trim() ? GREEN_SOFT : SURFACE2,
                            color: editDraft.trim() ? GREEN_DEEP : FAINT,
                            fontSize: 11, fontWeight: 600,
                            cursor: editDraft.trim() ? "pointer" : "default",
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          style={{
                            padding: "2px 9px", borderRadius: 4,
                            border: `1px solid ${BORDER}`, background: "none",
                            color: FAINT, fontSize: 11, cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Standards strip */}
                  {showStandards && (
                    <div
                      style={{
                        marginTop: 6, paddingTop: 6,
                        borderTop: "1px dashed #D5DAEA",
                        fontSize: 10, color: MUTED,
                        fontFamily: "'JetBrains Mono', monospace",
                        lineHeight: 1.55,
                      }}
                    >
                      {f.standard}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Source options ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-2.5 sm:px-5"
        style={{ borderTop: `1px solid ${BORDER}`, background: BG }}
      >
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
          Separator
          <select
            value={sourceOpts.separator}
            onChange={(e) => {
              setSourceOpts((p) => ({ ...p, separator: e.target.value }));
              setSaveState({ status: "idle" });
            }}
            className="rounded-[5px] px-2 py-1 text-[12px]"
            style={{ border: `1px solid ${INPUT_BDR}`, background: SURFACE, color: NAVY }}
          >
            <option value=",">, (comma)</option>
            <option value=";">; (semicolon)</option>
            <option value={"\t"}>tab</option>
            <option value="|">| (pipe)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={sourceOpts.hasHeaderRecord}
            onChange={(e) => {
              setSourceOpts((p) => ({ ...p, hasHeaderRecord: e.target.checked }));
              setSaveState({ status: "idle" });
            }}
          />
          Has header row
        </label>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
        style={{ borderTop: `1px solid ${BORDER}`, background: SURFACE }}
      >
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-left text-[12px] font-medium"
            style={{ color: DANGER, background: "none", border: "none", cursor: "pointer" }}
          >
            Delete mapping
          </button>
        )}
        <div className="hidden flex-1 sm:block" />

        {/* Required fields status */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {reqMapped ? (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12, fontWeight: 600, color: GREEN_DEEP,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8.5l3.2 3.2L13 5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All required fields mapped
            </span>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 500, color: AMBER }}>
              Map required (*) fields to continue
            </span>
          )}
        </div>

        <SaveFeedback state={saveState} />

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center rounded-[6px] px-4 text-[13px] font-semibold transition-colors"
          style={{
            height: 34,
            background: isSaving ? FAINT : NAVY,
            color: "#FFF",
            border: "none",
            cursor: isSaving ? "default" : "pointer",
            opacity: !reqMapped && !isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? "Saving…" : "Save mapping"}
        </button>
      </div>
    </div>
  );
}

// ─── ConfidenceChip ───────────────────────────────────────────────────────────
function ConfidenceChip({ conf }: { conf: number }) {
  const [bg, color] =
    conf >= 85 ? [GREEN_SOFT, GREEN_DEEP] :
    conf >= 60 ? [AMBER_SOFT, AMBER] :
    ["#FBE3E3", DANGER];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "1px 6px", borderRadius: 10,
        fontSize: 10.5, fontWeight: 600, flexShrink: 0,
        background: bg, color,
      }}
    >
      {conf}%
    </span>
  );
}

// ─── SourceStatus ─────────────────────────────────────────────────────────────
function SourceStatus({
  loading, format, columnCount, sourceOrderId, hint, onRedetect,
}: {
  loading: boolean;
  format: string;
  columnCount: number;
  sourceOrderId: string | null;
  hint?: string;
  onRedetect: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {loading ? (
        <span style={{ fontSize: 12, color: FAINT }}>Detecting columns…</span>
      ) : columnCount > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {format && (
            <span
              style={{
                borderRadius: 4, padding: "1px 6px",
                fontSize: 10.5, fontWeight: 700,
                background: BLUE_SOFT, color: BLUE_DEEP,
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {format}
            </span>
          )}
          <span style={{ fontSize: 12, color: MUTED }}>
            {columnCount} column{columnCount !== 1 ? "s" : ""}
            {sourceOrderId && (
              <span style={{ color: FAINT }}> · from {sourceOrderId}</span>
            )}
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: AMBER }} title={hint ?? ""}>
          No sample detected
        </span>
      )}
      <button
        type="button"
        onClick={onRedetect}
        className="rounded-[5px] px-2 py-1 text-[11.5px] font-medium"
        style={{
          background: SURFACE, color: BLUE,
          border: `1px solid ${BORDER}`, cursor: "pointer",
        }}
      >
        Re-detect
      </button>
    </div>
  );
}

// ─── SaveFeedback ─────────────────────────────────────────────────────────────
function SaveFeedback({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "saved") {
    return (
      <span
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 12, fontWeight: 500, color: GREEN_DEEP,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8.5l3.2 3.2L13 5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Mapping saved
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span style={{ fontSize: 12, fontWeight: 500, color: DANGER }} title={state.message}>
        Couldn&apos;t save — {state.message ?? "try again"}
      </span>
    );
  }
  return null;
}

// ─── TemplatePicker ───────────────────────────────────────────────────────────
function TemplatePicker({
  templates,
  onSelect,
}: {
  templates: StarterTemplate[];
  onSelect: (tpl: StarterTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
        style={{
          background: SURFACE,
          color: BLUE_DEEP,
          border: `1px solid ${BORDER}`,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="1" y="2" width="12" height="3" rx="1" fill={BLUE_DEEP} opacity="0.25" />
          <rect x="1" y="6.5" width="8" height="3" rx="1" fill={BLUE_DEEP} opacity="0.5" />
          <rect x="1" y="11" width="5" height="3" rx="1" fill={BLUE_DEEP} />
        </svg>
        Start from template
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 3.5L5 6.5L8 3.5" stroke={BLUE_DEEP} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Starter templates"
          style={{
            position: "absolute",
            zIndex: 30,
            right: 0,
            marginTop: 4,
            minWidth: 260,
            background: SURFACE,
            border: `1px solid ${INPUT_BDR}`,
            borderRadius: 8,
            padding: "4px 0",
            boxShadow: "0 8px 24px rgba(11,26,47,0.14)",
          }}
        >
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              role="option"
              aria-selected={false}
              onPointerDown={(e) => {
                e.preventDefault();
                onSelect(tpl);
                setOpen(false);
              }}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLLIElement).style.background = BLUE_SOFT; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLLIElement).style.background = "transparent"; }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: NAVY }}>{tpl.name}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{tpl.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── ColumnCombobox ───────────────────────────────────────────────────────────
function ColumnCombobox({
  value, options, placeholder, onChange,
}: {
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive]   = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (showAll || !q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value, showAll]);

  function commit(v: string) { onChange(v); setOpen(false); setShowAll(false); }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setShowAll(true); return; }
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) { e.preventDefault(); commit(filtered[active]); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          value={value}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => { onChange(e.target.value); setOpen(true); setShowAll(false); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{
            width: "100%", borderRadius: 5,
            padding: "5px 26px 5px 10px",
            fontSize: 12, border: `1px solid #CBB8F2`,
            color: NAVY, background: "#FBFAFE", outline: "none",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setOpen((o) => !o); setShowAll(true); setActive(0); }}
          style={{
            position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", color: FAINT, padding: "0 2px",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: "absolute", zIndex: 20, marginTop: 2,
            maxHeight: 160, width: "100%", overflowY: "auto",
            background: SURFACE, border: `1px solid ${INPUT_BDR}`,
            borderRadius: 6, padding: "3px 0",
            boxShadow: "0 6px 20px rgba(11,26,47,0.12)",
          }}
        >
          {filtered.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              onMouseEnter={() => setActive(i)}
              onPointerDown={(e) => { e.preventDefault(); commit(opt); }}
              style={{
                padding: "5px 10px", cursor: "pointer",
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                background: i === active ? BLUE_SOFT : opt === value ? "#F4F7FD" : "transparent",
                color: NAVY,
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
