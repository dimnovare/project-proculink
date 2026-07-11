# ProcuLink Frontend — UI/UX + Accessibility Audit (2026-07-11)

17 routes × 3 viewports (390/768/1280). Headless Playwright + axe-core 4.12 (WCAG 2.0/2.1 A+AA)
against a mock-mode dev server + DOM/getComputedStyle + keyboard-drive + source inspection.

## Overall: 78/100
| Area | Score |
|---|---|
| Accessibility (WCAG) | 68 |
| Responsive | 90 |
| Keyboard | 82 |
| States (load/empty/error) | 80 |
| UX polish | 84 |

**Already excellent (keep):** zero horizontal overflow at any viewport; visible focus ring on 100%
of sampled focusables; 23 loading.tsx skeletons; shared EmptyState + helpful empty copy; Order
Workshop degrades to MobileTriage below lg; topbar aria-current/breadcrumbs; popovers close on Esc.

## P1 (fix before enterprise sales)
1. **Inbox table ARIA (critical, WCAG 4.1.2)** — sortable `<th>` has `role="button"` AND `aria-sort`
   (invalid combo); screen readers lose sort state. InboxView.tsx:1336-1351. Fix: native `columnheader`
   th + inner `<button>` toggle; keep aria-sort on th.
2. **98 contrast failures (WCAG 1.4.3)** — hardcoded faint greys instead of the darkened `--ink-faint`
   token: `#9AA3B5` (2.2–2.5:1) ValidationRules.tsx:399-616; `#9AA3B2` (2.5:1) SupplierDockList.tsx:954,1011;
   `#C6CDDA` (1.6:1) how-it-works/page.tsx:215; amber `#B36D14`/`#C97A14` (2.9–3.65:1) status/format chips.
   Fix: swap → `var(--ink-faint)` (#667085, 5.2:1); darken amber text ~`#8A5310`.

## P2 (before public WCAG/VPAT claims)
3. Upload dropzone `div role=button` contains nested `<Link>`+`<button>` (WCAG 4.1.2). UploadWorkbench.tsx:952-1116.
4. Command palette works but no `role=dialog`/`aria-modal`/focus-trap/listbox → invisible to AT, Tab escapes. CommandPalette.tsx:241-296. Fix: wrap in Radix Dialog.
5. Inline prose links not underlined + low delta (WCAG 1.4.1). security/page.tsx + prose links.
6. **No error.tsx / global-error.tsx anywhere** — render throw shows Next's unbranded screen. Add `(app)/error.tsx` + root `global-error.tsx`.
7. Onboarding progressbar has no accessible name (WCAG 1.1.1). OnboardingChecklist.tsx:307.
8. Scrollable regions (standards catalog, supplier profile) no keyboard access (WCAG 2.1.1). Add tabIndex=0 + aria-label.

## P3 (best-in-class polish)
9. No "skip to main content" link (WCAG 2.4.1). Add to (app)/layout.tsx.
10. Order Workshop renders no `<h1>` (WCAG 1.3.1). OrderWorkshop.tsx header is styled divs.
11. Home lacks `<main>` landmark (app/page.tsx uses root layout).
12. Mobile sub-target touch sizes (topbar icons 32px, rule toggles 38×22, footer links ~20px) — WCAG 2.2 24px.

Note: mock mode, so error/empty states code-verified not live-triggered. Real connections route is `/connections` (not `/library/connections`).
