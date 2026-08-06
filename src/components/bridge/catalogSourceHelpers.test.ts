import { describe, it, expect } from "vitest";
import {
  buildAuthConfigPayload,
  defaultPortForProtocol,
  formatLastSync,
  hasSavedAuthSecretForMethod,
  httpAuthFormSatisfied,
  protocolUsesUrl,
  relativeTime,
  LAST_SYNC_DOT,
  type CatalogAuthFormState,
} from "./catalogSourceHelpers";
import type { CatalogSource } from "@/lib/api/catalogSources";
import {
  CATALOG_SYNC_STATUS_FACTS,
  CATALOG_SYNC_STATUSES,
  CURRENT_SYNC_STATUSES,
  catalogSyncClaimsCurrent,
  catalogSyncStatusFact,
} from "@/lib/catalogSyncStatusManifest";

describe("defaultPortForProtocol", () => {
  it("returns 22 for sftp", () => {
    expect(defaultPortForProtocol("sftp")).toBe(22);
  });
  it("returns 21 for ftp and ftps", () => {
    expect(defaultPortForProtocol("ftp")).toBe(21);
    expect(defaultPortForProtocol("ftps")).toBe(21);
  });
  it("returns 0 for the URL-based http/https protocols", () => {
    expect(defaultPortForProtocol("http")).toBe(0);
    expect(defaultPortForProtocol("https")).toBe(0);
  });
});

describe("protocolUsesUrl", () => {
  it("is true only for http and https", () => {
    expect(protocolUsesUrl("http")).toBe(true);
    expect(protocolUsesUrl("https")).toBe(true);
  });
  it("is false for the host-based file servers", () => {
    expect(protocolUsesUrl("sftp")).toBe(false);
    expect(protocolUsesUrl("ftp")).toBe(false);
    expect(protocolUsesUrl("ftps")).toBe(false);
  });
});

function authForm(partial: Partial<CatalogAuthFormState>): CatalogAuthFormState {
  return {
    authMethod: "none",
    apiKeyHeader: "",
    apiKeyValue: "",
    bearerToken: "",
    basicUsername: "",
    basicPassword: "",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
    scope: "",
    ...partial,
  };
}

describe("buildAuthConfigPayload", () => {
  describe("none", () => {
    it("returns an empty object on a fresh save (no stored config)", () => {
      expect(buildAuthConfigPayload(authForm({ authMethod: "none" }), false)).toEqual({});
    });
    it("returns null when a config is already stored (backend clears it)", () => {
      expect(buildAuthConfigPayload(authForm({ authMethod: "none" }), true)).toBeNull();
    });
  });

  describe("apikey", () => {
    it("emits only header + value, defaulting the header", () => {
      expect(
        buildAuthConfigPayload(authForm({ authMethod: "apikey", apiKeyValue: "secret" }), false),
      ).toEqual({ apiKeyHeader: "X-Api-Key", apiKeyValue: "secret" });
    });
    it("honors a custom header name", () => {
      expect(
        buildAuthConfigPayload(
          authForm({ authMethod: "apikey", apiKeyHeader: "Authorization", apiKeyValue: "k" }),
          false,
        ),
      ).toEqual({ apiKeyHeader: "Authorization", apiKeyValue: "k" });
    });
    it("returns null (keep stored) when blank and a secret exists", () => {
      expect(buildAuthConfigPayload(authForm({ authMethod: "apikey" }), true)).toBeNull();
    });
  });

  describe("bearer", () => {
    it("emits only the token", () => {
      expect(
        buildAuthConfigPayload(authForm({ authMethod: "bearer", bearerToken: "t0k" }), false),
      ).toEqual({ bearerToken: "t0k" });
    });
    it("returns null (keep stored) when blank and a secret exists", () => {
      expect(buildAuthConfigPayload(authForm({ authMethod: "bearer" }), true)).toBeNull();
    });
  });

  describe("basic", () => {
    it("emits username + password", () => {
      expect(
        buildAuthConfigPayload(
          authForm({ authMethod: "basic", basicUsername: " user ", basicPassword: "pw" }),
          false,
        ),
      ).toEqual({ basicUsername: "user", basicPassword: "pw" });
    });
    it("returns null (keep stored) when password blank and a secret exists", () => {
      expect(
        buildAuthConfigPayload(authForm({ authMethod: "basic", basicUsername: "u" }), true),
      ).toBeNull();
    });
  });

  describe("oauth2_client_credentials", () => {
    it("emits token URL, client id, secret, and optional scope", () => {
      expect(
        buildAuthConfigPayload(
          authForm({
            authMethod: "oauth2_client_credentials",
            tokenUrl: " https://t/oauth ",
            clientId: " cid ",
            clientSecret: "csec",
            scope: " catalog.read ",
          }),
          false,
        ),
      ).toEqual({
        tokenUrl: "https://t/oauth",
        clientId: "cid",
        clientSecret: "csec",
        scope: "catalog.read",
      });
    });
    it("omits scope when blank", () => {
      const out = buildAuthConfigPayload(
        authForm({
          authMethod: "oauth2_client_credentials",
          tokenUrl: "https://t",
          clientId: "c",
          clientSecret: "s",
        }),
        false,
      );
      expect(out).not.toHaveProperty("scope");
    });
    it("returns null (keep stored) when secret blank and a secret exists", () => {
      expect(
        buildAuthConfigPayload(
          authForm({ authMethod: "oauth2_client_credentials", tokenUrl: "https://t", clientId: "c" }),
          true,
        ),
      ).toBeNull();
    });
  });

  it("never leaks fields from a non-selected method", () => {
    const out = buildAuthConfigPayload(
      authForm({ authMethod: "bearer", bearerToken: "t", basicPassword: "leak", apiKeyValue: "leak" }),
      false,
    );
    expect(out).toEqual({ bearerToken: "t" });
  });
});

describe("hasSavedAuthSecretForMethod", () => {
  it("is true only when a config is stored AND its method matches the form's", () => {
    expect(hasSavedAuthSecretForMethod({ hasAuthConfig: true, authMethod: "bearer" }, "bearer")).toBe(true);
    expect(hasSavedAuthSecretForMethod({ hasAuthConfig: true, authMethod: "apikey" }, "apikey")).toBe(true);
  });
  it("is false on a method switch — the stored blob would apply the OLD auth type", () => {
    expect(hasSavedAuthSecretForMethod({ hasAuthConfig: true, authMethod: "bearer" }, "basic")).toBe(false);
    expect(
      hasSavedAuthSecretForMethod({ hasAuthConfig: true, authMethod: "basic" }, "oauth2_client_credentials"),
    ).toBe(false);
  });
  it("is false when nothing is stored, for 'none', or without a saved source", () => {
    expect(hasSavedAuthSecretForMethod({ hasAuthConfig: false, authMethod: "bearer" }, "bearer")).toBe(false);
    expect(hasSavedAuthSecretForMethod({ hasAuthConfig: true, authMethod: "none" }, "none")).toBe(false);
    expect(hasSavedAuthSecretForMethod(null, "bearer")).toBe(false);
  });
});

describe("httpAuthFormSatisfied", () => {
  it("none is always satisfied", () => {
    expect(httpAuthFormSatisfied(authForm({ authMethod: "none" }), false)).toBe(true);
  });

  describe("keep path (blank fields + method-matched saved secret)", () => {
    it("allows a blank form for every secret-carrying method", () => {
      expect(httpAuthFormSatisfied(authForm({ authMethod: "apikey", apiKeyHeader: "X-Api-Key" }), true)).toBe(true);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "bearer" }), true)).toBe(true);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "basic" }), true)).toBe(true);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "oauth2_client_credentials" }), true)).toBe(true);
    });
    it("rejects a blank form when no method-matched secret is saved (e.g. after a method switch)", () => {
      expect(httpAuthFormSatisfied(authForm({ authMethod: "bearer" }), false)).toBe(false);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "basic" }), false)).toBe(false);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "oauth2_client_credentials" }), false)).toBe(false);
    });
  });

  describe("replace path (anything typed requires the full usable set)", () => {
    it("apikey: a value needs a header; a custom header needs the value re-entered", () => {
      expect(httpAuthFormSatisfied(authForm({ authMethod: "apikey", apiKeyValue: "k", apiKeyHeader: "X-Api-Key" }), false)).toBe(true);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "apikey", apiKeyValue: "k", apiKeyHeader: "  " }), false)).toBe(false);
      // Header-only edit with a saved secret cannot merge with the stored value.
      expect(httpAuthFormSatisfied(authForm({ authMethod: "apikey", apiKeyHeader: "X-Custom" }), true)).toBe(false);
    });
    it("basic: a typed username without a password is never silently dropped", () => {
      expect(httpAuthFormSatisfied(authForm({ authMethod: "basic", basicUsername: "u" }), true)).toBe(false);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "basic", basicUsername: "u", basicPassword: "p" }), true)).toBe(true);
      expect(httpAuthFormSatisfied(authForm({ authMethod: "basic", basicPassword: "p" }), false)).toBe(true);
    });
    it("oauth2: a partial edit forces the full set (tokenUrl + clientId + secret)", () => {
      expect(
        httpAuthFormSatisfied(authForm({ authMethod: "oauth2_client_credentials", tokenUrl: "https://t" }), true),
      ).toBe(false);
      expect(
        httpAuthFormSatisfied(authForm({ authMethod: "oauth2_client_credentials", scope: "s" }), true),
      ).toBe(false);
      expect(
        httpAuthFormSatisfied(
          authForm({ authMethod: "oauth2_client_credentials", tokenUrl: "https://t", clientId: "c", clientSecret: "s" }),
          false,
        ),
      ).toBe(true);
    });
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-12T12:00:00Z").getTime();
  it("returns null for missing/unparseable input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("not-a-date", now)).toBeNull();
  });
  it("buckets seconds/minutes/hours/days", () => {
    expect(relativeTime("2026-06-12T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-12T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-12T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("2d ago");
  });
});

function src(partial: Partial<CatalogSource>): CatalogSource {
  return {
    protocol: "sftp",
    host: "h",
    port: 22,
    remotePath: "/p",
    username: "u",
    hasPassword: true,
    fileFormat: "auto",
    syncIntervalHours: 24,
    isEnabled: true,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    url: null,
    authMethod: null,
    hasAuthConfig: false,
    httpMethod: null,
    columnMapping: null,
    ...partial,
  };
}

describe("formatLastSync", () => {
  const now = new Date("2026-06-12T12:00:00Z").getTime();

  it("reports never synced when there is no status", () => {
    expect(formatLastSync(null, now)).toEqual({ tone: "never", text: "Never synced" });
    expect(formatLastSync(src({ lastSyncStatus: null }), now).tone).toBe("never");
  });

  it("surfaces the failure message honestly", () => {
    const line = formatLastSync(
      src({ lastSyncStatus: "failed", lastSyncAt: "2026-06-12T10:00:00Z", lastSyncError: "Connection timed out" }),
      now,
    );
    expect(line.tone).toBe("failed");
    expect(line.text).toBe("Last sync failed: Connection timed out");
  });

  it("falls back to a generic failure when no message is present", () => {
    expect(formatLastSync(src({ lastSyncStatus: "failed", lastSyncError: null }), now).text).toBe(
      "Last sync failed",
    );
  });

  it("renders running, unchanged, and ok states with relative time", () => {
    expect(formatLastSync(src({ lastSyncStatus: "running", lastSyncAt: "2026-06-12T11:55:00Z" }), now).text).toBe(
      "Syncing (started 5m ago)",
    );
    expect(formatLastSync(src({ lastSyncStatus: "unchanged", lastSyncAt: "2026-06-12T10:00:00Z" }), now).text).toBe(
      "Last checked 2h ago — no change",
    );
    expect(formatLastSync(src({ lastSyncStatus: "ok", lastSyncAt: "2026-06-12T11:00:00Z" }), now).text).toBe(
      "Last synced 1h ago",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// An UNRECOGNISED sync status must never read as a success.
//
// `lastSyncStatus` is typed `CatalogSyncStatus` — four members — but it is a raw JSON
// string off the wire, so the union is a compile-time claim only. `formatLastSync` used
// to switch on it with the unknown arm merged into the success arm:
//
//     case "ok":
//     default:
//       return { tone: "ok", text: rel ? `Last synced ${rel}` : "Synced" };
//
// so `partial`, `timeout`, `rate_limited`, `auth_failed` — anything the backend added or
// renamed — rendered a GREEN dot over "Last synced 3m ago", printing `lastSyncAt` as
// though the run behind it had succeeded.
//
// The casts below are the point, not a shortcut: they are the only way to express a
// value the type system forbids and the network permits.
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses a backend could plausibly grow into. None are in the manifest. */
const UNRECOGNISED = ["partial", "timeout", "rate_limited", "auth_failed", "cancelled", "skipped"];

function withStatus(status: string, at: string | null = "2026-06-12T11:57:00Z"): CatalogSource {
  return src({ lastSyncStatus: status as CatalogSource["lastSyncStatus"], lastSyncAt: at });
}

describe("formatLastSync — a status the manifest does not know", () => {
  const now = new Date("2026-06-12T12:00:00Z").getTime();

  it.each(UNRECOGNISED)("%s is not read as a success", (status) => {
    const line = formatLastSync(withStatus(status), now);

    expect(line.tone).not.toBe("ok");
    expect(line.tone).toBe("unknown");
    // The dot is the affirmative signal an operator reads first. Never the brand green.
    expect(LAST_SYNC_DOT[line.tone]).not.toBe(LAST_SYNC_DOT.ok);
    // No success sentence, and no timestamp presented as a sync that happened.
    expect(line.text).not.toContain("Last synced");
    expect(line.text).not.toContain("Synced");
    expect(line.text).not.toContain("ago");
    // It says what the server actually reported.
    expect(line.text).toBe(`Sync reported "${status}" — ProcuLink cannot tell whether it worked`);
  });

  // ANTI-VACUITY. Every assertion above is a negative, and a negative passes against a
  // helper that returned "" — or against a test whose `withStatus` had quietly stopped
  // producing the status at all. These pin the positive half on the SAME builder, so the
  // block above cannot go green by matching nothing.
  it("the same builder still produces the green success line for a recognised status", () => {
    const line = formatLastSync(withStatus("ok", "2026-06-12T11:00:00Z"), now);

    expect(line.tone).toBe("ok");
    expect(LAST_SYNC_DOT[line.tone]).toBe("#2E8E3A");
    expect(line.text).toBe("Last synced 1h ago");
    expect(line.text).toContain("ago");
  });

  it("the unrecognised set is non-empty and disjoint from the manifest", () => {
    expect(UNRECOGNISED.length).toBeGreaterThan(0);
    for (const status of UNRECOGNISED) {
      expect(CATALOG_SYNC_STATUSES, `${status} is in the manifest — it cannot test the unknown arm`)
        .not.toContain(status);
      expect(catalogSyncStatusFact(status)).toBeNull();
    }
  });

  it("a status that is not a token is named generically rather than interpolated", () => {
    // Same carrier family as `lastSyncError`: a server-authored string landing inside a
    // sentence. A status is a TOKEN, so anything longer or with markup in it is refused
    // outright rather than cleaned — see STATUS_TOKEN in catalogSourceHelpers.ts.
    const html = formatLastSync(withStatus("<!DOCTYPE html><html><body>502</body></html>"), now);
    expect(html.tone).toBe("unknown");
    expect(html.text).toBe("Sync reported an unrecognised state — ProcuLink cannot tell whether it worked");
    expect(html.text).not.toContain("<");

    const long = formatLastSync(withStatus("x".repeat(400)), now);
    expect(long.text).toBe("Sync reported an unrecognised state — ProcuLink cannot tell whether it worked");
  });

  it("a blank or whitespace status reads as never synced, not as a sync", () => {
    for (const blank of ["", "   ", "\n"]) {
      const line = formatLastSync(withStatus(blank), now);
      expect(line.tone).toBe("never");
      expect(line.text).toBe("Never synced");
    }
  });

  it("surrounding whitespace on a real status still resolves it", () => {
    expect(formatLastSync(withStatus(" ok ", "2026-06-12T11:00:00Z"), now).tone).toBe("ok");
  });
});

describe("the last-sync tone vocabulary", () => {
  it("every manifest status has its own copy arm — the unknown arm stays unreached", () => {
    // Walks the manifest rather than a hand-typed list, so a row added there without a
    // `case` in formatLastSync fails here instead of silently taking the fallback.
    expect(CATALOG_SYNC_STATUS_FACTS.length).toBeGreaterThanOrEqual(4);
    for (const fact of CATALOG_SYNC_STATUS_FACTS) {
      const line = formatLastSync(withStatus(fact.status), new Date("2026-06-12T12:00:00Z").getTime());
      expect(line.tone, `${fact.status} fell through to the unrecognised arm`).not.toBe("unknown");
      expect(line.text.length).toBeGreaterThan(0);
    }
  });

  it("only the ok tone is the brand green", () => {
    // The direction the next instance of this defect comes from: a tone added to the
    // record by copying the line above it.
    const tones = Object.keys(LAST_SYNC_DOT) as (keyof typeof LAST_SYNC_DOT)[];
    expect(tones.length).toBeGreaterThanOrEqual(6);
    for (const tone of tones) {
      if (tone === "ok") continue;
      expect(LAST_SYNC_DOT[tone], `tone "${tone}" renders the success green`).not.toBe(LAST_SYNC_DOT.ok);
    }
  });

  it("only a status the manifest calls current may claim the catalog is current", () => {
    expect(CURRENT_SYNC_STATUSES).toEqual(["ok", "unchanged"]);
    expect(catalogSyncClaimsCurrent("ok")).toBe(true);
    expect(catalogSyncClaimsCurrent("unchanged")).toBe(true);
    expect(catalogSyncClaimsCurrent("running")).toBe(false);
    expect(catalogSyncClaimsCurrent("failed")).toBe(false);
    for (const status of UNRECOGNISED) expect(catalogSyncClaimsCurrent(status)).toBe(false);
    expect(catalogSyncClaimsCurrent(null)).toBe(false);
  });
});
