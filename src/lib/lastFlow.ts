export const LAST_FLOW_KEY = "plk:upload-flow";

/** The flow a file was last added to on this device; null when none or storage is blocked. */
export function readLastFlow(): string | null {
  try { return window.localStorage.getItem(LAST_FLOW_KEY); } catch { return null; }
}

/** Storage blocked: forgets silently. */
export function rememberFlow(id: string): void {
  try { window.localStorage.setItem(LAST_FLOW_KEY, id); } catch { /* storage blocked */ }
}

/** The flow to preselect: the last one used when it is still listed, else the first. null when there are none. */
export function chooseFlow<F extends { id: string }>(flows: readonly F[], lastId: string | null): { flow: F; isLast: boolean } | null {
  const last = flows.find((f) => f.id === lastId);
  if (last) return { flow: last, isLast: true };
  return flows.length ? { flow: flows[0], isLast: false } : null;
}
