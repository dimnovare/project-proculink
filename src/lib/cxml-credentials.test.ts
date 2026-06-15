import { describe, it, expect } from "vitest";
import { buildCxmlCredentials, type CxmlCredentialsState } from "./cxml-credentials";

const state = (overrides: Partial<CxmlCredentialsState> = {}): CxmlCredentialsState => ({
  fromDomain: "NetworkId",
  fromIdentity: "Nasdaq_SE",
  toDomain: "NetworkId",
  toIdentity: "Markit_SE",
  senderDomain: "NetworkId",
  senderIdentity: "Nasdaq_SE",
  senderSharedSecret: "",
  ...overrides,
});

describe("buildCxmlCredentials", () => {
  it("returns undefined for non-cxml output formats", () => {
    expect(buildCxmlCredentials("xml", state())).toBeUndefined();
    expect(buildCxmlCredentials("", state())).toBeUndefined();
    expect(buildCxmlCredentials("json", state({ senderSharedSecret: "x" }))).toBeUndefined();
  });

  it("maps the identities when output is cxml", () => {
    const result = buildCxmlCredentials("cxml", state());
    expect(result).toMatchObject({
      fromDomain: "NetworkId",
      fromIdentity: "Nasdaq_SE",
      toDomain: "NetworkId",
      toIdentity: "Markit_SE",
      senderDomain: "NetworkId",
      senderIdentity: "Nasdaq_SE",
    });
  });

  it("omits the shared secret when blank (leave-blank-to-keep)", () => {
    const result = buildCxmlCredentials("cxml", state({ senderSharedSecret: "   " }));
    expect(result).toBeDefined();
    expect("senderSharedSecret" in result! && result.senderSharedSecret).toBe(undefined);
  });

  it("includes the shared secret when freshly typed", () => {
    const result = buildCxmlCredentials("cxml", state({ senderSharedSecret: " s3cr3t " }));
    expect(result!.senderSharedSecret).toBe("s3cr3t");
  });

  it("nulls out blank identity fields and trims the rest", () => {
    const result = buildCxmlCredentials(
      "cxml",
      state({ fromDomain: "  ", fromIdentity: "  Nasdaq_SE  ", toIdentity: "" }),
    );
    expect(result!.fromDomain).toBeNull();
    expect(result!.fromIdentity).toBe("Nasdaq_SE");
    expect(result!.toIdentity).toBeNull();
  });
});
