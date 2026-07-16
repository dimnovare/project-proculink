/**
 * Visually-hidden "Skip to main content" link (WCAG 2.4.1). Rendered as the
 * FIRST focusable element in a layout; stays `sr-only` until focused, then
 * reveals as a branded pill pinned to the top-left. Activating it moves focus to
 * `#main-content` — the layout's `<main>`, which carries
 * `id="main-content" tabIndex={-1}` so it can receive programmatic focus.
 *
 * A plain anchor — no `"use client"` needed, so it renders in both the server
 * marketing layout and the client (app) layout. The blue focus ring comes from
 * the global `:focus-visible` rule in globals.css.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:inline-flex focus:items-center focus:rounded-lg focus:bg-white focus:px-4 focus:py-2.5 focus:text-[13px] focus:font-semibold focus:text-[#0B1A2F] focus:no-underline focus:shadow-[0_8px_24px_rgba(11,26,47,0.18)]"
    >
      Skip to main content
    </a>
  );
}
