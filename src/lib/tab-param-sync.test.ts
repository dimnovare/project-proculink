import { describe, it, expect } from "vitest";
import { resolveTabParamChange } from "@/lib/tab-param-sync";

type SettingsTab = "org" | "billing" | "email";
const isSettingsTab = (v: string | null | undefined): v is SettingsTab =>
  v === "org" || v === "billing" || v === "email";

describe("resolveTabParamChange", () => {
  it("syncs when the param changes to a valid tab", () => {
    expect(resolveTabParamChange("billing", null, isSettingsTab)).toBe("billing");
    expect(resolveTabParamChange("email", "billing", isSettingsTab)).toBe("email");
  });

  it("does not sync when the param is unchanged (manual-click re-render)", () => {
    // After a manual tab click the URL keeps its old ?tab= value; re-renders
    // must not snap the UI back to it.
    expect(resolveTabParamChange("billing", "billing", isSettingsTab)).toBeNull();
    expect(resolveTabParamChange(null, null, isSettingsTab)).toBeNull();
    expect(resolveTabParamChange(undefined, undefined, isSettingsTab)).toBeNull();
  });

  it("ignores changes to an invalid tab value", () => {
    expect(resolveTabParamChange("nonsense", "billing", isSettingsTab)).toBeNull();
    expect(resolveTabParamChange("", "billing", isSettingsTab)).toBeNull();
  });

  it("ignores the param being removed", () => {
    expect(resolveTabParamChange(null, "billing", isSettingsTab)).toBeNull();
    expect(resolveTabParamChange(undefined, "billing", isSettingsTab)).toBeNull();
  });

  it("treats null vs undefined transitions as a change but never a sync", () => {
    expect(resolveTabParamChange(null, undefined, isSettingsTab)).toBeNull();
    expect(resolveTabParamChange(undefined, null, isSettingsTab)).toBeNull();
  });
});
