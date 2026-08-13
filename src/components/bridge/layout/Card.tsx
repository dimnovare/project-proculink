import * as React from "react";

/* =====================================================================
   Card — the ONE card surface in this product.

   Converged 2026-08-13 from FIVE card paths that all painted the same
   rectangle and disagreed about everything else:

     1. this file                          11 importers   (survivor)
     2. src/components/bridge/XCard.tsx      2 importers   (folded in)
     3. a LOCAL `XCard` inside UploadWorkbench.tsx, 2px border, raw hex
     4. `.card` / `.xcard` / `.xc-*` in globals.css
     5. src/components/ui/card.tsx (shadcn)  0 importers

   This one won on measurement, not taste: it had the most call sites, it is
   server-component safe (XCard was "use client", so every page that used it
   paid a client boundary for a rectangle), and it spells its colours as
   `var(--token)`, which is the idiom the other ~150 hand-rolled cards already
   used and the one the token gate accepts.

   ─────────────────────────────────────────────────────────────────────
   THE EDGE RULE — read this before adding a card.

   The 3px accent edge is SEMANTIC. It says which side of the buyer↔supplier
   bridge a card belongs to. It is not decoration and it is not a status
   colour.

     edge="blue"    BUYER SIDE / INCOMING.  The card is about what arrived
                    FROM the buyer: the source document, buyer identity,
                    received or parsed data, the uploaded file.

     edge="green"   SUPPLIER SIDE / OUTGOING.  The card is about what goes
                    OUT to the supplier: supplier identity, the outgoing
                    payload, transform output, delivery config, delivery
                    result, the supplier's own response.

     edge="bridge"  SPANS BOTH.  The card shows the RELATIONSHIP between a
                    buyer input and a supplier output — a field mapping, an
                    end-to-end order journey, a buyer→supplier flow.

     edge="none"    NEUTRAL, and this is the DEFAULT.  Account, billing,
                    settings, system health, help and marketing chrome,
                    loading skeletons.

   THE TIE-BREAK, which is the part that actually matters:

     A card whose side you cannot determine gets `edge="none"`.

   Do not guess, and do not reach for "bridge" to avoid deciding — "spans
   both" is a claim about content, not a shrug. An edge that appears on
   every card carries exactly as much information as no edge at all, which
   is how this signature came to mean nothing the first time: of the two
   real <XCard> call sites that existed before this migration, BOTH passed
   `color="amber"` — a status colour — and neither passed buyer or supplier.

   `amber`, `danger` and `ai` are deliberately NOT edge values. A card that
   needs to shout about a problem uses <StatusNotice>, which owns tone.

   ─────────────────────────────────────────────────────────────────────
   THE EDGE IS PAINT, NOT LAYOUT.

   The strip is an absolutely-positioned overlay and never changes the
   content box. Adding or removing an edge is therefore a zero-reflow
   change, which is the only reason a by-rule migration across ~150 sites
   could be done without moving anything.

   (Until this commit the strip RESERVED 3px of extra left padding. Three
   call sites carried that reservation; they lose 3px of left padding here.
   That is the one deliberate geometry change in the migration.)

   `pad` and `radius` exist because the sites being migrated do not agree on
   either, and preserving a site's rendered geometry outranks unifying it.
   They are migration debt, not API surface: a new card should pass neither
   and take the canonical 18px / --radius-lg.

   Source of truth: docs/design-system/11-unified-page-rules.md
   Server-component safe — no hooks, no event handlers.
   ===================================================================== */

export type CardEdge = "blue" | "green" | "bridge" | "none";

type CardProps = {
  /** Semantic 3px accent edge on the left. See THE EDGE RULE above. */
  edge?: CardEdge;
  title?: string;
  sub?: string;
  /** Tighter padding (12px) for dense operational surfaces. */
  dense?: boolean;
  /** Migration debt: preserve a converted site's original padding. */
  pad?: number | string;
  /** Migration debt: preserve a converted site's original corner radius. */
  radius?: number | string;
  /** Render with no internal padding — tables that bleed to the border. */
  flush?: boolean;
  /** Render as a different element (e.g. "section") for landmark semantics. */
  as?: "div" | "section" | "aside" | "article" | "li";
  children: React.ReactNode;
  className?: string;
  /** Layout-only overrides (margin, overflow, minWidth). Surface properties
      — background, border, borderRadius, boxShadow — are owned by Card. */
  style?: React.CSSProperties;
  role?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  /** Loading surfaces (skeletons) that announce themselves as busy. */
  "aria-busy"?: boolean | "true" | "false";
  "data-testid"?: string;
};

const EDGE_COLOR: Record<Exclude<CardEdge, "none">, string> = {
  blue: "var(--brand-blue)",
  green: "var(--brand-green)",
  bridge: "var(--gradient-link-spine)",
};

export function Card({
  edge = "none",
  title,
  sub,
  dense = false,
  pad,
  radius,
  flush = false,
  as: Tag = "div",
  children,
  className,
  style,
  ...rest
}: CardProps) {
  const padding = flush ? 0 : (pad ?? (dense ? 12 : 18));

  return (
    <Tag
      className={className}
      {...rest}
      style={{
        ...style,
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: radius ?? "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding,
        overflow: style?.overflow ?? "hidden",
      }}
    >
      {/* Cross-section accent edge. Absolutely positioned so a gradient
          ('bridge') works the same way as a solid colour, and so adding an
          edge never reflows the content. */}
      {edge !== "none" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "var(--card-edge)",
            background: EDGE_COLOR[edge],
          }}
        />
      )}

      {(title || sub) && (
        <div style={{ marginBottom: 12 }}>
          {title && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                lineHeight: 1.3,
              }}
            >
              {title}
            </div>
          )}
          {sub && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-muted)",
                marginTop: 3,
                lineHeight: 1.45,
              }}
            >
              {sub}
            </div>
          )}
        </div>
      )}

      {children}
    </Tag>
  );
}

export default Card;
