// L09: after a language change reload the header said "Your workspace" until Clerk loaded again.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { forgetWorkspace, useWorkspaceName } from "./useWorkspaceName";

const org = vi.hoisted(() => ({ current: undefined as { name: string } | undefined }));
vi.mock("@clerk/nextjs", () => ({ useOrganization: () => ({ organization: org.current }) }));

describe("useWorkspaceName", () => {
  it("keeps the last workspace name through a reload, and forgets it at sign-out", () => {
    org.current = { name: "Sample Workspace" };
    expect(renderHook(() => useWorkspaceName("Your workspace")).result.current).toBe("Sample Workspace");

    org.current = undefined; // the reload: Clerk has not loaded yet
    expect(renderHook(() => useWorkspaceName("Your workspace")).result.current).toBe("Sample Workspace");

    forgetWorkspace();
    expect(renderHook(() => useWorkspaceName("Your workspace")).result.current).toBe("Your workspace");
  });
});
