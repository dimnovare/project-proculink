import { expect, it } from "vitest";
import { deriveInstallState, isIos } from "./install";

it("derives one install state from what the device says, app first and dismissal kept", () => {
  const base = { standalone: false, ios: false, hasPrompt: false, installed: false, dismissed: false };
  expect(deriveInstallState({ ...base, standalone: true, hasPrompt: true })).toBe("app");
  expect(deriveInstallState({ ...base, installed: true, hasPrompt: true })).toBe("installed");
  expect(deriveInstallState({ ...base, dismissed: true, hasPrompt: true })).toBe("dismissed");
  expect(deriveInstallState({ ...base, hasPrompt: true })).toBe("prompt");
  expect(deriveInstallState({ ...base, ios: true })).toBe("iphone");
  expect(deriveInstallState(base)).toBe("manual");
  expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  expect(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
});
