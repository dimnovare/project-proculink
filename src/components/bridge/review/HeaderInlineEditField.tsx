"use client";

// HeaderInlineEditField — the inline <input> used to edit a header field
// (PO number / date / buyer / supplier name / currency) in place. Extracted
// as-is from SpineNodeCard (batch 9 Phase A). The Tab-chain (commit + advance
// to the next editable field) lives in useResolveActions.handleEditKeyDown —
// this component only renders the control.

import type { KeyboardEvent } from "react";

export function HeaderInlineEditField({ id, value, mono, big, inputRef, onChange, onCommit, onKeyDown }: {
  id: string;
  value: string;
  mono?: boolean;
  big?: boolean;
  inputRef: (el: HTMLInputElement | null, id: string) => void;
  onChange: (id: string, val: string) => void;
  onCommit: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, id: string) => void;
}) {
  return (
    <input
      ref={(el) => inputRef(el, id)}
      value={value}
      onChange={(e) => onChange(id, e.target.value)}
      onBlur={() => onCommit(id)}
      onKeyDown={(e) => onKeyDown(e, id)}
      style={{
        width: "100%",
        border: "1px solid #2E8E3A",
        borderRadius: 4,
        padding: "3px 6px",
        fontSize: big ? 16 : 12.5,
        fontWeight: big ? 600 : 500,
        fontFamily: mono ? "'JetBrains Mono',monospace" : "inherit",
        background: "#F0FDF4",
        color: "#0B1A2F",
      }}
    />
  );
}
