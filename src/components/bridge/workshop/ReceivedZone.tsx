"use client";

// ReceivedZone — the lossless LEFT zone of the Order Workshop (spec §"Locked
// decisions" #2). EVERY received field (not just the 12 canonical leaves),
// grouped Header / Parties / Line items / Raw extras, each with its value +
// source pointer (cell B2 / cbc:ID) + a drag handle. Collapse rail.
//
// It reuses the shipped incomingPaneModel grouping verbatim (buildIncomingGroups)
// so the "lossless, no dedup-drop" invariant is the SAME logic the mapper's left
// pane uses — this zone is the workshop's framing of it, not a new pipeline.
// Props-in only: the orchestrator passes the lossless `fields` (the P0
// source-tokens endpoint) — no fetching here.

import { useMemo, useState } from "react";
import {
  buildIncomingGroups,
  INCOMING_GROUP_META,
  hasIncomingData,
  incomingAnchorId,
  type SourceGroup,
} from "../mapper/incomingPaneModel";
import type { SourceField } from "../mapper/types";

export interface ReceivedZoneProps {
  /** The lossless received fields (from the P0 source-tokens endpoint). */
  fields: SourceField[];
  /** True while the parent zone is collapsed to a rail (chevron + vertical label). */
  collapsed?: boolean;
  /** Expand the rail back to the full zone. */
  onExpand?: () => void;
  /** Collapse the zone to a rail. */
  onCollapse?: () => void;
  /**
   * Format a field's stable id into a friendly source pointer for display
   * (e.g. "cell:r2c3" → "Cell B2"). Defaults to the raw id.
   */
  formatPointer?: (field: SourceField) => string;
  readOnly?: boolean;
}

const GROUP_ORDER: SourceGroup[] = ["header", "parties", "line", "raw"];

export function ReceivedZone({
  fields,
  collapsed,
  onExpand,
  onCollapse,
  formatPointer,
  readOnly,
}: ReceivedZoneProps) {
  // Group the FULL lossless set (no query/filter at this zone — the workshop
  // shows everything received; search lives in the mapper's incoming pane).
  const groups = useMemo(() => buildIncomingGroups(fields, "", "all"), [fields]);
  const pointerOf = formatPointer ?? ((f: SourceField) => f.id);

  // ── Collapsed rail ──
  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="received-zone-rail"
        onClick={onExpand}
        aria-label="Expand received fields"
        style={{
          height: "100%",
          minHeight: 200,
          width: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "10px 0",
          borderRadius: 10,
          border: "1px solid #E2E6EE",
          borderLeft: "3px solid #1E66C9",
          background: "#FFFFFF",
          cursor: "pointer",
        }}
      >
        <span aria-hidden style={{ fontSize: 11, color: "#1E66C9" }}>›</span>
        <span
          style={{
            writingMode: "vertical-rl",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#345470",
          }}
        >
          Received
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="received-zone"
      style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", borderLeft: "3px solid #1E66C9", overflow: "hidden" }}
    >
      {/* Header — title + count + collapse chevron */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0B1A2F" }}>
          Received
        </span>
        <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
          {fields.length} {fields.length === 1 ? "field" : "fields"}
        </span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse received fields"
            title="Collapse this zone"
            style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A", fontSize: 12, cursor: "pointer" }}
          >
            ‹
          </button>
        )}
      </div>

      {!hasIncomingData(fields) ? (
        // Honest empty — ONLY when the order truly has no source fields.
        <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          No received fields captured for this order. A parsed order always has source fields; an
          empty list means the source couldn&rsquo;t be tokenized.
        </div>
      ) : (
        <div>
          {GROUP_ORDER.filter((g) => groups.some((grp) => grp.group === g)).map((g) => {
            const grp = groups.find((grp) => grp.group === g)!;
            return (
              <ReceivedGroup
                key={g}
                group={g}
                fields={grp.fields}
                pointerOf={pointerOf}
                readOnly={readOnly}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReceivedGroup({
  group,
  fields,
  pointerOf,
  readOnly,
}: {
  group: SourceGroup;
  fields: SourceField[];
  pointerOf: (f: SourceField) => string;
  readOnly?: boolean;
}) {
  const meta = INCOMING_GROUP_META[group];
  const [open, setOpen] = useState(!meta.defaultCollapsed);
  return (
    <div data-testid={`received-group-${group}`} style={{ borderTop: "1px solid #F2F4F8" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: 7,
          padding: "7px 12px",
          border: "none",
          background: "#FAFBFC",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span aria-hidden style={{ fontSize: 9, color: "#56627A", transform: open ? "none" : "rotate(-90deg)", transition: "transform 150ms" }}>▾</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#345470" }}>
          {meta.label}
        </span>
        <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>{fields.length}</span>
      </button>
      {open && (
        <ul role="list" aria-label={meta.label} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {fields.map((f) => (
            <li
              key={f.id}
              role="listitem"
              data-testid="received-row"
              data-anchor-id={incomingAnchorId(f)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderTop: "1px solid #F5F6F9" }}
            >
              <span
                aria-hidden
                data-testid="received-drag-handle"
                title="Drag to map this field to the output"
                style={{ flexShrink: 0, cursor: readOnly ? "default" : "grab", color: "#A8B0BF", fontSize: 12, lineHeight: 1 }}
              >
                ⠿
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.label}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "#345470", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {f.value || <span style={{ color: "#A8B0BF" }}>—</span>}
                  </span>
                </div>
              </div>
              <span
                data-testid="source-pointer"
                title="Where this value came from in the source file"
                style={{ flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#1E66C9", background: "#E3EDFB", borderRadius: 4, padding: "1px 6px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {pointerOf(f)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
