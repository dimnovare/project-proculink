// Pure draft-mutation helpers for useMapperModel. No React, no network — every state
// transition the mapper makes (wire a source→canonical, re-point a canonical→target,
// disconnect, set a fixed value, rename/add an output path) is expressed here as a pure
// (override) → (override) function so it is unit-testable in jsdom and shared by both the
// order path and the connection path.
//
// CRITICAL INVARIANT (from OutputMappingEditor history — founder-reported data loss):
// the backend PUT replaces the WHOLE OrderMappingOverride document. Every helper here
// returns a NEW override that carries ALL existing sub-documents through unchanged
// (customFields + sourceMap + output + template). A connect on one side must never blank
// the other. buildOverrideDraft (OutputMappingEditor) is the canonical assembler; these
// helpers produce the pieces it carries.

import type {
  OrderMappingOverride,
  OutputMappingConfig,
  OutputFieldRule,
  SourceFieldRule,
} from "@/lib/api/types";
import { CANONICAL_LINE_FIELDS } from "@/lib/api/types";

const LINE_KEYS = new Set<string>(CANONICAL_LINE_FIELDS);

/** A blank but well-formed override (no overrides → byte-identical transform). */
export function emptyOverride(): OrderMappingOverride {
  return { customFields: [], output: null, sourceMap: null };
}

/** Read the sourceMap (canonicalField → rule) defensively. */
export function getSourceMap(o: OrderMappingOverride | null | undefined): Record<string, SourceFieldRule> {
  return { ...(o?.sourceMap ?? {}) };
}

/** Derive the canonicalField → sourceToken id projection the wire layer consumes. */
export function sourceConnections(o: OrderMappingOverride | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, rule] of Object.entries(o?.sourceMap ?? {})) {
    if (rule?.sourceToken) out[field] = rule.sourceToken;
  }
  return out;
}

/** Derive the outputPath → canonicalField projection (the override side) the wire layer consumes. */
export function outputConnections(o: OrderMappingOverride | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const cfg = o?.output;
  if (!cfg) return out;
  for (const rec of [cfg.header, cfg.lines]) {
    for (const [, rule] of Object.entries(rec ?? {})) {
      if (rule?.canonicalField) out[rule.outputPath] = rule.canonicalField;
    }
  }
  return out;
}

/** Derive outputPath → fixed literal value (a target with a constant instead of a source). */
export function fixedValues(o: OrderMappingOverride | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const cfg = o?.output;
  if (!cfg) return out;
  for (const rec of [cfg.header, cfg.lines]) {
    for (const [, rule] of Object.entries(rec ?? {})) {
      if (rule?.fixedValue != null && (rule.canonicalField == null || rule.canonicalField === "")) {
        out[rule.outputPath] = rule.fixedValue;
      }
    }
  }
  return out;
}

// ── Source → canonical mutations ──────────────────────────────────────────────

/** Wire a source token to a canonical field (preserves the field's manipulators). */
export function withSourceConnect(
  o: OrderMappingOverride | null | undefined,
  canonicalField: string,
  tokenId: string,
): OrderMappingOverride {
  const base = o ?? emptyOverride();
  const sm = getSourceMap(base);
  const prev = sm[canonicalField];
  sm[canonicalField] = { sourceToken: tokenId, fixedValue: prev?.fixedValue ?? null, manipulators: prev?.manipulators ?? [] };
  return { ...base, customFields: base.customFields ?? [], sourceMap: sm };
}

/** Remove a source→canonical wire (drops the rule entirely → pass-through). */
export function withSourceDisconnect(
  o: OrderMappingOverride | null | undefined,
  canonicalField: string,
): OrderMappingOverride {
  const base = o ?? emptyOverride();
  const sm = getSourceMap(base);
  delete sm[canonicalField];
  return { ...base, customFields: base.customFields ?? [], sourceMap: Object.keys(sm).length ? sm : null };
}

// ── Canonical → target mutations ──────────────────────────────────────────────

function scopeOf(outputPath: string, canonicalField: string): "header" | "lines" {
  return LINE_KEYS.has(canonicalField) || LINE_KEYS.has(outputPath) ? "lines" : "header";
}

function cloneOutput(cfg: OutputMappingConfig | null | undefined): OutputMappingConfig {
  return { header: { ...(cfg?.header ?? {}) }, lines: { ...(cfg?.lines ?? {}) } };
}

/** Find an existing rule for an output path across both scopes (header wins on a tie). */
function findRule(cfg: OutputMappingConfig, outputPath: string): { scope: "header" | "lines"; rule: OutputFieldRule } | null {
  if (cfg.header[outputPath]) return { scope: "header", rule: cfg.header[outputPath] };
  if (cfg.lines[outputPath]) return { scope: "lines", rule: cfg.lines[outputPath] };
  return null;
}

/** Re-point an output path to a canonical source (preserves manipulators; clears any fixed value). */
export function withTargetConnect(
  o: OrderMappingOverride | null | undefined,
  canonicalField: string,
  outputPath: string,
): OrderMappingOverride {
  const base = o ?? emptyOverride();
  const cfg = cloneOutput(base.output);
  const existing = findRule(cfg, outputPath);
  const manipulators = existing?.rule.fieldManipulators ?? [];
  // Remove any stale rule in the other scope so a path lives in exactly one scope.
  delete cfg.header[outputPath];
  delete cfg.lines[outputPath];
  const scope = existing?.scope ?? scopeOf(outputPath, canonicalField);
  cfg[scope][outputPath] = { outputPath, canonicalField, fixedValue: null, fieldManipulators: manipulators };
  return { ...base, customFields: base.customFields ?? [], output: cfg };
}

/** Revert an output path to its DEFAULT source (drop the override rule entirely). */
export function withTargetDisconnect(
  o: OrderMappingOverride | null | undefined,
  outputPath: string,
): OrderMappingOverride {
  const base = o ?? emptyOverride();
  if (!base.output) return base;
  const cfg = cloneOutput(base.output);
  delete cfg.header[outputPath];
  delete cfg.lines[outputPath];
  const empty = Object.keys(cfg.header).length === 0 && Object.keys(cfg.lines).length === 0;
  return { ...base, customFields: base.customFields ?? [], output: empty ? null : cfg };
}

/** Set (or clear, value=null) a fixed literal for an output path. */
export function withFixedValue(
  o: OrderMappingOverride | null | undefined,
  outputPath: string,
  value: string | null,
  scopeHint: "header" | "line" = "header",
): OrderMappingOverride {
  const base = o ?? emptyOverride();
  const cfg = cloneOutput(base.output);
  const existing = findRule(cfg, outputPath);
  if (value == null || value === "") {
    // Clearing a fixed value: drop the rule unless it carried manipulators worth keeping.
    if (existing && (existing.rule.fieldManipulators?.length ?? 0) === 0 && !existing.rule.canonicalField) {
      delete cfg.header[outputPath];
      delete cfg.lines[outputPath];
    } else if (existing) {
      cfg[existing.scope][outputPath] = { ...existing.rule, fixedValue: null };
    }
  } else {
    const scope = existing?.scope ?? (scopeHint === "line" ? "lines" : "header");
    delete cfg.header[outputPath];
    delete cfg.lines[outputPath];
    cfg[scope][outputPath] = { outputPath, canonicalField: null, fixedValue: value, fieldManipulators: existing?.rule.fieldManipulators ?? [] };
  }
  const empty = Object.keys(cfg.header).length === 0 && Object.keys(cfg.lines).length === 0;
  return { ...base, customFields: base.customFields ?? [], output: empty ? null : cfg };
}
