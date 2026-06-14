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
import { getFieldStandards } from "@/lib/standards/catalog";
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
  overrideFromConnectionBundle,
  inputMappingJsonFromOverride,
  outputMappingJsonFromOverride,
} from "./connectionBundleModel";
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
  /**
   * Connection variant only: a sample/recent order for this supplier the author wires +
   * previews against (there is no single order on the author-once connection path). The
   * source tokens and the live preview both run against this order. Null/undefined → the
   * source lane shows its empty state and the preview shows its honest "no sample" hint.
   */
  previewOrderId?: string | null;
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
  /**
   * True when the AI suggestion endpoint errored (not a 404/mock — those return []
   * silently). Drives the honest "AI suggestions unavailable" note; manual wiring is
   * unaffected, there are simply no ghost wires.
   */
  aiUnavailable: boolean;
  /** Per-field validation lookup (output path / canonical key → state). */
  validationByKey: Map<string, FieldValidationState>;
  /** Per-line catalog price/code variance lookup (lineKey → hint). */
  catalogHintByLine: Map<string, CatalogPriceHint>;
  /** Count of BLOCKING review badges — the Deliver button gate. */
  blockingCount: number;
  /** sourceTokenId → its raw value (drives the OutgoingPane value preview). */
  tokenValueById: Map<string, string>;
  /**
   * canonicalField key → the order's effective parsed value, for the auto 1:1 preview. Built
   * from the source tokens whose group hint matches a canonical key (best-effort, never throws).
   */
  canonicalValueByKey: Map<string, string>;
  /** Human label for a canonical field key (for the "← PO number" outgoing source tag). */
  labelForCanonical: (key: string) => string;
  /** Bumped on every change → re-measures the wires. */
  signature: string;
  /** The last field key the user touched (drives preview's just-touched highlight). */
  lastTouched: string | null;
  /** The order id the live preview runs against (order: the order; connection: the sample). */
  previewOrderId: string | null;
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

export function useMapperModel({
  variant, scopeId, revisionId, previewOrderId, initialOverride, readOnly,
}: UseMapperModelArgs): MapperModel {
  const qc = useQueryClient();
  const enabled = useQueriesEnabled();

  // The order id the source lane + preview run against. Order variant: the order itself.
  // Connection variant (author-once): a sample/recent order for this supplier (no single order).
  const effectivePreviewOrderId = variant === "order" ? scopeId : (previewOrderId ?? null);

  // ── Connection revision (full bundle) — retained so a save can carry EVERY bundle
  //    field through unchanged (deliveryProtocol/itemMappings/acceptance/…). The PUT
  //    replaces the WHOLE bundle, so writing only outputMappingJson would wipe the rest. ──
  const revisionQuery = useQuery({
    queryKey: ["mapper-connection-revision", scopeId, revisionId ?? null],
    queryFn: () => getConnectionRevision(scopeId, revisionId as string),
    enabled: enabled && variant === "connection" && !!revisionId,
  });

  // ── Load the draft override ────────────────────────────────────────────────
  const overrideQuery = useQuery({
    queryKey: ["mapper-override", variant, scopeId, revisionId ?? null],
    queryFn: async (): Promise<OrderMappingOverride> => {
      if (variant === "order") return (await getMappingOverride(scopeId)) ?? emptyOverride();
      // connection — both sides live in the bundle: inputMappingJson (source→canonical)
      // + outputMappingJson (canonical→target). Merge them into one internal override.
      if (!revisionId) return emptyOverride();
      const rev = await getConnectionRevision(scopeId, revisionId);
      return overrideFromConnectionBundle(rev?.inputMappingJson ?? null, rev?.outputMappingJson ?? null);
    },
    enabled: enabled && (variant === "order" || !!revisionId),
    initialData: variant === "order" && initialOverride !== undefined ? (initialOverride ?? emptyOverride()) : undefined,
  });

  // Local draft mirrors the server override but is mutated optimistically + persisted.
  const [draft, setDraft] = useState<OrderMappingOverride | null>(null);
  const override = draft ?? overrideQuery.data ?? emptyOverride();

  // ── Source tokens — order: the order; connection: the sample/recent order. ──
  const tokensQuery = useQuery({
    queryKey: ["mapper-source-tokens", variant, scopeId, effectivePreviewOrderId],
    queryFn: () => getSourceTokens(effectivePreviewOrderId as string),
    enabled: enabled && !!effectivePreviewOrderId,
  });
  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);

  // ── Tier-2 custom canonical fields ─────────────────────────────────────────
  // Custom canonical fields are authored at the CONNECTION; their CRUD route is
  // connection-scoped (`/api/connections/{connectionId}/canonical-fields`). In ORDER mode
  // scopeId is an orderId, which is NOT a valid connection route — fetching it would
  // mismatch once the real CanonicalFieldsController lands. Per-order custom fields are a
  // different concept (OrderMappingOverride.CustomFields). So only the connection variant
  // queries this route; order mode uses just the system spine (custom fields = []).
  const fieldsQuery = useQuery({
    queryKey: ["canonical-fields", scopeId],
    queryFn: () => getCanonicalFields(scopeId),
    enabled: enabled && variant === "connection",
  });
  const customFields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  // ── AI suggestions (mock-fallback returns []) ──────────────────────────────
  // Order-scoped: keyed on the order we wire against (order: the order; connection: the
  // sample order). No sample order on a connection → no suggestions, manual wiring works.
  const suggestionsQuery = useQuery({
    queryKey: ["mapper-suggestions", effectivePreviewOrderId],
    queryFn: () => getMappingSuggestions(effectivePreviewOrderId as string),
    enabled: enabled && !!effectivePreviewOrderId,
  });
  const rawSuggestions = useMemo(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);
  // AI is "unavailable" only on a genuine error (the client swallows mock/404 → []). When
  // unavailable: no ghost wires, an honest note in the shell, manual wiring fully works.
  const aiUnavailable = suggestionsQuery.isError;

  // ── Validation badges (mock-fallback returns []) ───────────────────────────
  const validationQuery = useQuery({
    queryKey: ["mapper-validation", effectivePreviewOrderId],
    queryFn: () => getFieldValidation(effectivePreviewOrderId as string),
    enabled: enabled && !!effectivePreviewOrderId,
  });
  const validationStates = useMemo(() => validationQuery.data ?? [], [validationQuery.data]);
  const validationByKey = useMemo(() => indexValidation(validationStates), [validationStates]);
  const blockingCount = useMemo(() => blockingReviewCount(validationStates), [validationStates]);

  // ── Catalog price/code hints (mock-fallback returns []) ────────────────────
  const catalogQuery = useQuery({
    queryKey: ["mapper-catalog-hints", effectivePreviewOrderId],
    queryFn: () => getCatalogHints(effectivePreviewOrderId as string),
    enabled: enabled && !!effectivePreviewOrderId,
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

  // ── Value lookups for the OutgoingPane's honest value preview ───────────────
  // tokenValueById: a wired source-token's raw value.
  const tokenValueById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tokens) m.set(t.id, t.value);
    return m;
  }, [tokens]);

  // canonicalValueByKey: the order's effective parsed value per canonical key, used for the
  // auto 1:1 preview (output path === canonical key, no override). The backend SourceToken
  // labels mirror the canonical field labels (PoNumber→"PO number", …), so we match a token to
  // a canonical key by label (via the standards catalog) or by the key/label directly. For line
  // fields we take the FIRST line token's value as a representative preview (the row is a single
  // summary row in the mapper, not per-line). Best-effort, never throws, empty when unknown.
  const canonicalValueByKey = useMemo(() => {
    const byLabel = new Map<string, string>();
    for (const t of tokens) {
      const key = (t.label ?? "").trim().toLowerCase();
      if (key && !byLabel.has(key)) byLabel.set(key, t.value);
    }
    const out = new Map<string, string>();
    const allKeys = [...canonicalNodes.map((n) => n.id)];
    for (const key of allKeys) {
      const std = getFieldStandards(key);
      const candidates = [std?.label?.toLowerCase(), key.toLowerCase()].filter(Boolean) as string[];
      for (const c of candidates) {
        const v = byLabel.get(c);
        if (v != null && v !== "") { out.set(key, v); break; }
      }
    }
    return out;
  }, [tokens, canonicalNodes]);

  const labelForCanonical = useCallback(
    (key: string) => getFieldStandards(key)?.label ?? canonicalNodes.find((n) => n.id === key)?.label ?? key,
    [canonicalNodes],
  );

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
      // connection: persist BOTH sides into the draft revision —
      //   • inputMappingJson  ← the source→canonical map (doc.sourceMap),
      //   • outputMappingJson ← the canonical→target config (doc.output).
      // The PUT replaces the WHOLE bundle, so we carry EVERY other bundle field through
      // unchanged from the loaded revision (deliveryProtocol/itemMappings/acceptance/…) —
      // the same data-loss guard as buildOverrideDraft, one level up. Without this, saving a
      // mapping would silently wipe the draft's delivery channel + item codes.
      if (!revisionId) return doc;
      const rev = revisionQuery.data ?? null;
      await updateConnectionDraft(scopeId, revisionId, {
        inputMappingJson: inputMappingJsonFromOverride(doc),
        outputMappingJson: outputMappingJsonFromOverride(doc),
        outputFormat: rev?.outputFormat ?? null,
        deliveryProtocol: rev?.deliveryProtocol ?? null,
        deliveryConfigJson: rev?.deliveryConfigJson ?? null,
        deliveryAutoDeliver: rev?.deliveryAutoDeliver ?? false,
        acceptanceProfileId: rev?.acceptanceProfileId ?? null,
        acceptanceVersionNo: rev?.acceptanceVersionNo ?? null,
        catalogMode: rev?.catalogMode ?? "live",
        itemMappings: rev?.itemMappings ?? null,
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
    // Feed the V9 calibration loop (best-effort, non-throwing telemetry). Keyed on the
    // order we wired against (order: the order; connection: the sample order).
    if (effectivePreviewOrderId) {
      void recordSuggestionDecision(effectivePreviewOrderId, { targetKey: s.targetKey, sourceId: s.sourceId, accepted: true, confidence: s.confidence });
    }
  }, [onSourceConnect, onTargetConnect, effectivePreviewOrderId]);

  const onRejectSuggestion = useCallback((s: MappingSuggestion) => {
    setDismissed((d) => new Set(d).add(sKey(s)));
    if (effectivePreviewOrderId) {
      void recordSuggestionDecision(effectivePreviewOrderId, { targetKey: s.targetKey, sourceId: s.sourceId, accepted: false, confidence: s.confidence });
    }
  }, [effectivePreviewOrderId]);

  const suggestions = useMemo(
    () => rawSuggestions.filter((s) => !dismissed.has(sKey(s))),
    [rawSuggestions, dismissed],
  );

  const signature = useMemo(() => {
    const sc = Object.entries(sourceConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    const oc = Object.entries(outputConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    return `${canonicalNodes.length}|${targetFields.length}|${tokens.length}|${sc}|${oc}`;
  }, [canonicalNodes.length, targetFields.length, tokens.length, sourceConnections, outputConnections]);

  const loading =
    overrideQuery.isLoading ||
    (variant === "connection" && !!revisionId && revisionQuery.isLoading) ||
    (!!effectivePreviewOrderId && tokensQuery.isLoading);

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
    aiUnavailable,
    validationByKey,
    catalogHintByLine,
    blockingCount,
    tokenValueById,
    canonicalValueByKey,
    labelForCanonical,
    signature,
    lastTouched,
    previewOrderId: effectivePreviewOrderId,
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
