// outputNamespacePresets — the XML namespace presets, and the two actions that end the mode
// collision (WP-16 · S15).
//
// WHY PRESETS. A namespace URI is a string a coordinator has no way to know and every way to
// mistype, and a typo does not fail — it emits a document in a namespace nobody recognises, which
// the receiver rejects after we have already reported the order delivered. One pick replaces the
// transcription.
//
// WHY ONLY THESE THREE. The work packet asked for "UBL 2.1 / cXML 1.2 / Peppol BIS 3 / custom".
// Two of those are not shipped, and the reasons are not stylistic:
//
//   • **cXML has no namespaces.** It is DTD-based. A "cXML namespace preset" would teach a
//     coordinator something false about the format they are trying to satisfy.
//   • **Peppol BIS 3** is the UBL namespaces plus three MANDATORY element values (UBLVersionID,
//     CustomizationID, ProfileID). A preset that seeded only the namespaces would produce a document
//     that looks like Peppol and is rejected by the network. Peppol was also just retracted as a
//     sold claim, and a preset carrying its name would read as a conformance claim being quietly
//     reinstated.
//
// Both formats are produced by their own dedicated transforms, set up on the supplier's Delivery
// tab. That is what the panel points at instead.

import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";

/** OASIS UBL 2.1 common basic components — the `cbc:` prefix, used on plain values. */
export const UBL_CBC_URI = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
/** OASIS UBL 2.1 common aggregate components — the `cac:` prefix, used on groups. */
export const UBL_CAC_URI = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";

export type NamespacePresetId = "none" | "ubl21" | "custom";

export interface NamespacePreset {
  id: NamespacePresetId;
  label: string;
  description: string;
}

export const NAMESPACE_PRESETS: readonly NamespacePreset[] = [
  {
    id: "none",
    label: "None",
    description: "Plain tags with no namespace. Right unless your supplier's spec says otherwise.",
  },
  {
    id: "ubl21",
    label: "UBL 2.1 (cbc:, cac:)",
    description: "Adds the two standard UBL labels: cbc: for plain values, cac: for groups.",
  },
  {
    id: "custom",
    label: "Custom…",
    description: "Type the prefixes and addresses your supplier's spec lists.",
  },
];

const UBL_MAP: Record<string, string> = { cbc: UBL_CBC_URI, cac: UBL_CAC_URI };

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
}

/**
 * Which preset the template's root map currently IS. `custom` is the fallthrough, so a hand-typed
 * map — or a UBL map with one extra prefix — keeps the editable rows rather than being silently
 * re-described as a preset it does not match.
 */
export function detectNamespacePreset(t: OutputNodeTemplate): NamespacePresetId {
  const ns = t.namespaces;
  if (!ns || Object.keys(ns).length === 0) return "none";
  return sameMap(ns, UBL_MAP) ? "ubl21" : "custom";
}

/**
 * Apply a preset to the ROOT namespace map only. The node tree is never touched: the two namespace
 * modes are mutually exclusive and this control owns the root-map one.
 *
 * `none` writes null rather than `{}` — the emitter branches on a non-empty map, and a template that
 * gained an empty object is no longer byte-identical to one that never had a map at all.
 */
export function applyNamespacePreset(t: OutputNodeTemplate, id: NamespacePresetId): OutputNodeTemplate {
  switch (id) {
    case "none": return { ...t, namespaces: null };
    case "ubl21": return { ...t, namespaces: { ...UBL_MAP } };
    // `custom` is a mode, not a value — it reveals the editable rows and leaves whatever is there.
    case "custom": return t;
  }
}

/** Every distinct prefix→URI pair carried by a node in the tree, in document order. */
function collectPrefixedNamespaces(node: OutputNode, into: Record<string, string>): void {
  const prefix = (node.prefix ?? "").trim();
  const uri = (node.namespace ?? "").trim();
  if (prefix !== "" && uri !== "" && !(prefix in into)) into[prefix] = uri;
  for (const child of node.children ?? []) collectPrefixedNamespaces(child, into);
}

/** Strip the prefixed pairs the hoist just captured, leaving prefixless (default) namespaces alone. */
function stripPrefixed(node: OutputNode): OutputNode {
  const prefix = (node.prefix ?? "").trim();
  const uri = (node.namespace ?? "").trim();
  const cleared = prefix !== "" && uri !== ""
    ? { ...node, namespace: null, prefix: null }
    : { ...node };
  if (node.children) cleared.children = node.children.map(stripPrefixed);
  return cleared;
}

/**
 * "Move them to the top" — the actionable half of the mode-collision warning.
 *
 * Mirrors the server's own `CollectPrefixedNamespaces`: walk the tree, take the distinct prefix→URI
 * pairs, write them to the root map, and clear the per-node pairs. Either mode alone is valid; both
 * together is the state the emitter throws on, and until now the warning naming it offered no
 * control that fixed it.
 *
 * A DEFAULT (prefixless) namespace is deliberately left where it is. There is no map key to hoist it
 * to, dropping it would change the document, and inventing a prefix would change the tag names the
 * supplier reads. It stays on its node and the caller reports it — a partial fix the user can see
 * beats a silent one they cannot.
 */
export function hoistPerNodeNamespaces(t: OutputNodeTemplate): OutputNodeTemplate {
  const collected: Record<string, string> = {};
  collectPrefixedNamespaces(t.root, collected);
  if (Object.keys(collected).length === 0) return t;
  return {
    ...t,
    namespaces: { ...(t.namespaces ?? {}), ...collected },
    root: stripPrefixed(t.root),
  };
}

/** True when a prefixless namespace would survive a hoist — the caller says so rather than lying. */
export function hasDefaultNamespace(node: OutputNode): boolean {
  const prefix = (node.prefix ?? "").trim();
  const uri = (node.namespace ?? "").trim();
  if (uri !== "" && prefix === "") return true;
  return (node.children ?? []).some(hasDefaultNamespace);
}

/** "Keep them on each element" — drop the root map, leaving the per-node pairs as the single mode. */
export function clearRootNamespaces(t: OutputNodeTemplate): OutputNodeTemplate {
  return { ...t, namespaces: null };
}
