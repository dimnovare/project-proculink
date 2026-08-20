// The send confirmation is the consent step for an irreversible action, and it
// used to say nothing about WHERE the order goes. A new user with no delivery
// config reached a live green Send, confirmed a dialog listing total/lines/
// format — everything except the destination — and the first mention of missing
// delivery was the server's refusal afterwards (problemCopy's "Set up delivery"
// panel is post-failure).
//
// The fix informs, it does not re-gate: the server owns refusal, so the dialog
// renders a three-valued delivery check (configured / not configured / unknown)
// and NEVER collapses unknown into either decided answer — the repo's standing
// unknown-renders-as-decided rule (see PracticeDeliveryState for the precedent).
//
// Assertions read the rendered DOM, matching ConfirmDialog.test.tsx.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ConfirmDialog, deliverySetupFrom, configuredDeliverySentence, type DeliverySetupCheck } from "./ConfirmDialog";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import type { DeliveryConfig } from "@/lib/api/types";

const OUTBOUND: PartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
  railHeader: "Supplier",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  deliveredLabel: "Delivered",
  unknownBuyer: "Unknown buyer",
};

function makeConfig(over: Partial<DeliveryConfig> = {}): DeliveryConfig {
  return {
    supplierId: "sup-9",
    protocol: "email",
    autoDeliver: false,
    configJson: JSON.stringify({ toAddresses: ["orders@boltworks.example"] }),
    outputFormat: "csv",
    hasCredentials: false,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function renderDialog(deliverySetup?: DeliverySetupCheck) {
  return render(
    <ConfirmDialog
      exceptionCount={0}
      failingRuleCount={0}
      onConfirm={() => {}}
      onCancel={() => {}}
      supplierName="BoltWorks BV"
      outputFormat="csv"
      grandTotal="EUR 1,200.00"
      lineCount={4}
      labels={OUTBOUND}
      deliverySetup={deliverySetup}
    />,
  );
}

const body = () => document.body.textContent ?? "";

afterEach(cleanup);

describe("the confirm dialog names the destination — or the fact that there is none", () => {
  it("warns, in amber terms, when no delivery is set up, and links the setup tab", () => {
    renderDialog({ state: "not_configured", supplierId: "sup-9" });

    expect(body()).toContain("No delivery is set up for BoltWorks BV — this send will fail.");
    const link = document.querySelector('a[href="/library/suppliers/sup-9?tab=delivery"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toMatch(/set up delivery/i);
  });

  it("falls back to the supplier list when the refusal has no supplier id", () => {
    renderDialog({ state: "not_configured", supplierId: null });

    expect(body()).toContain("No delivery is set up for BoltWorks BV — this send will fail.");
    expect(document.querySelector('a[href="/library/suppliers"]')).not.toBeNull();
  });

  it("names the channel and destination when delivery IS configured", () => {
    renderDialog({ state: "configured", config: makeConfig() });

    expect(body()).toContain("Sends by email to orders@boltworks.example.");
    // …and no warning: configured must not read as its opposite.
    expect(body()).not.toMatch(/no delivery is set up/i);
  });

  it("names an HTTP endpoint for an HTTP config", () => {
    renderDialog({
      state: "configured",
      config: makeConfig({ protocol: "http", configJson: JSON.stringify({ url: "https://api.boltworks.example/orders", method: "POST" }) }),
    });
    expect(body()).toContain("Delivers by HTTP to https://api.boltworks.example/orders.");
  });

  it("UNKNOWN claims neither answer — the three-valued control", () => {
    // The query failed (or has not answered). Collapsing this into "not
    // configured" would warn a working setup will fail; collapsing it into
    // "configured" would invent a destination. It must do neither, and sending
    // must remain available (the server owns refusal).
    renderDialog({ state: "unknown" });

    const text = body();
    expect(text).not.toMatch(/no delivery is set up/i);
    expect(text).not.toMatch(/sends by email/i);
    expect(text).not.toMatch(/delivers by/i);
    expect(text).toMatch(/couldn.t check whether delivery is set up/i);
    expect(text).toMatch(/sending is still available/i);
  });

  it("control: the acknowledgement label is untouched by the delivery line", () => {
    renderDialog({ state: "configured", config: makeConfig() });
    const ack = document.querySelector('label[for="confirm-check"]');
    expect(ack!.textContent).toBe("No open issues to review. Send to BoltWorks BV.");
  });
});

describe("deliverySetupFrom — three-valued, derived from query status, never from data alone", () => {
  it("success with a config is configured", () => {
    const config = makeConfig();
    expect(deliverySetupFrom({ status: "success", data: config }, "sup-9")).toEqual({ state: "configured", config });
  });

  it("success with null (the API's own 'nothing saved') is not configured", () => {
    expect(deliverySetupFrom({ status: "success", data: null }, "sup-9")).toEqual({ state: "not_configured", supplierId: "sup-9" });
  });

  it("a FAILED read is unknown — never 'not configured' (would warn a working send will fail)", () => {
    expect(deliverySetupFrom({ status: "error", data: undefined }, "sup-9")).toEqual({ state: "unknown" });
  });

  it("a pending read is unknown too", () => {
    expect(deliverySetupFrom({ status: "pending", data: undefined }, "sup-9")).toEqual({ state: "unknown" });
  });
});

describe("configuredDeliverySentence — plain channel wording, no guess on an unknown protocol", () => {
  it("joins multiple email recipients", () => {
    const s = configuredDeliverySentence(
      makeConfig({ configJson: JSON.stringify({ toAddresses: ["a@x.example", "b@x.example"] }) }),
      "BoltWorks BV",
    );
    expect(s).toBe("Sends by email to a@x.example, b@x.example.");
  });

  it("says only that delivery is set up when the protocol is one this build does not know", () => {
    const s = configuredDeliverySentence(
      makeConfig({ protocol: "carrier_pigeon" as DeliveryConfig["protocol"], configJson: "{}" }),
      "BoltWorks BV",
    );
    expect(s).toBe("Delivery is set up for BoltWorks BV.");
    expect(s).not.toMatch(/pigeon/i);
  });

  it("survives unparseable configJson without inventing a destination", () => {
    const s = configuredDeliverySentence(makeConfig({ protocol: "http", configJson: "not json" }), "BoltWorks BV");
    expect(s).toBe("Delivers by HTTP.");
  });
});
