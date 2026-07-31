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
   UnifiedStatusBadge — the ONE canonical order/exception status badge.

   Named UnifiedStatusBadge (not StatusBadge) to avoid colliding with the
   page-local `StatusBadge` helpers that still exist for NON-order statuses
   (admin account status, invoice/ASN status, supplier-response outcome).

   Single source of truth for:
     - canonical human labels (STATUS_LABELS / statusLabel)
     - semantic tone → token colors (statusTone)
   so rows, filter chips, and detail panels all say the same thing.

   This file absorbed the former src/components/ui/UnifiedStatusBadge.tsx
   duplicate (2026-07-02): the optional `icon` prop below renders that
   version's per-tone Lucide glyph (spinning Loader2 while in progress)
   instead of the default leading dot. Dense scanning surfaces (inbox
   table, connections list) opt in with `icon`; everywhere else keeps the
   dot, pixel-unchanged.

   IMPORTANT vocabulary rule (WP-25, DESIGN-DB-1 §6.4 rows 57-58):
     ready             → "Ready to send"     (checks passed; the HUMAN's turn)
     ready_to_deliver  → "Queued to send"    (output file built; OUR turn)
   The two labels must stay DISTINCT. They were once both "Ready", which made
   the inbox filter chip read 0 while rows said "Ready"; and the chip's label
   must always name the status it actually filters (`ready_to_deliver`), which
   is why the chip reads "Queued to send" too. Kept in sync with InboxView's
   STATUS_PRESENTATION and FILTER_CHIPS.

   Tones map to the canonical semantic tokens:
     success  → brand-green (soft bg)
     warning  → amber  #B36D14 / soft #FAF1DD
     danger   → #B43838 / soft #FBE3E3
     info     → brand-blue (in-progress)
     neutral  → ink-muted

   Source of truth: docs/design-system/11-unified-page-rules.md
   Not wired into pages here — a separate change adopts it.

   Server-component safe (no hooks / handlers).
   ===================================================================== */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

type ToneStyle = { bg: string; fg: string; Icon: LucideIcon };

/** Canonical tone → {bg, fg} using the locked semantic tokens, plus one
    Lucide glyph per tone for the opt-in `icon` rendering mode. */
const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  success: { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)", Icon: CheckCircle2 },
  warning: { bg: "var(--amber-soft)", fg: "var(--amber-text)", Icon: AlertTriangle },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)", Icon: XCircle },
  info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", Icon: Loader2 },
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-muted)", Icon: Circle },
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
  pending_parse: { label: "Waiting", tone: "neutral" },
  // `parsing` is labelled "Extracting" to match the inbox stage vocabulary
  // (InboxView STATUS_PRESENTATION) — one word for the extract stage app-wide.
  parsing: { label: "Extracting", tone: "info", pulse: true },
  extracting: { label: "Extracting", tone: "info", pulse: true },
  // `normalizing` is an internal sub-step of extraction the user cannot act on,
  // so it shows the same word as `parsing` rather than teaching a second one
  // (DESIGN-DB-1 §6.4 row 61). The KEY is untouched — only the label merges.
  normalizing: { label: "Extracting", tone: "info", pulse: true },

  // ── Needs human attention ────────────────────────────────────────────
  // `unrouted` = extracted, but no supplier resolved, so it waits for one. Warning, not
  // neutral: it is a user-action backlog (assign a supplier), and the backend grades its
  // `unrouted_order` exception "warning". Without this entry it fell to humanize() —
  // a neutral "Unrouted" badge that disagreed with the inbox pipeline column's "New".
  unrouted: { label: "Needs supplier", tone: "warning" },
  review: { label: "Needs review", tone: "warning" },
  needs_review: { label: "Needs review", tone: "warning" },
  pending_review: { label: "Needs review", tone: "warning" },

  // ── Stable / pre-delivery — the load-bearing distinction ─────────────
  // `ready` = every check passed, nothing queued to send yet → the HUMAN's turn.
  ready: { label: "Ready to send", tone: "success" },
  // `ready_to_deliver` = output file built, delivery pending → OUR turn.
  ready_to_deliver: { label: "Queued to send", tone: "success" },

  // ── Transform ────────────────────────────────────────────────────────
  transforming: { label: "Preparing output", tone: "info", pulse: true },
  // `transformed` is the same user-visible situation as `ready_to_deliver`:
  // the output file exists and the send is pending (DESIGN-DB-1 §6.4 row 63).
  transformed: { label: "Queued to send", tone: "success" },

  // ── Delivery ─────────────────────────────────────────────────────────
  delivering: { label: "Sending", tone: "info", pulse: true },
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Delivered", tone: "success" },

  // ── Paused (not delivery, not a failure) ─────────────────────────────
  // Billing hold: the supplier file exists and is intact; we simply didn't send it
  // because the plan can't process orders right now. It auto-releases on reactivation.
  // "Delivery paused" is the honest label — never "failed" (nothing failed) and no
  // `pulse` (nothing is in flight; it waits on an invoice, not on us).
  delivery_held: { label: "Delivery paused", tone: "warning" },

  // ── Unconfirmed delivery (a fault, but not a confirmed failure) ───────
  // A crash lost the outcome after we sent — we can't tell whether the supplier
  // received it. "Unknown", never "failed" — we don't know that it failed — and
  // never "sent", which we also don't know. Warning tone: needs a human, but is
  // not a red failure.
  delivery_unconfirmed: { label: "Delivery unknown", tone: "warning" },

  // ── Failures ─────────────────────────────────────────────────────────
  // Each label names WHAT could not be done, in the user's words, instead of the
  // engine stage that threw (DESIGN-DB-1 §6.4 rows 70-75). `failed` is the
  // parse-terminal status, so it reads the same as `parse_failed`.
  failed: { label: "Couldn't read file", tone: "danger" },
  parse_failed: { label: "Couldn't read file", tone: "danger" },
  transform_failed: { label: "Couldn't build output", tone: "danger" },
  delivery_failed: { label: "Couldn't send", tone: "danger" },
  // The three automatic retries are spent; a human has to resend. "Retry needed"
  // names the action, which "Dead-lettered" never did.
  delivery_dead_letter: { label: "Out of retries", tone: "danger" },
  rejected: { label: "Supplier rejected", tone: "danger" },
  rejected_by_supplier: { label: "Supplier rejected", tone: "danger" },

  // ── Terminal / inactive ──────────────────────────────────────────────
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },

  // ── Connection lifecycle (versioned supplier connections) ────────────
  live: { label: "Live", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
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
  /**
   * Render the per-tone Lucide glyph (check / warning / x / spinner / circle)
   * instead of the default leading dot. Ported from the retired
   * components/ui duplicate for dense scanning surfaces (inbox table,
   * connections list). Defaults to false — the dot — so existing call
   * sites are unchanged.
   */
  icon?: boolean;
  className?: string;
};

const SIZE: Record<NonNullable<UnifiedStatusBadgeProps["size"]>, string> = {
  sm: "h-5 px-2 text-[11px]",
  md: "h-6 px-2.5 text-[12px]",
};

export function UnifiedStatusBadge({
  status,
  size = "sm",
  icon = false,
  className,
}: UnifiedStatusBadgeProps) {
  const meta = statusMeta(status);
  const tone = TONE_STYLE[meta.tone];
  const Icon = tone.Icon;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        SIZE[size],
        icon ? "tabular-nums" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: tone.bg, color: tone.fg }}
    >
      {icon ? (
        <Icon
          aria-hidden
          size={12}
          strokeWidth={2.25}
          className={["flex-shrink-0", meta.pulse ? "animate-spin" : ""].join(" ").trim()}
        />
      ) : (
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
      )}
      {meta.label}
    </span>
  );
}

export default UnifiedStatusBadge;
