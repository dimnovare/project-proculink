import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { removePushDevice, savePushDevice } from "@/lib/api/documents";
import { alertsState, keyBytes, showBadge, turnOffAlerts, turnOnAlerts } from "./push";

vi.mock("@/lib/api/documents", () => ({ savePushDevice: vi.fn(), removePushDevice: vi.fn() }));

const endpoint = "https://fcm.googleapis.com/fcm/send/t";
let unsubscribe: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let current: unknown;
let sub: object;
let requestPermission: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(savePushDevice).mockReset().mockResolvedValue(undefined);
  vi.mocked(removePushDevice).mockReset().mockResolvedValue(undefined);
  unsubscribe = vi.fn(async () => true);
  sub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }), unsubscribe };
  current = null;
  subscribe = vi.fn(async () => (current = sub));
  requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  const registration = { pushManager: { subscribe, getSubscription: async () => current } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => registration } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

it("turning on asks once, subscribes with the key, and saves only the three keys; a refused save leaves nothing behind", async () => {
  current = sub;                                     // an old subscription is removed, here and on the server, first
  await expect(turnOnAlerts("BAAA")).resolves.toBe("on");
  expect(vi.mocked(removePushDevice)).toHaveBeenCalledWith(endpoint);
  expect(vi.mocked(removePushDevice).mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0]);
  expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(subscribe.mock.invocationCallOrder[0]);
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes("BAAA") });
  expect(savePushDevice).toHaveBeenCalledWith({ endpoint, p256dh: "p", auth: "a" });
  current = null;
  unsubscribe.mockClear();
  vi.mocked(savePushDevice).mockRejectedValueOnce(new Error("refused"));
  await expect(turnOnAlerts("BAAA")).rejects.toThrow("refused");
  expect(unsubscribe).toHaveBeenCalled();
  subscribe.mockClear();
  requestPermission.mockResolvedValueOnce("denied");
  await expect(turnOnAlerts("BAAA")).resolves.toBe("blocked");
  expect(subscribe).not.toHaveBeenCalled();
  await expect(alertsState("")).resolves.toBe("unavailable");
});

it("turning off removes the device then unsubscribes and never throws; the badge sets, clears and survives a browser without it", async () => {
  await turnOnAlerts("BAAA");
  await turnOffAlerts();
  expect(vi.mocked(removePushDevice).mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0]);
  unsubscribe.mockClear();
  vi.mocked(removePushDevice).mockRejectedValueOnce(new Error("offline"));
  await expect(turnOffAlerts()).resolves.toBeUndefined();
  expect(unsubscribe).toHaveBeenCalled();
  current = null;
  unsubscribe.mockClear();
  vi.mocked(removePushDevice).mockClear();
  await turnOffAlerts();
  expect(removePushDevice).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();

  const nav = navigator as { setAppBadge?: unknown; clearAppBadge?: unknown };
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  Object.assign(nav, { setAppBadge, clearAppBadge });
  showBadge(3);
  showBadge(0);
  expect(setAppBadge).toHaveBeenCalledWith(3);
  expect(clearAppBadge).toHaveBeenCalled();
  delete nav.setAppBadge;
  delete nav.clearAppBadge;
  expect(() => showBadge(3)).not.toThrow();
});
