"use client";

// useMapperModel — the SINGLE state hook behind ThreePaneMapper. It owns:
//   • loading and saving the draft mapping through the flow adapter (the order and
//     connection variants, with their own load/save paths, went 2026-11-13);
//   • merging the canonical spine (CanonicalLane client);
//   • deriving the lane props: sourceFields, canonicalNodes, targetFields, and the two
//     connection projections (sourceConnections / outputConnections) the engine reads;
//   • the mutators (onSourceConnect / onTargetConnect / disconnects / fixed value), each
//     applying a PURE mapperModel transform then PERSISTING via adapter.save;
//   • a `signature` string bumped on every change so the wire engine re-measures.
//
// The pure mapperModel helpers never blank the other side of the override, so the whole
// document the adapter saves carries everything it was loaded with.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getFieldStandards } from "@/lib/standards/catalog";
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
import type { CanonicalNode, MapperAdapter, SourceField, TargetField } from "./types";
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
  withAddOutputField,
} from "./mapperModel";

const NO_TOKENS: SourceToken[] = [];
const NO_CUSTOM_FIELDS: CanonicalFieldDef[] = [];
const NO_SUGGESTIONS: MappingSuggestion[] = [];
const NO_VALIDATION: FieldValidationState[] = [];
const NO_CATALOG_HINTS: CatalogPriceHint[] = [];

export interface UseMapperModelArgs {
  variant: "flow";
  /** Where load / save / preview / sources come from. */
  adapter: MapperAdapter;
  /** The adapter's query-key scope (e.g. the flow output id). */
  scopeId: string;
  readOnly?: boolean;
}

export interface MapperModel {
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** The current draft (the source of truth the engine + preview read). */
  override: OrderMappingOverride;
  sourceFields: SourceField[];
  /**
   * Whether this order produced ANY incoming data — canonical values from the order, or
   * tokenized source fields. It picks which honest empty-state sentence the incoming pane shows
   * and nothing else.
   *
   * It was called `sourceFileKey: string | null` and was set to the ORDER ID, used purely for
   * its truthiness. The name promised a file key, so a second consumer read it as a filename
   * and passed it to a `key.split(".")` extension switch — which returned `undefined` on every
   * render, silently, for the life of the route. The value was always a boolean; it is now
   * spelled as one so there is nothing left to misread. The order's real source format comes
   * from `GET /api/orders/{id}/source`'s content type.
   */
  hasIncomingSource: boolean;
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
  /**
   * True when the field-validation endpoint errored. The mirror of `aiUnavailable` above, and
   * it did not exist: `validationStates` was `validationQuery.data ?? []` and `isError` was
   * never consulted, so a failed fetch produced an empty list, `blockingCount` 0, and a Send
   * gate that read "nothing is wrong" off a request that had failed.
   *
   * Unlike AI suggestions — whose absence costs nothing but ghost wires — validation is the
   * evidence the gate stands on, so its absence has to reach the gate rather than be swallowed.
   */
  validationUnavailable: boolean;
  /**
   * True when loading the saved mapping override FAILED (not a 404 — that resolves to
   * `null` and legitimately means "no override saved yet").
   *
   * This is the most dangerous of the three unavailable flags and it did not exist. The
   * backend PUT replaces the WHOLE OrderMappingOverride (see the CRITICAL INVARIANT at the
   * top of this file). When the GET fails, `overrideQuery.data` is undefined, `override`
   * falls back to `emptyOverride()`, and the workbench renders exactly as it does for an
   * order that has never been mapped. The first wire the operator drags then assembles a
   * draft from that EMPTY document and PUTs it — replacing a saved mapping we never read
   * with a blank one. A failed read became a destructive write.
   *
   * So the flag does two things: it refuses every mutator while it is set, and it drives the
   * banner that says why. Nothing about the failure may be silent — an editor that ignores
   * drags without explaining is its own defect.
   */
  overrideUnavailable: boolean;
  /** Per-field validation lookup (output path / canonical key → state). */
  validationByKey: Map<string, FieldValidationState>;
  /**
   * True when the catalog price/code hint fetch errored. The third mirror of
   * `aiUnavailable` / `validationUnavailable`, and the one query in this file that had no
   * such flag: `catalogHints` was `catalogQuery.data ?? []` with `isError` unread, so a
   * failed fetch produced an empty map and the toolbar stated "No catalog hints for this
   * order" — an absence asserted from a question that was never answered.
   */
  catalogUnavailable: boolean;
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
  /**
   * The connection's resolved output format (from the loaded revision), normalized to a valid
   * OutputFormatId, or null when unknown (order variant with no revision in scope). The preview
   * pane seeds its format toggle from this so a JSON supplier doesn't open on a CSV mismatch.
   */
  outputFormat: import("@/lib/api/types").OutputFormatId | null;
  readOnly: boolean;
  // Mutators (each persists through adapter.save).
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
  /**
   * Add a NEW declared output field (both variants). Persists a pass-through rule so the field
   * shows in the outgoing lane; materializes the current spine first so existing fields don't
   * collapse. No-op for a duplicate path. Read-only → ignored.
   */
  onAddField: (outputPath: string, scope: "header" | "line") => void;
}

export function useMapperModel({
  variant, adapter, scopeId, readOnly,
}: UseMapperModelArgs): MapperModel {
  const qc = useQueryClient();
  const enabled = useQueriesEnabled();

  // ── Load the draft override ────────────────────────────────────────────────
  const overrideQuery = useQuery({
    queryKey: ["mapper-override", variant, scopeId],
    queryFn: () => adapter.load(),
    enabled,
  });

  // Local draft mirrors the server override but is mutated optimistically + persisted.
  const [draft, setDraft] = useState<OrderMappingOverride | null>(null);
  useEffect(() => { setDraft(null); }, [scopeId]);
  const override = draft ?? overrideQuery.data ?? emptyOverride();
  // B9: the draft value REPLACED by the in-flight optimistic edit. apply() records it right
  // before setDraft(next) so a failed save can roll the draft back to exactly what it was
  // (null = fall back to server data). A ref, not state — it must hold the pre-edit value at
  // mutate time without itself triggering a render.
  const rollbackDraftRef = useRef<OrderMappingOverride | null>(null);

  // The order and connection variants went 2026-11-13, and with them every read keyed on
  // an order (source tokens, AI suggestions, validation, catalog hints) or a connection
  // (custom canonical fields). The flow adapter supplies none of those, so the model
  // reports them empty and the lanes render the adapter's own source fields.
  const tokens = NO_TOKENS;
  const customFields = NO_CUSTOM_FIELDS;
  const aiUnavailable = false;
  const validationByKey = useMemo(() => indexValidation(NO_VALIDATION), []);
  const blockingCount = blockingReviewCount(NO_VALIDATION);
  const validationUnavailable = false;
  const catalogHintByLine = useMemo(() => indexCatalogHints(NO_CATALOG_HINTS), []);
  const catalogUnavailable = false;

  // ── Derived lane props ─────────────────────────────────────────────────────
  const canonicalNodes = useMemo(
    () => mergeCanonicalNodes(systemCanonicalNodes(), customFields),
    [customFields],
  );

  const sourceConnections = useMemo(() => projectSourceConnections(override), [override]);
  const outputConnections = useMemo(() => projectOutputConnections(override), [override]);
  const fixedValues = useMemo(() => projectFixedValues(override), [override]);
  const knownSourceTokenIds = useMemo(() => new Set(tokens.map((t) => t.id)), [tokens]);
  // Incoming row ids that currently feed SOMETHING: a canonical key feeds an output when an
  // output path is wired from it (outputConnections value); a raw token feeds a canonical via
  // sourceMap (sourceConnections value). Union covers both incoming kinds in the 2-col model.
  const wiredFromIds = useMemo(() => {
    const s = new Set<string>();
    for (const v of Object.values(outputConnections)) if (v) s.add(v);
    for (const v of Object.values(sourceConnections)) if (v) s.add(v);
    return s;
  }, [outputConnections, sourceConnections]);

  // The row SET comes from the saved copy (its key set is the template's leaf set, which
  // never changes here), so a disconnect empties a row instead of hiding it until the save lands.
  const targetOutput = overrideQuery.data?.output;
  const targetFields = useMemo(() => deriveTargetFields(targetOutput, false, false), [targetOutput]);

  // Incoming ids that are ACTUALLY USED as a mapping source: the explicitly wired ones.
  const usedAsSourceIds = wiredFromIds;

  const sourceFields = useMemo<SourceField[]>(
    () => adapter.sourceFields.map((f) => ({
      ...f,
      mapped: usedAsSourceIds.has(f.id),
      suggestedFor: f.suggestedFor ?? null,
      suggestionConfidence: f.suggestionConfidence ?? null,
      suggestionBasis: f.suggestionBasis ?? null,
    })),
    [adapter, usedAsSourceIds],
  );

  // ── Value lookups for the OutgoingPane's honest value preview ───────────────
  // canonicalValueByKey: each source field's value by id (the id IS the key a wire names),
  // used for the value behind a source→output wire.
  const canonicalValueByKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of adapter.sourceFields) if (f.value !== "" && !out.has(f.id)) out.set(f.id, f.value);
    return out;
  }, [adapter]);

  // tokenValueById: the outgoing status model resolves a wire by looking up the wired
  // source's value here. With no raw tokens it is the same lookup.
  const tokenValueById = canonicalValueByKey;

  const labelForCanonical = useCallback(
    (key: string) =>
      adapter.sourceFields.find((f) => f.id === key)?.label ??
      getFieldStandards(key)?.label ?? canonicalNodes.find((n) => n.id === key)?.label ?? key,
    [adapter, canonicalNodes],
  );

  // ── Persistence ────────────────────────────────────────────────────────────
  const [lastTouched, setLastTouched] = useState<string | null>(null);
  // Save error promoted from a ref to state so a failed save repaints reliably (a ref
  // mutation doesn't trigger a render — it previously only painted because saveMut.isPending
  // flipped on settle). Cleared on mutate/success, set on error.
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async (next: OrderMappingOverride) => {
      return adapter.save(next);
    },
    onMutate: () => { setSaveErr(null); },
    onSuccess: (doc, sent) => {
      setSaveErr(null);
      // Reflect the server's canonical copy into the cache + local draft.
      qc.setQueryData(["mapper-override", variant, scopeId], doc);
      // Show what the server returned, not the draft it may have normalised — unless a newer
      // edit is already pending (saves overlap), whose draft must stay.
      setDraft((d) => (d === sent ? null : d));
    },
    // B9: roll the optimistic edit back on failure so the wires + "what we'll send" preview
    // reflect the REAL saved state, not the edit the server rejected. Restore the exact draft
    // value apply() snapshotted before mutating (null → fall back to server override data).
    onError: (e) => {
      setDraft(rollbackDraftRef.current);
      setSaveErr(e instanceof Error ? e.message : "Couldn’t save the mapping.");
    },
  });

  // The saved override could not be READ. See MapperModel.overrideUnavailable — this is the
  // one flag that has to reach `apply`, because the failure mode is a destructive write, not a
  // missing badge.
  const overrideUnavailable = overrideQuery.isError;

  // Apply a pure transform → optimistic local draft + bump signature + persist.
  const apply = useCallback((next: OrderMappingOverride, touched: string | null) => {
    if (readOnly) return;
    // REFUSE while the saved override is unknown. `override` is emptyOverride() in that state,
    // so `next` was assembled from a blank document — persisting it would PUT that blank over
    // the real saved mapping. Refusing costs one edit; not refusing costs the mapping.
    if (overrideUnavailable) return;
    // B9: capture the draft we're about to replace so onError can restore it verbatim.
    rollbackDraftRef.current = draft;
    setDraft(next);
    setLastTouched(touched);
    saveMut.mutate(next);
  }, [readOnly, overrideUnavailable, saveMut, draft]);

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

  const onAddField = useCallback((outputPath: string, scope: "header" | "line") => {
    // Seed with the paths the lane is currently showing so adding one field doesn't collapse the
    // visible spine (see withAddOutputField). targetFields is the effective list (spine fallback
    // included), each tagged with its scope.
    const currentPaths = targetFields.map((f) => ({ outputPath: f.outputPath, scope: f.scope }));
    apply(withAddOutputField(override, outputPath, scope, currentPaths), outputPath);
  }, [apply, override, targetFields]);

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
  }, [onSourceConnect, onTargetConnect]);

  const onRejectSuggestion = useCallback((s: MappingSuggestion) => {
    setDismissed((d) => new Set(d).add(sKey(s)));
  }, []);

  const suggestions = useMemo(
    () => NO_SUGGESTIONS.filter((s) => !dismissed.has(sKey(s))),
    [dismissed],
  );

  const signature = useMemo(() => {
    const sc = Object.entries(sourceConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    const oc = Object.entries(outputConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    return `${canonicalNodes.length}|${targetFields.length}|${tokens.length}|${sc}|${oc}`;
  }, [canonicalNodes.length, targetFields.length, tokens.length, sourceConnections, outputConnections]);

  const loading = overrideQuery.isLoading;

  return {
    loading,
    saving: saveMut.isPending,
    error: saveErr,
    override,
    sourceFields,
    // Was "an order or its tokens carried data" — never true for the flow adapter, which
    // reports its source through MapperWorkbench's `receivedDocument` instead.
    hasIncomingSource: false,
    canonicalNodes,
    customFields,
    targetFields,
    sourceConnections,
    outputConnections,
    fixedValues,
    knownSourceTokenIds,
    suggestions,
    aiUnavailable,
    validationUnavailable,
    overrideUnavailable,
    validationByKey,
    catalogUnavailable,
    catalogHintByLine,
    blockingCount,
    tokenValueById,
    canonicalValueByKey,
    labelForCanonical,
    signature,
    lastTouched,
    previewOrderId: null,
    outputFormat: null,
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
    onAddField,
  };
}

/** Read an output path's current manipulator (fx) chain from an override (per-row badge feed). */
export function fieldManipulatorsOf(override: OrderMappingOverride, outputPath: string): ManipulatorEntry[] {
  const cfg = override.output;
  if (!cfg) return [];
  const rule: OutputFieldRule | undefined = cfg.header?.[outputPath] ?? cfg.lines?.[outputPath];
  return rule?.fieldManipulators ?? [];
}
