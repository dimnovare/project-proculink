"use client";

// WorkshopStatusBar — ONE consolidated status row under the workshop header
// (order-chrome compression, founder-approved mock 2026-07-17). It replaces BOTH
// of the previous full-width rows:
//   • the red SendReadinessStrip (blockers + chips + resolve-all + stepper), and
//   • the MapperWorkbench "MAP THIS ORDER" toolbar (mapped count + save state +
//     layout / template / catalog / connections tools) — re-hosted here via
//     MapperToolbarState. The handlers are the workbench's own, relocated not
//     reimplemented (MapperWorkbench.tsx onToolbarState).
//
// Layout: [ red blockers segment — only as wide as its content, absent at zero
// blockers ][ white segment: mapped chip · save state · stepper · ⋯ overflow ].

import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MapperToolbarState } from "../mapper/MapperWorkbench";

export interface BlockerChip {
  /** Stable id (the issue code) — passed to onJump to focus + open that card. */
  id: string;
  /** Short human label shown on the chip. */
  name: string;
}

/**
 * Collapse identical issue titles into one chip carrying a count ("Needs a
 * supplier code ×2"). The chip keeps the FIRST occurrence's id so a click still
 * jumps to a real card. Order of first appearance is preserved.
 */
export function dedupeBlockerChips(
  blockers: BlockerChip[],
): { id: string; name: string; count: number }[] {
  const byName = new Map<string, { id: string; name: string; count: number }>();
  for (const b of blockers) {
    const hit = byName.get(b.name);
    if (hit) hit.count += 1;
    else byName.set(b.name, { id: b.id, name: b.name, count: 1 });
  }
  return [...byName.values()];
}

function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M6 1.2l1.1 3.2 3.2 1.1-3.2 1.1L6 9.8 4.9 6.6 1.7 5.5l3.2-1.1z" fill="#FFFFFF" />
    </svg>
  );
}

export function WorkshopStatusBar({
  blockers,
  notes = 0,
  onJump,
  onReviewIssues,
  onResolveAll,
  resolveAllCount = 0,
  resolving = false,
  mapper,
  pipeline,
  onSaveMappings,
  savingMappings = false,
  saveMappingsDisabledReason = null,
  saveMappingsLabel = "Save mappings",
  saveMappingsTitle,
  notice,
  noticeSeverity = "info",
}: {
  blockers: BlockerChip[];
  /** Warning-level (non-blocking) issue count — shown as a quiet optional note. */
  notes?: number;
  /** Jump to + flash a blocker's issue card. */
  onJump: (id: string) => void;
  /** Bring the issue list back into view (lives in the ⋯ overflow). */
  onReviewIssues?: () => void;
  /** Bulk-accept every AI suggestion (the "Resolve suggested (n)" button). */
  onResolveAll?: () => void;
  /** How many issues the bulk resolve would clear → its count; hidden when 0. */
  resolveAllCount?: number;
  /** True while a bulk resolve is in flight → disables the button. */
  resolving?: boolean;
  /** Live toolbar state re-hosted from MapperWorkbench (null until it registers). */
  mapper: MapperToolbarState | null;
  /** The pipeline stepper — rendered at the white segment's right end (xl+). */
  pipeline?: ReactNode;
  /**
   * WP-13 — save this order's field mapping onto the counterparty, so their next
   * order starts already mapped. Absent → no control renders at all, which is what
   * keeps every other host of this bar unchanged.
   *
   * The mapper has its own "Save mappings" button, but it lives inside the
   * `!hideToolbar` block and the workshop passes `hideToolbar` — so in the
   * workshop this bar is the only place the control can appear.
   */
  onSaveMappings?: () => void;
  /** True while that request is in flight → the control shows progress and locks. */
  savingMappings?: boolean;
  /**
   * Non-null disables the control and becomes its tooltip. A plain sentence, not a
   * code: the operator must be able to read why it is off without guessing.
   */
  saveMappingsDisabledReason?: string | null;
  /**
   * The control's label. The host builds it from the direction labels, because the
   * counterparty is a customer in the inbound direction — and because the mapper's
   * own autosave indicator ("Saving… / ✓ Saved") sits a few pixels to the LEFT on
   * this same bar. A bare "Save mappings" beside a "✓ Saved" reads as "save my edits
   * to this order"; naming the party is what tells the two apart.
   */
  saveMappingsLabel?: string;
  /** Tooltip for the enabled state. Also host-built, for the same noun reason. */
  saveMappingsTitle?: string;
  /**
   * The send-flow notice ("Preparing the file…" / "Sent to …" / an error). It
   * used to be its OWN full-width band between the header and this bar; WP-28
   * folds it in here, because this row is already "the ONE consolidated status
   * row" and a transient status line does not deserve a band of its own above
   * the three columns. Absent → nothing renders.
   */
  notice?: string | null;
  noticeSeverity?: "info" | "success" | "error";
}) {
  const chips = useMemo(() => dedupeBlockerChips(blockers), [blockers]);
  const allMapped = mapper != null && mapper.total > 0 && mapper.mapped >= mapper.total;
  const suggestionCount = mapper?.suggestionCount ?? 0;

  const catalogTitle = mapper?.fillFromCatalog
    ? "Jump to the lines with catalog price/code hints — apply each per line"
    : "No catalog hints for this order. Add a supplier catalog, or no lines differ from it.";

  return (
    <div
      data-testid="workshop-status-bar"
      className="flex flex-wrap items-stretch"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E8EE", minHeight: 42 }}
    >
      {/* ── Red segment — only when blockers exist, only as wide as its content ── */}
      {blockers.length > 0 && (
        <div
          data-testid="status-bar-blockers"
          role="status"
          aria-live="polite"
          style={{
            background: "#FDECEA", borderRight: "1px solid #F5C6BF",
            display: "flex", alignItems: "center", flexWrap: "wrap",
            gap: 9, padding: "4px 16px", minWidth: 0,
          }}
        >
          <span
            title="These required fields are missing or invalid. Use the chips to jump to each issue."
            style={{ color: "#B3362A", fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap" }}
          >
            <span aria-hidden>⚠ </span>
            {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
          </span>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onJump(c.id)}
              title={`Jump to ${c.name}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px 2px 7px",
                borderRadius: 999, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 600,
                color: "#B3362A", background: "#FFFFFF", border: "1px solid #F0CFCA", cursor: "pointer", maxWidth: 220,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#FBEAEA"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; }}
            >
              <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "#B3362A", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.count > 1 ? `${c.name} ×${c.count}` : c.name}
              </span>
            </button>
          ))}
          {onResolveAll && resolveAllCount > 0 && (
            <button
              type="button"
              onClick={onResolveAll}
              disabled={resolving}
              style={{
                height: 27, padding: "0 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700,
                border: "1px solid #0B1A2F", background: "#0B1A2F", color: "#FFFFFF",
                cursor: resolving ? "wait" : "pointer", opacity: resolving ? 0.6 : 1,
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              <SparkleGlyph />
              {resolving ? "Resolving…" : `Resolve suggested (${resolveAllCount})`}
            </button>
          )}
        </div>
      )}

      {/* ── The send-flow notice, re-hosted from its own band (WP-28) ────────── */}
      {notice && (
        <div
          data-testid="status-bar-notice"
          role="status"
          aria-live="polite"
          style={{
            display: "flex", alignItems: "center", padding: "4px 16px", minWidth: 0,
            fontSize: 12.5, fontWeight: 600,
            borderRight: "1px solid #E5E8EE",
            background: noticeSeverity === "error" ? "#FBE3E3" : noticeSeverity === "success" ? "#E9F1EA" : "#EFF4FB",
            color: noticeSeverity === "error" ? "#B43838" : noticeSeverity === "success" ? "#1E6D29" : "#0F4FAB",
          }}
        >
          {notice}
        </div>
      )}

      {/* ── White segment — issue summary · mapped count · save state · stepper · overflow ── */}
      {/* `flexWrap: wrap` is load-bearing, not cosmetic. Every child here is
          `whiteSpace: nowrap` (a chip or a button reads badly broken mid-word), so
          without wrapping the row can only grow past the viewport. WP-13's
          "Save mappings for this <party>" pushed it 90px over at 1280 — caught by
          the `zero overflow at 1280 wide viewport` e2e, which is exactly what that
          test is for. WP-28 then added an issue-summary chip to the same row, so
          there is now MORE competing for the width, not less. Wrapping trades a
          taller bar for a page that never scrolls sideways. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "4px 16px", flex: 1, minWidth: 0 }}>
        {/* The issue COUNT, always readable without a click. The issue LIST is an
            always-rendered region of the third column now, but useWorkshopLayout
            can rail that whole column (Focus = Mapping) and persists the choice —
            so the count also lives here, where nothing can collapse it. At
            blockers > 0 the red segment above already carries the count, so this
            chip stands down rather than saying it twice. */}
        {blockers.length === 0 && (
          <span
            data-testid="status-bar-issue-summary"
            title={notes > 0
              ? "Nothing is blocking this order. These are worth a look before you send."
              : "Every required field is filled and every rule passed."}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
              borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0,
              // #8A5310 on #FAF1DD = 5.62:1; #1E6D29 on #E9F1EA = 5.57:1. Both AA.
              // NOT #B36D14, which is 3.65:1 on its own soft background.
              color: notes > 0 ? "#8A5310" : "#1E6D29",
              background: notes > 0 ? "#FAF1DD" : "#E9F1EA",
              border: `1px solid ${notes > 0 ? "#F1E2BE" : "#CDE7D1"}`,
            }}
          >
            {notes > 0 ? null : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0 }}>
                <path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {notes > 0 ? `${notes} optional` : "No issues"}
          </span>
        )}
        {mapper != null && mapper.total > 0 && (
          <span
            title="Output fields with a resolved value (mapped, fixed, or auto)"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
              borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap",
              color: allMapped ? "#1E6D29" : "#5E6779",
              background: allMapped ? "#E3F2E4" : "#F3F4F7",
              border: `1px solid ${allMapped ? "#CDE7D1" : "#E5E8EE"}`,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M2.5 6.2 L5 8.6 L9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {mapper.mapped}/{mapper.total} mapped
          </span>
        )}
        {/* Save-state + rare warnings relocated from the old mapper toolbar row. */}
        {mapper?.saving && <span style={{ fontSize: 10.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>Saving…</span>}
        {mapper && !mapper.saving && !mapper.error && mapper.justSaved && (
          <span role="status" style={{ fontSize: 10.5, color: "#1E6D29", whiteSpace: "nowrap" }}>✓ Saved</span>
        )}
        {mapper?.error && <span style={{ fontSize: 10.5, color: "var(--danger,#C0392B)" }}>{mapper.error}</span>}
        {mapper != null && mapper.requiredUnmapped > 0 && (
          <span
            title="A required output field still has no source — map one or set a fixed value"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#9A6B00", background: "#FFF7E6", border: "1px solid #F1E2BE", borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}
          >
            ⚠ {mapper.requiredUnmapped} {mapper.requiredUnmapped === 1 ? "field needs" : "fields need"} a source
          </span>
        )}
        {mapper?.aiUnavailable && (
          <span
            title="AI mapping suggestions are unavailable right now — map fields manually; everything still works."
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5E6779", background: "#F3F4F7", border: "1px solid #E5E8EE", borderRadius: 5, padding: "1px 7px", whiteSpace: "nowrap" }}
          >
            <span aria-hidden style={{ color: "#A8B0BF" }}>✦</span>
            AI suggestions unavailable
          </span>
        )}
        {/* Warnings alongside blockers. On their own they are the summary chip
            above, so this only renders when the red segment owns the count. */}
        {blockers.length > 0 && notes > 0 && (
          <span style={{ fontSize: 11, color: "#5E6779", whiteSpace: "nowrap" }}>
            {notes} optional {notes === 1 ? "note" : "notes"}
          </span>
        )}
        {/* AI field-mapping suggestions, re-hosted from their own violet band
            above the columns (WP-28). The band's guarantee — nothing is applied
            without a visible accept step — moves into the chip's title, and the
            per-wire ✓/✗ accept itself is untouched. Violet is reserved for
            AI-generated content, which this is. */}
        {suggestionCount > 0 && (
          <span
            data-testid="status-bar-ai-suggestions"
            title="Suggested field mappings, drawn as dashed links between the columns. Accept or dismiss each one — nothing is applied automatically."
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
              borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0,
              // #5E3DB0 on #F4EFFC = 7.86:1 — the same pair the retired band used.
              color: "#5E3DB0", background: "#F4EFFC", border: "1px solid #E2D6F6",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0 }}>
              <path d="M6 1.2l1.1 3.2 3.2 1.1-3.2 1.1L6 9.8 4.9 6.6 1.7 5.5l3.2-1.1z" fill="currentColor" />
            </svg>
            {suggestionCount} AI {suggestionCount === 1 ? "suggestion" : "suggestions"}
          </span>
        )}

        <span style={{ marginLeft: "auto" }} aria-hidden />
        {pipeline && <span className="hidden xl:inline-flex">{pipeline}</span>}

        {/* ── Save mappings (WP-13) ─────────────────────────────────────────
            Quiet secondary chip, deliberately NOT the violet the mapper's own
            copy of this button uses: violet is reserved for AI-generated
            content, and promoting a mapping is the operator's own decision. */}
        {onSaveMappings && (
          <button
            type="button"
            data-testid="save-mappings"
            onClick={onSaveMappings}
            disabled={savingMappings || saveMappingsDisabledReason != null}
            title={
              saveMappingsDisabledReason ??
              saveMappingsTitle ??
              "Save these field mappings for next time — the next order starts already mapped"
            }
            style={{
              height: 27, padding: "0 11px", borderRadius: 8, fontSize: 11.5, fontWeight: 700,
              border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F",
              display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0,
              cursor: savingMappings ? "wait" : saveMappingsDisabledReason != null ? "not-allowed" : "pointer",
              opacity: saveMappingsDisabledReason != null ? 0.55 : 1,
            }}
          >
            {savingMappings ? "Saving…" : saveMappingsLabel}
          </button>
        )}

        {/* ── ⋯ overflow — the four relocated mapper tools (+ Review issues). ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More order tools"
              title="More order tools — customize output layout, edit as template, fill from catalog, show or hide connections"
              style={{
                // 44px hit area inside the 42px bar (negative vertical margin keeps
                // the row height); the visible box is the compact 33×27 chip.
                minWidth: 44, minHeight: 44, marginBlock: -2, marginInline: -6, padding: 0,
                border: 0, background: "transparent", color: "#5E6779", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 33, height: 27, border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, lineHeight: 1,
                }}
              >
                ⋯
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" style={{ minWidth: 230 }}>
            {onReviewIssues && blockers.length > 0 && (
              <>
                <DropdownMenuItem onSelect={() => onReviewIssues()}>Review issues</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              disabled={mapper == null}
              onSelect={() => mapper?.openLayoutDesigner()}
              title="Change how the output file is structured for this supplier — paste a supplier sample to start"
            >
              Customize output layout
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={mapper == null}
              onSelect={() => mapper?.openTemplateEditor()}
              title="Write one template that renders this order's whole output document — for outputs the layout designer can't express (advanced)"
            >
              Edit as template
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={mapper?.fillFromCatalog == null}
              onSelect={() => mapper?.fillFromCatalog?.()}
              title={catalogTitle}
            >
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>
                  Fill from catalog
                  {mapper != null && mapper.catalogHintCount > 0 ? ` · ${mapper.catalogHintCount}` : ""}
                </span>
                {mapper != null && mapper.fillFromCatalog == null && (
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>No catalog hints for this order</span>
                )}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={mapper == null} onSelect={() => mapper?.toggleConnections()}>
              {mapper?.showConnections ? "Hide connections" : "Show connections"}
            </DropdownMenuItem>
            {suggestionCount > 0 && mapper?.dismissAllSuggestions && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => mapper.dismissAllSuggestions?.()}
                  title="Clear every AI-suggested field mapping. Nothing was applied — this only stops showing them."
                >
                  Dismiss all AI suggestions
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
