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
| **I** | UI/UX production polish + responsive QA | **In progress — pass 10 complete** |
| **J** | Live end-to-end QA + deployment hardening | Planned after I |
| **K** | Standards + engine hardening surfaces | Planned after I/J scoping |
| **L** | Trust, onboarding + commercial readiness | **In progress — Wave 1 (Ph 1, 2, 4.1, 4.2, 8, 10.1, 10.2) on main; Wave 2 (Ph 3, 4.4–5.2) on feature branches** |

Group I must continue unless the user explicitly reprioritizes:
- QA desktop, tablet, and mobile.
- Keep fixing visible Bridge Layer defects with Playwright screenshots before moving to broad engine work.
- Make core flows feel complete: sign-in, first upload, inbox/review, mapping, transform, delivery, settings/billing/email, and error states.
- Only after that, add broader engine surfaces for more standards and output templates.

2026-06-02 PO reliability state: Task 6 is closed locally. The primary browser path is verified by
`PLAYWRIGHT_API_URL=http://localhost:5223 bun run test:e2e:live -- tests/e2e/live-po-loop.spec.ts`.
That live-only test drives CSV upload -> `/upload/preview/<id>` -> manual
supplier-code entry -> save mapping -> `/inbox/<id>` -> send/transform/deliver
-> missing delivery-config failure panel -> retry feedback. Mapping preview
returns `orderStatus` and `resolvedSupplierCode`; the preview UI polls while
parsing. The review "send" action calls transform/delivery instead of only
advancing local state. Failure-state browser QA is verified by
`PLAYWRIGHT_API_URL=http://localhost:5223 bun run test:e2e:live -- tests/e2e/live-po-failure-states.spec.ts`:
no-supplier upload blocking, unsupported-format guidance, scanned/textless PDF
parse-failure routing when OCR is disabled, and supplier HTTP 4xx rejection copy.
Next frontend gate is Group J/live deployment QA against Railway/Vercel.

Group J edge-fix slice started 2026-06-02: live `https://proculink.eu/` and
`https://www.proculink.eu/` returned 200, and `https://api.proculink.eu/health`
returned 200. Live `/upload` returned a signed-out protected-route 404 and live
`/sitemap.xml` returned 404. Fix pushed and verified live: `src/middleware.ts` now
explicitly redirects signed-out protected app routes to
`/sign-in?redirect_url=...`; `src/app/sitemap.ts` and `public/robots.txt` expose
public marketing/help pages and disallow protected workspace paths. Local
production verification passed: `bun run build`, `/upload` -> 307 sign-in
redirect, `/sitemap.xml` -> 200 XML, `robots.txt` includes the sitemap URL. Live
verification after push: `https://proculink.eu/upload` -> 307 sign-in redirect,
`https://proculink.eu/sitemap.xml` -> 200 XML.

Group J auth boundary update 2026-06-03: `src/middleware.ts` now allows Clerk
handshake requests (`__clerk_handshake` / `__clerk_db_jwt`) on protected routes
before applying the local signed-out redirect. This fixes temporary agent/test
session handshakes on production HTTPS while keeping ordinary signed-out
`/upload`, `/bridge`, etc. requests redirected to `/sign-in?redirect_url=...`.
`bun run build` passed and Vercel production deploy
`project-proculink-j02z9qtwg...` is Ready. Production Clerk secret was provided
for the session (never commit or print it) and `@clerk/testing` is installed as
a dev dependency for production-like browser QA. Clerk Testing Tokens can be
created, and disposable production Clerk users can be created/deleted. Do not
try to use `clerk.sessions.createSession` for production QA: Clerk rejects it
with `request_invalid_for_environment` because Backend API session creation is
development-only. The valid path is a browser/client session via
`@clerk/testing/playwright` sign-in-token flow or a real signed-in browser
session. Current Codex desktop environment cannot launch Playwright Chromium,
Chrome, or Edge (browser launches time out before DevTools opens; DevTools-port
manual launch is denied by Windows permissions), so authenticated deployed PO QA
must be run from a browser-capable environment. Public edge checks are healthy:
`https://api.proculink.eu/health` -> 200; protected `/upload` and `/bridge` ->
307 local sign-in redirect; `/sign-in` -> 200.

Group J live API/storage update 2026-06-03: the Clerk FAPI sign-in-token flow
can mint a real production session JWT for a disposable user + organisation,
and Railway accepts authenticated API calls with that JWT:
`GET /api/billing/status`, `POST /api/suppliers`, and `GET /api/suppliers` are
green. Railway production R2 variables were updated with a Cloudflare R2 S3
access key pair for bucket `proculink`; after redeploy, sample order now returns
200 and direct multipart `POST /api/orders/upload` returns 200 with an R2
`sourceFileKey`. Do not chase sample-order/upload as a frontend/CORS issue.
The current live blocker is parse job execution: uploaded orders remain
`parsing` for 30+ seconds. API logs show `ParseOrderJob` is enqueued, but the
linked Railway service is only `ProcuLink` and the API intentionally does not
run `AddHangfireServer`. Production needs a separate `ProcuLink.Worker` Railway
service deployed from `Dockerfile.worker` with the same DB/storage/AI/delivery
env vars. After that Worker consumes jobs, rerun upload -> preview -> review ->
transform -> delivery against the live domain.

---

## 2. Visual direction — "The Bridge Layer" (as shipped)

Direction 4 from the v2 design exploration, **audited against the code on
2026-08-13 and corrected here**. This section used to open with "Do not deviate"
and list five non-negotiable spatial signatures. Three of those five were never
built, and one of them had no component in `src/` at all — so for months every
new screen was being designed against a spec that the product did not implement,
and no guard could catch it because the fiction lived in a document, not in code.

**Read this table before designing any screen. It is the whole point of §2.**

| Signature | Built? | Where it renders |
|---|---|---|
| **1. Edge rails** — 4px buyer-blue left / supplier-green right, port markers | **NO — STRUCK 2026-08-13** | Nowhere. See below. |
| **2. Wire Topology** — buyer ports left, supplier ports right, animated wires | **YES, demoted** | `/bridge`, as the **"System map" tab** — not the dashboard hero |
| **3. Canonical Spine review** — 3-column source · spine · output | **NO — DELETED 2026-08-13** | Nowhere. The shipped review is a different layout; see below. |
| **4. Document Anatomy** — source document pane | **PARTLY** | `src/components/bridge/document/` renders the pane. The **per-zone confidence overlay does not exist** and needs backend provenance first. |
| **5. Cross-section card edge** — 3px brand strip on a card edge | **YES, and now applied by rule** | `<Card>`, `src/components/bridge/layout/Card.tsx`. Five card paths converged into it 2026-08-13; the edge is semantic and its rule is in that file's header. |

### 1. Edge rails — STRUCK

The `<EdgeRails>` component was never built into `src/`. The CSS that was written
for it — `.railed`, `.rail`, `.rail.buyer`, `.rail.supplier`, `.rail-port`,
`.rail-label` in `src/app/globals.css` — carried **zero consumers** for its entire
life: no element in the app ever applied one of those classes. The matching
Tailwind tokens (`rail: 4px` spacing, `z-rails` z-index, `bg-rail-buyer`,
`bg-rail-supplier`) were equally unused. All of it was deleted 2026-08-13.

One token survived the strike because it renders something real:
`--gradient-rail-buyer` was **renamed `--gradient-line-buyer`** and still draws the
vertical connector running through a help guide's numbered step badges
(`src/components/help/guide/Step.tsx`). It is a step connector, not a rail.
`--gradient-rail-supplier` was deleted outright.

**Do not reinstate the rails as decoration.** They were struck because a 4px strip
at the window edge is not how anyone reads direction.

### What carries buyer-left / supplier-right now

This matters more than the rails did, so it is stated explicitly rather than left
implicit. Orientation is carried by **layout and labels**, in three places:

1. **Panel order on the review screen.** `/inbox/[orderId]` →
   `src/components/bridge/workshop/OrderWorkshop.tsx` →
   `src/components/bridge/mapper/MapperWorkbench.tsx` (`variant="order"`), a
   two-level grid running left → right:

   | Position | Pane | Heading | Dot |
   |---|---|---|---|
   | Left | `IncomingPane` | **"What we received"** / "Original document" | blue `#1E66C9` |
   | Middle | `OutgoingPane` | **"What we'll send"** | green `#2E8E3A` |
   | Right | `MapperPreviewPane` | **"Live preview"** — "exactly what {supplier} receives" | green `#2E8E3A` |

   Note it is **not** a symmetric blue-left / green-right pair: it is one buyer
   column followed by two supplier columns. Below `lg`, `MobileTriage` stacks the
   same three in the same order. **Source stays left of output. Do not reorder
   these panes** — that ordering is the orientation.

2. **A labelled direction column in the queue.** `src/components/bridge/InboxView.tsx`
   (`id: "lane"`, the second column). Its header is literal text from
   `src/hooks/useOrderDirection.ts` — `"Buyer → Supplier"` outbound,
   `"Customer → You"` inbound — and the cell renders the buyer name in blue, a `→`
   glyph, and the supplier name in green.

3. **Colour, unchanged.** Buyer / incoming = `#1E66C9`. Supplier / outgoing =
   `#2E8E3A`. This holds in both directions; only the words change
   (`src/hooks/useOrderDirection.ts`). Where the green sits on text it darkens to
   `#1E6D29` for contrast — that is a WCAG fix, not a different colour.

### 3. Canonical Spine review — DELETED

`src/components/bridge/CanonicalSpine.tsx` (`<CanonicalSpine>` + `<SpineNode>`)
had **zero importers** and was deleted 2026-08-13, along with its `spine: 3px`
spacing token, whose only consumer was that file. `SpineReview` was deleted
earlier, in commit `3520ed4`.

The shipped review is the three-pane workbench in the table above. It is a
different and better shape than the spec's source · spine · output triptych: the
middle column is the editable field mapping, not a read-only canonical spine, and
the right column is a live preview of the actual outgoing payload.

**The one rule from the old spec that survives, because it is true and load-bearing:
the source document stays visible on the left during review.** Never hide the source
behind a modal or a wizard step.

### Supporting signatures — all of these are real

- **Navy app chrome / light work area.** Chrome = `#0B1A2F`. Main content = `#F6F7FA`.
- **Link-spine.** 2px blue→green gradient line across the bottom of the topbar
  (`bg-link-spine` / `--gradient-link-spine`). Distinct from the deleted canonical
  spine — this one ships.
- **Status as a journey.** Order status = 5-node mini-track
  (Parse · Normalize · Validate · Transform · Deliver), not a static pill.
  `<StatusJourney>`.
- **Monumental numbers.** KPIs in Bricolage Grotesque 600, tight letterspacing.
- **System Identity mark.** SVG glyph: an arc with a blue circle on the left end and
  a green circle on the right. Same geometry in loading states and pipeline icons.
  (It no longer has rail markers or spine nodes to share geometry with.)

### Design workflow

Do not use Lovable for ProcuLink. All UI/UX decisions run through the local design
system, `/frontend-design`, and Claude Design/reference images.

⚠ **`docs/design-system/handoff-v2/` in THIS repo is a superseded 2026-05 handoff
snapshot, not a spec.** It still contains the struck signatures — including
reference `EdgeRails.tsx` / `CanonicalSpine.tsx` files and a `showcase.html` that
renders edge rails as a live demo. Every file in it now carries a dated strike
banner pointing back here. **This section outranks it.** The sibling backend repo's
`docs/design-system/` (`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\design-system`)
is a different, current set — note the name collision.

`/frontend-design` is a quality and execution lens. It sharpens what ships; it does
not invent a new aesthetic, and it does not resurrect a struck signature.

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
- `bg-mark-gradient` → `linear-gradient(90deg, #1E66C9, #2E8E3A)`

> `bg-rail-buyer` and `bg-rail-supplier` were deleted 2026-08-13 with the edge-rail
> signature (§2) — both had zero consumers. The `--gradient-line-buyer` CSS variable
> in `globals.css` is what remains, and it is a help-guide step connector, not a rail.

**Spacing:** 4px base. **Radii:** card-sm 6px / card 8px / card-lg 12px. **Shadows:** avoid heavy drops. Cards use borders + `0 1px 2px rgba(11,26,47,0.04)`.

**Type scale:** body 13/14px · table rows 12/12.5px · KPI display 32–48px · marketing display 60–78px.

---

## 4. App shell architecture

**Desktop navigation lives in the TOPBAR, not a sidebar.** The 220px navy sidebar
this section used to describe as permanent desktop chrome renders only in the
**mobile drawer**. The move was deliberate: the topbar buys back horizontal room
that the dense order table needs. The `sidebar: 220px` Tailwind spacing token has
zero consumers and survives only as a reference value.

```
┌─ BridgeTopbar (52px, navy) ─────────────────────────────────────────┐
│ Logo + workspace switcher | nav | cmd-K | notif + help + avatar     │
│ [2px link-spine gradient at bottom edge]                            │
└──────────────────────────────────────────────────────────────────────┘
┌─ Main content (bg #F6F7FA) ─────────────────────────────────────────┐
│  No edge rails — struck 2026-08-13 (§2). Buyer/supplier orientation │
│  is carried by pane order on the review screen and by the labelled  │
│  "Buyer → Supplier" column in the queue.                            │
└──────────────────────────────────────────────────────────────────────┘

BridgeSidebar (220px, navy) — MOBILE DRAWER ONLY
  Logo + wordmark · workspace switcher · nav groups · health footer
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
| — | Settings | `/settings` |

> `/operations/webhooks` was deleted (2026-08-08): a duplicate of Settings ▸
> Connectors that nothing navigated to. The URL 308s to `/settings?tab=connectors`
> via `src/lib/retired-routes.ts`.

> `/operations/connectors` was deleted (2026-08-13): a read-only page nothing
> navigated to, whose rows were hardcoded to one channel type because
> `GET /api/suppliers` carries no delivery-config signal. The suppliers list
> prints each supplier's real channel and the supplier Delivery tab owns the
> config. The URL 308s to `/library/suppliers` via `src/lib/retired-routes.ts`.

**Active nav item style:** 2px link-gradient strip on left, slightly raised navy surface (`navy.surface`), white text.

---

## 5. Route structure

```
src/app/
  (marketing)/            ← bgWarm background
    page.tsx              # bridge hero / landing
    pricing/page.tsx
  (auth)/
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
  (app)/
    layout.tsx            # BridgeSidebar + BridgeTopbar + children
    bridge/page.tsx       # dashboard; Wire Topology is the "System map" tab
    inbox/page.tsx        # TanStack Table queue view
    inbox/[orderId]/page.tsx  # order review — OrderWorkshop → MapperWorkbench
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
| `<WireTopology>` | `bridge/WireTopology.tsx` | SVG canvas: buyer ports left, supplier ports right, animated Bezier wires. Props: `buyers`, `suppliers`, `wires`. Renders in the `/bridge` **"System map" tab**, not as the dashboard hero. |
| `<Card>` | `bridge/layout/Card.tsx` | **The one card.** 3px cross-section edge strip, applied by a semantic rule written in the file's header: `edge="blue"` buyer/incoming · `"green"` supplier/outgoing · `"bridge"` spans both · `"none"` neutral **or undeterminable** (the default, and the majority). Also `pad` / `radius` / `flush` / `as` for migrated geometry. Server-component safe. |
| `<StatusJourney>` | `bridge/StatusJourney.tsx` | 5-node mini-track: Parse · Normalize · Validate · Transform · Deliver. Props: `stage` (0–4), `compact?`. |
| `<MarkSystem>` | `bridge/MarkSystem.tsx` | System Identity mark SVG in 3 sizes. Props: `size`, `white?`. (Also exports a dead `RailPort` — see §2.) |
| `<BridgeSidebar>` | `bridge/BridgeSidebar.tsx` | 220px navy sidebar — **mobile drawer only**. Desktop nav is in the topbar. |
| `<BridgeTopbar>` | `bridge/BridgeTopbar.tsx` | 52px navy topbar: nav, breadcrumbs, cmd-K, avatar, link-spine. Props: `crumb`. |
| `<FileChip>` | `bridge/FileChip.tsx` | File format colored tag: PDF red / XLSX green / cXML violet / EDI amber / CSV slate / JSON gold. |
| `<ConfidenceChip>` | `bridge/ConfidenceChip.tsx` | `pct%` badge — ≥90 green, 75–89 amber, <75 red. |

**Two signatures ship as CSS classes, not components.** This table used to give both
a component and a file path; neither file has ever existed. The thing itself is
real — only the component was fiction.

| Signature | How it actually ships |
|---|---|
| Link-spine | `.link-spine` in `globals.css`, applied by `bridge/BridgeTopbar.tsx`. Gradient: `--gradient-link-spine` / `bg-link-spine`, also used by `.xc-bridge` and two marketing pages. There is no `<LinkSpine>`. |
| Monumental numbers | `.monument` + `.m-label` / `.m-value` / `.m-sub` in `globals.css`, applied by `bridge/SupplierDockProfile.tsx`. There is no `<MonumentNumber>`. |

**Removed or never built — do not write code against these:**

| Component | Status |
|---|---|
| `<EdgeRails>` | **STRUCK 2026-08-13** (§2). Never existed in `src/`; its CSS and tokens had zero consumers and were deleted. |
| `<XCard>` | **FOLDED into `<Card>` 2026-08-13.** It had TWO importers, not the ~6 this table claimed, and both passed `color="amber"` — a tone, not a side — which is how the edge came to mean nothing. Its `.xcard`/`.xc-*` CSS had zero consumers and the `card-edge` Tailwind spacing token went to zero with it (the 3px is now `--card-edge`, consumed by `Card`). A **third** `XCard` was defined privately inside `UploadWorkbench.tsx`; it is gone too. |
| shadcn `ui/card.tsx` | **DELETED 2026-08-13.** Zero importers and not a dependency of any other `ui/*` primitive. §14's "keep shadcn primitives" rule does not cover a card that competes with the one card. |
| `<CanonicalSpine>` / `<SpineNode>` | **DELETED 2026-08-13** (§2). `bridge/CanonicalSpine.tsx` had zero importers. |
| `<SpineReview>` | Deleted earlier, commit `3520ed4`. The order review is `workshop/OrderWorkshop.tsx` → `mapper/MapperWorkbench.tsx`. |
| `<DocumentAnatomy>` | Never built. The document pane is `bridge/document/` (e.g. `PdfDocumentView.tsx`); the per-zone confidence overlay does not exist and needs backend provenance first. |
| `<DataField>` | Never built. Zero references anywhere in `src/`. It was listed under Primitives below for months. |

### Primitives (extend shadcn/ui, Bridge-styled)

- `<Button>` — `bridge/DSPrimitives.tsx`. Variants: `primary` (navy bg) / `secondary` / `ghost` / `danger` / `ai` (violet). Never gradient.
- `<AiSuggestion>` — `bridge/DSPrimitives.tsx`. Violet left-bar, "AI" tag, Accept / Edit / Reject. Confidence always visible.
- `<CommandPalette>` — `bridge/CommandPalette.tsx`. cmd+K, fuzzy across orders, suppliers, SKUs, named actions.
- `<EmptyState>` — `bridge/EmptyState.tsx`. Illustration-free. Headline + sub + primary action.

> `<DataField>` was listed here and does not exist — see the removed table above.
> Every path in §6 was re-verified against the tree on 2026-08-13. If you add a
> component to these tables, `git ls-files` the path first.

---

## 7. Build order — HISTORICAL, superseded

This was the original v2 build order. It is kept only so the numbering in older
plans still resolves. **It is not a to-do list**: every item is either shipped or
struck, and steps 1 and 4 named components that no longer exist. Current work is
tracked by the Group I/J/K/L roadmap in §1.5, not here.

1. ✅ **Tokens + shell** — `tailwind.config.ts`, `<BridgeSidebar>`, `<BridgeTopbar>`, `<MarkSystem>`. (`<EdgeRails>` was in this step and was **struck** — see §2.)
2. ✅ **System Identity mark**
3. ✅ **Inbox** — TanStack Table, StatusJourney in rows, filter chips
4. ~~**Canonical Spine Review**~~ — **STRUCK.** Shipped instead as `OrderWorkshop` → `MapperWorkbench` at `/inbox/[orderId]`. No CanonicalSpine, no anatomy zone overlay.
5. ✅ **Bridge dashboard** at `/bridge` — KPI strip + queue; WireTopology demoted to the "System map" tab
6. ✅ **Upload Workbench, Mapping Editor, Validation Rules, delivery log**
7. ✅ **Marketing pages** (separate route group)
8. ✅ **Motion layer** — see §8

---

## 8. Motion patterns (implement last, §12 step 8)

| Pattern | When | Behavior |
|---|---|---|
| Link-spine activation | Order advances a stage | 2px topbar spine fills left→right, 1.2s |
| Wire travellers | Always (subtle) | White-dot pulses along wires, `offset-path`, 6s loop |
| Status node pulse | Stage activates | Active node in StatusJourney pulses once with brand ring |
| Connector draw | Mapping saved | Buyer↔supplier line draws blue→green via stroke-dashoffset, 0.8s |
| Validate-to-deliver flush | "Send to supplier" clicked | StatusJourney advances stages in 40ms stagger |
| Empty-state link-close | Hover on placeholder | Mark's link completes its loop |

All motion: respect `prefers-reduced-motion: reduce`. Disable wire-topology animation under reduce.

---

## 9. Copy / vocabulary

The founder purged the bridge-metaphor jargon (dock / crossing / lane / spine,
and "Cross the bridge") from all **user-facing** copy. Use plain procurement
terms in anything a user reads.

| Term | User-facing meaning |
|---|---|
| order | A single PO transit (was "crossing") |
| supplier / buyer | A supplier or buyer endpoint (was "dock") |
| supplier flow | A buyer↔supplier pairing (was "lane") |
| canonical PO model | The normalized order model (was "spine") |
| anatomy | Source document zone overlay (internal label only) |

**Dashboard title:** "Orders" (plain). Do not ship "Order topology" as a
user-facing heading.  
**Primary action:** "Send to supplier" (shipped copy; not "Cross the bridge →").  
**Stages:** Parse · Normalize · Validate · Transform · Deliver.  
**AI CTAs:** Accept / Edit / Reject — never "Apply magic" or sparkles.

> Note: `dock`, `crossing`, `lane`, and `spine` now survive **only** as code
> identifiers, CSS/design tokens, and route names — never in user-facing text.

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
| PDF rendering | `pdfjs-dist` — the order review screen's document view (`src/components/bridge/document/PdfDocumentView.tsx`). A JS renderer, not an iframe: `frame-src` in `src/lib/security/csp.ts` allows neither `blob:` nor the API origin, and widening it was considered and rejected. |
| Spreadsheets | **No grid library.** CSV and XLSX are read in-browser by `src/lib/sheetPreview.ts` — `fflate` for the OOXML unzip, the platform `DOMParser` for the three XML parts — and laid out as a plain table. |
| Syntax highlighting | **None.** The live output preview marks the just-changed line via `src/components/bridge/mapper/previewHighlightModel.ts`; the document view renders numbered monospace lines. |
| Mock data | `USE_MOCK` in `src/lib/api/core.ts` — an in-memory fixture set in `src/lib/api-client.ts` (4 orders, `ord-001`…`ord-004`). MSW exists under `src/mocks/` but is a **separate, off-by-default** layer: it needs `NEXT_PUBLIC_MSW=true` and points at its own base URL. |
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
- ❌ **Neon database branches** — never create one, and never re-enable an integration that
  creates them per PR/preview (the Vercel↔Neon and Neon↔GitHub integrations were removed
  2026-07-25 after 22 preview branches accumulated and billed compute). The Neon project has
  exactly ONE branch, `production`. Test against local Postgres (`:5435`) or Testcontainers;
  if a branch ever seems necessary, ask the founder first and delete it the same session.

---

## 11.5 Billing model (locked)

**Source of truth is CODE, not this section.** `src/lib/plans.ts` (frontend) mirrors
`ProcuLink.Core/Constants/PlanConstants.cs` (backend) exactly. This section drifted from
both — it was still showing Integration at 1,000 orders and had no Distributor tier at all —
so treat it as a summary that must be re-derived from `plans.ts`, never as the authority.
If they disagree, the code is right.

Plan ladder (verified against `plans.ts` + `PlanConstants.cs`, 2026-07-30):

| Plan | Price | Orders | Suppliers |
|---|---:|---:|---:|
| Pilot | Free for 14 days | 20 total during trial | 1 |
| Growth | €149/mo | 150/month | 5 |
| Operations | €399/mo | 500/month | 10 |
| Integration | €999/mo | 1,500/month | 20 |
| Distributor | €1,499/mo | 2,500/month | 30 |
| Enterprise | Custom, from €2,500/mo | Custom | Custom |

Integration is **1,500** orders, not 1,000: the limit was raised so €/order stays monotonic
down the ladder (Operations €0.80 → Integration €0.67 → Distributor €0.60).

**Distributor is a real, self-serve tier** — it appears on `/pricing`, its Stripe monthly and
yearly prices are live, and the backend checkout maps it like any other paid plan.

Frontend must reflect:

- Pilot is not free forever. It becomes view-only after 14 days or 20 orders.
- A view-only Pilot can still read previous orders/mappings/outputs and billing,
  but cannot upload, transform, deliver, or add suppliers.
- **Cancelling a paid plan has the same effect, and `/pricing` must say so.** Every ingest
  path refuses once the subscription ends — uploads, inbound email, IMAP, SFTP, S3, and the
  REST ingress API — and nothing is queued for later, so orders simply stop arriving.
- Stripe Checkout is self-serve for Growth, Operations, Integration, **and Distributor**.
  Annual billing is live for all four.
- Enterprise is contact sales/manual.
- The order limit is a **soft cap on paid plans**: going over never blocks, it accrues
  €0.50/order overage (`OVERAGE_PER_ORDER_EUR`), capped so a customer is never charged more
  than the cheapest tier covering their volume. Only Pilot's cap is hard.
- Pricing, settings billing UI, upload 429 banners, and supplier-limit errors
  must use this model and copy.

Plan-gate 403s carry `{ error: "<capability>_requires_<plan>", upgradeUrl }`. The plan
segment is derived server-side from the gate table, so **never match these codes by full
literal** — use `isPlanGateError` / `planGateMessage` from `src/lib/planGate.ts`.

Required billing copy:

- Pilot active badge: `Pilot · 14-day trial`
- Pilot expired badge: `Pilot ended · Processing paused`
- Pilot expired banner: `Your Pilot has ended. You can still view previous orders, but new processing is paused. Upgrade to Growth to continue.`
- Order limit banner: `You've reached your plan's order limit. Upgrade to continue processing new orders this month.`
- Supplier limit banner: `Your plan includes 1 supplier. Upgrade to Growth to add more supplier flows.`

**Paid-plan processing-paused banner (added 2026-08-14).** This list had nothing for the
state that actually costs money: a paying customer whose card was declined. Every blocking
surface in `BillingSection.tsx` was gated on `status.plan === "pilot"`, so a `past_due`
Operations workspace saw a healthy blue plan card, no banner, and — as the only trace — the
raw account status printed at 11px in `--ink-faint`, while every ingest path refused. The
banner is gated on **`!status.canProcessOrders`**, derived from the server. Never re-gate a
blocking surface on a plan name; that check is what caused this.

- Paused plan badge (non-Pilot): `<Plan> · Processing paused` (Pilot keeps `Pilot ended · Processing paused` above)
- Headline, by `accountStatus`:
  - `past_due` → `Your last payment didn't go through.`
  - `cancelled` → `Your subscription has ended.`
  - `read_only` → `Your subscription isn't active.` — stays vague ON PURPOSE: `StripeBillingMapping.MapStatusToAccountStatus` folds Stripe `paused`, `canceled`, **and** a deleted subscription into this one value, so naming a cause would be a guess
  - `trial_expired` → `Your trial has ended.`
  - anything else, including a status this build does not know → `Order processing is paused on your account.`
- Consequence (shared by every cause, and deliberately the same claims as the `/pricing`
  cancellation disclosure): `New orders aren't being accepted — uploads, emailed orders, SFTP and S3 pickups, and the REST API all refuse, and nothing is held to deliver later, so redirect your suppliers if this will take a while. Everything already processed stays readable and exportable.`
- Route back: `Manage in Stripe` (self-serve paid plans) / `Contact support` (Enterprise —
  a manual agreement has no portal). Only `past_due` and `read_only` may promise processing
  restarts by itself; a cancelled subscription needs a new one.

Pricing cards — **do not hand-maintain this list.** The card feature bullets and CTAs live in
`PLANS` in `src/lib/plans.ts`; the summary below drifted (it still described Integration as
1,000 orders and claimed delivery/ingestion channels start at Integration when the backend
gates them at Growth). Read `plans.ts`:

- Pilot: `Free for 14 days` — 20 orders, 1 supplier, CSV/XLSX/PDF/XML upload, manual review, supplier-ready export. CTA: `Start Pilot`.
- Growth: `€149/month` — 150 orders/month, 5 suppliers, **webhook/API delivery and email · SFTP · S3 ingestion** (channels are decoupled from volume — every paid tier gets all of them), mapping + validation, **per-order audit trail**. CTA: `Upgrade to Growth`.
  It is the **per-order** trail, not the org-wide delivery log. `GET /api/orders/{id}/audit` is
  ungated on every plan (pinned as the IL scanner's negative control); the cross-order log at
  `/operations/log` is `GET /api/audit`, gated on `BillingFeature.AdvancedAudit` = Operations. This
  line said "audit log" until 2026-08-06, when a live Growth org followed it to `/operations/log`
  and was refused. Enforced by `src/test/gatedCapabilityClaims.test.ts`.
- Operations: `€399/month` — 500 orders/month, 10 suppliers, bulk mapping import, cXML support, advanced audit trail, priority support. CTA: `Upgrade to Operations`.
- Integration: `€999/month` — 1,500 orders/month, 20 suppliers, all channels, advanced audit trail, assisted onboarding. CTA: `Upgrade to Integration`.
- Distributor: `€1,499/month` — 2,500 orders/month, 30 suppliers, all channels, bulk mapping, priority onboarding, founder-led supplier setup. CTA: `Upgrade to Distributor`.
- Enterprise: `Custom` — custom volume/suppliers, ERP connectors, dedicated onboarding, SLA, custom transformation rules. CTA: `Contact sales`.
  SSO is **not** on this card and must not be added back until a Settings SSO surface exists —
  `BillingFeature.Sso` refuses nothing and `ssoAvailable` has zero frontend consumers. The rule is
  enforced, both directions, by `src/test/gatedCapabilityClaims.test.ts`.

**Offer ⇔ works applies to the ladder itself:** a capability may only be listed on a tier if the
backend really gates it there. `BillingFeature` + `PlanConstants.MinimumPlan` are the source of
truth; the guard that keeps them honest is
`ProcuLink.Api.Tests/Architecture/BillingGateEnforcementIsRealTests.cs`, which reads **compiled IL**
(via `BillingGateIlScanner`) and asserts per feature that the named production method provably
reaches the gate primitive — `IBillingService.HasFeatureAsync`, or `PlanConstants.PlanHasFeature`
for the single presentation-only case (SSO — Clerk *can* deliver it, but ProcuLink exposes no
surface for it and no longer sells it; see the note on the Enterprise card above). It also walks the reverse
direction, so a gate call in production that no tier declares fails the build, and it ships a
negative control pinning `OrdersController.GetAudit` as deliberately ungated. Verify a gate by
running that test — never by reading a method name off a list.

`BillingFeatureGateCoverageTests` is **not** that guard and cannot be: its `EnforcedBy` map is
hand-typed free text asserted only by `ContainKey`, a live-keys check, and a member count, so
deleting the `HasFeatureAsync` call out of `AuditController.GetAuditLog` leaves every one of its
tests green. It is not dead, though — it pins the ladder table itself (each feature has a minimum
plan, is off on the tier directly below that minimum, stays on for every tier above, and is off on
Pilot) and fails the build when an enum member is added with no map entry.
`BillingFeatureEnforcementTests` is the behavioural half: the named sites really refuse.

Do not add a bullet for a capability nothing enforces.

---

## 12. Anti-patterns (refuse to build)

- Big editorial serif inside the app (kept for marketing accents only)
- Decorative gradient backgrounds, sparkle icons, illustrated mascots, glassmorphism
- Modals when a drawer or inline editor will do
- Modal wizards that hide the source file during review
- ~~"Good morning, Maria" greetings on the dashboard~~ — **OVERRIDDEN by the founder, 2026-07.**
  The dashboard does greet by first name, and it stays. `DashboardContextLine.tsx` is the
  founder-approved mock: the topbar tab already says "Dashboard", so the row that used to hold the
  H1 became a 36px context line carrying greeting + date + the one thing needing action, with a
  jump link to it. The original rule's point survives in how it is built — the line is compact, the
  queue is not pushed down by a hero, and the blockers count is `null` while loading so it never
  fabricates a number. **Do not "fix" this by deleting it**; it ships with tests
  (`DashboardContextLine.test.tsx`). Verified live 2026-08-06.
- Auto-applying AI corrections without a visible accept step
- Notched corners everywhere — use `<Card>`'s cross-section edge instead
- **A card edge used as a status colour.** The edge says which SIDE of the bridge a
  card is on (buyer / supplier / both / neither). Tone — amber, danger, violet-AI —
  belongs to `<StatusNotice>`, which signals it with its own 3px left border. Both
  real `<XCard>` call sites in the tree before 2026-08-13 passed `color="amber"`,
  which is precisely why the signature carried no information.
- **Edging every card.** `edge="none"` is the default and the majority answer. A card
  whose side you cannot determine gets no edge — do not guess, and do not reach for
  `"bridge"` to avoid deciding. Pinned by `src/test/cardEdgeRule.test.tsx`.
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

### Prototype reference — HISTORICAL, do not build from

The v2 prototype in `C:\Users\Dmitri.MARKIT\Downloads\v2-bridge-review\` is the
2026-05 exploration these docs came from. It predates the 2026-08-13 signature
audit (§2) and still implements the struck signatures — `v2-bridge.jsx` contains
`EdgeRails`, and `v2-bridge-review.jsx` is the whole Canonical Spine Review
(`SpineWorkbench`, `SpineNode`, `DocumentAnatomy`). **Do not port those.**
`v2-kit.jsx` (MarkSystem, LinkSpine, StatusJourney, MonumentNumber, FileChip,
ConfidenceChip) is still an accurate reference for components that shipped.

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
- Group I pass 5 is complete: supplier detail, mapping editor, supplier PO Mapping tab, and supplier Delivery tab were screenshot-tested and fixed for mobile. Supplier KPIs no longer collide with the title, mapping rows use mobile route cards, and PO/delivery form controls now stack safely.
- Group I pass 6 is complete: settings billing/email tabs now have explicit loading/error states with retry actions and bounded billing/email API fetch timeouts; `/operations/connectors` uses mobile cards instead of a squeezed table; connector and webhook add/edit buttons open lightweight configuration panels so the UI path is visible before live save/test-fire QA.
- Group I pass 7 is complete: `/library/mappings` import/export/add/edit, `/library/rules` new/edit/list, and `/library/templates` new/edit now have visible panels; rules list view uses mobile cards instead of a clipped desktop table; dense order-review inline edit and confirm states were rechecked.
- Group I pass 8 is complete: `/upload` now has selected-file browse/drop state, plan usage/read-only context, and structured 429 handling through `ApiHttpError`; `/library/suppliers` now separates supplier-limit state from billing-unavailable state and opens a lightweight supplier setup panel when adding is allowed.
- Group I pass 9 is complete: connector/webhook draft test and save actions, mapping import/export/add/edit saves, validation-rule toggle/edit saves, and output-template validate/save actions now show visible local QA feedback instead of closing silently. Mapping and rules notices use wrapped rows so they do not squeeze filters or clip on mobile.
- Group I pass 10 is complete: `/upload` now redirects to the returned order id instead of hardcoded `/inbox/008412`; `/inbox/[orderId]` Save draft, output Copy/Download, and delivered states show visible local feedback; the mobile review action bar no longer squeezes total/template/exception/actions.
- Continue Group I QA before starting Group J: live API/deployment first-upload-to-delivery happy/error paths still need the same desktop/tablet/mobile pass. Group J should convert the local connector/webhook/mapping/rule/template QA affordances into real persistence/test-fire verification.
- **Group J2 — fabricated/demo-data purge (P0 trust, 2026-05-29):** removed staged content that rendered for real (non-mock) users or misled prospects. (a) `UploadWorkbench` "Recent uploads" now drives from `apiClient.getOrders()` and is hidden when empty; the demo `RECENT` array is gated to `isApiMockMode` (renamed `DEMO_RECENT`); the non-functional hardcoded buyer-dock dropdown (Heinrich/Nordmark/…) was replaced with a "Detected from the uploaded document" note (buyer is auto-detected at parse time, never sent on upload). (b) `SpineReview` `DocumentAnatomy`, `OutputPreview`, and the desktop sticky bar are now fully driven by the live `order` (PO/date/buyer/supplier/currency/lines/total) — all hardcoded `PO-DEMO-001`/`HEINRICH`/`Acme Components`/`ACM-BLT`/`€ 4,436.73`/`1m 42s` strings and `INITIAL_NODES`/`ANATOMY_ZONES` removed; "Save draft" and post-send notices rewritten as honest user-facing copy (no "Group J" jargon). (c) `CrossingsLog` `MOCK_LOG` stays gated to `isApiMockMode`; the hardcoded `"Today · 24 May 2026"` label is replaced with a date derived from the latest real event (hidden when there are no live events). (d) `/drafts` shows an honest empty state for real users; the demo array is gated to `isApiMockMode`. (e) landing page (`src/app/page.tsx`) "Real results from teams" + "60% fewer reformatting tasks" replaced with honest capability copy (no fabricated stats), consistent with `/customers` "early pilots". (f) confirmed `BridgeDashboard` `IN_TRANSIT_MOCK_FALLBACK` and `InboxView` `MOCK_ORDERS` are already `isApiMockMode`-gated (no change). MSW mock layer (`src/mocks/`) left intact (dev-only). Verified: `bun run build` green (42/42 pages); Playwright `no-mock-residue` + 33 specs green (the 8 marketing/magic-mapping failures in the full run were dev-server-under-load connection drops — green in isolation); mock-mode `/inbox/ord-002` and non-mock `/upload`,`/drafts`,`/operations/log` confirmed free of fabricated company names/stats.
- **Known residual fabrication (not in J2 scope, flagged for follow-up):** ~~`SupplierDockProfile.tsx` renders a hardcoded `MOCK` supplier ("Acme Components") unconditionally on `/library/suppliers/{id}`~~ — **STALE, corrected 2026-08-08.** That was fixed; the array is now `DEMO_MOCK` and every one of its ~20 reads sits inside an `isApiMockMode` guard, which is itself build-time false in production (`NEXT_PUBLIC_USE_MOCK === "true" && NODE_ENV !== "production"`, `src/lib/api/core.ts`). Verify before acting on any claim in this bullet — the note outlived the defect by months and was still being handed to sessions as current.
  The file's real problem is the opposite shape and is tracked separately: it *asserts absences it never fetched*. The "Recent orders" panel is fixed (see `RecentOrdersPanel` + `SupplierDockProfile.recentOrders.test.tsx`); still open on that screen are the four `—`/"no data yet" KPI cards (no metrics query exists), the "Configure this supplier in the Delivery tab to populate this summary." card (never checks whether delivery is already configured), `CatalogTab`'s "No products yet." (query's `isError` unbranched, so a failed fetch reads as an empty catalog), "No versions yet" (same, on the `["connections"]` query), the saved PO mapping never being read back, and `normalizeSource`'s `default:` arm labelling unattributed mappings "Manual".
  `LaneDrawer.tsx` `MOCK_CROSSINGS` is ungated but currently unreachable in non-mock (topology is empty). The marketing hero `BridgeIllustration.tsx` uses "Heinrich Industries"/"Acme Components" as illustrative schematic labels (decorative, low risk).
- Group L Wave 2 (Phases 3 + 4.4) is complete on `feat/group-l-phase-3-and-4.4` (pushed, not yet merged to main): `useCookieConsent` hook (`src/lib/cookie-consent.ts`, localStorage + cross-tab event), `CookieConsentBanner` (fixed-position, functional-only / analytics-allowed), `posthog-js@1.376.3` (`src/lib/analytics.ts` consent-gated, no-op when `NEXT_PUBLIC_POSTHOG_KEY` empty), `AnalyticsBoot` (Clerk identify + org group + path-only `$pageview`, mounted inside ClerkProvider branch only to guard against prerender crash). Commits: `3705964` `560cf8c` `384745d`.
- Group L Wave 2 phases 4.5 + 5.1 + 5.2 are complete on branches (not yet merged to main):
  - **Phase 5.1 backend** (`feat/group-l-phase-5.1-onboarding-has-resolved-mapping`): `GET /api/onboarding/status` now returns `hasResolvedMapping` (fourth field between `hasUpload` and `hasDelivery`). Query: `_db.PurchaseOrderLines.AnyAsync(l => l.Order.OrgId == orgId && l.SupplierItemCode != null, ct)`. 195/195 tests pass.
  - **Phase 5.1 frontend** (`feat/group-l-phase-4.5-5.1-5.2-onboarding-wizard`): `OnboardingStatus` interface in `src/types/procurement.ts` has `hasResolvedMapping: boolean` between `hasUpload` and `hasDelivery`. `mockGetOnboardingStatus` in `src/lib/api-client.ts` derives it from order lines.
  - **Phase 5.2 frontend**: `OnboardingWizard.tsx` rewritten as a 4-step wizard (add supplier → upload PO → resolve mapping → configure delivery) driven by `useQuery(["onboarding-status"])`. Entry step is server-derived. `StepIndicator` shows `current/4`. Uses `apiClient.uploadPurchaseOrder(file, supplierId)`; routes to `/inbox/{orderId}` after upload and `/library/suppliers/{id}?tab=delivery` after mapping.
  - **Phase 4.5 frontend**: `capture()` calls from `@/lib/analytics` added to `OnboardingWizard.tsx` (`wizard_opened` on mount, `wizard_step_completed` on each step success, `wizard_dismissed` on close) and `UploadWorkbench.tsx` (`first_upload_started` with `file_kind` only when `!onboardingStatus.hasUpload`).
  - Frontend branch is based on `feat/group-l-phase-3-and-4.4` (cookie consent + PostHog SDK), not main — must be merged in the correct order.

### shadcn/ui

Keep shadcn primitives in `src/components/ui/` — they are dependency infrastructure. The Bridge Layer wraps or reskins them; it does not delete them. Custom Bridge components in `src/components/bridge/`.

---

## 15. How every session runs — token discipline (applies to all sessions and chips)

**Every session in this repo starts in caveman mode and stays in it.** Invoke the `caveman` skill
first, before anything else. Drop articles, filler, pleasantries and hedging in prose. Fragments are
fine.

**Caveman applies to prose only. Never to these:**

- code, commit messages, PR bodies, and user-facing copy — those stay written normally
- security warnings, and confirmations before an irreversible action
- multi-step sequences where fragment order could be misread

Technical substance is never abbreviated: file:line evidence, exact error strings, and command output
stay verbatim.

### Why

Sessions here run long and in parallel. Context exhaustion is the most common cause of work being
abandoned half-finished — a session that runs out mid-packet leaves a branch nobody else can safely
pick up, and twice in one day that meant real work existing only on an unpushed local ref.

### The habits that actually save context

- **Batch independent tool calls into one message.** Two greps that do not depend on each other are
  one round trip, not two.
- **Delegate fan-out reads to subagents**, as many in parallel as the work genuinely splits into. A
  search across many files should return a conclusion, not a file dump.
- **Read the part of the file you need.** Whole-file reads of a 2,000-line component are how a
  session dies at 40% of the task.
- **Never re-derive what is already established.** Read `05-PROGRESS.md` in the master-plan directory
  before re-investigating anything — it carries the correction log and the numbered traps, and most
  dead ends have already been paid for once.
- **Prefer `git grep` from the repo root.** Plain `grep -r` walks `.claude/worktrees/`, which is a
  copy of the repo — hits there mean you searched the wrong tree, not that another branch owns the
  code.
- **Push anything worth keeping, the moment it is committed.** A session's worktree is not storage.
- **Give every scratchpad file a unique name.** The scratchpad path is documented as session-specific
  but does not always resolve that way: on 2026-08-06 two parallel sessions both wrote `pr-body.md`
  under the same temp path and one overwrote the other within a minute. Anything another tool will
  read back — a PR body, a notes file, a JSON dump — carries the branch name or a short suffix
  (`pr-body-fix-parser-locale.md`), never a bare `pr-body.md` / `notes.md` / `out.json`. Piping the
  body straight to `gh pr create --body-file -` avoids the file entirely, but quoting inside the body
  can break the heredoc, so a uniquely named file is the safer default.

### Before dispatching a chip

Check the **open PR set**, not just `main`. A packet's prerequisite may be written, reviewed and
green, and still invisible from `main` — dispatching against `main` alone is how two sessions get sent
to build the same thing (TRAP 27).

Give each chip a scope that is **file-disjoint** from every other chip in flight, and name in its
brief which files belong to someone else.
