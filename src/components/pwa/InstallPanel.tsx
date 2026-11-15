"use client";

import { Button } from "@/components/bridge/DSPrimitives";
import { SettingsPanel } from "@/components/settings/SettingsPrimitives";
import { promptInstall, useInstallState, type InstallState } from "@/lib/pwa/install";

const LINE: Partial<Record<InstallState, string>> = {
  app: "You're using ProcuLink as an app on this device.",
  installed: "Installed. Open ProcuLink from your home screen or desktop.",
  dismissed: "Not installed. You can still install it from your browser's menu.",
  manual: "If your browser can install it, the option is in its menu.",
};

/** Settings › Workspace: the one place ProcuLink offers to be installed. */
export function InstallPanel() {
  const state = useInstallState();
  const line = LINE[state];
  return (
    <SettingsPanel id="s-app" title="Use ProcuLink like an app" data-testid="install-panel">
      <p className="m-0 text-[14px] text-ink-muted">Add it to your home screen or desktop. It opens in its own window, like an app.</p>
      {state === "prompt" && (
        <div>
          <Button type="button" variant="secondary" onClick={() => void promptInstall()}>Install ProcuLink</Button>
        </div>
      )}
      {line && <p className="m-0 text-[14px] text-ink">{line}</p>}
      {state !== "app" && state !== "unknown" && (
        <p className="m-0 text-[13px] text-ink-muted">On an iPhone: tap Share, then Add to Home Screen.</p>
      )}
    </SettingsPanel>
  );
}
