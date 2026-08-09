# Bridge Layer — canonical fidelity gap tracker

Source of truth = the Claude Design export the founder provided
(`C:\Users\Dmitri.MARKIT\Downloads\design-ref\proculink2\app\` code + `screencapture\` renders).
Generated from a 12-agent canonical comparison (2026-05-30). Full raw findings:
the workflow output `tasks\whjkc10f4.output`.

**Reconciliation rule (founder, 2026-05-30): KEEP shipped features, ADOPT the canonical look.**
Where the mockup is stale or simpler than reality, keep the real feature and only restyle.
*(This rule said "look + voice". The voice half is superseded — see below.)*

**Voice — SUPERSEDED. Read this before acting on any entry below.**
This tracker originally told implementers to adopt a bridge-metaphor voice and to replace
"Send to supplier" with "Cross the bridge →". **That instruction is dead.** The founder purged
`crossing`, `dock`, `lane`, `spine` and "Cross the bridge" from every user-facing string
(CLAUDE.md §9). Those words survive **only** as code identifiers (`SupplierDockProfile.tsx`,
`CanonicalSpine`), CSS/design tokens (`bg-link-spine`), and route names (`/bridge`).

The rule now:

- **User-facing text uses plain procurement vocabulary** — order, supplier, buyer, item code,
  delivery, issue. The approved set is code, not prose: `src/lib/vocabulary.ts`, enforced by
  `bun run lint:vocab` (`scripts/check-vocabulary.mjs`). Read the registry; do not hand-copy a
  word list out of this file.
- **"Send to supplier" is the shipped primary action**, not something to replace
  (`src/components/bridge/mapper/MapperWorkbench.tsx:1005`).
- The bridge metaphor is still **locked as spatial architecture** — edge rails, wire topology,
  the review screen's three columns, the link-spine gradient. It governs layout and component
  names. It does not govern words a user reads.

Entries below are a **record of the 2026-05-30 pass, not a to-do for its copy.** Their layout,
component and behaviour items still stand. Where an entry records copy that has since been
replaced, the shipped string is noted inline as `→ shipped as "…"`. Never restore a purged word
from this file.

Legend: `[ ]` todo · `[x]` done · `(KEEP)` = do not regress to mockup.

## Foundations — shared primitives ✅ DONE (commit on feat/bridge-layer-redesign)
- [x] `DSPrimitives.tsx` Button heights → sm 27 / md 32 / lg 38; add `blue` + `green` variants.
- [x] `DSPrimitives.tsx` StatusPill: `new` → grey (surface-2/ink-muted), add `delivering` (blue, pulsing dot).
- [x] `DSPrimitives.tsx` AiSuggestion → canonical structure (AI·% tag + provenance row, title, body, actions).
- [x] `MarkSystem.tsx` → canonical open-hook mark path (`M8 10h14a10 10 0 0 1 10 10…`), blue dot cy=10 / green dot cy=30 (not a symmetric ellipse).
- [x] `EmptyState.tsx` → bare Mark size 52/40 + hover opacity 0.7→1 (drop the 56×56 grey box).
- [x] `FileChip.tsx` → canonical `src-*` colors; consolidate with `DSPrimitives` SrcChip (one palette).
- [x] `StatusJourney.tsx` → 5 stages Parse/Normalize/Validate/Transform/Deliver; `extracting` pill blue (not violet).
- [x] `XCard.tsx` → implement (or remove) the no-op `dense` prop.

> NOTE: many screens render status/chips INLINE rather than via these shared primitives
> (e.g. InboxView). Foundations ripple only to consumers; the rest are fixed at the screen level.

## Major-divergence screens
### Buyers + delivery log ✅ DONE (verified in mock preview, tsc-clean)
- [x] Buyers (`/library/buyers`): heading + sub; table (Buyer / Formats / Volume / Last order). Inbound-channel→Formats, Suppliers-reached omitted, This-week dropped (no BuyerDto fields). Kept /inbox filter (no buyer-detail route) + name/code create (real API). *(The heading landed as "Buyer docks"; → shipped as `"Buyers"`, `src/lib/pageTitles.ts`.)*
- [x] Delivery log (`/operations/log`): date-grouped table rows (time | event | PO | format | buyer→supplier | actor); filter labels aligned to the canonical order model; expanded actions View order + Export entry + Retry(failed). Multi-day grouping. Route bug fixed: /orders→/inbox. *(→ shipped as `"Deliveries"`; the component keeps the old name `CrossingsLog.tsx` — a code identifier, which is allowed.)*

### Rules + Templates + Standards + Mappings ✅ DONE (tsc-clean; HTTP 200 + hydrated-DOM verified on :8082 mock)
- [x] Rules: "Validation rules"; split-detail (table + sticky inline editor) not grid+modal; columns Rule/Scope/Severity/Triggered 30d/Active; sub "Block bad orders before they reach a supplier · N active". Scope = real `entity` field; Supplier column omitted (no per-rule supplier binding in RuleDto — don't fabricate). KEEP live list/toggle/save/delete wiring.
- [x] Templates: split-list (cards left + code-preview panel right with `{token}` violet highlighting, Export/Edit) not grid+modal; card shows per-standard description + the supplier it is assigned to. Preview is illustrative per-format (TemplateDto has no body). KEEP live create/update/delete + editor modal. (Preview panel + Edit button are client-rendered on selection — absent from SSR HTML by design.)
- [x] Standards: cross-format field TABLE reusing real `FIELD_STANDARDS` + `STANDARD_REF_COLUMNS` (Canonical field + UBL/Peppol BIS/EDIFACT/X12/cXML — no ISO column; ISO 20022 is reference-only in the catalog, don't fabricate paths); inline field search; "Request a format" footer → /support. (aligns with standards-visibility product rule)
- [x] Removed "Group J" / dev language from MappingEditor, ValidationRules, Templates user-visible copy.

### Settings + Billing ✅ DONE (tsc-clean; ⚠️ visual smoke-test pending — preview server crashed this session)
- [x] Nav icons (Building/Euro/Mail/Key/Plug) + canonical labels (Organization / Billing & plan / Email intake / API keys / Connectors); active = card-shadow + 2px blue left border.
- [x] Removed "Team — coming soon" stub tab.
- [x] Billing: large highlighted PlanCard (price + order-usage gradient bar) + Payment-method card bound to Stripe Portal (no fake card #). KEPT Stripe Checkout/Portal + locked pricing + LimitBanner.
- [x] Email intake: KEPT full IMAP form; canonical section framing/copy. (useEffect-sync left as-is, low-risk.)
- [x] Connectors: KEPT Zapier/Make + webhook CRUD; chrome restyled to tokens (Make logo keeps brand color); added missing error states on API-keys + integrations queries.
- [x] Organization: added Workspace region "EU (Frankfurt)"; Members row omitted (no real API — don't fabricate).

> ✅ /settings smoke-test PASSED (mock preview, 2026-05-30 fresh session): renders 200; canonical tabs Organization / Billing & plan / Email intake / API keys / Connectors with icons; **no Team tab**; Organization shows Workspace + "EU (Frankfurt)"; Email intake tab shows the full IMAP form (host/port/password) intact; Billing & plan tab renders plan card + portal CTA with no runtime error. (Preview QA note: the harness spawns a 2nd Next dev server on :3000 that races the existing :8082 on a shared `.next`, corrupting the route manifest — verify via the single :8082 server or stop the competitor; screenshots hang under contention, DOM evals + HTTP are reliable.)

### Connectors + Webhooks ✅ DONE (verified in mock preview, tsc-clean)
- [x] Connectors: icon-card grid (icon tile + status pill + name/desc + connected-supplier count + Manage/Connect); "Add connector" blue; sub "ERP and channel integrations · N connected". KEEP Erply/Directo + test-fire. count/desc mock-only → graceful in live. *(→ shipped as `"Delivery channels"`, `src/lib/pageTitles.ts`.)*
- [x] Webhooks: two-column split (Endpoints + Recent deliveries table); Healthy/Failing pills; "Add endpoint"; test-ping note. Deliveries = mock / empty-state live (no history API). Signing-secret field WIRED live (createIntegration accepts `secret`; agent had wrongly disabled it).

### Marketing (home / pricing / how-it-works / security)
- [x] Nav: navy bg + white links (How it works / Pricing / Security only) + blue "Get started free"; mobile menu. (MarketingNav.tsx — verified rendering on /how-it-works + /security)
- [x] Footer (marketing layout + home): multi-column navy (Product/Company/Legal + brand blurb + systems-operational dot + EU-residency bottom bar).
- [x] Home: two-color hero words (buyers #6BA5F0 / suppliers #5FC06B); logo strip; customer testimonial; 6th feature "Standards, on demand"; navy multi-column footer. ⚠️ Home `/` currently 500s in mock preview — caused by a CONCURRENT session's in-flight ROICalculator/billing edit (uncommitted), NOT this code. My page.tsx is tsc-clean. NOT DONE: hero-stage Topology/Spine toggle (kept existing BridgeIllustration — animated toggle deferred).
- [ ] Pricing: **OWNED BY A CONCURRENT SESSION** (actively adding a `distributor` plan — pricing/page.tsx + BillingSection.tsx + procurement.ts uncommitted + breaking global tsc). Left untouched to avoid clobber. Re-do navy hero / a per-order pricing headline in plain words ("crossed" is purged — say what the customer pays for, e.g. orders processed) / yearly toggle / FAQ / navy CTA band AFTER they land.
- [x] How It Works: hero H1 "From any purchase order to a delivered supplier document" + a CTA → /watch. (Kept the existing 5-step pipeline + alternating steps; animated HeroSpine deferred — static pipeline bar is the equivalent.) *(The H1 shipped as written. The CTA landed as "Walk through a real crossing"; → shipped as `"Watch the walkthrough"`, `src/app/(marketing)/how-it-works/page.tsx:379`.)*
- [x] Security: navy hero; 6 posture cards (added EU data residency + Backups & recovery to the existing 4); Compliance status table (+ Subprocessors links); navy CTA band.

## Minor-divergence screens
### Dashboard — ⏳ NOT DONE (deferred — larger; needs BridgeDashboard + KPI data work)
*(This section was headed "Dashboard / Order topology". "Order topology" is an internal name for
the wire diagram and must not ship as a heading — CLAUDE.md §12. → shipped as `"Dashboard"`
(browser title) / `"Overview"` (hub tab), `src/lib/pageTitles.ts`.)*
- [ ] KPIs: add a cycle-time stat if the data exists, and fix the stat order. Topology in a card with 2px gradient top bar; StatusJourney strips on in-transit rows; collapsible bottom panels; a dynamic subtitle carrying the live counts. *(The original entry asked for "Orders crossed / Avg crossing time" labels and a "N lanes" subtitle — purged vocabulary, do not build it. → shipped stat labels are `Received` / `Needs review` / `Ready to send` / `Queued to send` / `Delivered` / `Failed`, `src/components/bridge/BridgeDashboard.tsx:1165-1179`.)*
- [ ] WireTopology: buyer port fill white; 3-square legend (Buyer/Supplier/At-risk); wider viewBox proportions.

### Inbox ✅ DONE (verified on :8082 mock)
- [x] Filter chips → All orders / Needs review / Ready / Delivering / Delivered / Failed (dropped New + Extracting chips, renamed Sent→Delivered, added Delivering); subtitle "N orders · M need review · K failed". (AI-chip gating left as-is — lower priority.)

### Order review — ⏳ NOT DONE (deferred — larger; CanonicalSpine/SpineReview header rework)
*(`CanonicalSpine` / `SpineReview` are component names and stay. The screen is "order review" to a user.)*
- [ ] Header: large mono PO + StatusPill + buyer→supplier + inline journey + the primary send CTA (consistent desktop+mobile); amber exception banner; edge rails with port dots + labels; output panel cXML/JSON segmented toggle + delivery footer; AI card with Accept/**Edit**/Reject; bottom keyboard-hints bar. (KEEP real send wiring; make CTA actually deliver) *(The original entry named the CTA "Cross the bridge" — purged. → shipped as `"Send to supplier"`, `src/components/bridge/mapper/MapperWorkbench.tsx:1005`.)*

### Supplier detail — ⏳ NOT DONE (deferred — larger; SupplierDockProfile overview/tabs rework)
*(`SupplierDockProfile.tsx` is a component name and stays; the screen is "Supplier" to a user.)*
- [ ] Overview: KPI monument cards (Total orders/Avg cycle/Exception rate/Acceptance) + a supplier summary + recent orders; Mappings tab → real table (not stub); Delivery: keep protocols **(KEEP Erply/Directo/SFTP/FTP)** + add Auto-process card with amber warning; truck icon; a supplier-settings button; channel + Auto-process header pill; plain-language delivery copy (no `ready_to_deliver`). *(The original entry said "Dock summary" / "Recent crossings" / "Dock settings" — purged; use supplier/order words. → shipped tab labels are `Overview` / `Item codes` / `Catalog` / `Order layout` / `Delivery` / `Rules` / `Changes`, `src/components/bridge/SupplierDockProfile.tsx:117-126`.)*

### App shell ✅ PARTIAL (verified on :8082 mock)
- [x] Added Drafts (Workbench group) + Help (bottom, near Settings) nav items; crumb labels aligned to shipped names ("Validation rules", + Standards). KEEP Inbound group. *(This pass also set `bridge → "Order topology"` and `log → "Crossings log"`. Both purged. → shipped as `"Dashboard"`/`"Overview"` and `"Deliveries"`; nav and crumb labels are owned by `src/lib/pageTitles.ts` + `HUB_TABS` and policed by `bun run lint:vocab --nouns` against `src/lib/vocabulary.ts`.)*
- [ ] Remaining (deferred): sidebar 236px width; link-spine re-animates per route; unread dot amber; notif rows 28px icon circles; a "View all deliveries" link into `/operations/log`; cmdk "Go to" group + named icons + brand footer.

### Upload + Onboarding ✅ PARTIAL (verified on :8082 mock)
- [x] Page title + subtitle restyled. *(This pass shipped the title as "Cross a new order" with a matching subtitle — purged. → shipped as `"Upload an order"`, `src/components/bridge/UploadWorkbench.tsx:914`.)*
- [ ] Remaining (deferred): railed layout; 5-stage pipeline (add Deliver); dropzone copy + full format list + taller padding.

### Design primitives — see Foundations above.
