import { describe, test, expect } from "vitest";
import {
  LOOPBACK_ONLY_SCHEMES,
  OUTBOUND_URL_ERRORS,
  type OutboundUrlRefusal,
  SECURE_SCHEMES,
  inspectOutboundUrl,
  isRefusal,
} from "./outboundUrlPolicy";

/**
 * Asserts the URL is refused and hands back the narrowed refusal, so each test reads the code and
 * message directly. Throwing on an unexpected allow IS the assertion — a silent pass-through here
 * would let a weakened policy look green.
 */
function refused(url: string | null | undefined, subject?: string): OutboundUrlRefusal {
  const verdict = inspectOutboundUrl(url, subject);
  if (!isRefusal(verdict)) {
    throw new Error(`Expected "${String(url)}" to be refused, but the policy allowed it.`);
  }
  return verdict;
}

// This mirrors ProcuLink.Core/Security/OutboundUrlPolicy.cs. The backend is the source of
// truth and refuses independently; this copy exists so an operator is told before they submit,
// not after. src/test/backendMirror.test.ts diffs the two scheme sets and error codes against
// the real C# whenever a backend checkout is reachable.

describe("inspectOutboundUrl", () => {
  describe("refuses cleartext to a real host", () => {
    test.each([
      "http://supplier.example.com/orders",
      "http://erp.supplier.com/xmlcore",
      "HTTP://supplier.example.com/orders",
      "http://supplier.example.com:8080/orders",
      "http://192.0.2.10/inbound",
      "http://10.0.0.5/xmlcore",
      "http://169.254.169.254/latest/meta-data",
    ])("%s", (url) => {
      expect(refused(url).errorCode).toBe(OUTBOUND_URL_ERRORS.insecureTransport);
    });

    test("explains what to do rather than emitting a code", () => {
      const verdict = refused("http://supplier.example.com/orders");
      expect(verdict.message).toContain("https://");
      expect(verdict.message).not.toBe(verdict.errorCode);
      expect(verdict.message.length).toBeGreaterThan(40);
    });
  });

  describe("allows what must keep working", () => {
    test.each([
      "https://supplier.example.com/orders",
      "HTTPS://supplier.example.com/orders",
      "https://supplier.example.com:8443/orders",
      "  https://supplier.example.com/orders  ",
    ])("https to a real host: %s", (url) => {
      expect(inspectOutboundUrl(url).allowed).toBe(true);
    });

    // The live failure-state e2e spec saves http://127.0.0.1:<ephemeral>/reject as a delivery
    // target and asserts the save succeeds, so the exemption matches on host, never on a
    // fixed authority string.
    test.each([
      "http://localhost:5223/api/delivery",
      "http://LOCALHOST:5223/api/delivery",
      "http://127.0.0.1:53412/reject",
      "http://127.0.0.2:9000/inbound",
      "http://[::1]:9000/inbound",
      "http://app.localhost:3000/hook",
    ])("plain http on loopback for local development: %s", (url) => {
      expect(inspectOutboundUrl(url).allowed).toBe(true);
    });
  });

  describe("refuses credentials written into the URL", () => {
    test.each([
      "https://user:pass@supplier.example/orders",
      "https://apikey@supplier.example/orders",
      "http://user:pass@localhost:5223/orders",
    ])("%s", (url) => {
      expect(refused(url).errorCode).toBe(OUTBOUND_URL_ERRORS.credentialsInUrl);
    });

    test("never echoes the secret back into the message", () => {
      const verdict = refused("https://admin:hunter2@supplier.example/orders");
      expect(verdict.message).not.toContain("hunter2");
      expect(verdict.message).not.toContain("admin");
    });
  });

  describe("refuses malformed and non-web values", () => {
    test.each(["file:///etc/passwd", "gopher://supplier.example/1", "ftp://supplier.example/x"])(
      "non-web scheme: %s",
      (url) => {
        expect(refused(url).errorCode).toBe(OUTBOUND_URL_ERRORS.schemeNotAllowed);
      },
    );

    test.each(["/orders", "supplier.example.com/orders", "not a url at all"])(
      "relative or malformed: %s",
      (url) => {
        expect(refused(url).errorCode).toBe(OUTBOUND_URL_ERRORS.notAbsolute);
      },
    );

    test.each([null, undefined, "", "   "])("missing: %s", (url) => {
      expect(refused(url).errorCode).toBe(OUTBOUND_URL_ERRORS.required);
    });
  });

  describe("the declared scheme sets are the single source of truth", () => {
    test("are not vacuous and do not overlap", () => {
      expect(SECURE_SCHEMES.length).toBeGreaterThan(0);
      expect(SECURE_SCHEMES).toContain("https");
      expect(LOOPBACK_ONLY_SCHEMES).toEqual(["http"]);
      expect(SECURE_SCHEMES.filter((s) => (LOOPBACK_ONLY_SCHEMES as readonly string[]).includes(s)))
        .toEqual([]);
    });

    test("every secure scheme is allowed to a real host", () => {
      for (const scheme of SECURE_SCHEMES) {
        expect(inspectOutboundUrl(`${scheme}://supplier.example/orders`).allowed).toBe(true);
      }
    });

    test("every loopback-only scheme is refused off loopback and allowed on it", () => {
      for (const scheme of LOOPBACK_ONLY_SCHEMES) {
        expect(inspectOutboundUrl(`${scheme}://supplier.example/orders`).allowed).toBe(false);
        expect(inspectOutboundUrl(`${scheme}://127.0.0.1:9000/orders`).allowed).toBe(true);
      }
    });
  });

  test("uses the caller's subject noun so one policy fits every screen", () => {
    const verdict = refused("http://supplier.example/orders", "Delivery endpoint");
    expect(verdict.message.startsWith("Delivery endpoint")).toBe(true);
  });
});
