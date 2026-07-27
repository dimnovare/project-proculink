import { describe, it, expect } from "vitest";
import {
  buildContentSecurityPolicy,
  clerkFrontendApiOrigin,
  cspModeFromEnv,
  originOf,
  securityHeaders,
  sentryIngestOrigin,
  sentryReportUri,
  type CspEnv,
} from "./csp";

const DSN = "https://abc123def456@o4511461459558400.ingest.de.sentry.io/4511461475680336";
// pk_live_ + base64("clerk.proculink.eu$")
const PK_LIVE = `pk_live_${Buffer.from("clerk.proculink.eu$").toString("base64")}`;

const BASE: CspEnv = {
  mode: "enforce",
  isDev: false,
  apiBaseUrl: "https://api.proculink.eu",
  clerkPublishableKey: PK_LIVE,
  posthogHost: "https://eu.posthog.com",
  sentryDsn: DSN,
  mediaUrls: ["https://assets.proculink.eu/marketing/walkthrough.mp4"],
  vercelEnv: "production",
};

/** Parse a policy string into { directive: [sources] }. */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe("clerkFrontendApiOrigin", () => {
  it("decodes the Frontend API host out of a live publishable key", () => {
    expect(clerkFrontendApiOrigin(PK_LIVE)).toBe("https://clerk.proculink.eu");
  });

  it("decodes a test key too", () => {
    const pk = `pk_test_${Buffer.from("chief-mole-42.clerk.accounts.dev$").toString("base64")}`;
    expect(clerkFrontendApiOrigin(pk)).toBe("https://chief-mole-42.clerk.accounts.dev");
  });

  it("returns null for an empty or malformed key instead of a bogus origin", () => {
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
    expect(clerkFrontendApiOrigin("")).toBeNull();
    expect(clerkFrontendApiOrigin("not-a-clerk-key")).toBeNull();
    expect(clerkFrontendApiOrigin(`pk_live_${Buffer.from("^^^^$").toString("base64")}`)).toBeNull();
  });
});

describe("sentry DSN parsing", () => {
  it("derives the ingest origin", () => {
    expect(sentryIngestOrigin(DSN)).toBe("https://o4511461459558400.ingest.de.sentry.io");
  });

  it("builds the security report endpoint with the public key", () => {
    expect(sentryReportUri(DSN)).toBe(
      "https://o4511461459558400.ingest.de.sentry.io/api/4511461475680336/security/?sentry_key=abc123def456",
    );
  });

  it("tags the report with the environment when given", () => {
    expect(sentryReportUri(DSN, "preview")).toContain("sentry_environment=preview");
  });

  it("returns null without a DSN so no report-uri is emitted", () => {
    expect(sentryReportUri(undefined)).toBeNull();
    expect(sentryIngestOrigin("garbage")).toBeNull();
  });
});

describe("originOf", () => {
  it("keeps only the origin", () => {
    expect(originOf("https://assets.proculink.eu/marketing/x.mp4")).toBe("https://assets.proculink.eu");
    expect(originOf("http://localhost:5223")).toBe("http://localhost:5223");
  });

  it("rejects empty and non-http values", () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
  });
});

describe("buildContentSecurityPolicy", () => {
  it("allows every third party the app actually loads", () => {
    const d = parse(buildContentSecurityPolicy(BASE));

    expect(d["script-src"]).toContain("https://clerk.proculink.eu");
    expect(d["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(d["script-src"]).toContain("https://eu-assets.i.posthog.com");

    expect(d["connect-src"]).toContain("https://api.proculink.eu");
    expect(d["connect-src"]).toContain("https://clerk.proculink.eu");
    expect(d["connect-src"]).toContain("https://eu.posthog.com");
    expect(d["connect-src"]).toContain("https://o4511461459558400.ingest.de.sentry.io");

    expect(d["img-src"]).toContain("https://img.clerk.com");
    expect(d["media-src"]).toContain("https://assets.proculink.eu");
    expect(d["frame-src"]).toContain("https://challenges.cloudflare.com");
  });

  it("locks down the directives that cannot break a working page", () => {
    const d = parse(buildContentSecurityPolicy(BASE));
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'self'"]);
    expect(d["default-src"]).toEqual(["'self'"]);
  });

  it("never allows eval in a production build", () => {
    expect(buildContentSecurityPolicy(BASE)).not.toContain("'unsafe-eval'");
  });

  it("allows eval and skips upgrade-insecure-requests in dev (HMR + http localhost API)", () => {
    const policy = buildContentSecurityPolicy({
      ...BASE,
      isDev: true,
      apiBaseUrl: "http://localhost:5223",
    });
    expect(parse(policy)["script-src"]).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(parse(policy)["connect-src"]).toContain("http://localhost:5223");
    // HMR websocket
    expect(parse(policy)["connect-src"]).toContain("ws:");
  });

  it("does not allow plain ws: outside dev", () => {
    expect(parse(buildContentSecurityPolicy(BASE))["connect-src"]).not.toContain("ws:");
  });

  it("adds the Vercel toolbar hosts only on preview deployments", () => {
    const preview = parse(buildContentSecurityPolicy({ ...BASE, vercelEnv: "preview" }));
    expect(preview["script-src"]).toContain("https://vercel.live");
    expect(preview["connect-src"]).toContain("wss://ws-us3.pusher.com");

    const prod = parse(buildContentSecurityPolicy(BASE));
    expect(prod["script-src"]).not.toContain("https://vercel.live");
    expect(prod["connect-src"]).not.toContain("wss://ws-us3.pusher.com");
  });

  it("emits a report endpoint when a DSN is configured, and none when it isn't", () => {
    expect(buildContentSecurityPolicy(BASE)).toContain("report-uri https://");
    expect(buildContentSecurityPolicy({ ...BASE, sentryDsn: undefined })).not.toContain("report-uri");
  });

  it("omits third-party origins that are not configured rather than inventing them", () => {
    const d = parse(
      buildContentSecurityPolicy({
        ...BASE,
        apiBaseUrl: undefined,
        clerkPublishableKey: undefined,
        mediaUrls: [],
      }),
    );
    expect(d["connect-src"]).toEqual(
      expect.not.arrayContaining(["undefined", "null", "https://undefined"]),
    );
    expect(d["script-src"]).toEqual(expect.not.arrayContaining(["undefined", "null"]));
    expect(d["media-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("securityHeaders", () => {
  it("report-only mode measures the full policy but still enforces the safe subset", () => {
    const headers = securityHeaders({ ...BASE, mode: "report-only" });
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));

    expect(byKey["Content-Security-Policy-Report-Only"]).toContain("script-src");
    // The enforced header keeps the anti-clickjacking guarantee we already ship.
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(byKey["Content-Security-Policy"]).not.toContain("script-src");
    expect(byKey["Reporting-Endpoints"]).toContain('csp-endpoint="https://');
  });

  it("enforce mode sends one enforced policy and no report-only header", () => {
    const headers = securityHeaders({ ...BASE, mode: "enforce" });
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).not.toContain("Content-Security-Policy-Report-Only");
    const csp = headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("script-src");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("keeps the baseline hardening headers that already shipped", () => {
    const keys = securityHeaders(BASE).map((h) => h.key);
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Permissions-Policy");
  });

  it("omits Reporting-Endpoints when there is no DSN", () => {
    const keys = securityHeaders({ ...BASE, sentryDsn: undefined }).map((h) => h.key);
    expect(keys).not.toContain("Reporting-Endpoints");
  });
});

describe("cspModeFromEnv", () => {
  it("only enforces on an explicit opt-in", () => {
    expect(cspModeFromEnv("enforce")).toBe("enforce");
    expect(cspModeFromEnv("ENFORCE")).toBe("enforce");
    expect(cspModeFromEnv("report-only")).toBe("report-only");
    expect(cspModeFromEnv(undefined)).toBe("report-only");
    expect(cspModeFromEnv("true")).toBe("report-only");
  });
});
