# Remount OutputMappingEditor (template mode + expression tester) — design

Date: 2026-07-10 · Status: approved (autonomous session; decision delegated in task prompt)

## Problem

`src/components/bridge/OutputMappingEditor.tsx` — the power-user "Edit output mapping"
panel — has had **no mount point** since c424755 (2026-06-25) deleted its only host,
the dead `review/OutputPreview.tsx`. Commit d729a39 (2026-07-09) then shipped the new
ExpressionTester + FormulaHelp into this unmounted component: unreachable dead UI.

Consequence beyond the tester: the panel is the **only authoring UI for whole-document
Scriban template mode** (`outputTemplate` / `outputTemplateContentType`). The backend,
`api-client` PUT, and the connection UI ("Custom template" badge in ConnectionDetail /
HistoryDrawer) all support saved templates — but no screen lets a user create or edit one.

## Options considered

**(a) Remount from the Order Workshop (chosen).**
- Restores the Scriban escape hatch (founder rule: keep it, not as the default).
- Component is battle-hardened: sourceMap/outputTree carry-through (founder-reported
  data-loss class), portal-to-body, "designed structure governs output" banner,
  seed-after-settle guard.
- Mount cost ≈ 30 lines; entry surfaces via the Command Palette (the designated channel
  for power features) + one toolbar button beside the existing "Customize output layout".

**(b) Move FormulaHelp + ExpressionTester into OutputStructureDesigner / mapper, delete orphan.**
- Rejected. The designer's only Scriban surface is `includeWhen` — bare predicates
  (`Qty > 0`), not `{{ … }}` templates; the tester's semantics (whole-template render via
  `buildExpressionTestDraft`) don't fit. The mapper has manipulator chains, no Scriban.
- Deleting the panel removes whole-doc template authoring entirely — an offer⇔works
  regression in reverse (capability exists, UI gone), and `buildOverrideDraft` must stay
  anyway (canonical assembler used by `useMapperModel`).

## Design

1. **`OutputMappingEditor`** gains optional `initialTemplateMode?: boolean`. Seed logic
   ORs it with the saved-template presence: entry points labelled "template" land the
   user in the template editor even when no template is saved yet. The mode toggle still
   lets them switch to the field-by-field view.
2. **`mapperCommands.ts`**: new `MapperCommandKind` `"edit-output-template"` + palette
   command `a16` "Edit output as a template". Dispatches on the existing `plk:mapper`
   window bus; harmless no-op when no order mapper is mounted (same as a13–a15).
3. **`MapperWorkbench`** (order variant, `scopeId` present):
   - listens for the new bus kind → `setShowOutputEditor(true)`;
   - toolbar `ToolbarButton` "Edit as template" beside "Customize output layout";
   - mounts `<OutputMappingEditor orderId={scopeId} open initialTemplateMode …/>`
     next to the existing `OutputStructureDesigner` mount. Exactly one MapperWorkbench
     mounts on the workshop (invariant-tested), so no double-portal from the bus.
   - Workshop 3-column layout untouched (locked): the editor is a portal slideover.
4. **Tests**: `mapperCommands.test.ts` extended (ids a13..a16, new kind); e2e guard test
   in `tests/e2e/new-surfaces.spec.ts` un-fixme'd — real flow: `/inbox/ord-002` →
   "Edit as template" → "Formula help" disclosure → "Try an expression" + input visible →
   Cancel closes cleanly. Mock mode: `getMappingOverride` resolves `null` (~120 ms) so the
   editor seeds empty and opens in template mode.

## Out of scope

Deleting the field-by-field half of the panel (duplicates mapper wires but is the
keyboard-explicit alternative and self-warns when a designed tree governs output);
any connection-level template editing surface.
