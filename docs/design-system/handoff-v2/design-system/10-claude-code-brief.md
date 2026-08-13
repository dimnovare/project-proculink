# ProcuLink — Frontend UI Prompt for Claude Code (v2 — locked: "The Bridge Layer")

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

> **Struck 2026-08-13. Do not hand this whole document to Claude Code as an implementation brief.**
> It is **not** self-contained and it is **not** current: it specifies two screens/components that
> were never built (edge rails, the Canonical Spine review), one that was demoted (wire topology as
> the dashboard hero), and one that was narrowed (Document Anatomy's per-zone confidence overlay).
> An agent handed this document verbatim will build the wrong product — that is exactly how the
> struck signatures survived in this handoff for months.
>
> **Hand it `CLAUDE.md` §2 instead.** Use this file only for its **token, type, colour, copy and
> motion detail**, which are still good, and read each inline strike note before acting on any
> layout, component contract, screen spec, build order or acceptance criterion below.

This document was written as a self-contained implementation brief — design system, screen-by-screen specs, signature components, motion language, and stack alignment for Next.js 15 + Tailwind + shadcn/ui + TanStack + Clerk + ASP.NET API. Treat the design-system halves as reference and the spatial/screen halves as superseded.

---

## 1. Product brief (paste verbatim)

You are building the frontend for **ProcuLink** — an AI-assisted **order transformation bridge** between buyers, suppliers, ERPs, and procurement systems. ProcuLink ingests messy purchase orders in any format (PDF, Excel, CSV, XML, cXML, EDI, JSON, email attachments), normalizes them into a canonical PO model, validates them against supplier-specific rules, lets a human review only the exceptions, and emits a clean supplier- or buyer-ready output.

**Tagline:** *"Connecting Procurement — the missing link between buyers and suppliers."*

**Marketing line:** *"Buyers on one side. Suppliers on the other. We are the bridge."*

**Not:** a chatbot, a generic PDF parser, a Zapier clone, a marketplace, a procurement CRM. **Is:** a vertical integration workbench for B2B order documents and supplier-specific transformation rules.

**Primary users:** order-processing operators and integration specialists at distributors, wholesalers, IT resellers, industrial/medical/building suppliers. They handle dozens to hundreds of POs/day in mixed formats. Power users — they know SKUs, EDI segments, cXML payloads, PunchOut quirks.

**Core workflow:** `Parse → Normalize → Validate → Review → Transform → Deliver → Learn`

---

## 2. Visual direction: "The Bridge Layer" (LOCKED)

The product *is* a bridge between two parties — and the UI structurally shows itself as one. This is not styling; it is the architecture of every screen.

### ~~Five spatial signatures (non-negotiable)~~ — two struck, two narrowed, 2026-08-13

> **Struck 2026-08-13.** These five were audited against `src/`. **Two of them had never been built.**
> They were never non-negotiable; they were unimplemented. Corrections are inline on each.

1. ~~**Edge rails.** A 4px blue rail on the left edge of the work area and a 4px green rail on the right. Blue = buyer / incoming. Green = supplier / outgoing. Render port markers at the top of each rail. The rails frame every screen that handles an order.~~

   > **STRUCK.** Never built — no `EdgeRails.tsx` in `src/`. The `.rail*` CSS in
   > `src/app/globals.css` and the `rail` / `rail-buyer` / `rail-supplier` / `z-rails` tokens had
   > **zero consumers** and were deleted. Buyer→supplier orientation is carried by **panel order** on
   > the review screen and a labelled **`Buyer → Supplier`** column in the queue.

2. **Wire Topology.** A network diagram: buyer ports down the left edge, supplier ports down the right edge, **wires arcing between them**. Wire thickness = volume. Wire color = health (blue→green normal, blue→amber if at-risk). Travelling pulses animate along active wires.

   > **Demoted 2026-08-13.** This said "**Wire Topology dashboard.** The home screen is not a grid of
   > KPI cards." The wire diagram is now a **"System map" tab** on `/bridge`, not the dashboard hero.
   > The diagram itself is real and its construction rules are unchanged.

3. ~~**Canonical Spine review.** Order detail is a 3-column ETL view:~~
   - ~~**Left:** source document with anatomy overlay (header / parties / lines / totals zones, each with a confidence chip).~~
   - ~~**Center:** the canonical PO schema as a **vertical spine** of nodes connected by a blue→green gradient line. Source-field refs sit to the left of each node; output-field paths sit to the right.~~
   - ~~**Right:** supplier-ready output (cXML / CSV / JSON) with the same fields highlighted in place.~~

   > **STRUCK.** `src/components/bridge/CanonicalSpine.tsx` had **zero importers** and was deleted;
   > `SpineReview` was deleted earlier (commit `3520ed4`). The shipped review at `/inbox/[orderId]` is
   > `src/app/(app)/inbox/[orderId]/page.tsx` → `OrderWorkshop` → `MapperWorkbench`
   > (`variant="order"`): **"What we received"** (`IncomingPane`, blue `#1E66C9` dot) |
   > **"What we'll send"** (`OutgoingPane`, green `#2E8E3A` dot) | **"Live preview"**
   > (`MapperPreviewPane`, green dot). One buyer column then two supplier columns — **not** a
   > symmetric blue-left/green-right pair. The middle column is an editable field mapping, not a
   > read-only canonical spine. **The one requirement that survives: the source document stays
   > visible on the left.**

4. **Document Anatomy.** Source PDFs/spreadsheets are always presented to the operator as the rendered document — they see what ProcuLink saw.

   > **Narrowed 2026-08-13.** The original bullet demanded "labeled zone overlays and per-zone
   > confidence — the 'x-ray' of the order". The **document pane ships**
   > (`src/components/bridge/document/`). The **per-zone confidence overlay does not** — it needs
   > backend provenance and is a separate packet. Do not fake zone confidence from client-side
   > guesses.

5. **Cross-section card edge.** Primary cards have a 3px brand-gradient strip on **one edge** (the "wire seen end-on"). Blue strip = buyer surface. Green strip = supplier surface. Full gradient = bridge surface. Replaces decorative borders and notched corners.

   > **Kept, unchanged.** `<XCard>` is real (`src/components/bridge/XCard.tsx`).

### Supporting signatures

- **Navy app chrome / light work area.** Sidebar and topbar are navy (`#0B1A2F`); main content is warm light. The chrome is the brand frame; work is calm.
- **Link-spine.** A 2px blue→green gradient line runs across the bottom of every topbar.
- **Status as a journey.** Order status is a 5-node mini-track (Parse · Normalize · Validate · Transform · Deliver), not a static pill.
- **Monumental numbers.** KPIs use Bricolage Grotesque, weight 600, tight letterspacing. Numbers ARE the brand voice.
- **System Identity logo.** Evolve the mark toward Direction 3 — a family of link-glyphs, not just one symbol. The mark, the link-spine, the rail markers, the loading state, and the pipeline icons are all expressions of the same shape language.

---

## 3. Design tokens (drop into `tailwind.config.ts`)

```ts
// theme.colors
{
  brand: {
    blue:     "#1E66C9",   // buyer / incoming / structure / trust
    blueDeep: "#0F4FA8",
    blueSoft: "#EAF0F8",
    green:    "#2E8E3A",   // supplier / outgoing / completion
    greenDeep:"#1E6D29",
    greenSoft:"#E9F1EA",
  },
  navy: {
    DEFAULT: "#0B1A2F",    // sidebar + topbar
    surface: "#14253D",    // raised within chrome
    border:  "#1F3252",
    text:    "#C8D1E0",
    muted:   "#7C8DA6",
  },
  bg:        "#F6F7FA",     // app background
  bgWarm:    "#F8F6F1",     // marketing surfaces
  surface:   "#FFFFFF",
  surface2:  "#F1F3F7",
  border:    "#E5E8EE",
  borderStrong: "#CBD0DA",
  ink: {
    DEFAULT: "#0B1A2F",
    muted:   "#5E6779",
    faint:   "#98A0AE",
  },
  amber:     "#B36D14",
  amberSoft: "#FAF1DD",
  danger:    "#B43838",
  dangerSoft:"#FAE6E6",
  ai:        "#6F4FCE",     // ONLY for AI-generated content
  aiSoft:    "#F0EAFB",
}
// theme.fontFamily
{
  sans:    ['"Inter"',           "system-ui", "sans-serif"],
  display: ['"Bricolage Grotesque"', '"Inter"', "system-ui", "sans-serif"],
  mono:    ['"JetBrains Mono"',  "ui-monospace", "monospace"],
}
// theme.backgroundImage
{
  "link-spine":    "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
  "bridge-deck":   "linear-gradient(90deg, #1E66C9, #2E8E3A)",
  "rail-buyer":    "linear-gradient(180deg, rgba(30,102,201,0.2), #1E66C9 50%, rgba(30,102,201,0.2))",
  "rail-supplier": "linear-gradient(180deg, rgba(46,142,58,0.2), #2E8E3A 50%, rgba(46,142,58,0.2))",
}
```

Scales: spacing 4px base, radii `card-sm: 6 / card: 8 / card-lg: 12`. Shadows: avoid heavy drops. Cards use borders + a single soft `0 1px 2px rgba(11,26,47,0.04)`. Popovers may use `0 8px 24px rgba(11,26,47,0.10)`.

Type: body 13/14px, table rows 12/12.5px, KPI display 32–48px, marketing display 60–78px.

---

## 4. App shell

A persistent **navy top bar** + **main work area**.

> **Struck 2026-08-13.** This read "A persistent **navy left sidebar (220px)** + **navy top bar
> (52px)** + **main work area** that uses **edge rails** on order-handling screens." Two corrections:
> **edge rails were never built** (component, CSS and tokens all deleted for zero consumers), and the
> **220px sidebar is not desktop chrome** — desktop nav moved to the topbar, and the sidebar renders
> only inside the mobile drawer. Navy-chrome-over-light-work-area is otherwise unchanged. Read the
> sidebar spec below as the **mobile drawer** spec.

### Sidebar (navy)

- Logo (System Identity mark) + "ProcuLink" wordmark.
- Workspace switcher card (small avatar, name, ⌄).
- Nav groups:
  - **Bridge** (= dashboard / wire topology — the home)
  - **Inbox** (with sub-items: All / New / Needs review / Failed / Sent)
  - **Workbench** (Upload, Drafts)
  - **Library** (Suppliers, Buyers, Item codes, Rules, Output templates)
  - **Operations** (Deliveries, Connectors, Webhooks)
  - **Settings**
- Active item: 2px link-gradient strip to the left, slightly raised navy surface, white text. Inactive: `navy.text` with low-opacity icon.
- Footer: green dot + "Bridge healthy · 12/min".

### Topbar (navy)

- Breadcrumbs left, cmd-K search center-right, notifications + help + avatar far right.
- **Link-spine** at the bottom edge (2px blue→green gradient). Animates left-to-right when an order advances a stage (see motion §8).

### Main work area

- ~~Wraps the order-handling pages in an **EdgeRails** component (left rail blue, right rail green, port markers at top).~~
- ~~Marketing/auth/settings pages do **not** use edge rails — they are calm and centered.~~

> **Struck 2026-08-13.** There is no `EdgeRails` component and never was; nothing wraps the work area
> in rails. The distinction these two bullets were drawing — order-handling screens read as
> directional, marketing/auth/settings read as calm and centered — survives, but it is expressed by
> **panel order and labels** on the order screens, not by rails.

---

## 5. Required screens

### 5.1 Bridge (Home / Dashboard)

> **Demoted 2026-08-13.** This section opened "The product's signature screen. **A live network
> diagram, not a grid of cards.**" The wire diagram is **not** the dashboard hero — it is a
> **"System map" tab** on `/bridge`. The dashboard leads with the queue and the KPI strip. Read the
> canvas spec below as the spec **for that tab**; its construction rules are unchanged and still
> correct. Also note the title: **"Order topology" must not ship as a user-facing heading** — the
> shipped titles are "Dashboard" (browser) / "Overview" (hub tab), owned by `src/lib/pageTitles.ts`.

**Layout:**
- Top: page header — date range pill, period segmented control (Today / 7d / 30d / Quarter), "Export report" button.
- The **Wire Topology canvas**, on the "System map" tab (~580px tall).
  - Buyer ports rendered as labeled rounded rectangles down the left edge (~6 visible). Each shows buyer name + short code + volume (e.g. `412/wk`).
  - Supplier ports rendered the same down the right edge (~5 visible).
  - Wires drawn as cubic Bezier curves between them. **Stroke width = volume bucket**, **stroke = `link-spine` gradient** (or `link-spine → amber` for at-risk lanes).
  - Travelling pulse: a small white circle with green stroke animates along each active wire using CSS `offset-path`. 6s loop, staggered per wire.
  - Alert badges sit mid-wire where exceptions cluster.
  - Legend in the top-right shows the volume bucket → stroke-width mapping.
  - Clicking a wire opens a lane detail drawer.
- Below the canvas: a **5-column monumental KPI strip**.
  - Numbers in `display` font, weight 600, letter-spacing `-0.035em`, sized 36–48px.
  - Sub-line: trend (`+18% vs prev`, `−22%`, `4 urgent`) in semantic color.
  - First card has a `link-spine` top edge.
- Below KPIs: two columns —
  - **In transit · last 10 minutes** — dense compact list of orders currently moving (PO, buyer, supplier, file chip, stage name colored by stage).
  - **Supplier health** — five suppliers with acceptance % bars (green ≥95, amber 85–95, red <85).

### 5.2 Inbox (queue view)

- Header: "Inbox", count, sync state.
- **Time-strip ribbon** at the top: horizontal bar showing volume over 24h with a brushable selection (visual flourish — implement progressively).
- Status filter chips (All / New / Needs review / Ready / Sent / Failed) using the brand-blue tint when active.
- Dense table: Status (5-node mini-track preview, no big pill) · Received · Source (file-type chip) · Buyer · Supplier · PO # · Lines · Value · Exceptions · Assigned · Updated. 36px row height. ≥30 rows above the fold.
- Click row → opens the **order review** as a full-page route (not a drawer — operators want the keyboard). **Struck 2026-08-13:** this said "**Canonical Spine review**"; that screen was deleted. The full-page-not-drawer rule is unchanged.

> **Added 2026-08-13.** The shipped Inbox has a real direction column that this spec never asked for
> and that now carries the buyer→supplier orientation the struck edge rails were meant to:
> `src/components/bridge/InboxView.tsx` (`id: "lane"`), header text from
> `src/hooks/useOrderDirection.ts` — `"Buyer → Supplier"` outbound, `"Customer → You"` inbound — with
> the buyer name in blue, a `→` glyph, and the supplier name in green.

### 5.3 ~~Canonical Spine Review (the showpiece)~~ — STRUCK 2026-08-13

> **STRUCK 2026-08-13. Do not build this screen from this section.**
>
> `src/components/bridge/CanonicalSpine.tsx` had **zero importers** and was deleted, along with its
> `spine: 3px` spacing token. `SpineReview` was deleted earlier (commit `3520ed4`). Edge rails, which
> this section wraps the body in, were never built at all.
>
> **The shipped order review** is `src/app/(app)/inbox/[orderId]/page.tsx` →
> `src/components/bridge/workshop/OrderWorkshop.tsx` →
> `src/components/bridge/mapper/MapperWorkbench.tsx` (`variant="order"`). Three panes, left → right:
>
> | Position | Pane | Heading | Dot |
> |---|---|---|---|
> | Left | `IncomingPane` | **"What we received"** | blue `#1E66C9` |
> | Middle | `OutgoingPane` | **"What we'll send"** | green `#2E8E3A` |
> | Right | `MapperPreviewPane` | **"Live preview"** | green `#2E8E3A` |
>
> One buyer column, then two supplier columns — **not** a symmetric blue-left / green-right pair.
> Below `lg`, `MobileTriage` stacks the same three in the same order.
>
> **What survives from this section and is still required:**
> - The source document stays **visible on the left** during review. Never a modal, never a wizard
>   step that replaces it. (See `09-trust-rules.md` Rule 4.)
> - Full-page route, not a drawer.
> - Buyer refs in blue mono, supplier/output refs in green mono.
> - Confidence chips with the thresholds in `04-color.md`.
> - A sticky action bar with the grand total and one primary "Send to supplier".
>
> Everything below is preserved so a reader can see **what** was struck.

~~This is the most important screen in the product.~~

~~**Page header (above edge rails):**~~ — there are no edge rails
- Back arrow · buyer card (name, file chip, source filename) · **stage bridge graphic** with current stage highlighted (1m-tall horizontal SVG: parse → normalize → validate → transform → deliver, dots filled green for done, blue + pulsing for active) · supplier card (name, output file chip, channel) · "Save draft" / "Send to supplier" buttons.
- Primary button uses navy bg, white text, with a 12px link-gradient swatch on the right.

~~**Body (wrapped in EdgeRails):**~~ — **struck**, no EdgeRails exists

~~3-column grid: **35% · 30% · 35%**, all aligned to the spine.~~ — **struck**, there is no spine to
align to; the shipped grid is `MapperWorkbench`'s.

~~**Left column — Source · Document Anatomy**~~ — **narrowed**: the document pane ships, the zone overlay does not
- The source PDF/spreadsheet rendered inside a light grey panel. **(Ships —
  `src/components/bridge/document/`.)**
- ~~Overlay rectangles tag the anatomy zones — Header / Parties / Terms / Lines / Totals — with the zone outlined in green if confidence ≥ 90, amber if 70–90, red below.~~ **Struck** — needs backend provenance, separate packet.
- ~~Each zone has a small label OUTSIDE the document (in the margin to the left) showing zone name + field summary + confidence chip.~~ **Struck.**
- ~~Hovering a zone highlights the corresponding spine node (and vice versa).~~ **Struck** — no zones, no spine nodes.

~~**Center column — Canonical Spine**~~ — **STRUCK**, deleted with zero importers
- ~~A vertical 3px `link-spine` line down the column.~~ (The `link-spine` **token** is not struck — it still paints the 2px topbar line.)
- ~~Each canonical field is a "node": a 13px white circle on the spine + a card to the right of the spine with label, value, confidence chip, optional hint.~~
- ~~Each node has small dashed connector stubs — one to the left (source ref label) and one to the right (output path label).~~
- Source ref labels are in **brand blue mono** (e.g. `header`, `parties.billTo`, `lines.4`). **(Kept — the colour/type rule still holds on the shipped mapped-field rows.)**
- Output ref labels are in **brand green mono** (e.g. `Order/@orderID`, `BillTo/Address`, `ItemOut[3]`). **(Kept.)**
- Fields below confidence thresholds get amber or red field backgrounds. The hint text appears under the value in amber. **(Kept.)**
- ~~The Lines node expands inline to show the top 3 lines with mapped supplier SKUs (green) or unmapped/AI/error states.~~
- ~~Grand total node uses the display font at 16px.~~ (The grand total is still the one display-font number on the screen — it is just not a spine node.)

**Right column — Output preview**
- A dark-navy panel showing the supplier-ready output (cXML by default, tabs for CSV / JSON if the supplier template enables them).
- Syntax-highlighted (use `shiki` or `prismjs`).
- AI-mapped lines have a violet left-border accent + a small "← AI mapped 84%" trailing comment.
- Error lines have a danger left-border accent + a small "← will be rejected" comment.
- Sticky toolbar: file type tabs · "Show diff vs source" toggle · "Copy" / "Download" buttons.

**Issues rail (collapsible, 280px to the right of the output column):**
- Errors, Warnings, AI suggestions grouped. Each card shows a confidence chip and a "Jump to field" action that scrolls to and highlights the matching field.

> **Struck 2026-08-13 — target only.** The jump action used to "scroll the spine + highlight the
> matching node and source zone". There is no spine node and no anatomy zone. Jump-to-field is still
> required (`09-trust-rules.md` Rule 1); it targets the mapped-field rows in `MapperWorkbench`.

**Action bar (sticky bottom):**
- Grand total · output template · "Save draft" · primary "Send to supplier" with a confirm dialog ("I've reviewed the 3 issues. Send to Acme.")

### 5.4 Upload Workbench

- Dropzone card centered (~720px) with file-type chips. Accepts PDF, XLSX, CSV, XML, cXML, EDI, JSON, EML.
- Pipeline picker form: buyer · supplier · output template · mode (auto-process / stop after extraction).
- Auto-process toggle is a **deliberate per-supplier setting** with a visible audit trail — never enabled by default for a new supplier.
- Recently uploaded files list below.

### 5.5 Mapping Editor

- Buyer ↔ supplier code mapping list. Each row: buyer code (blue mono) → arrow → supplier code (green mono) → description → confidence bar → used count / source (Manual / AI / Imported).
- Inline editing, CSV import/export, supplier filter.
- Detail drawer for any selected mapping: history of changes, transformation rule chips (e.g. "strip leading zeros", "uppercase", "UoM map CN → EA").

### 5.6 Validation Rules

- Library of supplier/buyer/global rules.
- Card-grid OR list (toggleable). Each rule: name, scope, severity (Error/Warning/Info), 30-day trigger count.
- Detail page: visual rule builder — left "When" (field selector + operator + value), right "Then" (severity + message + auto-fix). No raw code for MVP.

### 5.7 Delivery log (audit timeline) — shipped title "Deliveries", `/operations/log`

- Append-only timeline of events per order: `received`, `parsed`, `extracted`, `mapped`, `validated`, `human-edited`, `transformed`, `delivered`, `failed`, `retried`.
- Each entry: actor (user / system / AI / supplier), timestamp, order link, expandable payload-diff drawer.
- Right panel metrics: orders today, avg cycle time, exception rate by supplier, top failing rules.

### 5.8 Supplier / Buyer profile pages

- Header: name, total orders, avg cycle, exception rate.
- Tabs: Overview · Mappings · Rules · Output templates · Connectors · History.
- Each tab is a focused list. No marketing hero.

### 5.9 Connectors

- Top: a small **wire-topology overview** for connectors — same visual language, smaller scale. Email inboxes, SFTP, API endpoints, cXML PunchOut, webhook outs.
- Below: tables per channel with health (last successful poll, errors in 24h).

### 5.10 Auth

- Single sign-in card, centered, on a `bgWarm` background. Left: System Identity mark + tagline. Right: email/password + SSO. Clerk handles the actual auth.

---

## 6. Component library (build these in `components/` first)

### Signature components

> **Struck 2026-08-13.** Two entries in this "build these first" list were never built. Building them
> now would be building backwards.

- ~~`<EdgeRails>` — wraps the work area, draws blue + green vertical rails with port markers.~~ **STRUCK — do not build.** Never existed in `src/`; CSS and tokens deleted for zero consumers.
- `<WireTopology>` — buyer ports / supplier ports / animated wires. Props: `buyers`, `suppliers`, `wires` (each with `b`, `s`, `weight`, `health`, `alert?`). SVG-driven with CSS `offset-path` animation. **Real — but it lives on a "System map" tab, not as the dashboard hero.**
- ~~`<CanonicalSpine>` — vertical spine layout with `<SpineNode>` children. Each node: `id`, `label`, `value`, `pct`, `tone`, `srcRef`, `outRef`, `hint?`, `subnodes?`.~~ **STRUCK — do not build.** Deleted with zero importers. The shipped review is `OrderWorkshop` → `MapperWorkbench`.
- `<DocumentAnatomy>` — wraps any rendered source and presents it to the operator. **Narrowed:** the document pane ships (`src/components/bridge/document/`); ~~"overlays zone rectangles + per-zone confidence chips"~~ does **not** — it needs backend provenance. Note the renderers named here also drifted: PDF is `pdfjs-dist` as specified, but spreadsheets are read in-browser by `src/lib/sheetPreview.ts` (no `react-data-grid`) and there is no syntax highlighter.
- `<XCard>` — primary card with cross-section edge strip. Props: `edge="left|right|top|bottom"`, `color="buyer|supplier|bridge"`.
- `<StatusJourney>` — 5-node mini-track showing Parse → Normalize → Validate → Transform → Deliver. Props: `stage` (0–4), `compact?`.
- `<LinkSpine>` — 2px blue→green gradient line. Props: `animated?` (left-to-right fill on state change), `soft?`.
- `<MonumentNumber>` — display-font KPI. Props: `value`, `label`, `sub`, `accent`, `size`.
- `<LinkedPair>` — buyer card ↔ connector wire with node ↔ supplier card lockup.

### Primitives (extend shadcn/ui)

- `<Button>` — variants `primary` (navy bg) / `secondary` / `ghost` / `danger` / `ai` (violet). Never gradient.
- `<StatusPill>` — semantic colors (use sparingly; prefer `<StatusJourney>`).
- `<FileChip>` — uppercase tag, file-format colored (PDF red / XLSX green / cXML violet / EDI amber / CSV slate / EMAIL grey / API green / JSON gold).
- `<DataField>` — label + value + optional confidence chip + revert button + source-link popover.
- `<ConfidenceChip>` — pct + threshold color (≥90 green, 75–89 amber, <75 red).
- `<AiSuggestion>` — violet left-bar, "AI" tag, Accept/Edit/Reject. Confidence always visible.
- `<Drawer>` — slides from right; push-not-overlay; cmd+\ toggles width.
- `<CommandPalette>` — cmd+K, fuzzy across orders, suppliers, SKUs, named actions.
- `<EmptyState>` — illustration-free. Headline + sub + primary action.

---

## 7. Logo & identity system

Use the **System Identity** mark (Direction 3 from the canvas exploration): the brand is not just a logo, it's a shape language. The mark is one expression. Other expressions live in the product:

- ~~**Rail markers** at the top of edge rails use the same geometry.~~ **Struck 2026-08-13** — edge rails were never built, so there are no rail markers.
- ~~**Spine nodes** use the same circle-on-gradient construction.~~ **Struck 2026-08-13** — `CanonicalSpine.tsx` was deleted with zero importers.
- **Loading state** is the mark itself completing its link — never a generic spinner.
- **Pipeline glyphs** (parse / normalize / validate / transform / deliver icons) are a family of stage icons in the same construction.

Provide the mark in three sizes (16 / 24 / 64) and in mono (white-on-navy) form. Use the mono form in the sidebar and topbar.

---

## 8. Motion language

Six patterns, each with **one job in the product**. All respect `prefers-reduced-motion`.

| Pattern | When | Behavior |
|---|---|---|
| Link-spine activation | Order advances a stage | The 2px topbar spine fills left→right over 1.2s. |
| Wire-topology travellers | Always (subtle) | Tiny white-dot pulses move along active wires using CSS `offset-path`, 6s loop, staggered. |
| Status node pulse | Stage activates on the current order | The active node in `<StatusJourney>` pulses once with a brand-color ring. |
| Connector draw | Mapping saved/accepted | The buyer-SKU ↔ supplier-SKU line draws blue→green via stroke-dashoffset, 0.8s ease-out. |
| Validate-to-deliver flush | "Send to supplier" clicked | Status journey advances stage by stage in 40ms stagger; output preview gets a single subtle highlight. |
| Empty-state link-close | Hovering a placeholder card | The mark's link completes its loop. Invites the action calmly. |

**Motion budget:** loops max 6s · no motion above the action bar during keyboard navigation · disable all wire-topology animation under `prefers-reduced-motion: reduce`.

---

## 9. Copy guidelines

### Marketing
- H1: *"Buyers on one side. Suppliers on the other. We are the bridge."*
- Sub: *"ProcuLink turns messy purchase orders into supplier-ready outputs. Upload Excel, PDF, cXML or EDI orders, review only exceptions, deliver clean."*
- Primary CTA: *"Start free"* · Secondary: *"Watch the walkthrough →"*
- Stat block: state real, checkable facts (formats in · suppliers reached · channels · avg time to
  delivery). Do not invent percentages or per-order prices — see CLAUDE.md §14 (Group J2 (e)).

### App
- Dashboard title: *"Dashboard"* (browser) / *"Overview"* (hub tab). "Order topology" is the
  internal name of the wire diagram and must not ship as a heading.
- Order detail primary action: *"Send to supplier"*.
- Stage labels: *Parse · Normalize · Validate · Transform · Deliver*.
- Empty inbox: *"No orders yet. Drop a file, or connect a channel that receives them."*
- AI suggestion CTAs: *"Accept" · "Edit" · "Reject"* — never "Apply magic" or sparkles.
- Confirm dialog: *"I've reviewed the 3 issues. Send to Acme."* (checkbox + recipient + total + retry behavior visible).
- Success toast: *"Delivered to Acme · accepted · 1m 42s"*.

Shipped titles are owned by `src/lib/pageTitles.ts`; the approved word list is
`src/lib/vocabulary.ts`, enforced by `bun run lint:vocab`. Read those, not this list.

### Vocabulary

> **Corrected 2026-08-09.** This section previously prescribed the bridge metaphor as product
> vocabulary and told implementers to write *"Cross the bridge →"* instead of *"Send"*. That is
> backwards: the founder purged the metaphor from user-facing copy (CLAUDE.md §9), and
> *"Send to supplier"* is what shipped
> (`src/components/bridge/mapper/MapperWorkbench.tsx:1005`).

- **A user reads:** order · supplier · buyer · item code · order layout · output · delivery ·
  rule · issue · workspace.
- **Internal only** — component names, CSS/design tokens and route names, never a visible string:
  *bridge* (`/bridge`) · *crossing* (`CrossingsLog.tsx`) · *dock* (`SupplierDockProfile.tsx`) ·
  *lane* (`LaneDrawer.tsx`) · *spine* (`bg-link-spine` **only** — ~~`CanonicalSpine`~~ was deleted
  2026-08-13 with zero importers; `bg-link-spine` / `--gradient-link-spine` is the 2px topbar
  gradient line and still ships) ·
  *anatomy* (`DocumentAnatomy.tsx`) · *wire* (`WireTopology.tsx`).

---

## 10. Trust rules (designed in, not aspirational)

1. **Provenance everywhere.** Every AI suggestion shows confidence + source attribution + a one-click "show me where this came from in the source file" that highlights the matching anatomy zone.
2. **No silent automation.** Auto-process is a deliberate per-supplier toggle with a visible audit trail in the delivery log. Never default.
3. **Failure is loud, recoverable, and explained.** The Failed view must be the most useful screen in the product — not a tombstone. Every failure shows: what the supplier said, what we sent, what we'd retry, and a one-click "fix and resend" path.

---

## 11. Tech stack alignment

- **Framework:** Next.js 15 App Router. NO Pages Router. NO Vite.
- **Language:** TypeScript.
- **Styling:** Tailwind, theme tokens above. shadcn/ui primitives **restyled** to the Bridge Layer system — no out-of-the-box shadcn look.
- **Data:** TanStack Query for fetching, TanStack Table for the Inbox grid (virtualized > 100 rows).
- **Auth:** Clerk.
- **Backend contract:** ASP.NET Core API. Postgres. Type all DTOs from the OpenAPI schema (use `openapi-typescript` or the project's existing codegen).
- **File rendering:** `pdfjs-dist` (PDF), `react-data-grid` (spreadsheets), `shiki` (XML/cXML/EDI syntax).
- **Mock data:** MSW handlers for every endpoint so the entire UI is browsable offline. Seed: 50 orders across 6 suppliers and 4 buyers, 8 file-format examples, 200 SKU mappings, 12 validation rules, 30 days of delivery-log events.
- **Hosting:** Vercel (frontend) + Railway (backend).

### Route structure (App Router)
```
app/
  (marketing)/
    page.tsx                    # hero
    pricing/page.tsx
    customers/page.tsx
  (auth)/
    sign-in/[[...sign-in]]/page.tsx
  (app)/
    layout.tsx                  # navy sidebar + topbar
    bridge/page.tsx             # dashboard; wire topology is a "System map" TAB, not the hero
    inbox/page.tsx
    inbox/[orderId]/page.tsx    # order review, full page — OrderWorkshop -> MapperWorkbench
                                # (was "canonical spine review" — STRUCK 2026-08-13)
    upload/page.tsx
    drafts/page.tsx
    library/
      suppliers/page.tsx
      suppliers/[id]/page.tsx
      buyers/page.tsx
      mappings/page.tsx
      rules/page.tsx
      templates/page.tsx
    operations/
      log/page.tsx
      connectors/page.tsx
      webhooks/page.tsx
    settings/page.tsx
```

---

## 12. Build order (do these in order, ship in slices)

> **Struck 2026-08-13.** Steps 1 and 4 of this build order specify the two struck signatures. **This
> ordering is not a plan to follow.** The product is already built; this section is history.

1. **Tokens + shell.** Tailwind config, navy topbar with link-spine. ~~`<EdgeRails>`~~ — **struck, never built**. ~~navy sidebar~~ — the 220px sidebar is **not desktop chrome**; desktop nav is in the topbar and the sidebar renders only in the mobile drawer.
2. **System Identity mark** in all sizes + mono.
3. **Inbox** with mocked TanStack Table. Status journey preview in row.
4. ~~**Canonical Spine Review** at `/inbox/[orderId]`:~~ — **STRUCK.** The shipped review is `OrderWorkshop` → `MapperWorkbench`.
   - Page header bridge graphic
   - ~~3-column body with EdgeRails wrap~~ — **struck**, no EdgeRails
   - `<DocumentAnatomy>` with PDF rendering ~~and zone overlays~~ — **narrowed**, no zone overlays
   - ~~`<CanonicalSpine>` with 9 sample nodes~~ — **struck**, deleted
   - Output preview ~~with shiki-highlighted cXML~~ — the shipped preview has no syntax highlighter; it marks the just-changed line (`previewHighlightModel.ts`)
   - Issues rail
   - Sticky action bar
5. **Bridge dashboard** at `/bridge`:
   - `<WireTopology>` with offset-path animated wires — **on the "System map" tab, not as the hero**
   - Monumental KPI strip
   - In-transit list + supplier health
6. **Upload Workbench**, **Mapping Editor**, **Validation Rules**, **delivery log**.
7. **Marketing pages** with the bridge hero illustration (separate route group).
8. **Motion layer** — implement the six patterns from §8 last, so they layer cleanly over a working app.

---

## 13. Acceptance criteria

The build is done when:

1. A user can land on `/bridge`, open the **"System map" tab**, see the wire topology with travelling pulses, click a wire, get a supplier-flow detail drawer, and jump from there into a specific order's review without losing context. **Struck 2026-08-13:** the wire topology is not on landing (it is a tab), and the destination is not a "Canonical Spine review" (that screen was deleted) — it is `OrderWorkshop` → `MapperWorkbench`.
2. The user can drop a PDF on Upload, watch the pipeline stages, land in the **order review** with at least 3 flagged exceptions, accept 2 AI mapping suggestions, fix one quantity, and click "Send to supplier" to see the resulting output on screen — all without leaving the keyboard. **Struck 2026-08-13:** "From the Spine review … land in a Spine" — there is no Spine. The criterion itself is the right one and still worth testing.
3. The Inbox renders 1,000 mocked orders at 60fps with full sort/filter/bulk-select.
4. Every screen has a thoughtful empty state, loading skeleton (using the link-close motion, not a spinner), and error boundary.
5. Cmd+K opens a working command palette indexed across orders, suppliers, SKUs, and named actions.
6. Light theme only for v1; tokens structured so a dark theme can be added later by swapping the neutral scale.

---

## 14. Anti-patterns (refuse to build)

- Big editorial serif inside the app (kept for marketing accents only).
- Decorative gradient backgrounds, sparkle icons, illustrated mascots, glassmorphism.
- Modals when a drawer or inline editor will do.
- Modal wizards that hide the source file during review.
- "Good morning, Maria" greetings on the dashboard. Operators want the queue.
- Auto-applying AI corrections without a visible accept step.
- Notched corners everywhere — use `<XCard>`'s cross-section edge as the primary signature instead.
- The directional-field background gradient on every screen — keep it only for marketing hero areas.
- Per-screen color themes. One token system across the entire product.
- Hand-rolled icons that don't share the System Identity construction language.

---

**End of brief.**

> ## ⚠ Struck 2026-08-13 — this was the single most dangerous line in the handoff
>
> The original closing instruction read:
>
> > ~~Start with §12 step 1 (tokens + shell + EdgeRails) and step 4 (Canonical Spine Review). Those
> > two prove the whole design system. Everything else is downstream.~~
>
> **Both named starting points were never built.** `<EdgeRails>` has never existed in `src/` and its
> CSS and tokens were deleted for having zero consumers; `CanonicalSpine.tsx` was deleted with zero
> importers. An agent that followed this line did not prove the design system — it built two things
> the product does not have, and every screen designed against them inherited the fiction.
>
> **Do not start here. Start at `CLAUDE.md` §2 in the repo root**, which states what actually ships.
> The order review is `src/app/(app)/inbox/[orderId]/page.tsx` → `OrderWorkshop` →
> `MapperWorkbench`. What this file is still good for is its **token, type, colour, copy and motion
> detail** — not its spatial architecture, screen specs, build order or acceptance criteria.
