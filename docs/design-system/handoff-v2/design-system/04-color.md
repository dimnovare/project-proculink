# 04 — Color

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

## The four-bucket rule

Every color in the product belongs to exactly one of four buckets. If you can't classify it, it doesn't belong.

| Bucket | Tokens | Meaning |
|---|---|---|
| **Brand** | `brand-blue*`, `brand-green*` | Identity. Buyer (blue) vs Supplier (green). |
| **Chrome** | `navy*` | App frame. Sidebar + topbar only. |
| **Surface** | `bg`, `surface*`, `border*`, `ink*` | Neutral page substrate. |
| **Semantic** | `amber*`, `danger*`, `ai*` | Status. Warn / error / AI. Never decorative. |

There is **no** "primary purple," "accent teal," "decorative orange." If you find yourself wanting one, the answer is to use weight, position, or scale instead.

## Brand pairing

ProcuLink runs on **two brand colors plus navy chrome**. They are always paired with meaning:

```
BLUE    →  buyer / incoming / structure / left side / before-state
GREEN   →  supplier / outgoing / completion / right side / after-state
NAVY    →  the bridge frame itself (sidebar + topbar only)
```

**Never** use blue and green decoratively, only directionally. A "blue card" should mean "this is the buyer's side."

## Semantic system

| State | Token | Background | Foreground |
|---|---|---|---|
| Default / informational | `brand-blue` | `brand-blue-soft` | `brand-blue-deep` |
| Success / completed | `brand-green` | `brand-green-soft` | `brand-green-deep` |
| Warning / needs review | `amber` | `amber-soft` (`#FAF1DD`) | `amber` (`#B36D14`) |
| Error / failed | `danger` | `danger-soft` (`#FAE6E6`) | `danger` (`#B43838`) |
| AI-generated | `ai` (`#6F4FCE`) | `ai-soft` (`#F0EAFB`) | `ai` |

### Confidence thresholds
| Range | Color |
|---|---|
| ≥ 90% | `brand-green-deep` on `brand-green-soft` |
| 75–89% | `amber` on `amber-soft` |
| < 75% | `danger` on `danger-soft` |

Used consistently in: `<ConfidenceChip>`, and field-level state on the order review screen.

> **Struck 2026-08-13.** Two of the three consumers listed here do not exist. "field-level state on
> the Canonical Spine" — **struck**, `CanonicalSpine.tsx` was deleted with zero importers; the
> thresholds now apply to the mapped-field rows on the shipped review screen (`OrderWorkshop` →
> `MapperWorkbench`). "the Document Anatomy zone overlays" — **narrowed**, the document pane ships
> (`src/components/bridge/document/`) but the per-zone confidence overlay does not; it needs backend
> provenance and is a separate packet. The thresholds and `<ConfidenceChip>` itself are unchanged.

## Accessibility

All text meets **WCAG AA** on its intended background. Contrast notes:

| Pair | Ratio | Pass |
|---|---|---|
| `ink` (#0B1A2F) on `bg` (#F6F7FA) | 15.4 : 1 | AAA |
| `ink-muted` (#5E6779) on `bg` | 6.4 : 1 | AA |
| `ink-faint` (#98A0AE) on `bg` | 3.6 : 1 | **AA only for text ≥ 18px / 14px bold** — never for body |
| `navy-text` (#C8D1E0) on `navy` (#0B1A2F) | 9.8 : 1 | AAA |
| `navy-muted` (#7C8DA6) on `navy` | 4.7 : 1 | AA |
| `brand-blue` (#1E66C9) on white | 4.8 : 1 | AA |
| `brand-green` (#2E8E3A) on white | 4.3 : 1 | AA |
| `brand-blue-deep` (#0F4FA8) on `brand-blue-soft` (#EAF0F8) | 8.2 : 1 | AAA |
| `brand-green-deep` (#1E6D29) on `brand-green-soft` (#E9F1EA) | 7.6 : 1 | AAA |
| `amber` (#B36D14) on `amber-soft` (#FAF1DD) | 4.5 : 1 | AA |
| `danger` (#B43838) on `danger-soft` (#FAE6E6) | 5.1 : 1 | AA |
| `ai` (#6F4FCE) on `ai-soft` (#F0EAFB) | 5.4 : 1 | AA |

### Color-only signaling is forbidden
Color is paired with at least one of: icon, label, weight, position. So a "red row" also says "⚠ Failed" or has a 3px left bar. Critical for color-blind operators.

## Do / Don't

### Do
- Use `brand-blue` for the primary CTA button (or `navy` if the screen is light and you want chrome continuity — pick one and stick with it per route group).
- Use `brand-blue-soft` for buyer-tinted backgrounds (hover state of buyer rows, the highlighted PO row on the Inbox).
- Use `brand-green-soft` for supplier-tinted backgrounds and the "ready" status pill.
- Use `navy` for sidebar + topbar only.
- Use `ai-soft` exclusively on cards/rows containing AI-generated content.

### Don't
- ✕ Don't use `brand-blue` for a "send" action. Sends are completion — use `brand-green` or navy.
- ✕ Don't use `navy` on body cards or buttons in the work area. Navy is chrome.
- ✕ Don't tint a row both blue and green at once. Pick a side.
- ✕ Don't use `ai` violet anywhere except for AI suggestions, AI-mapped lines, and AI confidence chips.
- ✕ Don't use semantic colors as decoration. An amber border means "warning." If nothing is wrong, don't use amber.
- ✕ Don't introduce new colors. If you need to differentiate a third category (e.g. a third file-type chip), use a neutral grey, not a new hue.
- ✕ Don't apply gradients to body surfaces. Gradients are reserved for the link-spine (`bg-link-spine`), the bridge-deck token, and `<XCard>`'s cross-section edge strip. **Struck 2026-08-13:** "and rail tokens" — edge rails were never built and `bg-rail-buyer` / `bg-rail-supplier` were deleted for having zero consumers.

## File-type chip palette

These are the only places we use non-brand color, and only at chip-size:

| File type | Background | Foreground |
|---|---|---|
| `PDF` | `#FBEEEE` | `#B53F3F` |
| `XLSX` | `brand-green-soft` | `brand-green-deep` |
| `CSV` | `#EEF3F8` | `#345470` |
| `XML` / `cXML` | `ai-soft` | `#5E3DB0` |
| `EDI` | `amber-soft` | `amber` |
| `EMAIL` | `#E9EDF3` | `#4A5568` |
| `API` | `#E3F0E3` | `brand-green-deep` |
| `JSON` | `#FFF4D6` | `#846100` |

These are intentionally muted — chips should read as labels, not signage.

## Hover & focus states

| State | Treatment |
|---|---|
| Hover on a row | Background shifts to `surface-2` (#F1F3F7) |
| Hover on a buyer-tinted row | Background shifts to `brand-blue-soft` |
| Hover on a button-primary | Background `brand-blue-deep` |
| Focus visible | 2px `brand-blue` outline at `--radius` offset 2px |
| Active / pressed | Slightly darker background, no scale transform |

Never use opacity changes for hover (low contrast). Always shift the background or border.
