import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt, hasValidSignature, signJwt } from "@clerk/backend/jwt";

import { applyProtectedRouteGuards } from "./middleware";

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
