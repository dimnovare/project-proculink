// scrollRegion — the props a scrollable box needs so a keyboard user can reach it.
//
// A box with `overflow: auto` and no focusable content inside it cannot be scrolled by keyboard
// AT ALL: there is nothing to Tab to, so arrow keys and Page Up/Down never target it. The
// document views are the worst case of that, because their whole content is inert — a canvas,
// a table of text, a list of lines. axe reports it as `scrollable-region-focusable` (serious,
// WCAG 2.1.1), and it flagged the PDF page area on the order review screen.
//
// `tabIndex: 0` alone satisfies the checker and is a poor fix: a focus stop with no accessible
// name announces as nothing, so a screen-reader user lands somewhere unexplained. The name and
// the role travel with it here, exactly as `MapperPreviewPane`'s <pre> already does for the
// output preview, so the two scrollable documents on this screen behave the same way.
//
// The negative case matters as much as the positive one. Below `lg` the text view renders at
// its natural height with no scroller, and a `tabIndex` there would be a dead stop the operator
// tabs through for nothing. So this is a function of whether the box actually scrolls.

export interface ScrollRegionProps {
  tabIndex?: 0;
  role?: "region";
  "aria-label"?: string;
}

/**
 * `scrolls` — whether this box owns a scroller (either axis). False → no props at all, so a
 * box that grows with its content never becomes a tab stop.
 */
export function scrollRegionProps(label: string, scrolls: boolean): ScrollRegionProps {
  if (!scrolls) return {};
  return { tabIndex: 0, role: "region", "aria-label": label };
}
