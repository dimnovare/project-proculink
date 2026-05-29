import type { HelpIconName } from "@/lib/help-articles";

/**
 * One cohesive line-icon set for the Help center category accents.
 *
 * Every glyph shares the same construction language — 24×24 viewBox, 1.7px
 * stroke, round caps and joins, `currentColor` — so the colour is set by the
 * surrounding badge (per-category token) and the icons read as one family
 * rather than hand-rolled one-offs.
 */

const PATHS: Record<HelpIconName, React.ReactNode> = {
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  map: (
    <>
      <path d="M7 7h13" />
      <path d="M16 3l4 4-4 4" />
      <path d="M17 17H4" />
      <path d="M8 21l-4-4 4-4" />
    </>
  ),
  deliver: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18.5 15l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z" />
    </>
  ),
  billing: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7.5l8 5.5 8-5.5" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
  ),
};

export function HelpIcon({
  name,
  size = 18,
  className,
}: {
  name: HelpIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
