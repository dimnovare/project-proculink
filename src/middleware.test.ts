import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt, hasValidSignature, signJwt } from "@clerk/backend/jwt";

import {
  applyProtectedRouteGuards,
  config,
  PROTECTED_ROUTE_PATTERNS,
  qaBypassActive,
  STATIC_ASSET_EXTENSIONS,
} from "./middleware";
import { ROOT } from "./test/appRoutes";

/**
 * The bypass under test used to be `searchParams.has("__clerk_handshake")` → `next()`,
 * placed *before* both the signed-out redirect and the organisation gate. Appending
 * `?__clerk_handshake=anything` to any protected route therefore skipped both.
 *
 * These tests pin both directions the narrowing has to satisfy:
 *   1. a genuine Clerk handshake is still not bounced to /sign-in (no 2026-06-03 loop);
 *   2. a value that is not a real handshake token bypasses nothing.
 *
 * The "genuine" fixture is not hand-written. It is minted with @clerk/backend's own
 * `signJwt` and proven authentic with @clerk/backend's own `decodeJwt` +
 * `hasValidSignature`, i.e. the exact code path `verifyHandshakeToken` runs.
 */

const KID = "ins_2abcDEFghiJKLmnoPQRstuVWxyz";

let genuineHandshakeToken: string;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);

  // Payload shape taken from HandshakeService.resolveHandshake(), which reads
  // `handshakePayload.handshake` as an array of Set-Cookie directives.
  genuineHandshakeToken = await signJwt(
    { handshake: ["__session=eyJhbGciOi.fake.session; Path=/; HttpOnly"] },
    privateJwk,
    { algorithm: "RS256", header: { kid: KID, typ: "JWT" } },
  );
});

type SessionOverrides = { userId?: string | null; orgId?: string | null };

function documentRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, "https://proculink.eu"), {
    method: "GET",
    headers: { "sec-fetch-dest": "document", ...headers },
  });
}

function run(req: NextRequest, session: SessionOverrides = {}) {
  return applyProtectedRouteGuards(req, async () => session);
}

const SIGNED_OUT: SessionOverrides = { userId: null, orgId: null };
const SIGNED_IN_NO_ORG: SessionOverrides = { userId: "user_123", orgId: null };
const SIGNED_IN_WITH_ORG: SessionOverrides = { userId: "user_123", orgId: "org_123" };

function location(res: Response | undefined) {
  return res?.headers.get("location") ?? null;
}

describe("handshake fixture is a real Clerk-format token", () => {
  it("decodes and verifies through @clerk/backend's own JWT code", async () => {
    const decoded = decodeJwt(genuineHandshakeToken);

    expect(decoded.header.alg).toBe("RS256");
    expect(decoded.header.kid).toBe(KID);
    expect(await hasValidSignature(decoded, publicJwk)).toBe(true);
  });
});

describe("a genuine handshake still gets through", () => {
  it("is not bounced to /sign-in while signed out", async () => {
    const res = await run(
      documentRequest(`/upload?__clerk_handshake=${genuineHandshakeToken}`),
      SIGNED_OUT,
    );

    expect(location(res)).not.toContain("/sign-in");
  });

  it("retries the same route so Clerk's Set-Cookie headers can land", async () => {
    const res = await run(
      documentRequest(`/upload?__clerk_handshake=${genuineHandshakeToken}`),
      SIGNED_OUT,
    );

    expect(res?.status).toBe(307);
    expect(new URL(location(res)!).pathname).toBe("/upload");
  });

  it("strips every Clerk parameter from the retry so the branch cannot re-enter", async () => {
    const res = await run(
      documentRequest(
        `/upload?__clerk_handshake=${genuineHandshakeToken}`
          + `&__clerk_db_jwt=${genuineHandshakeToken}`
          + "&__clerk_handshake_nonce=abc&__clerk_help=1&keep=yes",
      ),
      SIGNED_OUT,
    );

    const retry = new URL(location(res)!);
    expect(retry.searchParams.get("__clerk_handshake")).toBeNull();
    expect(retry.searchParams.get("__clerk_db_jwt")).toBeNull();
    expect(retry.searchParams.get("__clerk_handshake_nonce")).toBeNull();
    expect(retry.searchParams.get("__clerk_help")).toBeNull();
    // Unrelated query state survives the retry.
    expect(retry.searchParams.get("keep")).toBe("yes");
  });

  it("also accepts the token on __clerk_db_jwt", async () => {
    const res = await run(
      documentRequest(`/upload?__clerk_db_jwt=${genuineHandshakeToken}`),
      SIGNED_OUT,
    );

    expect(location(res)).not.toContain("/sign-in");
  });

  it("leaves an already signed-in handshake return alone", async () => {
    const res = await run(
      documentRequest(`/upload?__clerk_handshake=${genuineHandshakeToken}`),
      SIGNED_IN_WITH_ORG,
    );

    expect(res).toBeUndefined();
  });
});

describe("a value that is not a handshake token bypasses nothing", () => {
  // Each of these used to return NextResponse.next() on a protected route.
  const forged: Array<[string, string]> = [
    ["the original report: any bare string", "anything"],
    ["a single dot-separated triple of junk", "a.b.c"],
    ["base64url segments that are not JSON", "AAAA.BBBB.CCCC"],
    // {"alg":"none"} — the classic downgrade.
    ["alg: none", "eyJhbGciOiJub25lIn0.e30.AAAA"],
    // {"alg":"HS256","kid":"x"} — symmetric alg Clerk never verifies with.
    ["a symmetric algorithm", "eyJhbGciOiJIUzI1NiIsImtpZCI6IngifQ.e30.AAAA"],
    // {"alg":"RS256"} — right alg, no kid, so no JWK could ever be resolved.
    ["RS256 with no kid", "eyJhbGciOiJSUzI1NiJ9.e30.AAAA"],
    // {"alg":"RS256","kid":"x","typ":"JWS"} — typ Clerk's assertHeaderType rejects.
    [
      "a non-JWT typ",
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IngiLCJ0eXAiOiJKV1MifQ.e30.AAAA",
    ],
    // "[]" — valid JSON, not a header object.
    ["a JSON array as the header", "W10.e30.AAAA"],
    ["characters outside base64url", "!!!.e30.AAAA"],
    // A header Clerk would accept, wrapped around segments it could not decode.
    [
      "a valid header over a non-base64url payload",
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.@@@.AAAA",
    ],
    [
      "a valid header over a non-base64url signature",
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30.@@@",
    ],
    // Payload decodes to the string "notjson", which decodeJwt cannot JSON.parse.
    [
      "a valid header over a non-JSON payload",
      "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.bm90anNvbg.AAAA",
    ],
    ["two segments", "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30"],
    ["four segments", "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30.AAAA.BBBB"],
    ["an empty value", ""],
  ];

  it.each(forged)("%s does not skip the signed-out redirect", async (_label, value) => {
    const res = await run(
      documentRequest(`/upload?__clerk_handshake=${encodeURIComponent(value)}`),
      SIGNED_OUT,
    );

    expect(new URL(location(res)!).pathname).toBe("/sign-in");
  });

  it.each(forged)("%s does not skip it on __clerk_db_jwt either", async (_label, value) => {
    const res = await run(
      documentRequest(`/upload?__clerk_db_jwt=${encodeURIComponent(value)}`),
      SIGNED_OUT,
    );

    expect(new URL(location(res)!).pathname).toBe("/sign-in");
  });
});

describe("no query parameter can reach past the organisation gate", () => {
  it("a forged handshake does not skip it", async () => {
    const res = await run(
      documentRequest("/upload?__clerk_handshake=anything"),
      SIGNED_IN_NO_ORG,
    );

    expect(new URL(location(res)!).pathname).toBe("/onboarding/select-organization");
  });

  it("a genuine handshake does not skip it either", async () => {
    const res = await run(
      documentRequest(`/upload?__clerk_handshake=${genuineHandshakeToken}`),
      SIGNED_IN_NO_ORG,
    );

    expect(new URL(location(res)!).pathname).toBe("/onboarding/select-organization");
  });

  it("still honours the documented org_set and /admin escape hatches", async () => {
    await expect(
      run(documentRequest("/upload?org_set=1"), SIGNED_IN_NO_ORG),
    ).resolves.toBeUndefined();
    await expect(
      run(documentRequest("/admin"), SIGNED_IN_NO_ORG),
    ).resolves.toBeUndefined();
  });
});

describe("the allowance is scoped to the shape a handshake actually returns on", () => {
  // Mirrors HandshakeService.isRequestEligibleForHandshake(): GET, and either
  // Sec-Fetch-Dest document/iframe or (absent Sec-Fetch-Dest) an Accept of text/html.
  it("rejects a genuine token on a subresource fetch", async () => {
    const req = new NextRequest(
      new URL(`/upload?__clerk_handshake=${genuineHandshakeToken}`, "https://proculink.eu"),
      { method: "GET", headers: { "sec-fetch-dest": "empty" } },
    );

    expect(new URL(location(await run(req, SIGNED_OUT))!).pathname).toBe("/sign-in");
  });

  it("rejects a genuine token on a non-GET request", async () => {
    const req = new NextRequest(
      new URL(`/upload?__clerk_handshake=${genuineHandshakeToken}`, "https://proculink.eu"),
      { method: "POST", headers: { "sec-fetch-dest": "document" } },
    );

    expect(new URL(location(await run(req, SIGNED_OUT))!).pathname).toBe("/sign-in");
  });

  it("accepts an iframe destination", async () => {
    const req = documentRequest(`/upload?__clerk_handshake=${genuineHandshakeToken}`, {
      "sec-fetch-dest": "iframe",
    });

    expect(location(await run(req, SIGNED_OUT))).not.toContain("/sign-in");
  });

  it("falls back to Accept: text/html when Sec-Fetch-Dest is absent", async () => {
    const req = new NextRequest(
      new URL(`/upload?__clerk_handshake=${genuineHandshakeToken}`, "https://proculink.eu"),
      { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } },
    );

    expect(location(await run(req, SIGNED_OUT))).not.toContain("/sign-in");
  });

  it("does not touch unprotected routes", async () => {
    await expect(
      run(documentRequest("/pricing?__clerk_handshake=anything"), SIGNED_OUT),
    ).resolves.toBeUndefined();
  });
});

describe("the dependency contract the retry redirect relies on", () => {
  /**
   * `redirectPastHandshake` is only safe because clerkMiddleware appends
   * `requestState.headers` — the Set-Cookie directives resolveHandshake() produced —
   * onto whatever the handler returns, *before* it checks `isRedirect(handlerResult)`.
   * If a Clerk upgrade reorders those two, a genuine handshake would redirect without
   * its cookies and loop. Fail loudly here rather than in production.
   */
  it("clerkMiddleware still appends requestState.headers before handling a redirect", () => {
    // `dist/**` is not in @clerk/nextjs's exports map, so reach it via a resolvable
    // entry point and read its sibling.
    const require_ = createRequire(import.meta.url);
    const middlewarePath = join(
      dirname(require_.resolve("@clerk/nextjs/server")),
      "clerkMiddleware.js",
    );
    const source = readFileSync(middlewarePath, "utf8");

    // Anchors chosen because they are spelled identically in the esm and cjs builds.
    const appendsRequestStateHeaders = source.indexOf("handlerResult.headers.append(key, value)");
    const handlesRedirect = source.indexOf("(clerkRequest, handlerResult");

    // Both anchors must exist, or the ordering assertion below passes vacuously.
    expect(appendsRequestStateHeaders).toBeGreaterThan(-1);
    expect(handlesRedirect).toBeGreaterThan(-1);
    expect(handlesRedirect).toBeGreaterThan(appendsRequestStateHeaders);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The matcher: which requests reach the guard above at all.
//
// THE DEFECT (2026-08-21). `config.matcher` was `/((?!_next|.*\..*).*)`. The
// `.*\..*` arm excluded every pathname CONTAINING a dot, on the assumption that
// a dot means a file. Next dynamic segments accept dots, so the three protected
// routes with a dynamic segment — /inbox/[orderId],
// /library/suppliers/[id] and /connections/[connectionId] — were all reachable
// signed out by putting a dot in the id. Measured against a local dev server:
// `/inbox/008412` answered 307 to /sign-in, `/inbox/anything.with.a.dot`
// answered 200 with the workspace shell. No tenant data crossed — every data
// query is gated on useQueriesEnabled(), which is false without a session, and
// the API is org-scoped — but the guard did not run, which is the finding.
//
// These tests do not re-implement the matcher. They compile the REAL exported
// `config.matcher` with the same two Next functions the framework itself uses
// (getMiddlewareMatchers at build, getMiddlewareRouteMatcher at request time),
// so a pattern that parses differently than assumed fails here rather than in
// production.

type CompiledMatcher = { regexp: string };

const nodeRequire = createRequire(import.meta.url);

const { getMiddlewareMatchers } = nodeRequire(
  "next/dist/build/analysis/get-page-static-info",
) as {
  getMiddlewareMatchers: (
    matcher: string | string[],
    nextConfig: object,
  ) => CompiledMatcher[];
};

const { getMiddlewareRouteMatcher } = nodeRequire(
  "next/dist/shared/lib/router/utils/middleware-route-matcher",
) as {
  getMiddlewareRouteMatcher: (
    matchers: CompiledMatcher[],
  ) => (pathname: string, req: unknown, query: unknown) => boolean;
};

const matchCompiledMatcher = getMiddlewareRouteMatcher(
  getMiddlewareMatchers(config.matcher, {}),
);

/** Does the middleware run for `pathname`? Answered by Next's own matcher. */
function middlewareRunsFor(pathname: string): boolean {
  return matchCompiledMatcher(pathname, {}, {});
}

/** Every file really sitting in `public/`, as the URL it is served at. */
function listPublicFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listPublicFiles(join(dir, entry.name), url));
    else found.push(url);
  }
  return found;
}

const PUBLIC_FILES = listPublicFiles(join(ROOT, "public")).sort();

/** "/inbox(.*)" -> "inbox". The prefix each protected pattern claims. */
const PROTECTED_PREFIXES = PROTECTED_ROUTE_PATTERNS.map((pattern) =>
  pattern.replace(/^\//, "").replace(/\(\.\*\)$/, ""),
);

describe("the matcher inputs are not vacuous", () => {
  // Everything below iterates one of these three. A walk that finds nothing
  // makes `it.each` register zero cases and the file goes green enforcing
  // nothing — the failure this repo has already paid for elsewhere.
  it("finds the files that really live in public/", () => {
    expect(PUBLIC_FILES.length).toBeGreaterThanOrEqual(20);
    expect(PUBLIC_FILES).toContain("/favicon.ico");
    expect(PUBLIC_FILES).toContain("/robots.txt");
    // A nested one: the exclusion cannot be anchored to the site root.
    expect(PUBLIC_FILES.some((f) => f.startsWith("/guides/"))).toBe(true);
  });

  it("finds every protected prefix", () => {
    expect(PROTECTED_PREFIXES.length).toBeGreaterThanOrEqual(8);
    expect(PROTECTED_PREFIXES).toContain("inbox");
    expect(PROTECTED_PREFIXES.every((p) => /^[a-z]+$/.test(p))).toBe(true);
  });

  it("finds a real list of asset extensions", () => {
    expect(STATIC_ASSET_EXTENSIONS.length).toBeGreaterThanOrEqual(15);
    expect(STATIC_ASSET_EXTENSIONS).toContain("png");
  });

  it("does not run for everything, and does not run for nothing", () => {
    // Both degenerate matchers would satisfy half this file on their own.
    expect(middlewareRunsFor("/upload")).toBe(true);
    expect(middlewareRunsFor("/favicon.ico")).toBe(false);
  });
});

describe("a dot in a protected path no longer skips the guard", () => {
  // The finding verbatim, on each of the three routes that actually has a
  // dynamic segment to put a dot in.
  it.each([
    ["/inbox/anything.with.a.dot"],
    ["/inbox/PO-2026-008412.v2"],
    ["/library/suppliers/a.b"],
    ["/connections/a.b"],
  ])("%s reaches the middleware", (pathname) => {
    expect(middlewareRunsFor(pathname)).toBe(true);
  });

  it.each(PROTECTED_PREFIXES)(
    "/%s/an.id.with.dots reaches the middleware",
    (prefix) => {
      expect(middlewareRunsFor(`/${prefix}/an.id.with.dots`)).toBe(true);
    },
  );

  // The narrowing is an extension list, so an id that ends in one would still
  // look like an asset to the first pattern. The second pattern is what covers
  // it; without that, this is where the hole would reopen.
  it.each(STATIC_ASSET_EXTENSIONS)(
    "an order id ending in .%s still reaches the middleware",
    (extension) => {
      expect(middlewareRunsFor(`/inbox/order.${extension}`)).toBe(true);
    },
  );

  it.each(PROTECTED_PREFIXES)("/%s itself still reaches the middleware", (prefix) => {
    expect(middlewareRunsFor(`/${prefix}`)).toBe(true);
  });

  it("does not claim a route that merely starts with a protected prefix", () => {
    // "/inboxes" is not "/inbox". Both reach the middleware, because every
    // non-asset path does — that is the first pattern doing its job, and
    // isProtectedRoute decides from there. The discriminator has to be an
    // asset-shaped path, where only the second (protected-prefix) pattern can
    // pull something through: "/inbox/x.png" must, "/inboxes.png" must not.
    expect(middlewareRunsFor("/inbox/x.png")).toBe(true);
    expect(middlewareRunsFor("/inboxes.png")).toBe(false);
  });
});

describe("public routes and static assets are unaffected", () => {
  it.each([["/"], ["/pricing"], ["/sign-in"], ["/onboarding/select-organization"]])(
    "%s still reaches the middleware",
    (pathname) => {
      expect(middlewareRunsFor(pathname)).toBe(true);
    },
  );

  it.each(PUBLIC_FILES)("%s is still served without the middleware", (pathname) => {
    expect(middlewareRunsFor(pathname)).toBe(false);
  });

  it.each(STATIC_ASSET_EXTENSIONS)(
    "a top-level .%s asset skips the middleware",
    (extension) => {
      expect(middlewareRunsFor(`/asset.${extension}`)).toBe(false);
    },
  );

  it.each(STATIC_ASSET_EXTENSIONS)(
    "a nested .%s asset skips the middleware",
    (extension) => {
      expect(middlewareRunsFor(`/deeply/nested/asset.${extension}`)).toBe(false);
    },
  );

  // `/_next/data/<build-id>/...` is deliberately absent: Next wraps every
  // matcher in an optional `_next/data/<build-id>` prefix group and evaluates
  // the pattern against what follows, so that form is a Pages Router data route
  // this App-Router-only app never serves.
  it.each([
    ["/_next/static/chunks/main.js"],
    ["/_next/static/media/inter-latin.woff2"],
    ["/_next/image"],
  ])("%s skips the middleware", (pathname) => {
    expect(middlewareRunsFor(pathname)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The QA auth bypass.
//
// PROCULINK_QA_BYPASS_AUTH=true replaces the whole Clerk guard with a
// pass-through so protected screens can be screenshotted without a session. Its
// production safety is one NODE_ENV comparison, and until 2026-08-21 nothing
// tested it. All four quadrants are pinned below — twice: once on the pure
// decision, and once on the module that consumes it, because a decision function
// nothing calls is not a guard.

describe("qaBypassActive — all four quadrants", () => {
  it("flag ON, not production → bypass active", () => {
    expect(
      qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "true", NODE_ENV: "development" }),
    ).toBe(true);
  });

  it("flag ON, PRODUCTION → bypass refused", () => {
    // The quadrant that matters. Everything else here is context for this line.
    expect(
      qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "true", NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("flag OFF, not production → bypass refused", () => {
    expect(
      qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "false", NODE_ENV: "development" }),
    ).toBe(false);
  });

  it("flag OFF, PRODUCTION → bypass refused", () => {
    expect(
      qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "false", NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("an unset flag is not a bypass, in either environment", () => {
    expect(qaBypassActive({ NODE_ENV: "development" })).toBe(false);
    expect(qaBypassActive({ NODE_ENV: "production" })).toBe(false);
    expect(qaBypassActive({})).toBe(false);
  });

  it.each([["TRUE"], ["True"], ["1"], ["yes"], ["on"], [""], [" true"], ["true "]])(
    "%o is not the string that turns it on",
    (value) => {
      expect(
        qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: value, NODE_ENV: "development" }),
      ).toBe(false);
    },
  );

  it("treats an unknown NODE_ENV as not-production, as the local QA flow needs", () => {
    // Documented, not incidental: `bun run dev` with the flag set is the whole
    // point, and `test` and an absent NODE_ENV must behave the same way.
    expect(qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "true", NODE_ENV: "test" })).toBe(true);
    expect(qaBypassActive({ PROCULINK_QA_BYPASS_AUTH: "true" })).toBe(true);
  });
});

describe("the module wires that decision to the guard it replaces", () => {
  /**
   * Loads a fresh copy of the middleware module under a given environment.
   *
   * Clerk is deliberately left unconfigured so the NOT-bypassed path resolves to
   * the local fallback (a /sign-in redirect) instead of reaching for the
   * network — the assertion is about which branch was taken, not about Clerk.
   */
  async function loadMiddleware(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const mod = (await import("./middleware")) as {
      default: (req: NextRequest, event: unknown) => Promise<Response> | Response;
    };
    return (pathname: string) => mod.default(documentRequest(pathname), {});
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("flag ON, PRODUCTION → a protected route is still bounced to /sign-in", async () => {
    const run = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "true",
      NODE_ENV: "production",
    });

    const res = await run("/upload");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("flag ON, not production → the guard is replaced by a pass-through", async () => {
    const run = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "true",
      NODE_ENV: "development",
    });

    const res = await run("/upload");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("flag OFF, not production → a protected route is bounced to /sign-in", async () => {
    const run = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "false",
      NODE_ENV: "development",
    });

    const res = await run("/upload");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("flag OFF, PRODUCTION → a protected route is bounced to /sign-in", async () => {
    const run = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "false",
      NODE_ENV: "production",
    });

    const res = await run("/upload");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("leaves public routes alone whether or not the bypass is on", async () => {
    const bypassed = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "true",
      NODE_ENV: "development",
    });
    expect((await bypassed("/pricing")).headers.get("location")).toBeNull();

    const guarded = await loadMiddleware({
      PROCULINK_QA_BYPASS_AUTH: "false",
      NODE_ENV: "production",
    });
    expect((await guarded("/pricing")).headers.get("location")).toBeNull();
  });
});
