import { describe, it, expect } from "vitest";
import { flowAddress, readFlowView, stepTitle } from "./flowSteps";

const view = (q: string) => readFlowView(new URLSearchParams(q));

describe("flowSteps", () => {
  it("reads the step from the address, takes the old tab names as aliases, and reads anything else as no tab", () => {
    expect(view("tab=read")).toBe("read");
    expect(view("tab=fields")).toBe("read");
    expect(view("tab=outputs")).toBe("send");
    expect(view("tab=intake")).toBe("arrives");
    expect(view("tab=versions")).toBe("history");
    expect(view("tab=documents")).toBe("documents");
    expect(view("tab=bogus")).toBeNull();
    expect(view("tab=constructor")).toBeNull();
    expect(view("tab=read&tab=send")).toBeNull();
    expect(view("")).toBeNull();
  });

  it("writes the address of a step, with the output it opens", () => {
    expect(flowAddress("flow-1", "send", { output: "out-1" })).toBe("/flows/flow-1?tab=send&output=out-1");
    expect(flowAddress("flow-1", "read")).toBe("/flows/flow-1?tab=read");
    expect(flowAddress("flow-1", null)).toBe("/flows/flow-1");
  });

  it("step 4 says the file is made on a download-only flow", () => {
    expect(stepTitle("send", true)).toBe("We make the file");
    expect(stepTitle("send", false)).toBe("We send");
    expect(stepTitle("send", undefined)).toBe("We send");
  });
});
