import Link from "next/link";

/**
 * The cross-link row at the foot of a legal page.
 *
 * WHY A COMPONENT AND NOT FIVE ROWS. /aup, /dpa, /privacy, /subprocessors and
 * /terms each ended with the same hand-written `<p>`: three or four `<Link>`s
 * separated by `marginRight: 16`, with the brand green written as a raw hex on
 * four of them and as `var(--brand-green-deep)` on the fifth — the same colour,
 * spelled two ways. Five copies is why all five were wrong in the same way, and
 * why fixing one would have left four.
 *
 * WHAT WAS WRONG. A `<Link>` inside a `<p>` renders as a non-replaced INLINE
 * box, and `min-height` does not apply to one (CSS 2.1 §10.7). So the 44px tap
 * floor in globals.css — which lists `a` precisely so this case is covered —
 * was inert on every one of them, and they measured 17px tall. At 16px apart
 * they also fail WCAG 2.2 SC 2.5.8's spacing exception, so this was a real AA
 * failure at every viewport, not merely a small tap target on phones.
 *
 * `inline-flex` is the whole fix: it makes the box non-inline, so both the
 * floor here and the global one apply.
 *
 * THIS ROW IS NOT COVERED BY THE INLINE EXCEPTION. SC 2.5.8 exempts a link
 * inside a sentence, because you cannot enlarge a word mid-paragraph without
 * breaking the line. These links are a standalone navigation row with no prose
 * around them — which is exactly what `isInlineInText` in
 * tests/e2e/control-sweep.spec.ts decides by looking for sibling text, and why
 * it reported these and not the genuine in-sentence links on the same pages.
 */
export function LegalPageLinks({ links }: { links: [label: string, href: string][] }) {
  return (
    <nav
      aria-label="Related legal pages"
      className="mt-10 flex flex-wrap items-center gap-x-6 pt-6"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className="inline-flex min-h-[44px] items-center"
          style={{ color: "var(--brand-green-deep)", fontSize: 14.5 }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
