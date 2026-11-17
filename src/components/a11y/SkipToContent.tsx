/**
 * Visually-hidden "Skip to main content" link (WCAG 2.4.1). Rendered as the
 * FIRST focusable element in a layout; stays `sr-only` until the KEYBOARD
 * focuses it, then reveals as a branded pill pinned to the top-left. Activating
 * it moves focus to `#main-content` — the layout's `<main>`, which carries
 * `id="main-content" tabIndex={-1}` so it can receive programmatic focus.
 *
 * `focus-visible`, not `focus`: the router focuses the first node of a new page
 * after a navigation, and on the home page that node is this link. With plain
 * `focus` a tap on a phone brought the pill up over the site header, where
 * nobody can use it.
 *
 * A plain anchor — no `"use client"` needed, so it renders in both the server
 * marketing layout and the client (app) layout. The blue focus ring comes from
 * the global `:focus-visible` rule in globals.css.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[9999] focus-visible:inline-flex focus-visible:items-center focus-visible:rounded-lg focus-visible:bg-white focus-visible:px-4 focus-visible:py-2.5 focus-visible:text-[13px] focus-visible:font-semibold focus-visible:text-[#0B1A2F] focus-visible:no-underline focus-visible:shadow-[0_8px_24px_rgba(11,26,47,0.18)]"
    >
      Skip to main content
    </a>
  );
}
