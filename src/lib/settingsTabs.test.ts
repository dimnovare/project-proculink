import { describe, expect, it } from "vitest";
import { readSettingsTab, settingsAddress, SETTINGS_TABS } from "./settingsTabs";

const p = (q: string) => new URLSearchParams(q);

describe("settings tabs", () => {
  it("reads one known tab from the address, and anything else as Workspace", () => {
    expect(readSettingsTab(p("tab=billing"))).toBe("billing");
    expect(readSettingsTab(p("tab=destinations&open=dest-1"))).toBe("destinations");
    expect(readSettingsTab(p("tab=connectors"))).toBe("org");
    expect(readSettingsTab(p("tab=api"))).toBe("org");
    for (const q of ["", "tab=", "tab=Billing", "tab=billing&tab=api", "tab=%3Cb%3E", "open=dest-1"]) {
      expect(readSettingsTab(p(q)), q).toBe("org");
    }
  });

  it("names the board's three tabs in order and writes the address with the tab alone", () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(["Workspace", "Destinations", "Plan & billing"]);
    expect(SETTINGS_TABS.map((t) => settingsAddress(t.id))).toEqual([
      "/settings?tab=org", "/settings?tab=destinations", "/settings?tab=billing",
    ]);
  });
});
