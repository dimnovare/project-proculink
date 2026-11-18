"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { alertsState, turnOffAlerts, turnOnAlerts, VAPID_PUBLIC_KEY, type AlertsState } from "@/lib/pwa/push";

const LINE: Partial<Record<AlertsState | "error", string>> = {
  off: "Get an alert on this device when a document needs you, and a summary each day.",
  on: "Phone alerts are on for this device.",
  blocked: "Alerts are blocked for ProcuLink in this browser. Allow them in its settings, then try again.",
  error: "Couldn't turn on phone alerts. Try again.",
};

/** Settings › Workspace › Use ProcuLink like an app: phone alerts for this device. Asks for permission only on a press. */
export function PhoneAlerts({ publicKey = VAPID_PUBLIC_KEY }: { publicKey?: string }) {
  const [state, setState] = useState<AlertsState | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  // Browser state, not server data: read once.
  useEffect(() => {
    if (publicKey) void alertsState(publicKey).then(setState);
  }, [publicKey]);
  if (!publicKey) return null;

  const press = async (on: boolean) => {
    setBusy(true);
    try {
      setState(on ? await turnOnAlerts(publicKey) : (await turnOffAlerts(), "off"));
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  };
  const canTurnOn = state === "off" || state === "error";
  return (
    <>
      {state && LINE[state] && <p className="m-0 text-[14px] text-ink">{LINE[state]}</p>}
      {(canTurnOn || state === "on") && (
        <div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void press(canTurnOn)}>
            {canTurnOn ? "Turn on phone alerts" : "Turn off phone alerts"}
          </Button>
        </div>
      )}
      <p className="m-0 text-[13px] text-ink-muted">
        Android phones get alerts in the browser or the installed app. On an iPhone, add ProcuLink to your home screen first (iOS 16.4 or later).
      </p>
    </>
  );
}
