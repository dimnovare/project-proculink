/**
 * Roving-tabindex radiogroup navigation — the pure index math shared by the
 * protocol pickers (DeliveryConfigEditor / CatalogSourceEditor) and any other
 * arrow-key-navigable radiogroup.
 *
 * Given the currently-selected id, an ordered list of selectable ids, and an
 * arrow key, returns the id that should become selected (and focused). Wraps
 * around at both ends. Returns null when the key isn't an arrow key or there's
 * nothing to select, so the caller can early-return without side effects.
 */

const ARROW_KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"] as const;

export function isArrowKey(key: string): boolean {
  return (ARROW_KEYS as readonly string[]).includes(key);
}

export function rovingRadioNext<T>(
  key: string,
  current: T,
  ids: readonly T[],
): T | null {
  if (!isArrowKey(key) || ids.length === 0) return null;
  const forward = key === "ArrowDown" || key === "ArrowRight";
  // Math.max(0, …) so an unknown/unselected current starts navigation from the
  // first option rather than wrapping off the end.
  const currentIndex = Math.max(0, ids.indexOf(current));
  const nextIndex = (currentIndex + (forward ? 1 : -1) + ids.length) % ids.length;
  return ids[nextIndex];
}
