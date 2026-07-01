import * as React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Circle,
  type LucideIcon,
} from "lucide-react";

/* =====================================================================
   UnifiedStatusBadge (ui) — ONE canonical order/exception status pill.

   ONE shape / size / padding. FIVE semantic tones, each with a Lucide
   icon + word and tabular figures, all driven by the locked design
   tokens (globals.css). Keys on the RAW backend OrderStatus, so rows,
   filter chips, and detail panels can all resolve the same tone/label.

   Tones -> locked semantic tokens (see docs/design-system/tokens):
     success  -> brand-green   (delivered / normalized / ready to send)
     warning  -> amber         (needs review)
     danger   -> danger        (any failure / rejection / dead-letter)
     info     -> brand-blue    (in-progress: parsing / transforming / sending)
     neutral  -> surface-2 / ink-muted (new / cancelled / archived / unknown)

   Vocabulary (kept in sync with InboxView's status presentation map):
     ready             -> "Normalized"      (parsed/validated, nothing to send yet)
     ready_to_deliver  -> "Ready to send"   (artifact generated, awaiting delivery)

   Server-component safe (no hooks / handlers).
   ===================================================================== */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

type ToneStyle = { bg: string; fg: string; Icon: LucideIcon };

/** Canonical tone -> {bg, fg, Icon} using the locked semantic tokens + one Lucide glyph per tone. */
const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  success: { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)", Icon: CheckCircle2 },
  warning: { bg: "var(--amber-soft)", fg: "var(--amber)", Icon: AlertTriangle },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)", Icon: XCircle },
  info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", Icon: Loader2 },
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-muted)", Icon: Circle },
};

type StatusMeta = { label: string; tone: StatusTone; spin?: boolean };

/**
 * Canonical status -> {label, tone}. Keys cover the order lifecycle and the
 * exception/dead-letter states. Unknown statuses fall back to a neutral badge
 * with a humanized label (see statusMeta()).
 */
const STATUS_META: Record<string, StatusMeta> = {
  // Intake / processing
  new: { label: "New", tone: "neutral" },
  uploaded: { label: "Uploaded", tone: "neutral" },
  pending_parse: { label: "Queued", tone: "neutral" },
  parsing: { label: "Extracting", tone: "info", spin: true },
  extracting: { label: "Extracting", tone: "info", spin: true },
  normalizing: { label: "Normalizing", tone: "info", spin: true },

  // Needs human attention
  review: { label: "Needs review", tone: "warning" },
  needs_review: { label: "Needs review", tone: "warning" },
  pending_review: { label: "Needs review", tone: "warning" },

  // Stable / pre-delivery — the load-bearing distinction
  ready: { label: "Normalized", tone: "success" },
  ready_to_deliver: { label: "Ready to send", tone: "success" },

  // Transform
  transforming: { label: "Transforming", tone: "info", spin: true },
  transformed: { label: "Transformed", tone: "success" },

  // Delivery
  delivering: { label: "Sending", tone: "info", spin: true },
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Delivered", tone: "success" },

  // Failures
  failed: { label: "Failed", tone: "danger" },
  parse_failed: { label: "Parse failed", tone: "danger" },
  transform_failed: { label: "Transform failed", tone: "danger" },
  delivery_failed: { label: "Delivery failed", tone: "danger" },
  delivery_dead_letter: { label: "Dead-lettered", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },
  rejected_by_supplier: { label: "Rejected", tone: "danger" },

  // Terminal / inactive
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },

  // Connection lifecycle (versioned supplier connections)
  live: { label: "Live", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
};

/** Humanize an unknown status key: "delivery_dead_letter" -> "Delivery dead letter". */
function humanize(status: string): string {
  const s = (status ?? "").trim();
  if (!s) return "Unknown";
  const spaced = s.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Internal: resolve full meta (label + tone + spin) for a status, with fallback. */
function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[(status ?? "").toLowerCase()] ?? {
      label: humanize(status),
      tone: "neutral",
    }
  );
}

/** statusLabel(status) — canonical human label (humanized fallback for unknowns). */
export function statusLabel(status: string): string {
  return statusMeta(status).label;
}

/** statusTone(status) — canonical semantic tone for a status (neutral fallback). */
export function statusTone(status: string): StatusTone {
  return statusMeta(status).tone;
}

type UnifiedStatusBadgeProps = {
  /** Raw backend OrderStatus. */
  status: string;
  className?: string;
};

/**
 * UnifiedStatusBadge — ONE pill (one shape/size/padding). Resolves tone + label
 * from the raw status, renders a per-tone Lucide icon + the canonical word, with
 * tabular figures so counts/codes inside labels stay column-aligned.
 */
export function UnifiedStatusBadge({ status, className }: UnifiedStatusBadgeProps) {
  const meta = statusMeta(status);
  const tone = TONE_STYLE[meta.tone];
  const Icon = tone.Icon;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap tabular-nums",
        "h-[22px] pl-2 pr-2.5 text-[11.5px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: tone.bg, color: tone.fg }}
    >
      <Icon
        aria-hidden
        size={12}
        strokeWidth={2.25}
        className={["flex-shrink-0", meta.spin ? "animate-spin" : ""].join(" ").trim()}
      />
      {meta.label}
    </span>
  );
}

export default UnifiedStatusBadge;
