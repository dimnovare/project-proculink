import { describe, it, expect } from "vitest";
import { decideOrgGate } from "./orgGate";

describe("decideOrgGate", () => {
  it("skips the gate entirely in bypass (mock / QA-bypass) mode", () => {
    expect(decideOrgGate({ bypass: true, membershipsLoaded: false, membershipOrgIds: [], activeOrgId: null })).toEqual({ kind: "skip" });
  });
  it("is ready when an org is already active", () => {
    expect(decideOrgGate({ bypass: false, membershipsLoaded: true, membershipOrgIds: ["org_1"], activeOrgId: "org_1" })).toEqual({ kind: "ready" });
  });
  it("waits while memberships are still loading", () => {
    expect(decideOrgGate({ bypass: false, membershipsLoaded: false, membershipOrgIds: [], activeOrgId: null })).toEqual({ kind: "loading" });
  });
  it("prompts creation when the user has zero orgs", () => {
    expect(decideOrgGate({ bypass: false, membershipsLoaded: true, membershipOrgIds: [], activeOrgId: null })).toEqual({ kind: "create" });
  });
  it("auto-activates when the user has exactly one org and none active", () => {
    expect(decideOrgGate({ bypass: false, membershipsLoaded: true, membershipOrgIds: ["org_solo"], activeOrgId: null })).toEqual({ kind: "activate", orgId: "org_solo" });
  });
  it("prompts selection when the user has multiple orgs and none active", () => {
    expect(decideOrgGate({ bypass: false, membershipsLoaded: true, membershipOrgIds: ["org_a", "org_b"], activeOrgId: null })).toEqual({ kind: "select" });
  });
});
