import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// WP-11 follow-through. The backend answers a gated capability with
// 403 `{ error: "<capability>_requires_<plan>", upgradeUrl }`. Every surface that can
// receive one must render THIS banner instead of its generic failure copy, so a customer
// reads a sentence and gets a way to act — never a snake_case token and never a
// "check your connection" message for a failure that has nothing to do with the network.
//
// The plan name is derived from the code (planGateMessage), never written here: if a
// feature is re-tiered server-side the copy follows it with no frontend change.

import { PlanGateNotice } from "./PlanGateNotice";

afterEach(cleanup);

describe("PlanGateNotice", () => {
  it("names the capability and the plan the backend asked for", () => {
    render(<PlanGateNotice error="cxml_output_requires_operations" capability="cXML output" />);

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/cXML output/i);
    expect(notice).toHaveTextContent(/Operations/);
  });

  it("never shows the raw code", () => {
    render(<PlanGateNotice error="erp_delivery_requires_enterprise" capability="ERP delivery" />);

    expect(screen.getByRole("status").textContent ?? "").not.toMatch(/_requires_|erp_delivery/);
  });

  it("links to the upgrade url the backend returned", () => {
    render(
      <PlanGateNotice
        error={'API error 403: {"error":"webhook_delivery_requires_growth","upgradeUrl":"/settings?tab=billing"}'}
        capability="HTTP delivery"
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("falls back to /settings when the body named no url", () => {
    render(<PlanGateNotice error="advanced_audit_requires_operations" capability="The full audit log" />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings");
  });

  it("reads an Error object, since that is what the api layer throws", () => {
    render(
      <PlanGateNotice
        error={new Error('{"error":"bulk_mapping_import_requires_operations","upgradeUrl":"/settings"}')}
        capability="Bulk mapping import"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Operations/);
  });

  it("renders nothing when the failure is not a plan gate", () => {
    const { container } = render(<PlanGateNotice error="host_not_allowed" capability="HTTP delivery" />);

    expect(container).toBeEmptyDOMElement();
  });
});
