import { expect, it, vi } from "vitest";
import { syncWorker, workerWanted } from "./worker";

it("registers only on a production build with the switch on; otherwise removes every worker and every plk- cache", async () => {
  expect(workerWanted({ NODE_ENV: "production", NEXT_PUBLIC_PWA_WORKER: undefined })).toBe(true);
  expect(workerWanted({ NODE_ENV: "production", NEXT_PUBLIC_PWA_WORKER: "off" })).toBe(false);
  expect(workerWanted({ NODE_ENV: "development", NEXT_PUBLIC_PWA_WORKER: undefined })).toBe(false);
  const unregister = vi.fn(async () => true);
  const sw = { register: vi.fn(async () => ({})), getRegistrations: vi.fn(async () => [{ unregister }, { unregister }]) };
  const cacheStorage = { keys: vi.fn(async () => ["plk-shell", "other-app"]), delete: vi.fn(async () => true) };
  await syncWorker(true, sw as never, cacheStorage as never);
  expect(sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  expect(unregister).not.toHaveBeenCalled();
  await syncWorker(false, sw as never, cacheStorage as never);
  expect(unregister).toHaveBeenCalledTimes(2);
  expect(cacheStorage.delete.mock.calls).toEqual([["plk-shell"]]);
  await expect(syncWorker(false, undefined, undefined)).resolves.toBeUndefined();
});
