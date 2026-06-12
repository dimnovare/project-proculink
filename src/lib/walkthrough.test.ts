import { describe, it, expect, afterEach, vi } from "vitest";
import { walkthroughConfigured } from "@/lib/walkthrough";

// walkthroughConfigured reads process.env at call time, so vi.stubEnv works in
// vitest (in the real Next build the expressions are inlined per environment).

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("walkthroughConfigured", () => {
  it("is false when neither env var is set", () => {
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_LOOM_URL", "");
    expect(walkthroughConfigured()).toBe(false);
  });

  it("is true when only the self-hosted video URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL", "https://assets.proculink.eu/walkthrough.mp4");
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_LOOM_URL", "");
    expect(walkthroughConfigured()).toBe(true);
  });

  it("is true when only the Loom URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_LOOM_URL", "https://www.loom.com/embed/abc123");
    expect(walkthroughConfigured()).toBe(true);
  });

  it("is true when both are set", () => {
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL", "https://assets.proculink.eu/walkthrough.mp4");
    vi.stubEnv("NEXT_PUBLIC_WALKTHROUGH_LOOM_URL", "https://www.loom.com/embed/abc123");
    expect(walkthroughConfigured()).toBe(true);
  });
});
