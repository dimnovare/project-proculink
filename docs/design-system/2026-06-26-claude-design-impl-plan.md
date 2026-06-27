# Claude Design handoff → implementation plan (delta-mapped)

Handoff: `design_handoff_proculink` (README + `ORDER_PAGE_PIXEL_SPEC.md` + tokens.css + prototype jsx + 8 screenshots).

## Key finding: the foundation already matches
The current app's `src/app/globals.css` `:root` + `tailwind.config.ts` **already define the same token system** the handoff ships (brand-blue `#1E66C9`, green `#2E8E3A`, navy `#0B1A2F`, the four gradients, Inter + **Bricolage Grotesque** + **JetBrains Mono** already imported, `--shadow-card/pop/hero`, the motion vars, `tabular-nums` on `<html>`, the `:focus-visible` blue ring). Claude Design produced this handoff *from screenshots of the live app*, so it's a **refinement spec**, not a redesign. The live Order Workbench is already ~90% the target.

→ **No token swap needed.** Work = component/layout refinement to the pixel spec + a shared order table.

Minor token reconciliations only (optional, low-value): handoff `tokens.css` vs app differ on a couple of soft tints (`--brand-blue-soft #E3EDFB` vs README "T" `#EAF0F8`; `--ink-faint`). Leave app values; they're within tolerance.

---

## Phase 1 — Primitives (small, self-contained, high propagation)
1. **`Pill` (generic, tone-based)** — NEW. `tone: neutral|blue|green|amber|danger|ai`, `sm`, optional leading icon. Tinted bg + matching fg, radius-full, 600. (Current has only status-specific `UnifiedStatusBadge`/`RevisionStatusBadge` — keep those, add a generic `Pill` in `DSPrimitives.tsx` for the workbench/toolbar/header chips.)
2. **`Button` variants** — current `DSPrimitives.Button` has `primary`(green)/secondary/ghost/danger/ai. Spec wants `primary`=**navy**, `send`=**green**. Add named `send` (green) + `navy` variants; keep `primary` aliased to green for back-compat OR remap (audit callers first). Sizes already sm/md/lg with 44px mobile tap.
3. **`Tabs` underline variant** — spec uses underline tabs (active = ink + 2px blue underline + optional count). shadcn `tabs.tsx` is pill-style. Add an `UnderlineTabs` (or a variant) used by the order header segmented control, inbox tabs, drawer tabs. (The header All/Mapping/Output is a *segmented* control — keep that; underline is for page-level tabs.)
4. **Dedupe `SrcChip` vs `FileChip`** — two near-identical format-chip components (`DSPrimitives.SrcChip` + `FileChip.tsx`). Keep one, re-export the other. Palette already matches the spec (PDF red, CSV/UBL slate, XML/cXML violet, EDI/X12 amber, XLSX/API green).
5. **`ConfidenceChip`** — already correct (≥90 green/≥75 amber/else red, mono). No change (consider deleting the duplicate `DSPrimitives.ConfidenceChip`, keep `mapper/ConfidenceChip.tsx`).

## Phase 2 — Order Workbench (PRIORITY · pixel-perfect per ORDER_PAGE_PIXEL_SPEC.md)
All components exist; refine to the spec. Files (all under `src/components/bridge/`):
- **`workshop/OrderWorkshop.tsx`** header rows → spec §1: utility row (Inbox / PO / Setup pill + search + bell/help/avatar), identity row (back btn, 21/800 display PO + status Pill, buyer→supplier→value line, Details toggle, All/Mapping/Output segmented control, **green `send` "Send to supplier"**). Embed `WorkshopStepper` as the §1.1 InlinePipeline (5 stages, done=green/active=blue/future=muted, 22×2 connectors).
- **`workshop/WorkshopStepper.tsx`** → spec §1.1 exact (16px circles, Transform active count "4", Deliver future "5").
- **`workshop/SendReadinessStrip.tsx`** → spec §2 ReadyBanner (greenSoft, CheckCircle + "Ready to send" + muted tail).
- Toolbar (§3): "MAP THIS ORDER" uppercase + green "13 of 13 mapped" Pill + **Show/Hide connections** toggle (blue when on) + secondary "Customize output layout" / "Fill from catalog". (Supplier-rules button lives in the drawer, not here.)
- **`mapper/MapperWorkbench.tsx`** grid → spec §0 column-width formulas (all/mapping/output states; mapping & output = 50:50); rails at 46px (§9).
- **`mapper/IncomingPane.tsx`** → spec §5: blue ColHead "What we received" + "N fields", filter chips (All/Unmapped/Mapped/Has AI/Has value) with mono counts, grouped Header/Parties/Line cards, **right-aligned grip** + right-edge connection port (when wires on).
- **`mapper/OutgoingPane.tsx`** → spec §6: green ColHead + dashed "＋ Add output field", "13 fields ready" collapse header, OutputRow (left 3px green accent, label+path, transform chip [green deterministic / **violet Bolt** computed], "Edit value", row2 "from [blue chip] → green value"), left-edge port.
- **`mapper/MapperPreviewPane.tsx`** → spec §7: green ColHead "Live preview · cXML", format segmented (cXML default, active greenDeep), Copy/Download; **code body on navy `#0B1A2F`**, 11.5/1.95 mono, **cross-highlight** lines (green bar + brighter text when the field is `hot`, bidirectional with received/output hover). **Default OPEN** (today it can render a placeholder — ensure it shows the real cXML).
- **`mapper/MapperWireLayer.tsx`** → spec §8: rest `#7C99B4`/2px/0.9, hot `green`/3px/1; cubic Bézier `dx=max(34,|Δx|*0.42)`; drag-to-connect dashed blue temp wire.
- **`workshop/OrderDetailsDrawer.tsx`** → spec §10: 760px / max 64%, slide-in, 3 underline tabs (Audit trail / Standards check / Supplier response); audit timeline + cards; standards pass-table.

## Phase 3 — Shared Order table + pages (design-system fidelity)
- **NEW `OrderTable` shared component** (spec §6.7): one CSS grid `232px minmax(150px,1.5fr) 132px 124px 86px 176px` = Order | Route | Format | Value(r) | Received | Status(r). Row: status dot + blue buyer avatar + mono PO; `buyer→supplier` route; `SrcChip→SrcChip`; mono value + "N lines"; clock+age; status `Pill` (review amber / failed danger / ready blue+Send / sent green). Adopt across **Inbox** (replace bespoke TanStack columns or restyle), **Dashboard** "Needs attention"/"Recently delivered", **Exceptions**, **Health** delivery-log. Keep all the TanStack Query hooks (`getOrders`, `getExceptions`, `getDeadLetterOrders`, …) — restyle only.
- **Dashboard `/bridge`** (§6.2): KPI row `auto-fit minmax(220px,1fr)` — Need review (amber) / Failed (danger) / Ready (blue) / Delivered (green), 38px icon tile + 26/800 number; then OrderTable sections. (Keep the system-map/topology as the secondary tab.)
- **Suppliers** (§6.4): full-width table, row-expand → 3-col Output/Rules/Delivery panel.
- **Upload** (§6.8): centered, supplier picker chip, dashed dropzone + accepted SrcChips, "Try a sample" (1.5s Reading…), "More ways to receive" disclosure, "What happens next" 3-step.
- **Exceptions/Health** (§6.5/§6.6): heading + OrderTable + connector cards (left 3px status edge).

## Phase 4 — Responsive / mobile (README §9)
OrderTable → stacked cards (`MobileListRow` exists); sidebar off-canvas (exists); workbench → one-pane-at-a-time via the existing All/Mapping/Output + rails, wires desktop-only (exists). KPI/connector grids already reflow.

## Execution
Branch `feat/design-system-v1` in `project-proculink`; one phase per commit; screenshot each via `bun run demo:tools:capture capture-allpages` for founder review BEFORE merging to main (this is a visible prod change — review-gated). Preserve every data hook + the wired mapper logic; restyle/refine only.
