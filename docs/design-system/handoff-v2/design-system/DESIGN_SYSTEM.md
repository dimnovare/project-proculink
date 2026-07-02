# ProcuLink Design System — "The Bridge Layer"

The visual + interaction system for the product. Every value here exists as a token in
`tokens.css`; this doc says **how to use them**. Companion: `FABLE5_BRIEF.md` (product
structure & screens), `styleguide.html` (see it rendered).

---

## 1. Design principles

1. **Control room, not admin panel.** Calm dense surfaces, crisp hierarchy, confident
   operational type. Lines / docks / ports / lanes are interface language, not decoration.
2. **The bridge is functional.** Blue (buyer) on the left, green (supplier) on the right,
   the transform in the middle. This spatial law holds from the marketing hero to the
   Order Workshop.
3. **Every screen answers five questions.** What am I looking at? What needs action?
   What's safe to automate? What happens if I click the primary button? What proof exists
   after delivery?
4. **Truthful surfaces.** Never imply a capability that isn't live (see truthfulness flags
   in `FABLE5_BRIEF.md`). Assisted ≠ automated; mark "Assisted" / "Coming soon" honestly.
5. **One of everything.** One button taxonomy, one status system, one card, one table, one
   form, one empty/error/loading/success pattern, one motion system. Divergence is a bug.

## 2. Color

Semantic law (never break): **blue** buyer/source · **green** supplier/output ·
**amber** uncertain · **red** blocker · **violet** AI · **navy** chrome.

| Role | Token | Hex |
|---|---|---|
| Source / buyer | `--pl-blue` · `-deep` · `-soft` | `#1E66C9` · `#0F4FA8` · `#EAF0F8` |
| Output / supplier | `--pl-green` · `-deep` · `-soft` | `#2E8E3A` · `#1E6D29` · `#E9F1EA` |
| Warn / uncertain | `--pl-amber` · `-soft` | `#B36D14` · `#FAF1DD` |
| Blocker / failure | `--pl-danger` · `-soft` | `#B43838` · `#FAE6E6` |
| AI assist | `--pl-ai` · `-soft` · `-border` | `#6F4FCE` · `#F0EAFB` · `#D9CCF4` |
| Chrome | `--pl-navy` · `-surface` · `-border` | `#0B1A2F` · `#14253D` · `#1F3252` |
| Surfaces | `--pl-bg` · `-surface` · `-surface-2` | `#F6F7FA` · `#FFFFFF` · `#F1F3F7` |
| Ink | `--pl-ink` · `-muted` · `-faint` | `#0B1A2F` · `#5E6779` · `#98A0AE` |

**Usage:** solid brand color for the element that *acts* (button, active tab, node);
`-soft` background + `-deep` text for badges/chips; never a saturated fill behind body
text. A "soft" tint at ~10–15% is the standard status-row background.

## 3. Type

- **Display** — Bricolage Grotesque, 650–800, tracking −0.02 to −0.025em. Page titles,
  section headers, marketing heros, empty-state titles. Never for body or data.
- **Text** — Inter, 400–600. All UI, labels, descriptions.
- **Mono** — JetBrains Mono. IDs, PO numbers, field paths, cXML/JSON/CSV payloads,
  and any column of figures (with `tabular-nums`).

Scale (px): display 48/36 · h1 32 · h2 22 · h3 18 · h4 16 · body-l 14 · body 13 ·
body-s 12.5 · sm 11.5 · xs 10. **Floor for live UI text: 11.5; table cells 12.5.**

## 4. Spacing, radius, elevation

- **Spacing** 4-pt base. Card padding 14–18; page gutters 22–28; control gaps 7–12.
- **Radius** control 6–8, card 12–14, pill 999. (Tailwind: `rounded-lg` control,
  `rounded-2xl` card, `rounded-full` pill.)
- **Elevation ramp** — one ladder, no ad-hoc shadows:
  `shadow-sm` chips/inputs · `shadow` resting cards & lists · `shadow-md` hover-lift &
  popovers · `shadow-lg` drawers & command palette · `shadow-xl` modals.
  Hover on a card: lift `translateY(-2px)` + step to `shadow-md`.

## 5. Component taxonomy (mapped to shadcn/Radix)

Re-skin shadcn; only add variants/pieces noted. Reference impl in `core.jsx`.

| ProcuLink component | shadcn base | Notes |
|---|---|---|
| **Button** | `button` | Variants: `primary` (navy), `send` (green), `ai` (violet), `danger` (red), `secondary` (white/outline), `ghost`. Sizes sm 28 / md 33 / lg 42. Filled variants carry the 1px ambient + inset-highlight shadow. **Add `send`/`ai` variants to `buttonVariants`.** |
| **Status badge** (`Pill`) | `badge` | Tones map to the 6 semantic colors, `-soft` bg + `-deep` text, `rounded-full`. Always dot/icon **and** word. See §6 for the exact status set. |
| **ConfidenceChip** | — (custom) | Mono % chip, green ≥90 / amber ≥75 / red <75. |
| **SrcChip** | — (custom) | Mono format tag (PDF/CSV/cXML/UBL/X12/EDI…), per-format ink color. |
| **Card / Panel** | `card` | `rounded-2xl`, `shadow`, 1px `border`. Optional 3px left edge: blue=buyer, green=supplier, gradient=bridge. Hover variant lifts. |
| **Table / List** | `table` | Fixed column grid (never auto) so data never "swims". Tinted column headers with a status dot. Row 44px, hover `bg-surface-2`, `tabular-nums`. Row-level status = dot + word. |
| **Form field** | `input`/`select`/`label` | Label 11.5 mono-caps optional, helper text `ink-muted`, input outline `border-strong`, focus ring §8. `Picker` = styled select with buyer/supplier accent. |
| **Tabs** | `tabs` | Underline style, active = ink + 2px blue underline; count badge in a mono pill. |
| **AI suggestion** | custom on `card` | Violet-soft surface, "Suggestion" eyebrow + confidence, actions **Accept / Edit / Dismiss**. |
| **Empty state** | custom | Icon tile (48, `surface-2`) + display title + one sentence + one primary action. Illustration-free. |
| **Toast** | `sonner`/`toast` | Tone-colored left edge; copy = outcome ("Sent to Acme — acknowledged."). |
| **Drawer** (Details) | `sheet` | Right side, `shadow-lg`, slides from hidden; base state visible (print-safe). |
| **Dialog / Modal** | `dialog` | `shadow-xl`, scrim fade 160ms, content lift+fade 200ms. |
| **Command palette** | `command` | ⌘K global; jumps to any page/order/supplier. `shadow-lg`. |
| **Mobile sheet** | `drawer`(vaul) | Bottom sheet + bottom action bar; see §9. |

## 6. Status system (the single source)

Order lifecycle → one badge set (dot + word, `-soft` bg / `-deep` text):

- **Received** (neutral/ink) → **Needs review** (amber) → **Ready** (blue) →
  **Sent** (green) → **Delivered** (green, filled check) · **Failed** (red) ·
  **Rejected by supplier** (red) · **On hold** (neutral).
- Supplier readiness: **Ready** (green) / **Needs setup — {missing}** (amber).
- Delivery: **Delivered** / **Failed — {reason}** / **Retrying** / **Awaiting ack**.

Rule: the word carries the meaning; color reinforces. A red dot alone is never enough.

## 7. State patterns (every list/detail must ship all four)

- **Empty** — teach, don't apologize. Icon + display title + one sentence + primary
  action. e.g. Inbox: *"No orders yet — upload your first purchase order."* → **Upload order**.
- **Loading** — skeleton rows/cards matched to final layout (no content spinners); a thin
  top progress bar for imports/sends.
- **Error** — inline, plain language, cause + fix + action. *"Delivery failed — supplier
  endpoint refused the connection. Check the SFTP host in Settings."* → **Retry delivery**.
- **Success / proof** — transient toast for confirmation **and** a durable state change
  (row → Delivered, with a **Proof** affordance opening the receipt).

## 8. Focus & interaction states

- **Focus** (keyboard): 2px blue outline + 4px translucent-blue halo, 6px radius. Global
  in `tokens.css`; never remove, never rely on color-only.
- **Hover**: cards lift 2px→`shadow-md`; rows tint `surface-2`; buttons brighten 8%.
- **Pressed**: settle 0.5px. **Disabled**: 45% opacity, `not-allowed`.
- Hit targets ≥ 40px on touch.

## 9. Mobile

Mobile = triage, not configuration. Support: work queue, review issues, accept
suggestions, check delivery, retry failed sends, preview output **summary**. Patterns:
sidebar → top bar + **hamburger drawer** (scrim + slide); primary action → **bottom
action bar**; sections collapse; tables → stacked cards (label + value rows, status dot
kept). For desktop-only tools (deep field mapping, Output Designer, the 3-column
Workshop) show a calm **"Best continued on desktop"** handoff — never a broken squeeze.

## 10. Motion

- Motion explains state, never decorates. Entrances ≤8px, ≤260ms, ease `bridge`
  (`cubic-bezier(0.16,1,0.3,1)`).
- **Base state = the visible end-state**; animate *from* hidden so print/PDF/reduced-motion
  always show content.
- Signature, sparing: a node pulse when a route connects; a wire/connector draw when a
  mapping is made; a spine fill on transform. No floating dots, no ambient loops on content.
- Honor `prefers-reduced-motion` (handled globally in `tokens.css`).

## 11. Accessibility

Contrast text ≥ 4.5:1, UI/large ≥ 3:1. Status = shape + word, never color alone. Every
interactive element keyboard-reachable with visible focus; logical tab order. ⌘K palette,
Esc closes overlays, arrows within lists/palette. Overlays trap focus and restore it on
close. Meaningful icons carry `aria-label`.

## 12. Voice & copy

Plain, operational, calm. Say what will happen. **Do:** "Send to supplier", "Resolve
blockers to send", "Delivered — acknowledged 14:02", "Needs setup — no delivery channel".
**Don't:** "Submit", "Oops!", "AI magic", "Sync data", vague success. Buttons are verbs;
statuses are outcomes; errors name the cause and the fix.
