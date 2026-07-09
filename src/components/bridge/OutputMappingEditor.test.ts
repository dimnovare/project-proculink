// buildOverrideDraft unit tests — G8 bug A (data loss). The OutputMappingEditor's
// save payload is built by this PURE function; the backend PUT replaces the WHOLE
// mappingOverride document, so the draft MUST carry the existing drag-wired
// sourceMap through or every source→canonical wire is silently destroyed.

import { describe, it, expect } from "vitest";
import { buildOverrideDraft, buildExpressionTestDraft } from "./OutputMappingEditor";
import type { OutputFieldRule, OutputNodeTemplate, SourceFieldRule } from "@/lib/api/types";

const baseOpts = {
  customFields: [],
  header: {} as Record<string, OutputFieldRule>,
  lines: {} as Record<string, OutputFieldRule>,
  templateMode: false,
  template: "",
  templateContentType: "application/json",
};

const wiredSourceMap: Record<string, SourceFieldRule> = {
  PoNumber: { sourceToken: "cell:r1c3", fixedValue: null, manipulators: [] },
  Quantity: { sourceToken: "cell:r2c5", fixedValue: null, manipulators: [{ type: "Trim", params: [] }] },
};

describe("buildOverrideDraft — sourceMap preservation (G8 bug A)", () => {
  it("carries the existing sourceMap through UNCHANGED", () => {
    const draft = buildOverrideDraft({ ...baseOpts, existingSourceMap: wiredSourceMap });
    expect(draft.sourceMap).toEqual(wiredSourceMap);
  });

  it("preserves sourceMap even when output rules and custom fields are edited", () => {
    const draft = buildOverrideDraft({
      ...baseOpts,
      customFields: [{ key: "contract_no", label: "Contract no.", scope: "header", value: "C-1" }],
      header: { po: { outputPath: "po", canonicalField: "PoNumber", fieldManipulators: [] } },
      existingSourceMap: wiredSourceMap,
    });
    expect(draft.sourceMap).toEqual(wiredSourceMap);
    expect(draft.output?.header.po.canonicalField).toBe("PoNumber");
    expect(draft.customFields).toHaveLength(1);
  });

  it("sends an explicit null (not undefined) when there are no existing wires", () => {
    expect(buildOverrideDraft({ ...baseOpts }).sourceMap).toBeNull();
    expect(buildOverrideDraft({ ...baseOpts, existingSourceMap: null }).sourceMap).toBeNull();
  });
});

describe("buildOverrideDraft — template-mode precedence (unchanged behaviour)", () => {
  it("sends the template only when template mode is ON and non-blank", () => {
    const on = buildOverrideDraft({
      ...baseOpts, templateMode: true, template: '{ "po": "{{ OrderNr }}" }',
      existingSourceMap: wiredSourceMap,
    });
    expect(on.outputTemplate).toBe('{ "po": "{{ OrderNr }}" }');
    expect(on.outputTemplateContentType).toBe("application/json");
    expect(on.sourceMap).toEqual(wiredSourceMap); // wires survive template mode too

    const blank = buildOverrideDraft({ ...baseOpts, templateMode: true, template: "   " });
    expect(blank.outputTemplate).toBeNull();
    expect(blank.outputTemplateContentType).toBeNull();
  });

  it("clears the template when the toggle is off even if text remains", () => {
    const off = buildOverrideDraft({ ...baseOpts, templateMode: false, template: "leftover" });
    expect(off.outputTemplate).toBeNull();
    expect(off.outputTemplateContentType).toBeNull();
  });
});

describe("buildExpressionTestDraft — the 'try an expression' preview draft", () => {
  const tree: OutputNodeTemplate = { format: "xml", root: { name: "Order", nodeType: "object" } };

  it("swaps in the expression as a text/plain whole-document template", () => {
    const base = buildOverrideDraft({ ...baseOpts, templateMode: true, template: '{ "po": "{{ OrderNr }}" }' });
    const test = buildExpressionTestDraft(base, "{{ BuyerName | string.upcase }}");
    expect(test.outputTemplate).toBe("{{ BuyerName | string.upcase }}");
    expect(test.outputTemplateContentType).toBe("text/plain");
    // The user's draft template itself is untouched.
    expect(base.outputTemplate).toBe('{ "po": "{{ OrderNr }}" }');
  });

  it("NULLS outputTree — a designed structure renders at highest precedence and would hijack the test", () => {
    const base = buildOverrideDraft({ ...baseOpts, existingOutputTree: tree });
    expect(base.outputTree).toEqual(tree); // sanity: the save draft keeps the tree
    const test = buildExpressionTestDraft(base, "{{ OrderNr }}");
    expect(test.outputTree).toBeNull();
  });

  it("carries custom fields and sourceMap through so the expression sees the same model a saved template would", () => {
    const base = buildOverrideDraft({
      ...baseOpts,
      customFields: [{ key: "contract_no", label: "Contract no.", scope: "header", value: "C-1" }],
      existingSourceMap: wiredSourceMap,
    });
    const test = buildExpressionTestDraft(base, "{{ contract_no }}");
    expect(test.customFields).toEqual(base.customFields);
    expect(test.sourceMap).toEqual(wiredSourceMap);
  });
});
