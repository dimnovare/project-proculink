"use client";
import * as React from "react";
import { confidenceTier } from "@/lib/ds-tokens";

/* =====================================================================
   Primitives — Button, ConfidenceChip, SrcChip, StatusPill,
   AiSuggestion, ProcuLinkMark.
   ===================================================================== */

/* -------- Button -------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai" | "blue" | "green";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded font-medium border whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:   "bg-navy text-white border-transparent hover:bg-navy-surface",
  secondary: "bg-surface text-ink border-border hover:bg-surface-2 hover:border-border-strong",
  ghost:     "bg-transparent text-ink-muted border-transparent hover:bg-surface-2 hover:text-ink",
  danger:    "bg-danger text-white border-transparent hover:opacity-90",
  ai:        "bg-ai text-white border-transparent hover:opacity-90",
  // tokens.css .btn-blue / .btn-green
  blue:      "[background:#1E66C9] text-white border-transparent hover:[background:#0F4FA8]",
  green:     "[background:#2E8E3A] text-white border-transparent hover:[background:#1E6D29]",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  // tokens.css .btn.sm / .btn (default) / .btn.lg
  sm: "h-[27px] px-2.5 text-[12px]",
  md: "h-[32px] px-3   text-[12.5px]",
  lg: "h-[38px] px-4   text-[13.5px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className].filter(Boolean).join(" ")}
      disabled={rest.disabled || loading}
    >
      {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"/>}
      {children}
    </button>
  );
}

/* -------- ConfidenceChip -------- */
export function ConfidenceChip({ value }: { value: number }) {
  const tier = confidenceTier(value);
  const cls =
    tier === "ok"   ? "bg-brand-green-soft text-brand-green-deep" :
    tier === "warn" ? "bg-amber-soft text-amber" :
                      "bg-danger-soft text-danger";
  return (
    <span className={["font-mono text-[10px] font-bold px-1 py-px rounded-sm", cls].join(" ")}>
      {value}%
    </span>
  );
}

/* -------- SrcChip — file-type chip -------- */
// Keep in sync with FileChip.tsx CHIP_COLORS (same canonical palette from tokens.css .src-*)
type SrcType = "PDF" | "XLSX" | "CSV" | "XML" | "cXML" | "EDI" | "EMAIL" | "API" | "JSON" | "UBL";

const SRC_PALETTE: Record<SrcType, { bg: string; fg: string }> = {
  PDF:   { bg: "#FBEEEE", fg: "#B53F3F" },
  XLSX:  { bg: "#E2F1E2", fg: "#1E6D29" },   // brand-green-soft / brand-green-deep
  CSV:   { bg: "#EEF3F8", fg: "#345470" },
  XML:   { bg: "#EEE7FB", fg: "#5E3DB0" },   // ai-soft / #5E3DB0
  cXML:  { bg: "#EEE7FB", fg: "#5E3DB0" },
  EDI:   { bg: "#FAEFD6", fg: "#C97A14" },   // amber-soft / amber
  EMAIL: { bg: "#E9EDF3", fg: "#4A5568" },
  API:   { bg: "#E3F0E3", fg: "#1E6D29" },   // tokens uses #E3F0E3 for API
  JSON:  { bg: "#FFF4D6", fg: "#846100" },
  UBL:   { bg: "#EEF3F8", fg: "#345470" },   // same as CSV per tokens.css .src-UBL
};

export function SrcChip({ type }: { type: SrcType | string }) {
  const p = SRC_PALETTE[type as SrcType] ?? { bg: "#EEF3F8", fg: "#345470" };
  return (
    <span
      className="font-mono text-[10.5px] font-semibold px-1.5 py-px rounded-sm uppercase"
      style={{ background: p.bg, color: p.fg, letterSpacing: "0.02em" }}
    >
      {type}
    </span>
  );
}

/* -------- StatusPill -------- */
type Status = "new" | "extracting" | "review" | "ready" | "sent" | "delivering" | "failed";

// Colors match tokens.css .pill-* exactly
const STATUS_MAP: Record<Status, { bg: string; fg: string; dot: string; pulse?: boolean; label: string }> = {
  // tokens.css .pill-new → surface-2 / ink-muted / ink-faint
  new:        { bg: "#EFF2F7", fg: "#56627A", dot: "#8A93A5",  label: "New" },
  // tokens.css .pill-extracting → brand-blue-soft / brand-blue-deep / brand-blue
  extracting: { bg: "#E3EDFB", fg: "#0F4FA8", dot: "#1E66C9",  label: "Extracting" },
  review:     { bg: "#FAEFD6", fg: "#C97A14", dot: "#C97A14",  label: "Needs review" },
  ready:      { bg: "#E2F1E2", fg: "#1E6D29", dot: "#2E8E3A",  label: "Ready" },
  sent:       { bg: "#E2F1E2", fg: "#1E6D29", dot: "#2E8E3A",  label: "Delivered" },
  // tokens.css .pill-delivering → brand-blue-soft / brand-blue-deep / brand-blue (pulse-dot)
  delivering: { bg: "#E3EDFB", fg: "#0F4FA8", dot: "#1E66C9", pulse: true, label: "Delivering" },
  failed:     { bg: "#FBE3E3", fg: "#C53A3A", dot: "#C53A3A",  label: "Failed" },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS_MAP[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span
        className={["w-[6px] h-[6px] rounded-full flex-shrink-0", s.pulse ? "animate-[pulse-dot_1.4s_ease-in-out_infinite]" : ""].join(" ").trim()}
        style={{ background: s.dot }}
      />
      {s.label}
    </span>
  );
}

/* -------- AiSuggestion -------- */
type AiSuggestionProps = {
  confidence: number;
  title: string;
  /** Short body / description text (muted, below title) */
  description?: string;
  /** Source provenance label shown faint top-right (e.g. "from existing mappings") */
  provenance?: string;
  /** Action buttons row (Accept / Edit / Reject) */
  actions?: React.ReactNode;
  children?: React.ReactNode;   // legacy action slot – kept for back-compat
};

export function AiSuggestion({ confidence, title, description, provenance, actions, children }: AiSuggestionProps) {
  // Normalise: `actions` preferred; fall back to `children` for backward compat
  const actionRow = actions ?? children;
  return (
    <div
      className="relative rounded-md overflow-hidden"
      style={{
        background: "#EEE7FB",
        border: "1px solid #ddd0f5",
        padding: "13px 14px 13px 16px",
      }}
    >
      {/* Left violet accent strip — tokens.css .ai-card::before */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 3,
          background: "#6F4FCE",
        }}
      />
      {/* Top row: AI tag + provenance */}
      <div className="flex items-start justify-between gap-2" style={{ marginBottom: 7 }}>
        {/* tokens.css .ai-tag — mono, violet */}
        <span
          className="inline-flex items-center gap-1"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10.5,
            fontWeight: 700,
            color: "#6F4FCE",
          }}
        >
          AI · {confidence}%
        </span>
        {provenance && (
          <span style={{ fontSize: 10.5, color: "#8A93A5" }}>{provenance}</span>
        )}
      </div>
      {/* Suggestion title */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>{title}</div>
      {/* Optional description */}
      {description && (
        <div style={{ fontSize: 12, color: "#56627A", marginTop: 3 }}>{description}</div>
      )}
      {/* Actions row */}
      {actionRow && (
        <div className="flex items-center gap-2" style={{ marginTop: 11 }}>{actionRow}</div>
      )}
    </div>
  );
}

/* -------- ProcuLinkMark — System Identity (Direction 3) -------- *
 *
 * Asymmetric link-node: two endpoint dots connected by a single gradient curve.
 * The mark is ONE expression of a shape system that also lives in edge rails,
 * the canonical spine, stage glyphs, and the loading state.
 *
 * Same construction at every size. Use `mono` on dark/navy surfaces.
 */
type MarkProps = {
  size?: number;
  /** Use currentColor instead of brand colors (for sidebar / dark surfaces) */
  mono?: boolean;
  /** When several marks render on one page, pass a unique id (defaults to React.useId). */
  gradientId?: string;
};

export function ProcuLinkMark({ size = 24, mono = false, gradientId }: MarkProps) {
  const autoId = React.useId();
  const id = gradientId ?? `procu-mark-${autoId.replace(/:/g, "")}`;
  const stroke = mono ? "currentColor" : `url(#${id})`;
  const dotA   = mono ? "currentColor" : "#1E66C9";
  const dotB   = mono ? "currentColor" : "#2E8E3A";

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-label="ProcuLink" role="img">
      <title>ProcuLink</title>
      {!mono && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#1E66C9"/>
            <stop offset="100%" stopColor="#2E8E3A"/>
          </linearGradient>
        </defs>
      )}
      {/* The link curve: buyer endpoint → arcs around → supplier endpoint */}
      <path
        d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
        stroke={stroke} strokeWidth="3.6" strokeLinecap="round" fill="none"
      />
      {/* Buyer endpoint */}
      <circle cx="8" cy="10" r="2.5" fill={dotA}/>
      {/* Supplier endpoint */}
      <circle cx="8" cy="30" r="2.5" fill={dotB}/>
    </svg>
  );
}
