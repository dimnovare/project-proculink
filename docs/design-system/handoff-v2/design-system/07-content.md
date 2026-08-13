# 07 — Content & Copy

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

> **Corrected 2026-08-09.** This page originally taught a bridge-metaphor voice —
> *crossing*, *dock*, *lane*, *spine*, "Cross the bridge →". The founder purged all of it from
> user-facing copy (CLAUDE.md §9). Those words survive only as **code identifiers**, **CSS/design
> tokens** and **route names**. The tone rules, the confirm structure and the don'ts below are
> unchanged and still correct — only the words were wrong.
>
> The approved word list is **code, not prose**: `src/lib/vocabulary.ts`, enforced by
> `bun run lint:vocab` (`scripts/check-vocabulary.mjs`). Read the registry before inventing a
> label; the tables here are illustrative, not the authority.

## Vocabulary

### What a user reads

Plain procurement words. Nine approved nouns, defined in `src/lib/vocabulary.ts`.

| Term | Meaning | Avoid |
|---|---|---|
| **Order** | A single purchase order and its trip through the pipeline | Run, job, task, crossing |
| **Supplier** / **Buyer** | The counterparty at each end | Account, organization, dock |
| **Item code** | A buyer-SKU ↔ supplier-SKU pairing | Translation, mapping rule |
| **Order layout** | The per-supplier field layout of the output | Spine, schema |
| **Output** | The supplier-ready file we produce | Result, export |
| **Delivery** | Sending the output on the supplier's channel | Crossing, transit |
| **Rule** | A validation rule | Constraint, policy |
| **Issue** | Something a human has to resolve on an order | Error, exception (in UI copy) |
| **Workspace** | The customer's org | Tenant, account |

### Internal only — never in a user-visible string

These name the *architecture*, and appear in component names, tokens and routes.

| Term | Where it is allowed |
|---|---|
| **Bridge** | Route `/bridge`, `BridgeSidebar`, `bg-bridge-deck` |
| **Crossing** | `CrossingsLog.tsx` |
| **Dock** | `SupplierDockProfile.tsx`, `SupplierDockList.tsx` |
| **Lane** | `LaneDrawer.tsx` |
| **Spine** | `bg-link-spine` **only.** ~~`CanonicalSpine`~~, ~~`SpineReview`~~ — **struck 2026-08-13**: `CanonicalSpine.tsx` had zero importers and was deleted; `SpineReview` was deleted earlier (commit `3520ed4`). `bg-link-spine` / `--gradient-link-spine` is a different thing — the 2px topbar gradient line — and still ships. |
| **Anatomy** | `DocumentAnatomy.tsx` (internal label for the zone overlay) |
| **Wire** | `WireTopology.tsx` and its SVG gradients |

## Page title pairs

Shipped titles are owned by `src/lib/pageTitles.ts` (mirrors `HUB_TABS`). Edit that; do not
"fix" a title from this table.

| Screen | Title | Subtitle (Inter) |
|---|---|---|
| Dashboard (`/bridge`) | "Dashboard" (browser) / "Overview" (hub tab) | "Today · Mon 12 Jan 2026 · 6 suppliers" |
| Inbox (`/inbox`) | "Inbox" (browser) / "Orders" (hub tab) | "{n} orders · {m} need review · {k} failed" |
| Order review | The PO number (mono) | "{buyer} → {supplier} · {n} lines · {issues} open" |
| Upload (`/upload`) | "Upload an order" | "Drop a buyer order. ProcuLink detects the format." |
| Item codes (`/library/mappings`) | "Item codes" | "{buyer} ↔ {supplier} · {n} item codes" |
| Deliveries (`/operations/log`) | "Deliveries" | "Last 30 days · {n} orders · {pct}% delivered first-try" |

## Buttons

| Action | Label | Variant |
|---|---|---|
| Submit order to supplier | **"Send to supplier"** | primary |
| Save in-progress edits | "Save draft" | secondary |
| Drop into upload zone | "or browse from disk" | ghost (link-style) |
| Approve AI suggestion | "Accept" | ai |
| Reject AI suggestion | "Reject" | ghost |
| Try a failed delivery again | "Fix and resend" | primary |
| Open detail | "Open →" or row click | ghost |
| Destructive | "Delete item code" | danger |

**Never:**
- Metaphor as a verb — "Cross the bridge", "Send across", "Start a crossing". Name the real
  action: **"Send to supplier"**.
- Bare "Submit" / "Process" → say who receives it and what happens.
- "Apply magic", "Run AI", "Smart fix" → AI is shown, not advertised
- "Click here" → buttons say what they do
- "OK / Cancel" pairs in confirms → name the action ("I've reviewed the issues. Send to Acme." / "Back")

## Empty states

| Screen | Headline | Sub | Action |
|---|---|---|---|
| Empty Inbox | "No orders yet." | "Drop a file, or connect a channel that receives them." | "↑ Upload" + "+ Add a channel" |
| No item codes | "No item codes yet." | "Import a CSV, or let AI suggest from the next order." | "↑ Import CSV" |
| No connectors | "No channels connected." | "Set up an email inbox, SFTP, API or cXML PunchOut." | "+ Add a channel" |
| Empty delivery log | "No deliveries in this window." | "Adjust the date range or send a test order." | "Reset filter" |

## Confirms

The confirm before sending must show: **what** (recipient), **how much** (total), **what was reviewed** (exceptions). Operator clicks the action; never "OK".

```
Send this order to Acme Components Ltd.

  Recipient   ops@acmecomponents.com (SFTP)
  Total       € 4,436.73
  Lines       14 (3 with AI-mapped item codes)
  Issues      3 reviewed and resolved

  [ ] I've reviewed the issues.

  [ Back ]  [ Send to Acme ]
```

## Toasts

| Event | Copy |
|---|---|
| Delivered | "Delivered to Acme · accepted · 1m 42s" |
| Saved draft | "Draft saved" |
| Mapping accepted | "Mapped HEI-PLT-09 → ACM-PLT-200×200×4" |
| Auto-process turned on | "Auto-process enabled for Acme. Orders will skip review when validation passes." |
| Delivery failed | "Delivery to Acme failed — see what Acme said →" |

Toasts auto-dismiss in 5s. Failure toasts persist until dismissed.

## Microcopy in the workflow

| Place | Copy |
|---|---|
| Confidence chip on a field | "84%" (in mono, no "confidence" label) |
| AI source attribution | "AI · 84% — used 6× by Heinrich in last 90d" |
| Validation rule failure | "Acme rejects negative quantities." (the rule's own message) |
| Unmapped SKU | "— unmapped —" |
| UoM translated | "UoM 'CN' → 'EA' for Acme" |
| Duplicate warning | "Possible duplicate of line 1 — same SKU on same PO." |
| Address format mismatch | "Postfach format differs from prior 12 orders." |
| Saved indicator | "Saved 3s ago" (low-contrast, top of canonical column) |

## Marketing copy

### Hero
```
H1   Buyers on one side.
     Suppliers on the other.
     We are the bridge.

Sub  ProcuLink turns messy purchase orders into supplier-ready outputs.
     Upload Excel, PDF, cXML or EDI orders, review only exceptions, deliver clean.

CTA  [ Start free ]   [ Watch the walkthrough → ]
```

The H1 keeps the bridge image because a *metaphor in a sentence* is not a *coined term the user
has to learn*. What is banned is turning it into product vocabulary — a noun ("a crossing"), a
label ("Buyer docks") or a verb ("Cross the bridge"). Marketing stat blocks additionally may not
invent numbers: see the landing-page rule in CLAUDE.md §14 (Group J2 (e)).

### Stat block (below hero)
```
Formats in     Suppliers reached     Channels     Avg time to delivery
```

### Section heads
- *"What you'll stop doing manually"* → 4-up of manual order-processing pains
- *"How an order flows through"* → animated diagram (parse → normalize → validate → transform → deliver)
- *"Built for the messy 80%"* → distributors / wholesalers / resellers
- *"Trust through transparency"* → provenance · no silent automation · failure is loud

## Tone calibration

Read every label out loud. If it sounds like a sales deck, rewrite it. If it sounds like a thoughtful colleague telling you what happened, ship it.

Good:
- *"Acme rejected line 4 — qty was −3. Set qty to 1 and resend?"*
- *"AI matched HEI-PLT-09 to ACM-PLT-200×200×4. Used by Heinrich 6 times in last 90 days."*

Bad:
- *"Oops, something went wrong! Try again 😅"*
- *"Smart AI matching detected a possible mapping ✨"*

## Don'ts

- ✕ Don't use emoji in product UI. (One exception: file-type chips don't have emoji either — they're just text.)
- ✕ Don't use "we" and "you" in the same sentence. Pick a perspective per screen.
- ✕ Don't say "click" — use the verb of the action. *"Open the order"* not *"Click to open."*
- ✕ Don't apologize for the AI being uncertain. Show the confidence and let the operator decide.
- ✕ Don't use questions as confirms. *"Are you sure?"* → *"Delete this mapping?"* with action button.
