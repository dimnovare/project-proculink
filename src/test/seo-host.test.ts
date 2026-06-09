import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import sitemap from "../app/sitemap";

describe("canonical production host", () => {
  it("lists only apex-domain URLs in the sitemap", () => {
    expect(sitemap().every(({ url }) => url.startsWith("https://proculink.eu/"))).toBe(true);
  });

  it("redirects the www host to the apex domain", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/:path*",
      has: [{ type: "host", value: "www.proculink.eu" }],
      destination: "https://proculink.eu/:path*",
      permanent: true,
    });
  });
});
