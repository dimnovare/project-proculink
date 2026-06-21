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
  dtdSystemId: "",
  dtdPublicId: "",
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

  // T7 — configurable cXML <!DOCTYPE> DTD. Persists into the SAME cXML config payload (→ backend
  // CxmlConfigJson) under the camelCase keys dtdSystemId / dtdPublicId.
  it("persists a custom DTD URI into the cxml config payload as dtdSystemId", () => {
    const result = buildCxmlCredentials(
      "cxml",
      state({ dtdSystemId: "http://supplier.example/custom/cXML.dtd" }),
    );
    expect(result!.dtdSystemId).toBe("http://supplier.example/custom/cXML.dtd");
    expect(result!.dtdPublicId).toBeNull();
  });

  it("carries both DTD ids when both are set (PUBLIC form)", () => {
    const result = buildCxmlCredentials(
      "cxml",
      state({
        dtdSystemId: "http://xml.cxml.org/schemas/cXML/1.2.024/cXML.dtd",
        dtdPublicId: "-//CXML//DTD cXML 1.2.024//EN",
      }),
    );
    expect(result!.dtdSystemId).toBe("http://xml.cxml.org/schemas/cXML/1.2.024/cXML.dtd");
    expect(result!.dtdPublicId).toBe("-//CXML//DTD cXML 1.2.024//EN");
  });

  it("nulls the DTD ids when blank (no DOCTYPE — byte-identical to today)", () => {
    const result = buildCxmlCredentials("cxml", state({ dtdSystemId: "   ", dtdPublicId: "" }));
    expect(result!.dtdSystemId).toBeNull();
    expect(result!.dtdPublicId).toBeNull();
  });
});
