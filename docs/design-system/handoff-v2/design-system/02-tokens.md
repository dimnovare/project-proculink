# 02 — Tokens

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

All design tokens are sourced from `tokens/tokens.json` and emitted as:
- `tokens/tokens.css` (CSS custom properties)
- `tokens/tailwind.config.ts` (Tailwind theme extension)
- `tokens/tokens.ts` (typed exports for TS apps)

Edit the JSON; regenerate the rest.

## Color tokens

### Brand
| Token | Value | Use |
|---|---|---|
| `--brand-blue` | `#1E66C9` | Buyer side · structural accents · primary marketing CTA |
| `--brand-blue-deep` | `#0F4FA8` | Hover / pressed state of brand-blue |
| `--brand-blue-soft` | `#EAF0F8` | Buyer-tinted surfaces, blue chip backgrounds |
| `--brand-green` | `#2E8E3A` | Supplier side · success · completion |
| `--brand-green-deep` | `#1E6D29` | Hover / pressed state of brand-green |
| `--brand-green-soft` | `#E9F1EA` | Supplier-tinted surfaces, green chip backgrounds |

### Navy chrome
| Token | Value | Use |
|---|---|---|
| `--navy` | `#0B1A2F` | Sidebar + topbar background |
| `--navy-surface` | `#14253D` | Raised surfaces inside chrome (workspace switcher, search) |
| `--navy-border` | `#1F3252` | Borders inside chrome |
| `--navy-text` | `#C8D1E0` | Default text on navy |
| `--navy-muted` | `#7C8DA6` | Secondary text on navy |

### Light surfaces
| Token | Value | Use |
|---|---|---|
| `--bg` | `#F6F7FA` | App background |
| `--bg-warm` | `#F8F6F1` | Marketing surfaces, auth page |
| `--surface` | `#FFFFFF` | Card surfaces |
| `--surface-2` | `#F1F3F7` | Subtle nested surfaces |
| `--border` | `#E5E8EE` | Default border |
| `--border-strong` | `#CBD0DA` | Active / focused border |

### Text
| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B1A2F` | Default body text |
| `--ink-muted` | `#5E6779` | Secondary text |
| `--ink-faint` | `#98A0AE` | Tertiary text, placeholders |

### Semantic
| Token | Value | Use |
|---|---|---|
| `--amber` | `#B36D14` | Warning |
| `--amber-soft` | `#FAF1DD` | Warning background |
| `--danger` | `#B43838` | Error, destructive action |
| `--danger-soft` | `#FAE6E6` | Error background |
| `--success` | same as `--brand-green` | Success states |
| `--ai` | `#6F4FCE` | **Only** for AI-generated content |
| `--ai-soft` | `#F0EAFB` | AI surface background |

### Gradient tokens
| Token | Value | Use |
|---|---|---|
| `--gradient-link-spine` | `linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)` | The signature spine line |
| `--gradient-bridge-deck` | `linear-gradient(90deg, #1E66C9, #2E8E3A)` | Bridge graphic on review header |
| `--gradient-line-buyer` | `linear-gradient(180deg, rgba(30,102,201,0.2), #1E66C9 50%, rgba(30,102,201,0.2))` | Vertical connector through a help guide's numbered step badges (`src/components/help/guide/Step.tsx`) |
| ~~`--gradient-rail-supplier`~~ | ~~`linear-gradient(180deg, rgba(46,142,58,0.2), #2E8E3A 50%, rgba(46,142,58,0.2))`~~ | ~~Right edge rail~~ — **removed** |

> **Struck 2026-08-13.** Edge rails were never built, so neither rail gradient had a rail to paint.
> `--gradient-rail-supplier` was **deleted outright** — zero consumers.
> `--gradient-rail-buyer` was **not** deleted: it was **renamed `--gradient-line-buyer`**, because one
> real consumer survives — it draws the vertical connector running through a help guide's numbered
> step badges (`src/components/help/guide/Step.tsx`). It is a step connector, not a rail. The Tailwind
> `bg-rail-buyer` / `bg-rail-supplier` background-image utilities were deleted along with the
> `.rail*` CSS in `src/app/globals.css`.
>
> `--gradient-link-spine` and `--gradient-bridge-deck` above are **unaffected and still ship.**

## Typography

| Token | Value |
|---|---|
| `--font-sans` | `"Inter", system-ui, -apple-system, sans-serif` |
| `--font-display` | `"Bricolage Grotesque", "Inter", system-ui, sans-serif` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, monospace` |

### Type scale
| Token | Size / line-height | Use |
|---|---|---|
| `--text-xs`  | 10px / 1.3 | Micro-labels, footnotes |
| `--text-sm`  | 11.5px / 1.4 | Table headers, captions |
| `--text-body-s` | 12.5px / 1.45 | Table rows, dense UI |
| `--text-body` | 13px / 1.5 | Default body |
| `--text-body-l` | 14px / 1.55 | Marketing body, descriptions |
| `--text-h4` | 16px / 1.35 | Card titles |
| `--text-h3` | 18px / 1.3 | Section titles |
| `--text-h2` | 24px / 1.2 | Page titles |
| `--text-h1` | 32px / 1.15 | Major in-app headings |
| `--text-display-s` | 36px / 1.05 | KPI monumental numbers |
| `--text-display` | 48px / 1.0 | Hero KPI |
| `--text-display-l` | 78px / 0.98 | Marketing hero |

All tracking is `-0.025em` for display sizes ≥24px; default elsewhere.

All numerics use `font-variant-numeric: tabular-nums` globally.

## Spacing

4px base unit. Use this scale only: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96`.

Tokens map to Tailwind's default 0.25rem scale, so `gap-3` = 12px, `p-4` = 16px, etc.

## Radii

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Pills, chips |
| `--radius` | 6px | Controls, small cards |
| `--radius-md` | 8px | Default card |
| `--radius-lg` | 10px | Featured card |
| `--radius-xl` | 12px | Hero card, modal |
| `--radius-full` | 9999px | Round buttons, badges |

**No pill-shaped containers** except chips and round badges. No `border-radius` above 12px on rectangular elements.

## Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(11,26,47,0.04)` | Default card depth (used sparingly — most cards use border only) |
| `--shadow-pop` | `0 8px 24px rgba(11,26,47,0.10)` | Popovers, drawers, the supplier card hover-lift on hero |
| `--shadow-hero` | `0 50px 120px rgba(11,26,47,0.10), 0 8px 24px rgba(11,26,47,0.06)` | Marketing hero product peek |

Avoid heavy drop shadows. Borders carry depth, not shadows.

## Borders

- Default: `1px solid var(--border)` (#E5E8EE)
- Strong / focused: `1px solid var(--border-strong)` (#CBD0DA)
- Cross-section card edge: 3px strip on one edge (not all four) — see XCard component.

## Motion tokens

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` |
| `--duration-fast` | `150ms` |
| `--duration` | `250ms` |
| `--duration-slow` | `400ms` |
| `--duration-spine` | `1200ms` (link-spine activation) |
| `--duration-wire-loop` | `6000ms` (wire-topology traveller loop) |

All animation respects `prefers-reduced-motion: reduce` — disable wire travellers and the spine activation; keep state transitions instant.

## Z-index

| Token | Value | Use |
|---|---|---|
| `--z-base` | 0 | Content |
| ~~`--z-rails`~~ | ~~1~~ | ~~Edge rails~~ — **removed** |
| `--z-sticky` | 10 | Sticky action bars |

> **Struck 2026-08-13.** `--z-rails` / `z-rails` was deleted with the rest of the edge-rail tokens.
> Nothing ever set it. Every other row in this table still ships.
| `--z-drawer` | 20 | Right drawer |
| `--z-topbar` | 30 | Topbar |
| `--z-popover` | 40 | Popovers, dropdowns |
| `--z-modal` | 50 | Modals |
| `--z-toast` | 60 | Toasts |
