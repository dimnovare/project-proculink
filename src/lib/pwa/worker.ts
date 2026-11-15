/** Cache Storage names this origin's worker would own. The worker opens none (public/sw.js); the switch still clears any left behind. */
export const WORKER_CACHE_PREFIX = "plk-";

/** True only on a production build where NEXT_PUBLIC_PWA_WORKER is not "off". Values are passed one by one so Next inlines them. */
export function workerWanted(env: { NODE_ENV: string | undefined; NEXT_PUBLIC_PWA_WORKER: string | undefined }): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PUBLIC_PWA_WORKER !== "off";
}

/**
 * Wanted: register "/sw.js" for the whole origin, checked on every navigation.
 * Not wanted (dev, tests, the kill switch): unregister every registration and delete
 * every Cache Storage entry whose name starts with "plk-".
 * Never throws: a browser without serviceWorker or caches is a no-op.
 */
export async function syncWorker(
  wanted: boolean,
  sw: ServiceWorkerContainer | undefined,
  cacheStorage: CacheStorage | undefined,
): Promise<void> {
  try {
    if (wanted) {
      await sw?.register("/sw.js", { scope: "/", updateViaCache: "none" });
      return;
    }
    const registrations = (await sw?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    const names = (await cacheStorage?.keys()) ?? [];
    await Promise.all(names.filter((n) => n.startsWith(WORKER_CACHE_PREFIX)).map((n) => cacheStorage!.delete(n)));
  } catch {
    // A browser that refuses (private mode, blocked storage) keeps the page working without a worker.
  }
}
