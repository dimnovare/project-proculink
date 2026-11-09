/** Where a tab key press moves focus: arrows wrap, Home/End jump; any other key is not ours. */
export function nextTabIndex(key: string, index: number, count: number): number | undefined {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}
