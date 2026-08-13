// "Send a test now" told the operator what the test PROVED and never what it DID.
//
// The side effect is real and differs per channel: SFTP/FTPS leave a file in the supplier's live
// order folder that nothing deletes, email/SMTP put a message in the inbox they read orders at,
// HTTP/ERP hit their production system. One generic sentence would be false for some of them,
// which is what these tests pin.

import { describe, it, expect } from "vitest";
import {
  DELIVERY_TEST_DISCLOSURE,
  deliveryTestDisclosure,
  TEST_ARTIFACT_FILENAME,
  TEST_ARTIFACT_EMAIL_SUBJECT,
} from "./deliveryTestDisclosure";
import type { DeliveryProtocol } from "@/lib/api/types";

// Derived from the union itself rather than hand-typed, so a seventh protocol added to
// DeliveryProtocol cannot slip past with no disclosure — the Record type fails the build, and the
// coverage test below fails if someone satisfies it with an empty string.
const ALL_PROTOCOLS = Object.keys(DELIVERY_TEST_DISCLOSURE) as DeliveryProtocol[];

describe("delivery test disclosure — every channel says what the test leaves behind", () => {
  it("covers every protocol with a non-empty effect", () => {
    // Anti-vacuity floor: without this, `Record<DeliveryProtocol, …>` is satisfied by seven
    // empty strings and every other assertion here still passes.
    expect(ALL_PROTOCOLS.length).toBeGreaterThanOrEqual(7);

    for (const protocol of ALL_PROTOCOLS) {
      const disclosure = DELIVERY_TEST_DISCLOSURE[protocol];
      expect(disclosure.effect.length, `${protocol} has no effect sentence`).toBeGreaterThan(60);
    }
  });

  it("tells file-drop operators the file stays on the supplier's server", () => {
    // The specific fact the UI never carried. Nothing in any dispatcher deletes it, so an
    // operator who tests three times leaves the file there permanently.
    for (const protocol of ["sftp", "ftps"] as const) {
      const { effect } = DELIVERY_TEST_DISCLOSURE[protocol];
      expect(effect).toContain(TEST_ARTIFACT_FILENAME);
      expect(effect).toContain("nothing removes it");
      expect(effect.toLowerCase()).toContain("until someone deletes it");
    }
  });

  it("tells email operators it reaches a real inbox, under a subject that disclaims being an order", () => {
    for (const protocol of ["email", "smtp"] as const) {
      const { effect, caveat } = DELIVERY_TEST_DISCLOSURE[protocol];
      expect(effect).toContain("real email");
      expect(effect).toContain("inbox");

      // The subject the backend now sends. If these two drift apart the UI is describing a
      // message the supplier does not receive.
      expect(effect).toContain(TEST_ARTIFACT_EMAIL_SUBJECT);

      // The operator's configured subject/body is deliberately not used on a test. Setting it
      // aside is defensible; setting it aside silently is not.
      expect(caveat, `${protocol} must disclose that templates are skipped`).not.toBeNull();
      expect(caveat!).toContain("does not use the subject and message you configured");
    }
  });

  it("tells HTTP and ERP operators the request hits their live system", () => {
    for (const protocol of ["http", "erp_erply", "erp_directo"] as const) {
      const { effect } = DELIVERY_TEST_DISCLOSURE[protocol];
      expect(effect).toContain("live");
      expect(effect).toContain("not a practice one");
      expect(effect).toMatch(/may keep a record of it/);
    }
  });

  it("does not give every channel the same sentence", () => {
    // The failure mode this module exists to prevent: one generic line, false for some channels.
    const distinct = new Set(ALL_PROTOCOLS.map((p) => DELIVERY_TEST_DISCLOSURE[p].effect));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it("never claims a test proves the supplier accepted an order", () => {
    for (const protocol of ALL_PROTOCOLS) {
      const { effect, caveat } = DELIVERY_TEST_DISCLOSURE[protocol];
      const text = `${effect} ${caveat ?? ""}`;
      expect(text).not.toMatch(/accepted/i);
      // Each channel's sentence must say the payload is not an order.
      expect(text).toMatch(/not an order|no order|rather than an order/i);
    }
  });

  it("returns null for a protocol it has not been taught, instead of a reassuring guess", () => {
    // An unknown channel's side effect is unestablished. Inventing a calm sentence for it would
    // be the same defect as the generic one — the caller renders nothing instead.
    expect(deliveryTestDisclosure("as2")).toBeNull();
    expect(deliveryTestDisclosure("")).toBeNull();
    expect(deliveryTestDisclosure("HTTP")).toBeNull();
  });

  it("resolves every real protocol through the lookup", () => {
    for (const protocol of ALL_PROTOCOLS) {
      expect(deliveryTestDisclosure(protocol)).toBe(DELIVERY_TEST_DISCLOSURE[protocol]);
    }
  });
});
