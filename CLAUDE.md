# ProcuLink — Frontend Implementation Guide

This file is the single source of truth for every Claude Code session on this repo. Read it in full before touching any file.

---

## 1. What ProcuLink is

An AI-assisted **outbound procurement bridge** between buyer/procurement teams, suppliers, ERPs, and procurement systems. Ingests buyer-side PO sources (manual upload first, later email/API/SFTP/FTP), normalizes into a canonical PO model, validates against supplier-specific rules, lets a human review only exceptions, and emits clean supplier-ready output.

**Tagline:** *"Connecting Procurement — the missing link between buyers and suppliers."*

**Not:** a chatbot, a PDF parser, a Zapier clone, a marketplace, a CRM.  
**Is:** a vertical integration workbench for B2B order documents and supplier-specific transformation rules.

**Core workflow:** `Parse → Normalize → Validate → Review → Transform → Deliver → Learn`

**First ICP / next-6-week wedge:** buyer/procurement teams sending purchase orders out to many suppliers. They care about supplier acceptance, item-code correctness, delivery channel reliability, audit trail, and reducing manual reformatting.

**Primary users:** procurement operators, purchasing coordinators, and integration specialists who manage supplier-specific PO formats, mappings, and delivery errors. Power users know supplier SKUs, cXML/EDI/API quirks, and approval workflows.

---

## 1.5 Current direction — production hardening

Deep-research review on May 26 2026 confirmed: ProcuLink should now be treated
as a real working product, not a throwaway MVP. Do not add broad engine features
on top of visibly rough UI.

Next work is grouped in the backend repo roadmap:
`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\superpowers\plans\2026-05-26-production-hardening-roadmap.md`.

Frontend-relevant groups:

| Group | Workstream | Status |
|---|---|---|
| **I** | UI/UX production polish + responsive QA | **In progress — topology/mobile pass verified** |
| **J** | Live end-to-end QA + deployment hardening | Planned after I |
| **K** | Standards + engine hardening surfaces | Planned after I/J scoping |
| **L** | Trust, onboarding + commercial readiness | Planned; can overlap after I starts |

Group I must continue unless the user explicitly reprioritizes:
- QA desktop, tablet, and mobile.
- Keep fixing visible Bridge Layer defects with Playwright screenshots before moving to broad engine work.
- Make core flows feel complete: sign-in, first upload, inbox/review, mapping, transform, delivery, settings/billing/email, and error states.
- Only after that, add broader engine surfaces for more standards and output templates.

---

## 2. Visual direction — "The Bridge Layer" (LOCKED)

Direction 4 from the v2 design exploration. **Do not deviate.** This is not styling; it is the architecture of every screen.

**Design workflow:** do not use Lovable for ProcuLink. All UI/UX and design
decisions run through the local design system, `/frontend-design`, and Claude
Design/reference images. The canonical design files live in
`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\design-system`.

For token-efficient sessions, read
`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\design-system\00-agent-quick-brief.md`
first, then load only the specific design docs/components required for the
current page or component.

`/frontend-design` is a quality and execution lens. It must sharpen this locked
Bridge Layer direction, not invent a new aesthetic.

### Five spatial signatures (non-negotiable)

1. **Edge rails.** 4px blue rail on the left edge + 4px green rail on the right of the work area. Port markers at the top of each rail. Blue = buyer / incoming. Green = supplier / outgoing. Renders on every order-handling screen.

2. **Wire Topology dashboard.** Home screen is a network diagram. Buyer ports down the left, supplier ports down the right, with wires between them. Same-lane wires may be straight; cross-lane wires arc. Stroke width = volume. Stroke color = health (blue→green normal, blue→amber at-risk). Shared buyer/supplier ports must fan out so no connection hides another. Gradients must use SVG `userSpaceOnUse` coordinates so perfectly horizontal wires render reliably. Travelling dots animate on the exact same SVG path as the rendered wire and start hidden until their animation begins.

3. **Canonical Spine review.** Order detail is a 3-column ETL view:
   - Left: source document with anatomy zone overlays + per-zone confidence chips
   - Center: vertical spine of canonical field nodes connected by a blue→green gradient line
   - Right: supplier-ready output (cXML / CSV / JSON) syntax-highlighted

4. **Document Anatomy.** Source files always shown with labeled zone rectangles + per-zone confidence. The "x-ray" of the order.

5. **Cross-section card edge.** Primary cards have a 3px brand-gradient strip on one edge (the "wire seen end-on"). Blue strip = buyer. Green strip = supplier. Full gradient = bridge. This replaces decorative borders and notched corners.

### Supporting signatures

- **Navy app chrome / light work area.** Sidebar + topbar = `#0B1A2F`. Main content = warm light `#F6F7FA`.
- **Link-spine.** 2px blue→green gradient line runs across the bottom of every topbar. Animates left→right when an order advances a stage.
- **Status as a journey.** Order status = 5-node mini-track (Parse · Normalize · Validate · Transform · Deliver), not a static pill.
- **Monumental numbers.** KPIs use Bricolage Grotesque weight 600, tight letterspacing.
- **System Identity mark.** SVG glyph: an ellipse (arc) with a blue circle on the left end and a green circle on the right end. Same geometry used for rail markers, spine nodes, loading states, pipeline icons.

---

## 3. Design tokens

All Bridge Layer tokens live as flat Tailwind classes. The `brand.*`, `navy.*`, `bg`, `surface`, `border*`, `ink.*`, `amber*`, `danger*`, `ai*` prefixes are defined in `tailwind.config.ts`.

```
brand.blue     #1E66C9   buyer / incoming / structure / trust
brand.blueDeep #0F4FA8
brand.blueSoft #E3EDFB
brand.green    #2E8E3A   supplier / outgoing / completion
brand.greenDeep #1E6D29
brand.greenSoft #E2F1E2
navy.DEFAULT   #0B1A2F   sidebar + topbar
navy.surface   #10243E   raised within chrome
navy.border    #1C2F49
navy.text      #C5D2E4
navy.muted     #7C8DA6
bg             #F6F7FA   app background
bgWarm         #F8F6F1   marketing surfaces
surface        #FFFFFF
surface2       #EFF2F7
border         #E2E6EE
borderStrong   #C6CDDA
ink.DEFAULT    #0B1A2F
ink.muted      #56627A
ink.faint      #8A93A5
amber          #C97A14
amberSoft      #FAEFD6
danger         #C53A3A
dangerSoft     #FBE3E3
ai             #6F4FCE   ONLY for AI-generated content
aiSoft         #EEE7FB
```

**Fonts:**
- `font-sans` → Inter (body, UI, 13/14px)
- `font-display` → Bricolage Grotesque (KPIs, page titles, marketing)
- `font-mono` → JetBrains Mono (SKUs, code refs, PO numbers)

**Background images (gradients):**
- `bg-link-spine` → `linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)`
- `bg-bridge-deck` → `linear-gradient(90deg, #1E66C9, #2E8E3A)`
- `bg-rail-buyer` → vertical blue fade gradient
- `bg-rail-supplier` → vertical green fade gradient

**Spacing:** 4px base. **Radii:** card-sm 6px / card 8px / card-lg 12px. **Shadows:** avoid heavy drops. Cards use borders + `0 1px 2px rgba(11,26,47,0.04)`.

**Type scale:** body 13/14px · table rows 12/12.5px · KPI display 32–48px · marketing display 60–78px.

---

## 4. App shell architecture

```
┌─ BridgeSidebar (220px, navy) ──────────────────────────────────────┐
│ Logo + wordmark                                                      │
│ Workspace switcher                                                   │
│ Nav: Bridge / Inbox / Workbench / Library / Operations / Settings    │
│ Footer: ● Bridge healthy · 12/min                                   │
└──────────────────────────────────────────────────────────────────────┘
┌─ BridgeTopbar (52px, navy) ─────────────────────────────────────────┐
│ Breadcrumbs left  |  cmd-K center-right  |  notif + help + avatar   │
│ [2px link-spine gradient at bottom edge]                            │
└──────────────────────────────────────────────────────────────────────┘
┌─ Main content (bg #F6F7FA) ─────────────────────────────────────────┐
│  EdgeRails wrap order-handling pages                                 │
│  Plain layout for settings / auth / marketing                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Sidebar nav groups + routes:**
| Group | Item | Route |
|---|---|---|
| — | Bridge (dashboard) | `/bridge` |
| Inbox | All | `/inbox` |
| Inbox | New | `/inbox?status=new` |
| Inbox | Needs review | `/inbox?status=review` |
| Inbox | Failed | `/inbox?status=failed` |
| Inbox | Ready to deliver | `/inbox?status=ready_to_deliver` |
| Inbox | Sent | `/inbox?status=delivered` |
| Workbench | Upload | `/upload` |
| Workbench | Drafts | `/drafts` |
| Library | Supplier docks | `/library/suppliers` |
| Library | Buyer docks | `/library/buyers` |
| Library | Mappings | `/library/mappings` |
| Library | Rules | `/library/rules` |
| Library | Output templates | `/library/templates` |
| Operations | Delivery log | `/operations/log` |
| Operations | Connectors | `/operations/connectors` |
| Operations | Webhooks | `/operations/webhooks` |
| — | Settings | `/settings` |

**Active nav item style:** 2px link-gradient strip on left, slightly raised navy surface (`navy.surface`), white text.

---

## 5. Route structure

```
src/app/
  (marketing)/            ← no EdgeRails, bgWarm background
    page.tsx              # bridge hero / landing
    pricing/page.tsx
  (auth)/
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
  (app)/
    layout.tsx            # BridgeSidebar + BridgeTopbar + children
    bridge/page.tsx       # Wire Topology dashboard (signature screen)
    inbox/page.tsx        # TanStack Table queue view
    inbox/[orderId]/page.tsx  # Canonical Spine Review (full page)
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
  page.tsx                # redirect: authed → /bridge, anon → /sign-in
```

Middleware (`middleware.ts`) protects all `(app)` routes via Clerk.

---

## 6. Component library

All Bridge-specific components live in `src/components/bridge/`.

### Signature components

| Component | File | Description |
|---|---|---|
| `<EdgeRails>` | `bridge/EdgeRails.tsx` | 4px blue left + green right vertical rails with port markers. Wraps the work area on order-handling screens. |
| `<WireTopology>` | `bridge/WireTopology.tsx` | SVG canvas: buyer ports left, supplier ports right, animated Bezier wires. Props: `buyers`, `suppliers`, `wires`. |
| `<CanonicalSpine>` | `bridge/CanonicalSpine.tsx` | Vertical spine with `<SpineNode>` children. Each node: `id`, `label`, `value`, `pct`, `tone`, `srcRef`, `outRef`, `hint?`, `subnodes?`. |
| `<DocumentAnatomy>` | `bridge/DocumentAnatomy.tsx` | Source document with labeled zone overlays + per-zone confidence chips. |
| `<XCard>` | `bridge/XCard.tsx` | Card with 3px cross-section edge strip. Props: `edge="left\|right\|top\|bottom"`, `color="buyer\|supplier\|bridge"`. |
| `<StatusJourney>` | `bridge/StatusJourney.tsx` | 5-node mini-track: Parse · Normalize · Validate · Transform · Deliver. Props: `stage` (0–4), `compact?`. |
| `<LinkSpine>` | `bridge/LinkSpine.tsx` | 2px blue→green gradient line. Props: `animated?`, `soft?`. |
| `<MonumentNumber>` | `bridge/MonumentNumber.tsx` | Bricolage Grotesque KPI. Props: `value`, `label`, `sub`, `accent`, `size`. |
| `<MarkSystem>` | `bridge/MarkSystem.tsx` | System Identity mark SVG in 3 sizes. Props: `size`, `white?`. |
| `<BridgeSidebar>` | `bridge/BridgeSidebar.tsx` | 220px navy sidebar with logo, workspace switcher, nav groups, health footer. |
| `<BridgeTopbar>` | `bridge/BridgeTopbar.tsx` | 52px navy topbar with breadcrumbs, cmd-K, avatar, link-spine. Props: `crumb`. |
| `<FileChip>` | `bridge/FileChip.tsx` | File format colored tag: PDF red / XLSX green / cXML violet / EDI amber / CSV slate / JSON gold. |
| `<ConfidenceChip>` | `bridge/ConfidenceChip.tsx` | `pct%` badge — ≥90 green, 75–89 amber, <75 red. |

### Primitives (extend shadcn/ui, Bridge-styled)

- `<Button>` — variants: `primary` (navy bg) / `secondary` / `ghost` / `danger` / `ai` (violet). Never gradient.
- `<DataField>` — label + value + optional confidence chip + revert + source-link popover.
- `<AiSuggestion>` — violet left-bar, "AI" tag, Accept / Edit / Reject. Confidence always visible.
- `<CommandPalette>` — cmd+K, fuzzy across orders, suppliers, SKUs, named actions.
- `<EmptyState>` — illustration-free. Headline + sub + primary action.

---

## 7. Build order (§12 from brief)

1. ✅ **Tokens + shell** — tailwind.config.ts, `<EdgeRails>`, `<BridgeSidebar>`, `<BridgeTopbar>`, `<MarkSystem>` (in progress)
2. ⬜ **System Identity mark** — all sizes + mono form
3. ⬜ **Inbox** — TanStack Table, StatusJourney in rows, filter chips, time-strip
4. ⬜ **Canonical Spine Review** at `/inbox/[orderId]` — DocumentAnatomy + CanonicalSpine + output preview + issues rail + sticky action bar
5. ⬜ **Bridge dashboard** at `/bridge` — WireTopology + monumental KPI strip + in-transit list + dock health
6. ⬜ **Upload Workbench, Mapping Editor, Validation Rules, Crossings Log**
7. ⬜ **Marketing pages** (separate route group)
8. ⬜ **Motion layer** — six patterns from brief §8

---

## 8. Motion patterns (implement last, §12 step 8)

| Pattern | When | Behavior |
|---|---|---|
| Link-spine activation | Order advances a stage | 2px topbar spine fills left→right, 1.2s |
| Wire travellers | Always (subtle) | White-dot pulses along wires, `offset-path`, 6s loop |
| Status node pulse | Stage activates | Active node in StatusJourney pulses once with brand ring |
| Connector draw | Mapping saved | Buyer↔supplier line draws blue→green via stroke-dashoffset, 0.8s |
| Validate-to-deliver flush | "Cross the bridge" clicked | StatusJourney advances stages in 40ms stagger |
| Empty-state link-close | Hover on placeholder | Mark's link completes its loop |

All motion: respect `prefers-reduced-motion: reduce`. Disable wire-topology animation under reduce.

---

## 9. Copy / vocabulary

| Term | Meaning |
|---|---|
| Bridge | The product |
| crossing | A single order transit |
| dock | A supplier or buyer endpoint |
| lane | A buyer↔supplier pairing |
| spine | The canonical PO model |
| anatomy | Source document zone overlay |

**Dashboard title:** "Order topology" (not "Dashboard").  
**Primary action:** "Cross the bridge →" (not "Send").  
**Stages:** Parse · Normalize · Validate · Transform · Deliver.  
**AI CTAs:** Accept / Edit / Reject — never "Apply magic" or sparkles.

---

## 10. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router. NO Pages Router. |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui (restyled to Bridge Layer) |
| State | TanStack Query (all server state). NO `useEffect` for data fetching. |
| Table | TanStack Table (virtualized Inbox) |
| Auth | Clerk (`@clerk/nextjs`). Secret keys in `.env.local` only. |
| Monitoring | Sentry (`@sentry/nextjs`) |
| PDF rendering | `pdfjs-dist` |
| Spreadsheets | `react-data-grid` |
| Syntax highlighting | `shiki` |
| Mock data | MSW — 50 orders, 6 suppliers, 4 buyers, 200 SKU mappings |
| Package manager | **bun** (never npm install) |
| Hosting | Vercel (frontend) + Railway (backend, .NET 8) |

---

## 11. Security constraints (enforced, never bypass)

- ❌ EF queries without `org_id` scope — ever
- ❌ `useEffect` for data fetching — TanStack Query only
- ❌ Direct browser AI/LLM calls — AI provider calls go through the backend only
- ❌ Raw SQL — EF Core only
- ❌ Hangfire jobs that are not idempotent
- ❌ Filesystem storage for new code — R2 or LocalFileStorageService only
- ❌ `npm install` — use bun
- ❌ Clerk secret keys in `.env` — only in `.env.local` (gitignored)
- ❌ Lovable-generated code or Vite patterns — design and implementation stay in Claude Code/Codex

---

## 11.5 Billing model (locked)

Source of truth:
`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\superpowers\specs\2026-05-24-stripe-billing-design.md`

Plan ladder:

| Plan | Price | Orders | Suppliers |
|---|---:|---:|---:|
| Pilot | Free for 14 days | 20 total during trial | 1 |
| Growth | €149/mo | 150/month | 5 |
| Operations | €399/mo | 500/month | 10 |
| Integration | €999/mo | 1,000/month | 20 |
| Enterprise | Custom, from €2,500/mo | Custom | Custom |

Frontend must reflect:

- Pilot is not free forever. It becomes read-only after 14 days or 20 orders.
- Read-only Pilot users can view previous orders/mappings/outputs and billing,
  but cannot upload, transform, deliver, or add suppliers.
- Stripe Checkout is only for Growth, Operations, and Integration.
- Enterprise is contact sales/manual.
- Pricing, settings billing UI, upload 429 banners, and supplier-limit errors
  must use this model and copy.

Required billing copy:

- Pilot active badge: `Pilot · 14-day trial`
- Pilot expired badge: `Pilot ended · Processing paused`
- Pilot expired banner: `Your Pilot has ended. You can still view previous orders, but new processing is paused. Upgrade to Growth to continue.`
- Order limit banner: `You've reached your plan's order limit. Upgrade to continue processing new orders this month.`
- Supplier limit banner: `Your plan includes 1 supplier. Upgrade to Growth to add more supplier flows.`

Pricing cards:

- Pilot: `Free for 14 days` — 20 orders, 1 supplier, CSV/XLSX/PDF/XML upload where supported, manual review, supplier-ready export. CTA: `Start Pilot`.
- Growth: `€149/month` — 150 orders/month, 5 suppliers, mapping library, validation, output preview, basic audit log. CTA: `Upgrade to Growth`.
- Operations: `€399/month` — 500 orders/month, 10 suppliers, bulk mapping import/export, cXML support, advanced audit trail, priority support. CTA: `Upgrade to Operations`.
- Integration: `€999/month` — 1,000 orders/month, 20 suppliers, webhook/API delivery, email ingestion, custom output templates, assisted onboarding. CTA: `Upgrade to Integration`.
- Enterprise: `Custom` — custom volume/suppliers, ERP connectors, dedicated onboarding, SLA, custom transformation rules. CTA: `Contact sales`.

---

## 12. Anti-patterns (refuse to build)

- Big editorial serif inside the app (kept for marketing accents only)
- Decorative gradient backgrounds, sparkle icons, illustrated mascots, glassmorphism
- Modals when a drawer or inline editor will do
- Modal wizards that hide the source file during review
- "Good morning, Maria" greetings on the dashboard — operators want the queue
- Auto-applying AI corrections without a visible accept step
- Notched corners everywhere — use `<XCard>`'s cross-section edge instead
- The directional-field background gradient on every screen — only marketing hero areas
- Per-screen color themes — one token system across the entire product
- Hand-rolled icons that don't share the System Identity construction language
- Lovable/Vite component imports, previews, routing, or generated UI fragments

---

## 13. Environment

```
NEXT_PUBLIC_API_BASE_URL   = http://localhost:5223 (dev) / Railway URL (prod)
NEXT_PUBLIC_USE_MOCK       = false
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  → .env
CLERK_SECRET_KEY           → .env.local only (gitignored)
NEXT_PUBLIC_SENTRY_DSN     → .env
```

Frontend port: **8082** unless another local port is chosen. API port: **5223** (ASP.NET HTTP profile).

---

## 14. Implementation notes

### Prototype reference

The v2 prototype lives in `C:\Users\Dmitri.MARKIT\Downloads\v2-bridge-review\`:
- `v2-kit.jsx` — design tokens + primitives (MarkSystem, LinkSpine, StatusJourney, MonumentNumber, FileChip, ConfidenceChip)
- `v2-bridge.jsx` — shell + signature components (EdgeRails, XCard, BridgeShell, BridgeTopbar, WireTopology, Bridge_Dashboard)
- `v2-bridge-review.jsx` — Canonical Spine Review screen (SpineWorkbench, SpineNode, DocumentAnatomy, OutputPreview)
- `v2-prototype.jsx` — Inbox, Upload, Mappings screens

These JSX files use inline styles (they're vanilla React prototype). Translate to Tailwind + TypeScript when porting to the app.

### Current implementation state

- Next.js 15 App Router migration ✅ complete
- Bridge Layer app shell exists with `BridgeSidebar` + `BridgeTopbar`.
- Canonical Bridge routes are `/bridge`, `/inbox`, `/inbox/[orderId]`, `/upload`, `/library/mappings`, `/library/suppliers`, `/operations/*`, and `/settings`.
- Legacy compatibility routes such as `/dashboard`, `/orders`, `/orders/[id]`, `/suppliers`, and `/mappings` may still exist; do not use them as the product direction unless deliberately preserving redirects/compatibility.
- Phase 4 Groups C-H ✅ implemented:
  - C/C2 billing and final Pilot/Growth/Operations/Integration/Enterprise plan ladder.
  - D PO field mapping engine.
  - D2 HTTP-first supplier delivery config.
  - E AI mapping suggestions.
  - F text-based PDF ingestion.
  - G Erply/Directo ERP delivery adapters.
  - H IMAP email polling settings UI.
- Delivery UI must not imply an order is sent just because a transform artifact exists. Use explicit states such as `ready_to_deliver`, `delivering`, `delivered`, and `delivery_failed`.
- Current implementation group is **Group I — UI/UX production polish + responsive QA**.
- Playwright is installed for UI QA. Local screenshots go in `.qa-screenshots/` (gitignored).
- For local protected-route QA only, start dev with `PROCULINK_QA_BYPASS_AUTH=true bun run dev -- --hostname 127.0.0.1 --port 8082`. The middleware bypass is disabled in production by `NODE_ENV`.
- Wire Topology rules are now explicit: same-lane wires may be straight, but every wire must use the same visible gradient stroke; shared ports fan out; alert counters are tethered to their route; the legend must not overlap supplier/buyer pills.
- Group I pass 3 is complete: `/upload` and `/settings` were screenshot-tested on desktop/mobile. Upload stacks on mobile and uses recent-order route cards instead of forcing a desktop table; settings uses horizontal mobile tabs and responsive email-polling grids.
- Group I pass 4 is complete: `/inbox`, `/library/suppliers`, `/library/buyers`, `/operations/log`, and `/operations/webhooks` were screenshot-tested and fixed for mobile. Inbox now renders visible mobile cards plus a desktop table; `@tanstack/react-virtual` was removed because the virtualized table was rendering an empty body.
- Continue Group I QA before starting Group J: supplier detail, mappings import/export, rules/templates edit states, connector/webhook forms, plan-gated/empty/loading/error states, and dense order-review edits still need the same desktop/tablet/mobile pass.

### shadcn/ui

Keep shadcn primitives in `src/components/ui/` — they are dependency infrastructure. The Bridge Layer wraps or reskins them; it does not delete them. Custom Bridge components in `src/components/bridge/`.
