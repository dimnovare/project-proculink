"use client";

// useMapperModel — the SINGLE state hook behind ThreePaneMapper. It owns:
//   • loading the draft mapping (order: OrderMappingOverride; connection: the draft
//     revision's outputMappingJson, parsed into the same internal override shape so the
//     wire engine is variant-agnostic);
//   • loading source tokens (the Phase-1 SourceCapture set; raw-bag fields carry group="raw");
//   • merging the canonical spine with Tier-2 custom fields (CanonicalLane client);
//   • deriving the lane props: sourceFields, canonicalNodes, targetFields, and the two
//     connection projections (sourceConnections / outputConnections) the engine reads;
//   • the mutators (onSourceConnect / onTargetConnect / disconnects / fixed value), each
//     applying a PURE mapperModel transform then PERSISTING via buildOverrideDraft;
//   • a `signature` string bumped on every change so the wire engine re-measures.
//
// CRITICAL INVARIANT (OutputMappingEditor history — founder-reported data loss): the
// backend PUT replaces the WHOLE OrderMappingOverride. We ALWAYS persist via
// buildOverrideDraft, carrying customFields + sourceMap + template through unchanged. The
// pure mapperModel helpers never blank the other side, and buildOverrideDraft re-attaches
// the current sourceMap explicitly. Never hand-roll the saved document.

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  getMappingOverride,
  upsertMappingOverride,
  getSourceTokens,
  getConnectionRevision,
  updateConnectionDraft,
} from "@/lib/api-client";
import { getCanonicalFields } from "@/lib/api/canonical-fields";
import {
  getMappingSuggestions,
  recordSuggestionDecision,
  getFieldValidation,
  getCatalogHints,
} from "@/lib/api/mapper-ai";
import { buildOverrideDraft } from "../OutputMappingEditor";
import type {
  OrderMappingOverride,
  OutputFieldRule,
  ManipulatorEntry,
  SourceToken,
  CanonicalFieldDef,
  MappingSuggestion,
  FieldValidationState,
  CatalogPriceHint,
} from "@/lib/api/types";
import type { CanonicalNode, SourceField, TargetField } from "./types";
import { indexValidation, indexCatalogHints, blockingReviewCount } from "./fieldBadgesModel";
import { systemCanonicalNodes, mergeCanonicalNodes } from "./canonicalFieldsModel";
import { deriveTargetFields } from "./targetLaneModel";
import {
  emptyOverride,
  sourceConnections as projectSourceConnections,
  outputConnections as projectOutputConnections,
  fixedValues as projectFixedValues,
  withSourceConnect,
  withSourceDisconnect,
  withTargetConnect,
  withTargetDisconnect,
  withFixedValue,
  withFieldManipulators,
  withCatalogPrice,
} from "./mapperModel";

export interface UseMapperModelArgs {
  variant: "order" | "connection";
  /** orderId (order) or connectionId (connection). */
  scopeId: string;
  /** Required for the connection variant — the DRAFT revision being authored. */
  revisionId?: string;
  supplierId?: string;
  /** When the host already loaded the override (SpineReview does), seed from it. */
  initialOverride?: OrderMappingOverride | null;
  /** Connection variant: published revision → read-only. */
  readOnly?: boolean;
}

export interface MapperModel {
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** The current draft (the source of truth the engine + preview read). */
  override: OrderMappingOverride;
  sourceFields: SourceField[];
  sourceFileKey: string | null;
  canonicalNodes: CanonicalNode[];
  customFields: CanonicalFieldDef[];
  targetFields: TargetField[];
  sourceConnections: Record<string, string>;
  outputConnections: Record<string, string>;
  fixedValues: Record<string, string>;
  knownSourceTokenIds: Set<string>;
  suggestions: MappingSuggestion[];
  /** Per-field validation lookup (output path / canonical key → state). */
  validationByKey: Map<string, FieldValidationState>;
  /** Per-line catalog price/code variance lookup (lineKey → hint). */
  catalogHintByLine: Map<string, CatalogPriceHint>;
  /** Count of BLOCKING review badges — the Deliver button gate. */
  blockingCount: number;
  /** Bumped on every change → re-measures the wires. */
  signature: string;
  /** The last field key the user touched (drives preview's just-touched highlight). */
  lastTouched: string | null;
  readOnly: boolean;
  // Mutators (each persists through buildOverrideDraft).
  onSourceConnect: (tokenId: string, canonicalField: string) => void;
  onSourceDisconnect: (canonicalField: string) => void;
  onTargetConnect: (canonicalField: string, outputPath: string) => void;
  onTargetDisconnect: (outputPath: string) => void;
  onSetFixedValue: (outputPath: string, value: string | null, scope?: "header" | "line") => void;
  onAcceptSuggestion: (s: MappingSuggestion) => void;
  onRejectSuggestion: (s: MappingSuggestion) => void;
  /** Replace an output field's manipulator (fx) chain (Task 9 pills). */
  onFieldManipulatorsChange: (outputPath: string, next: ManipulatorEntry[], scope?: "header" | "line") => void;
  /** Apply a catalog price as a fixed-value override on an output path (Task 9 action). */
  onUseCatalogPrice: (outputPath: string, hint: CatalogPriceHint, scope?: "header" | "line") => void;
}

/** Map a backend SourceToken into a discovery SourceField (group-bucketed). */
function toSourceField(t: SourceToken, mapped: boolean, suggestedFor: string | null, confidence: number | null): SourceField {
  // The backend group hint is "header" | "line" | null (CSV/XML). The Phase-1 raw bag
  // tags its overflow tokens group="raw"; party fields group="parties". Anything else
  // defaults to header so it is visible (not hidden in a collapsed raw group).
  const g = (t.group ?? "").toLowerCase();
  const group: SourceField["group"] =
    g === "line" ? "line" : g === "raw" ? "raw" : g === "parties" || g === "party" ? "parties" : "header";
  return { id: t.id, label: t.label, value: t.value, group, mapped, suggestedFor, suggestionConfidence: confidence };
}

/** Parse a connection draft's outputMappingJson into the internal override shape (output side). */
function overrideFromConnectionJson(outputMappingJson: string | null | undefined): OrderMappingOverride {
  const base = emptyOverride();
  if (!outputMappingJson) return base;
  try {
    const parsed = JSON.parse(outputMappingJson);
    // Accept either a bare OutputMappingConfig or a full OrderMappingOverride-ish doc.
    if (parsed && (parsed.header || parsed.lines)) {
      return { ...base, output: { header: parsed.header ?? {}, lines: parsed.lines ?? {} } };
    }
    if (parsed && typeof parsed === "object") {
      return { customFields: parsed.customFields ?? [], output: parsed.output ?? null, sourceMap: parsed.sourceMap ?? null, outputTemplate: parsed.outputTemplate ?? null, outputTemplateContentType: parsed.outputTemplateContentType ?? null };
    }
  } catch {
    // Malformed JSON → start clean rather than crash (the editor re-authors it).
  }
  return base;
}

export function useMapperModel({
  variant, scopeId, revisionId, initialOverride, readOnly,
}: UseMapperModelArgs): MapperModel {
  const qc = useQueryClient();
  const enabled = useQueriesEnabled();

  // ── Load the draft override ────────────────────────────────────────────────
  const overrideQuery = useQuery({
    queryKey: ["mapper-override", variant, scopeId, revisionId ?? null],
    queryFn: async (): Promise<OrderMappingOverride> => {
      if (variant === "order") return (await getMappingOverride(scopeId)) ?? emptyOverride();
      // connection
      if (!revisionId) return emptyOverride();
      const rev = await getConnectionRevision(scopeId, revisionId);
      return overrideFromConnectionJson(rev?.outputMappingJson ?? null);
    },
    enabled: enabled && (variant === "order" || !!revisionId),
    initialData: variant === "order" && initialOverride !== undefined ? (initialOverride ?? emptyOverride()) : undefined,
  });

  // Local draft mirrors the server override but is mutated optimistically + persisted.
  const [draft, setDraft] = useState<OrderMappingOverride | null>(null);
  const override = draft ?? overrideQuery.data ?? emptyOverride();

  // ── Source tokens (order path; the connection path wires against a sample later) ──
  const tokensQuery = useQuery({
    queryKey: ["mapper-source-tokens", variant, scopeId],
    queryFn: () => getSourceTokens(scopeId),
    enabled: enabled && variant === "order",
  });
  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);

  // ── Tier-2 custom canonical fields ─────────────────────────────────────────
  const fieldsQuery = useQuery({
    queryKey: ["canonical-fields", scopeId],
    queryFn: () => getCanonicalFields(scopeId),
    enabled,
  });
  const customFields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  // ── AI suggestions (mock-fallback returns []) ──────────────────────────────
  const suggestionsQuery = useQuery({
    queryKey: ["mapper-suggestions", variant, scopeId],
    queryFn: () => getMappingSuggestions(scopeId),
    enabled: enabled && variant === "order",
  });
  const rawSuggestions = useMemo(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);

  // ── Validation badges (mock-fallback returns []) ───────────────────────────
  const validationQuery = useQuery({
    queryKey: ["mapper-validation", variant, scopeId],
    queryFn: () => getFieldValidation(scopeId),
    enabled: enabled && variant === "order",
  });
  const validationStates = useMemo(() => validationQuery.data ?? [], [validationQuery.data]);
  const validationByKey = useMemo(() => indexValidation(validationStates), [validationStates]);
  const blockingCount = useMemo(() => blockingReviewCount(validationStates), [validationStates]);

  // ── Catalog price/code hints (mock-fallback returns []) ────────────────────
  const catalogQuery = useQuery({
    queryKey: ["mapper-catalog-hints", variant, scopeId],
    queryFn: () => getCatalogHints(scopeId),
    enabled: enabled && variant === "order",
  });
  const catalogHints = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const catalogHintByLine = useMemo(() => indexCatalogHints(catalogHints), [catalogHints]);

  // ── Derived lane props ─────────────────────────────────────────────────────
  const canonicalNodes = useMemo(
    () => mergeCanonicalNodes(systemCanonicalNodes(), customFields),
    [customFields],
  );

  const sourceConnections = useMemo(() => projectSourceConnections(override), [override]);
  const outputConnections = useMemo(() => projectOutputConnections(override), [override]);
  const fixedValues = useMemo(() => projectFixedValues(override), [override]);
  const knownSourceTokenIds = useMemo(() => new Set(tokens.map((t) => t.id)), [tokens]);
  const wiredTokenIds = useMemo(() => new Set(Object.values(sourceConnections)), [sourceConnections]);

  // A token is "suggested" when a suggestion proposes it as a source.
  const suggestionByToken = useMemo(() => {
    const m = new Map<string, MappingSuggestion>();
    for (const s of rawSuggestions) if (s.sourceKind !== "canonical") m.set(s.sourceId, s);
    return m;
  }, [rawSuggestions]);

  const sourceFields = useMemo<SourceField[]>(() => {
    return tokens.map((t) => {
      const sug = suggestionByToken.get(t.id);
      return toSourceField(t, wiredTokenIds.has(t.id), sug?.targetKey ?? null, sug?.confidence ?? null);
    });
  }, [tokens, suggestionByToken, wiredTokenIds]);

  const targetFields = useMemo(() => deriveTargetFields(override.output), [override.output]);

  // ── Persistence ────────────────────────────────────────────────────────────
  const [lastTouched, setLastTouched] = useState<string | null>(null);
  const saveErrRef = useRef<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async (next: OrderMappingOverride) => {
      // ALWAYS assemble via buildOverrideDraft so customFields + sourceMap + template
      // carry through unchanged (the documented data-loss guard).
      const doc = buildOverrideDraft({
        customFields: next.customFields ?? [],
        header: next.output?.header ?? {},
        lines: next.output?.lines ?? {},
        templateMode: !!next.outputTemplate,
        template: next.outputTemplate ?? "",
        templateContentType: next.outputTemplateContentType ?? "application/json",
        existingSourceMap: next.sourceMap ?? null,
      });
      if (variant === "order") {
        return upsertMappingOverride(scopeId, doc);
      }
      // connection: persist the OUTPUT side into the draft revision's outputMappingJson,
      // leaving the other bundle fields to the host's own draft editor.
      if (!revisionId) return doc;
      await updateConnectionDraft(scopeId, revisionId, {
        outputMappingJson: JSON.stringify(doc.output ?? null),
        deliveryAutoDeliver: false,
        catalogMode: "live",
      });
      return doc;
    },
    onSuccess: (doc) => {
      saveErrRef.current = null;
      // Reflect the server's canonical copy into the cache + local draft.
      qc.setQueryData(["mapper-override", variant, scopeId, revisionId ?? null], doc);
    },
    onError: (e) => { saveErrRef.current = e instanceof Error ? e.message : "Couldn’t save the mapping."; },
  });

  // Apply a pure transform → optimistic local draft + bump signature + persist.
  const apply = useCallback((next: OrderMappingOverride, touched: string | null) => {
    if (readOnly) return;
    setDraft(next);
    setLastTouched(touched);
    saveMut.mutate(next);
  }, [readOnly, saveMut]);

  const onSourceConnect = useCallback((tokenId: string, canonicalField: string) => {
    apply(withSourceConnect(override, canonicalField, tokenId), canonicalField);
  }, [apply, override]);

  const onSourceDisconnect = useCallback((canonicalField: string) => {
    apply(withSourceDisconnect(override, canonicalField), canonicalField);
  }, [apply, override]);

  const onTargetConnect = useCallback((canonicalField: string, outputPath: string) => {
    apply(withTargetConnect(override, canonicalField, outputPath), outputPath);
  }, [apply, override]);

  const onTargetDisconnect = useCallback((outputPath: string) => {
    apply(withTargetDisconnect(override, outputPath), outputPath);
  }, [apply, override]);

  const onSetFixedValue = useCallback((outputPath: string, value: string | null, scope: "header" | "line" = "header") => {
    apply(withFixedValue(override, outputPath, value, scope), outputPath);
  }, [apply, override]);

  const onFieldManipulatorsChange = useCallback((outputPath: string, next: ManipulatorEntry[], scope: "header" | "line" = "header") => {
    apply(withFieldManipulators(override, outputPath, next, scope), outputPath);
  }, [apply, override]);

  const onUseCatalogPrice = useCallback((outputPath: string, hint: CatalogPriceHint, scope: "header" | "line" = "line") => {
    if (hint.catalogPrice == null) return;
    apply(withCatalogPrice(override, outputPath, hint.catalogPrice, scope), outputPath);
  }, [apply, override]);

  // Promote a ghost wire to a real wire (decide the side by sourceKind), then drop it locally.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const sKey = (s: MappingSuggestion) => `${s.targetKey}<-${s.sourceId}`;

  const onAcceptSuggestion = useCallback((s: MappingSuggestion) => {
    if (s.sourceKind === "canonical") {
      // canonical → target: targetKey is an output path, sourceId is a canonical key.
      onTargetConnect(s.sourceId, s.targetKey);
    } else {
      // raw/custom source → canonical: targetKey is a canonical key, sourceId is a token id.
      onSourceConnect(s.sourceId, s.targetKey);
    }
    setDismissed((d) => new Set(d).add(sKey(s)));
    // Feed the V9 calibration loop (best-effort, non-throwing telemetry).
    if (variant === "order") {
      void recordSuggestionDecision(scopeId, { targetKey: s.targetKey, sourceId: s.sourceId, accepted: true, confidence: s.confidence });
    }
  }, [onSourceConnect, onTargetConnect, variant, scopeId]);

  const onRejectSuggestion = useCallback((s: MappingSuggestion) => {
    setDismissed((d) => new Set(d).add(sKey(s)));
    if (variant === "order") {
      void recordSuggestionDecision(scopeId, { targetKey: s.targetKey, sourceId: s.sourceId, accepted: false, confidence: s.confidence });
    }
  }, [variant, scopeId]);

  const suggestions = useMemo(
    () => rawSuggestions.filter((s) => !dismissed.has(sKey(s))),
    [rawSuggestions, dismissed],
  );

  const signature = useMemo(() => {
    const sc = Object.entries(sourceConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    const oc = Object.entries(outputConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    return `${canonicalNodes.length}|${targetFields.length}|${tokens.length}|${sc}|${oc}`;
  }, [canonicalNodes.length, targetFields.length, tokens.length, sourceConnections, outputConnections]);

  const loading = overrideQuery.isLoading || (variant === "order" && tokensQuery.isLoading);

  return {
    loading,
    saving: saveMut.isPending,
    error: saveErrRef.current,
    override,
    sourceFields,
    sourceFileKey: tokens.length > 0 ? scopeId : null,
    canonicalNodes,
    customFields,
    targetFields,
    sourceConnections,
    outputConnections,
    fixedValues,
    knownSourceTokenIds,
    suggestions,
    validationByKey,
    catalogHintByLine,
    blockingCount,
    signature,
    lastTouched,
    readOnly: !!readOnly,
    onSourceConnect,
    onSourceDisconnect,
    onTargetConnect,
    onTargetDisconnect,
    onSetFixedValue,
    onAcceptSuggestion,
    onRejectSuggestion,
    onFieldManipulatorsChange,
    onUseCatalogPrice,
  };
}

/** Read an output path's current manipulator (fx) chain from an override (per-row badge feed). */
export function fieldManipulatorsOf(override: OrderMappingOverride, outputPath: string): ManipulatorEntry[] {
  const cfg = override.output;
  if (!cfg) return [];
  const rule: OutputFieldRule | undefined = cfg.header?.[outputPath] ?? cfg.lines?.[outputPath];
  return rule?.fieldManipulators ?? [];
}
