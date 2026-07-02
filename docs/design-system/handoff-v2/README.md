# ProcuLink v2 — Handoff Package

A single, **runnable** package for Claude Code. The working app in here is the
pixel-accurate reference — every value (color, size, spacing, radius) is real code you
can read and lift, not a screenshot to guess from.

```
handoff_v2/
├── ProcuLink App v2.html          ← the full app. Open this. No build step.
├── ProcuLink v2 — Order Issues.html ← standalone live-preview of the issues order (opens in its own tab)
├── v2/                            ← all app source (React + Babel, one file per area)
│   ├── redesign/  core.jsx · tokens.css      (design system: window.PL + CSS vars)
│   ├── workbench3/ app.jsx (shell+order) · full.jsx (router) · pages.jsx (inbox/suppliers)
│   │               · issues.jsx (issues order) · output.jsx (output designer) · library2.jsx
│   │               · settings2.jsx · batch3.jsx (supplier detail/connections) · prod.jsx
│   │               · ui.jsx (⌘K palette, modals, toasts) · passport.jsx (Output Passport)
│   ├── dashboard2/ dash.jsx
│   └── upload2/    upload.jsx
└── design-system/                 ← the Claude-Code design system (READ FIRST)
    ├── tokens.css · shadcn-theme.css · tailwind.preset.ts   (drop-in tokens)
    ├── DESIGN_SYSTEM.md · FABLE5_BRIEF.md                    (rules + product spec)
    └── styleguide.html                                       (living visual reference)
```

## How to run
Open `ProcuLink App v2.html` in a browser. React + Babel load from CDN; the `v2/*.jsx`
files transpile in-browser. Saved state uses its own `v2-*` localStorage keys, so this
app never collides with the original prototype.

## How to implement (for Claude Code)
1. **Read `design-system/` first.** `tokens.css` + `shadcn-theme.css` + `tailwind.preset.ts`
   drop straight into the real Next.js 15 / Tailwind / shadcn app (HSL already computed).
   `DESIGN_SYSTEM.md` is the component/status/state/motion law; `FABLE5_BRIEF.md` is the
   product structure + screen-by-screen + truthfulness flags + keep/build/don't-touch.
2. **The running app is the spec.** For any screen, open its source file in `v2/` and read
   the exact px/tokens. Component → file map is above. The design system means values
   repeat, so you rarely need a separate written spec.
3. **Match the shared systems:** one Button taxonomy, one status badge set, one card, one
   full-bleed table grid, one empty/loading/error/success pattern (all in the styleguide).

## What's in this build
- **Duplicated to v2** with isolated saved state — the original app is untouched.
- **Issues view incorporated into the app.** Orders that need review (Inbox rows +
  Dashboard "Needs you") now open the 3-column **Issues-to-resolve** order view in-app,
  with a breadcrumb back to Inbox and an **"Open preview ↗"** that pops the live output
  preview into its own tab. Clean/ready orders open the normal mapper. *(The 3-column
  concept is unchanged — polish only, as locked.)*
- **Full-bleed, unified tables.** Every list now spans the full content width with a
  shared column grid (fixed the varying 1180/1440 widths). Forms keep a readable cap.
- **Already in the app** (reuse, don't rebuild): ⌘K command palette, order **Details**
  drawer, **Add** modals (supplier/buyer/template/connection), **Supplier rules check**,
  Inbox **bulk actions**, **Output Designer** (sample-first + live preview), and the
  **Output Passport** (delivery proof) in `passport.jsx`.

## Do NOT touch
- The **3-column Order Workshop / Issues** spatial model (source → issue-fix →
  mapping/wires → output preview → send). Polish only.
- The **semantic color law**: blue = buyer/source · green = supplier/output ·
  amber = uncertain · red = blocker · violet = AI · navy = chrome.
- **Truthfulness flags** in `FABLE5_BRIEF.md` §6 (EDIFACT / ERP / scanned-PDF / SFTP shown
  as "assisted/coming soon").

## Remaining build items (next pass — not yet in this package)
Called out honestly so nothing is assumed done:
1. **Fill-from-catalog** modal (item-code resolution: search supplier catalog → pick →
   map, with confidence). Spec: right-drawer or centered modal, source blue / output green,
   uses `Picker` + `ConfidenceChip`, primary "Use code", secondary "Send as-is + flag".
2. **Customize output layout** modal (reorder/pin output fields, toggle required, set fixed
   values). Spec: two-column (available ↔ chosen) with drag handles (`Icon.Grip`), live
   preview, "Save as template".
3. **Per-screen written pixel specs** for the remaining ~18 screens. The working source in
   `v2/` already carries exact values; these would just transcribe them per screen.

Say the word and I'll build 1 + 2 into v2 and add the written specs.
