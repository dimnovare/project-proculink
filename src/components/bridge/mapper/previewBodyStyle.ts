// previewBodyStyle — the live preview body's colours, refreshing and settled.
//
// WHY THIS IS NOT `opacity`, AND WHY THAT IS THE WHOLE POINT OF THE FILE.
//
// The preview body is light mono on navy: --navy-text on --navy is about 11:1, comfortably AA.
// The refreshing state used to be spelled `opacity: 0.55` on the <pre> itself, and element
// opacity composites the element's TEXT AND ITS BACKGROUND TOGETHER toward whatever is painted
// behind it. Both ends move, so the pair collapses — measured by axe on the order review
// screen: a near-white foreground (dfe4ed) on a mid-grey background (777f8c), **3.16:1**
// against a 4.5:1 floor, flagged `serious`. Neither of those values appears anywhere in the
// source; they are what 0.55 does to --navy-text and --navy over a light page.
//
// That makes opacity contrast-FRAGILE by construction on a dark-on-dark block: the resulting
// ratio depends on the parent's background, which this component neither sets nor can see. Any
// value of `opacity` below 1 is a guess about a colour that belongs to somebody else.
//
// So "refreshing" is a COLOUR change instead. --navy-faint is 8.06:1 on --navy, is visibly
// dimmer than --navy-text, and cannot be altered by what is painted behind the pane. The pair
// is pinned in src/test/token-contrast.test.ts, in both directions: the maths, and the fact
// that this file still uses it.
//
// The token NAMES are exported so that test derives the pair from here rather than retyping it.

export const PREVIEW_BODY_SETTLED_TOKEN = "--navy-text";
export const PREVIEW_BODY_REFRESHING_TOKEN = "--navy-faint";

export interface PreviewBodyStyle {
  color: string;
  transition: string;
}

/**
 * `busy` = a preview fetch is in flight. Returns ONLY a colour: there is deliberately no
 * opacity key, because reintroducing one is the exact regression this replaced.
 */
export function previewBodyStyle(busy: boolean): PreviewBodyStyle {
  return {
    color: `var(${busy ? PREVIEW_BODY_REFRESHING_TOKEN : PREVIEW_BODY_SETTLED_TOKEN})`,
    transition: "color 150ms",
  };
}
