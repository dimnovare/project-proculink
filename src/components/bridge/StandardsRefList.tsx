"use client";

// StandardsRefList — the canonical "this field maps to UBL / EDIFACT / X12 / cXML"
// disclosure. Satisfies the project's standards-visibility rule (a field in a
// mapping/validation context must be able to surface its standards mapping on
// demand). Used by the supplier rule-bindings panel. Renders nothing when no
// refs are present (count 0 is a clean no-op).

import * as React from "react";

export type StandardsRefs = {
  ublRef?: string | null;
  edifactRef?: string | null;
  x12Ref?: string | null;
  cxmlRef?: string | null;
};

const COLUMNS: ReadonlyArray<{ key: keyof StandardsRefs; label: string }> = [
  { key: "cxmlRef", label: "cXML 1.2" },
  { key: "ublRef", label: "UBL 2.1" },
  { key: "edifactRef", label: "EDIFACT" },
  { key: "x12Ref", label: "X12" },
];

export function hasStandardsRefs(refs: StandardsRefs): boolean {
  return COLUMNS.some(({ key }) => {
    const v = refs[key];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/** Inline grid of standard → reference rows. Renders nothing if no refs are set. */
export function StandardsRefList({ refs, className }: { refs: StandardsRefs; className?: string }) {
  const present = COLUMNS.filter(({ key }) => {
    const v = refs[key];
    return typeof v === "string" && v.trim().length > 0;
  });
  if (present.length === 0) return null;

  return (
    <dl
      className={["grid gap-x-4 gap-y-1.5", className].filter(Boolean).join(" ")}
      style={{ gridTemplateColumns: "auto 1fr" }}
    >
      {present.map(({ key, label }) => (
        <React.Fragment key={key}>
          <dt
            className="text-[10.5px] font-semibold uppercase tracking-[0.05em]"
            style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}
          >
            {label}
          </dt>
          <dd
            className="font-mono text-[11.5px]"
            style={{ color: "var(--ink)", margin: 0, wordBreak: "break-word" }}
          >
            {refs[key]}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export default StandardsRefList;
