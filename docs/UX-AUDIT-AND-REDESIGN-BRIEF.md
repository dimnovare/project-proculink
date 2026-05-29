# ProcuLink — Frontend UX Audit & Whole-Product Redesign Brief

**Date:** 2026-05-29
**Purpose:** A self-contained handoff for a full frontend UI/UX redesign. Usable by a
designer, by Claude Design, or by an engineer. It captures (a) what ProcuLink is,
(b) the locked visual direction and tokens, (c) every screen and its current state,
(d) the concrete UX problems found in a live walkthrough, and (e) the redesign goals
and per-area direction. Nothing here requires repo access to understand, but pointers
to canonical sources are included.

**Live app:** https://project-proculink.vercel.app · **Stack:** Next.js 15 (App Router),
TypeScript, Tailwind, shadcn/ui, bun, Clerk auth, TanStack Query, Vercel.

---

## 1. Product in one page

ProcuLink is a **B2B outbound procurement bridge**. Buyer/procurement teams need to send
purchase orders to many suppliers, each in that supplier's required **format** (CSV, XLSX,
PDF, cXML, UBL/XML, EDIFACT, X12) and **delivery channel** (HTTP/webhook, SFTP, email, ERP
connector). ProcuLink ingests an order in any shape and delivers it in the shape each
supplier requires.

**Core mental model (surface this everywhere):**
`Parse → Normalize → Validate → Review exceptions → Transform → Deliver → Learn`

**Spatial metaphor (the "Bridge Layer"):** buyers on the **left**, suppliers on the
**right**, ProcuLink is the **bridge** in the middle. Orders "cross" from buyer to supplier.

**Positioning:** aiming to be the international standard for outbound PO routing — deep and
dense enough for 30-year procurement veterans (standards visibility, raw envelopes,
keyboard control) **and** effortless for first-time users (wizard, per-industry templates,
AI mapping suggestions with visible confidence).

**First ICP:** buyer/procurement teams sending POs out. The UI must let them see:
which orders are ready to send · which supplier-specific mapping/validation issue blocks a
delivery · which channel will be used · whether delivery actually succeeded · what changed
and who approved it. **Never imply an order is "sent" just because an artifact was
generated** — use explicit states: `ready_to_deliver`, `delivering`, `delivered`,
`delivery_failed`.

---

## 2. Hard constraints (so redesigns stay implementable)

- **Next.js 15 App Router only.** Server Components by default; `'use client'` only when
  needed. No Pages Router, no `react-router-dom`, no `react-helmet`. `bun` only (never npm).
- **Tailwind + shadcn/ui**, restyled through Bridge Layer tokens. Reuse existing
  `src/components/bridge/*` primitives before inventing new ones.
- **One great experience** — NOT a "default/expert" mode toggle. Smart defaults +
  progressive disclosure + a Command Palette (`Cmd+K`) for power features. (Linear / Stripe
  / Notion / Vercel / Railway model.) No `localStorage` user-mode flags.
- **Standards-visibility rule:** any field in a mapping/transform context must be able to
  surface its UBL / EDIFACT / X12 / cXML / Peppol BIS / ISO 20022 mapping on demand (info
  popover or a per-screen "Show standards" disclosure) — never gated behind a mode.
- **Trust rule:** every AI suggestion shows confidence + provenance + Accept / Edit / Reject.
  AI violet is used **only** for AI-generated content, never decoration.
- **No** generic SaaS hero cards, purple gradients, glassmorphism, or decorative blobs.
  Motion communicates state, not flair; respect `prefers-reduced-motion`.

---

## 3. Locked visual direction — "The Bridge Layer"

Canonical source of truth lives in `ProcuLink/docs/design-system/` (Direction 4 — The
Bridge Layer, supported by Direction 3 — System Identity). Key files: `02-tokens.md`,
`03-typography.md`, `04-color.md`, `05-components.md`, `09-trust-rules.md`, `showcase.html`.
A redesign should **execute this direction more clearly**, not replace it.

### Color
| Role | Hex |
|---|---|
| App chrome / dark surfaces / primary text | Navy `#0B1A2F` |
| Work-area background | `#F6F7FA` (surfaces `#FFFFFF`) |
| Primary / buyer rail / active | Blue `#1E66C9` (link `#0F4FA8`) |
| Success / supplier rail / delivered | Green `#2E8E3A` |
| Borders / hairlines | `#E2E6EE` |
| Muted text | `#56627A` / `#8A93A5` |
| Warning / review | Amber `#C97A14` |
| Error / failed | Red `#C53A3A` |
| AI suggestions only | Violet `#6F4FCE` |

### Type
- **Bricolage Grotesque** — display & headings (tracking ~`-0.02em`), monumental KPI numbers.
- **Inter** — body & UI.
- **JetBrains Mono** — PO numbers, codes, endpoints, raw envelopes.

### Shape & signatures (non-negotiable)
- Edge rails: **blue buyer rail left, green supplier rail right.**
- **Wire Topology** dashboard: buyers left, suppliers right, wires between them. (A traveller/pulse dot must always sit on a real rendered wire path — never a floating dot.)
- **Canonical Spine review:** source document → canonical spine → supplier output, three columns.
- **Document Anatomy:** labeled source zones with confidence/provenance.
- Primary cards carry a **3px blue/green cross-section edge.**
- **2px gradient "link-spine"** (blue→green) under topbars / as section dividers.
- **StatusJourney** — the 5-node pipeline (Parse · Normalize · Validate · Transform · Deliver) is the primary status visual everywhere.
- `rounded-[6–8px]` cards, 1px `#E2E6EE` borders, subtle shadows. Navy chrome, light work area.

---

## 4. Screen inventory & current state

### Marketing (public)
| Route | Purpose | State |
|---|---|---|
| `/` | Landing | OK |
| `/pricing` | Plan ladder (Pilot/Growth/Operations/Integration/Enterprise) | OK |
| `/how-it-works`, `/customers`, `/security`, `/privacy`, `/terms`, `/dpa`, `/subprocessors`, `/support`, `/one-pager`, `/watch`, `/welcome` | Supporting | OK |
| `/help` + `/help/{first-upload,mapping-basics,delivery-config,email-polling,troubleshooting}` | Help center | **Needs redesign** — index is visually flat; **article pages render completely unstyled** (raw flush-left text). |

### App (authenticated; navy sidebar + topbar)
| Route | Purpose | State |
|---|---|---|
| `/bridge` | Dashboard — Order topology, onboarding checklist, KPIs, In-transit, dock health | Time filters (Today/7d/30d/Quarter) + Export report not wired; several "Coming with usage metering" placeholder KPIs; topology shows "No supplier wires yet" even with data; onboarding card cramped. |
| `/inbox` | Order queue (table, filter chips, bulk select) | **Clicking a filter chip hard-freezes the page** (renderer lockup). Sidebar status sub-links were broken (fixed). |
| `/inbox/[orderId]` | Canonical Spine review (resolve exceptions, cross the bridge) | Core flow; verify after inbox freeze fix. |
| `/upload`, `/upload/preview/[orderId]` | Upload + parse preview | OK; entry to the pipeline. |
| `/library/suppliers` · `/library/suppliers/[id]` | Supplier list / detail (Overview · Mappings · PO Mapping · Delivery) | PO-Mapping was CSV-only manual form → **being redesigned to magic auto-map**. Stale "Phase 4 Group C" tabs removed. KPIs empty in real mode. |
| `/library/{buyers,mappings,rules,templates,standards}` | Reference libraries | Functional; density/polish pass wanted. |
| `/inbound/{invoices,asns}` | Inbound invoices / ASNs | ASN had two Upload buttons (fixed). |
| `/operations/{log,connectors,webhooks}` | Delivery log, connectors, webhooks | Log export wired (fixed); webhook event types fixed; connectors mostly empty-state. |
| `/settings` | Org settings, billing, email config, API keys, connectors | Dense; polish pass wanted. |
| `/sign-in`, `/sign-up` | Clerk auth | OK. |

---

## 5. UX audit — concrete issues from a live walkthrough (2026-05-29)

### Fixed in this pass (branch `feat/ui-ux-overhaul`)
1. **#2** Inbox sidebar `?status=` links did nothing (page ignored the param) and showed stale counts → removed the duplicate sidebar filters; the top chips are the single filter.
2. **#3** Top-bar "bell" did nothing and showed a fake unread dot → removed (Help "?" covers support).
3. **#5** Delivery-log "Crossed" used a double-arrow glyph → single arrow.
4. **#11** Supplier "Rules / Output templates / Connectors / History" tabs showed "Coming soon in Phase 4 Group C" → removed (features live globally).
5. **#12** Delivery-log "Export log" was inert → real CSV download.
6. **#13** Webhook "Add" offered event types the API rejects (`crossing.*`) → now `order.created/delivered/failed`.
7. **#14** ASN page had two "Upload ASN" buttons → one.

### Open / in progress
- **#9 Inbox freeze (highest severity):** clicking a status filter chip locks the renderer. Likely an infinite render loop in the queue table interaction. Makes the inbox (and its Sync/Upload/New-order/Bridge-view buttons, **#8**) feel "dead."
- **#6** `/bridge` time filters (Today/7d/30d/Quarter) and **Export report** are not wired.
- **#1** Dashboard "Get your first order automated" onboarding card is cramped and loses the hierarchy contest with an empty "No supplier wires yet" panel — even when orders exist.
- **#4** Help center redesign (in progress, dedicated worktree).
- **#10** PO-mapping → magic auto-map redesign (in progress; new backend endpoints `GET .../mapping/source-columns` and `POST .../mapping/suggest-fields` support it).
- **#7 / #15** Overall: "must be better, simpler, faster."

### Other observations
- Topology empty state ("No supplier wires yet") is inconsistent with the data shown directly below it (In-transit orders) — empty-state logic needs to reflect real state.
- Several dashboard KPIs read "Coming with usage metering" / "—" — they look unfinished; either populate, hide, or label as forecast.
- Supplier detail KPIs (Total orders / Avg cycle / Exception rate / Health) are all "—" in real mode.
- **Pre-launch note:** the production deployment currently uses Clerk *development* keys — fine while pre-launch, swap to production keys before go-live (Vercel env var; not a code change).

---

## 6. Redesign goals & principles

1. **Better, simpler, faster** — fewer controls per screen, obvious primary action, no dead/placeholder UI, snappy perceived performance (skeletons, optimistic states, no layout shift).
2. **One great UX** — smart defaults + progressive disclosure + `Cmd+K`. No mode toggles.
3. **Trust for veterans** — standards mappings on demand, raw view (JSON/XML/EDI) on any artifact, visible confidence + provenance on every AI suggestion, append-only audit.
4. **Ease for first-timers** — onboarding wizard, per-industry templates, AI-prefilled fields, outcome-named copy ("Send this order to your supplier", not "Run the transform job").
5. **The bridge metaphor is the brand** — rails, wire topology, canonical spine, the 5-stage journey. Lean into it; it's what makes ProcuLink legible and distinct.
6. **Honesty** — explicit delivery states; never fake data, fake badges, or "coming soon" stubs in the shipping UI.

---

## 7. Per-area redesign direction

- **Dashboard (`/bridge`):** make the Wire Topology the hero (buyers→bridge→suppliers with live wires). Fix the empty-state logic. Make time filters + Export real or remove them. Give the onboarding checklist a clear, self-contained card that graduates away once complete. KPIs: show real numbers or honest forecasts, not "coming with metering."
- **Inbox (`/inbox`):** fix the freeze first. One clear filter row (chips), fast sort, bulk actions, dense-but-calm table, obvious row→review affordance. Strong empty/loading/error states.
- **Review (`/inbox/[id]`, Canonical Spine):** the three-column source→spine→output is the signature moment. Make exception-resolution effortless (AI suggestions inline with confidence + Accept/Edit/Reject), and "Cross the bridge" a confident, explicit delivery action with real status.
- **Supplier detail + PO mapping:** magic auto-map (detect columns for any format → AI/heuristic field suggestions → editable two-column "connect" view with confidence + live preview + standards chips). Populate real supplier KPIs or hide them.
- **Help center:** real help center — searchable, category-organized index; article pages with proper typographic prose, breadcrumb, "was this helpful?", related links. (Fix the unstyled-article bug.)
- **Settings:** group into clear sections (Org, Billing, Email, API keys, Connectors) with progressive disclosure; keep dense but scannable.
- **Marketing:** already solid; keep consistent with the Bridge Layer language.

---

## 8. Suggested phasing

1. **Stop the bleeding (in progress):** dead controls, stale content, the inbox freeze. (Most shipped.)
2. **Two signature redesigns:** Help center, PO-mapping magic auto-map. (In progress.)
3. **Dashboard + Review polish:** topology hero, honest KPIs, exception-resolution flow.
4. **Whole-product consistency pass:** density, spacing, empty/loading/error states, `Cmd+K` coverage, standards-visibility everywhere, perceived performance.

---

## 9. How to use this document

- **For Claude Design / a designer:** treat §3 as the locked visual system (do not invent a
  new direction), §4–5 as the current-state inventory and problem list, and §6–8 as the
  brief. The live app is at the URL above; current-state screenshots were captured during
  the walkthrough and can be provided. Deeper tokens/components are in
  `ProcuLink/docs/design-system/`.
- **For an engineer:** §2 lists the hard constraints; reuse `src/components/bridge/*`.
- **North star:** ProcuLink should feel like the most trustworthy, legible way in the world
  to route a purchase order from any buyer system to any supplier — dense where it must be,
  effortless where it can be, and honest at every step.
