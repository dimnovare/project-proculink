// outputNamespacePresets — the preset list and the two mode-collision fixes (WP-16 · S15).
//
// A namespace is a URI a coordinator has no way to know and every way to mistype. The presets exist
// so the common case is a pick, not a transcription. The tests below pin three things: the preset
// list is EXACTLY the three the audit settled on (no cXML, no Peppol), applying one is round-trip
// detectable, and the two "pick one place" actions leave the tree in a state the emitter accepts.

import { describe, it, expect } from "vitest";
import {
  NAMESPACE_PRESETS, UBL_CBC_URI, UBL_CAC_URI,
  applyNamespacePreset, detectNamespacePreset,
  hoistPerNodeNamespaces, clearRootNamespaces,
  type NamespacePresetId,
} from "./outputNamespacePresets";
import { treeHasPerNodeNamespaces, templateHasRootNamespaces } from "./outputNamespaceModel";
import type { OutputNodeTemplate } from "@/lib/api/types";

function xmlTree(): OutputNodeTemplate {
  return {
    format: "xml",
    root: { name: "Order", nodeType: "object", children: [
      { name: "ID", nodeType: "field", rule: { outputPath: "ID", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
    ] },
  };
}

describe("the preset list", () => {
  it("offers exactly None, UBL 2.1 and Custom", () => {
    expect(NAMESPACE_PRESETS.map((p) => p.id)).toEqual(["none", "ubl21", "custom"]);
  });

  // FE #91 retracted Peppol BIS 3 as a sold claim: the UBL emitter has visible mandatory-field
  // violations and there is no Schematron validation. cXML is DTD-based and has no namespaces at
  // all. A preset for either would teach a coordinator something false about the format they are
  // trying to satisfy, so neither ships — and this test is what stops one being added back.
  it("names neither Peppol nor cXML anywhere — not in an id, a label, or a description", () => {
    const text = JSON.stringify(NAMESPACE_PRESETS).toLowerCase();
    expect(text).not.toContain("peppol");
    expect(text).not.toContain("cxml");
    expect(text).not.toContain("bis 3");
  });

  it("every preset carries a label and a one-line description", () => {
    for (const p of NAMESPACE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe("applyNamespacePreset", () => {
  it("UBL 2.1 writes the two standard OASIS prefixes on the root", () => {
    const next = applyNamespacePreset(xmlTree(), "ubl21");
    expect(next.namespaces).toEqual({ cbc: UBL_CBC_URI, cac: UBL_CAC_URI });
  });

  it("the UBL URIs are the OASIS CommonBasicComponents-2 / CommonAggregateComponents-2 URIs", () => {
    expect(UBL_CBC_URI).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2");
    expect(UBL_CAC_URI).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2");
  });

  it("None clears the root map to null, not to an empty object", () => {
    const withUbl = applyNamespacePreset(xmlTree(), "ubl21");
    // `{}` and `null` are not the same on the wire: the emitter branches on a non-empty map, and a
    // template that gained an empty object is no longer byte-identical to one that never had a map.
    expect(applyNamespacePreset(withUbl, "none").namespaces).toBeNull();
  });

  it("Custom leaves whatever the user has already typed untouched", () => {
    const t: OutputNodeTemplate = { ...xmlTree(), namespaces: { foo: "urn:foo" } };
    expect(applyNamespacePreset(t, "custom").namespaces).toEqual({ foo: "urn:foo" });
  });

  it("never touches the node tree", () => {
    const t = xmlTree();
    expect(applyNamespacePreset(t, "ubl21").root).toEqual(t.root);
  });

  it("carries every other template member through unchanged", () => {
    const t: OutputNodeTemplate = { ...xmlTree(), csvDialect: { lineEnding: "\r\n" }, envelope: { cxml: { fromDomain: "d" } } };
    const next = applyNamespacePreset(t, "ubl21");
    expect(next.csvDialect).toEqual({ lineEnding: "\r\n" });
    expect(next.envelope).toEqual({ cxml: { fromDomain: "d" } });
    expect(next.format).toBe("xml");
  });
});

describe("detectNamespacePreset", () => {
  it("an absent or empty map is None", () => {
    expect(detectNamespacePreset(xmlTree())).toBe("none");
    expect(detectNamespacePreset({ ...xmlTree(), namespaces: {} })).toBe("none");
    expect(detectNamespacePreset({ ...xmlTree(), namespaces: null })).toBe("none");
  });

  it("exactly the two UBL pairs is UBL 2.1", () => {
    expect(detectNamespacePreset(applyNamespacePreset(xmlTree(), "ubl21"))).toBe("ubl21");
  });

  it("the UBL pairs PLUS an extra prefix is Custom, not UBL", () => {
    const t = applyNamespacePreset(xmlTree(), "ubl21");
    expect(detectNamespacePreset({ ...t, namespaces: { ...t.namespaces, extra: "urn:x" } })).toBe("custom");
  });

  it("only one of the two UBL pairs is Custom", () => {
    expect(detectNamespacePreset({ ...xmlTree(), namespaces: { cbc: UBL_CBC_URI } })).toBe("custom");
  });

  it("the right prefixes pointing at the wrong URIs is Custom", () => {
    expect(detectNamespacePreset({ ...xmlTree(), namespaces: { cbc: "urn:wrong", cac: UBL_CAC_URI } })).toBe("custom");
  });

  it.each<NamespacePresetId>(["none", "ubl21"])("apply → detect round-trips for %s", (id) => {
    expect(detectNamespacePreset(applyNamespacePreset(xmlTree(), id))).toBe(id);
  });
});

// ── Mode collision ───────────────────────────────────────────────────────────
// The emitter enforces two MUTUALLY EXCLUSIVE namespace modes and throws when both are set. Today
// the UI shows a warning telling the user to "clear the per-element namespaces" and gives them no
// control that does it. These two functions are that control.

function mixedTree(): OutputNodeTemplate {
  return {
    format: "xml",
    namespaces: { cbc: UBL_CBC_URI },
    root: { name: "Order", nodeType: "object", namespace: UBL_CAC_URI, prefix: "cac", children: [
      { name: "ID", nodeType: "field", namespace: UBL_CBC_URI, prefix: "cbc",
        rule: { outputPath: "ID", canonicalField: "PoNumber", fixedValue: null, fieldManipulators: [] } },
      { name: "Note", nodeType: "field", namespace: UBL_CBC_URI, prefix: "cbc",
        rule: { outputPath: "Note", canonicalField: null, fixedValue: "hi", fieldManipulators: [] } },
    ] },
  };
}

describe("hoistPerNodeNamespaces — 'Move them to the top'", () => {
  it("collects the distinct prefix→URI pairs onto the root map", () => {
    const next = hoistPerNodeNamespaces(mixedTree());
    expect(next.namespaces).toEqual({ cbc: UBL_CBC_URI, cac: UBL_CAC_URI });
  });

  it("clears every per-node pair, so the emitter's exclusivity invariant holds", () => {
    const next = hoistPerNodeNamespaces(mixedTree());
    expect(treeHasPerNodeNamespaces(next.root)).toBe(false);
    expect(templateHasRootNamespaces(next)).toBe(true);
  });

  it("leaves node names, rules and children intact", () => {
    const next = hoistPerNodeNamespaces(mixedTree());
    expect(next.root.children!.map((c) => c.name)).toEqual(["ID", "Note"]);
    expect(next.root.children![1].rule!.fixedValue).toBe("hi");
  });

  // A default namespace has no prefix, so there is no map key to hoist it to. Silently dropping it
  // would change the document; keeping it on the node would leave both modes set and re-throw.
  it("a DEFAULT (prefixless) namespace is not hoisted and is reported as left behind", () => {
    const t: OutputNodeTemplate = {
      format: "xml",
      root: { name: "Order", nodeType: "object", namespace: "urn:default", prefix: null, children: [] },
    };
    const next = hoistPerNodeNamespaces(t);
    expect(next.root.namespace).toBe("urn:default");
    expect(next.namespaces ?? null).toBeNull();
  });

  it("a tree with no per-node namespaces is returned unchanged", () => {
    const t = applyNamespacePreset(xmlTree(), "ubl21");
    expect(hoistPerNodeNamespaces(t)).toEqual(t);
  });
});

describe("clearRootNamespaces — 'Keep them on each element'", () => {
  it("drops the root map and leaves the per-node pairs alone", () => {
    const next = clearRootNamespaces(mixedTree());
    expect(next.namespaces).toBeNull();
    expect(next.root.prefix).toBe("cac");
    expect(next.root.children![0].prefix).toBe("cbc");
    expect(templateHasRootNamespaces(next)).toBe(false);
    expect(treeHasPerNodeNamespaces(next.root)).toBe(true);
  });
});
