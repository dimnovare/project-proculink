import * as React from "react";

/* =====================================================================
   UnifiedStatusBadge — the ONE canonical order/exception status badge.

   Named UnifiedStatusBadge (not StatusBadge) because an unrelated
   `StatusBadge` already exists at src/components/ui/status-badge.tsx; this
   avoids a colliding export while we converge pages onto one mapping.

   Single source of truth for:
     - canonical human labels (STATUS_LABELS / statusLabel)
     - semantic tone → token colors (statusTone)
   so rows, filter chips, and detail panels all say the same thing.

   IMPORTANT vocabulary fix:
     ready             → "Normalized"        (parsed/validated, nothing to send yet)
     ready_to_deliver  → "Ready to send"     (artifact generated, awaiting delivery)
   These were previously both labeled "Ready", which made the
   "Ready to send" filter chip read 0 while rows said "Ready".
   Kept in sync with InboxView's status presentation map.

   Tones map to the canonical semantic tokens:
     success  → brand-green (soft bg)
     warning  → amber  #C97A14 / soft #FAEFD6
     danger   → #C53A3A / soft #FBE3E3
     info     → brand-blue (in-progress)
     neutral  → ink-muted

   Source of truth: docs/design-system/11-unified-page-rules.md
   Not wired into pages here — a separate change adopts it.

   Server-component safe (no hooks / handlers).
   ===================================================================== */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

type ToneStyle = { bg: string; fg: string };

/** Canonical tone → {bg, fg} using the locked semantic tokens. */
const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  success: { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)" },
  warning: { bg: "var(--amber-soft)", fg: "var(--amber)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)" },
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-muted)" },
};

type StatusMeta = { label: string; tone: StatusTone; pulse?: boolean };

/**
 * Canonical status → {label, tone}. Keys cover the order lifecycle and the
 * exception/dead-letter states. Unknown statuses fall back to a neutral badge
 * with a humanized label (see statusMeta()).
 */
const STATUS_META: Record<string, StatusMeta> = {
  // ── Intake / processing ──────────────────────────────────────────────
  new: { label: "New", tone: "neutral" },
  uploaded: { label: "Uploaded", tone: "neutral" },
  parsing: { label: "Parsing", tone: "info", pulse: true },
  extracting: { label: "Extracting", tone: "info", pulse: true },
  normalizing: { label: "Normalizing", tone: "info", pulse: true },

  // ── Needs human attention ────────────────────────────────────────────
  review: { label: "Needs review", tone: "warning" },
  needs_review: { label: "Needs review", tone: "warning" },
  pending_review: { label: "Needs review", tone: "warning" },

  // ── Stable / pre-delivery — the load-bearing distinction ─────────────
  // `ready` = parsed & validated, nothing queued to send yet → "Normalized"
  // (NOT "Ready", which collided with the "Ready to send" chip).
  ready: { label: "Normalized", tone: "success" },
  // `ready_to_deliver` = artifact generated, awaiting delivery → "Ready to send".
  ready_to_deliver: { label: "Ready to send", tone: "success" },

  // ── Transform ────────────────────────────────────────────────────────
  transforming: { label: "Transforming", tone: "info", pulse: true },
  transformed: { label: "Transformed", tone: "success" },

  // ── Delivery ─────────────────────────────────────────────────────────
  delivering: { label: "Sending", tone: "info", pulse: true },
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Delivered", tone: "success" },

  // ── Failures ─────────────────────────────────────────────────────────
  failed: { label: "Failed", tone: "danger" },
  parse_failed: { label: "Parse failed", tone: "danger" },
  transform_failed: { label: "Transform failed", tone: "danger" },
  delivery_failed: { label: "Delivery failed", tone: "danger" },
  delivery_dead_letter: { label: "Dead-lettered", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },

  // ── Terminal / inactive ──────────────────────────────────────────────
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

/** Humanize an unknown status key: "delivery_dead_letter" → "Delivery dead letter". */
function humanize(status: string): string {
  const s = (status ?? "").trim();
  if (!s) return "Unknown";
  const spaced = s.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Internal: resolve full meta (label + tone + pulse) for a status, with fallback. */
function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[(status ?? "").toLowerCase()] ?? {
      label: humanize(status),
      tone: "neutral",
    }
  );
}

/**
 * STATUS_LABELS — canonical human label per known status key. Reuse this in
 * filter chips, table cells, and detail panels so vocabulary never diverges.
 */
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** statusLabel(status) — canonical human label (humanized fallback for unknowns). */
export function statusLabel(status: string): string {
  return statusMeta(status).label;
}

/** statusTone(status) — canonical semantic tone for a status (neutral fallback). */
export function statusTone(status: string): StatusTone {
  return statusMeta(status).tone;
}

type UnifiedStatusBadgeProps = {
  status: string;
  size?: "sm" | "md";
  className?: string;
};

const SIZE: Record<NonNullable<UnifiedStatusBadgeProps["size"]>, string> = {
  sm: "h-5 px-2 text-[11px]",
  md: "h-6 px-2.5 text-[12px]",
};

export function UnifiedStatusBadge({
  status,
  size = "sm",
  className,
}: UnifiedStatusBadgeProps) {
  const meta = statusMeta(status);
  const tone = TONE_STYLE[meta.tone];

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        SIZE[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span
        aria-hidden
        className={[
          "w-[6px] h-[6px] rounded-full flex-shrink-0",
          meta.pulse ? "animate-[pulse-dot_1.4s_ease-in-out_infinite]" : "",
        ]
          .join(" ")
          .trim()}
        style={{ background: "currentColor" }}
      />
      {meta.label}
    </span>
  );
}

export default UnifiedStatusBadge;
