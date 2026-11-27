"use client";
import * as React from "react";

/* =====================================================================
   Primitives — Button, Pill, AiSuggestion, ProcuLinkMark.

   ConfidenceChip moved out (WP-30) — see the note further down. Its single
   implementation is ConfidenceChip.tsx.

   Status badges live in UnifiedStatusBadge (orders/exceptions) and
   RevisionStatusBadge (connection revisions) — not here.
   ===================================================================== */

/* -------- Button -------- */
type ButtonVariant = "primary" | "send" | "secondary" | "ghost" | "danger" | "ai";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold border whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // Every filled button is navy. Green only for a press that sends a document
  // out (Send, Send again, Issue in KSeF); brand-green-btn is 4.6:1 AA.
  primary:   "bg-navy text-white border-transparent hover:bg-navy-surface",
  send:      "bg-brand-green-btn text-white border-transparent hover:bg-brand-green-deep",
  secondary: "bg-surface text-ink border-border-strong hover:bg-surface-2",
  ghost:     "bg-transparent text-ink-muted border-transparent hover:bg-surface-2 hover:text-ink",
  danger:    "bg-danger text-white border-transparent hover:opacity-90",
  ai:        "bg-ai text-white border-transparent hover:opacity-90",
};

// Mobile-first hit area: every size is >=44px tall on small screens (--tap-min)
// and shrinks to its dense desktop height at sm:. Text is never under 12.5px.
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-[44px] sm:h-8 px-3 text-[12.5px]",
  md: "h-[44px] sm:h-10 px-3.5 text-[14px]",
  lg: "h-[44px] px-[18px] text-[14px]",
};

/** The classes of a <Button>, for a link or a label drawn as one. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return [BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size]].join(" ");
}

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
      className={[buttonClass(variant, size), className].filter(Boolean).join(" ")}
      disabled={rest.disabled || loading}
    >
      {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"/>}
      {children}
    </button>
  );
}

/* -------- Pill — generic tone-based status chip --------
   For inline chips (toolbar "13 of 13 mapped", header "Setup 5/6", "Normalized",
   filter chips, format badges). Status-specific badges still live in
   UnifiedStatusBadge / RevisionStatusBadge; this is the neutral primitive. */
type PillTone = "neutral" | "blue" | "green" | "amber" | "danger" | "ai";

const PILL_TONE: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-2)",        fg: "var(--ink-muted)" },
  blue:    { bg: "var(--brand-blue-soft)",  fg: "var(--brand-blue-deep)" },
  green:   { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)" },
  amber:   { bg: "var(--amber-soft)",       fg: "var(--amber-text)" },
  danger:  { bg: "var(--danger-soft)",      fg: "var(--danger-text)" },
  ai:      { bg: "var(--ai-soft)",          fg: "var(--ai)" },
};

export function Pill({
  tone = "neutral",
  icon,
  children,
  className,
  title,
  "data-testid": testId,
}: {
  tone?: PillTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** The full words: the pill then fits its space and ends in "…" when it must. */
  title?: string;
  "data-testid"?: string;
}) {
  const t = PILL_TONE[tone];
  return (
    <span
      data-testid={testId}
      title={title}
      className={["inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap", title && "max-w-full", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 12.5,
        padding: "2px 9px",
        minHeight: 24,
        lineHeight: 1.3,
      }}
    >
      {icon}
      {title ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}

/* -------- ConfidenceChip / SrcChip — REMOVED (WP-30) --------
   Both were exported here and imported by nobody: `git grep` over every importer
   of this module finds only Button and ProcuLinkMark. Meanwhile their live
   counterparts had drifted away from them — the confidence thresholds (90/75
   here vs 85/65 in the mapper chip) and the format palette (SrcChip drew XLSX,
   API at 3.61:1 and EDI at 3.65:1, below the AA floor).

   ConfidenceChip's single implementation is src/components/bridge/ConfidenceChip.tsx.
   The format chip (FileChip) was deleted in the plan 13b orphan sweep.      */

/* -------- AiSuggestion -------- */
type AiSuggestionProps = {
  /**
   * The score behind this suggestion, or null/undefined when nothing scored it.
   *
   * Nullable on purpose. It was a required `number`, so the one live caller wrote
   * `confidence={score ?? 0}` and an unscored suggestion would have rendered
   * "AI · 0%" — a confident claim of near-certain wrongness, minted from an
   * absence. The tag below prints the percentage only when there is one.
   */
  confidence: number | null | undefined;
  title: string;
  /** Short body / description text (muted, below title) */
  description?: string;
  /** Source provenance label shown faint top-right (e.g. "from existing mappings") */
  provenance?: string;
  /** Action buttons row (Accept / Edit / Reject) */
  actions?: React.ReactNode;
  /**
   * Where the suggestion came from. `"ai"` (default) wears violet and the "AI"
   * tag; `"heuristic"` is a deterministic, non-model match (string similarity,
   * an exact column-name hit) and deliberately wears neither.
   *
   * The `ai` / `aiSoft` tokens are reserved for AI-generated content, so a
   * local fallback match must not borrow them — `ConfidenceChip` draws the same
   * line for supplier auto-detect, which reuses the confidence ramp but never
   * the "AI confidence" label. Confidence stays visible in both tones; only the
   * attribution changes.
   */
  kind?: "ai" | "heuristic";
  children?: React.ReactNode;   // legacy action slot – kept for back-compat
};

export function AiSuggestion({
  confidence, title, description, provenance, actions, kind = "ai", children,
}: AiSuggestionProps) {
  // Normalise: `actions` preferred; fall back to `children` for backward compat
  const actionRow = actions ?? children;
  const isAi = kind === "ai";
  // Heuristic tone reuses the shared surface/border/ink tokens rather than
  // minting a second grey. --ink-muted on --surface-2 is 5.12:1 (WCAG 2.1),
  // AA for the 10.5px bold tag.
  const accent = isAi ? "#6F4FCE" : "var(--ink-muted)";
  return (
    <div
      className="relative rounded-md overflow-hidden"
      style={{
        background: isAi ? "#F0EAFB" : "var(--surface-2)",
        border: `1px solid ${isAi ? "#ddd0f5" : "var(--border)"}`,
        padding: "13px 14px 13px 16px",
      }}
    >
      {/* Left accent strip — tokens.css .ai-card::before */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 3,
          background: accent,
        }}
      />
      {/* Top row: source tag + provenance */}
      <div className="flex items-start justify-between gap-2" style={{ marginBottom: 7 }}>
        {/* tokens.css .ai-tag — mono, violet for model output */}
        <span
          className="inline-flex items-center gap-1"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10.5,
            fontWeight: 700,
            color: accent,
          }}
        >
          {isAi ? "AI" : "MATCH"}{confidence != null ? ` · ${confidence}%` : ""}
        </span>
        {provenance && (
          <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{provenance}</span>
        )}
      </div>
      {/* Suggestion title */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "#0B1A2F" }}>{title}</div>
      {/* Optional description */}
      {description && (
        <div style={{ fontSize: 12, color: "#5E6779", marginTop: 3 }}>{description}</div>
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
