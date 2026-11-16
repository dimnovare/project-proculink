import type { Locator } from "@playwright/test";

/**
 * Measured inside `root`: every visible box and every visible text line edge (clipped by the
 * overflow it sits in) inside the screen and inside its card; text under 12.5px; links and buttons
 * shorter than 44px; and how many buttons are filled (an opaque dark background).
 */
export const audit = (root: Locator) => root.evaluate((top) => {
  const W = window.innerWidth;
  const outside: string[] = [], small: string[] = [], short: string[] = [];
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
  const cardOf = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (a.getAttribute("role") === "dialog" || (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0)) return a;
    }
    return null;
  };
  // Clipped only by what sits inside the card (a truncated name): a card or a screen that cuts text off is the overflow itself.
  const clip = (el: Element, card: Element | null) => {
    let [l, r] = [-Infinity, Infinity];
    for (let a: Element | null = el; a && a !== card && a !== top; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === "visible") continue;
      const b = a.getBoundingClientRect();
      [l, r] = [Math.max(l, b.left), Math.min(r, b.right)];
    }
    return [l, r];
  };
  const check = (el: Element, left: number, right: number, what: string) => {
    const card = cardOf(el);
    const [cl, cr] = clip(el, card);
    [left, right] = [Math.max(left, cl), Math.min(right, cr)];
    if (right - left <= 0.5) return;                                                       // clipped away entirely
    const c = card?.getBoundingClientRect();
    if (left < -0.5 || right > W + 0.5) outside.push(`${what} ${name(el)} ${left.toFixed(1)}..${right.toFixed(1)} on a ${W} screen`);
    else if (c && (left < c.left - 0.5 || right > c.right + 0.5)) outside.push(`${what} ${name(el)} ${left.toFixed(1)}..${right.toFixed(1)} in a card ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
  };
  for (const el of [top, ...top.querySelectorAll("*")]) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (getComputedStyle(el).transform === "none") check(el, r.left, r.right, "box");     // the tilted papers are a picture
  }
  const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement!;
    if (!t.textContent!.trim() || !shown(el)) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 12.5) small.push(`${name(el)} ${getComputedStyle(el).fontSize}`);
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const line of range.getClientRects()) check(el, line.left, line.right, "text line");
  }
  let filled = 0;
  for (const el of top.querySelectorAll("a, button")) {
    if (!shown(el)) continue;
    const h = el.getBoundingClientRect().height;
    const inSentence = el.tagName === "A" && [...el.parentElement!.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (h < 44 && !inSentence) short.push(`${name(el)} ${h.toFixed(1)}px`);
    const [r, g, b, a = 1] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    if (a > 0.9 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 128) filled++;
  }
  return { outside, small, short, filled };
});
