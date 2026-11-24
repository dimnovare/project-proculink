# ProcuLink — Frontend Implementation Guide

Read this in full before touching any file. **Code wins over this file**: every claim here was
checked against the tree on 2026-11-24, and where you find a disagreement, trust the code and fix
the doc. Section numbers are stable because code comments cite them (§2, §3, §6, §9, §11.5, §12);
§7 was removed rather than renumbered.

---

## 1. What ProcuLink is

A simple document tool: **any document in → read → checked → transformed → sent**.

- **One way in.** A person drops any document (or it arrives by email, mailbox, SFTP, FTP, S3 or
  the API). Nobody is asked "which flow is this for?" — the machine reads it and sorts it into the
  flow it resembles. A first-of-its-kind document asks one question (do the same every time / just
  this one / it belongs with one you already have). Upload with no flow chosen is
  `POST /api/documents` (backend `InboxController` → `InboxFlow`).
- **Flows** are the repeat setup: what to read, the output files to make (CSV, JSON, XML, Excel,
  PDF, text, fixed-width — `FlowOutputFormats` — plus the standards in `StandardOutputs.cs`: cXML,
  UBL Order, X12 850, EDIFACT ORDERS, and Peppol / EN 16931 / XRechnung invoices behind a
  per-workspace switch),
  and where to send them (destinations: email, SFTP, FTPS, S3, web address, Google Drive / Sheets).
  **Lookups** swap values on the way out.
- **No document kinds as product structure.** No "orders vs invoices" split in anything a user
  reads: it is "document" and "flow" (founder, 2026-11-05 and 2026-11-16).
- **Checks never block a send** (founder, 2026-11-06), with one founder-approved exception: on an
  automatic flow, a failed `duplicate` check (same document number) holds the document for a person.
- Built for bookkeepers and people who are not good with computers: one question per screen, one
  filled button, a sentence under the title saying what to do next, plain words, more only on
  request. Design and test at 390, 1440, 1920 and 2560 px.
- Also an installed app (PWA: `public/sw.js`, `public/site.webmanifest`, `src/lib/pwa/`,
  `src/components/pwa/`) with phone alerts over Web Push (`src/lib/pwa/push.ts`,
  `PhoneAlerts.tsx`; backend `PushDevicesController`).

The old purchase-order product (supplier docks, item-code mapping workbench, `/bridge` dashboard)
was removed in plan 13b (2026-11-13). Old orders stay readable at `/archive`.

**Benchmark (founder):** DocParser — be better, clearer, simpler, smarter, cheaper, quicker.

---

## 1.5 Current state

- Relaunched as the document tool 2026-11-14. Every workspace runs on the document engine.
- Where plans live: `docs/superpowers/plans/` and `docs/superpowers/specs/` in this repo — local,
  **never committed**. Program ledgers live under `.superpowers/` (gitignored, never staged). The
  backend's `STATUS.md` and `docs/superpowers/plans/2026-07-27-v1-master-plan/05-PROGRESS.md`
  carry the older correction log and numbered traps.
- History is `git log`. Do not re-execute old checklists.

---

## 2. Visual direction — "The Bridge Layer" (as shipped)

Direction 4 from the v2 design exploration, **audited against the code on
2026-08-13 and corrected here**. This section used to open with "Do not deviate"
and list five non-negotiable spatial signatures. Three of those five were never
built, and one of them had no component in `src/` at all — so for months every
new screen was being designed against a spec that the product did not implement,
and no guard could catch it because the fiction lived in a document, not in code.
`src/test/struckSignatures.test.ts` reads this section; keep it true.

**Read this table before designing any screen. It is the whole point of §2.**

| Signature | Built? | Where it renders |
|---|---|---|
| **1. Edge rails** — 4px buyer-blue left / supplier-green right, port markers | **NO — STRUCK 2026-08-13** | Nowhere. See below. |
| **2. Wire Topology** — buyer ports left, supplier ports right, animated wires | **DELETED 2026-11-14 (plan 13b)** | Nowhere. Its only host, the `/bridge` "System map" tab, went with the order screens. |
| **3. Canonical Spine review** — 3-column source · spine · output | **NO — DELETED 2026-08-13** | Nowhere. The shipped review is a different layout; see below. |
| **4. Document Anatomy** — source document pane | **PARTLY** | `src/components/bridge/document/` renders the pane. The **per-zone confidence overlay does not exist** and needs backend provenance first. |
| **5. Cross-section card edge** — 3px brand strip on a card edge | **YES, and applied by rule** | `<Card>`, `src/components/bridge/layout/Card.tsx`. The edge is semantic; its rule is in that file's header. |

### 1. Edge rails — STRUCK

The `<EdgeRails>` component was never built into `src/`. Its CSS (`.railed`, `.rail`,
`.rail-port`, `.rail-label`) and Tailwind tokens (`rail`, `z-rails`, `bg-rail-buyer`,
`bg-rail-supplier`) had **zero consumers** and were deleted 2026-08-13. One token survived because
it renders something real: `--gradient-rail-buyer` was **renamed `--gradient-line-buyer`** and draws
the vertical connector through a help guide's numbered step badges
(`src/components/help/guide/Step.tsx`). **Do not reinstate the rails as decoration.**

### What carries buyer-left / supplier-right now

Orientation is carried by **layout and colour**:

1. **The document screen.** `/flows/[flowId]/documents/[documentId]` →
   `src/components/flows/DocumentScreen.tsx`: **"Original"** (blue dot) on the left, then
   **"What we read"** (navy dot) and **"What we'll send"** (green dot) on the right. Below `lg` the
   same three become tabs in the same order.
2. **The mapper.** `/flows/[flowId]/outputs/[outputId]/advanced` →
   `src/components/flows/advanced/AdvancedView.tsx` →
   `src/components/bridge/mapper/MapperWorkbench.tsx` (`variant="flow"`): `IncomingPane`
   **"What we received"** (blue) → `OutgoingPane` **"What we'll send"** (green) →
   `MapperPreviewPane` **"Live preview · {FORMAT}"** (green).
3. **Colour.** Incoming = `#1E66C9`. Outgoing = `#2E8E3A`; on text it darkens to `#1E6D29` for
   contrast (a WCAG fix, not a different colour).

**Source stays left of output. Do not reorder these panes** — the ordering is the orientation.
(The queue's labelled "Buyer → Supplier" column went with the order screens on 2026-11-13.)

### 3. Canonical Spine review — DELETED

`src/components/bridge/CanonicalSpine.tsx` (`<CanonicalSpine>` + `<SpineNode>`) had **zero
importers** and was deleted 2026-08-13 with its `spine: 3px` token. `SpineReview` went earlier
(commit `3520ed4`). **The one rule that survives: the source document stays visible on the left
during review.** Never hide it behind a modal or a wizard step.

### Supporting signatures

- **Navy app chrome / light work area.** Chrome = `#0B1A2F`. Main content = `#F6F7FA`.
- **Link-spine.** 2px blue→green gradient line under the top bar (`bg-link-spine` /
  `--gradient-link-spine`). Distinct from the deleted canonical spine — this one ships.
- **Status as a journey.** 5-node mini-track (In · Read · Check · Transform · Send),
  `<StatusJourney>`, rendered by `DocumentList`, `ActivityRow` and `OrderArchive`.
- **System Identity mark.** An arc with a blue circle on the left end and a green circle on the
  right. Same geometry in loading states and pipeline icons.
- **Monumental numbers — GONE 2026-11-13** with their only consumer, the supplier screen (§6).

### Design workflow

Do not use Lovable. UI/UX decisions run through the local design system, `/frontend-design`,
`ui-ux-pro-max` and Claude Design/reference images. `/frontend-design` sharpens what ships; it does
not invent a new aesthetic or resurrect a struck signature.

⚠ **`docs/design-system/handoff-v2/` in THIS repo is a superseded 2026-05 handoff
snapshot, not a spec.** It still contains the struck signatures (reference `EdgeRails.tsx` /
`CanonicalSpine.tsx`, a `showcase.html` with edge rails). **This section outranks it.** The
backend repo's `docs/design-system/` is a different, current set — note the name collision.

---

## 3. Design tokens

Flat Tailwind keys in `tailwind.config.ts`, mirrored as CSS variables in `src/app/globals.css`
(`scripts/check-tokens.mjs` keeps them in step). Values verified 2026-11-24.

```
brand.blue          #1E66C9   incoming / structure / trust
brand.blue-deep     #0F4FA8
brand.blue-soft     #EAF0F8
brand.blue-bright   #6BA5F0   blue legible on navy
brand.green         #2E8E3A   outgoing / completion (text, icons, dots, borders)
brand.green-btn     #297F34   solid green fill under white text (AA)
brand.green-deep    #1E6D29
brand.green-soft    #E9F1EA
brand.green-bright  #5FC06B   green legible on navy
navy.DEFAULT        #0B1A2F   top bar + navigation panel
navy.surface        #14253D   raised within chrome
navy.border         #1F3252
navy.text           #C8D1E0
navy.muted          #7C8DA6
bg                  #F6F7FA   app background
bgWarm              #F8F6F1   marketing surfaces
surface             #FFFFFF
surface.2           #F1F3F7
border              #E5E8EE
border.strong       #CBD0DA
ink.DEFAULT         #0B1A2F
ink.muted           #5E6779
ink.faint           #667085
amber               #B36D14   (amber.text #8A5310 for text)
amber.soft          #FAF1DD
danger              #B43838   (danger.text #A42F2F)
danger.soft         #FAE6E6
ai                  #6F4FCE   ONLY for AI-generated content
ai.soft             #F0EAFB
```

Tailwind class names are kebab-case: `bg-brand-blue-soft`, not `bg-brand-blueSoft` (an unknown
class compiles to nothing).

**Fonts:** `font-sans` Inter (body, UI) · `font-display` Bricolage Grotesque (titles, marketing) ·
`font-mono` JetBrains Mono (codes, ids, document numbers).

**Background images:** `bg-link-spine` (`#1E66C9` 0–35%, `#2E8E3A` 65–100%) · `bg-bridge-deck` and
`bg-mark-gradient` (`#1E66C9` → `#2E8E3A`). `bg-rail-buyer` / `bg-rail-supplier` were deleted with
the edge rails (§2).

**Spacing:** 4px base. **Radii:** card-sm 6px / card 8px / card-lg 12px. **Shadows:** avoid heavy
drops; cards use borders + `0 1px 2px rgba(11,26,47,0.04)`. **Type scale:** `fontSize` in
`tailwind.config.ts` (body 13px, body-l 14px, h1 32px, display 48px, display-l 78px).

---

## 4. App shell

One navy row on top (`BridgeTopbar`, 52px on phones, 56px from `md`), the link-spine under it, and
three places: **Documents, Flows, Settings**. No breadcrumb row: every page shows its own title,
one helper line and, when it sits under another page, a back link (`PageHeader` `title` / `sub` /
`back`).

| Width | Top bar | Moving between pages |
|---|---|---|
| 1024px and up (`lg`) | mark + wordmark, workspace switcher (`OrgSwitcher`), Documents / Flows / Settings, Upload, Search (Ctrl/Cmd K), Admin (allowlisted only), Help, account | the links in the bar |
| 768 to 1023px | the same without the links, plus a menu button | the menu opens the navigation panel |
| under 768px | mark, workspace switcher, Search, Help | `BottomTabBar`: Documents (needs-you count), Flows, round Add, Settings |

- The nav registry is `NAV_MAIN` in `src/components/bridge/BridgeSidebar.tsx`: Documents
  `/documents`, Flows `/flows`, Lookups `/lookups`, History `/operations/log`, Settings `/settings`.
  `TOP_BAR_HREFS` and `PHONE_TAB_HREFS` are the three places; `TOP_BAR_PARENT` lights Flows for
  `/lookups` and Documents for `/operations/log` and `/archive`. Upload `/upload` is
  `PINNED_ACTION_HREF`. `NAV_TAIL`: Admin (allowlist) and Help & support (`/help`, new tab).
- `BridgeSidebar` renders only inside the navigation panel (the layout's dialog). It is not
  desktop chrome.
- `BottomTabBar` steps aside on full-screen steps (a document, the new-flow guide, change file,
  the Advanced view): `isFullScreenStep()`. Its Add opens `AddSheet`.
- Help opens beside the page (`HelpPanel`); the full help centre is the marketing `/help`.
- Retired URLs never 404: they 308 through `src/lib/retired-routes.ts` (pinned by
  `src/test/retired-routes.test.ts`).

---

## 5. Route structure

```
src/app/
  (home)/page.tsx                 # `/` — public landing page
  (marketing)/                    # pricing, formats, how-it-works, compare, security, help/…, legal pages
  sign-in/[[...sign-in]]/  sign-up/[[...sign-up]]/  onboarding/select-organization/
  (app)/
    layout.tsx                    # BridgeTopbar + navigation panel (BridgeSidebar) + BottomTabBar
    documents/page.tsx            # DocumentsHome — every document, needs-you first
    flows/page.tsx                # FlowsHome
    flows/new/page.tsx            # FirstRun — the new-flow guide
    flows/[flowId]/page.tsx       # FlowPage
    flows/[flowId]/documents/[documentId]/page.tsx       # DocumentScreen
    flows/[flowId]/outputs/[outputId]/advanced/page.tsx  # AdvancedView → MapperWorkbench
    flows/[flowId]/change-file/page.tsx                  # ChooseFile
    lookups/page.tsx  lookups/[lookupId]/page.tsx        # LookupsHome
    upload/page.tsx               # UploadToFlow — one way in
    operations/log/page.tsx       # ActivityPage — "History" in the nav
    archive/page.tsx  archive/[orderId]/page.tsx         # OrderArchive — read-only old orders
    settings/page.tsx             # people, plan & billing, destinations, API keys, notifications, installed app
    settings/google-callback/page.tsx
    admin/page.tsx  admin/guides/…
```

Each `(app)` area also has a `[...missing]` catch-all. `src/middleware.ts` protects the `(app)`
routes via Clerk; `PROCULINK_QA_BYPASS_AUTH=true` bypasses it for local QA only (off in production).

---

## 6. Component library

Shared chrome and primitives live in `src/components/bridge/`; product screens in
`src/components/flows/`, `lookups/`, `activity/`, `archive/`, `pwa/`, `help/`.

### Signature components

| Component | File | Description |
|---|---|---|
| `<Card>` | `bridge/layout/Card.tsx` | **The one card.** 3px cross-section edge by a semantic rule in the file header: `edge="blue"` incoming · `"green"` outgoing · `"bridge"` spans both · `"none"` neutral **or undeterminable** (the default, and the majority). Also `pad` / `radius` / `flush` / `as`. Server-component safe. |
| `<StatusJourney>` | `bridge/StatusJourney.tsx` | 5-node mini-track: In · Read · Check · Transform · Send. Props: `stage` (0–4), `compact?`. |
| `<MarkSystem>` | `bridge/MarkSystem.tsx` | System Identity mark SVG. Also exports a dead `RailPort` (§2). |
| `<BridgeTopbar>` | `bridge/BridgeTopbar.tsx` | The one navy row (§4). Props: `onMenuClick`, `menuOpen`. |
| `<BridgeSidebar>` | `bridge/BridgeSidebar.tsx` | Navigation panel content + the nav registry (§4). Not desktop chrome. |
| `<BottomTabBar>` | `bridge/BottomTabBar.tsx` | Phone tab bar: Documents, Flows, Add, Settings. |
| `<ConfidenceChip>` | `bridge/ConfidenceChip.tsx` | `pct%` badge — ≥90 green, 75–89 amber, <75 red. |

**One signature ships as a CSS class, not a component.**

| Signature | How it actually ships |
|---|---|
| Link-spine | `.link-spine` in `globals.css`, applied by `bridge/BridgeTopbar.tsx`. Gradient `--gradient-link-spine` / `bg-link-spine`, also used by `layout/Card.tsx`, auth and marketing surfaces. There is no `<LinkSpine>`. |

**Removed or never built — do not write code against these:**

| Component | Status |
|---|---|
| `<WireTopology>`, `<FileChip>` | **DELETED 2026-11-14** (plan 13b orphan sweep). |
| `<EdgeRails>` | **STRUCK 2026-08-13** (§2). Never existed in `src/`. |
| `<XCard>` | **FOLDED into `<Card>` 2026-08-13.** Both of its call sites passed `color="amber"` — a tone, not a side — which is how the edge came to mean nothing. |
| shadcn `ui/card.tsx` | **DELETED 2026-08-13.** It competed with the one card. |
| `<CanonicalSpine>` / `<SpineNode>` / `<SpineReview>` | **DELETED** (§2). |
| `OrderWorkshop`, `MobileTriage`, `InboxView`, `SupplierDockProfile`, `UploadWorkbench`, `DashboardContextLine` | Went with the order screens in plan 13b (2026-11-13). |
| Monumental numbers (`.monument`) / `<MonumentNumber>` | **DELETED 2026-11-13** with their only consumer. |
| `<DocumentAnatomy>` | Never built. The document pane is `bridge/document/` (e.g. `PdfDocumentView.tsx`); no per-zone overlay. |
| `<DataField>` | Never built. |

### Primitives

- `<Button>` — `bridge/DSPrimitives.tsx`. Variants: `primary` (navy: makes a change real) / `send`
  (green: sends a document) / `blue` (brings something in) / `secondary` / `ghost` / `danger` /
  `ai` (violet). One filled button per screen. Never gradient.
- `<AiSuggestion>` — `bridge/DSPrimitives.tsx`. Violet left bar, "AI" tag, Accept / Edit / Reject;
  confidence always visible.
- `<StatusNotice>` — `bridge/layout/StatusNotice.tsx`. Four tones (`success` / `error` /
  `working` / `warning`) with their own 3px left border; the ARIA is derived from the tone.
- `<PageHeader>` — `bridge/layout/PageHeader.tsx`. Title, helper line, back link.
- `<CommandPalette>` — `bridge/CommandPalette.tsx`. Ctrl/Cmd K over navigation and the Advanced
  view's mapper commands.
- `<EmptyState>` — `bridge/EmptyState.tsx`. Headline + sub + primary action, no illustration.
- `useConfirm()` — `src/components/ui/confirm.tsx`. Never `window.confirm`.

If you add a component to these tables, `git ls-files` the path first.

---

## 8. Motion

The link-spine fills left → right in 1.2s (`animate-link-spine`, keyframes `link-spine-fill`). All
motion respects `prefers-reduced-motion: reduce`.

---

## 9. Copy / vocabulary

Plain words, sentence case, for bookkeepers. The founder purged the bridge metaphor from all
**user-facing** copy (2026-05-30) and the document-kind split from the product structure
(2026-11-05 / 2026-11-16).

- The product's nouns are **document** and **flow** (plus destination, lookup, output). Document
  kinds (order, invoice, ship notice) are never product structure, though marketing may name them as
  examples of what can be read.
- Nav names: Documents, Flows, Lookups, History, Settings; the pinned action is Upload / Add.
- **Banned in user-facing text** — the lists in `scripts/lib/vocabularyTerms.mjs`, enforced by
  `scripts/check-vocabulary.mjs` and `src/lib/vocabulary.test.ts`: the bridge metaphor (`METAPHOR`:
  bridge, crossing, dock, lane, spine, wire, traveller, topology) and engineering jargon (`JARGON`:
  revision, canonical, artifact, replay, dead-letter, idempotent, tenant, provenance, payload,
  exception, normalised, …). Read the file for the full lists.
- These words survive **only** as code identifiers, CSS tokens and route names.

**Stages:** In · Read · Check · Transform · Send. **AI CTAs:** Accept / Edit / Reject — never "Apply
magic", "AI magic" or sparkles.

---

## 10. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router (`next` 15.5). NO Pages Router. |
| Language | TypeScript, React 18 |
| Styling | Tailwind CSS 3 + shadcn/ui (restyled) |
| State | TanStack Query v5 (all server state). NO `useEffect` for data fetching. |
| Auth | Clerk (`@clerk/nextjs`). Secret keys in `.env.local` only. |
| Monitoring / analytics | Sentry (`@sentry/nextjs`); PostHog (`posthog-js`, consent-gated, `src/lib/analytics.ts`) |
| PDF rendering | `pdfjs-dist` (`bridge/document/PdfDocumentView.tsx`). A JS renderer, not an iframe: `frame-src` in `src/lib/security/csp.ts` allows neither `blob:` nor the API origin, and widening it was considered and rejected. |
| Spreadsheets | **No grid library.** CSV and XLSX are read in-browser by `src/lib/sheetPreview.ts` (`fflate` + `DOMParser`). |
| Tables | Plain tables. `@tanstack/react-table` is still in `package.json` but nothing in `src/` imports it. |
| Mock data | `isApiMockMode` in `src/lib/api/core.ts` (`NEXT_PUBLIC_USE_MOCK=true`, never in production); fixtures in `src/lib/api/mock*.ts` and `src/lib/api-client.ts`. |
| Installed app | `public/sw.js`, `public/site.webmanifest`, `src/lib/pwa/` (install, push, held uploads, offline) |
| Package manager | **bun** (never npm install, never npx — bunx is fine) |
| Hosting | Vercel (frontend) + Railway (backend, .NET 8: API + Worker) |

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

## 11.5 Billing model

**Source of truth is CODE, not this section.** `src/lib/plans.ts` mirrors
`ProcuLink.Core/Constants/PlanConstants.cs`, diffed by `src/test/backendMirror.test.ts`. Re-derive
from there; this summary was verified 2026-11-24.

**Two ladders live in `plans.ts`:**

1. **`PUBLIC_LADDER`** — the only one offered (`/pricing`, sign-up, upgrades): the trial,
   `DOCUMENT_PLANS`, then Enterprise. Backend: `PlanConstants.DocumentLadder`.

   | Plan | Price | Documents | Flows | Extra document |
   |---|---:|---:|---:|---:|
   | Trial (wire id `pilot`) | Free, 30 days (`TRIAL_DAYS`, `PilotDuration`) | 20 total | 2 | — |
   | Starter | €35/mo | 150/month | 5 | €0.24 |
   | Pro | €69/mo | 400/month | 20 | €0.18 |
   | Business | €149/mo | 1,500/month | 100 | €0.10 |
   | Scale | €399/mo | 5,000/month | unlimited | €0.08 |
   | Enterprise | Custom, from €2,500/mo | Custom | Custom | — |

   Every paid document plan has every way in, every output, every check and unlimited users
   (`DOCUMENT_PLAN_FEATURES`); they differ only by documents and flows. Yearly = 10 × monthly. A
   document is one file of up to 10 pages; longer files count once per 10 pages
   (`DOCUMENT_UNIT_SENTENCE`, backend `ReadLimits`).

2. **`PLANS`** — the legacy order-era ladder: Growth €149 / Operations €399 / Integration €999 /
   Distributor €1,499, all `hidden: true`, `LEGACY_PAID_PLANS`. **Existing payers only**; they keep
   their price until they change plan. Never offer them. `PLANS` also holds the trial (`pilot`)
   and Enterprise rows the public ladder reuses. Legacy overage is €0.50/order
   (`OVERAGE_PER_ORDER_EUR`).

Rules:

- The trial is not free forever. After 30 days or 20 documents it is view-only: previous documents,
  outputs and billing stay readable, nothing new is processed.
- The document limit is a **soft cap on paid plans**: going over never blocks; extra documents
  accrue the plan's rate, capped at the cheapest plan covering the volume
  (`bestPriceOverageUnits` = `PlanConstants.BestPriceOverageOrders`). Only the trial's cap is hard.
- The next plan to offer comes from `nextPlanFor()` / `PLANS[plan].next` — a trial on the document
  ladder is offered Starter. **A tier name or an allowance typed into a banner is the defect**:
  derive it. `next` is null at the top of a ladder and on Enterprise; that is a real branch (contact
  us), never a cheaper tier.
- **Cancelling or a failed payment stops intake**, and `/pricing` must say so. The blocking surface
  is gated on **`!status.canProcessOrders`** from the server — never on a plan name (a plan-name
  check once hid a `past_due` paid workspace's pause). Copy lives in `src/lib/billingPause.ts` and
  `BillingSection.tsx`; `read_only` stays vague on purpose because the backend folds Stripe
  `paused`, `canceled` and a deleted subscription into it.

**Refusal payloads.**

- **Quota 429** — `{ error, plan, limit, upgradeUrl }`. Document intake (`POST /api/documents`,
  `POST /api/flows/{flowId}/documents`, `POST /api/v1/flows/{flowId}/documents`, all through
  `IntakeResults.cs`) answers `pilot_expired`, `order_limit_reached` or `processing_paused`.
  `flow_limit_reached` comes from flow creation (`FlowsController`, and `InboxController` set-up).
  Match codes **whole**, never by substring; copy is in `src/lib/documentRefusals.ts`. The one
  exception is the global rate limiter (`Program.cs`), which writes a prose sentence with no code
  (`"Rate limit exceeded. Please slow down and retry shortly."`) — prose sniffing is legitimate
  there and nowhere else.
- **Plan-gate 403** — `{ error: "<capability>_requires_<plan>", upgradeUrl }`, built by
  `BillingGateErrors`. **Nothing in production emits one today**: since plan 14
  `PlanConstants.MinimumPlan` holds one presentation-only row (`Sso` = Enterprise) that refuses
  nothing. The parser stays (`isPlanGateError` / `planGateMessage` in `src/lib/planGate.ts`); if a
  gate comes back, never match its code by full literal — the plan segment is derived server-side.

**Offer ⇔ works.** A capability may be listed on a tier only if the backend really gates it there.
History (`GET /api/audit`) and a document's own history (`GET /api/documents/{id}/history`) are
open on every plan, the trial included, so no card may sell either. SSO is **not** sold until a
Settings SSO surface exists. Enforced by `src/test/gatedCapabilityClaims.test.ts` here and, in the
backend, `BillingGateEnforcementIsRealTests` (reads compiled IL). Do not add a bullet for a
capability nothing enforces.

---

## 12. Anti-patterns (refuse to build)

- Big editorial serif inside the app (kept for marketing accents only)
- Decorative gradient backgrounds, sparkle icons, illustrated mascots, glassmorphism
- Modals when a drawer or inline editor will do
- Modal wizards that hide the source file during review
- ~~"Good morning, Maria" greetings on the dashboard~~ — **OVERRIDDEN by the founder, 2026-07.**
  A compact first-name greeting is allowed. Its implementation, `DashboardContextLine.tsx`, went
  with the order dashboard in plan 13b; nothing greets today. If one is rebuilt, keep the point of
  the original rule: compact, never pushes the list down, and never shows a number before it has
  loaded.
- Auto-applying AI corrections without a visible accept step
- Notched corners everywhere — use `<Card>`'s cross-section edge instead
- **A card edge used as a status colour.** The edge says which SIDE a card is on (incoming /
  outgoing / both / neither). Tone — amber, danger, violet-AI — belongs to `<StatusNotice>`, which
  signals it with its own 3px left border. Both real `<XCard>` call sites before 2026-08-13 passed
  `color="amber"`, which is precisely why the signature carried no information.
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
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  → .env.local
CLERK_SECRET_KEY           → .env.local only (gitignored)
NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_POSTHOG_KEY → .env / Vercel
```

Frontend port: **8082** (Playwright and CI use it; `PLAYWRIGHT_PORT` overrides). API port: **5223**.

---

## 14. Implementation notes

- Local protected-route QA: `PROCULINK_QA_BYPASS_AUTH=true bun run dev -- --hostname 127.0.0.1 --port 8082`
  (the API needs it too, and `NEXT_PUBLIC_QA_BYPASS_AUTH=true` or tenant queries never fire).
  Disabled in production by `NODE_ENV`.
- Playwright for UI QA; local screenshots go in `.qa-screenshots/` (gitignored). Vitest + RTL for
  behaviour. jsdom mounts both breakpoint trees (no Tailwind), so scope queries with `within(...)`.
- Delivery UI must never imply a document was sent because an output file exists. Statuses are the
  backend's (`received`, `reading`, `read_failed`, `needs_review`, `ready`, `sending`, `sent`,
  `send_failed`), mirrored in `src/lib/documentStatusManifest.ts`.
- Old v2 prototype (`Downloads\v2-bridge-review\`) predates the 2026-08-13 audit and implements the
  struck signatures. **Do not port from it.**
- Keep shadcn primitives in `src/components/ui/` — they are dependency infrastructure. The Bridge
  Layer wraps or reskins them; it does not delete them.

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
