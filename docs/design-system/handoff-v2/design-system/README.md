# ProcuLink Design System — for Claude Code

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

This folder is the **hand-off contract** between the design (this prototype) and the
real app (`proculink.eu` · Next.js 15 App Router · TypeScript · Tailwind ·
shadcn/Radix · TanStack Query · Clerk). Point Claude Code at this folder and it has
everything it needs to theme the product without guessing.

```
design-system/
├── tokens.css            ← SOURCE OF TRUTH. Every color/type/space/shadow/motion value as CSS vars.
├── shadcn-theme.css      ← maps shadcn's --primary/--background/… contract onto ProcuLink (HSL).
├── tailwind.preset.ts    ← Tailwind preset: pl- semantic colors, fonts, radii, shadow ramp, motion.
├── DESIGN_SYSTEM.md      ← the visual system + component taxonomy (mapped to shadcn) + state/copy/motion/a11y rules.
├── FABLE5_BRIEF.md       ← product critique, IA, screen-by-screen redesign, flows, truthfulness flags, and the Claude Code build brief (keep / build / do-not-touch).
├── styleguide.html       ← living visual styleguide — open it to SEE every token & component.
└── core.jsx              ← reference implementation of the primitives (what styleguide.html renders).
```

This folder also holds an **earlier** numbered set (`01-foundations.md` … `10-claude-code-brief.md`)
from the first handoff. It is kept for its **motion, type, token and colour detail, which is still
good**. Its **spatial/layout signatures are not** — the 2026-08-13 audit checked all five against
`src/` and struck two of them (edge rails, never built; the Canonical Spine review, deleted with zero
importers) and narrowed two more. Every file in the numbered set now opens with a struck-signatures
banner. Read that banner before copying a layout, a component contract or a build order out of any of
them.

**For anything a user reads, the current authority is `DESIGN_SYSTEM.md` §12 and
`FABLE5_BRIEF.md` §8 — not the numbered set.** The numbered docs originally taught a
bridge-metaphor voice (*crossing*, *dock*, *lane*, *spine*, "Cross the bridge →"). The founder
purged that from all user-facing copy (CLAUDE.md §9); the numbered docs were corrected on
2026-08-09 to match, and each carries a note where it was wrong. In the product itself the
approved word list is code — `src/lib/vocabulary.ts`, enforced by `bun run lint:vocab` — and
shipped page titles live in `src/lib/pageTitles.ts`. Read those before writing a label.

The metaphor still governs **layout and component names**, and survives in code identifiers,
CSS/design tokens and route names. It is never a word on screen.

> **Struck 2026-08-13.** This paragraph used to list the spatial architecture as "edge rails, wire
> topology, the three-column review screen, the link-spine gradient". Two of those four were struck.
> What the metaphor actually holds up in shipped code:
>
> - ~~**Edge rails**~~ — **STRUCK.** Never built. `.rail*` CSS and the `rail` / `rail-buyer` /
>   `rail-supplier` / `z-rails` tokens had zero consumers and were deleted.
> - ~~**The three-column review screen** as *source · canonical spine · output*~~ — **STRUCK.**
>   `CanonicalSpine.tsx` had zero importers and was deleted. The review is still three columns, but
>   they are *What we received* | *What we'll send* | *Live preview* (`OrderWorkshop` →
>   `MapperWorkbench`) — one buyer column and two supplier columns, not a spine.
> - **Wire topology** — kept, demoted to a "System map" tab on `/bridge`.
> - **The link-spine gradient** — kept, real, unchanged (`bg-link-spine`, the 2px topbar line).
>
> Also still real: `<XCard>`'s cross-section edge, navy chrome over a light work area,
> `<StatusJourney>`'s five stages, and buyer-blue / supplier-green as directional colour.

---

## How to wire it in (the 4-step answer)

**1 · Drop in the tokens.** Copy `tokens.css` + `shadcn-theme.css` into the app (e.g.
`src/styles/`). At the top of `app/globals.css`:

```css
@import "../styles/tokens.css";        /* --pl-* primitives + focus ring + motion */
@tailwind base;
@tailwind components;
@tailwind utilities;
@import "../styles/shadcn-theme.css";  /* AFTER shadcn's block so it wins */
```

**2 · Extend Tailwind.** In `tailwind.config.ts`:

```ts
import proculink from "./design-system/tailwind.preset";
export default {
  presets: [proculink],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
} satisfies Config;
```

Now `bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring` (shadcn) **and**
`bg-source`, `text-output`, `bg-warn/10`, `text-blocker`, `bg-navy` (ProcuLink) all work.

**3 · Load the fonts.** `next/font`:

```ts
import { Inter, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
export const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
export const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
export const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
```
Put the three `.variable` classes on `<html>`; `tokens.css` already points
`--pl-font-*` at these families (Tailwind `font-display` / `font-mono` follow).

**4 · Re-skin shadcn, don't rebuild it.** Your existing shadcn components inherit the
new look immediately (they read the CSS vars). Only override component code where
`DESIGN_SYSTEM.md` calls for it (Button variants `send`/`ai`, the Status badge set, the
tinted table column headers). Everything else is a token swap.

> **Verify the swap:** open `styleguide.html` and your `/components` page side by side —
> buttons, badges, focus rings, and table headers should match.

---

## The one rule that outranks everything

**Do not restructure the 3-column Order Workshop.** Source → issue-fix → mapping/wires →
canonical order → output preview → send-readiness. You may polish spacing, labels, and
its empty/error/loading/mobile states — you may **not** replace the 3-column concept,
the wire interaction, or the fix-and-send model. Details + rationale in `FABLE5_BRIEF.md`.

## Semantic color law (never break this)

blue = buyer / source / incoming · green = supplier / output / outgoing ·
amber = uncertain, needs review · red = blocker / failure · violet = AI assist ·
navy = app chrome. Status is **never** encoded by color alone — always a dot/icon **and**
a word. Numbers are always `tabular-nums`; IDs, paths, and payloads are always mono.
