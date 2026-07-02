"use client";

// WorkshopStepper — the pipeline progress stepper for the Order Workshop header
// (v3 "calm workbench" redesign). Five fixed stages of the parse→deliver pipeline,
// shown with plain-language labels (Read · Check · Verify · Prepare · Send); the
// technical stage name (Parse → Normalize → Validate → Transform → Deliver) is kept
// as each step's hover tooltip.
// `stage` is the index of the ACTIVE stage (0–5); everything before it reads "done".
// At stage 5 the whole pipeline is complete (delivered). `failed` flips the active
// stage to the danger tone. Tokens are lifted verbatim from the design handoff.

import { Fragment } from "react";

// Plain-language visible labels with the technical pipeline stage kept as a hover
// tooltip (title). Order is unchanged: Parse → Normalize → Validate → Transform → Deliver.
const STEPS = [
  { label: "Read", title: "Parse — reading your file" },
  { label: "Check", title: "Normalize — checking values" },
  { label: "Verify", title: "Validate — running your rules" },
  { label: "Prepare", title: "Transform — building the supplier's format" },
  { label: "Send", title: "Deliver — delivering to supplier" },
] as const;

function CheckGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function WorkshopStepper({ stage, failed = false }: { stage: number; failed?: boolean }) {
  return (
    <div
      className="hidden xl:flex"
      aria-label="Pipeline progress"
      style={{ flex: 1, alignItems: "center", margin: "0 26px", minWidth: 280 }}
    >
      {STEPS.map((s, i) => {
        const done = i < stage;
        const active = i === stage;
        const isFail = active && failed;
        const fill = done ? "#2E8E3A" : isFail ? "#B43838" : active ? "#1E66C9" : "#FFFFFF";
        const bd = done ? "#2E8E3A" : isFail ? "#B43838" : active ? "#1E66C9" : "#CBD0DA";
        return (
          <Fragment key={s.label}>
            <div title={s.title} style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
              <span
                style={{
                  width: 16, height: 16, borderRadius: "50%", background: fill,
                  border: `1.5px solid ${bd}`, display: "inline-flex", alignItems: "center",
                  justifyContent: "center", boxShadow: active && !failed ? "0 0 0 3px #EAF0F8" : "none",
                }}
              >
                {done ? <CheckGlyph /> : isFail ? <XGlyph /> : (
                  <span style={{ fontSize: 8.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: active ? "#FFFFFF" : "#98A0AE" }}>
                    {i + 1}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, fontWeight: active ? 650 : 500, color: active ? "#0B1A2F" : done ? "#1E6D29" : "#98A0AE", whiteSpace: "nowrap" }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: "0 8px", borderRadius: 2, background: i < stage ? "#2E8E3A" : "#E5E8EE", minWidth: 16 }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
