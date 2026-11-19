/** Brings an element into view, instantly; usable as a ref. Scroll padding in globals.css keeps it clear of a phone's bottom bars. */
export const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: "nearest" });
