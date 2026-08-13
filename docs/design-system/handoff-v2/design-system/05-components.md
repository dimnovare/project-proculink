# 05 — Components

> ## ⚠ STRUCK SIGNATURES — read this before building anything from this file
>
> A founder audit on **2026-08-13** checked this handoff's "five spatial signatures"
> against the shipped code. Two were never built and have been struck; two were
> narrowed. This file predates that audit and, except where corrected inline below,
> still describes the struck versions as required.
>
> **`CLAUDE.md` §2 in the repo root is the authority. This file is not.**
>
> - **Edge rails** (4px blue-left / green-right, `<EdgeRails>`) — **STRUCK.** Never
>   built. No `EdgeRails.tsx` exists in `src/`; the `.rail*` CSS and the
>   `rail` / `rail-buyer` / `rail-supplier` / `z-rails` tokens had zero consumers and
>   were deleted. Buyer→supplier orientation is carried by **panel order** on the
>   review screen and a labelled **`Buyer → Supplier`** column in the queue.
> - **Canonical Spine review** (`<CanonicalSpine>` / `<SpineNode>`) — **DELETED.**
>   Zero importers. The shipped review at `/inbox/[orderId]` is `OrderWorkshop` →
>   `MapperWorkbench`: *What we received* | *What we'll send* | *Live preview*.
> - **Wire Topology** — kept, but **demoted** from dashboard hero to a "System map" tab.
> - **Document Anatomy** — kept, **narrowed**: the document pane ships; the per-zone
>   confidence overlay does not.
> - **Cross-section card edge** (`<XCard>`) and the buyer-blue / supplier-green
>   colour semantics — **kept, unchanged.**
> - The **220px navy sidebar** is not desktop chrome: desktop nav moved to the topbar
>   and the sidebar renders only in the mobile drawer.

This file specs the **signature components** that make a ProcuLink screen recognizable, plus the foundational primitives. Each section has:
- What it is
- Where it lives
- The component contract (props)
- A working reference implementation (TSX/JSX)

Drop these into `components/` and import them anywhere.

---

## A. Signature components

### A.1 ~~`<EdgeRails>`~~ — STRUCK 2026-08-13

> **Struck 2026-08-13. Do not build this. Do not copy these props.**
>
> `<EdgeRails>` was never built into `src/` — no `EdgeRails.tsx` has ever existed there. The CSS
> written for it (`.railed`, `.rail`, `.rail.buyer`, `.rail.supplier`, `.rail-port`, `.rail-label` in
> `src/app/globals.css`) and the matching Tailwind tokens (`rail` spacing, `z-rails`,
> `bg-rail-buyer`, `bg-rail-supplier`) carried **zero consumers** for their entire life and were
> deleted. The `components/EdgeRails.tsx` reference implementation that used to sit in this handoff
> folder has been deleted too, and the live rails demo that used to render in `showcase.html` was
> removed from that page — both were artefacts of the unbuilt spec.
>
> **What carries buyer-left / supplier-right instead:** panel order on the review screen
> (*What we received* | *What we'll send* | *Live preview*), and a labelled `Buyer → Supplier`
> direction column in the queue. Layout and labels carry orientation; a 4px strip at the window edge
> did not.
>
> The contract below is preserved only so a reader can see **what** was struck.

~~The blue + green vertical rails that frame any order-handling work area.~~

~~**Use on:** Canonical Spine review · Upload Workbench · any screen that handles a specific order.~~
~~**Don't use on:** Bridge dashboard (the topology IS the buyer/supplier expression) · marketing · auth · settings.~~

~~**Props**~~
```ts
// STRUCK 2026-08-13 — never built, do not implement
{
  children: ReactNode
  intensity?: number  // 0..1, default 1 — for subtle/strong variants
  showLabels?: boolean // default true — show port markers + vertical labels
}
```

---

### A.2 `<WireTopology>`

Buyers on the left, suppliers on the right, wires arcing between them.

> **Demoted 2026-08-13.** This read "The Bridge dashboard centerpiece." It is not the centerpiece any
> more: the wire diagram is a **"System map" tab** on `/bridge`, not the dashboard hero. The component
> and its props below are real and unchanged — only its placement was demoted.

**Props**
```ts
{
  buyers: { id: string; name: string; code: string; volume: number; y: number }[]
  suppliers: { id: string; name: string; code: string; y: number; warn?: boolean }[]
  wires: {
    b: string; s: string;
    weight: 1 | 2 | 3 | 4 | 5 | 6;
    health: "ok" | "warn";
    alert?: number
  }[]
  width?: number   // viewBox width, default 1280
  height?: number  // viewBox height, default 600
  onWireClick?: (lane: { b: string; s: string }) => void
}
```

**Construction notes**
- SVG-driven. Wires are cubic Beziers with control points at 35% and 65% of the canvas width.
- Wire stroke = `url(#wire-grad)` (blue→green) or `url(#wire-warn)` (blue→amber) for at-risk lanes.
- Wire thickness from `weight` (1–6 maps to 1.5–6px stroke).
- Travelling pulse: a `<circle>` with `style={{ offsetPath: 'path("...")' }}` and a CSS animation.
- Buyer port = rounded rect with a 3px blue left strip.
- Supplier port = rounded rect with a 3px green right strip; amber if `warn`.
- Alert badge sits at the path midpoint as a white circle with amber stroke.

**Reference** — see `components/WireTopology.tsx`.

---

### A.3 ~~`<CanonicalSpine>` + `<SpineNode>`~~ — STRUCK 2026-08-13

> **Struck 2026-08-13. Do not build this. Do not copy these props.**
>
> `src/components/bridge/CanonicalSpine.tsx` had **zero importers** and was deleted, along with its
> `spine: 3px` spacing token, whose only consumer was that file. `SpineReview` was deleted earlier
> (commit `3520ed4`).
>
> **The shipped order review** at `/inbox/[orderId]` is
> `src/app/(app)/inbox/[orderId]/page.tsx` → `OrderWorkshop`
> (`src/components/bridge/workshop/OrderWorkshop.tsx`) → `MapperWorkbench`
> (`src/components/bridge/mapper/MapperWorkbench.tsx`, `variant="order"`). Three panes, left → right:
> **"What we received"** (`IncomingPane`, blue `#1E66C9` dot) | **"What we'll send"** (`OutgoingPane`,
> green `#2E8E3A` dot) | **"Live preview"** (`MapperPreviewPane`, green dot). It is **not** a
> symmetric blue-left / green-right pair — one buyer column, then two supplier columns. The middle
> column is an editable field mapping, not a read-only canonical spine.
>
> **The one rule from this section that survives:** the source document stays visible on the left
> during review. See `09-trust-rules.md` Rule 4.
>
> The contract below is preserved only so a reader can see **what** was struck.

~~The vertical schema spine that anchors the order review.~~

~~**`<CanonicalSpine>` props**~~
```ts
// STRUCK 2026-08-13 — deleted, do not implement
{ children: ReactNode }  // expects <SpineNode> children
```

~~**`<SpineNode>` props**~~
```ts
// STRUCK 2026-08-13 — deleted, do not implement
{
  id: string
  label: string                // "PO NUMBER"
  value: ReactNode             // string or rich node
  confidence: number           // 0..100
  mono?: boolean               // value uses mono font
  big?: boolean                // grand-total style
  tone?: "buyer" | "supplier"  // adds colored dot to label
  hint?: string                // amber inline hint under value
  srcRef: string               // "header" — shown in card footer left
  outRef: string               // "Order/@orderID" — shown in card footer right
  subnodes?: SubNode[]         // optional inline child rows (lines)
  onJump?: () => void          // jump-to-source action
}
```

~~**Construction notes**~~ — struck with the component
- ~~Container renders a 3px `--gradient-link-spine` vertical line down the column.~~
- ~~Each node has a 13px white circle on the spine + a card to the right with label, value, confidence chip.~~
- ~~Card footer has the source→output mapping refs (inside the card, **not** in margins).~~
- ~~Connector stubs (dashed) extend 14px to the left and right of the card.~~

~~**Reference** — see `components/CanonicalSpine.tsx`.~~ That reference implementation has been
deleted from this handoff folder, and the canonical-spine demo was removed from `showcase.html`.
`--gradient-link-spine` itself is **not** struck — it still paints the 2px topbar line.

---

### A.4 `<DocumentAnatomy>` — NARROWED 2026-08-13

> **Narrowed 2026-08-13.** Half of this contract ships and half does not.
>
> **Ships:** the document pane itself — `src/components/bridge/document/` renders the source file
> (PDF via `pdfjs-dist`; CSV/XLSX read in-browser by `src/lib/sheetPreview.ts` and laid out as a
> plain table). It is the left pane of the review screen, "What we received".
>
> **Does not ship:** everything below that concerns **zones** — the `zones` array, the per-zone
> confidence overlay rectangles, the zone label pills, `activeZoneId`, and `onZoneHover`. Per-zone
> confidence requires backend provenance that does not exist yet; building it is a separate packet.
> Do not fake a zone overlay from client-side guesses.
>
> The `source` and `document` props are the surviving half of the idea.

Wraps any rendered source document and overlays per-zone confidence annotations.

**Props**
```ts
{
  source: "pdf" | "xlsx" | "csv" | "xml" | "edi" | "json" | "email"
  document: ReactNode       // the rendered file (pdfjs, react-data-grid, shiki block, etc.)
  zones: {
    id: string
    label: string            // "Header zone"
    fields: string           // "PO # · Date"
    confidence: number       // 0..100
    top: number              // px from top of document
    height: number           // px
  }[]
  activeZoneId?: string      // for cross-highlighting with spine
  onZoneHover?: (id: string) => void
}
```

~~**Construction notes**~~ — the whole of this block is the **unbuilt** zone-overlay half
- ~~Zone overlay is a 1.5px solid border in green (≥90%) or amber (<90%).~~
- ~~Background is the same hue at 4% opacity.~~
- ~~Zone label is anchored at the top-right of its own zone, inside the document page. A small white pill with border, padding 2/6, displays `{label} · {fields} · {confidence}%`.~~
- ~~Hovering a zone calls `onZoneHover(id)` so the parent can highlight the matching spine node.~~ (There is also no spine node to highlight — see A.3.)

**Reference** — see `components/DocumentAnatomy.tsx`.

---

### A.5 `<XCard>`

The card with a cross-section edge strip — the "wire seen end-on."

**Props**
```ts
{
  children: ReactNode
  edge?: "left" | "right" | "top" | "bottom"  // default "left"
  color?: "buyer" | "supplier" | "bridge" | "danger" | "amber" | "ai" | "none"
  dense?: boolean         // tighter padding
  className?: string
}
```

**Construction notes**
- 3px strip on one edge using the matching brand token or `--gradient-link-spine` for `bridge`.
- Default card body is `--surface` with `1px solid var(--border)` and `--radius-md`.
- `color="bridge"` uses the link-spine gradient — the "this surface belongs to both sides" signal.

**Reference** — see `components/XCard.tsx`.

---

### A.6 `<StatusJourney>`

The 5-node mini-track that replaces a static status pill.

**Props**
```ts
{
  stage: 0 | 1 | 2 | 3 | 4    // Parse · Normalize · Validate · Transform · Deliver
  compact?: boolean            // tiny variant for inbox rows
  failed?: boolean             // mark current stage as failed
}
```

**Construction notes**
- 5 circles connected by 1.5px lines.
- Completed nodes (`i < stage`) filled green.
- Active node (`i === stage`) filled blue with a 3–4px blueSoft ring (pulse on activation).
- Failed: the active node becomes danger-colored with an X icon.
- Compact variant is 14px nodes / 14px gap, no labels. Full variant is 18px / 22px with labels below.

**Reference** — see `components/StatusJourney.tsx`.

---

### A.7 `<LinkSpine>`

The 2px gradient line that runs across every topbar and serves as a section divider.

**Props**
```ts
{
  height?: 1 | 2 | 3        // default 2
  soft?: boolean             // fades at the ends
  animated?: boolean         // left-to-right fill animation (state change)
  duration?: number          // ms, default 1200
}
```

**Construction notes**
- Standard: a div with `background: var(--gradient-link-spine)`.
- Animated: a flowing background-position keyframe (see motion.md).

**Reference** — see `components/LinkSpine.tsx`.

---

### A.8 `<MonumentNumber>`

The display-font KPI block used on the Bridge dashboard.

**Props**
```ts
{
  value: string               // "1,284" — pre-formatted
  label: string               // "Orders this week"
  sub?: string                // "+18% vs prev"
  accent?: "success" | "warning" | "danger" | "muted"  // sub color
  size?: 28 | 32 | 36 | 44 | 48 | 56  // display font size
}
```

**Reference** — see `components/MonumentNumber.tsx`.

---

## B. Primitives (extend shadcn/ui)

### B.1 `<Button>`

```ts
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "ai"
  size?: "sm" | "md" | "lg"
  loading?: boolean
  children: ReactNode
}
```

- `primary` → navy bg, white text. *Use for the main page action* (e.g. "Send to supplier").
- `secondary` → white bg, ink text, border. *Use for save-draft, secondary actions.*
- `ghost` → transparent bg, ink-muted text. *Use for nav, less-important actions.*
- `danger` → danger bg, white text. *Reserve for destructive actions.*
- `ai` → ai violet bg, white text. *Only for "Accept AI suggestion" type actions.*

Heights: sm 26px · md 30px · lg 36px. Radius `--radius`.

Never use gradient backgrounds on buttons.

### B.2 `<ConfidenceChip>`

```tsx
<ConfidenceChip value={84} />
// Renders "84%" with threshold color (green / amber / danger).
```

### B.3 `<SrcChip>` (file-type chip)

```tsx
<SrcChip type="PDF" />
// Uppercase mono tag, file-type colored background.
```

Supported types: PDF · XLSX · CSV · XML · cXML · EDI · EMAIL · API · JSON.

### B.4 `<StatusPill>`

For places too small for `<StatusJourney>`. The Inbox uses `<StatusJourney compact>` paired with a small pill — see the reference Inbox screen.

```tsx
<StatusPill status="review" />
```

States: `new · extracting · review · ready · sent · failed`.

### B.5 `<AiSuggestion>`

```tsx
<AiSuggestion confidence={84} title="..." description="...">
  <Button variant="ai">Accept</Button>
  <Button variant="secondary">Edit</Button>
  <Button variant="ghost">Reject</Button>
</AiSuggestion>
```

Renders a card with a 3px violet left bar, "AI · 84%" tag in the top-right, title, description, and action slot.

### B.6 `<Drawer>`

Slides from the right. **Push-not-overlay** — the table behind it shrinks. `cmd+\` toggles width between 360px and 560px.

### B.7 `<CommandPalette>`

`cmd+K`. Fuzzy across orders, suppliers, SKUs, named actions. Use `cmdk` or similar.

### B.8 `<EmptyState>`

Illustration-free. Headline + sub + primary action. Optional: a small System Identity glyph at the top (the link literally closes on hover — see motion.md).

---

## C. Composition rules

- A page has **one** `--font-display` heading. Other headings use Inter.
- A page has **one** `<Button variant="primary">`. Other actions are secondary or ghost.
- Cards in a grid use the same `XCard` edge color. Don't mix blue / green / bridge edges in one row unless you're explicitly showing buyer→bridge→supplier flow.
- `<StatusJourney>` and `<StatusPill>` together at row level: pill says the named state, journey shows where in the pipeline.
- ~~Edge rails wrap an entire screen body OR none of it. Don't put rails around individual cards.~~
  **Struck 2026-08-13** — edge rails were never built and the component, CSS and tokens are deleted.
  There is no rails composition rule because there are no rails. On the review screen, the rule that
  replaces it is: **source pane stays left of output panes** — do not reorder `IncomingPane` /
  `OutgoingPane` / `MapperPreviewPane`.
