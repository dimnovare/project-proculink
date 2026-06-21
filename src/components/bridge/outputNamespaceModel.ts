// outputNamespaceModel — pure tree helpers for the OutputStructureDesigner (T8).
//
// These are the immutable tree-edit primitives + the XML-namespace authoring/preservation logic,
// extracted so they can be unit-tested independently of the React component. The backend
// (OutputTemplateEmitter) honours per-node `namespace`/`prefix` and a root `namespaces` (prefix→uri)
// map for XML — a pasted UBL/namespaced sample INFERS to namespaced XML. The designer must therefore
// (a) carry inferred namespaces through every edit unchanged (no silent data loss), and (b) let the
// user author them.
//
// IMPORTANT — the emitter enforces TWO MUTUALLY-EXCLUSIVE namespace modes (mixing throws):
//   • PER-NODE:  nodes carry namespace/prefix (this is what the inferrer produces for UBL).
//   • ROOT-MAP:  template.namespaces declares xmlns:* on the root; nodes stay unprefixed (legacy).
// The UI guides the user to one mode at a time (see OutputStructureDesigner), but these helpers are
// agnostic — they only patch the tree immutably and preserve whatever namespaces are present.

import type { OutputNode, OutputNodeTemplate } from "@/lib/api/types";

// ── Immutable tree edits (moved verbatim from OutputStructureDesigner) ────────

/** Immutably update the node at `path` (array of child indices from the root). */
export function updateAt(node: OutputNode, path: number[], fn: (n: OutputNode) => OutputNode): OutputNode {
  if (path.length === 0) return fn(node);
  const [i, ...rest] = path;
  const children = (node.children ?? []).map((c, idx) => (idx === i ? updateAt(c, rest, fn) : c));
  return { ...node, children };
}

/** Immutably remove the node at `path` (a non-root path). */
export function removeAt(node: OutputNode, path: number[]): OutputNode {
  if (path.length === 1) return { ...node, children: (node.children ?? []).filter((_, idx) => idx !== path[0]) };
  const [i, ...rest] = path;
  const children = (node.children ?? []).map((c, idx) => (idx === i ? removeAt(c, rest) : c));
  return { ...node, children };
}

// ── Per-node XML namespace authoring ─────────────────────────────────────────

/**
 * Set/clear a node's XML namespace + prefix. Blank URI clears BOTH (so the node emits with no
 * namespace — byte-identical legacy path). A prefix with no URI is an unrenderable half-state the
 * emitter rejects, so a blank URI forces the prefix off too. `prefix` blank but URI set = a DEFAULT
 * namespace (no prefix). Leaves every other field (name, rule, children, includeWhen) untouched.
 */
export function setNodeNamespace(node: OutputNode, namespace: string | null, prefix: string | null): OutputNode {
  const uri = (namespace ?? "").trim();
  if (uri === "") {
    // No URI → strip both (prefix-without-namespace is illegal; the emitter throws on it).
    return { ...node, namespace: null, prefix: null };
  }
  const p = (prefix ?? "").trim();
  return { ...node, namespace: uri, prefix: p === "" ? null : p };
}

/** True when ANY node in the tree carries a per-node namespace or prefix (per-node mode is in use). */
export function treeHasPerNodeNamespaces(node: OutputNode): boolean {
  if ((node.namespace ?? "") !== "" || (node.prefix ?? "") !== "") return true;
  return (node.children ?? []).some(treeHasPerNodeNamespaces);
}

// ── Root namespaces (prefix → uri) map editing ───────────────────────────────

/** One editable row in the root-namespaces table. */
export interface NamespaceRow {
  prefix: string;
  uri: string;
}

/** Turn the template's `namespaces` record into an ordered row list for the table editor. */
export function namespacesToRows(ns: Record<string, string> | null | undefined): NamespaceRow[] {
  if (!ns) return [];
  return Object.entries(ns).map(([prefix, uri]) => ({ prefix, uri }));
}

/**
 * Turn the edited rows back into a `namespaces` record for saving. Blank-prefix or blank-uri rows are
 * dropped (incomplete). Returns null when nothing valid remains, so a cleared editor saves as "no root
 * namespaces" (byte-identical) rather than an empty object.
 */
export function rowsToNamespaces(rows: NamespaceRow[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const { prefix, uri } of rows) {
    const p = prefix.trim();
    const u = uri.trim();
    if (p === "" || u === "") continue;
    out[p] = u;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** True when the template carries a non-empty root namespaces map (root-map mode is in use). */
export function templateHasRootNamespaces(t: OutputNodeTemplate): boolean {
  return !!t.namespaces && Object.keys(t.namespaces).length > 0;
}
