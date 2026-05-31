"use client";
import * as React from "react";

/**
 * <CanonicalSpine> + <SpineNode>
 *
 * The vertical schema spine that anchors the order review.
 * Children must be <SpineNode>. The container draws the 3px canonical-order
 * line down the column; each node renders a circle on the line + a card to the right.
 */

type SpineProps = {
  children: React.ReactNode;
  className?: string;
};

export function CanonicalSpine({ children, className }: SpineProps) {
  return (
    <div className={["relative py-2", className].filter(Boolean).join(" ")}>
      {/* The canonical-order line itself */}
      <div
        aria-hidden
        className="absolute top-0 bottom-0 w-spine rounded-sm"
        style={{ left: 22, background: "linear-gradient(180deg,#1DAF50,#28C55E)" }}
      />
      {children}
    </div>
  );
}

/* ----- SpineNode ----- */

type SubNode = {
  sku: string;
  qty: number;
  /** Mark as AI-mapped */
  ai?: boolean;
  /** AI confidence */
  pct?: number;
  /** Mark as error */
  err?: boolean;
  /** Optional inline note */
  hint?: string;
};

type SpineNodeProps = {
  /** Position of the node in the column (kept for layout/ordering callers). */
  index: number;
  /** Total nodes in the column (kept for API compatibility). */
  total?: number;
  label: string;
  value: React.ReactNode;
  confidence: number;       // 0..100
  mono?: boolean;
  big?: boolean;
  tone?: "buyer" | "supplier";
  hint?: string;
  srcRef: string;
  outRef: string;
  subnodes?: SubNode[];
  onJump?: () => void;
};

export function SpineNode(props: SpineNodeProps) {
  const {
    label, value, confidence, mono, big, tone, hint, srcRef, outRef, subnodes, onJump,
  } = props;
  const isWarn = confidence < 90;
  const isErr  = confidence < 75;

  const conf =
    confidence >= 90 ? { bg: "#DCFCE7", fg: "#1DAF50" } :
    confidence >= 75 ? { bg: "#FAEFD6", fg: "#C97A14" } :
                       { bg: "#FBE3E3", fg: "#C53A3A" };

  const bg =
    isErr  ? "bg-danger-soft" :
    isWarn ? "bg-amber-soft" : "bg-surface";

  const border =
    isErr  ? "border-[#F0D2D2]" :
    isWarn ? "border-[#F0E0BD]" : "border-border";

  return (
    <div className="relative mb-2.5 pl-9">
      {/* Node dot on the canonical-order line */}
      <div
        aria-hidden
        className="absolute top-3.5 w-[13px] h-[13px] rounded-full bg-white border-[2.5px] z-base"
        style={{ left: 17, borderColor: "#28C55E" }}
      />

      {/* Connector stubs */}
      <svg width="14" height="34" viewBox="0 0 14 34" aria-hidden className="absolute" style={{ left: -14, top: 8 }}>
        <path d="M 0 17 Q 7 17 14 17" stroke="#1DAF50" strokeWidth="1" strokeDasharray="2 2" fill="none"/>
      </svg>
      <svg width="14" height="34" viewBox="0 0 14 34" aria-hidden className="absolute" style={{ right: -14, top: 8 }}>
        <path d="M 0 17 Q 7 17 14 17" stroke="#28C55E" strokeWidth="1" strokeDasharray="2 2" fill="none"/>
      </svg>

      <div
        className={["border rounded-md p-2.5", bg, border].join(" ")}
        onClick={onJump}
        role={onJump ? "button" : undefined}
        tabIndex={onJump ? 0 : undefined}
      >
        {/* Header row */}
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.05em] font-semibold text-ink-faint mb-1">
          {tone === "buyer"    && <span className="w-[5px] h-[5px] rounded-sm" style={{ background: "#28C55E" }}/>}
          {tone === "supplier" && <span className="w-[5px] h-[5px] rounded-sm" style={{ background: "#28C55E" }}/>}
          <span>{label}</span>
          <span className="ml-auto font-mono text-[9.5px] font-bold px-1 py-px rounded-sm" style={{ background: conf.bg, color: conf.fg }}>
            {confidence}%
          </span>
        </div>

        {/* Value */}
        <div
          className={[
            big ? "text-[16px] font-semibold" : "text-[12.5px] font-medium",
            mono ? "font-mono" : "",
          ].filter(Boolean).join(" ")}
          style={big ? { letterSpacing: "-0.01em" } : {}}
        >
          {value}
        </div>

        {hint && <div className="text-[10.5px] text-amber mt-1">⚠ {hint}</div>}

        {/* Subnodes — line rows; AI-suggested rows carry the violet accent */}
        {subnodes && subnodes.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-dashed border-border flex flex-col gap-1">
            {subnodes.map((sn, i) => (
              <div
                key={i}
                className={[
                  "flex items-center gap-2 text-[10.5px] px-1.5 py-1 rounded-[5px]",
                  sn.err ? "bg-danger-soft" :
                  sn.ai  ? "bg-ai-soft"     : "bg-transparent",
                ].join(" ")}
                style={
                  sn.ai ? { borderLeft: "3px solid #6F4FCE" } :
                  sn.err ? { borderLeft: "3px solid #C53A3A" } : undefined
                }
              >
                {sn.ai && <span className="text-[8.5px] font-extrabold tracking-[0.04em]" style={{ color: "#5E3DB0" }}>AI</span>}
                <span
                  className={[
                    "font-mono font-semibold flex-1",
                    sn.err ? "text-danger" :
                    sn.ai  ? "text-ai"     : "",
                  ].join(" ")}
                  style={!sn.err && !sn.ai ? { color: "#1DAF50" } : undefined}
                >
                  {sn.sku}
                </span>
                <span
                  className={[
                    "font-mono",
                    sn.err ? "text-danger font-bold" : "text-ink-muted",
                  ].join(" ")}
                >
                  ×{sn.qty}
                </span>
                {sn.pct && <span className="text-[9px] font-bold text-ai">{sn.pct}%</span>}
              </div>
            ))}
          </div>
        )}

        {/* Footer: source → output mapping refs (inside the card) */}
        <div className="mt-2 pt-1.5 border-t border-dashed border-border flex items-center gap-1.5 text-[9.5px] font-mono font-semibold leading-tight">
          <span title={srcRef} className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[45%]" style={{ color: "#1DAF50" }}>
            ← {srcRef}
          </span>
          <span className="text-ink-faint shrink-0">→</span>
          <span title={outRef} className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-right" style={{ color: "#1DAF50" }}>
            {outRef}
          </span>
        </div>
      </div>
    </div>
  );
}
