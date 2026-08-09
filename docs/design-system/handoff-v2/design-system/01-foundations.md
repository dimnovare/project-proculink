# 01 — Foundations

## What ProcuLink is

ProcuLink is an **AI-assisted order-transformation bridge**. It sits between buyers, suppliers, ERPs, and procurement systems. It ingests messy purchase orders (PDF, Excel, CSV, XML, cXML, EDI, JSON, email), normalizes them into a canonical PO model, validates them against supplier-specific rules, lets a human review only the exceptions, and emits a clean supplier- or buyer-ready output.

**Tagline:** *"Connecting Procurement — the missing link between buyers and suppliers."*

**Marketing line:** *"Buyers on one side. Suppliers on the other. We are the bridge."*

## What it is *not*

A chatbot · a generic PDF parser · a Zapier clone · a marketplace · a procurement CRM · only a PunchOut tool.

It **is** a vertical integration workbench for order documents and supplier-specific transformation rules.

## Who uses it

- Order-processing operators at distributors, wholesalers, IT resellers, industrial/medical/building suppliers
- Integration specialists who maintain supplier mappings and validation rules
- Procurement managers who watch the flow across all suppliers

They are **power users**. They know SKUs, EDI segments, cXML payloads, PunchOut quirks. Treat them as such.

## Core loop

```
Parse → Normalize → Validate → Review → Transform → Deliver → Learn
```

Every screen serves this loop. Every screen makes the underlying order visible. We never hide the source file behind a wizard.

## Design principles

### 1. The product is a bridge — and shows itself as one
Every order-handling surface has visible architecture: edge rails frame the work area, the canonical spine sits at the center of the review screen, wires arc between buyer and supplier ports on the dashboard. The metaphor is structural, not decorative — and it is **structural only**. It shapes layout, tokens and component names; it never becomes a word the user reads. See *Vocabulary* below.

### 2. Operator workbench, not marketing site
Density over whitespace. Information per pixel matters. We are not selling — we are working. Bodies are 13–14px; tables run 36px rows; the inbox shows 30+ orders above the fold.

### 3. Show the data
Every screen makes the underlying order, mapping, or rule visible. No tooltip if a column will do. No modal if an inline editor will do.

### 4. Exceptions, not everything
Default views surface only what needs human attention. Everything that passed silently is collapsed.

### 5. Provenance everywhere
Every AI suggestion shows confidence, source, and a one-click "show me where this came from in the source file." We never auto-apply.

### 6. Keyboard-first
Every list, mapping, and review action has a shortcut. Tooltips show them.

### 7. Trust through transparency
Failures are loud, recoverable, and explained. Auto-process is per-supplier, deliberate, audited.

### 8. Restraint with color
Blue = buyer / incoming / structure. Green = supplier / outgoing / completion. Violet = AI-generated content. Amber = warning. Red = error. Nothing else. Ever.

### 9. The mark is one expression of a system
The brand is not a logo glued to a SaaS app. The link-spine, the edge rails, the stage glyphs, the loading state, and the logo are all the same shape language.

### 10. Motion communicates state, not flair
Six motion patterns, each with a single job. All respect `prefers-reduced-motion`.

## Brand voice

| Trait | Example | Anti-example |
|---|---|---|
| **Operational, not aspirational** | "Send to supplier" | "Transform your procurement" |
| **Specific, not generic** | "1m 42s average time to delivery" | "Lightning-fast" |
| **Plain word, not coined term** | "order", "supplier", "delivery" | "crossing", "dock", "lane" |
| **Plain English, not jargon-padded** | "Auto-process is OFF for this supplier" | "AI-powered intelligent routing" |
| **Honest about limits** | "AI suggests ACM-PLT-200×200×4 (84%)" | "Smart matching" |
| **Direct, not chatty** | "Acme rejects negative quantities." | "Hmm, looks like Acme might not love that quantity." |

## Vocabulary

> **Corrected 2026-08-09.** This table used to say "use these terms consistently" and listed the
> bridge metaphor as product vocabulary. The founder purged it from user-facing copy
> (CLAUDE.md §9). See `07-content.md` for the full content rules; the authority is
> `src/lib/vocabulary.ts`, enforced by `bun run lint:vocab`.

**What a user reads** — plain procurement words:

| Term | Meaning |
|---|---|
| **Order** | A single purchase order and its trip through the pipeline (parse → deliver). |
| **Supplier** / **Buyer** | The counterparty at each end. |
| **Delivery** | Sending the output on the supplier's channel. |
| **Output** | The supplier-ready file (cXML, CSV, EDI, etc.) we produce. |
| **Item code** | A buyer-SKU ↔ supplier-SKU pairing. |
| **Order layout** | The per-supplier field layout of the output. |
| **Issue** | Something a human has to resolve on an order. |

**Internal only** — allowed in component names, tokens and routes, never in a user-visible string:

| Term | Meaning |
|---|---|
| **Bridge** | The system itself. Also the dashboard route, `/bridge`. |
| **Crossing** | One order's transit. Survives in `CrossingsLog.tsx`. |
| **Dock** | A supplier or buyer endpoint. Survives in `SupplierDockProfile.tsx`. |
| **Lane** | A buyer↔supplier pairing. Survives in `LaneDrawer.tsx`. |
| **Spine** | The canonical PO model, rendered as the center column on the review screen. `CanonicalSpine`, `bg-link-spine`. |
| **Anatomy** | The source-document zone overlay. `DocumentAnatomy.tsx`. |
| **Wire** | A buyer↔supplier connection drawn on the dashboard. `WireTopology.tsx`. |

## Trust rules (designed in, not aspirational)

1. **Provenance everywhere** — every AI suggestion has confidence + source attribution + a one-click jump to the matching source zone.
2. **No silent automation** — Auto-process is per-supplier, opt-in, with a visible audit trail in the delivery log (`/operations/log`, shipped title "Deliveries"). Never a default.
3. **Failure is loud, recoverable, and explained** — the Failed view is the most useful screen in the product. Every failure shows what the supplier said, what we sent, what we'd retry, and a one-click fix-and-resend.

These are not principles; they are non-negotiable product rules.
