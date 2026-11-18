"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/bridge/DSPrimitives";
import { ApiHttpError } from "@/lib/api/core";
import { alertsState, sendTestAlert, turnOffAlerts, turnOnAlerts, VAPID_PUBLIC_KEY, type AlertsState } from "@/lib/pwa/push";

const LINE: Partial<Record<AlertsState | "error", string>> = {
  off: "Get an alert on this device when a document needs you, and a summary each day.",
  on: "Phone alerts are on for this device.",
  stopped: "Alerts aren't reaching this device for this workspace. Turn them on again.",
  blocked: "Alerts are blocked for ProcuLink in this browser. Allow them in its settings, then try again.",
  error: "Couldn't turn on phone alerts. Try again.",
};

const TEST_LINE = {
  sent: "Test alert on its way. If nothing arrives within a minute, turn phone alerts off and on again.",
  failed: "Couldn't send a test alert. Try again.",
};

/** Settings › Workspace › Use ProcuLink like an app: phone alerts for this device. Asks for permission only on a press. */
export function PhoneAlerts({ publicKey = VAPID_PUBLIC_KEY }: { publicKey?: string }) {
  const [state, setState] = useState<AlertsState | "error" | null>(null);
  const [test, setTest] = useState<keyof typeof TEST_LINE | null>(null);
  const [busy, setBusy] = useState(false);
  // Browser state plus one server check: read once.
  useEffect(() => {
    if (publicKey) void alertsState(publicKey).then(setState);
  }, [publicKey]);
  if (!publicKey) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setTest(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const press = (on: boolean) =>
    run(async () => {
      try {
        setState(on ? await turnOnAlerts(publicKey) : (await turnOffAlerts(), "off"));
      } catch {
        setState("error");
      }
    });
  const sendTest = () =>
    run(async () => {
      try {
        if (await sendTestAlert()) setTest("sent");
        else setState("off");
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) setState("stopped");
        else setTest("failed");
      }
    });

  const canTurnOn = state === "off" || state === "error" || state === "stopped";
  return (
    <>
      {state && LINE[state] && <p className="m-0 text-[14px] text-ink">{LINE[state]}</p>}
      {(canTurnOn || state === "on") && (
        <div className="flex flex-wrap gap-2">
          {state === "on" && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void sendTest()}>
              Send a test alert
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void press(canTurnOn)}>
            {canTurnOn ? "Turn on phone alerts" : "Turn off phone alerts"}
          </Button>
        </div>
      )}
      {test && <p aria-hidden className="m-0 text-[13px] text-ink">{TEST_LINE[test]}</p>}
      {/* Always rendered and out of the layout, so a screen reader announces the result when it arrives. */}
      <span role="status" className="sr-only">{test && TEST_LINE[test]}</span>
      <p className="m-0 text-[13px] text-ink-muted">
        Android phones get alerts in the browser or the installed app. On an iPhone, add ProcuLink to your home screen first (iOS 16.4 or later).
      </p>
    </>
  );
}
