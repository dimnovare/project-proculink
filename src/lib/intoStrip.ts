/** Brings the selected tab inside its strip on a narrow screen. Sideways only, so a refresh never moves the page. */
export function intoStrip(el: HTMLElement | null) {
  const strip = el?.parentElement;
  if (!el || !strip) return;
  const tab = el.getBoundingClientRect();
  const box = strip.getBoundingClientRect();
  if (tab.left < box.left) strip.scrollLeft -= box.left - tab.left;
  else if (tab.right > box.right) strip.scrollLeft += tab.right - box.right;
}
