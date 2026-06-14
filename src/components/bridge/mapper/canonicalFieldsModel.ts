// Pure helpers for the CanonicalLane (center spine). No React, no DOM — TDD'd in jsdom.
//
//   • systemCanonicalNodes()  — the built-in spine, derived from the shared
//     CANONICAL_HEADER_FIELDS / CANONICAL_LINE_FIELDS, labelled + standards-tagged via the
//     standards catalog (single source of truth, no parallel label list).
//   • mergeCanonicalNodes(system, custom) — system-first, then custom by `order`, de-duped
//     by key (a custom field that shadows a system key is dropped — system always wins).
//   • validateNewFieldName(name, existing) — derives a stable PascalCase `key` and validates
//     a user-entered custom-field name against the existing key set.

import { CANONICAL_HEADER_FIELDS, CANONICAL_LINE_FIELDS } from "@/lib/api/types";
import type { CanonicalFieldDef } from "@/lib/api/types";
import { getFieldStandards } from "@/lib/standards/catalog";
import type { CanonicalNode } from "./types";

/**
 * The built-in canonical spine as CanonicalNodes (system, not removable). Labels +
 * standardsRef come from the standards catalog so there is no parallel label list to
 * drift. Header fields first (in CANONICAL_HEADER_FIELDS order), then line fields.
 */
export function systemCanonicalNodes(): CanonicalNode[] {
  const header: CanonicalNode[] = CANONICAL_HEADER_FIELDS.map((key) => toSystemNode(key, "header"));
  const line: CanonicalNode[] = CANONICAL_LINE_FIELDS.map((key) => toSystemNode(key, "line"));
  return [...header, ...line];
}

function toSystemNode(key: string, scope: "header" | "line"): CanonicalNode {
  const std = getFieldStandards(key);
  return {
    id: key,
    label: std?.label ?? humanizeKey(key),
    scope,
    system: true,
    // Surface UBL as the "standardsRef" hint; the full multi-standard view stays in the popover.
    standardsRef: std?.ubl ?? null,
  };
}

/**
 * Merge the system spine with the Tier-2 custom defs into one ordered, de-duped node list.
 * System nodes always come first (in their fixed order); custom nodes follow, sorted by
 * `order` (then insertion). A custom key that collides with a system key is dropped — the
 * system field wins (you cannot shadow a built-in canonical field).
 */
export function mergeCanonicalNodes(
  system: CanonicalNode[],
  custom: CanonicalFieldDef[],
): CanonicalNode[] {
  const systemKeys = new Set(system.map((n) => n.id));
  const seen = new Set(systemKeys);
  const customNodes: CanonicalNode[] = [...custom]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((d) => {
      if (seen.has(d.key)) return false; // drop system-shadowing + duplicate custom keys
      seen.add(d.key);
      return true;
    })
    .map((d) => ({
      id: d.key,
      label: d.label,
      scope: d.scope,
      system: false,
      standardsRef: d.standardsRef ?? null,
    }));
  return [...system, ...customNodes];
}

export interface NewFieldValidation {
  ok: boolean;
  /** Derived stable key (PascalCase) when ok; empty otherwise. */
  key: string;
  /** Human-readable error when !ok. */
  error?: string;
}

/**
 * Validate a user-entered custom canonical field name and derive its stable key.
 * Rules: non-blank, must contain at least one alphanumeric, and the derived PascalCase
 * key must not collide with an existing canonical key (system or custom).
 */
export function validateNewFieldName(name: string, existingKeys: Iterable<string>): NewFieldValidation {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, key: "", error: "Enter a field name." };
  const key = toKey(trimmed);
  if (!key) return { ok: false, key: "", error: "Use at least one letter or number." };
  const set = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  if (set.has(key)) return { ok: false, key, error: `A field named “${key}” already exists.` };
  return { ok: true, key };
}

/** "ship to city" / "ship_to_city" / "ShipToCity" → "ShipToCity". Alnum only. */
export function toKey(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Fallback label for a system key with no catalog entry: split PascalCase into words. */
function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
