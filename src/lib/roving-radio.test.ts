import { describe, it, expect } from "vitest";
import { isArrowKey, rovingRadioNext } from "./roving-radio";

describe("isArrowKey", () => {
  it("recognises the four arrow keys", () => {
    expect(isArrowKey("ArrowDown")).toBe(true);
    expect(isArrowKey("ArrowUp")).toBe(true);
    expect(isArrowKey("ArrowLeft")).toBe(true);
    expect(isArrowKey("ArrowRight")).toBe(true);
  });

  it("rejects non-arrow keys", () => {
    expect(isArrowKey("Enter")).toBe(false);
    expect(isArrowKey(" ")).toBe(false);
    expect(isArrowKey("Tab")).toBe(false);
    expect(isArrowKey("a")).toBe(false);
  });
});

describe("rovingRadioNext", () => {
  const ids = ["http", "sftp", "ftps", "smtp"] as const;

  it("moves forward on ArrowDown / ArrowRight", () => {
    expect(rovingRadioNext("ArrowDown", "http", ids)).toBe("sftp");
    expect(rovingRadioNext("ArrowRight", "sftp", ids)).toBe("ftps");
  });

  it("moves backward on ArrowUp / ArrowLeft", () => {
    expect(rovingRadioNext("ArrowUp", "ftps", ids)).toBe("sftp");
    expect(rovingRadioNext("ArrowLeft", "sftp", ids)).toBe("http");
  });

  it("wraps around at both ends", () => {
    expect(rovingRadioNext("ArrowDown", "smtp", ids)).toBe("http"); // last → first
    expect(rovingRadioNext("ArrowUp", "http", ids)).toBe("smtp"); // first → last
  });

  it("returns null for non-arrow keys (no selection change)", () => {
    expect(rovingRadioNext("Enter", "http", ids)).toBeNull();
    expect(rovingRadioNext("Tab", "http", ids)).toBeNull();
  });

  it("returns null when there are no selectable ids", () => {
    expect(rovingRadioNext("ArrowDown", "http", [])).toBeNull();
  });

  it("starts from the first id when current is not in the list", () => {
    // Math.max(0, indexOf=-1) → index 0; forward goes to the second item.
    expect(rovingRadioNext("ArrowDown", "unknown", ids)).toBe("sftp");
    // Backward from index 0 wraps to the last item.
    expect(rovingRadioNext("ArrowUp", "unknown", ids)).toBe("smtp");
  });

  it("operates over only the enabled subset it is given", () => {
    // DeliveryConfigEditor passes the enabled-only id list; a disabled protocol
    // is simply absent, so navigation skips it by construction.
    const enabled = ["http", "ftps", "smtp"];
    expect(rovingRadioNext("ArrowDown", "http", enabled)).toBe("ftps");
  });
});
