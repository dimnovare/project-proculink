/**
 * Phone alerts (Web Push) for this device. The permission prompt only ever runs from
 * turnOnAlerts, which only a button press calls. The worker shows the alerts
 * (public/sw.js); this file subscribes, unsubscribes and sets the icon badge.
 */
import { removePushDevice, savePushDevice } from "@/lib/api/documents";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type AlertsState = "unavailable" | "off" | "on" | "blocked";

export function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** The push manager of this page's worker, or null when this browser can't take alerts. */
async function pushManager(): Promise<PushManager | null> {
  if (typeof PushManager === "undefined" || typeof Notification === "undefined" || !navigator.serviceWorker) return null;
  return (await navigator.serviceWorker.getRegistration())?.pushManager ?? null;
}

export async function alertsState(key = VAPID_PUBLIC_KEY): Promise<AlertsState> {
  try {
    const pm = key ? await pushManager() : null;
    if (!pm) return "unavailable";
    if (Notification.permission === "denied") return "blocked";
    return (await pm.getSubscription()) ? "on" : "off";
  } catch {
    return "unavailable";
  }
}

export async function turnOnAlerts(key = VAPID_PUBLIC_KEY): Promise<AlertsState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission === "default") return "off";
  const pm = await pushManager();
  if (!pm) return "unavailable";
  // An existing subscription may carry an old key.
  await (await pm.getSubscription())?.unsubscribe();
  const sub = await pm.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
  const { keys } = sub.toJSON();
  try {
    await savePushDevice({ endpoint: sub.endpoint, p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" });
  } catch (err) {
    await sub.unsubscribe();
    throw err;
  }
  return "on";
}

export async function turnOffAlerts(): Promise<void> {
  try {
    const sub = await (await pushManager())?.getSubscription();
    if (!sub) return;
    await removePushDevice(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch {
    // Sign-out and the off button go on regardless.
  }
}

export function showBadge(count: number | undefined): void {
  if (count === undefined) return;
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {});
  } catch {
    // A badge is a nicety; a browser that refuses it changes nothing else.
  }
}
