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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { resolveSuggestionBasis } from "./suggestionBasisModel";
import {
  buildIncomingFromOrder,
  rawExtraFieldsFromTokens,
  cleanSuggestionsAgainstDedup,
  type IncomingOrderShape,
} from "./incomingFromOrder";
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
  withAddOutputField,
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
  /**
   * The parsed Order the incoming column is built from (order variant — SpineReview already
   * has it). The canonical Order values (poNumber/buyerName/lines/…) become the incoming
   * fields DIRECTLY, so a PDF/XLSX order is just as populated as a CSV one. When absent the
   * model falls back to the tokenized SourceToken set (the old behaviour, only meaningful for
   * CSV/XML). getSourceTokens then contributes ONLY the optional "Extra raw fields" group.
   */
  incomingOrder?: IncomingOrderShape | null;
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
  /**
   * Add a NEW declared output field (both variants). Persists a pass-through rule so the field
   * shows in the outgoing lane; materializes the current spine first so existing fields don't
   * collapse. No-op for a duplicate path. Read-only → ignored.
   */
  onAddField: (outputPath: string, scope: "header" | "line") => void;
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
  variant, scopeId, revisionId, previewOrderId, initialOverride, incomingOrder, readOnly,
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
  useEffect(() => { setDraft(null); }, [scopeId, revisionId]);
  const override = draft ?? overrideQuery.data ?? emptyOverride();
  // B9: the draft value REPLACED by the in-flight optimistic edit. apply() records it right
  // before setDraft(next) so a failed save can roll the draft back to exactly what it was
  // (null = fall back to server data). A ref, not state — it must hold the pre-edit value at
  // mutate time without itself triggering a render.
  const rollbackDraftRef = useRef<OrderMappingOverride | null>(null);

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
  // getFieldValidation throws on any non-2xx that isn't a 404 (mapper-ai.ts), so an errored
  // query means we asked and could not be told. `blockingCount` is 0 in that case for the same
  // reason it is 0 for a clean order, which is precisely why the flag has to travel separately.
  const validationUnavailable = validationQuery.isError;

  // ── Catalog price/code hints (mock-fallback returns []) ────────────────────
  const catalogQuery = useQuery({
    queryKey: ["mapper-catalog-hints", effectivePreviewOrderId],
    queryFn: () => getCatalogHints(effectivePreviewOrderId as string),
    enabled: enabled && !!effectivePreviewOrderId,
  });
  const catalogHints = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const catalogHintByLine = useMemo(() => indexCatalogHints(catalogHints), [catalogHints]);
  // getCatalogHints throws on any non-2xx that isn't a 404 (mapper-ai.ts), so an errored query
  // means we asked and could not be told. The empty map it leaves behind is the SAME map a
  // supplier with a clean catalog produces — identical to the validation case above, which is
  // why the flag travels separately instead of being inferred from `size === 0`.
  const catalogUnavailable = catalogQuery.isError;

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

  // ── INCOMING fields — values from the parsed Order DIRECTLY (root-cause fix #1) ──
  // The canonical Order values (poNumber / buyerName / lines / …) build the incoming
  // column for EVERY order regardless of tokenization (PDF/XLSX never tokenize). The
  // tokenized SourceToken bag contributes ONLY the optional "Extra raw fields" group,
  // de-duped against the canonical rows. When no Order is supplied (legacy / connection
  // sample with no order object) we fall back to the tokenized set so nothing regresses.
  const canonicalIncoming = useMemo<SourceField[]>(
    () => buildIncomingFromOrder(incomingOrder ?? null),
    [incomingOrder],
  );

  // The raw-extra rows that SURVIVED dedup (genuine extras, not a promoted-field duplicate). Only
  // these are legitimate AI suggestion sources — a deduped duplicate (e.g. a raw `po_number` that
  // mirrors the promoted PoNumber) must never seed a suggestion (founder bug 1: a raw `po_number`
  // got proposed for the BuyerName output). Empty when there's no Order to promote against (legacy
  // token-only path), in which case every token is a valid source and we don't filter.
  const keptRawExtras = useMemo<SourceField[]>(
    () => (canonicalIncoming.length > 0 ? rawExtraFieldsFromTokens(tokens, canonicalIncoming) : []),
    [canonicalIncoming, tokens],
  );
  const keptRawExtraIds = useMemo(() => new Set(keptRawExtras.map((f) => f.id)), [keptRawExtras]);
  const hasPromotedSpine = canonicalIncoming.length > 0;

  // AI suggestions, cleaned of duplicate-source noise BEFORE they become ghost wires (bug 1):
  //   • a raw-source suggestion whose token was DEDUPED (duplicates a promoted canonical field) is
  //     dropped — the promoted field is already the source; binding the raw duplicate (often to an
  //     UNRELATED output like BuyerName) is exactly the bad auto-map the founder hit.
  // Canonical-source suggestions are always kept (they ARE the promoted source). When there's no
  // promoted spine (token-only legacy path) nothing is filtered.
  const cleanSuggestions = useMemo<MappingSuggestion[]>(
    () => cleanSuggestionsAgainstDedup(rawSuggestions, keptRawExtraIds, hasPromotedSpine),
    [rawSuggestions, hasPromotedSpine, keptRawExtraIds],
  );

  // A token is "suggested" when a (cleaned) suggestion proposes it as a source.
  const suggestionByToken = useMemo(() => {
    const m = new Map<string, MappingSuggestion>();
    for (const s of cleanSuggestions) if (s.sourceKind !== "canonical") m.set(s.sourceId, s);
    return m;
  }, [cleanSuggestions]);

  // Order path MERGES canonical + authored (wiring/adding never collapses the document);
  // connection path uses the declared schema as-is. Declared FIRST so the "used as a source"
  // calc below (bug 3) can see which output paths exist for the 1:1 auto default.
  const targetFields = useMemo(
    () => deriveTargetFields(override.output, variant === "order"),
    [override.output, variant],
  );

  // Incoming ids that are ACTUALLY USED as a mapping source. The old code keyed "mapped" only on
  // EXPLICIT wires (wiredFromIds), so an order whose 13 outputs all resolve via the 1:1 auto
  // default showed "Mapped 0 / Unmapped 34" in the incoming pills while the header said
  // "13 of 13 mapped" — contradictory (founder bug 3). An incoming canonical field is used when:
  //   • it's explicitly wired (wiredFromIds), OR
  //   • an output path equals its canonical id (the 1:1 auto carries it) and that output isn't
  //     re-pointed to a different source. Raw extras are "used" only via an explicit wire.
  const usedAsSourceIds = useMemo(() => {
    const s = new Set(wiredFromIds);
    const declaredOutputPaths = new Set(targetFields.map((f) => f.outputPath));
    for (const f of canonicalIncoming) {
      // A canonical incoming field feeds the matching output via the auto 1:1 default, unless that
      // output has been explicitly re-pointed to another source.
      if (declaredOutputPaths.has(f.id) && !outputConnections[f.id]) s.add(f.id);
    }
    return s;
  }, [wiredFromIds, targetFields, canonicalIncoming, outputConnections]);

  const sourceFields = useMemo<SourceField[]>(() => {
    const base = canonicalIncoming.length > 0
      ? [...canonicalIncoming, ...keptRawExtras]
      : tokens.map((t) => toSourceField(t, false, null, null));
    // Overlay used-as-source + suggestion state by row id (canonical key OR raw token id).
    return base.map((f) => {
      const sug = suggestionByToken.get(f.id);
      return {
        ...f,
        mapped: usedAsSourceIds.has(f.id),
        suggestedFor: sug?.targetKey ?? f.suggestedFor ?? null,
        // When a suggestion exists, ITS confidence is authoritative — including when that
        // confidence is `null` (a saved-mapping entry, which nothing scored). This was
        // `sug?.confidence ?? f.suggestionConfidence ?? null`, and `??` would have walked
        // straight past the legitimate null onto whatever number the row happened to carry,
        // re-fabricating the very score the null exists to deny. The model path is
        // unchanged: a real 0..1 score is not null, so it wins either way.
        suggestionConfidence: sug ? sug.confidence : f.suggestionConfidence ?? null,
        suggestionBasis: sug
          ? resolveSuggestionBasis(sug.basis, sug.confidence)
          : f.suggestionBasis ?? null,
      };
    });
  }, [canonicalIncoming, keptRawExtras, tokens, suggestionByToken, usedAsSourceIds]);

  // ── Value lookups for the OutgoingPane's honest value preview ───────────────
  // canonicalValueByKey: the order's effective parsed value per canonical key, used for the
  // 1:1 auto preview AND the value behind a canonical→output wire. Built DIRECTLY from the
  // Order's canonical incoming fields (whose id IS the canonical key) so every order type —
  // including PDF/XLSX that never tokenize — gets real value previews. When no Order was
  // supplied we fall back to matching tokenized labels against canonical keys (legacy path).
  const canonicalValueByKey = useMemo(() => {
    const out = new Map<string, string>();
    if (canonicalIncoming.length > 0) {
      for (const f of canonicalIncoming) if (f.value !== "" && !out.has(f.id)) out.set(f.id, f.value);
      return out;
    }
    const byLabel = new Map<string, string>();
    for (const t of tokens) {
      const key = (t.label ?? "").trim().toLowerCase();
      if (key && !byLabel.has(key)) byLabel.set(key, t.value);
    }
    for (const node of canonicalNodes) {
      const std = getFieldStandards(node.id);
      const candidates = [std?.label?.toLowerCase(), node.id.toLowerCase()].filter(Boolean) as string[];
      for (const c of candidates) {
        const v = byLabel.get(c);
        if (v != null && v !== "") { out.set(node.id, v); break; }
      }
    }
    return out;
  }, [canonicalIncoming, tokens, canonicalNodes]);

  // tokenValueById: id → value for BOTH raw tokens AND canonical incoming rows. The outgoing
  // status model resolves a canonical→output wire by looking up the wired source's value here
  // when it isn't a raw token, so canonical rows must be present too.
  const tokenValueById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tokens) m.set(t.id, t.value);
    for (const [k, v] of canonicalValueByKey) m.set(k, v);
    return m;
  }, [tokens, canonicalValueByKey]);

  const labelForCanonical = useCallback(
    (key: string) => getFieldStandards(key)?.label ?? canonicalNodes.find((n) => n.id === key)?.label ?? key,
    [canonicalNodes],
  );

  // ── Persistence ────────────────────────────────────────────────────────────
  const [lastTouched, setLastTouched] = useState<string | null>(null);
  // Save error promoted from a ref to state so a failed save repaints reliably (a ref
  // mutation doesn't trigger a render — it previously only painted because saveMut.isPending
  // flipped on settle). Cleared on mutate/success, set on error.
  const [saveErr, setSaveErr] = useState<string | null>(null);

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
        existingOutputTree: next.outputTree ?? null,
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
    onMutate: () => { setSaveErr(null); },
    onSuccess: (doc) => {
      setSaveErr(null);
      // Reflect the server's canonical copy into the cache + local draft.
      qc.setQueryData(["mapper-override", variant, scopeId, revisionId ?? null], doc);
      // MV-1 / D-3 / D-4: for a per-ORDER override, the saved mapping changes what
      // will be delivered. (1) Invalidate ["order", id] so status/artifact recompute
      // from server truth — the backend resets a transformed order back to `ready` on
      // an override change, and without this refetch the workshop keeps the stale
      // ready_to_deliver status and Send redelivers the PRE-EDIT artifact. (2)
      // Invalidate the host's ["mapping-override", id] read key — the workshop's
      // "what we'll send" preview reads THAT, not the engine's ["mapper-override"] key,
      // so it would otherwise show a stale preview until staleTime.
      if (variant === "order") {
        qc.invalidateQueries({ queryKey: ["order", scopeId] });
        qc.invalidateQueries({ queryKey: ["mapping-override", scopeId] });
      }
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
    () => cleanSuggestions.filter((s) => !dismissed.has(sKey(s))),
    [cleanSuggestions, dismissed],
  );

  const signature = useMemo(() => {
    const sc = Object.entries(sourceConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    const oc = Object.entries(outputConnections).map(([k, v]) => `${k}:${v}`).sort().join(",");
    return `${canonicalNodes.length}|${targetFields.length}|${tokens.length}|${sc}|${oc}`;
  }, [canonicalNodes.length, targetFields.length, tokens.length, sourceConnections, outputConnections]);

  // The connection's resolved output format (only known on the connection variant, where the
  // revision is loaded). Normalize the loose string ('Json'/'CSV'/…) to a valid OutputFormatId
  // so the preview toggle can seed from it; null when unknown so the pane falls back to CSV.
  const outputFormat = useMemo(() => normalizeOutputFormat(revisionQuery.data?.outputFormat ?? null), [revisionQuery.data?.outputFormat]);

  const loading =
    overrideQuery.isLoading ||
    (variant === "connection" && !!revisionId && revisionQuery.isLoading) ||
    // Tokens are now OPTIONAL extras (the incoming column comes from the Order). Only block
    // on the token fetch when we have NO Order to build incoming fields from, so a PDF order
    // (tokens=[]) never shows a stuck skeleton waiting on a fetch that returns empty.
    (canonicalIncoming.length === 0 && !!effectivePreviewOrderId && tokensQuery.isLoading);

  return {
    loading,
    saving: saveMut.isPending,
    error: saveErr,
    override,
    sourceFields,
    // True when there IS incoming data (canonical from the Order or tokenized) — drives the
    // honest empty state. Not keyed on tokens alone (a PDF order has 0 tokens but data).
    hasIncomingSource: canonicalIncoming.length > 0 || tokens.length > 0,
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
    previewOrderId: effectivePreviewOrderId,
    outputFormat,
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

/** Normalize a loose output-format string ('Json'/'CSV'/'cXML'/…) to a valid OutputFormatId, or null. */
function normalizeOutputFormat(raw: string | null | undefined): import("@/lib/api/types").OutputFormatId | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "csv" || v === "json" || v === "xml" || v === "cxml" || v === "ubl" || v === "x12" ? v : null;
}

/** Read an output path's current manipulator (fx) chain from an override (per-row badge feed). */
export function fieldManipulatorsOf(override: OrderMappingOverride, outputPath: string): ManipulatorEntry[] {
  const cfg = override.output;
  if (!cfg) return [];
  const rule: OutputFieldRule | undefined = cfg.header?.[outputPath] ?? cfg.lines?.[outputPath];
  return rule?.fieldManipulators ?? [];
}
