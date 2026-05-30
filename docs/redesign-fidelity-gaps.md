# Bridge Layer — canonical fidelity gap tracker

Source of truth = the Claude Design export the founder provided
(`C:\Users\Dmitri.MARKIT\Downloads\design-ref\proculink2\app\` code + `screencapture\` renders).
Generated from a 12-agent canonical comparison (2026-05-30). Full raw findings:
the workflow output `tasks\whjkc10f4.output`.

**Reconciliation rule (founder, 2026-05-30): KEEP shipped features, ADOPT the canonical look + voice.**
Where the mockup is stale or simpler than reality, keep the real feature and only restyle/recopy.

**Voice:** the canonical metaphor is *crossing* (buyers → bridge → suppliers). Replace generic
SaaS wording ("Upload Workbench", "Send to supplier", "Orders received") with the canonical voice.

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
### Buyers + Crossings ✅ DONE (verified in mock preview, tsc-clean)
- [x] Buyers: "Buyer docks" + sub; table (Buyer / Formats / Volume / Last order). Inbound-channel→Formats, Suppliers-reached omitted, This-week dropped (no BuyerDto fields). Kept /inbox filter (no buyer-detail route) + name/code create (real API).
- [x] Crossings: date-grouped table rows (time | event | PO | format | buyer→supplier | actor); canonical filter vocab; expanded actions View order + Export entry + Retry(failed). Multi-day grouping. Route bug fixed: /orders→/inbox.

### Rules + Templates + Standards + Mappings ✅ DONE (tsc-clean; HTTP 200 + hydrated-DOM verified on :8082 mock)
- [x] Rules: "Validation rules"; split-detail (table + sticky inline editor) not grid+modal; columns Rule/Scope/Severity/Triggered 30d/Active; sub "Block bad orders before they reach a supplier · N active". Scope = real `entity` field; Supplier column omitted (no per-rule supplier binding in RuleDto — don't fabricate). KEEP live list/toggle/save/delete wiring.
- [x] Templates: split-list (cards left + code-preview panel right with `{token}` violet highlighting, Export/Edit) not grid+modal; card shows per-standard description + dock assignment. Preview is illustrative per-format (TemplateDto has no body). KEEP live create/update/delete + editor modal. (Preview panel + Edit button are client-rendered on selection — absent from SSR HTML by design.)
- [x] Standards: cross-format field TABLE reusing real `FIELD_STANDARDS` + `STANDARD_REF_COLUMNS` (Canonical field + UBL/Peppol BIS/EDIFACT/X12/cXML — no ISO column; ISO 20022 is reference-only in the catalog, don't fabricate paths); inline field search; "Request a format" footer → /support. (aligns with standards-visibility product rule)
- [x] Removed "Group J" / dev language from MappingEditor, ValidationRules, Templates user-visible copy.

### Settings + Billing ✅ DONE (tsc-clean; ⚠️ visual smoke-test pending — preview server crashed this session)
- [x] Nav icons (Building/Euro/Mail/Key/Plug) + canonical labels (Organization / Billing & plan / Email intake / API keys / Connectors); active = card-shadow + 2px blue left border.
- [x] Removed "Team — coming soon" stub tab.
- [x] Billing: large highlighted PlanCard (price + crossings usage gradient bar) + Payment-method card bound to Stripe Portal (no fake card #). KEPT Stripe Checkout/Portal + locked pricing + LimitBanner.
- [x] Email intake: KEPT full IMAP form; canonical section framing/copy. (useEffect-sync left as-is, low-risk.)
- [x] Connectors: KEPT Zapier/Make + webhook CRUD; chrome restyled to tokens (Make logo keeps brand color); added missing error states on API-keys + integrations queries.
- [x] Organization: added Workspace region "EU (Frankfurt)"; Members row omitted (no real API — don't fabricate).

> ⚠️ The /settings route coincided with a dev-server crash (resource exhaustion after a long session — tsc clean, no console errors, so NOT a code error). Re-run the mock preview and smoke-test /settings (nav icons, no Team tab, Billing plan card, IMAP form intact) in a fresh session.

### Connectors + Webhooks ✅ DONE (verified in mock preview, tsc-clean)
- [x] Connectors: icon-card grid (icon tile + status pill + name/desc + dock count + Manage/Connect); "Add connector" blue; sub "ERP and channel integrations · N connected". KEEP Erply/Directo + test-fire. dock-count/desc mock-only → graceful in live.
- [x] Webhooks: two-column split (Endpoints + Recent deliveries table); Healthy/Failing pills; "Add endpoint"; test-ping note. Deliveries = mock / empty-state live (no history API). Signing-secret field WIRED live (createIntegration accepts `secret`; agent had wrongly disabled it).

### Marketing (home / pricing / how-it-works / security)
- [ ] Nav: navy bg + white links + blue "Get started free"; links How it works / Pricing / Security only.
- [ ] Home: two-color hero words (buyers #6BA5F0 / suppliers #5FC06B); hero-stage (titlebar + Topology/Spine toggle + animated topology); logo strip; testimonial+stats; 6th feature "Standards, on demand"; multi-column navy footer.
- [ ] Pricing: **(KEEP locked ladder Growth/Operations/Integration €999)**; adopt navy hero, headline "Pay for orders crossed, nothing else", monthly/yearly toggle (only if backend supports yearly — else skip), bottom navy CTA band, canonical FAQ.
- [ ] How It Works: hero H1 "From any purchase order to a delivered supplier document" + animated HeroSpine; single-column numbered steps with format chips; "Walk through a real crossing" CTA.
- [ ] Security: navy hero; 6 posture cards; Compliance/Subprocessors tables; navy CTA band.

## Minor-divergence screens
### Dashboard / Order topology
- [ ] KPIs → Orders crossed / Avg crossing time / Urgent exceptions / Auto-processed (fix "Orders received" label, add crossing-time if data exists, fix order); topology in a card with 2px gradient top bar; StatusJourney strips on in-transit rows; collapsible bottom panels; dynamic subtitle "Live wire view · N lanes · N suppliers · updated…".
- [ ] WireTopology: buyer port fill white; 3-square legend (Buyer/Supplier/At-risk); wider viewBox proportions.

### Inbox
- [ ] Filter chips → All orders/Needs review/Ready/Delivering/Delivered/Failed; subtitle "N orders · M need review · K failed"; AI chip gated on real ai flag (not assigned≠—).

### Canonical Spine review
- [ ] Header: large mono PO + StatusPill + buyer→supplier + inline journey + "Cross the bridge" CTA (consistent desktop+mobile); amber exception banner; edge rails with port dots + labels; output panel cXML/JSON segmented toggle + delivery footer; AI card with Accept/**Edit**/Reject; bottom keyboard-hints bar. (KEEP real send wiring; make CTA actually deliver)

### Supplier dock
- [ ] Overview: KPI monument cards (Total orders/Avg cycle/Exception rate/Acceptance) + Dock summary + Recent crossings; Mappings tab → real table (not stub); Delivery: keep protocols **(KEEP Erply/Directo/SFTP/FTP)** + add Auto-process card with amber warning; truck icon; Dock settings button; channel + Auto-process header pill; plain-language delivery copy (no `ready_to_deliver`).

### App shell
- [ ] Add Drafts + Help nav items; sidebar 236px; link-spine re-animates per route; crumb /bridge → "Order topology"; unread dot amber; notif rows 28px icon circles; "View all in crossings log"; cmdk "Go to" group + named icons + brand footer. (KEEP Inbound group — real Wave 3)

### Upload + Onboarding
- [ ] Title "Cross a new order" + canonical subtitle; railed layout; 5-stage pipeline (add Deliver); dropzone copy + full format list + taller padding.

### Design primitives — see Foundations above.
