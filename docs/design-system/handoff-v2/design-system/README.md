# ProcuLink Design System — for Claude Code

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
from the first handoff. It is kept for its layout, token and motion detail, which is still good.

**For anything a user reads, the current authority is `DESIGN_SYSTEM.md` §12 and
`FABLE5_BRIEF.md` §8 — not the numbered set.** The numbered docs originally taught a
bridge-metaphor voice (*crossing*, *dock*, *lane*, *spine*, "Cross the bridge →"). The founder
purged that from all user-facing copy (CLAUDE.md §9); the numbered docs were corrected on
2026-08-09 to match, and each carries a note where it was wrong. In the product itself the
approved word list is code — `src/lib/vocabulary.ts`, enforced by `bun run lint:vocab` — and
shipped page titles live in `src/lib/pageTitles.ts`. Read those before writing a label.

The metaphor is still locked as **spatial architecture**: edge rails, wire topology, the
three-column review screen, the link-spine gradient. It governs layout and component names, and
survives in code identifiers, CSS/design tokens and route names. It is never a word on screen.

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
