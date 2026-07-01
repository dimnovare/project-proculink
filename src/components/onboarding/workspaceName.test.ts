import { describe, it, expect } from "vitest";
import { deriveWorkspaceName } from "./workspaceName";

describe("deriveWorkspaceName", () => {
  it("uses the first name when present", () => {
    expect(deriveWorkspaceName("Dmitri", "dmitri@example.com")).toBe("Dmitri's workspace");
  });
  it("first name wins even when an email is also present", () => {
    expect(deriveWorkspaceName("Ada", "someoneelse@example.com")).toBe("Ada's workspace");
  });
  it("falls back to the email local-part when there is no first name", () => {
    expect(deriveWorkspaceName(null, "orders@company.com")).toBe("orders's workspace");
    expect(deriveWorkspaceName(undefined, "orders@company.com")).toBe("orders's workspace");
    expect(deriveWorkspaceName("", "orders@company.com")).toBe("orders's workspace");
  });
  it("falls back to 'My workspace' when neither is available", () => {
    expect(deriveWorkspaceName(null, null)).toBe("My workspace");
    expect(deriveWorkspaceName(undefined, undefined)).toBe("My workspace");
    expect(deriveWorkspaceName("", "")).toBe("My workspace");
  });
  it("trims a whitespace-padded first name", () => {
    expect(deriveWorkspaceName("  Dmitri  ", null)).toBe("Dmitri's workspace");
  });
  it("trims a whitespace-only first name and falls through to email", () => {
    expect(deriveWorkspaceName("   ", "orders@company.com")).toBe("orders's workspace");
  });
  it("trims the derived email local-part", () => {
    expect(deriveWorkspaceName(null, "  orders@company.com  ")).toBe("orders's workspace");
  });
  it("treats a whitespace-only email local-part as absent", () => {
    expect(deriveWorkspaceName(null, "   @company.com")).toBe("My workspace");
  });
});
